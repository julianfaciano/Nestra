//! Experimental one-shot libdeflate over private file-backed Windows mappings.
//! This bounds explicit heap buffers, NOT physical RAM/working set/page cache.
#[cfg(not(all(windows, target_pointer_width = "64")))]
compile_error!("This isolated experiment requires Windows x64");
use libdeflater::{CompressionLvl, Compressor};
use nestra_png_compression_bench::{
    bigrams, decoded_reader, exact_rgb, file_hash, filter_rgb_row, inspect, Result, IO_BYTES,
};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{self, BufWriter, Write},
    marker::PhantomData,
    os::windows::{ffi::OsStrExt, io::AsRawHandle},
    path::Path,
    time::Instant,
};
use windows_sys::Win32::{
    Foundation::CloseHandle,
    Storage::FileSystem::GetDiskFreeSpaceExW,
    System::{
        Memory::*,
        ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
        Threading::GetCurrentProcess,
    },
};

struct Mapping<'a> {
    view: MEMORY_MAPPED_VIEW_ADDRESS,
    len: usize,
    writable: bool,
    _file: PhantomData<&'a File>,
}
impl<'a> Mapping<'a> {
    fn new(file: &'a File, writable: bool) -> Result<Self> {
        let len = usize::try_from(file.metadata()?.len())?;
        if len == 0 || len > isize::MAX as usize {
            return Err("Invalid mapping length".into());
        }
        // SAFETY: only fresh, private NamedTempFiles are mapped. The file stays
        // open and is never resized/modified while mapped. Not the original PNG.
        let handle = unsafe {
            CreateFileMappingW(
                file.as_raw_handle(),
                std::ptr::null(),
                if writable {
                    PAGE_READWRITE
                } else {
                    PAGE_READONLY
                },
                0,
                0,
                std::ptr::null(),
            )
        };
        if handle.is_null() {
            return Err(io::Error::last_os_error().into());
        }
        let view = unsafe {
            MapViewOfFile(
                handle,
                if writable {
                    FILE_MAP_WRITE
                } else {
                    FILE_MAP_READ
                },
                0,
                0,
                len,
            )
        };
        let error = io::Error::last_os_error();
        unsafe {
            CloseHandle(handle);
        } // The mapped view retains the section.
        if view.Value.is_null() {
            return Err(error.into());
        }
        Ok(Self {
            view,
            len,
            writable,
            _file: PhantomData,
        })
    }
    fn bytes(&self) -> &[u8] {
        // SAFETY: mapping is valid for len initialized file bytes; borrow cannot outlive view.
        unsafe { std::slice::from_raw_parts(self.view.Value.cast(), self.len) }
    }
    fn bytes_mut(&mut self) -> &mut [u8] {
        assert!(self.writable);
        // SAFETY: exclusively borrowed writable mapping, no other view of this file.
        unsafe { std::slice::from_raw_parts_mut(self.view.Value.cast(), self.len) }
    }
    fn flush(&self, bytes: usize) -> Result<()> {
        if bytes > self.len {
            return Err("Flush outside view".into());
        }
        if unsafe { FlushViewOfFile(self.view.Value, bytes) } == 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(())
    }
}
impl Drop for Mapping<'_> {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(self.view);
        }
    }
}

fn memory() -> Result<serde_json::Value> {
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of_val(&counters) as u32;
    counters.cb = size;
    if unsafe { GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, size) } == 0 {
        return Err(io::Error::last_os_error().into());
    }
    Ok(
        serde_json::json!({"working_set_bytes":counters.WorkingSetSize,"peak_working_set_bytes":counters.PeakWorkingSetSize,"page_fault_count":counters.PageFaultCount,"private_commit_bytes":counters.PagefileUsage,"peak_private_commit_bytes":counters.PeakPagefileUsage}),
    )
}
fn free_disk() -> Result<u64> {
    let path: Vec<u16> = std::env::temp_dir()
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut available = 0u64;
    if unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(io::Error::last_os_error().into());
    }
    Ok(available)
}
fn chunk(w: &mut impl Write, kind: &[u8; 4], data: &[u8]) -> Result<()> {
    let size = u32::try_from(data.len())?;
    if size > i32::MAX as u32 {
        return Err("PNG chunk exceeds 2^31-1".into());
    }
    w.write_all(&size.to_be_bytes())?;
    w.write_all(kind)?;
    w.write_all(data)?;
    let mut crc = crc32fast::Hasher::new();
    crc.update(kind);
    crc.update(data);
    w.write_all(&crc.finalize().to_be_bytes())?;
    Ok(())
}

