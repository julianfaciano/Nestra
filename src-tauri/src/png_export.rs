use std::{
    fs::File,
    io::{BufWriter, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{
    ipc::{InvokeBody, Request},
    State,
};

const PPM_300: u32 = 11811;
const MAX_STRIP_BYTES: usize = 8 * 1024 * 1024;

pub(crate) struct Session {
    id: String,
    writer: png::StreamWriter<'static, BufWriter<File>>,
    temporary: tempfile::NamedTempFile,
    destination: PathBuf,
    expected: usize,
    written: usize,
}
#[derive(Default)]
pub(crate) struct ExportState {
    pub(crate) folder: Option<PathBuf>,
    pub(crate) session: Option<Session>,
    pub(crate) sequence: u64,
    pub(crate) native: Option<Arc<crate::native_png::NativeJob>>,
}
#[derive(Default, Clone)]
pub struct ExportService(pub(crate) Arc<Mutex<ExportState>>);

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub(crate) fn valid_filename(name: &str) -> bool {
    if name.len() > 100 || !name.ends_with(".png") {
        return false;
    }

    let stem = &name[..name.len() - 4];

    if stem.is_empty()
        || !stem
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
    {
        return false;
    }

    let parts: Vec<&str> = stem.split('_').collect();

    if parts.len() < 3 || parts.iter().any(|part| part.is_empty()) {
        return false;
    }

    let last = parts.len() - 1;

    let (count_index, copy_label_index, suffix_index) =
        if parts[last] == "copia" || parts[last] == "copias" {
            (last - 1, last, None)
        } else {
            if last < 2 {
                return false;
            }

            let label_index = last - 1;

            if parts[label_index] != "copia" && parts[label_index] != "copias" {
                return false;
            }

            if !parts[last].bytes().all(|c| c.is_ascii_lowercase()) {
                return false;
            }

            (last - 2, label_index, Some(last))
        };

    if count_index == 0 {
        return false;
    }

    let Ok(copies) = parts[count_index].parse::<u32>() else {
        return false;
    };

    if copies == 0 {
        return false;
    }

    let copy_label = parts[copy_label_index];

    if copies == 1 && copy_label != "copia" {
        return false;
    }

    if copies > 1 && copy_label != "copias" {
        return false;
    }

    if suffix_index.is_some() && copy_label_index + 1 != last {
        return false;
    }

    true
}

pub(crate) fn start_session(
    folder: &Path,
    name: &str,
    width: u32,
    height: u32,
    id: String,
) -> Result<Session, String> {
    if !valid_filename(name) {
        return Err("Nombre de archivo no válido.".into());
    }
    // floor(mm / 25.4 * 300): never advertise a raster larger than the physical maximum.
    if width == 0 || height == 0 || width > 17480 || height > 59055 {
        return Err("Dimensiones PNG fuera del máximo físico de 1480 × 5000 mm.".into());
    }
    start_session_at(&folder.join(name), width, height, id)
}

pub(crate) fn valid_destination(destination: &Path) -> bool {
    let Some(name) = destination.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if name.is_empty() || name.len() > 255 || !name.to_ascii_lowercase().ends_with(".png") {
        return false;
    }
    let stem = &name[..name.len() - 4];
    if stem.is_empty()
        || stem == "."
        || stem == ".."
        || stem
            .chars()
            .any(|c| "<>:\"/\\|?*".contains(c) || c.is_control())
    {
        return false;
    }
    if ["CON", "PRN", "AUX", "NUL"]
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    {
        return false;
    }
    destination.parent().is_some_and(|parent| parent.is_dir())
}

fn export_suffix(index: usize) -> String {
    let mut value = index + 1;
    let mut result = String::new();

    while value > 0 {
        value -= 1;

        result.insert(0, (b'a' + (value % 26) as u8) as char);

        value /= 26;
    }

    result
}

fn export_suffix_index(value: &str) -> Option<usize> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_lowercase()) {
        return None;
    }

    let mut result = 0usize;

    for byte in value.bytes() {
        result = result
            .checked_mul(26)?
            .checked_add((byte - b'a' + 1) as usize)?;
    }

    result.checked_sub(1)
}

