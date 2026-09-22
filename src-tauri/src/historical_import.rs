use crate::historical_import_paths::{historical_job_directories, is_supported_historical_file};
use image::codecs::jpeg::JpegEncoder;
use image::{ExtendedColorType, ImageReader, Rgb, RgbImage};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::Path;
use tauri::Manager;

const THUMBNAIL_MAX_PX: u32 = 900;
const THUMBNAIL_JPEG_QUALITY: u8 = 78;
const HEADER_READ_LIMIT: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalFile {
    name: String,
    path: String,
    size: u64,

    #[serde(rename = "type")]
    file_type: String,

    width_px: Option<u32>,
    height_px: Option<u32>,

    dpi_x: Option<f64>,
    dpi_y: Option<f64>,

    physical_width_cm: Option<f64>,
    physical_height_cm: Option<f64>,

    thumbnail_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalJob {
    name: String,
    path: String,
    files: Vec<HistoricalFile>,
}

struct InspectedImage {
    width_px: u32,
    height_px: u32,
    dpi_x: Option<f64>,
    dpi_y: Option<f64>,
    physical_width_cm: Option<f64>,
    physical_height_cm: Option<f64>,
    thumbnail_key: Option<String>,
}

fn read_header(path: &Path) -> Option<Vec<u8>> {
    let file = File::open(path).ok()?;
    let mut bytes = Vec::new();

    file.take(HEADER_READ_LIMIT).read_to_end(&mut bytes).ok()?;

    Some(bytes)
}

fn jpeg_density(path: &Path) -> Option<(f64, f64)> {
    let bytes = read_header(path)?;

    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }

    let mut cursor = 2usize;

    while cursor + 4 <= bytes.len() {
        if bytes[cursor] != 0xff {
            cursor += 1;
            continue;
        }

        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }

        if cursor >= bytes.len() {
            break;
        }

        let marker = bytes[cursor];
        cursor += 1;

        if marker == 0xd9 || marker == 0xda {
            break;
        }

        if matches!(marker, 0x01 | 0xd0..=0xd7) {
            continue;
        }

        if cursor + 2 > bytes.len() {
            break;
        }

        let segment_length = u16::from_be_bytes([bytes[cursor], bytes[cursor + 1]]) as usize;

        if segment_length < 2 || cursor + segment_length > bytes.len() {
            break;
        }

        let payload = &bytes[cursor + 2..cursor + segment_length];

        if marker == 0xe0 && payload.len() >= 12 && payload.get(0..5) == Some(b"JFIF\0") {
            let units = payload[7];

            let x_density = u16::from_be_bytes([payload[8], payload[9]]) as f64;
            let y_density = u16::from_be_bytes([payload[10], payload[11]]) as f64;

            if x_density <= 0.0 || y_density <= 0.0 {
                return None;
            }

            return match units {
                // dots per inch
                1 => Some((x_density, y_density)),

                // dots per centimeter
                2 => Some((x_density * 2.54, y_density * 2.54)),

                // aspect ratio only
                _ => None,
            };
        }

        cursor += segment_length;
    }

    None
}

fn png_density(path: &Path) -> Option<(f64, f64)> {
    let bytes = read_header(path)?;

    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

    if bytes.get(0..8) != Some(PNG_SIGNATURE) {
        return None;
    }

    let mut cursor = 8usize;

    while cursor + 12 <= bytes.len() {
        let length = u32::from_be_bytes([
            bytes[cursor],
            bytes[cursor + 1],
            bytes[cursor + 2],
            bytes[cursor + 3],
        ]) as usize;

        let chunk_type = &bytes[cursor + 4..cursor + 8];

        let data_start = cursor + 8;
        let data_end = data_start.checked_add(length)?;

        if data_end + 4 > bytes.len() {
            break;
        }

        if chunk_type == b"pHYs" && length == 9 {
            let x_ppm = u32::from_be_bytes([
                bytes[data_start],
                bytes[data_start + 1],
                bytes[data_start + 2],
                bytes[data_start + 3],
            ]);

            let y_ppm = u32::from_be_bytes([
                bytes[data_start + 4],
                bytes[data_start + 5],
                bytes[data_start + 6],
                bytes[data_start + 7],
            ]);

            let unit = bytes[data_start + 8];

            if unit == 1 && x_ppm > 0 && y_ppm > 0 {
                return Some((x_ppm as f64 * 0.0254, y_ppm as f64 * 0.0254));
            }

            return None;
        }

        cursor = data_end + 4;
    }

    None
}

