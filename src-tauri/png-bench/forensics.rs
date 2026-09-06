//! Bounded-memory PNG inspection. No full raster or full IDAT allocation.
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::File,
    io::{self, BufReader, Read, Seek, SeekFrom, Write},
    path::Path,
};
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
pub const IO_BYTES: usize = 64 * 1024;

/// Produce one RGB8 PNG scanline, including its filter byte.
pub fn filter_rgb_row(row: &[u8], previous: &[u8], kind: u8, out: &mut [u8]) {
    assert!(kind <= 4);
    assert_eq!(row.len(), previous.len());
    assert_eq!(out.len(), row.len() + 1);
    out[0] = kind;
    for i in 0..row.len() {
        let left = if i >= 3 { row[i - 3] } else { 0 };
        let up = previous[i];
        let ul = if i >= 3 { previous[i - 3] } else { 0 };
        let predictor = match kind {
            0 => 0,
            1 => left,
            2 => up,
            3 => ((left as u16 + up as u16) / 2) as u8,
            _ => {
                let p = left as i16 + up as i16 - ul as i16;
                let a = (p - left as i16).abs();
                let b = (p - up as i16).abs();
                let c = (p - ul as i16).abs();
                if a <= b && a <= c {
                    left
                } else if b <= c {
                    up
                } else {
                    ul
                }
            }
        };
        out[i + 1] = row[i].wrapping_sub(predictor);
    }
}

/// Exact distinct adjacent byte-pair score (including the filter tag).
/// Tie order None/Sub/Up/Average/Paeth and the all-zero special case match
/// oxipng 10.2.1's documented Bigrams strategy. Independent implementation.
pub fn bigrams(row: &[u8], previous: &[u8], scratch: &mut [u8]) -> png::Filter {
    assert_eq!(row.len(), previous.len());
    assert_eq!(scratch.len(), row.len() + 1);
    let filters = [
        png::Filter::NoFilter,
        png::Filter::Sub,
        png::Filter::Up,
        png::Filter::Avg,
        png::Filter::Paeth,
    ];
    if row.iter().all(|&v| v == 0) {
        return filters[0];
    }
    let mut best = usize::MAX;
    let mut winner = 0;
    for kind in 0..5 {
        scratch[0] = kind as u8;
        for i in 0..row.len() {
            let left = if i >= 3 { row[i - 3] } else { 0 };
            let up = previous[i];
            let ul = if i >= 3 { previous[i - 3] } else { 0 };
            let predictor = match kind {
                0 => 0,
                1 => left,
                2 => up,
                3 => ((left as u16 + up as u16) / 2) as u8,
                _ => {
                    let p = left as i16 + up as i16 - ul as i16;
                    let a = (p - left as i16).abs();
                    let b = (p - up as i16).abs();
                    let c = (p - ul as i16).abs();
                    if a <= b && a <= c {
                        left
                    } else if b <= c {
                        up
                    } else {
                        ul
                    }
                }
            };
            scratch[i + 1] = row[i].wrapping_sub(predictor);
        }
        let mut seen = [0u64; 1024];
        let mut score = 0;
        for pair in scratch.windows(2) {
            let v = u16::from_be_bytes([pair[0], pair[1]]) as usize;
            let bit = 1u64 << (v % 64);
            if seen[v / 64] & bit == 0 {
                seen[v / 64] |= bit;
                score += 1;
                if score >= best {
                    break;
                }
            }
        }
        if score < best {
            best = score;
            winner = kind;
        }
    }
    filters[winner]
}

