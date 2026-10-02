//! PNG sources cross IPC once; all final raster strips remain in the backend.
use crate::png_export::{start_session_at, valid_filename, ExportService};
use serde::{Deserialize, Serialize};
use skia_safe::{
    canvas::SrcRectConstraint, image::CachingHint, images, surfaces, AlphaType, Codec, CodecResult,
    Color, ColorSpace, ColorType, CubicResampler, Data, FilterMode, Image, ImageInfo, MipmapMode,
    Paint, Rect, SamplingOptions,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tauri::{
    ipc::{Channel, InvokeBody, Request},
    State,
};

pub const STRIP_ROWS: u32 = 256;
pub const MAX_SOURCE_BYTES: usize = 64 * 1024 * 1024;
const MAX_SOURCE_PIXELS: u64 = 16_000_000;
const MAX_DECODED_BYTES: usize = 2 * 1024 * 1024 * 1024;
const MAX_PIECES: usize = 100_000;

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Default)]
struct SourceCache {
    images: HashMap<u32, Image>,
    decoded_bytes: usize,
}

pub(crate) struct NativeJob {
    id: String,
    cancelled: AtomicBool,
    busy: AtomicBool,
    // A separate commit lock makes cancellation/publication linearizable.
    commit: Mutex<()>,
    cache: Mutex<SourceCache>,
}
impl NativeJob {
    fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err("Exportación cancelada.".into())
        } else {
            Ok(())
        }
    }
    fn cancel(&self) -> Result<(), String> {
        let _commit = self.commit.lock().map_err(error)?;
        self.cancelled.store(true, Ordering::Release);
        Ok(())
    }
}

