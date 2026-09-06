use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

const MAX_DESIGN_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_DESIGN_FILES: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignFolderFile {
    file_name: String,
    relative_path: String,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignFolderSelection {
    source_folder_path: String,
    files: Vec<DesignFolderFile>,
}

fn collect_png_files(
    root: &Path,
    current: &Path,
    root_name: &str,
    output: &mut Vec<DesignFolderFile>,
) -> Result<(), String> {
    let entries = fs::read_dir(current)
        .map_err(|error| format!("No se pudo leer la carpeta {}: {error}", current.display()))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("No se pudo leer un archivo de la carpeta: {error}"))?;

        let path = entry.path();

        if path.is_dir() {
            collect_png_files(root, &path, root_name, output)?;

            continue;
        }

        let is_png = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png"));

        if !is_png {
            continue;
        }

        if output.len() >= MAX_DESIGN_FILES {
            return Err(format!(
                "La carpeta contiene más de {MAX_DESIGN_FILES} archivos PNG."
            ));
        }

        let metadata = fs::metadata(&path)
            .map_err(|error| format!("No se pudo leer {}: {error}", path.display()))?;

        if metadata.len() > MAX_DESIGN_FILE_BYTES {
            return Err(format!("{} supera el máximo de 32 MB.", path.display()));
        }

        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("Nombre de archivo inválido: {}", path.display()))?
            .to_string();

        let relative_inside_folder = path
            .strip_prefix(root)
            .map_err(|_| {
                format!(
                    "No se pudo calcular la ruta relativa de {}.",
                    path.display()
                )
            })?
            .to_string_lossy()
            .replace('\\', "/");

        let relative_path = format!("{root_name}/{relative_inside_folder}");

        let bytes = fs::read(&path)
            .map_err(|error| format!("No se pudo leer {}: {error}", path.display()))?;

        output.push(DesignFolderFile {
            file_name,
            relative_path,
            bytes,
        });
    }

    Ok(())
}

fn read_design_folder(folder: PathBuf) -> Result<DesignFolderSelection, String> {
    let root_name = folder
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "La carpeta seleccionada no tiene un nombre válido.".to_string())?
        .to_string();

    let mut files = Vec::new();

    collect_png_files(&folder, &folder, &root_name, &mut files)?;

    files.sort_by(|a, b| {
        a.relative_path
            .to_lowercase()
            .cmp(&b.relative_path.to_lowercase())
    });

    if files.is_empty() {
        return Err("La carpeta seleccionada no contiene archivos PNG.".to_string());
    }

    Ok(DesignFolderSelection {
        source_folder_path: folder.to_string_lossy().to_string(),
        files,
    })
}

#[tauri::command]
pub async fn choose_design_folder() -> Result<Option<DesignFolderSelection>, String> {
    let Some(folder) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };

    read_design_folder(folder).map(Some)
}

#[tauri::command]
pub async fn read_design_folder_from_path(path: String) -> Result<DesignFolderSelection, String> {
    read_design_folder(PathBuf::from(path))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreePngSelection {
    file_name: String,
    bytes: Vec<u8>,
}

fn read_free_png(path: &Path) -> Result<FreePngSelection, String> {
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("png"))
    {
        return Err("Solo se permiten archivos PNG.".to_string());
    }
    let metadata =
        fs::metadata(path).map_err(|error| format!("No se pudo leer el PNG: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_DESIGN_FILE_BYTES {
        return Err("El PNG debe ser un archivo de hasta 32 MB.".to_string());
    }
    let bytes = fs::read(path).map_err(|error| format!("No se pudo leer el PNG: {error}"))?;
    if bytes.len() > MAX_DESIGN_FILE_BYTES as usize || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("El archivo seleccionado no es un PNG válido de hasta 32 MB.".to_string());
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Nombre de archivo inválido.".to_string())?
        .to_string();
    Ok(FreePngSelection { file_name, bytes })
}

#[tauri::command]
pub async fn choose_free_png() -> Result<Option<FreePngSelection>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("PNG", &["png"])
        .pick_file()
    else {
        return Ok(None);
    };
    read_free_png(&path).map(Some)
}
