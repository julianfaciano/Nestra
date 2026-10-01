use std::{
    io::{Cursor, Write},
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};

const MAX_MOLD_PNG_BYTES: usize = 32 * 1024 * 1024;
const MAX_MOLD_PNG_PIXELS: u64 = 16_000_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignOutputFolder {
    path: String,
    name: String,
}

#[derive(Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MoldWriteResult {
    status: String,
    file_name: String,
    path: String,
}

#[tauri::command]
pub async fn choose_molds_output_folder() -> Result<Option<DesignOutputFolder>, String> {
    let folder = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Elegir carpeta del diseño")
            .pick_folder()
    })
    .await
    .map_err(|error| format!("No se pudo abrir el selector de carpetas: {error}"))?;
    Ok(folder.map(|path| DesignOutputFolder {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Diseño")
            .to_string(),
        path: path.to_string_lossy().to_string(),
    }))
}

fn decode_hex_path(value: &str) -> Result<PathBuf, String> {
    if value.len() % 2 != 0 || value.len() > 8192 {
        return Err("Ruta de salida inválida.".into());
    }
    let bytes = (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Ruta de salida inválida.".to_string())?;
    let path = String::from_utf8(bytes)
        .map_err(|_| "La ruta de salida no es UTF-8 válido.".to_string())?;
    Ok(PathBuf::from(path))
}

fn valid_mold_filename(file_name: &str) -> bool {
    if file_name.len() > 120 || !file_name.ends_with(".png") {
        return false;
    }
    let Some(stem) = file_name.strip_suffix(".png") else {
        return false;
    };
    let Some((prefix_and_sequence, slot)) = stem.rsplit_once('_') else {
        return false;
    };
    let Some((prefix, sequence)) = prefix_and_sequence.rsplit_once('_') else {
        return false;
    };
    let Some((size, side)) = slot.split_once('-') else {
        return false;
    };
    if prefix.is_empty()
        || prefix.len() > 32
        || prefix.to_ascii_lowercase().contains("nom")
        || !prefix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        || sequence.len() != 4
        || !sequence.bytes().all(|byte| byte.is_ascii_digit())
    {
        return false;
    }
    let Ok(size_number) = size.strip_prefix('T').unwrap_or("").parse::<u8>() else {
        return false;
    };
    if !(1..=10).contains(&size_number) {
        return false;
    }
    let side_index = match side {
        "FRENTE" => 0,
        "DORSO" => 1,
        _ => return false,
    };
    sequence.parse::<u8>().ok() == Some((size_number - 1) * 2 + side_index)
}

fn validate_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_MOLD_PNG_BYTES
        || bytes.len() < 33
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
    {
        return Err("El resultado no es un PNG válido de hasta 32 MiB.".into());
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: MAX_MOLD_PNG_BYTES,
    });
    let mut reader = decoder
        .read_info()
        .map_err(|error| format!("PNG inválido: {error}"))?;
    let dimensions = reader.info();
    let width = dimensions.width;
    let height = dimensions.height;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_MOLD_PNG_PIXELS {
        return Err("El PNG supera el límite de 16 MP.".into());
    }
    let mut decoded = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("Dimensiones PNG inválidas.")?
    ];
    reader
        .next_frame(&mut decoded)
        .map_err(|error| format!("No se pudo decodificar el PNG: {error}"))?;
    Ok(())
}

fn write_mold_png_to(
    folder: &Path,
    file_name: &str,
    bytes: &[u8],
    replace_existing: bool,
) -> Result<MoldWriteResult, String> {
    if !valid_mold_filename(file_name) {
        return Err("Nombre de molde no válido para Biblioteca.".into());
    }
    validate_png(bytes)?;
    let folder = folder
        .canonicalize()
        .map_err(|error| format!("Carpeta de salida no disponible: {error}"))?;
    if !folder.is_dir() {
        return Err("La salida debe ser una carpeta existente.".into());
    }
    let destination = folder.join(file_name);
    if destination.parent() != Some(folder.as_path()) {
        return Err("El archivo debe guardarse directamente en la carpeta del diseño.".into());
    }
    let existed = destination.exists();
    if existed && !replace_existing {
        return Ok(MoldWriteResult {
            status: "skipped".into(),
            file_name: file_name.to_string(),
            path: destination.to_string_lossy().to_string(),
        });
    }

    let mut temporary =
        tempfile::NamedTempFile::new_in(&folder).map_err(|error| error.to_string())?;
    temporary
        .write_all(bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    if replace_existing {
        temporary
            .persist(&destination)
            .map_err(|error| error.error.to_string())?;
    } else if let Err(error) = temporary.persist_noclobber(&destination) {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            return Ok(MoldWriteResult {
                status: "skipped".into(),
                file_name: file_name.to_string(),
                path: destination.to_string_lossy().to_string(),
            });
        }
        return Err(error.error.to_string());
    }
    Ok(MoldWriteResult {
        status: if existed { "replaced" } else { "created" }.into(),
        file_name: file_name.to_string(),
        path: destination.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn write_mold_png(request: Request<'_>) -> Result<MoldWriteResult, String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| format!("Falta el encabezado {name}."))
    };
    let folder = decode_hex_path(header("x-nestra-folder-utf8-hex")?)?;
    let file_name = header("x-nestra-file-name")?.to_string();
    let replace = header("x-nestra-replace")? == "1";
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaban bytes binarios PNG.".into());
    };
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        write_mold_png_to(&folder, &file_name, &bytes, replace)
    })
    .await
    .map_err(|error| format!("No se pudo guardar el PNG: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn png() -> Vec<u8> {
        let mut output = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut output, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[0, 0, 0, 0]).unwrap();
        }
        output
    }

    #[test]
    fn writes_direct_files_skips_conflicts_and_replaces_only_on_request() {
        let folder = tempfile::tempdir().unwrap();
        let file_name = "BOCA26_0000_T1-FRENTE.png";
        let data = png();
        assert_eq!(
            write_mold_png_to(folder.path(), file_name, &data, false)
                .unwrap()
                .status,
            "created"
        );
        assert_eq!(
            write_mold_png_to(folder.path(), file_name, &data, false)
                .unwrap()
                .status,
            "skipped"
        );
        assert_eq!(
            write_mold_png_to(folder.path(), file_name, &data, true)
                .unwrap()
                .status,
            "replaced"
        );
        assert_eq!(fs::read(folder.path().join(file_name)).unwrap(), data);
    }

    #[test]
    fn failed_atomic_replace_does_not_leave_a_temporary_file() {
        let folder = tempfile::tempdir().unwrap();
        let file_name = "BOCA26_0000_T1-FRENTE.png";
        let destination = folder.path().join(file_name);
        fs::create_dir(&destination).unwrap();

        assert!(write_mold_png_to(folder.path(), file_name, &png(), true).is_err());
        assert!(destination.is_dir());

        let entries = fs::read_dir(folder.path())
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file_name(), file_name);
    }

    #[test]
    fn rejects_invalid_names_and_corrupt_pngs_without_creating_files() {
        let folder = tempfile::tempdir().unwrap();
        assert!(write_mold_png_to(folder.path(), "BAD_0001_T1-FRENTE.png", &png(), false).is_err());
        assert!(
            write_mold_png_to(folder.path(), "BOCA_0000_T1-FRENTE.png", b"not png", false).is_err()
        );
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 0);
    }
}
