//! Single-page composition prototype. Source rasters only; never a page bitmap.
use crate::native_png::{NativePiece, NativePlan, NativeSizeMarkPlacement};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs::File,
    io::{BufReader, Read, Write},
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
    page_size_pt(plan)?;
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
        if plan.page_height_mm.is_some() {
            coord_y(plan, ty + c * p.height)
        } else {
            (plan.height as f64 - ty - c * p.height) * PT
        },
    ]
    .map(|v| v as f32))
}

fn page_size_pt(plan: &NativePlan) -> Result<[f64; 2], String> {
    let mut points = [plan.width as f64 * PT, plan.height as f64 * PT];
    for (index, (mm, pixels)) in [
        (plan.page_width_mm, plan.width),
        (plan.page_height_mm, plan.height),
    ]
    .into_iter()
    .enumerate()
    {
        if let Some(mm) = mm {
            let physical_pixels = mm * 300. / 25.4;
            if !mm.is_finite()
                || mm <= 0.
                || !physical_pixels.is_finite()
                || (physical_pixels - pixels as f64).abs() > 1.
            {
                return Err(
                    "Dimensiones físicas PDF inválidas o inconsistentes con el raster".into(),
                );
            }
            points[index] = mm * 72. / 25.4;
        }
    }
    Ok(points)
}

fn coord_y(plan: &NativePlan, y: f64) -> f64 {
    match plan.page_height_mm {
        Some(mm) => mm * 72. / 25.4 - y * PT,
        None => (plan.height as f64 - y) * PT,
    }
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

fn marker_source(
    path: &Path,
    marker: &NativeSizeMarkPlacement,
    width: u32,
    height: u32,
    mask: &[u8],
) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
    let (source_width, source_height, _compressed_rgb, compressed_alpha) = source(path)?;
    if marker.x + width > source_width
        || marker.y + height > source_height
        || mask.len() != width as usize * height as usize
    {
        return Err("Metadata de recorte del marcador fuera de la fuente PDF".into());
    }
    let alpha = if let Some(compressed) = compressed_alpha {
        let mut decoded = Vec::new();
        flate2::read::ZlibDecoder::new(&compressed[..])
            .read_to_end(&mut decoded)
            .map_err(err)?;
        decoded
    } else {
        vec![255; source_width as usize * source_height as usize]
    };
    let mut mark_rgb = vec![0; width as usize * height as usize * 3];
    let mut mark_alpha = vec![0; width as usize * height as usize];
    for y in 0..height as usize {
        for x in 0..width as usize {
            let index = y * width as usize + x;
            if mask[index] == 0 {
                continue;
            }
            let source_index =
                (marker.y as usize + y) * source_width as usize + marker.x as usize + x;
            let a = alpha[source_index];
            if a <= 16 {
                return Err(format!(
                    "El marcador PDF sale del alpha de corte >16 (fuente {}, píxel {},{}).",
                    marker.source,
                    marker.x + x as u32,
                    marker.y + y as u32,
                ));
            }
            // PDF artwork sources are intentionally cleaned before upload. Match the
            // PNG renderer: restore lime from the validated glyph mask and preserved alpha.
            mark_rgb[index * 3..index * 3 + 3].copy_from_slice(&[138, 255, 0]);
            mark_alpha[index] = a;
        }
    }
    Ok((
        deflate(&mark_rgb)?,
        if mark_alpha.iter().any(|&a| a != 255) {
            Some(deflate(&mark_alpha)?)
        } else {
            None
        },
    ))
}

