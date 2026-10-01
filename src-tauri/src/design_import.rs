use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

const MAX_DESIGN_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_DESIGN_FILES: usize = 2000;

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
    ignored_file_count: usize,
}

fn read_design_folder(folder: PathBuf) -> Result<DesignFolderSelection, String> {
    let selection = read_design_folder_direct(folder, None)?;
    if selection.files.is_empty() {
        return Err("La carpeta seleccionada no contiene archivos PNG directos.".to_string());
    }
    Ok(selection)
}

fn read_design_folder_direct(
    folder: PathBuf,
    selected_names: Option<HashSet<String>>,
) -> Result<DesignFolderSelection, String> {
    let entries = fs::read_dir(&folder)
        .map_err(|error| format!("No se pudo leer la carpeta {}: {error}", folder.display()))?;
    let mut files = Vec::new();
    let mut ignored_file_count = 0;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("No se pudo leer un archivo de la carpeta: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("No se pudo leer {}: {error}", path.display()))?;
        if is_link(&metadata) || !metadata.is_file() {
            continue;
        }

        let is_png = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png"));
        if !is_png
            || selected_names.as_ref().is_some_and(|names| {
                !path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| names.contains(name))
            })
        {
            ignored_file_count += 1;
            continue;
        }
        if files.len() >= MAX_DESIGN_FILES {
            return Err(format!(
                "La carpeta contiene más de {MAX_DESIGN_FILES} archivos PNG."
            ));
        }
        if metadata.len() > MAX_DESIGN_FILE_BYTES {
            return Err(format!("{} supera el máximo de 32 MB.", path.display()));
        }
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("Nombre de archivo inválido: {}", path.display()))?
            .to_string();
        let bytes = fs::read(&path)
            .map_err(|error| format!("No se pudo leer {}: {error}", path.display()))?;
        files.push(DesignFolderFile {
            relative_path: format!(
                "{}/{}",
                folder
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(""),
                file_name
            ),
            file_name,
            bytes,
        });
    }

    files.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    Ok(DesignFolderSelection {
        source_folder_path: folder.to_string_lossy().to_string(),
        files,
        ignored_file_count,
    })
}

#[tauri::command]
pub async fn choose_design_folder() -> Result<Option<DesignFolderSelection>, String> {
    let folder = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Importar carpeta de diseño")
            .pick_folder()
    })
    .await
    .map_err(|error| format!("No se pudo abrir el selector de carpetas: {error}"))?;
    let Some(folder) = folder else {
        return Ok(None);
    };

    tauri::async_runtime::spawn_blocking(move || read_design_folder(folder))
        .await
        .map_err(|error| format!("No se pudo leer la carpeta: {error}"))?
        .map(Some)
}

#[tauri::command]
pub async fn choose_design_folders() -> Result<Option<Vec<String>>, String> {
    let folders = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Importar diseños")
            .pick_folders()
    })
    .await
    .map_err(|error| format!("No se pudo abrir el selector de carpetas: {error}"))?;
    Ok(folders.map(|paths| {
        paths
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect()
    }))
}

#[tauri::command]
pub async fn read_design_folder_from_path(path: String) -> Result<DesignFolderSelection, String> {
    read_design_folder(PathBuf::from(path))
}

#[tauri::command]
pub async fn read_design_folder_direct_from_path(
    path: String,
    file_names: Option<Vec<String>>,
) -> Result<DesignFolderSelection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_design_folder_direct(
            PathBuf::from(path),
            file_names.map(|names| names.into_iter().collect()),
        )
    })
    .await
    .map_err(|error| format!("No se pudo leer la carpeta: {error}"))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignSubfolder {
    path: String,
    name: String,
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn display_source_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignDirectory {
    path: String,
    name: String,
    png_file_names: Vec<String>,
    direct_file_count: usize,
    children: Vec<DesignSubfolder>,
    skipped_link_paths: Vec<String>,
}

fn inspect_directory(folder: PathBuf) -> Result<DesignDirectory, String> {
    let metadata = fs::symlink_metadata(&folder).map_err(|error| error.to_string())?;
    if is_link(&metadata) || !metadata.is_dir() {
        return Err(format!(
            "Se omitió un enlace/reparse point o una ruta que no es carpeta: {}",
            folder.display()
        ));
    }
    let folder = fs::canonicalize(&folder).map_err(|error| error.to_string())?;
    let mut result = DesignDirectory {
        path: display_source_path(&folder),
        name: folder
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string(),
        png_file_names: Vec::new(),
        direct_file_count: 0,
        children: Vec::new(),
        skipped_link_paths: Vec::new(),
    };
    for entry in fs::read_dir(&folder).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if is_link(&metadata) {
            result.skipped_link_paths.push(display_source_path(&path));
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if metadata.is_dir() {
            result.children.push(DesignSubfolder {
                path: display_source_path(&path),
                name,
            });
        } else if metadata.is_file() {
            result.direct_file_count += 1;
            if path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
            {
                result.png_file_names.push(name);
            }
        }
    }
    result
        .children
        .sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    result
        .png_file_names
        .sort_by_key(|name| name.to_lowercase());
    Ok(result)
}

#[tauri::command]
pub async fn inspect_design_directory(path: String) -> Result<DesignDirectory, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_directory(PathBuf::from(path)))
        .await
        .map_err(|error| format!("No se pudo inspeccionar la carpeta: {error}"))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignSourcePathStatus {
    path: String,
    missing: bool,
}