fn automatic_export_name_parts(name: &str) -> Result<(String, usize), String> {
    if !valid_filename(name) {
        return Err("Nombre de archivo automático no válido.".into());
    }

    let stem = name.strip_suffix(".png").ok_or("Nombre PNG no válido.")?;

    let parts: Vec<&str> = stem.split('_').collect();

    if parts.len() >= 4 {
        let suffix = parts[parts.len() - 1];
        let copy_word = parts[parts.len() - 2];
        let quantity = parts[parts.len() - 3];

        if matches!(copy_word, "copia" | "copias") && quantity.parse::<u32>().is_ok() {
            if let Some(index) = export_suffix_index(suffix) {
                let suffix_text = format!("_{suffix}");

                if let Some(base) = stem.strip_suffix(&suffix_text) {
                    return Ok((base.to_string(), index));
                }
            }
        }
    }

    Ok((stem.to_string(), 0))
}

fn available_export_destination(folder: &Path, suggested_name: &str) -> Result<PathBuf, String> {
    if !folder.is_dir() {
        return Err("La carpeta de exportación ya no existe.".into());
    }

    let (base, starting_index) = automatic_export_name_parts(suggested_name)?;

    for index in starting_index..10_000 {
        let file_name = if index == 0 {
            format!("{base}.png")
        } else {
            format!("{base}_{}.png", export_suffix(index))
        };

        let destination = folder.join(file_name);

        if !destination.exists() {
            return Ok(destination);
        }
    }

    Err("No se pudo encontrar un nombre de archivo disponible.".into())
}

#[tauri::command]
pub fn resolve_export_destination(
    suggested_name: String,
    state: State<'_, ExportService>,
) -> Result<String, String> {
    let folder = {
        let inner = state.0.lock().map_err(error)?;

        inner
            .folder
            .clone()
            .ok_or("Seleccioná la carpeta de salida.")?
    };

    let destination = available_export_destination(&folder, &suggested_name)?;

    Ok(destination.to_string_lossy().into_owned())
}

pub(crate) fn start_session_at(
    destination: &Path,
    width: u32,
    height: u32,
    id: String,
) -> Result<Session, String> {
    if !valid_destination(destination) {
        return Err("Destino PNG no válido.".into());
    }
    if width == 0 || height == 0 || width > 17480 || height > 59055 {
        return Err("Dimensiones PNG fuera del máximo físico de 1480 × 5000 mm.".into());
    }
    if destination.exists() {
        return Err("Ya existe ese archivo. Elegí otro nombre o ubicación.".into());
    }
    let folder = destination.parent().ok_or("Destino PNG no válido.")?;
    let temporary = tempfile::Builder::new()
        .prefix(".nestra-")
        .suffix(".partial")
        .tempfile_in(folder)
        .map_err(error)?;
    let mut encoder = png::Encoder::new(
        BufWriter::with_capacity(1024 * 1024, temporary.reopen().map_err(error)?),
        width,
        height,
    );
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_deflate_compression(png::DeflateCompression::Level(9));
    encoder.set_filter(png::Filter::MinEntropy);
    encoder.set_pixel_dims(Some(png::PixelDimensions {
        xppu: PPM_300,
        yppu: PPM_300,
        unit: png::Unit::Meter,
    }));
    let writer = encoder
        .write_header()
        .map_err(error)?
        .into_stream_writer()
        .map_err(error)?;
    Ok(Session {
        id,
        writer,
        temporary,
        destination: destination.to_path_buf(),
        expected: width as usize * height as usize * 3,
        written: 0,
    })
}

