//! Single-page composition prototype. Source rasters only; never a page bitmap.
use crate::native_png::{NativePiece, NativePlan};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs::File,
    io::{BufReader, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Instant,
};
use tauri::{
    ipc::{InvokeBody, Request},
    State,
};

struct Job {
    id: String,
    folder: PathBuf,
    dir: tempfile::TempDir,
    sources: BTreeMap<u32, PathBuf>,
    bytes: usize,
}
#[derive(Default)]
pub struct PdfPrototype(Mutex<Option<Job>>);
static SEQUENCE: AtomicU64 = AtomicU64::new(1);
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
const PT: f64 = 72.0 / 300.0;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    path: String,
    page_pt: [f64; 2],
    page_cm: [f64; 2],
    placements: usize,
    unique_sources: usize,
    image_xobjects: usize,
    soft_masks: usize,
    output_bytes: usize,
    total_ms: f64,
}

pub fn clear(state: &PdfPrototype) {
    if let Ok(mut job) = state.0.lock() {
        *job = None;
    }
}

#[tauri::command]
pub async fn begin_pdf_prototype(
    _name: String,
    window: tauri::WebviewWindow,
    state: State<'_, PdfPrototype>,
) -> Result<Option<String>, String> {
    let parent = window.clone();

    let path = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("Export As")
            .set_parent(&parent)
            .pick_folder()
    })
    .await
    .map_err(err)?;

    let Some(folder) = path else {
        return Ok(None);
    };

    if !folder.is_dir() {
        return Err("Carpeta PDF inválida".into());
    }

    let mut job = state.0.lock().map_err(err)?;

    if job.is_some() {
        return Err("Ya hay un PDF en preparación".into());
    }

    let id = SEQUENCE.fetch_add(1, Ordering::Relaxed).to_string();

    *job = Some(Job {
        id: id.clone(),
        folder,
        dir: tempfile::tempdir().map_err(err)?,
        sources: BTreeMap::new(),
        bytes: 0,
    });

    Ok(Some(id))
}
#[tauri::command]
pub fn close_pdf_prototype(id: String, state: State<'_, PdfPrototype>) -> Result<(), String> {
    let mut job = state.0.lock().map_err(err)?;
    if job.as_ref().is_some_and(|j| j.id == id) {
        *job = None;
    }
    Ok(())
}
#[tauri::command]
pub fn upload_pdf_source(
    request: Request<'_>,
    state: State<'_, PdfPrototype>,
) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-nestra-session")
        .and_then(|v| v.to_str().ok())
        .ok_or("Falta sesión PDF")?;
    let source: u32 = request
        .headers()
        .get("x-nestra-source")
        .and_then(|v| v.to_str().ok())
        .ok_or("Falta fuente")?
        .parse()
        .map_err(err)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se requiere PNG binario".into());
    };
    if bytes.is_empty() || bytes.len() > 64 * 1024 * 1024 {
        return Err("Fuente PNG fuera del límite de 64 MiB".into());
    }
    let mut state = state.0.lock().map_err(err)?;
    let job = state
        .as_mut()
        .filter(|j| j.id == id)
        .ok_or("Sesión PDF inválida")?;
    if job.sources.contains_key(&source) || job.bytes + bytes.len() > 512 * 1024 * 1024 {
        return Err("Fuente duplicada o prototipo excede 512 MiB de fuentes".into());
    }
    let path = job.dir.path().join(format!("{source}.png"));
    std::fs::write(&path, bytes).map_err(err)?;
    job.bytes += bytes.len();
    job.sources.insert(source, path);
    Ok(())
}
#[tauri::command]
pub async fn finish_pdf_prototype(
    id: String,
    plan: NativePlan,
    state: State<'_, PdfPrototype>,
) -> Result<Diagnostics, String> {
    let (folder, sources) = {
        let state = state.0.lock().map_err(err)?;
        let job = state
            .as_ref()
            .filter(|j| j.id == id)
            .ok_or("Sesión PDF inválida")?;
        (job.folder.clone(), job.sources.clone())
    };
    tauri::async_runtime::spawn_blocking(move || {
        let destination = available_pdf_destination(&folder, &plan.name)?;
        generate(&plan, &sources, &destination)
    })
    .await
    .map_err(err)?
}
fn available_pdf_destination(folder: &Path, png_name: &str) -> Result<PathBuf, String> {
    let stem = png_name
        .strip_suffix(".png")
        .or_else(|| png_name.strip_suffix(".PNG"))
        .ok_or("Nombre de layout inválido")?;
    for i in 0..26u8 {
        let suffix = if i == 0 {
            String::new()
        } else {
            format!("_{}", (b'a' + i) as char)
        };
        let path = folder.join(format!("{stem}{suffix}.pdf"));
        if !path.exists() {
            return Ok(path);
        }
    }
    Err("Demasiadas colisiones de nombres PDF".into())
}
/*
    Old implementation intentionally replaced: one session now emits one
    independently named PDF per layout while retaining uploaded sources.
*/

