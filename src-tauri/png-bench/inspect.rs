use nestra_png_compression_bench::{exact_rgb, file_hash, inspect, Result};
use std::{
    fs::{self, File},
    io::BufWriter,
    path::Path,
};
fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 3 {
        return Err("Usage: png_forensics ORIGINAL COMPARISON NEW_REPORT_DIR".into());
    }
    let a = Path::new(&args[0]);
    let b = Path::new(&args[1]);
    let dir = Path::new(&args[2]);
    fs::create_dir(dir)?; // No existing report or input can be overwritten.
    let original = inspect(
        a,
        BufWriter::new(File::create(dir.join("original-chunks.csv"))?),
    )?;
    let comparison = inspect(
        b,
        BufWriter::new(File::create(dir.join("comparison-chunks.csv"))?),
    )?;
    let pixels = exact_rgb(a, b)?;
    if file_hash(a)? != original["file_sha256"].as_str().unwrap()
        || file_hash(b)? != comparison["file_sha256"].as_str().unwrap()
    {
        return Err("Input changed during inspection".into());
    }
    let report = serde_json::json!({"original":original,"comparison":comparison,"pixels":pixels,"inputs_unchanged":true});
    let json = serde_json::to_string_pretty(&report)?;
    fs::write(dir.join("report.json"), &json)?;
    println!("{json}");
    Ok(())
}