// Reject concurrent upload/render requests before cloning large IPC payloads.
struct Operation(Arc<NativeJob>);
impl Operation {
    fn acquire(job: &Arc<NativeJob>) -> Result<Self, String> {
        job.check()?;
        job.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Ya hay una operación PNG en curso.")?;
        Ok(Self(job.clone()))
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::Release);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativePiece {
    pub source: u32,
    pub translate_x: f64,
    pub translate_y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: i32,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativePlan {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub laser_outline: Option<LaserOutline>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub size_mark_masks: Vec<NativeSizeMarkMask>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub size_marks: Vec<NativeSizeMarkPlacement>,
    pub name: String,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_width_mm: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_height_mm: Option<f64>,
    // Pixel coordinates derived from the unchanged physical export plan at 300 PPI.
    pub offset_x: f64,
    pub offset_y: f64,
    pub pieces: Vec<NativePiece>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeSizeMarkMask {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeSizeMarkPlacement {
    pub piece_index: usize,
    pub source: u32,
    pub x: u32,
    pub y: u32,
    pub mask_index: usize,
    pub contour_indices: Vec<usize>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaserOutline {
    pub width: f64,
    // Page-local pixels, already rotated and placed by the shared export plan.
    pub contours: Vec<Vec<[f64; 2]>>,
}
impl NativePlan {
    pub(crate) fn validate_outline(&self) -> Result<(), String> {
        if let Some(outline) = &self.laser_outline {
            if !outline.width.is_finite()
                || outline.width <= 0.0
                || outline.width > 100.0
                || outline.contours.is_empty()
            {
                return Err("Contorno láser inválido.".into());
            }
            let half = outline.width / 2.0;
            for contour in &outline.contours {
                if contour.len() < 3
                    || contour.iter().any(|p| {
                        !p[0].is_finite()
                            || !p[1].is_finite()
                            || p[0] < half - 0.00001
                            || p[1] < half - 0.00001
                            || p[0] > self.width as f64 - half + 0.00001
                            || p[1] > self.height as f64 - half + 0.00001
                    })
                {
                    return Err("Contorno láser fuera del canvas.".into());
                }
            }
        }
        Ok(())
    }
}

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderDiagnostics {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub output_bytes: u64,
    pub composition_ms: f64,
    pub rgb_convert_ms: f64,
    pub encode_write_ms: f64,
    pub total_ms: f64,
    pub strips: u32,
    pub piece_draws: u64,
    pub decoded_sources: usize,
    pub decoded_bytes: usize,
    pub raster_working_bytes: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadDiagnostics {
    pub decode_ms: f64,
    pub decoded_bytes: usize,
}
#[derive(Debug, Serialize)]
pub struct RenderResult {
    pub path: String,
    pub diagnostics: RenderDiagnostics,
}

fn validate_plan(plan: &NativePlan, cache: &SourceCache) -> Result<(), String> {
    plan.validate_outline()?;
    if plan.size_marks.is_empty() != plan.size_mark_masks.is_empty()
        || plan.size_marks.len() > MAX_PIECES
        || (!plan.size_marks.is_empty() && plan.laser_outline.is_none())
    {
        return Err("Plan de marcadores de talle inválido para esta exportación.".into());
    }
    for mask in &plan.size_mark_masks {
        if mask.width == 0
            || mask.width > 64
            || mask.height != 18
            || mask.data.len() != mask.width as usize * mask.height as usize
            || mask.data.iter().any(|&value| value != 0 && value != 255)
            || !mask.data.iter().any(|&value| value != 0)
        {
            return Err("Máscara raster del marcador inválida.".into());
        }
    }
    if !valid_filename(&plan.name)
        || plan.width == 0
        || plan.width > 18425
        || plan.height == 0
        || plan.height > 59055
    {
        return Err("Nombre o dimensiones PNG inválidos.".into());
    }
    if plan.pieces.is_empty()
        || plan.pieces.len() > MAX_PIECES
        || ![plan.offset_x, plan.offset_y]
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 100_000.0)
    {
        return Err("Plan PNG inválido.".into());
    }
    for p in &plan.pieces {
        if !cache.images.contains_key(&p.source)
            || ![0, 90, -90, 180].contains(&p.rotation)
            || ![p.translate_x, p.translate_y, p.width, p.height]
                .iter()
                .all(|v| v.is_finite() && v.abs() <= 100_000.0)
            || p.width <= 0.0
            || p.height <= 0.0
        {
            return Err("Fuente, posición, escala o rotación inválida.".into());
        }
        let (left, top, right, bottom) = piece_bounds(p, plan);
        // The existing plan rounds output size to the closest pixel. Up to 0.5 px
        // at the right/bottom edge is therefore intentional, never a whole margin.
        if left < -1e-5
            || top < -1e-5
            || right > plan.width as f64 + 0.50001
            || bottom > plan.height as f64 + 0.50001
        {
            return Err("El arte completo excede el PNG planificado.".into());
        }
    }
    for mark in &plan.size_marks {
        let Some(piece) = plan.pieces.get(mark.piece_index) else {
            return Err("El marcador referencia una pieza inexistente.".into());
        };
        let Some(mask) = plan.size_mark_masks.get(mark.mask_index) else {
            return Err("El marcador referencia una máscara inexistente.".into());
        };
        let Some(source) = cache.images.get(&mark.source) else {
            return Err("El marcador referencia una fuente inexistente.".into());
        };
        let outline = plan
            .laser_outline
            .as_ref()
            .ok_or("El marcador necesita contorno de corte.")?;
        if piece.source != mark.source
            || mark
                .x
                .checked_add(mask.width)
                .is_none_or(|x| x > source.width() as u32)
            || mark
                .y
                .checked_add(mask.height)
                .is_none_or(|y| y > source.height() as u32)
            || mark.contour_indices.is_empty()
            || mark
                .contour_indices
                .iter()
                .any(|&index| index >= outline.contours.len())
        {
            return Err("Geometría fuente/contorno del marcador inválida.".into());
        }
    }
    Ok(())
}
fn piece_bounds(p: &NativePiece, plan: &NativePlan) -> (f64, f64, f64, f64) {
    let x = p.translate_x - plan.offset_x;
    let y = p.translate_y - plan.offset_y;
    match p.rotation {
        90 => (x - p.height, y, x, y + p.width),
        -90 => (x, y - p.width, x + p.height, y),
        180 => (x - p.width, y - p.height, x, y),
        _ => (x, y, x + p.width, y + p.height),
    }
}

const SIZE_MARK_MAX_DEPTH_MM: f64 = 6.5;
const PX_PER_MM: f64 = 300. / 25.4;

fn size_mark_image(
    cache: &SourceCache,
    placement: &NativeSizeMarkPlacement,
    mask: &NativeSizeMarkMask,
) -> Result<Image, String> {
    let source = cache
        .images
        .get(&placement.source)
        .ok_or("Falta la fuente del marcador.")?;
    let info = ImageInfo::new(
        (mask.width as i32, mask.height as i32),
        ColorType::BGRA8888,
        AlphaType::Premul,
        ColorSpace::new_srgb(),
    );
    let row_bytes = mask.width as usize * 4;
    let mut pixels = vec![0; row_bytes * mask.height as usize];
    if !source.read_pixels(
        &info,
        &mut pixels,
        row_bytes,
        (placement.x as i32, placement.y as i32),
        CachingHint::Allow,
    ) {
        return Err("No se pudo leer el recorte raster del marcador.".into());
    }
    for (index, &ink) in mask.data.iter().enumerate() {
        let pixel = &mut pixels[index * 4..index * 4 + 4];
        if ink == 0 {
            pixel.fill(0);
            continue;
        }
        let alpha = pixel[3] as i32;
        let lime_r_premul = 138 * alpha;
        if alpha <= 16 {
            return Err("El marcador sale del alpha de corte >16.".into());
        }
        pixel[0] = 0;
        pixel[1] = alpha as u8;
        pixel[2] = (lime_r_premul / 255) as u8;
    }
    images::raster_from_data(&info, Data::new_copy(&pixels), row_bytes)
        .ok_or_else(|| "No se pudo preparar la capa del marcador.".into())
}

fn map_source_point(
    p: &NativePiece,
    plan: &NativePlan,
    source: &Image,
    x: f64,
    y: f64,
) -> [f64; 2] {
    let sx = p.width / source.width() as f64;
    let sy = p.height / source.height() as f64;
    let tx = p.translate_x - plan.offset_x;
    let ty = p.translate_y - plan.offset_y;
    let (x, y) = match p.rotation {
        90 => (tx - y * sy, ty + x * sx),
        -90 => (tx + y * sy, ty - x * sx),
        180 => (tx - x * sx, ty - y * sy),
        _ => (tx + x * sx, ty + y * sy),
    };
    [x, y]
}

fn marker_page_bounds(
    placement: &NativeSizeMarkPlacement,
    mask: &NativeSizeMarkMask,
    piece: &NativePiece,
    source: &Image,
    plan: &NativePlan,
) -> [f64; 4] {
    let points = [
        map_source_point(piece, plan, source, placement.x as f64, placement.y as f64),
        map_source_point(
            piece,
            plan,
            source,
            (placement.x + mask.width) as f64,
            placement.y as f64,
        ),
        map_source_point(
            piece,
            plan,
            source,
            placement.x as f64,
            (placement.y + mask.height) as f64,
        ),
        map_source_point(
            piece,
            plan,
            source,
            (placement.x + mask.width) as f64,
            (placement.y + mask.height) as f64,
        ),
    ];
    [
        points.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min),
        points.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min),
        points
            .iter()
            .map(|p| p[0])
            .fold(f64::NEG_INFINITY, f64::max),
        points
            .iter()
            .map(|p| p[1])
            .fold(f64::NEG_INFINITY, f64::max),
    ]
}

fn segment_distance_squared(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let length_squared = dx * dx + dy * dy;
    let t = if length_squared <= f64::EPSILON {
        0.
    } else {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length_squared).clamp(0., 1.)
    };
    let x = a[0] + t * dx;
    let y = a[1] + t * dy;
    (p[0] - x).powi(2) + (p[1] - y).powi(2)
}

fn contour_contains_and_distance(point: [f64; 2], contour: &[[f64; 2]]) -> Option<f64> {
    let mut inside = false;
    let mut min_distance = f64::INFINITY;
    for index in 0..contour.len() {
        let a = contour[index];
        let b = contour[(index + 1) % contour.len()];
        min_distance = min_distance.min(segment_distance_squared(point, a, b));
        let crosses = (a[1] > point[1]) != (b[1] > point[1])
            && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0];
        if crosses {
            inside = !inside;
        }
    }
    if inside || min_distance <= 1e-12 {
        Some(min_distance.sqrt())
    } else {
        None
    }
}

fn decode_source(bytes: &[u8], width: u32, height: u32) -> Result<Image, String> {
    if bytes.len() > MAX_SOURCE_BYTES
        || bytes.len() < 24
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || &bytes[12..16] != b"IHDR"
        || width == 0
        || height == 0
        || width as u64 * height as u64 > MAX_SOURCE_PIXELS
        || u32::from_be_bytes(bytes[16..20].try_into().unwrap()) != width
        || u32::from_be_bytes(bytes[20..24].try_into().unwrap()) != height
    {
        return Err("PNG fuente inválido, demasiado grande o con dimensiones diferentes.".into());
    }
    let mut codec =
        Codec::from_data(Data::new_copy(bytes)).ok_or("No se pudo decodificar el PNG.")?;
    if codec.dimensions().width != width as i32 || codec.dimensions().height != height as i32 {
        return Err("Dimensiones de fuente incorrectas.".into());
    }
    // Decode once to premultiplied sRGB, like createImageBitmap + the sRGB canvas.
    let info = ImageInfo::new(
        (width as i32, height as i32),
        ColorType::BGRA8888,
        AlphaType::Premul,
        ColorSpace::new_srgb(),
    );
    let row_bytes = width as usize * 4;
    let mut pixels = vec![0; row_bytes * height as usize];
    if codec.get_pixels_with_options(&info, &mut pixels, row_bytes, None) != CodecResult::Success {
        return Err("PNG fuente truncado o no decodificable.".into());
    }
    images::raster_from_data(&info, Data::new_copy(&pixels), row_bytes)
        .ok_or("No se pudo cachear el PNG.".into())
}

/// Round joins/caps are the union of capsules around the closed contour segments.
/// The 50% coverage boundary is exactly width/2 from the contour. The one-pixel
/// coverage ramp is raster filtering, not an increase in the nominal stroke.
/// All arithmetic uses global pixel centres, independent of strip boundaries.
fn raster_stroke_strip(
    outline: &LaserOutline,
    width: u32,
    y: u32,
    rows: u32,
    mut check: impl FnMut() -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    let mut pixels = vec![0u8; width as usize * rows as usize * 4];
    let half = outline.width / 2.0;
    let support = half + 0.5;
    for contour in &outline.contours {
        check()?;
        for index in 0..contour.len() {
            let a = contour[index];
            let b = contour[(index + 1) % contour.len()];
            let dx = b[0] - a[0];
            let dy = b[1] - a[1];
            let length2 = dx * dx + dy * dy;
            let first_y = ((a[1].min(b[1]) - support).floor().max(y as f64)) as u32;
            let end_y = ((a[1].max(b[1]) + support).ceil().min((y + rows) as f64))
                .max(first_y as f64) as u32;
            for page_y in first_y..end_y {
                if page_y % 32 == 0 {
                    check()?;
                }
                let py = page_y as f64 + 0.5;
                // Restrict X to the segment portion near this scanline. This avoids
                // scanning the large rectangle surrounding a long diagonal.
                let (t0, t1) = if dy.abs() < 1e-12 {
                    (0.0, 1.0)
                } else {
                    let lo = (py - support - a[1]) / dy;
                    let hi = (py + support - a[1]) / dy;
                    (lo.min(hi).clamp(0.0, 1.0), lo.max(hi).clamp(0.0, 1.0))
                };
                let x0 = a[0] + t0 * dx;
                let x1 = a[0] + t1 * dx;
                let first_x = (x0.min(x1) - support).floor().max(0.0).min(width as f64) as u32;
                let end_x = (x0.max(x1) + support).ceil().max(0.0).min(width as f64) as u32;
                for page_x in first_x..end_x {
                    let px = page_x as f64 + 0.5;
                    let t = if length2 == 0.0 {
                        0.0
                    } else {
                        ((px - a[0]) * dx + (py - a[1]) * dy) / length2
                    }
                    .clamp(0.0, 1.0);
                    let distance = (px - a[0] - t * dx).hypot(py - a[1] - t * dy);
                    let alpha = ((half + 0.5 - distance).clamp(0.0, 1.0) * 255.0).round() as u8;
                    let offset = ((page_y - y) as usize * width as usize + page_x as usize) * 4;
                    pixels[offset + 3] = pixels[offset + 3].max(alpha);
                }
            }
        }
    }
    Ok(pixels)
}

fn render_with_options(
    job: &NativeJob,
    cache: &SourceCache,
    plan: &NativePlan,
    destination: &std::path::Path,
    mut progress: impl FnMut(u32),
    strip_rows: u32,
    src_constraint: SrcRectConstraint,
) -> Result<RenderResult, String> {
    let start = Instant::now();
    job.check()?;
    validate_plan(plan, cache)?;
    let marker_images = plan
        .size_marks
        .iter()
        .map(|marker| size_mark_image(cache, marker, &plan.size_mark_masks[marker.mask_index]))
        .collect::<Result<Vec<_>, _>>()?;
    let encode_start = Instant::now();
    let mut output = start_session_at(destination, plan.width, plan.height, job.id.clone())?;
    let mut diagnostics = RenderDiagnostics {
        width: plan.width,
        height: plan.height,
        encode_write_ms: encode_start.elapsed().as_secs_f64() * 1000.0,
        decoded_sources: cache.images.len(),
        decoded_bytes: cache.decoded_bytes,
        ..Default::default()
    };
    let rows = strip_rows.max(1).min(plan.height);
    let info = ImageInfo::new(
        (plan.width as i32, rows as i32),
        ColorType::BGRA8888,
        AlphaType::Premul,
        ColorSpace::new_srgb(),
    );
    let row_bytes = plan.width as usize * 4;
    let mut rgba = vec![0; plan.width as usize * rows as usize * 4];
    let mut rgb = vec![0; plan.width as usize * rows as usize * 3];
    let rgba_len = rgba.len();
    let mut marker_rgba = vec![0; rgba_len];
    diagnostics.raster_working_bytes = rgba.len()
        + rgb.len()
        + if plan.laser_outline.is_some() {
            2 * rgba.len()
        } else {
            0
        };
    let mut surface = surfaces::wrap_pixels(&info, &mut rgba, None, None)
        .ok_or("No se pudo crear la franja nativa.")?;
    let mut marker_surface = if plan.size_marks.is_empty() {
        None
    } else {
        Some(
            surfaces::wrap_pixels(&info, &mut marker_rgba, None, None)
                .ok_or("No se pudo crear la capa de marcadores.")?,
        )
    };
    let bounds: Vec<_> = plan.pieces.iter().map(|p| piece_bounds(p, plan)).collect();
    let mut paint = Paint::default();
    paint.set_anti_alias(false);
    let mut last_percent = 0;
    for y in (0..plan.height).step_by(strip_rows.max(1) as usize) {
        job.check()?;
        let compose = Instant::now();
        let actual_rows = rows.min(plan.height - y);
        let canvas = surface.canvas();
        canvas.reset_matrix();
        canvas.clear(Color::WHITE);
        for (p, &(_, top, _, bottom)) in plan.pieces.iter().zip(&bounds) {
            // Conservative culling; filtering and fractional edges stay within the
            // same full source rectangle as Canvas drawImage, with a spare pixel.
            if bottom < y as f64 - 1.0 || top > (y + actual_rows) as f64 + 1.0 {
                continue;
            }
            job.check()?;
            let rotated_image;
            let mut adjusted = p.clone();
            let image = if p.rotation == -90 {
                let original = &cache.images[&p.source];
                let rotated_info = ImageInfo::new(
                    (original.height(), original.width()),
                    ColorType::BGRA8888,
                    AlphaType::Premul,
                    ColorSpace::new_srgb(),
                );
                let mut rotated = surfaces::raster(&rotated_info, None, None).unwrap();
                rotated.canvas().translate((0.0, original.width() as f32));
                rotated.canvas().rotate(-90.0, None);
                rotated.canvas().draw_image(original, (0.0, 0.0), None);
                rotated_image = rotated.image_snapshot();
                adjusted.rotation = 0;
                adjusted.translate_y -= adjusted.width;
                std::mem::swap(&mut adjusted.width, &mut adjusted.height);
                &rotated_image
            } else {
                &cache.images[&p.source]
            };
            let p = &adjusted;
            canvas.save();
            let translate_x = (p.translate_x - plan.offset_x) as f32;
            let translate_y = (-plan.offset_y - y as f64 + p.translate_y) as f32;
            paint.set_anti_alias(p.width < 1.0 || p.height < 1.0);
            canvas.translate((translate_x, translate_y));
            canvas.rotate(p.rotation as f32, None);
            let sampling = if p.width as f32 == image.width() as f32
                && p.height as f32 == image.height() as f32
            {
                SamplingOptions::default()
            } else if p.rotation == -90 {
                SamplingOptions::new(FilterMode::Linear, MipmapMode::None)
            } else if p.width < image.width() as f64 || p.height < image.height() as f64 {
                SamplingOptions::new(FilterMode::Linear, MipmapMode::Linear)
            } else {
                CubicResampler::mitchell().into()
            };
            canvas.scale((
                p.width as f32 / image.width() as f32,
                p.height as f32 / image.height() as f32,
            ));
            canvas.draw_image_rect_with_sampling_options(
                image,
                Some((
                    &Rect::from_wh(image.width() as f32, image.height() as f32),
                    src_constraint,
                )),
                Rect::from_wh(image.width() as f32, image.height() as f32),
                sampling,
                &paint,
            );
            canvas.restore();
            diagnostics.piece_draws += 1;
        }
        if let Some(outline) = &plan.laser_outline {
            let stroke = raster_stroke_strip(outline, plan.width, y, rows, || job.check())?;
            let stroke_image = images::raster_from_data(&info, Data::new_copy(&stroke), row_bytes)
                .ok_or("No se pudo preparar el stroke nativo.")?;
            canvas.reset_matrix();
            canvas.draw_image(&stroke_image, (0.0, 0.0), None);
        }
        if let (Some(layer), Some(outline)) = (marker_surface.as_mut(), plan.laser_outline.as_ref())
        {
            let layer_canvas = layer.canvas();
            layer_canvas.reset_matrix();
            layer_canvas.clear(Color::TRANSPARENT);
            let mut marker_paint = Paint::default();
            marker_paint.set_anti_alias(false);
            for (mark_index, marker) in plan.size_marks.iter().enumerate() {
                job.check()?;
                let mask = &plan.size_mark_masks[marker.mask_index];
                let piece = &plan.pieces[marker.piece_index];
                let source = &cache.images[&marker.source];
                let bounds = marker_page_bounds(marker, mask, piece, source, plan);
                if bounds[3] < y as f64 - 2.0 || bounds[1] > (y + actual_rows) as f64 + 2.0 {
                    continue;
                }
                layer_canvas.save();
                layer_canvas.translate((
                    (piece.translate_x - plan.offset_x) as f32,
                    (piece.translate_y - plan.offset_y - y as f64) as f32,
                ));
                layer_canvas.rotate(piece.rotation as f32, None);
                layer_canvas.scale((
                    piece.width as f32 / source.width() as f32,
                    piece.height as f32 / source.height() as f32,
                ));
                let sampling = SamplingOptions::new(FilterMode::Nearest, MipmapMode::None);
                layer_canvas.draw_image_rect_with_sampling_options(
                    &marker_images[mark_index],
                    Some((
                        &Rect::from_wh(mask.width as f32, mask.height as f32),
                        SrcRectConstraint::Strict,
                    )),
                    Rect::from_xywh(
                        marker.x as f32,
                        marker.y as f32,
                        mask.width as f32,
                        mask.height as f32,
                    ),
                    sampling,
                    &marker_paint,
                );
                layer_canvas.restore();
            }

            let layer_pixels = layer
                .peek_pixels()
                .ok_or("Capa de marcador no disponible.")?;
            let layer_bytes = layer_pixels.bytes().ok_or("Capa de marcador no legible.")?;
            let max_depth_squared = (SIZE_MARK_MAX_DEPTH_MM * PX_PER_MM).powi(2);
            let mut safe_layer = vec![0; rgba_len];
            for marker in &plan.size_marks {
                let mask = &plan.size_mark_masks[marker.mask_index];
                let piece = &plan.pieces[marker.piece_index];
                let source = &cache.images[&marker.source];
                let bounds = marker_page_bounds(marker, mask, piece, source, plan);
                let min_x = (bounds[0].floor() as i64 - 2).max(0) as u32;
                let max_x = (bounds[2].ceil() as u64 + 2).min(plan.width as u64) as u32;
                let min_page_y = (bounds[1].floor() as i64 - 2).max(0) as u32;
                let max_page_y = (bounds[3].ceil() as u64 + 2).min(plan.height as u64) as u32;
                let start_y = min_page_y.max(y);
                let end_y = max_page_y.min(y + actual_rows);
                for page_y in start_y..end_y {
                    for page_x in min_x..max_x {
                        let contour_distance = marker
                            .contour_indices
                            .iter()
                            .filter_map(|&index| {
                                contour_contains_and_distance(
                                    [page_x as f64 + 0.5, page_y as f64 + 0.5],
                                    &outline.contours[index],
                                )
                            })
                            .fold(None, |current: Option<f64>, next| {
                                Some(current.map_or(next, |value| value.min(next)))
                            });
                        let Some(distance) = contour_distance else {
                            continue;
                        };
                        if distance * distance > max_depth_squared + 1e-9 {
                            continue;
                        }
                        let layer_offset =
                            ((page_y - y) as usize * plan.width as usize + page_x as usize) * 4;
                        if layer_bytes[layer_offset + 3] == 0 {
                            continue;
                        }
                        safe_layer[layer_offset..layer_offset + 4]
                            .copy_from_slice(&layer_bytes[layer_offset..layer_offset + 4]);
                    }
                }
            }
            let safe_image =
                images::raster_from_data(&info, Data::new_copy(&safe_layer), row_bytes)
                    .ok_or("No se pudo preparar la capa segura del marcador.")?;
            let output_canvas = surface.canvas();
            output_canvas.reset_matrix();
            output_canvas.draw_image(&safe_image, (0.0, 0.0), None);
        }
        diagnostics.composition_ms += compose.elapsed().as_secs_f64() * 1000.0;

        let convert = Instant::now();
        let pixels = surface.peek_pixels().ok_or("Franja no disponible.")?;
        let bytes = pixels.bytes().ok_or("Franja no legible.")?;
        let count = plan.width as usize * actual_rows as usize;

        for (from, to) in bytes[..count * 4]
            .chunks_exact(4)
            .zip(rgb[..count * 3].chunks_exact_mut(3))
        {
            to.copy_from_slice(&[from[2], from[1], from[0]]);
        }

        diagnostics.rgb_convert_ms += convert.elapsed().as_secs_f64() * 1000.0;

        job.check()?;
        let encode = Instant::now();
        output.append(&rgb[..count * 3])?;
        diagnostics.encode_write_ms += encode.elapsed().as_secs_f64() * 1000.0;
        diagnostics.strips += 1;
        let percent = (y + actual_rows) * 100 / plan.height;
        if percent > last_percent || percent == 100 {
            progress(percent);
            last_percent = percent;
        }
    }
    let _commit = job.commit.lock().map_err(error)?;
    job.check()?;
    let encode = Instant::now();
    let path = output.finish()?;
    diagnostics.encode_write_ms += encode.elapsed().as_secs_f64() * 1000.0;

    diagnostics.output_bytes = std::fs::metadata(&path).map_err(error)?.len();
    diagnostics.name = std::path::Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(plan.name.as_str())
        .to_owned();

    diagnostics.total_ms = start.elapsed().as_secs_f64() * 1000.0;
    Ok(RenderResult { path, diagnostics })
}

fn render(
    job: &NativeJob,
    cache: &SourceCache,
    plan: &NativePlan,
    destination: &std::path::Path,
    progress: impl FnMut(u32),
) -> Result<RenderResult, String> {
    render_with_options(
        job,
        cache,
        plan,
        destination,
        progress,
        STRIP_ROWS,
        SrcRectConstraint::Fast,
    )
}

fn active(state: &ExportService, id: &str) -> Result<Arc<NativeJob>, String> {
    let inner = state.0.lock().map_err(error)?;
    inner
        .native
        .as_ref()
        .filter(|j| j.id == id)
        .cloned()
        .ok_or("Sesión nativa incorrecta.".into())
}
#[tauri::command]
pub fn begin_native_export(state: State<'_, ExportService>) -> Result<String, String> {
    let mut inner = state.0.lock().map_err(error)?;
    if inner.session.is_some() || inner.native.is_some() {
        return Err("Ya hay una exportación en curso.".into());
    }
    inner.sequence += 1;
    let id = inner.sequence.to_string();
    inner.native = Some(Arc::new(NativeJob {
        id: id.clone(),
        cancelled: AtomicBool::new(false),
        busy: AtomicBool::new(false),
        commit: Mutex::new(()),
        cache: Mutex::new(SourceCache::default()),
    }));
    Ok(id)
}
#[tauri::command]
pub async fn upload_png_source(
    request: Request<'_>,
    state: State<'_, ExportService>,
) -> Result<UploadDiagnostics, String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .ok_or("Falta metadata de fuente.")
    };
    let job = active(&state, header("x-nestra-session")?)?;
    let source: u32 = header("x-nestra-source")?.parse().map_err(error)?;
    let width: u32 = header("x-nestra-width")?.parse().map_err(error)?;
    let height: u32 = header("x-nestra-height")?.parse().map_err(error)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaban bytes PNG binarios.".into());
    };
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err("PNG comprimido excede 64 MiB.".into());
    }
    let permit = Operation::acquire(&job)?;
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let mut cache = job.cache.lock().map_err(error)?;
        job.check()?;
        let pixels = width as u64 * height as u64;
        if pixels == 0 || pixels > MAX_SOURCE_PIXELS {
            return Err("La fuente excede 16 MP.".into());
        }
        let size = pixels * 4;
        if cache.images.contains_key(&source) {
    return Err("Fuente PNG duplicada en la sesión de exportación.".into());
}