impl Session {
    pub(crate) fn append(&mut self, bytes: &[u8]) -> Result<(), String> {
        if bytes.is_empty() || self.written + bytes.len() > self.expected {
            return Err("Franja vacía o fuera de secuencia.".into());
        }
        self.writer.write_all(bytes).map_err(error)?;
        self.written += bytes.len();
        Ok(())
    }
    pub(crate) fn finish(self) -> Result<String, String> {
        if self.written != self.expected {
            return Err("PNG incompleto; no se publicó el archivo.".into());
        }
        self.writer.finish().map_err(error)?;
        // png 0.17 writes IEND on drop of its owned writer; verify it before publishing.
        let mut file = self.temporary.reopen().map_err(error)?;
        file.seek(SeekFrom::End(-12)).map_err(error)?;
        let mut end = [0; 12];
        file.read_exact(&mut end).map_err(error)?;
        if end != [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130] {
            return Err("PNG sin cierre válido.".into());
        }
        file.sync_all().map_err(error)?;
        drop(file);
        self.temporary
            .persist_noclobber(&self.destination)
            .map_err(error)?;
        Ok(self.destination.to_string_lossy().into_owned())
    }
}

#[tauri::command]
pub async fn choose_export_folder(
    window: tauri::WebviewWindow,
    state: State<'_, ExportService>,
) -> Result<bool, String> {
    let parent = window.clone();

    let folder = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("Export As")
            .set_parent(&parent)
            .pick_folder()
    })
    .await
    .map_err(error)?;

    let mut inner = state.0.lock().map_err(error)?;

    if inner.session.is_some() || inner.native.is_some() {
        return Err("Ya hay una exportación en curso.".into());
    }

    inner.folder = folder;

    Ok(inner.folder.is_some())
}