pub fn file_hash(path: &Path) -> Result<String> {
    let mut f = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = [0; IO_BYTES];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

// Read the logical concatenation of all IDAT payloads, without storing offsets.
pub struct IdatReader {
    file: BufReader<File>,
    remaining: u64,
    ended: bool,
}
impl IdatReader {
    pub fn open(path: &Path) -> Result<Self> {
        let mut file = BufReader::with_capacity(IO_BYTES, File::open(path)?);
        let mut sig = [0; 8];
        file.read_exact(&mut sig)?;
        if sig != *b"\x89PNG\r\n\x1a\n" {
            return Err("Invalid signature".into());
        }
        Ok(Self {
            file,
            remaining: 0,
            ended: false,
        })
    }
}
impl Read for IdatReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        while self.remaining == 0 && !self.ended {
            let mut head = [0; 8];
            self.file.read_exact(&mut head)?;
            let n = u32::from_be_bytes(head[..4].try_into().unwrap()) as u64;
            if &head[4..] == b"IDAT" {
                self.remaining = n;
                if n == 0 {
                    self.file.seek(SeekFrom::Current(4))?;
                }
            } else {
                self.file.seek(SeekFrom::Current(n as i64 + 4))?;
                self.ended = &head[4..] == b"IEND";
            }
        }
        if self.ended {
            return Ok(0);
        }
        let n = out.len().min(self.remaining as usize);
        self.file.read_exact(&mut out[..n])?;
        self.remaining -= n as u64;
        if self.remaining == 0 {
            self.file.seek(SeekFrom::Current(4))?;
        }
        Ok(n)
    }
}

pub fn decoded_reader(path: &Path) -> Result<png::Reader<BufReader<File>>> {
    let mut d = png::Decoder::new(BufReader::with_capacity(IO_BYTES, File::open(path)?));
    d.set_limits(png::Limits {
        bytes: 16 * 1024 * 1024,
    });
    d.set_ignore_text_chunk(true);
    d.set_ignore_iccp_chunk(true);
    d.set_transformations(png::Transformations::EXPAND);
    let r = d.read_info()?;
    if r.info().interlaced
        || r.info().animation_control.is_some()
        || r.info().bit_depth == png::BitDepth::Sixteen
    {
        return Err(
            "Forensics row comparison supports static non-interlaced PNG <=8 bits only".into(),
        );
    }
    if r.info().width > 17480 || r.info().height > 59055 {
        return Err("Canvas exceeds bounds".into());
    }
    Ok(r)
}