if cache.images.len() >= 1024 {
    return Err("La exportación excede el máximo de 1024 fuentes únicas.".into());
}

if size > MAX_DECODED_BYTES as u64
    || size + cache.decoded_bytes as u64 > MAX_DECODED_BYTES as u64
{
    return Err(format!(
        "Presupuesto de fuentes decodificadas excedido: {:.1} MiB usados + {:.1} MiB nuevos > {:.0} MiB.",
        cache.decoded_bytes as f64 / 1024.0 / 1024.0,
        size as f64 / 1024.0 / 1024.0,
        MAX_DECODED_BYTES as f64 / 1024.0 / 1024.0,
    ));
}
        let start = Instant::now();
        let image = decode_source(&bytes, width, height)?;
        job.check()?;
        cache.images.insert(source, image);
        cache.decoded_bytes += size as usize;
        Ok(UploadDiagnostics {
            decode_ms: start.elapsed().as_secs_f64() * 1000.0,
            decoded_bytes: size as usize,
        })
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub async fn render_native_png(
    id: String,
    plan: NativePlan,
    destination: String,
    progress: Channel<u32>,
    state: State<'_, ExportService>,
) -> Result<RenderResult, String> {
    let job = active(&state, &id)?;
    let permit = Operation::acquire(&job)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let cache = job.cache.lock().map_err(error)?;
        render(
            &job,
            &cache,
            &plan,
            &PathBuf::from(destination),
            |percent| {
                let _ = progress.send(percent);
            },
        )
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub async fn close_native_export(
    id: String,
    state: State<'_, ExportService>,
) -> Result<(), String> {
    let job = match active(&state, &id) {
        Ok(job) => job,
        Err(_) => return Ok(()),
    };
    job.cancel()?;
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Wait for the active decoder/renderer to unwind and delete its partial.
        let mut cache = job.cache.lock().map_err(error)?;
        *cache = SourceCache::default();
        let mut inner = shared.lock().map_err(error)?;
        if inner.native.as_ref().is_some_and(|j| j.id == id) {
            inner.native = None;
        }
        Ok(())
    })
    .await
    .map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Cursor};

    fn job(_folder: &std::path::Path) -> NativeJob {
        NativeJob {
            id: "test".into(),
            cancelled: AtomicBool::new(false),
            busy: AtomicBool::new(false),
            commit: Mutex::new(()),
            cache: Mutex::new(SourceCache::default()),
        }
    }
    fn source_png(width: u32, height: u32, pixels: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(pixels).unwrap();
        }
        bytes
    }
    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/png")
    }
    fn read_rgb(path: &str) -> (u32, u32, Vec<u8>) {
        let mut decoder =
            png::Decoder::new(std::io::BufReader::new(std::fs::File::open(path).unwrap()))
                .read_info()
                .unwrap();
        let dims = decoder.info().pixel_dims.unwrap();
        assert_eq!(
            (dims.xppu, dims.yppu, dims.unit),
            (11811, 11811, png::Unit::Meter)
        );
        let mut rgb = vec![0; decoder.output_buffer_size().unwrap()];
        let info = decoder.next_frame(&mut rgb).unwrap();
        assert_eq!(info.color_type, png::ColorType::Rgb);
        (info.width, info.height, rgb)
    }
    fn cache_fixture() -> SourceCache {
        let image =
            decode_source(&fs::read(fixture_dir().join("source.png")).unwrap(), 7, 5).unwrap();
        SourceCache {
            images: HashMap::from([(0, image)]),
            decoded_bytes: 7 * 5 * 4,
        }
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StagedMarkerProbe {
        source_path: PathBuf,
        source_width: u32,
        source_height: u32,
        plan: NativePlan,
    }
    #[derive(serde::Deserialize)]
    struct StagedMarkerProbeManifest {
        samples: Vec<StagedMarkerProbe>,
    }
    #[test]
    #[ignore = "requires a staged depth8 probe manifest and export directory"]
    fn render_staged_marker_probes_with_native_imprenta2_rasterizer() {
        let manifest_path = std::env::var_os("NESTRA_IMPRENTA2_PROBE_INPUT")
            .expect("NESTRA_IMPRENTA2_PROBE_INPUT is required");
        let output_dir = PathBuf::from(
            std::env::var_os("NESTRA_IMPRENTA2_PROBE_OUTPUT")
                .expect("NESTRA_IMPRENTA2_PROBE_OUTPUT is required"),
        );
        fs::create_dir_all(&output_dir).unwrap();
        let input: StagedMarkerProbeManifest =
            serde_json::from_slice(&fs::read(manifest_path).unwrap()).unwrap();
        assert_eq!(input.samples.len(), 6, "expected T1/T8/T10 front and back");
        for sample in input.samples {
            let bytes = fs::read(&sample.source_path).unwrap();
            assert!(bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
            let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
            let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
            assert_eq!((width, height), (sample.source_width, sample.source_height));
            let image = decode_source(&bytes, width, height).unwrap();
            let cache = SourceCache {
                images: HashMap::from([(0, image)]),
                decoded_bytes: (width as usize) * (height as usize) * 4,
            };
            assert_eq!(
                sample.plan.width, 18425,
                "Imprenta 2 width must be 1560 mm at 300 PPI"
            );
            assert_eq!(
                sample.plan.laser_outline.as_ref().unwrap().width,
                3.0 * PX_PER_MM
            );
            let destination = output_dir.join(&sample.plan.name);
            let result = render(
                &job(&output_dir),
                &cache,
                &sample.plan,
                &destination,
                |_| {},
            )
            .unwrap();
            let (out_width, out_height, pixels) = read_rgb(&result.path);
            assert_eq!(
                (out_width, out_height),
                (sample.plan.width, sample.plan.height)
            );
            assert!(pixels.chunks_exact(3).any(|pixel| pixel == [138, 255, 0]));
            println!("Rendered staged Imprenta 2 probe: {}", result.path);
        }
    }
    #[allow(dead_code)]
    #[derive(Debug)]
    struct DiffSummary {
        pixels: usize,
        channels: usize,
        max_delta: u8,
        bbox: Option<(u32, u32, u32, u32)>,
        mean_abs: f64,
        rmse: f64,
        psnr: f64,
        deltas: std::collections::BTreeMap<u8, u64>,
    }
    fn summarize(actual: &[u8], expected: &[u8], width: u32) -> DiffSummary {
        let mut pixels = std::collections::BTreeSet::new();
        let mut bbox: Option<(u32, u32, u32, u32)> = None;
        let mut channels = 0;
        let mut max_delta = 0u8;
        let mut sum = 0f64;
        let mut sum_sq = 0f64;
        let mut deltas = std::collections::BTreeMap::new();
        for (i, (&a, &b)) in actual.iter().zip(expected).enumerate() {
            let d = a.abs_diff(b);
            if d == 0 {
                continue;
            }
            channels += 1;
            max_delta = max_delta.max(d);
            sum += d as f64;
            sum_sq += (d as f64) * (d as f64);
            *deltas.entry(d).or_default() += 1;
            let px = i / 3;
            let xy = ((px % width as usize) as u32, (px / width as usize) as u32);
            pixels.insert(xy);
            bbox = Some(match bbox {
                Some((min_x, min_y, max_x, max_y)) => (
                    min_x.min(xy.0),
                    min_y.min(xy.1),
                    max_x.max(xy.0),
                    max_y.max(xy.1),
                ),
                None => (xy.0, xy.1, xy.0, xy.1),
            });
        }
        let samples = (actual.len() as f64).max(1.0);
        let mean_abs = sum / samples;
        let rmse = (sum_sq / samples).sqrt();
        let psnr = if rmse == 0.0 {
            f64::INFINITY
        } else {
            20.0 * (255.0 / rmse).log10()
        };
        DiffSummary {
            pixels: pixels.len(),
            channels,
            max_delta,
            bbox,
            mean_abs,
            rmse,
            psnr,
            deltas,
        }
    }
    fn shifted_rows(rgb: &[u8], width: u32, height: u32, dy: i32) -> Vec<u8> {
        let mut out = vec![255u8; rgb.len()];
        for y in 0..height as i32 {
            let ny = y + dy;
            if !(0..height as i32).contains(&ny) {
                continue;
            }
            let src = y as usize * width as usize * 3;
            let dst = ny as usize * width as usize * 3;
            out[dst..dst + width as usize * 3].copy_from_slice(&rgb[src..src + width as usize * 3]);
        }
        out
    }
    fn diagnostic_render(
        plan: &NativePlan,
        expected: &[u8],
        cache: &SourceCache,
        rows: u32,
        constraint: SrcRectConstraint,
    ) -> DiffSummary {
        let dir = tempfile::tempdir().unwrap();
        let result = render_with_options(
            &job(dir.path()),
            cache,
            plan,
            &dir.path().join(&plan.name),
            |_| {},
            rows,
            constraint,
        )
        .unwrap();
        let (_, _, actual) = read_rgb(&result.path);
        summarize(&actual, expected, plan.width)
    }
    #[test]
    fn browser_reference_pixels() {
        let cache = cache_fixture();
        for i in 0..5 {
            let plan: NativePlan =
                serde_json::from_slice(&fs::read(fixture_dir().join(format!("{i}.json"))).unwrap())
                    .unwrap();
            let expected = fs::read(fixture_dir().join(format!("{i}.rgb"))).unwrap();
            let dir = tempfile::tempdir().unwrap();
            let output = render(
                &job(dir.path()),
                &cache,
                &plan,
                &dir.path().join(&plan.name),
                |_| {},
            )
            .unwrap();
            let (width, height, actual) = read_rgb(&output.path);
            assert_eq!((width, height), (plan.width, plan.height));
            let summary = summarize(&actual, &expected, plan.width);
            match i {
                0 => {
                    assert!(
                        summary.max_delta <= 1 && summary.channels <= 3,
                        "fixture 0 envelope: {summary:?}"
                    );
                }
                1 | 3 | 4 => {
                    assert_eq!(
                        summary.channels, 0,
                        "fixture {i} must be byte-identical: {summary:?}"
                    );
                }
                2 => {
                    let bbox = summary.bbox.expect("fixture -90 has measured edge delta");
                    let bbox_width = bbox.2 - bbox.0 + 1;
                    assert!(
                        summary.max_delta <= 9 && summary.pixels <= 30 && summary.channels <= 70,
                        "fixture -90 raster envelope exceeded: {summary:?}"
                    );
                    assert!(summary.pixels as f64 / (plan.width * plan.height) as f64 <= 0.0037);
                    assert!(
                        summary.channels as f64 / (plan.width * plan.height * 3) as f64 <= 0.0029
                    );
                    assert!(
                        bbox_width <= 1,
                        "fixture -90 differences escaped one-pixel edge: {summary:?}"
                    );
                }
                _ => unreachable!(),
            }
            assert_eq!(output.diagnostics.decoded_sources, 1);
            assert_eq!(output.diagnostics.strips, plan.height.div_ceil(STRIP_ROWS));
        }
    }

    #[test]
    #[ignore]
    fn browser_reference_pixels_byte_perfect_diagnostic() {
        let cache = cache_fixture();
        for i in 0..5 {
            let plan: NativePlan =
                serde_json::from_slice(&fs::read(fixture_dir().join(format!("{i}.json"))).unwrap())
                    .unwrap();
            let expected = fs::read(fixture_dir().join(format!("{i}.rgb"))).unwrap();
            let dir = tempfile::tempdir().unwrap();
            let output = render(
                &job(dir.path()),
                &cache,
                &plan,
                &dir.path().join(&plan.name),
                |_| {},
            )
            .unwrap();
            let (_, _, actual) = read_rgb(&output.path);
            eprintln!(
                "fixture {i}: {:?}",
                summarize(&actual, &expected, plan.width)
            );
            assert_eq!(actual, expected, "fixture {i} is not byte-perfect");
        }
    }

    #[test]
    #[ignore]
    fn minus90_controlled_diagnostics() {
        let cache = cache_fixture();
        let plan: NativePlan =
            serde_json::from_slice(&fs::read(fixture_dir().join("2.json")).unwrap()).unwrap();
        let expected = fs::read(fixture_dir().join("2.rgb")).unwrap();
        for rows in [64, 128, plan.height] {
            eprintln!(
                "strip_rows={rows}: {:?}",
                diagnostic_render(&plan, &expected, &cache, rows, SrcRectConstraint::Fast)
            );
        }
        let mut shifted = plan.clone();
        shifted.pieces[0].translate_y += 10.0;
        eprintln!(
            "shifted +10: {:?}",
            diagnostic_render(
                &shifted,
                &shifted_rows(&expected, plan.width, plan.height, 10),
                &cache,
                64,
                SrcRectConstraint::Fast
            )
        );
        eprintln!(
            "SrcRectConstraint::Strict: {:?}",
            diagnostic_render(&plan, &expected, &cache, 64, SrcRectConstraint::Strict)
        );
    }
    #[test]
    fn exact_primary_pixels_and_white_alpha() {
        let dir = tempfile::tempdir().unwrap();
        let png = source_png(2, 1, &[255, 0, 0, 255, 0, 255, 0, 0]);
        let cache = SourceCache {
            images: HashMap::from([(0, decode_source(&png, 2, 1).unwrap())]),
            decoded_bytes: 8,
        };
        let plan = NativePlan {
            laser_outline: None,
            size_mark_masks: vec![],
            size_marks: vec![],
            page_width_mm: None,
            page_height_mm: None,
            name: "polar_1_copia.png".into(),
            width: 2,
            height: 1,
            offset_x: 0.0,
            offset_y: 0.0,
            pieces: vec![NativePiece {
                source: 0,
                translate_x: 0.0,
                translate_y: 0.0,
                width: 2.0,
                height: 1.0,
                rotation: 0,
            }],
        };
        let output = render(
            &job(dir.path()),
            &cache,
            &plan,
            &dir.path().join(&plan.name),
            |_| {},
        )
        .unwrap();
        assert_eq!(read_rgb(&output.path).2, [255, 0, 0, 255, 255, 255]);
    }
    #[test]
    fn laser_triangle_is_black_not_a_source_rectangle_and_is_strip_invariant() {
        let dir = tempfile::tempdir().unwrap();
        let png = source_png(1, 1, &[255, 255, 255, 255]);
        let cache = SourceCache {
            images: HashMap::from([(0, decode_source(&png, 1, 1).unwrap())]),
            decoded_bytes: 4,
        };
        let plan = NativePlan {
            name: "laser_1_copia.png".into(),
            size_mark_masks: vec![],
            size_marks: vec![],
            page_width_mm: None,
            page_height_mm: None,
            width: 64,
            height: 64,
            offset_x: 0.,
            offset_y: 0.,
            pieces: vec![NativePiece {
                source: 0,
                translate_x: 10.,
                translate_y: 10.,
                width: 40.,
                height: 40.,
                rotation: 0,
            }],
            laser_outline: Some(LaserOutline {
                width: 2.,
                contours: vec![vec![[10., 10.], [50., 10.], [10., 50.]]],
            }),
        };
        let a = render_with_options(
            &job(dir.path()),
            &cache,
            &plan,
            &dir.path().join("a.png"),
            |_| {},
            7,
            SrcRectConstraint::Strict,
        )
        .unwrap();
        let b = render_with_options(
            &job(dir.path()),
            &cache,
            &plan,
            &dir.path().join("b.png"),
            |_| {},
            64,
            SrcRectConstraint::Strict,
        )
        .unwrap();
        let pixels = read_rgb(&a.path).2;
        let reference = read_rgb(&b.path).2;
        let delta = summarize(&pixels, &reference, plan.width);
        assert!(pixels == reference, "strip invariance: {delta:?}");
        for rows in [1, 2, 13, 31] {
            let result = render_with_options(
                &job(dir.path()),
                &cache,
                &plan,
                &dir.path().join(format!("rows-{rows}.png")),
                |_| {},
                rows,
                SrcRectConstraint::Strict,
            )
            .unwrap();
            let actual = read_rgb(&result.path).2;
            assert!(
                actual == reference,
                "rows={rows}: {:?}",
                summarize(&actual, &reference, plan.width)
            );
        }
        assert!(pixels.chunks_exact(3).all(|p| p[0] == p[1] && p[1] == p[2]));
        let pixel = |x: usize, y: usize| &pixels[(y * 64 + x) * 3..(y * 64 + x) * 3 + 3];
        assert_eq!(pixel(30, 10), &[0, 0, 0]);
        assert_eq!(pixel(30, 29), &[0, 0, 0]);
        // A 2px nominal horizontal stroke covers precisely these two full rows.
        assert_eq!(pixel(30, 8), &[255, 255, 255]);
        assert_eq!(pixel(30, 9), &[0, 0, 0]);
        assert_eq!(pixel(30, 11), &[255, 255, 255]);
        // sqrt(2) distance from the diagonal: coverage round(255*(1.5-sqrt(2))).
        assert_eq!(pixel(30, 27), &[233, 233, 233]);
        assert_eq!(pixel(49, 40), &[255, 255, 255]);
        assert_eq!(pixel(20, 20), &[255, 255, 255]);
        let mut invalid = plan.clone();
        invalid.laser_outline.as_mut().unwrap().contours[0][0][0] = 0.;
        assert!(invalid.validate_outline().is_err());
    }
    #[test]
    #[ignore = "diagnostic for the replaced Skia stroke rasterizer"]
    fn skia_stroke_clip_dependency_diagnostic() {
        let render = |strip: i32| {
            let info = ImageInfo::new(
                (64, 64),
                ColorType::BGRA8888,
                AlphaType::Premul,
                ColorSpace::new_srgb(),
            );
            let mut surface = surfaces::raster(&info, None, None).unwrap();
            let canvas = surface.canvas();
            canvas.clear(Color::WHITE);
            let mut line = Paint::default();
            line.set_color(Color::BLACK);
            line.set_anti_alias(true);
            line.set_style(skia_safe::paint::Style::Stroke);
            line.set_stroke_width(2.0);
            line.set_stroke_join(skia_safe::paint::Join::Round);
            line.set_stroke_cap(skia_safe::paint::Cap::Round);
            let mut builder = skia_safe::PathBuilder::new();
            builder
                .move_to((10.0, 10.0))
                .line_to((50.0, 10.0))
                .line_to((10.0, 50.0))
                .close();
            let path = builder.detach();
            for y in (0..64).step_by(strip as usize) {
                canvas.save();
                canvas.clip_rect(
                    Rect::new(0.0, y as f32, 64.0, (y + strip).min(64) as f32),
                    None,
                    Some(false),
                );
                canvas.draw_path(&path, &line);
                canvas.restore();
            }
            surface
                .peek_pixels()
                .unwrap()
                .bytes()
                .unwrap()
                .chunks_exact(4)
                .flat_map(|pixel| [pixel[2], pixel[1], pixel[0]])
                .collect::<Vec<_>>()
        };
        let narrow = render(7);
        let full = render(64);
        println!(
            "Fixed 64x64 surface, identity matrix, only clip changes: {:?}",
            summarize(&narrow, &full, 64)
        );
    }
    #[test]
    fn optional_physical_page_fields_keep_legacy_plans_and_camel_case() {
        let mut plan: NativePlan =
            serde_json::from_slice(&fs::read(fixture_dir().join("0.json")).unwrap()).unwrap();
        assert_eq!(plan.page_width_mm, None);
        assert_eq!(plan.page_height_mm, None);
        let value = serde_json::to_value(&plan).unwrap();
        assert!(value.get("pageWidthMm").is_none());
        assert!(value.get("pageHeightMm").is_none());
        plan.page_width_mm = Some(1560.);
        plan.page_height_mm = Some(5000.);
        let value = serde_json::to_value(&plan).unwrap();
        assert_eq!(value["pageWidthMm"], 1560.);
        assert_eq!(value["pageHeightMm"], 5000.);
        let decoded: NativePlan = serde_json::from_value(value).unwrap();
        assert_eq!(decoded.page_width_mm, Some(1560.));
        assert_eq!(decoded.page_height_mm, Some(5000.));
    }

    #[test]
    fn laser_1560_mm_raster_has_opaque_black_stroke_and_preserves_artwork() {
        let dir = tempfile::tempdir().unwrap();
        let png = source_png(1, 1, &[255, 0, 0, 128]);
        let cache = SourceCache {
            images: HashMap::from([(0, decode_source(&png, 1, 1).unwrap())]),
            decoded_bytes: 4,
        };
        let width = (1560_f64 * 300. / 25.4).floor() as u32;
        assert_eq!(width, 18425);
        let mut plan = NativePlan {
            name: "laser_1_copia.png".into(),
            size_mark_masks: vec![],
            size_marks: vec![],
            width,
            height: 64,
            page_width_mm: None,
            page_height_mm: None,
            offset_x: 0.,
            offset_y: 0.,
            pieces: vec![NativePiece {
                source: 0,
                translate_x: width as f64 - 80.,
                translate_y: 12.25,
                width: 40.,
                height: 40.,
                rotation: 0,
            }],
            laser_outline: None,
        };
        let baseline = render(
            &job(dir.path()),
            &cache,
            &plan,
            &dir.path().join("artwork.png"),
            |_| {},
        )
        .unwrap();
        let artwork = read_rgb(&baseline.path).2;
        let stroke_width = 3. * 300. / 25.4;
        let half = stroke_width / 2.;
        plan.page_width_mm = Some(1560.);
        plan.page_height_mm = Some(64. * 25.4 / 300.);
        plan.laser_outline = Some(LaserOutline {
            width: stroke_width,
            contours: vec![vec![
                [half, half],
                [width as f64 - half, half],
                [half, 64. - half],
            ]],
        });
        let output = render_with_options(
            &job(dir.path()),
            &cache,
            &plan,
            &dir.path().join(&plan.name),
            |_| {},
            7,
            SrcRectConstraint::Fast,
        )
        .unwrap();
        let (actual_width, height, rgb) = read_rgb(&output.path);
        assert_eq!((actual_width, height), (18425, 64));
        let mut black = 0;
        let mut preserved_color = 0;
        let mut edge_coverage = 0;
        for (pixel, original) in rgb.chunks_exact(3).zip(artwork.chunks_exact(3)) {
            if pixel == [0, 0, 0] {
                black += 1;
            } else if pixel == original {
                if pixel != [255, 255, 255] {
                    preserved_color += 1;
                }
            } else {
                edge_coverage += 1;
                // Black coverage scales every artwork channel equally; it must
                // neither tint the edge nor alter unrelated artwork pixels.
                let remaining = pixel[0] as f64 / original[0] as f64;
                for channel in 0..3 {
                    assert!(
                        (pixel[channel] as f64 - original[channel] as f64 * remaining).abs() <= 1.0
                    );
                }
            }
        }
        assert!(black > 0);
        assert!(preserved_color > 0);
        assert!(edge_coverage > 0);
        let full = render_with_options(
            &job(dir.path()),
            &cache,
            &plan,
            &dir.path().join("full.png"),
            |_| {},
            64,
            SrcRectConstraint::Fast,
        )
        .unwrap();
        let full_pixels = read_rgb(&full.path).2;
        assert!(
            rgb == full_pixels,
            "1560 mm strip invariance: {:?}",
            summarize(&rgb, &full_pixels, width)
        );
        let reader = png::Decoder::new(std::io::BufReader::new(
            fs::File::open(&output.path).unwrap(),
        ))
        .read_info()
        .unwrap();
        assert_eq!(reader.info().color_type, png::ColorType::Rgb);
        let mut invalid = plan.clone();
        invalid.width = 18426;
        let overflow = dir.path().join("too-wide.png");
        assert!(render(&job(dir.path()), &cache, &invalid, &overflow, |_| {}).is_err());
        assert!(!overflow.exists());
        for (axis, value) in [
            (0, half - 0.001),
            (1, half - 0.001),
            (0, width as f64 - half + 0.001),
            (1, 64. - half + 0.001),
        ] {
            let mut invalid = plan.clone();
            invalid.laser_outline.as_mut().unwrap().contours[0][0][axis] = value;
            assert!(invalid.validate_outline().is_err());
            let overflow = dir
                .path()
                .join(format!("stroke-overflow-{axis}-{value}.png"));
            assert!(render(&job(dir.path()), &cache, &invalid, &overflow, |_| {}).is_err());
            assert!(!overflow.exists());
        }
    }

    #[test]
    fn cancel_after_a_strip_removes_partial_and_does_not_publish() {
        let dir = tempfile::tempdir().unwrap();
        let job = job(dir.path());
        let plan: NativePlan =
            serde_json::from_slice(&fs::read(fixture_dir().join("0.json")).unwrap()).unwrap();
        let result = render(
            &job,
            &cache_fixture(),
            &plan,
            &dir.path().join(&plan.name),
            |_| {
                job.cancel().unwrap();
            },
        );
        assert!(result.unwrap_err().contains("cancelada"));
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[test]
    fn existing_file_including_a_publication_race_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let plan: NativePlan =
            serde_json::from_slice(&fs::read(fixture_dir().join("0.json")).unwrap()).unwrap();
        let destination = dir.path().join(&plan.name);
        let result = render(
            &job(dir.path()),
            &cache_fixture(),
            &plan,
            &destination,
            |_| {
                fs::write(&destination, b"original").unwrap();
            },
        );
        assert!(result.is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        assert!(render(
            &job(dir.path()),
            &cache_fixture(),
            &plan,
            &destination,
            |_| {}
        )
        .is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"original");
    }
    #[test]
    fn validates_plans_before_creating_any_files() {
        let dir = tempfile::tempdir().unwrap();
        let base: NativePlan =
            serde_json::from_slice(&fs::read(fixture_dir().join("0.json")).unwrap()).unwrap();
        let cache = cache_fixture();
        let mut invalid = Vec::new();
        let mut p = base.clone();
        p.name = "../polar_1_copia.png".into();
        invalid.push(p);
        let mut p = base.clone();
        p.width = 18426;
        invalid.push(p);
        let mut p = base.clone();
        p.height = 59056;
        invalid.push(p);
        let mut p = base.clone();
        p.pieces[0].source = 999;
        invalid.push(p);
        let mut p = base.clone();
        p.pieces[0].rotation = 45;
        invalid.push(p);
        let mut p = base.clone();
        p.pieces[0].width = 0.0;
        invalid.push(p);
        let mut p = base.clone();
        p.pieces[0].translate_x = f64::NAN;
        invalid.push(p);
        let mut p = base.clone();
        p.pieces[0].translate_x = -100.0;
        invalid.push(p);
        for p in invalid {
            assert!(render(
                &job(dir.path()),
                &cache,
                &p,
                &dir.path().join(&p.name),
                |_| {}
            )
            .is_err());
        }
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[test]
    fn rejects_invalid_truncated_and_mismatched_source_png() {
        let bytes = source_png(2, 1, &[255; 8]);
        assert!(decode_source(&bytes, 1, 2).is_err());
        assert!(decode_source(&bytes, 100_000, 100_000).is_err());
        assert!(decode_source(b"not png", 2, 1).is_err());
        assert!(decode_source(&bytes[..30], 2, 1).is_err());
        // Keep source fixtures valid independent of Skia's decoder.
        assert!(png::Decoder::new(Cursor::new(bytes)).read_info().is_ok());
    }
    #[test]
    fn validates_copy_names_and_suffixes() {
        for name in [
            "deportiva_1_copia.png",
            "deportiva_2_copias.png",
            "polar_96_copias_aa.png",
        ] {
            assert!(valid_filename(name));
        }
        for name in [
            "CON.png",
            "polar_0_copias.png",
            "polar_1_copias.png",
            "polar_2_copia.png",
            "../polar_1_copia.png",
            "C:\\polar_1_copia.png",
            "polar_1_copia.png:stream",
            "polar_1_copia_.png",
        ] {
            assert!(!valid_filename(name));
        }
    }
}

// Page reload/window destruction must release a job even if JS cannot send Abort.
pub(crate) fn cancel_abandoned(state: &ExportService) {
    let job = if let Ok(mut inner) = state.0.lock() {
        inner.session = None;
        inner.native.clone()
    } else {
        None
    };
    if let Some(job) = job {
        let _ = job.cancel();
        let shared = state.0.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Ok(mut cache) = job.cache.lock() {
                *cache = SourceCache::default();
            }
            if let Ok(mut inner) = shared.lock() {
                if inner.native.as_ref().is_some_and(|j| j.id == job.id) {
                    inner.native = None;
                }
            }
        });
    }
}

#[cfg(test)]
mod manual_benchmark {
    use super::*;
    use crate::png_export::start_session;
    use std::{
        fs::{self, File},
        io::{BufReader, Read},
    };

    /// Run through `node scripts/generate-png-reference.mjs --benchmark`.
    /// This is deliberately excluded from the normal test suite.
    #[test]
    #[ignore]
    fn manual_png_benchmark() {
        let directory =
            PathBuf::from(std::env::var("NESTRA_PNG_BENCH_DIR").expect("Use the benchmark driver"));
        let plan: NativePlan =
            serde_json::from_slice(&fs::read(directory.join("plan.json")).unwrap()).unwrap();
        let browser: serde_json::Value =
            serde_json::from_slice(&fs::read(directory.join("browser.json")).unwrap()).unwrap();
        let decode = Instant::now();
        let png = fs::read(directory.join("source.png")).unwrap();
        let image = decode_source(&png, 240, 300).unwrap();
        let decode_ms = decode.elapsed().as_secs_f64() * 1000.0;
        let cache = SourceCache {
            images: HashMap::from([(0, image)]),
            decoded_bytes: 240 * 300 * 4,
        };
        let job = NativeJob {
            id: "benchmark".into(),
            cancelled: AtomicBool::new(false),
            busy: AtomicBool::new(false),
            commit: Mutex::new(()),
            cache: Mutex::new(SourceCache::default()),
        };
        let result = render(&job, &cache, &plan, &directory.join(&plan.name), |_| {}).unwrap();

        // The old browser actually drew/extracted these RGB strips. Feed exactly
        // those bytes through the original streaming encoder, bounded by one strip.
        let legacy_start = Instant::now();
        let mut legacy = start_session(
            &directory,
            "legacy_1_copia.png",
            plan.width,
            plan.height,
            "legacy".into(),
        )
        .unwrap();
        let mut input = BufReader::new(File::open(directory.join("legacy.rgb")).unwrap());
        let mut bytes = vec![0; plan.width as usize * STRIP_ROWS as usize * 3];
        for y in (0..plan.height).step_by(STRIP_ROWS as usize) {
            let count = plan.width as usize * STRIP_ROWS.min(plan.height - y) as usize * 3;
            input.read_exact(&mut bytes[..count]).unwrap();
            legacy.append(&bytes[..count]).unwrap();
        }
        let legacy_path = legacy.finish().unwrap();
        let legacy_encode_read_ms = legacy_start.elapsed().as_secs_f64() * 1000.0;
        let mut a = png::Decoder::new(BufReader::new(File::open(&result.path).unwrap()))
            .read_info()
            .unwrap();
        let mut b = png::Decoder::new(BufReader::new(File::open(legacy_path).unwrap()))
            .read_info()
            .unwrap();
        let mut different_channels = 0u64;
        let mut max_delta = 0u8;
        for _ in 0..plan.height {
            let ar = a.next_row().unwrap().unwrap();
            let br = b.next_row().unwrap().unwrap();
            for (&av, &bv) in ar.data().iter().zip(br.data()) {
                if av != bv {
                    different_channels += 1;
                    max_delta = max_delta.max(av.abs_diff(bv));
                }
            }
        }
        let report = serde_json::json!({
            "dimensions": [plan.width, plan.height], "pieces": plan.pieces.len(), "sourceCount": 1,
            "browser": browser, "legacyEncodeAndSpoolReadMs": legacy_encode_read_ms,
            "legacyRenderDecodeEncodeMsExcludingTransport": browser["decodeMs"].as_f64().unwrap() + browser["renderMs"].as_f64().unwrap() + legacy_encode_read_ms,
            "nativeDecodeMs": decode_ms, "native": result.diagnostics,
            "oldIpcCallsIncludingFolder": (plan.height + 63) / 64 + 3,
            "newIpcCallsIncludingFolderAndClose": 5,
            "differentChannels": different_channels, "maxChannelDelta": max_delta,
            "transportNote": "Old raster transport was HTTP+spool for this benchmark, not actual Tauri IPC. Native timings exclude source IPC."
        });
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
        fs::write(
            directory.join("results.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
        assert!(
            max_delta <= 1,
            "Native/browser pixels differ beyond one 8-bit rounding level"
        );
    }
}

#[cfg(test)]
mod sampling_investigation {
    use super::*;
    #[test]
    #[ignore]
    fn investigate_sampling() {
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/png");
        let base: NativePlan =
            serde_json::from_slice(&std::fs::read(fixtures.join("2.json")).unwrap()).unwrap();
        let expected = std::fs::read(fixtures.join("2.rgb")).unwrap();
        let image =
            decode_source(&std::fs::read(fixtures.join("source.png")).unwrap(), 7, 5).unwrap();
        let cache = SourceCache {
            images: HashMap::from([(0, image)]),
            decoded_bytes: 140,
        };
        for field in ["x", "y", "width", "height"] {
            for delta in [-0.000002, -0.000001, 0.0, 0.000001, 0.000002] {
                let mut p = base.clone();
                match field {
                    "x" => p.pieces[0].translate_x += delta,
                    "y" => p.pieces[0].translate_y += delta,
                    "width" => p.pieces[0].width += delta,
                    _ => p.pieces[0].height += delta,
                }
                let dir = tempfile::tempdir().unwrap();
                let job = NativeJob {
                    id: "test".into(),
                    cancelled: AtomicBool::new(false),
                    busy: AtomicBool::new(false),
                    commit: Mutex::new(()),
                    cache: Mutex::new(SourceCache::default()),
                };
                let out = render(&job, &cache, &p, &dir.path().join(&p.name), |_| {}).unwrap();
                let mut reader = png::Decoder::new(std::io::BufReader::new(
                    std::fs::File::open(out.path).unwrap(),
                ))
                .read_info()
                .unwrap();
                let mut actual = vec![0; reader.output_buffer_size().unwrap()];
                reader.next_frame(&mut actual).unwrap();
                let count = actual.iter().zip(&expected).filter(|(a, b)| a != b).count();
                let max = actual
                    .iter()
                    .zip(&expected)
                    .map(|(a, b)| a.abs_diff(*b))
                    .max()
                    .unwrap();
                eprintln!("{field} {delta}: {count} / {max}");
            }
        }
    }
}
