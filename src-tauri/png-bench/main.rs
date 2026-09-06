//! Deliberately independent of the application and its Cargo feature graph.
use std::{
    error::Error,
    fs::File,
    io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    path::Path,
    time::Instant,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const IO_BYTES: usize = 1024 * 1024;
const IDAT_BYTES: usize = 4096; // Matches png's production stream_writer default.
const META_LIMIT: usize = 4 * 1024 * 1024;
const DECODE_LIMIT: usize = 16 * 1024 * 1024;
const BACKEND: &str = if cfg!(feature = "png-zlib-rs") {
    "zlib-rs"
} else {
    "miniz_oxide"
};
const MATRIX: &[(u8, png::Filter)] = &[
    (9, png::Filter::MinEntropy),
    (8, png::Filter::MinEntropy),
    (9, png::Filter::Adaptive),
    (9, png::Filter::Sub),
    (9, png::Filter::Up),
    (9, png::Filter::Paeth),
];

#[derive(Debug, PartialEq, Eq)]
struct Chunk {
    after_idat: bool,
    kind: [u8; 4],
    data: Vec<u8>,
}

// Preserve metadata verbatim, including chunks after IDAT, without inflating ICC/text.
// Unknown chunks are rejected rather than silently losing potentially necessary data.
fn metadata(path: &Path) -> Result<Vec<Chunk>> {
    let mut file = BufReader::new(File::open(path)?);
    let length = file.get_ref().metadata()?.len();
    let mut signature = [0; 8];
    file.read_exact(&mut signature)?;
    if signature != *b"\x89PNG\r\n\x1a\n" {
        return Err("Invalid PNG signature".into());
    }
    let mut chunks = Vec::new();
    let mut total = 0usize;
    let mut after_idat = false;
    loop {
        let mut header = [0; 8];
        file.read_exact(&mut header)?;
        let size = u32::from_be_bytes(header[..4].try_into()?) as usize;
        let kind: [u8; 4] = header[4..].try_into()?;
        if file.stream_position()? + size as u64 + 4 > length {
            return Err("Truncated chunk".into());
        }
        match &kind {
            b"IDAT" => {
                after_idat = true;
                file.seek(SeekFrom::Current(size as i64 + 4))?;
            }
            b"IHDR" => {
                file.seek(SeekFrom::Current(size as i64 + 4))?;
            }
            b"IEND" => {
                let mut crc = [0; 4];
                file.read_exact(&mut crc)?;
                if size != 0
                    || u32::from_be_bytes(crc) != crc32fast::hash(b"IEND")
                    || file.stream_position()? != length
                {
                    return Err("Invalid IEND or trailing bytes".into());
                }
                return Ok(chunks);
            }
            b"pHYs" | b"iCCP" | b"sRGB" | b"gAMA" | b"cHRM" | b"sBIT" | b"bKGD" | b"tEXt"
            | b"zTXt" | b"iTXt" | b"tIME" | b"eXIf" | b"cICP" | b"mDCV" | b"cLLI" => {
                total = total.checked_add(size).ok_or("Metadata overflow")?;
                if total > META_LIMIT || chunks.len() >= 1024 {
                    return Err("Metadata exceeds bounded benchmark limits".into());
                }
                let mut data = vec![0; size];
                file.read_exact(&mut data)?;
                let mut crc = [0; 4];
                file.read_exact(&mut crc)?;
                let mut hash = crc32fast::Hasher::new();
                hash.update(&kind);
                hash.update(&data);
                if hash.finalize() != u32::from_be_bytes(crc) {
                    return Err("Metadata CRC mismatch".into());
                }
                chunks.push(Chunk {
                    after_idat,
                    kind,
                    data,
                });
            }
            _ => {
                return Err(format!(
                    "Unsupported chunk {:?}; refusing to strip it",
                    String::from_utf8_lossy(&kind)
                )
                .into())
            }
        }
    }
}

fn reader(path: &Path) -> Result<png::Reader<BufReader<File>>> {
    let mut decoder = png::Decoder::new(BufReader::with_capacity(IO_BYTES, File::open(path)?));
    decoder.set_limits(png::Limits {
        bytes: DECODE_LIMIT,
    });
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    let reader = decoder.read_info()?;
    let info = reader.info();
    if info.color_type != png::ColorType::Rgb
        || info.bit_depth != png::BitDepth::Eight
        || info.interlaced
        || info.animation_control.is_some()
    {
        return Err("Only non-interlaced, non-animated RGB8 PNG is supported".into());
    }
    if info.width == 0 || info.height == 0 || info.width > 17480 || info.height > 59055 {
        return Err("Dimensions outside Nestra canvas bounds".into());
    }
    match info.pixel_dims {
        Some(p) if p.xppu == 11811 && p.yppu == 11811 && p.unit == png::Unit::Meter => (),
        _ => return Err("Expected pHYs = 11811 x 11811 pixels/meter (300 PPI)".into()),
    }
    Ok(reader)
}

fn recompress(
    input: &Path,
    output: &mut File,
    chunks: &[Chunk],
    level: u8,
    filter: png::Filter,
) -> Result<()> {
    recompress_strategy(input, output, chunks, level, filter, false)
}

fn recompress_strategy(
    input: &Path,
    output: &mut File,
    chunks: &[Chunk],
    level: u8,
    filter: png::Filter,
    use_bigrams: bool,
) -> Result<()> {
    let mut source = reader(input)?;
    let (width, height) = (source.info().width, source.info().height);
    let mut buffer = BufWriter::with_capacity(IO_BYTES, output);
    let mut encoder = png::Encoder::new(&mut buffer, width, height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_deflate_compression(png::DeflateCompression::Level(level));
    encoder.set_filter(filter);
    let mut writer = encoder.write_header()?;
    for chunk in chunks.iter().filter(|c| !c.after_idat) {
        writer.write_chunk(png::chunk::ChunkType(chunk.kind), &chunk.data)?;
    }
    {
        let mut stream = writer.stream_writer_with_size(IDAT_BYTES)?;
        let mut previous = if use_bigrams {
            vec![0; width as usize * 3]
        } else {
            Vec::new()
        };
        let mut scratch = if use_bigrams {
            vec![0; width as usize * 3 + 1]
        } else {
            Vec::new()
        };
        for _ in 0..height {
            let row = source.next_row()?.ok_or("Missing source row")?;
            if row.data().len() != width as usize * 3 {
                return Err("Invalid row length".into());
            }
            if use_bigrams {
                stream.set_filter(nestra_png_compression_bench::bigrams(
                    row.data(),
                    &previous,
                    &mut scratch,
                ));
                previous.copy_from_slice(row.data());
            }
            stream.write_all(row.data())?;
        }
        if source.next_row()?.is_some() {
            return Err("Extra source row".into());
        }
        source.finish()?;
        stream.finish()?;
    }
    for chunk in chunks.iter().filter(|c| c.after_idat) {
        writer.write_chunk(png::chunk::ChunkType(chunk.kind), &chunk.data)?;
    }
    writer.finish()?; // Explicit IEND and propagated flush errors.
    buffer.flush()?;
    Ok(())
}

fn verify(input: &Path, candidate: &Path, chunks: &[Chunk]) -> Result<()> {
    if metadata(candidate)? != chunks {
        return Err("Metadata changed".into());
    }
    let mut a = reader(input)?;
    let mut b = reader(candidate)?;
    if (a.info().width, a.info().height) != (b.info().width, b.info().height) {
        return Err("Dimensions changed".into());
    }
    for y in 0..a.info().height {
        let ar = a.next_row()?.ok_or("Missing input row")?;
        let br = b.next_row()?.ok_or("Missing candidate row")?;
        if ar.data() != br.data() {
            return Err(format!("Pixel mismatch on row {y}").into());
        }
    }
    if a.next_row()?.is_some() || b.next_row()?.is_some() {
        return Err("Extra rows".into());
    }
    a.finish()?;
    b.finish()?;
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.is_empty() || args.len() > 2 {
        return Err("Usage: png_compression_bench INPUT.png [CASE_INDEX 0..5 | bigrams]; temporary candidates are deleted after verification".into());
    }
    let selection = args
        .get(1)
        .map(|s| {
            if s == "bigrams" {
                return Ok(6);
            }
            s.to_str()
                .ok_or("Invalid index")?
                .parse::<usize>()
                .map_err(|_| "Invalid index")
        })
        .transpose()?;
    if selection.is_some_and(|i| i > MATRIX.len()) {
        return Err("Case index must be 0..5 or bigrams".into());
    }
    let input = Path::new(&args[0]);
    let chunks = metadata(input)?;
    let source = reader(input)?;
    let row_bytes = source.info().width as usize * 3;
    println!("# input={} dimensions={}x{} row_bytes={} io_buffers_bytes={} idat_bytes={} metadata_bytes={} decoder_budget_each={} (not RSS; codec internals excluded)", input.display(), source.info().width, source.info().height, row_bytes, 2 * IO_BYTES, IDAT_BYTES, chunks.iter().map(|c| c.data.len()).sum::<usize>(), DECODE_LIMIT);
    drop(source);
    let input_bytes = std::fs::metadata(input)?.len();
    let original_hash = nestra_png_compression_bench::file_hash(input)?;
    println!("backend,level,filter,bytes,MiB,reduction_pct,recompress_s,verify_s,status");
    for (index, (level, filter)) in MATRIX
        .iter()
        .copied()
        .chain(std::iter::once((9, png::Filter::NoFilter)))
        .enumerate()
    {
        if index == 6 && selection != Some(6) {
            continue;
        }
        if selection.is_some_and(|i| i != index) {
            continue;
        }
        let label = if index == 6 {
            "Bigrams".to_string()
        } else {
            format!("{filter:?}")
        };
        eprintln!("Running case {index}: {BACKEND} level={level} filter={label}");
        let mut candidate = tempfile::Builder::new()
            .prefix("nestra-png-bench-")
            .suffix(".png")
            .tempfile()?;
        let start = Instant::now();
        let encoded = if index == 6 {
            recompress_strategy(input, candidate.as_file_mut(), &chunks, level, filter, true)
        } else {
            recompress(input, candidate.as_file_mut(), &chunks, level, filter)
        };
        let seconds = start.elapsed().as_secs_f64();
        let bytes = candidate.as_file().metadata()?.len();
        let verify_start = Instant::now();
        let valid = encoded.and_then(|()| verify(input, candidate.path(), &chunks));
        println!(
            "{BACKEND},{level},{label},{bytes},{:.4},{:.4},{seconds:.3},{:.3},{}",
            bytes as f64 / 1048576.0,
            100.0 * (1.0 - bytes as f64 / input_bytes as f64),
            verify_start.elapsed().as_secs_f64(),
            if valid.is_ok() { "VALID" } else { "INVALID" }
        );
        valid?;
        if index == 6 {
            println!(
                "# candidate_structure={}",
                nestra_png_compression_bench::inspect(candidate.path(), std::io::sink())?
            );
            println!(
                "# exact_rgb={}",
                nestra_png_compression_bench::exact_rgb(input, candidate.path())?
            );
            println!("# bigrams_extra_buffers_bytes={}", 2 * row_bytes + 1 + 8192);
        }
        // NamedTempFile removes each candidate before starting the next case.
    }
    if nestra_png_compression_bench::file_hash(input)? != original_hash {
        return Err("Original changed during benchmark".into());
    }
    println!("# original_unchanged_sha256={original_hash}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(path: &Path, pixel: u8, ppm: u32) {
        let mut encoder = png::Encoder::new(File::create(path).unwrap(), 17, 31);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_pixel_dims(Some(png::PixelDimensions {
            xppu: ppm,
            yppu: ppm,
            unit: png::Unit::Meter,
        }));
        encoder.set_source_gamma(png::ScaledFloat::new(0.45455));
        let mut writer = encoder.write_header().unwrap();
        let mut stream = writer.stream_writer().unwrap();
        for y in 0..31 {
            let row: Vec<u8> = (0..51)
                .map(|x| {
                    if y % 3 == 0 {
                        255
                    } else {
                        pixel.wrapping_add((x * y) as u8)
                    }
                })
                .collect();
            stream.write_all(&row).unwrap();
        }
        stream.finish().unwrap();
        writer
            .write_chunk(png::chunk::ChunkType(*b"tEXt"), b"Comment\0after IDAT")
            .unwrap();
        writer.finish().unwrap();
    }

    #[test]
    fn all_cases_preserve_pixels_and_metadata_including_trailing_text() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("input.png");
        fixture(&input, 7, 11811);
        let original = std::fs::read(&input).unwrap();
        let chunks = metadata(&input).unwrap();
        assert!(chunks.iter().any(|c| c.after_idat && c.kind == *b"tEXt"));
        for &(level, filter) in MATRIX {
            let mut out = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
            recompress(&input, out.as_file_mut(), &chunks, level, filter).unwrap();
            verify(&input, out.path(), &chunks).unwrap();
        }
        assert_eq!(original, std::fs::read(&input).unwrap());
    }

    #[test]
    fn rejects_changed_pixels_wrong_ppi_and_truncation() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.png");
        let b = dir.path().join("b.png");
        fixture(&a, 7, 11811);
        fixture(&b, 8, 11811);
        assert!(verify(&a, &b, &metadata(&a).unwrap()).is_err());
        fixture(&b, 7, 11810);
        assert!(reader(&b).is_err());
        let bytes = std::fs::read(&a).unwrap();
        std::fs::write(&b, &bytes[..bytes.len() - 5]).unwrap();
        assert!(metadata(&b).is_err());
    }

    #[test]
    fn bigrams_preserves_exact_pixels_and_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("input.png");
        fixture(&input, 7, 11811);
        let chunks = metadata(&input).unwrap();
        let mut output = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
        recompress_strategy(
            &input,
            output.as_file_mut(),
            &chunks,
            9,
            png::Filter::NoFilter,
            true,
        )
        .unwrap();
        verify(&input, output.path(), &chunks).unwrap();
    }
}
