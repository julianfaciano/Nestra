use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn is_supported_historical_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "jpg" | "jpeg" | "png" | "pdf"
    )
}

fn contains_supported_historical_file(folder: &Path) -> bool {
    let Ok(entries) = fs::read_dir(folder) else {
        return false;
    };

    entries
        .flatten()
        .any(|entry| is_supported_historical_file(&entry.path()))
}

/// Resolves the folders that the native history importer must inspect.
///
/// Legacy imports select a parent containing one folder per job. The folder
/// picker also allows selecting one job folder directly; in that case the
/// selected root itself is the candidate.
pub(crate) fn historical_job_directories(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut children = Vec::new();

    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();

        if path.is_dir() && contains_supported_historical_file(&path) {
            children.push(path);
        }
    }

    if !children.is_empty() {
        return Ok(children);
    }

    if contains_supported_historical_file(root) {
        return Ok(vec![root.to_path_buf()]);
    }

    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::historical_job_directories;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "nestra-historical-import-{label}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create fixture root");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn direct_job_fixture(name: &str) -> TestDirectory {
        let fixture = TestDirectory::new(name);
        let job = fixture.path().join(name);
        fs::create_dir(&job).expect("create job folder");
        fs::write(job.join("TELA DEPORTIVA 1 copia.pdf"), b"fixture")
            .expect("create representative file");
        fixture
    }

    #[test]
    fn accepts_a_selected_job_folder_directly_for_all_sep_casings() {
        for name in ["06-Sep-26", "06-SEP-26", "06-sep-26"] {
            let fixture = direct_job_fixture(name);
            let selected = fixture.path().join(name);

            assert_eq!(
                historical_job_directories(&selected).expect("resolve selected job"),
                vec![selected]
            );
        }
    }

    #[test]
    fn preserves_parent_folder_imports_and_ignores_empty_children() {
        let fixture = direct_job_fixture("06-Sep-26");
        fs::create_dir(fixture.path().join("empty")).expect("create empty folder");

        assert_eq!(
            historical_job_directories(fixture.path()).expect("resolve parent"),
            vec![fixture.path().join("06-Sep-26")]
        );
    }
}