#[tauri::command]
pub async fn choose_export_file(suggested_name: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(rfd::FileDialog::new()
            .set_title("Export As")
            .add_filter("PNG", &["png"])
            .set_file_name(&suggested_name)
            .save_file()
            .map(|path| path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub fn begin_png(
    name: String,
    width: u32,
    height: u32,
    state: State<'_, ExportService>,
) -> Result<String, String> {
    let mut inner = state.0.lock().map_err(error)?;
    if inner.session.is_some() || inner.native.is_some() {
        return Err("Ya hay una exportación en curso.".into());
    }
    let folder = inner
        .folder
        .clone()
        .ok_or("Seleccioná la carpeta de salida.")?;
    inner.sequence += 1;
    let id = inner.sequence.to_string();
    inner.session = Some(start_session(&folder, &name, width, height, id.clone())?);
    Ok(id)
}

#[tauri::command]
pub async fn write_png_strip(
    request: Request<'_>,
    state: State<'_, ExportService>,
) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-nestra-session")
        .and_then(|v| v.to_str().ok())
        .ok_or("Falta sesión.")?
        .to_owned();
    let offset: usize = request
        .headers()
        .get("x-nestra-offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or("Falta offset.")?;
    let InvokeBody::Raw(body) = request.body() else {
        return Err("Se esperaban bytes binarios.".into());
    };
    if body.len() > MAX_STRIP_BYTES {
        return Err("Franja demasiado grande.".into());
    }
    let bytes = body.clone();
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut inner = shared.lock().map_err(error)?;
        let session = inner.session.as_mut().ok_or("No hay exportación activa.")?;
        if session.id != id || session.written != offset {
            return Err("Sesión o secuencia incorrecta.".into());
        }
        if let Err(err) = session.append(&bytes) {
            inner.session = None;
            return Err(err);
        }
        Ok(())
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub async fn finish_png(id: String, state: State<'_, ExportService>) -> Result<String, String> {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut inner = shared.lock().map_err(error)?;
        if inner.session.as_ref().map(|s| &s.id) != Some(&id) {
            return Err("Sesión incorrecta.".into());
        }
        inner
            .session
            .take()
            .ok_or("No hay exportación activa.")?
            .finish()
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub fn abort_png(id: String, state: State<'_, ExportService>) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(error)?;
    if inner.session.as_ref().map(|s| &s.id) == Some(&id) {
        inner.session = None;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automatic_export_destinations_use_letter_suffixes() {
        let dir = tempfile::tempdir().unwrap();

        let first = available_export_destination(dir.path(), "deportiva_2_copias.png").unwrap();

        assert_eq!(
            first.file_name().unwrap().to_string_lossy(),
            "deportiva_2_copias.png"
        );

        std::fs::write(&first, b"existing").unwrap();

        let second = available_export_destination(dir.path(), "deportiva_2_copias.png").unwrap();

        assert_eq!(
            second.file_name().unwrap().to_string_lossy(),
            "deportiva_2_copias_b.png"
        );

        std::fs::write(&second, b"existing").unwrap();

        let third = available_export_destination(dir.path(), "deportiva_2_copias_b.png").unwrap();

        assert_eq!(
            third.file_name().unwrap().to_string_lossy(),
            "deportiva_2_copias_c.png"
        );
    }
    #[test]
    fn accepts_manual_png_destinations_without_automatic_name_pattern() {
        let dir = tempfile::tempdir().unwrap();
        assert!(valid_destination(&dir.path().join("mi diseño final.PNG")));
        assert!(!valid_destination(&dir.path().join("CON.png")));
        assert!(!valid_destination(&dir.path().join("bad?.png")));
        assert!(!valid_destination(&dir.path().join("sin-extension.jpg")));
    }

    #[test]
    fn selected_destination_publishes_exactly_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("nombre-manual.png");
        let mut session = start_session_at(&destination, 1, 1, "test".into()).unwrap();
        session.append(&[1, 2, 3]).unwrap();
        assert_eq!(session.finish().unwrap(), destination.to_string_lossy());
        assert!(start_session_at(&destination, 1, 1, "test2".into()).is_err());
    }
    #[test]
    fn writes_rgb_and_300_ppi_in_multiple_strips() {
        let dir = tempfile::tempdir().unwrap();
        let mut session =
            start_session(dir.path(), "polar_1_copia.png", 2, 2, "test".into()).unwrap();
        session.append(&[255, 255, 255, 255, 0, 0]).unwrap();
        session.append(&[0, 255, 0, 0, 0, 255]).unwrap();
        let path = session.finish().unwrap();
        let mut reader = png::Decoder::new(std::io::BufReader::new(File::open(path).unwrap()))
            .read_info()
            .unwrap();
        assert_eq!(reader.info().pixel_dims.unwrap().xppu, PPM_300);
        assert_eq!(reader.info().pixel_dims.unwrap().unit, png::Unit::Meter);
        let mut data = vec![0; reader.output_buffer_size().unwrap()];
        let output = reader.next_frame(&mut data).unwrap();
        assert_eq!((output.width, output.height), (2, 2));
        assert_eq!(data, [255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    }
    #[test]
    fn incomplete_output_is_not_published() {
        let dir = tempfile::tempdir().unwrap();
        let session = start_session(dir.path(), "polar_1_copia.png", 2, 2, "test".into()).unwrap();
        assert!(session.finish().is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[test]
    fn forbids_overwrite_paths_and_oversized_images() {
        let dir = tempfile::tempdir().unwrap();
        assert!(start_session(dir.path(), "../polar_1_copia.png", 2, 2, "a".into()).is_err());
        assert!(start_session(dir.path(), "polar_1_copia.png", 17481, 2, "a".into()).is_err());
        assert!(start_session(dir.path(), "polar_1_copia.png", 2, 59056, "a".into()).is_err());
        std::fs::write(dir.path().join("polar_1_copia.png"), b"original").unwrap();
        assert!(start_session(dir.path(), "polar_1_copia.png", 2, 2, "a".into()).is_err());
        assert_eq!(
            std::fs::read(dir.path().join("polar_1_copia.png")).unwrap(),
            b"original"
        );
    }
}