fn marker_piece(
    piece: &NativePiece,
    source_width: u32,
    source_height: u32,
    marker: &NativeSizeMarkPlacement,
    mark_width: u32,
    mark_height: u32,
    source: u32,
) -> NativePiece {
    let sx = piece.width / source_width as f64;
    let sy = piece.height / source_height as f64;
    let (translate_x, translate_y) = match piece.rotation {
        90 => (
            piece.translate_x - marker.y as f64 * sy,
            piece.translate_y + marker.x as f64 * sx,
        ),
        -90 => (
            piece.translate_x + marker.y as f64 * sy,
            piece.translate_y - marker.x as f64 * sx,
        ),
        180 => (
            piece.translate_x - marker.x as f64 * sx,
            piece.translate_y - marker.y as f64 * sy,
        ),
        _ => (
            piece.translate_x + marker.x as f64 * sx,
            piece.translate_y + marker.y as f64 * sy,
        ),
    };
    NativePiece {
        source,
        translate_x,
        translate_y,
        width: mark_width as f64 * sx,
        height: mark_height as f64 * sy,
        rotation: piece.rotation,
    }
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
        || plan.width > 18425
        || plan.height > 59055
        || plan.pieces.is_empty()
        || plan.pieces.len() > 100_000
    {
        return Err("Página PDF inválida".into());
    }
    plan.validate_outline()?;
    let page_pt = page_size_pt(plan)?;
    let mut pdf = Pdf::new();
    pdf.set_version(1, 4);
    pdf.catalog(Ref::new(1)).pages(Ref::new(2));
    pdf.pages(Ref::new(2)).kids([Ref::new(3)]).count(1);
    let mut refs = BTreeMap::new();
    let mut source_dimensions = BTreeMap::new();
    let mut masks = 0;
    let mut decoded_total = 0u64;
    for p in &plan.pieces {
        if refs.contains_key(&p.source) {
            continue;
        }
        let path = sources.get(&p.source).ok_or("Falta fuente PDF")?;
        let (w, h, rgb, alpha) = source(path)?;
        source_dimensions.insert(p.source, (w, h));
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
    if plan.size_marks.is_empty() != plan.size_mark_masks.is_empty()
        || (!plan.size_marks.is_empty() && plan.laser_outline.is_none())
    {
        return Err("Plan de marcadores PDF inválido".into());
    }
    let mut marker_refs = BTreeMap::new();
    let mut next_ref = 5 + refs.len() as i32 * 2;
    for marker in &plan.size_marks {
        let piece = plan
            .pieces
            .get(marker.piece_index)
            .ok_or("Pieza de marcador PDF inexistente")?;
        let mark_mask = plan
            .size_mark_masks
            .get(marker.mask_index)
            .ok_or("Máscara de marcador PDF inexistente")?;
        let outline = plan
            .laser_outline
            .as_ref()
            .ok_or("Falta el contorno para clippear el marcador PDF")?;
        let (source_width, source_height) = *source_dimensions
            .get(&marker.source)
            .ok_or("Falta la fuente del marcador PDF")?;
        if piece.source != marker.source
            || mark_mask.height != 18
            || mark_mask.width == 0
            || mark_mask.width > 64
            || mark_mask.data.len() != mark_mask.width as usize * mark_mask.height as usize
            || mark_mask.data.iter().any(|&v| v != 0 && v != 255)
            || marker.x + mark_mask.width > source_width
            || marker.y + mark_mask.height > source_height
            || marker.contour_indices.is_empty()
            || marker
                .contour_indices
                .iter()
                .any(|&i| i >= outline.contours.len())
        {
            return Err("Geometría raster/contorno de marcador PDF inválida".into());
        }
        let key = (marker.source, marker.x, marker.y, marker.mask_index);
        if marker_refs.contains_key(&key) {
            continue;
        }
        let path = sources
            .get(&marker.source)
            .ok_or("Falta fuente del marcador PDF")?;
        let (rgb, alpha) = marker_source(
            path,
            marker,
            mark_mask.width,
            mark_mask.height,
            &mark_mask.data,
        )?;
        let id = Ref::new(next_ref);
        let alpha_ref = Ref::new(next_ref + 1);
        next_ref += 2;
        let mut image = pdf.image_xobject(id, &rgb);
        image
            .width(mark_mask.width as i32)
            .height(mark_mask.height as i32)
            .bits_per_component(8)
            .filter(Filter::FlateDecode);
        image.color_space().device_rgb();
        if alpha.is_some() {
            image.s_mask(alpha_ref);
        }
        image.finish();
        if let Some(alpha) = alpha {
            let mut image = pdf.image_xobject(alpha_ref, &alpha);
            image
                .width(mark_mask.width as i32)
                .height(mark_mask.height as i32)
                .bits_per_component(8)
                .filter(Filter::FlateDecode);
            image.color_space().device_gray();
            masks += 1;
        }
        marker_refs.insert(
            key,
            (
                id,
                format!(
                    "Mk{}_{}_{}_{}",
                    marker.source, marker.x, marker.y, marker.mask_index
                ),
            ),
        );
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
        for (id, name) in marker_refs.values() {
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
    if let Some(outline) = &plan.laser_outline {
        content
            .save_state()
            .set_stroke_rgb(0., 0., 0.)
            .set_line_width((outline.width * PT) as f32)
            .set_line_join(pdf_writer::types::LineJoinStyle::RoundJoin)
            .set_line_cap(pdf_writer::types::LineCapStyle::RoundCap);
        for contour in &outline.contours {
            content.move_to(
                (contour[0][0] * PT) as f32,
                coord_y(plan, contour[0][1]) as f32,
            );
            for point in &contour[1..] {
                content.line_to((point[0] * PT) as f32, coord_y(plan, point[1]) as f32);
            }
            content.close_path().stroke();
        }
        content.restore_state();
    }
    for marker in &plan.size_marks {
        let piece = &plan.pieces[marker.piece_index];
        let mark_mask = &plan.size_mark_masks[marker.mask_index];
        let (source_width, source_height) = source_dimensions[&marker.source];
        let key = (marker.source, marker.x, marker.y, marker.mask_index);
        let (id, name) = &marker_refs[&key];
        let mark_piece = marker_piece(
            piece,
            source_width,
            source_height,
            marker,
            mark_mask.width,
            mark_mask.height,
            id.get() as u32,
        );
        content.save_state();
        let outline = plan
            .laser_outline
            .as_ref()
            .ok_or("Falta el contorno del marcador PDF")?;
        for &index in &marker.contour_indices {
            let contour = &outline.contours[index];
            content.move_to(
                (contour[0][0] * PT) as f32,
                coord_y(plan, contour[0][1]) as f32,
            );
            for point in &contour[1..] {
                content.line_to((point[0] * PT) as f32, coord_y(plan, point[1]) as f32);
            }
            content.close_path();
        }
        content.clip_nonzero();
        content
            .transform(matrix(&mark_piece, plan)?)
            .x_object(Name(name.as_bytes()))
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
        image_xobjects: refs.len() + marker_refs.len(),
        soft_masks: masks,
        output_bytes: bytes.len(),
        total_ms: start.elapsed().as_secs_f64() * 1000.,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_png::{LaserOutline, NativeSizeMarkMask};

    fn rgba_png(width: u32, height: u32, pixels: &[u8]) -> tempfile::NamedTempFile {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut encoder = png::Encoder::new(File::create(file.path()).unwrap(), width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(pixels).unwrap();
        writer.finish().unwrap();
        file
    }

    fn decoded(bytes: &[u8]) -> Vec<u8> {
        let mut decoded = Vec::new();
        flate2::read::ZlibDecoder::new(bytes)
            .read_to_end(&mut decoded)
            .unwrap();
        decoded
    }

    #[test]
    fn pdf_marker_is_rebuilt_from_mask_and_preserved_alpha_of_clean_artwork() {
        let mut pixels = vec![0; 2 * 18 * 4];
        for y in 0..18 {
            let index = y * 2 * 4;
            pixels[index..index + 4].copy_from_slice(&[255, 255, 255, 200]);
        }
        let source = rgba_png(2, 18, &pixels);
        let placement = NativeSizeMarkPlacement {
            piece_index: 0,
            source: 7,
            x: 0,
            y: 0,
            mask_index: 0,
            contour_indices: vec![0],
        };
        let (rgb, alpha) = marker_source(source.path(), &placement, 1, 18, &vec![255; 18]).unwrap();
        assert_eq!(decoded(&rgb), vec![138, 255, 0].repeat(18));
        assert_eq!(decoded(alpha.as_ref().unwrap()), vec![200; 18]);
    }

    #[test]
    fn pdf_marker_still_rejects_mask_pixels_outside_cut_alpha() {
        let mut pixels = vec![255; 1 * 18 * 4];
        pixels[3] = 16;
        let source = rgba_png(1, 18, &pixels);
        let placement = NativeSizeMarkPlacement {
            piece_index: 0,
            source: 9,
            x: 0,
            y: 0,
            mask_index: 0,
            contour_indices: vec![0],
        };
        let error = marker_source(source.path(), &placement, 1, 18, &vec![255; 18]).unwrap_err();
        assert!(error.contains("fuente 9"));
        assert!(error.contains("alpha de corte >16"));
    }

    #[test]
    fn pdf_export_composes_clean_artwork_and_one_separate_marker_layer() {
        let mut pixels = vec![0; 2 * 18 * 4];
        for y in 0..18 {
            let index = y * 2 * 4;
            pixels[index..index + 4].copy_from_slice(&[255, 255, 255, 200]);
        }
        let source_file = rgba_png(2, 18, &pixels);
        let destination_dir = tempfile::tempdir().unwrap();
        let destination = destination_dir.path().join("clean-marker.pdf");
        let mut plan = plan();
        plan.laser_outline = Some(LaserOutline {
            width: 3.,
            contours: vec![vec![[20., 20.], [80., 20.], [80., 80.], [20., 80.]]],
        });
        plan.size_mark_masks = vec![NativeSizeMarkMask {
            width: 1,
            height: 18,
            data: vec![255; 18],
        }];
        plan.size_marks = vec![NativeSizeMarkPlacement {
            piece_index: 0,
            source: 0,
            x: 0,
            y: 0,
            mask_index: 0,
            contour_indices: vec![0],
        }];
        plan.pieces = vec![NativePiece {
            source: 0,
            translate_x: 30.,
            translate_y: 30.,
            width: 2.,
            height: 18.,
            rotation: 0,
        }];
        let sources = BTreeMap::from([(0, source_file.path().to_path_buf())]);

        let diagnostics = generate(&plan, &sources, &destination).unwrap();
        assert_eq!(diagnostics.image_xobjects, 2);
        assert_eq!(diagnostics.unique_sources, 1);
        assert!(diagnostics.output_bytes > 0);
        assert!(destination.exists());
        let output = std::fs::read(&destination).unwrap();
        let content = String::from_utf8_lossy(&output);
        assert_eq!(content.matches("/Im0 Do").count(), 1);
        assert_eq!(content.matches("/Mk0_0_0_0 Do").count(), 1);
        let artwork_at = content.find("/Im0 Do").unwrap();
        let stroke_at = content.find("0 0 0 RG").unwrap();
        let marker_at = content.find("/Mk0_0_0_0 Do").unwrap();
        assert!(artwork_at < stroke_at && stroke_at < marker_at);
    }

    fn plan() -> NativePlan {
        NativePlan {
            laser_outline: None,
            size_mark_masks: vec![],
            size_marks: vec![],
            page_width_mm: None,
            page_height_mm: None,
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
    fn physical_dimensions_validate_each_axis_with_one_pixel_tolerance() {
        let base = plan();
        assert_eq!(page_size_pt(&base).unwrap(), [72., 144.]);
        for axis in 0..2 {
            let pixels = if axis == 0 { base.width } else { base.height } as f64;
            for delta in [-1., -0.5, 0., 0.5, 1.] {
                let mut p = base.clone();
                let mm = (pixels + delta) * 25.4 / 300.;
                if axis == 0 {
                    p.page_width_mm = Some(mm);
                } else {
                    p.page_height_mm = Some(mm);
                }
                let pt = page_size_pt(&p).unwrap();
                assert!((pt[axis] - mm * 72. / 25.4).abs() < 1e-10);
                assert_eq!(pt[1 - axis], page_size_pt(&base).unwrap()[1 - axis]);
            }
            for mm in [
                f64::NAN,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::MAX,
                0.,
                -1.,
                (pixels - 1.01) * 25.4 / 300.,
                (pixels + 1.01) * 25.4 / 300.,
            ] {
                let mut p = base.clone();
                if axis == 0 {
                    p.page_width_mm = Some(mm);
                } else {
                    p.page_height_mm = Some(mm);
                }
                assert!(page_size_pt(&p).is_err(), "axis {axis}, mm {mm}");
                assert!(matrix(&piece(0), &p).is_err());
            }
        }
    }

    #[test]
    fn physical_height_only_translates_all_rotation_matrices() {
        let mut physical = plan();
        physical.page_width_mm = Some((physical.width as f64 + 0.5) * 25.4 / 300.);
        physical.page_height_mm = Some((physical.height as f64 + 0.75) * 25.4 / 300.);
        for rotation in [0, 90, -90, 180] {
            let p = piece(rotation);
            let original = matrix(&p, &plan()).unwrap();
            let actual = matrix(&p, &physical).unwrap();
            assert_eq!(&actual[..5], &original[..5]);
            assert!((actual[5] as f64 - original[5] as f64 - 0.75 * PT).abs() < 0.0001);
        }
    }

    #[test]
    fn laser_pdf_has_exact_1560_by_5000_mm_page_and_unscaled_opaque_stroke() {
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("source.png");
        let mut encoder = png::Encoder::new(File::create(&source_path).unwrap(), 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[255, 0, 0, 128]).unwrap();
        writer.finish().unwrap();
        let sources = BTreeMap::from([(0, source_path)]);
        let mut p = plan();
        p.width = (1560_f64 * 300. / 25.4).floor() as u32;
        p.height = (5000_f64 * 300. / 25.4).floor() as u32;
        assert_eq!((p.width, p.height), (18425, 59055));
        p.page_width_mm = Some(1560.);
        p.page_height_mm = Some(5000.);
        p.pieces = vec![piece(0)];
        p.laser_outline = Some(crate::native_png::LaserOutline {
            width: 3. * 300. / 25.4,
            contours: vec![vec![[100., 100.], [140., 100.], [100., 120.]]],
        });
        let destination = dir.path().join("physical.pdf");
        let diagnostics = generate(&p, &sources, &destination).unwrap();
        assert_eq!(
            diagnostics.page_pt,
            [1560. * 72. / 25.4, 5000. * 72. / 25.4]
        );
        assert!((diagnostics.page_cm[0] - 156.).abs() < 1e-10);
        assert!((diagnostics.page_cm[1] - 500.).abs() < 1e-10);
        assert_eq!(diagnostics.soft_masks, 1);
        let bytes = std::fs::read(&destination).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        let media = text
            .split("/MediaBox [")
            .nth(1)
            .unwrap()
            .split(']')
            .next()
            .unwrap();
        let values: Vec<f64> = media
            .split_whitespace()
            .map(|v| v.parse().unwrap())
            .collect();
        assert!((values[2] * 25.4 / 72. - 1560.).abs() < 0.001);
        assert!((values[3] * 25.4 / 72. - 5000.).abs() < 0.001);
        let stroke = text.split("0 0 0 RG\n").nth(1).unwrap();
        let stroke_width: f64 = stroke.split_whitespace().next().unwrap().parse().unwrap();
        assert!((stroke_width - 3. * 72. / 25.4).abs() < 0.0001);
        let move_line = stroke.lines().find(|line| line.ends_with(" m")).unwrap();
        let move_values: Vec<f64> = move_line
            .split_whitespace()
            .take(2)
            .map(|v| v.parse().unwrap())
            .collect();
        assert!((move_values[0] - 100. * PT).abs() < 0.0001);
        assert!((move_values[1] - (5000. * 72. / 25.4 - 100. * PT)).abs() < 0.001);
        assert!(!text.contains("/ExtGState"));
        assert!(!text.contains(" gs"));
        assert!(text.contains("h\nS"));

        p.page_width_mm = None;
        p.page_height_mm = None;
        let legacy = generate(&p, &sources, &dir.path().join("legacy.pdf")).unwrap();
        assert_eq!(legacy.page_pt, [18425. * PT, 59055. * PT]);
        p.width = 18426;
        let oversized = dir.path().join("oversized.pdf");
        assert!(generate(&p, &sources, &oversized).is_err());
        assert!(!oversized.exists());
        p.width = 18425;
        p.page_width_mm = Some(1480.);
        let inconsistent = dir.path().join("inconsistent.pdf");
        assert!(generate(&p, &sources, &inconsistent).is_err());
        assert!(!inconsistent.exists());
        p.page_width_mm = Some(1560.);
        p.laser_outline.as_mut().unwrap().contours[0][0][0] = 0.;
        let overflow = dir.path().join("overflow.pdf");
        assert!(generate(&p, &sources, &overflow).is_err());
        assert!(!overflow.exists());
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

    #[test]
    fn laser_contour_is_a_black_closed_vector_path_after_artwork() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("source.png");
        let mut encoder = png::Encoder::new(File::create(&path).unwrap(), 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[255, 255, 255, 255]).unwrap();
        writer.finish().unwrap();
        let mut p = plan();
        p.pieces = vec![piece(0)];
        p.laser_outline = Some(crate::native_png::LaserOutline {
            width: 3. * 300. / 25.4,
            contours: vec![vec![[100., 100.], [140., 100.], [100., 120.]]],
        });
        let dest = dir.path().join("laser.pdf");
        generate(&p, &BTreeMap::from([(0, path)]), &dest).unwrap();
        let bytes = std::fs::read(dest).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("0 0 0 RG"));
        let stroke_commands = &text[text.find("0 0 0 RG").unwrap()..];
        let pdf_width: f64 = stroke_commands
            .split(" w")
            .next()
            .unwrap()
            .split_whitespace()
            .last()
            .unwrap()
            .parse()
            .unwrap();
        assert!((pdf_width - 3. * 72. / 25.4).abs() < 0.0001);
        assert!(text.contains("1 j"));
        assert!(text.contains("h\nS"));
        assert!(text.find("/Im0 Do").unwrap() < text.find("0 0 0 RG").unwrap());
    }
}