// Image coordinates (u,v) have v=1 at the top. Rotate the existing top-left
// coordinate system first, then invert page Y. No raster rotation/resampling.
fn matrix(p: &NativePiece, plan: &NativePlan) -> Result<[f32; 6], String> {
    let (c, s) = match p.rotation {
        0 => (1., 0.),
        90 => (0., 1.),
        -90 => (0., -1.),
        180 => (-1., 0.),
        _ => return Err("Rotación inválida".into()),
    };
    if ![
        p.width,
        p.height,
        p.translate_x,
        p.translate_y,
        plan.offset_x,
        plan.offset_y,
    ]
    .iter()
    .all(|v| v.is_finite())
        || p.width <= 0.
        || p.height <= 0.
    {
        return Err("Geometría inválida".into());
    }
    let tx = p.translate_x - plan.offset_x;
    let ty = p.translate_y - plan.offset_y;
    for (x, y) in [(0., 0.), (p.width, 0.), (0., p.height), (p.width, p.height)] {
        let px = tx + c * x - s * y;
        let py = ty + s * x + c * y;
        // The PNG plan rounds page extents to the nearest 300-PPI pixel.
        if px < -0.51
            || py < -0.51
            || px > plan.width as f64 + 0.51
            || py > plan.height as f64 + 0.51
        {
            return Err("Arte fuera de la página PDF".into());
        }
    }
    Ok([
        c * p.width * PT,
        -s * p.width * PT,
        s * p.height * PT,
        c * p.height * PT,
        (tx - s * p.height) * PT,
        (plan.height as f64 - ty - c * p.height) * PT,
    ]
    .map(|v| v as f32))
}
fn deflate(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    z.write_all(bytes).map_err(err)?;
    z.finish().map_err(err)
}
fn source(path: &Path) -> Result<(u32, u32, Vec<u8>, Option<Vec<u8>>), String> {
    let mut d = png::Decoder::new(BufReader::new(File::open(path).map_err(err)?));
    // A 64 MP RGBA source needs up to 256 MB for its decoded frame.
    d.set_limits(png::Limits { bytes: 256_000_000 });
    d.set_transformations(png::Transformations::EXPAND);
    let mut r = d.read_info().map_err(err)?;
    let (w, h) = (r.info().width, r.info().height);
    if w as u64 * h as u64 > 64_000_000
        || r.info().bit_depth == png::BitDepth::Sixteen
        || r.info().animation_control.is_some()
    {
        return Err("Prototipo: PNG estático de hasta 8 bits y 64 MP por fuente".into());
    }
    let mut raw = vec![0; r.output_buffer_size().ok_or("Fuente demasiado grande")?];
    let frame = r.next_frame(&mut raw).map_err(err)?;
    let mut rgb = Vec::with_capacity(w as usize * h as usize * 3);
    let mut alpha = Vec::new();
    match frame.color_type {
        png::ColorType::Rgb => rgb.extend_from_slice(&raw),
        png::ColorType::Rgba => {
            for p in raw.chunks_exact(4) {
                rgb.extend_from_slice(&p[..3]);
                alpha.push(p[3]);
            }
        }
        png::ColorType::Grayscale => {
            for &v in &raw {
                rgb.extend_from_slice(&[v; 3]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for p in raw.chunks_exact(2) {
                rgb.extend_from_slice(&[p[0]; 3]);
                alpha.push(p[1]);
            }
        }
        _ => return Err("PNG no expandido".into()),
    }
    png::Reader::finish(&mut r).map_err(err)?;
    Ok((
        w,
        h,
        deflate(&rgb)?,
        if alpha.iter().any(|&a| a != 255) {
            Some(deflate(&alpha)?)
        } else {
            None
        },
    ))
}
fn generate(
    plan: &NativePlan,
    sources: &BTreeMap<u32, PathBuf>,
    destination: &Path,
) -> Result<Diagnostics, String> {
    let start = Instant::now();
    if destination.exists() {
        return Err("Ya existe ese archivo".into());
    }
    if plan.width == 0
        || plan.height == 0
        || plan.width > 17480
        || plan.height > 59055
        || plan.pieces.is_empty()
        || plan.pieces.len() > 100_000
    {
        return Err("Página PDF inválida".into());
    }
    let page_pt = [plan.width as f64 * PT, plan.height as f64 * PT];
    let mut pdf = Pdf::new();
    pdf.set_version(1, 4);
    pdf.catalog(Ref::new(1)).pages(Ref::new(2));
    pdf.pages(Ref::new(2)).kids([Ref::new(3)]).count(1);
    let mut refs = BTreeMap::new();
    let mut masks = 0;
    let mut decoded_total = 0u64;
    for p in &plan.pieces {
        if refs.contains_key(&p.source) {
            continue;
        }
        let path = sources.get(&p.source).ok_or("Falta fuente PDF")?;
        let (w, h, rgb, alpha) = source(path)?;
        decoded_total += w as u64 * h as u64 * 4;
        if decoded_total > 512 * 1024 * 1024 {
            return Err("Prototipo limitado a 512 MiB de fuentes decodificadas únicas".into());
        }
        let id = Ref::new(5 + refs.len() as i32 * 2);
        let mask = Ref::new(id.get() + 1);
        let mut image = pdf.image_xobject(id, &rgb);
        image
            .width(w as i32)
            .height(h as i32)
            .bits_per_component(8)
            .filter(Filter::FlateDecode);
        image.color_space().device_rgb();
        if alpha.is_some() {
            image.s_mask(mask);
        }
        image.finish();
        if let Some(alpha) = alpha {
            let mut image = pdf.image_xobject(mask, &alpha);
            image
                .width(w as i32)
                .height(h as i32)
                .bits_per_component(8)
                .filter(Filter::FlateDecode);
            image.color_space().device_gray();
            masks += 1;
        }
        refs.insert(p.source, (id, format!("Im{}", p.source)));
    }
    let mut page = pdf.page(Ref::new(3));
    page.parent(Ref::new(2))
        .media_box(Rect::new(0., 0., page_pt[0] as f32, page_pt[1] as f32))
        .contents(Ref::new(4));
    {
        let mut resources = page.resources();
        let mut images = resources.x_objects();
        for (id, name) in refs.values() {
            images.pair(Name(name.as_bytes()), *id);
        }
    }
    page.finish();
    let mut content = Content::new();
    content
        .set_fill_rgb(1., 1., 1.)
        .rect(0., 0., page_pt[0] as f32, page_pt[1] as f32)
        .fill_nonzero();
    for p in &plan.pieces {
        content
            .save_state()
            .transform(matrix(p, plan)?)
            .x_object(Name(refs[&p.source].1.as_bytes()))
            .restore_state();
    }
    pdf.stream(Ref::new(4), &content.finish());
    let bytes = pdf.finish();
    let mut temp = tempfile::NamedTempFile::new_in(destination.parent().unwrap()).map_err(err)?;
    temp.write_all(&bytes).map_err(err)?;
    temp.as_file().sync_all().map_err(err)?;
    temp.persist_noclobber(destination).map_err(err)?;
    Ok(Diagnostics {
        path: destination.to_string_lossy().into(),
        page_pt,
        page_cm: page_pt.map(|v| v * 2.54 / 72.),
        placements: plan.pieces.len(),
        unique_sources: refs.len(),
        image_xobjects: refs.len(),
        soft_masks: masks,
        output_bytes: bytes.len(),
        total_ms: start.elapsed().as_secs_f64() * 1000.,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan() -> NativePlan {
        NativePlan {
            name: "test.png".into(),
            width: 300,
            height: 600,
            offset_x: 10.,
            offset_y: 20.,
            pieces: vec![],
        }
    }
    fn piece(rotation: i32) -> NativePiece {
        NativePiece {
            source: 0,
            translate_x: 110.,
            translate_y: 120.,
            width: 40.,
            height: 20.,
            rotation,
        }
    }
    #[test]
    fn physical_size_and_all_rotation_corners() {
        assert_eq!(300. * PT, 72.);
        assert!((25.4 * 300. / 25.4 * PT - 72.).abs() < 1e-10);
        assert!(5000. * 72. / 25.4 < 14400.);
        for rotation in [0, 90, -90, 180] {
            let p = piece(rotation);
            let plan = plan();
            let m = matrix(&p, &plan).unwrap();
            let rad = (rotation as f64).to_radians();
            for (u, v) in [(0., 1.), (1., 1.), (0., 0.), (1., 0.)] {
                let x = u * p.width;
                let y = (1. - v) * p.height;
                let want_x = (100. + rad.cos() * x - rad.sin() * y) * PT;
                let want_y = (600. - 100. - rad.sin() * x - rad.cos() * y) * PT;
                assert!((m[0] as f64 * u + m[2] as f64 * v + m[4] as f64 - want_x).abs() < 0.0001);
                assert!((m[1] as f64 * u + m[3] as f64 * v + m[5] as f64 - want_y).abs() < 0.0001);
            }
        }
    }
    #[test]
    fn reusable_source_soft_mask_media_box_and_no_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("source.png");
        let mut e = png::Encoder::new(File::create(&path).unwrap(), 2, 1);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        let mut w = e.write_header().unwrap();
        w.write_image_data(&[255, 0, 0, 128, 0, 255, 0, 0]).unwrap();
        w.finish().unwrap();
        let (_, _, rgb, alpha) = source(&path).unwrap();
        use std::io::Read;
        let mut decoded = Vec::new();
        flate2::read::ZlibDecoder::new(rgb.as_slice())
            .read_to_end(&mut decoded)
            .unwrap();
        assert_eq!(decoded, [255, 0, 0, 0, 255, 0]);
        decoded.clear();
        flate2::read::ZlibDecoder::new(alpha.unwrap().as_slice())
            .read_to_end(&mut decoded)
            .unwrap();
        assert_eq!(decoded, [128, 0]);
        let mut p = plan();
        p.pieces = [0, 90, -90, 180].into_iter().map(piece).collect();
        let dest = dir.path().join("test.pdf");
        let sources = BTreeMap::from([(0, path)]);
        let d = generate(&p, &sources, &dest).unwrap();
        assert_eq!(d.page_pt, [72., 144.]);
        assert_eq!(
            (
                d.placements,
                d.unique_sources,
                d.image_xobjects,
                d.soft_masks
            ),
            (4, 1, 1, 1)
        );
        let bytes = std::fs::read(&dest).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(bytes.starts_with(b"%PDF-1.4"));
        assert!(text.trim_end().ends_with("%%EOF"));
        assert!(text.contains("/MediaBox [0 0 72 144]"));
        assert_eq!(text.matches("/Subtype /Image").count(), 2);
        assert_eq!(text.matches("/Width 2").count(), 2);
        assert!(!text.contains("/Width 300"));
        assert_eq!(text.matches("/Im0 Do").count(), 4);
        assert!(text.contains("/SMask"));
        assert!(generate(&p, &sources, &dest).is_err());
        assert_eq!(std::fs::read(dest).unwrap(), bytes);
    }
}