pub fn rgb_row(data: &[u8], color: png::ColorType, out: &mut Vec<u8>) -> Result<()> {
    out.clear();
    match color {
        png::ColorType::Rgb => out.extend_from_slice(data),
        png::ColorType::Grayscale => {
            for &v in data {
                out.extend_from_slice(&[v, v, v]);
            }
        }
        png::ColorType::Rgba => {
            for p in data.chunks_exact(4) {
                if p[3] != 255 {
                    return Err("Non-opaque pixel; cannot compare as exact RGB".into());
                }
                out.extend_from_slice(&p[..3]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for p in data.chunks_exact(2) {
                if p[1] != 255 {
                    return Err("Non-opaque pixel".into());
                }
                out.extend_from_slice(&[p[0]; 3]);
            }
        }
        _ => return Err("Palette was not expanded".into()),
    }
    Ok(())
}

pub fn exact_rgb(a: &Path, b: &Path) -> Result<serde_json::Value> {
    let mut a = decoded_reader(a)?;
    let mut b = decoded_reader(b)?;
    let (w, h) = (a.info().width, a.info().height);
    if (w, h) != (b.info().width, b.info().height) {
        return Err("Dimension mismatch".into());
    }
    for r in [&a, &b] {
        match r.info().pixel_dims {
            Some(p) if p.xppu == 11811 && p.yppu == 11811 && p.unit == png::Unit::Meter => (),
            _ => return Err("pHYs must be 11811/11811 Meter".into()),
        }
    }
    let ac = a.output_color_type().0;
    let bc = b.output_color_type().0;
    let mut ar = Vec::with_capacity(w as usize * 3);
    let mut br = Vec::with_capacity(w as usize * 3);
    let mut ah = Sha256::new();
    let mut bh = Sha256::new();
    let mut colors = HashSet::<[u8; 3]>::with_capacity(257);
    for y in 0..h {
        rgb_row(
            a.next_row()?.ok_or("Missing input row")?.data(),
            ac,
            &mut ar,
        )?;
        rgb_row(
            b.next_row()?.ok_or("Missing candidate row")?.data(),
            bc,
            &mut br,
        )?;
        if ar.len() != w as usize * 3 || ar != br {
            return Err(format!("Pixel mismatch at row {y}").into());
        }
        ah.update(&ar);
        bh.update(&br);
        if colors.len() < 257 {
            for p in ar.chunks_exact(3) {
                colors.insert(p.try_into()?);
                if colors.len() == 257 {
                    break;
                }
            }
        }
    }
    if a.next_row()?.is_some() || b.next_row()?.is_some() {
        return Err("Extra rows".into());
    }
    a.finish()?;
    b.finish()?;
    Ok(
        serde_json::json!({"byte_identical":true,"rgb_bytes":w as u64*h as u64*3,
        "original_rgb_sha256":format!("{:x}",ah.finalize()),"candidate_rgb_sha256":format!("{:x}",bh.finalize()),
        "unique_colors_capped_at_257":colors.len(),"more_than_256":colors.len()==257}),
    )
}

pub fn inspect(path: &Path, mut chunk_list: impl Write) -> Result<serde_json::Value> {
    let mut f = BufReader::with_capacity(IO_BYTES, File::open(path)?);
    let total_bytes = f.get_ref().metadata()?.len();
    let mut sig = [0; 8];
    f.read_exact(&mut sig)?;
    if sig != *b"\x89PNG\r\n\x1a\n" {
        return Err("Invalid signature".into());
    }
    let mut chunks = BTreeMap::<String, (u64, u64, u64)>::new();
    let mut scratch = [0; IO_BYTES];
    let mut index = 0;
    writeln!(chunk_list, "index,offset,type,payload_bytes,total_bytes")?;
    loop {
        let offset = f.stream_position()?;
        let mut head = [0; 8];
        f.read_exact(&mut head)?;
        let n = u32::from_be_bytes(head[..4].try_into()?) as u64;
        let kind = std::str::from_utf8(&head[4..])?.to_owned();
        if offset + n + 12 > total_bytes {
            return Err("Truncated chunk".into());
        }
        let mut crc = crc32fast::Hasher::new();
        crc.update(&head[4..]);
        let mut left = n;
        while left != 0 {
            let count = (left as usize).min(scratch.len());
            f.read_exact(&mut scratch[..count])?;
            crc.update(&scratch[..count]);
            left -= count as u64;
        }
        let mut expected = [0; 4];
        f.read_exact(&mut expected)?;
        if crc.finalize() != u32::from_be_bytes(expected) {
            return Err(format!("CRC mismatch {kind}").into());
        }
        writeln!(chunk_list, "{index},{offset},{kind},{n},{}", n + 12)?;
        index += 1;
        let entry = chunks.entry(kind.clone()).or_default();
        entry.0 += 1;
        entry.1 += n;
        entry.2 += n + 12;
        if kind == "IEND" {
            if n != 0 || f.stream_position()? != total_bytes {
                return Err("Invalid IEND/trailing bytes".into());
            }
            break;
        }
    }
    let r = decoded_reader(path)?;
    let info = r.info();
    let row_bytes =
        (info.width as usize * info.color_type.samples() * info.bit_depth as usize).div_ceil(8);
    let mut z = flate2::read::ZlibDecoder::new(IdatReader::open(path)?);
    let mut counts = [0u64; 5];
    let mut raw = vec![0; row_bytes + 1];
    let mut filtered_hash = Sha256::new();
    for _ in 0..info.height {
        z.read_exact(&mut raw)?;
        if raw[0] > 4 {
            return Err("Invalid filter byte".into());
        }
        counts[raw[0] as usize] += 1;
        filtered_hash.update(&raw);
    }
    if z.read(&mut [0])? != 0 {
        return Err("Extra inflated bytes".into());
    }
    let filters: Vec<_> = ["None","Sub","Up","Average","Paeth"].iter().enumerate().map(|(i,name)| serde_json::json!({"filter":name,"rows":counts[i],"percent":counts[i] as f64*100.0/info.height as f64})).collect();
    let chunk_summary: Vec<_> = chunks.iter().map(|(kind,(count,payload,total))| serde_json::json!({"type":kind,"count":count,"payload_bytes":payload,"total_bytes":total})).collect();
    Ok(
        serde_json::json!({"path":path,"file_sha256":file_hash(path)?,"width":info.width,"height":info.height,
        "bit_depth": info.bit_depth as u8,"color_type":format!("{:?}",info.color_type),"color_type_number":info.color_type as u8,
        "interlace":info.interlaced,"phys":info.pixel_dims.map(|p|serde_json::json!({"x":p.xppu,"y":p.yppu,"unit":format!("{:?}",p.unit)})),
        "total_bytes":total_bytes,"idat_bytes":chunks.get("IDAT").map(|x|x.1),"chunks":chunk_summary,"filters":filters,
        "inflated_bytes":(row_bytes as u64+1)*info.height as u64,"filtered_sha256":format!("{:x}",filtered_hash.finalize())}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(
        path: &Path,
        color: png::ColorType,
        palette: Option<Vec<u8>>,
        pixels: &[u8],
        width: u32,
    ) {
        let mut e = png::Encoder::new(File::create(path).unwrap(), width, 1);
        e.set_color(color);
        e.set_depth(png::BitDepth::Eight);
        e.set_pixel_dims(Some(png::PixelDimensions {
            xppu: 11811,
            yppu: 11811,
            unit: png::Unit::Meter,
        }));
        if let Some(p) = palette {
            e.set_palette(p);
        }
        let mut w = e.write_header().unwrap();
        // Tiny IDAT chunks exercise headers/CRC crossing reader boundaries.
        let mut s = w.stream_writer_with_size(7).unwrap();
        s.write_all(pixels).unwrap();
        s.finish().unwrap();
        w.finish().unwrap();
    }
    #[test]
    fn compares_indexed_and_gray_to_rgb_and_checks_crc() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a.png");
        let b = d.path().join("b.png");
        fixture(
            &a,
            png::ColorType::Rgb,
            None,
            &[10, 10, 10, 200, 200, 200],
            2,
        );
        fixture(
            &b,
            png::ColorType::Indexed,
            Some(vec![10, 10, 10, 200, 200, 200]),
            &[0, 1],
            2,
        );
        assert_eq!(exact_rgb(&a, &b).unwrap()["unique_colors_capped_at_257"], 2);
        let info = inspect(&b, io::sink()).unwrap();
        assert_eq!(info["color_type_number"], 3);
        assert_eq!(info["inflated_bytes"], 3);
        fixture(&b, png::ColorType::Grayscale, None, &[10, 200], 2);
        assert!(exact_rgb(&a, &b).is_ok());
        fixture(&b, png::ColorType::Grayscale, None, &[10, 201], 2);
        assert!(exact_rgb(&a, &b).is_err());
        let mut bytes = std::fs::read(&b).unwrap();
        bytes[29] ^= 1;
        std::fs::write(&b, bytes).unwrap();
        assert!(inspect(&b, io::sink()).is_err());
    }
    #[test]
    fn caps_color_set_at_257() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.png");
        let bytes: Vec<u8> = (0..600u16)
            .flat_map(|v| [v as u8, (v >> 8) as u8, 9])
            .collect();
        fixture(&p, png::ColorType::Rgb, None, &bytes, 600);
        let result = exact_rgb(&p, &p).unwrap();
        assert_eq!(result["unique_colors_capped_at_257"], 257);
        assert_eq!(result["more_than_256"], true);
    }
    #[test]
    fn rejects_alpha_changes_instead_of_compositing() {
        assert!(rgb_row(&[1, 2, 3, 0], png::ColorType::Rgba, &mut Vec::new()).is_err());
        assert_eq!(
            bigrams(&[0; 6], &[255; 6], &mut [0; 7]),
            png::Filter::NoFilter
        );
    }
}
