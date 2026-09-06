//! PNG sources cross IPC once; all final raster strips remain in the backend.
use crate::png_export::{start_session_at, valid_filename, ExportService};
use serde::{Deserialize, Serialize};
use skia_safe::{
    canvas::SrcRectConstraint, images, surfaces, AlphaType, Codec, CodecResult, Color, ColorSpace,
    ColorType, CubicResampler, Data, FilterMode, Image, ImageInfo, MipmapMode, Paint, Rect,
    SamplingOptions,
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
    pub name: String,
    pub width: u32,
    pub height: u32,
    // Pixel coordinates derived from the unchanged physical export plan at 300 PPI.
    pub offset_x: f64,
    pub offset_y: f64,
    pub pieces: Vec<NativePiece>,
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
    if !valid_filename(&plan.name)
        || plan.width == 0
        || plan.width > 17480
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
    let mut rgba = vec![0; plan.width as usize * rows as usize * 4];
    let mut rgb = vec![0; plan.width as usize * rows as usize * 3];
    diagnostics.raster_working_bytes = rgba.len() + rgb.len();
    let mut surface = surfaces::wrap_pixels(&info, &mut rgba, None, None)
        .ok_or("No se pudo crear la franja nativa.")?;
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
        p.width = 17481;
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