fn run(input: &Path, expected_filtered_hash: Option<&str>) -> Result<serde_json::Value> {
    let before = file_hash(input)?;
    let input_bytes = std::fs::metadata(input)?.len();
    // Reject other metadata rather than silently stripping it in this narrowly scoped experiment.
    let structure = inspect(input, io::sink())?;
    for c in structure["chunks"].as_array().ok_or("Missing chunk list")? {
        if !matches!(c["type"].as_str(), Some("IHDR" | "pHYs" | "IDAT" | "IEND")) {
            return Err("Only IHDR/pHYs/IDAT/IEND supported by this experiment".into());
        }
    }
    let mut r = decoded_reader(input)?;
    let (width, height) = (r.info().width, r.info().height);
    if r.info().color_type != png::ColorType::Rgb || r.info().bit_depth != png::BitDepth::Eight {
        return Err("RGB8 required".into());
    }
    match r.info().pixel_dims {
        Some(p) if p.xppu == 11811 && p.yppu == 11811 && p.unit == png::Unit::Meter => (),
        _ => return Err("300 PPI required".into()),
    }
    let row_bytes = width as usize * 3;
    let raw_len = (row_bytes + 1)
        .checked_mul(height as usize)
        .ok_or("Size overflow")?;
    let mut compressor =
        Compressor::new(CompressionLvl::new(10).map_err(|_| "Invalid libdeflate level")?);
    let bound = compressor.zlib_compress_bound(raw_len);
    if bound < raw_len || bound > isize::MAX as usize {
        return Err("Invalid compression bound".into());
    }
    let disk_required = (raw_len as u64)
        .checked_add(2 * bound as u64 + 64 * 1024 * 1024)
        .ok_or("Disk size overflow")?;
    let disk_available = free_disk()?;
    if disk_available < disk_required {
        return Err(format!(
            "Need {disk_required} free temporary disk bytes; available {disk_available}"
        )
        .into());
    }
    let memory_before = memory()?;
    let start = Instant::now();
    let filtered = tempfile::NamedTempFile::new()?;
    let compressed = tempfile::NamedTempFile::new()?;
    let candidate = tempfile::NamedTempFile::new()?;
    let mut previous = vec![0; row_bytes];
    let mut scratch = vec![0; row_bytes + 1];
    let mut filtered_hash = Sha256::new();
    eprintln!("Filtering RGB rows to disk ({} bytes)", raw_len);
    {
        let mut writer = BufWriter::with_capacity(IO_BYTES, filtered.as_file());
        for _ in 0..height {
            let row = r.next_row()?.ok_or("Missing row")?;
            let kind = match bigrams(row.data(), &previous, &mut scratch) {
                png::Filter::NoFilter => 0,
                png::Filter::Sub => 1,
                png::Filter::Up => 2,
                png::Filter::Avg => 3,
                png::Filter::Paeth => 4,
                _ => unreachable!(),
            };
            filter_rgb_row(row.data(), &previous, kind, &mut scratch);
            filtered_hash.update(&scratch);
            writer.write_all(&scratch)?;
            previous.copy_from_slice(row.data());
        }
        if r.next_row()?.is_some() {
            return Err("Extra rows".into());
        }
        r.finish()?;
        writer.flush()?;
    }
    drop(r);
    drop(previous);
    drop(scratch);
    filtered.as_file().sync_all()?;
    let hash = format!("{:x}", filtered_hash.finalize());
    if expected_filtered_hash.is_some_and(|expected| expected != hash) {
        return Err("Filtered stream differs from verified Oxipng stream".into());
    }
    let filter_s = start.elapsed().as_secs_f64();
    compressed.as_file().set_len(bound as u64)?;
    let source = Mapping::new(filtered.as_file(), false)?;
    let mut dest = Mapping::new(compressed.as_file(), true)?;
    eprintln!(
        "libdeflate level 10: mapped input={}, output_capacity={}",
        raw_len, bound
    );
    let deflate_start = Instant::now();
    let compressed_len = compressor.zlib_compress(source.bytes(), dest.bytes_mut())?;
    let deflate_s = deflate_start.elapsed().as_secs_f64();
    let memory_after_deflate = memory()?;
    dest.flush(compressed_len)?;
    compressed.as_file().sync_all()?;
    drop(source);
    let assembly_start = Instant::now();
    {
        let mut w = BufWriter::with_capacity(IO_BYTES, candidate.as_file());
        w.write_all(b"\x89PNG\r\n\x1a\n")?;
        let mut ihdr = Vec::with_capacity(13);
        ihdr.extend(width.to_be_bytes());
        ihdr.extend(height.to_be_bytes());
        ihdr.extend([8, 2, 0, 0, 0]);
        chunk(&mut w, b"IHDR", &ihdr)?;
        let mut phys = Vec::with_capacity(9);
        phys.extend(11811u32.to_be_bytes());
        phys.extend(11811u32.to_be_bytes());
        phys.push(1);
        chunk(&mut w, b"pHYs", &phys)?;
        // Chunk framing stays bounded; do not require a single >2GiB IDAT.
        for part in dest.bytes()[..compressed_len].chunks(1024 * 1024) {
            chunk(&mut w, b"IDAT", part)?;
        }
        chunk(&mut w, b"IEND", &[])?;
        w.flush()?;
    }
    candidate.as_file().sync_all()?;
    let assembly_s = assembly_start.elapsed().as_secs_f64();
    drop(dest);
    let candidate_bytes = candidate.as_file().metadata()?.len();
    let recompress_s = start.elapsed().as_secs_f64();
    eprintln!("Verifying candidate RGB rows and pHYs");
    let verify_start = Instant::now();
    let pixels = exact_rgb(input, candidate.path())?;
    let candidate_structure = inspect(candidate.path(), io::sink())?;
    if candidate_structure["color_type_number"] != 2
        || candidate_structure["bit_depth"] != 8
        || candidate_structure["filtered_sha256"] != hash
    {
        return Err("Candidate format/filtered stream mismatch".into());
    }
    if file_hash(input)? != before {
        return Err("Original changed".into());
    }
    let verify_s = verify_start.elapsed().as_secs_f64();
    let final_memory = memory()?;
    // close() reports cleanup failures, after all mappings and handles are released.
    filtered.close()?;
    compressed.close()?;
    candidate.close()?;
    let total_s = start.elapsed().as_secs_f64();
    Ok(
        serde_json::json!({"backend":"libdeflate 1.26.0","level":10,"filter":"Bigrams","width":width,"height":height,
        "bytes":candidate_bytes,"MiB":candidate_bytes as f64/1048576.0,"reduction_pct":100.0*(1.0-candidate_bytes as f64/input_bytes as f64),"idat_bytes":compressed_len,
        "filter_and_spool_s":filter_s,"deflate_only_s":deflate_s,"png_assembly_s":assembly_s,"recompress_s":recompress_s,"verify_s":verify_s,"total_with_validation_and_cleanup_s":total_s,
        "filtered_temp_bytes":raw_len,"output_temp_capacity_bytes":bound,"candidate_temp_bytes":candidate_bytes,"peak_temp_logical_bytes":(raw_len+bound) as u64+candidate_bytes,"mapped_address_space_bytes":raw_len+bound,
        "explicit_row_and_file_buffers_bytes":2*row_bytes+1+8192+2*IO_BYTES,"disk_preflight_required_bytes":disk_required,"disk_available_bytes":disk_available,
        "memory_before":memory_before,"memory_after_deflate":memory_after_deflate,"memory_final":final_memory,"physical_ram_capped":false,
        "filtered_sha256":hash,"original_unchanged_sha256":before,"pixels":pixels,"temporaries_deleted":true}),
    )
}
fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        return Err("Usage: png_libdeflate_disk ORIGINAL NEW_REPORT.json".into());
    }
    // Reserve a new report path before any expensive work; never clobber anything.
    let mut report = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&args[1])?;
    let result = run(
        Path::new(&args[0]),
        Some("8db3db95a9d72a88d05439d3f5665bcfdd6ec6009fa37355963bd62eb1917f8a"),
    )?;
    let json = serde_json::to_string_pretty(&result)?;
    report.write_all(json.as_bytes())?;
    report.sync_all()?;
    println!("{json}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mapped_roundtrip_preserves_rgb_and_cleans_up() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("tiny.png");
        let mut e = png::Encoder::new(File::create(&p).unwrap(), 17, 5);
        e.set_color(png::ColorType::Rgb);
        e.set_depth(png::BitDepth::Eight);
        e.set_pixel_dims(Some(png::PixelDimensions {
            xppu: 11811,
            yppu: 11811,
            unit: png::Unit::Meter,
        }));
        let mut w = e.write_header().unwrap();
        w.write_image_data(&(0..255).map(|i| i as u8).collect::<Vec<_>>())
            .unwrap();
        w.finish().unwrap();
        let result = run(&p, None).unwrap();
        assert_eq!(result["pixels"]["byte_identical"], true);
        assert_eq!(result["temporaries_deleted"], true);
    }
    #[test]
    fn bound_handles_calandra_above_signed_32_bit() {
        let n = (17480usize * 3 + 1) * 59055;
        assert!(n > i32::MAX as usize);
        let bound = Compressor::new(CompressionLvl::new(10).unwrap()).zlib_compress_bound(n);
        assert!(bound >= n && bound < n + n / 100);
    }
}