#[tauri::command]
pub async fn design_source_paths_status(
    paths: Vec<String>,
) -> Result<Vec<DesignSourcePathStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| {
                let missing = match fs::symlink_metadata(&path) {
                    Ok(_) => false,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
                    Err(error) => return Err(format!("No se pudo verificar {path}: {error}")),
                };
                Ok(DesignSourcePathStatus { path, missing })
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_design_subfolders(path: String) -> Result<Vec<DesignSubfolder>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = PathBuf::from(path);
        let entries = fs::read_dir(&folder)
            .map_err(|error| format!("No se pudo leer la carpeta {}: {error}", folder.display()))?;
        let mut children = Vec::new();
        for entry in entries {
            let entry = entry
                .map_err(|error| format!("No se pudo leer un elemento de la carpeta: {error}"))?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            if is_link(&metadata) || !metadata.is_dir() {
                continue;
            }
            let child_path = entry.path();
            let Some(name) = child_path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            children.push(DesignSubfolder {
                path: child_path.to_string_lossy().to_string(),
                name: name.to_string(),
            });
        }
        children.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(children)
    })
    .await
    .map_err(|error| format!("No se pudieron listar las subcarpetas: {error}"))?
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

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "nestra-design-import-test-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert!(self.0.starts_with(std::env::temp_dir()));
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn inspects_dot_directories_without_absorbing_children() {
        let fixture = Fixture::new();
        let root = fixture.0.join(".fanaticotas");
        let child = root.join(".design");
        fs::create_dir_all(&child).unwrap();
        fs::write(root.join("PARENT_T8-FRENTE.png"), b"parent").unwrap();
        fs::write(root.join("notes.txt"), b"notes").unwrap();
        fs::write(child.join("CHILD_T1-DORSO.PNG"), b"child").unwrap();
        let result = inspect_directory(root.clone()).unwrap();
        assert_eq!(result.name, ".fanaticotas");
        assert_eq!(result.direct_file_count, 2);
        assert_eq!(result.png_file_names, vec!["PARENT_T8-FRENTE.png"]);
        assert_eq!(result.children.len(), 1);
        assert_eq!(result.children[0].name, ".design");
        assert_eq!(inspect_directory(child).unwrap().direct_file_count, 1);
        let files = read_design_folder_direct(root, None).unwrap();
        assert_eq!(files.files.len(), 1);
        assert_eq!(files.files[0].bytes, b"parent");
    }

    #[test]
    fn reads_only_selected_direct_assets_and_counts_ignored_files() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("DES_T8-FRENTE.png"), b"front").unwrap();
        fs::write(fixture.0.join("unrelated.png"), b"unrelated").unwrap();
        fs::write(fixture.0.join("notes.txt"), b"notes").unwrap();
        let selection = read_design_folder_direct(
            fixture.0.clone(),
            Some(HashSet::from(["DES_T8-FRENTE.png".to_string()])),
        )
        .unwrap();
        assert_eq!(selection.files.len(), 1);
        assert_eq!(selection.ignored_file_count, 2);
        assert_eq!(selection.files[0].bytes, b"front");
    }

    #[cfg(windows)]
    #[test]
    fn skips_windows_junctions_including_cycles() {
        let fixture = Fixture::new();
        let junction = fixture.0.join("cycle");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&fixture.0)
            .output()
            .unwrap();
        assert!(status.status.success());
        let result = inspect_directory(fixture.0.clone()).unwrap();
        let root_result = inspect_directory(junction.clone());
        fs::remove_dir(&junction).unwrap();
        assert!(result.children.is_empty());
        assert_eq!(result.skipped_link_paths.len(), 1);
        assert!(root_result.is_err());
    }
}