fn raw_density(path: &Path, extension: &str) -> Option<(f64, f64)> {
    match extension {
        "jpg" | "jpeg" => jpeg_density(path),
        "png" => png_density(path),
        _ => None,
    }
}

/*
 * Los históricos muestran dos familias reales:
 *
 * ~17 000 px de ancho -> producción a ~300 PPI
 * ~8 500 px de ancho  -> producción a ~150 PPI
 *
 * Hay JPG viejos cuya metadata declara 96 PPI aunque sus dimensiones
 * encajan exactamente con el raster histórico de 150 PPI.
 *
 * Siempre confiamos primero en metadata cercana a 150/300.
 * Sólo usamos la inferencia por tamaño cuando esa metadata es claramente
 * incompatible con esos canvases históricos.
 */
fn effective_density(width_px: u32, raw: Option<(f64, f64)>) -> Option<(f64, f64)> {
    if let Some((x, y)) = raw {
        let near_150 = (135.0..=165.0).contains(&x) && (135.0..=165.0).contains(&y);

        let near_300 = (270.0..=330.0).contains(&x) && (270.0..=330.0).contains(&y);

        if near_150 || near_300 {
            return Some((x, y));
        }
    }

    if width_px >= 12_000 {
        return Some((300.0, 300.0));
    }

    if (6_500..=10_000).contains(&width_px) {
        return Some((150.0, 150.0));
    }

    raw
}

fn thumbnail_key(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();

    path.to_string_lossy().to_lowercase().hash(&mut hasher);

    format!("{:016x}.jpg", hasher.finish())
}

fn flatten_to_white(source: &image::RgbaImage) -> RgbImage {
    let mut target = RgbImage::new(source.width(), source.height());

    for (src, dst) in source.pixels().zip(target.pixels_mut()) {
        let alpha = src[3] as u16;
        let inverse = 255u16 - alpha;

        let blend = |channel: u8| -> u8 {
            (((channel as u16 * alpha) + (255u16 * inverse) + 127) / 255) as u8
        };

        *dst = Rgb([blend(src[0]), blend(src[1]), blend(src[2])]);
    }

    target
}

fn inspect_image(
    app: &tauri::AppHandle,
    path: &Path,
    extension: &str,
) -> Result<InspectedImage, String> {
    /*
     * Las dimensiones y la medida física NO dependen de poder
     * decodificar el raster completo para generar el thumbnail.
     *
     * Así, incluso si un JPG extraño no permite preview,
     * Historial conserva canvas y metros correctamente.
     */
    let dimension_reader = ImageReader::open(path)
        .map_err(|error| error.to_string())?
        .with_guessed_format()
        .map_err(|error| error.to_string())?;

    let (width_px, height_px) = dimension_reader
        .into_dimensions()
        .map_err(|error| error.to_string())?;

    let density = effective_density(width_px, raw_density(path, extension));

    let (dpi_x, dpi_y, physical_width_cm, physical_height_cm) = match density {
        Some((x, y)) if x > 0.0 && y > 0.0 => (
            Some(x),
            Some(y),
            Some(width_px as f64 / x * 2.54),
            Some(height_px as f64 / y * 2.54),
        ),

        _ => (None, None, None, None),
    };

    /*
     * Los JPG históricos grandes superan el límite de asignación
     * predeterminado del decoder. Son archivos locales elegidos
     * explícitamente por el usuario, así que para esta operación
     * controlada permitimos su decodificación completa.
     *
     * Procesamos sólo un archivo por vez.
     */
    let thumbnail_key = (|| -> Result<String, String> {
        let mut reader = ImageReader::open(path)
            .map_err(|error| error.to_string())?
            .with_guessed_format()
            .map_err(|error| error.to_string())?;

        reader.no_limits();

        let decoded = reader.decode().map_err(|error| error.to_string())?;

        let thumbnail = decoded.thumbnail(THUMBNAIL_MAX_PX, THUMBNAIL_MAX_PX);

        let rgba = thumbnail.to_rgba8();
        let rgb = flatten_to_white(&rgba);

        let mut encoded = Vec::new();

        JpegEncoder::new_with_quality(&mut encoded, THUMBNAIL_JPEG_QUALITY)
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                ExtendedColorType::Rgb8,
            )
            .map_err(|error| error.to_string())?;

        let key = thumbnail_key(path);

        let thumbnail_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?
            .join("historical-thumbnails");

        fs::create_dir_all(&thumbnail_dir).map_err(|error| error.to_string())?;

        fs::write(thumbnail_dir.join(&key), encoded).map_err(|error| error.to_string())?;

        Ok(key)
    })()
    .ok();

    Ok(InspectedImage {
        width_px,
        height_px,
        dpi_x,
        dpi_y,
        physical_width_cm,
        physical_height_cm,
        thumbnail_key,
    })
}

fn collect_historical_jobs(
    app: &tauri::AppHandle,
    root: &Path,
) -> Result<Vec<HistoricalJob>, String> {
    let mut jobs = Vec::new();

    for path in historical_job_directories(root)? {
        let mut files = Vec::new();

        let Ok(children) = fs::read_dir(&path) else {
            continue;
        };

        for child in children.flatten() {
            let p = child.path();

            let extension = p
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_lowercase();

            if !is_supported_historical_file(&p) {
                continue;
            }

            let Ok(metadata) = fs::metadata(&p) else {
                continue;
            };

            let inspected = if matches!(extension.as_str(), "jpg" | "jpeg" | "png") {
                inspect_image(app, &p, &extension).ok()
            } else {
                None
            };

            files.push(HistoricalFile {
                name: p
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("")
                    .to_string(),

                path: p.to_string_lossy().to_string(),

                size: metadata.len(),

                file_type: extension,

                width_px: inspected.as_ref().map(|image| image.width_px),

                height_px: inspected.as_ref().map(|image| image.height_px),

                dpi_x: inspected.as_ref().and_then(|image| image.dpi_x),

                dpi_y: inspected.as_ref().and_then(|image| image.dpi_y),

                physical_width_cm: inspected.as_ref().and_then(|image| image.physical_width_cm),

                physical_height_cm: inspected
                    .as_ref()
                    .and_then(|image| image.physical_height_cm),

                thumbnail_key: inspected
                    .as_ref()
                    .and_then(|image| image.thumbnail_key.clone()),
            });
        }

        files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        if !files.is_empty() {
            jobs.push(HistoricalJob {
                name: path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("")
                    .to_string(),

                path: path.to_string_lossy().to_string(),

                files,
            });
        }
    }

    Ok(jobs)
}

#[tauri::command]
pub async fn choose_historical_jobs(
    app: tauri::AppHandle,
) -> Result<Option<Vec<HistoricalJob>>, String> {
    /*
     * Tanto el diálogo nativo como el procesamiento de cientos de
     * imágenes ocurren fuera del hilo responsable de la ventana.
     */
    let root = tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().pick_folder())
        .await
        .map_err(|error| error.to_string())?;

    let Some(root) = root else {
        return Ok(None);
    };

    let jobs = tauri::async_runtime::spawn_blocking(move || collect_historical_jobs(&app, &root))
        .await
        .map_err(|error| error.to_string())??;

    Ok(Some(jobs))
}

#[tauri::command]
pub fn load_historical_thumbnail(app: tauri::AppHandle, key: String) -> Result<Vec<u8>, String> {
    let file_name = Path::new(&key).file_name().and_then(|value| value.to_str());

    if file_name != Some(key.as_str()) {
        return Err("Thumbnail histórico inválido.".to_string());
    }

    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("historical-thumbnails")
        .join(key);

    fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_historical_thumbnail(app: tauri::AppHandle, key: String) -> Result<(), String> {
    /*
     * Igual que al leer thumbnails, aceptamos
     * solamente un nombre de archivo simple.
     * Nunca una ruta arbitraria.
     */
    let file_name = Path::new(&key).file_name().and_then(|value| value.to_str());

    if file_name != Some(key.as_str()) {
        return Err("Thumbnail histórico inválido.".to_string());
    }

    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("historical-thumbnails")
        .join(key);

    match fs::remove_file(path) {
        Ok(()) => Ok(()),

        /*
         * Si ya había sido eliminado,
         * consideramos la limpieza exitosa.
         */
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),

        Err(error) => Err(error.to_string()),
    }
}
