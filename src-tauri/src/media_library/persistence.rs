use crate::media_library::models::{
    LibraryIndex, LibraryIndexLoadResult, LibraryIndexLoadStatus, LibraryScanResult,
    LibrarySettings,
};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;

pub(crate) const LIBRARY_INDEX_SCHEMA_VERSION: u32 = 1;

pub(crate) fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|_| "Could not locate the application settings folder.".to_string())?;
    Ok(config_dir.join("settings.json"))
}

pub(crate) fn library_index_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Could not locate the application data folder.".to_string())?;
    Ok(data_dir.join("library-index.json"))
}

pub(crate) fn read_library_settings(path: &Path) -> Result<LibrarySettings, SettingsError> {
    if !path.exists() {
        return Ok(LibrarySettings { library_root: None });
    }

    let contents = fs::read_to_string(path)
        .map_err(|source| SettingsError::new("Could not read library settings.", source))?;
    serde_json::from_str(&contents)
        .map_err(|source| SettingsError::new("Could not parse library settings.", source))
}

pub(crate) fn write_library_settings(
    path: &Path,
    settings: &LibrarySettings,
) -> Result<(), SettingsError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| {
            SettingsError::new("Could not create the application settings folder.", source)
        })?;
    }

    let contents = serde_json::to_string_pretty(settings)
        .map_err(|source| SettingsError::new("Could not serialize library settings.", source))?;
    fs::write(path, contents)
        .map_err(|source| SettingsError::new("Could not save library settings.", source))
}

impl From<LibraryScanResult> for LibraryIndex {
    fn from(scan_result: LibraryScanResult) -> Self {
        Self {
            schema_version: LIBRARY_INDEX_SCHEMA_VERSION,
            root_path: scan_result.root_path,
            songs: scan_result.songs,
            issues: scan_result.issues,
            scanned_directory_count: scan_result.scanned_directory_count,
            scanned_file_count: scan_result.scanned_file_count,
            supported_file_count: scan_result.supported_file_count,
            audio_file_count: scan_result.audio_file_count,
            lyric_file_count: scan_result.lyric_file_count,
            completed_at: scan_result.completed_at,
        }
    }
}

impl From<LibraryIndex> for LibraryScanResult {
    fn from(index: LibraryIndex) -> Self {
        Self {
            root_path: index.root_path,
            songs: index.songs,
            issues: index.issues,
            scanned_directory_count: index.scanned_directory_count,
            scanned_file_count: index.scanned_file_count,
            supported_file_count: index.supported_file_count,
            audio_file_count: index.audio_file_count,
            lyric_file_count: index.lyric_file_count,
            completed_at: index.completed_at,
        }
    }
}

pub(crate) fn load_library_index_for_root(
    path: &Path,
    root_path: &str,
) -> Result<LibraryIndexLoadResult, IndexError> {
    if !path.exists() {
        return Ok(index_load_result(LibraryIndexLoadStatus::Miss, None, None));
    }

    let contents = fs::read_to_string(path)
        .map_err(|source| IndexError::new("Could not read the library index.", source))?;
    let index: LibraryIndex = match serde_json::from_str(&contents) {
        Ok(index) => index,
        Err(error) => {
            eprintln!("Could not parse the library index. {error}");
            return Ok(index_load_result(
                LibraryIndexLoadStatus::Corrupt,
                None,
                Some("The saved library index could not be read, so the library will be scanned again."),
            ));
        }
    };

    if index.schema_version != LIBRARY_INDEX_SCHEMA_VERSION {
        return Ok(index_load_result(
            LibraryIndexLoadStatus::UnsupportedSchema,
            None,
            Some("The saved library index uses an unsupported format and will be rebuilt."),
        ));
    }

    if !same_root(&index.root_path, root_path) {
        return Ok(index_load_result(
            LibraryIndexLoadStatus::RootMismatch,
            None,
            None,
        ));
    }

    Ok(index_load_result(
        LibraryIndexLoadStatus::Hit,
        Some(index.into()),
        None,
    ))
}

pub(crate) fn write_library_index_atomically(
    path: &Path,
    index: &LibraryIndex,
) -> Result<(), IndexError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| {
            IndexError::new("Could not create the application data folder.", source)
        })?;
    }

    let contents = serde_json::to_vec_pretty(index)
        .map_err(|source| IndexError::new("Could not serialize the library index.", source))?;
    let temporary_path = path.with_extension("json.tmp");

    {
        let mut file = File::create(&temporary_path).map_err(|source| {
            IndexError::new("Could not create a temporary library index.", source)
        })?;
        file.write_all(&contents)
            .map_err(|source| IndexError::new("Could not write the library index.", source))?;
        file.sync_all()
            .map_err(|source| IndexError::new("Could not flush the library index.", source))?;
    }

    if !path.exists() {
        return fs::rename(&temporary_path, path).map_err(|source| {
            let _ = fs::remove_file(&temporary_path);
            IndexError::new("Could not save the library index.", source)
        });
    }

    let backup_path = path.with_extension("json.bak");
    let _ = fs::remove_file(&backup_path);
    fs::rename(path, &backup_path).map_err(|source| {
        let _ = fs::remove_file(&temporary_path);
        IndexError::new(
            "Could not prepare the previous library index for replacement.",
            source,
        )
    })?;

    match fs::rename(&temporary_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&backup_path);
            Ok(())
        }
        Err(source) => {
            let _ = fs::rename(&backup_path, path);
            let _ = fs::remove_file(&temporary_path);
            Err(IndexError::new("Could not save the library index.", source))
        }
    }
}

pub(crate) fn clear_library_index_for_root(path: &Path, root_path: &str) -> Result<(), IndexError> {
    if !path.exists() {
        return Ok(());
    }

    match load_library_index_for_root(path, root_path)? {
        LibraryIndexLoadResult {
            status: LibraryIndexLoadStatus::Hit | LibraryIndexLoadStatus::Corrupt,
            ..
        } => fs::remove_file(path)
            .map_err(|source| IndexError::new("Could not clear the library index.", source)),
        _ => Ok(()),
    }
}

fn index_load_result(
    status: LibraryIndexLoadStatus,
    scan_result: Option<LibraryScanResult>,
    message: Option<&str>,
) -> LibraryIndexLoadResult {
    LibraryIndexLoadResult {
        status,
        scan_result,
        message: message.map(str::to_string),
    }
}

pub(crate) fn same_root(left: &str, right: &str) -> bool {
    normalize_root_for_cache(left) == normalize_root_for_cache(right)
}

fn normalize_root_for_cache(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

#[derive(Debug)]
pub(crate) struct SettingsError {
    message: &'static str,
}

impl SettingsError {
    fn new(message: &'static str, source: impl std::fmt::Display) -> Self {
        eprintln!("{message} {source}");
        Self { message }
    }
}

impl std::fmt::Display for SettingsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

#[derive(Debug)]
pub(crate) struct IndexError {
    message: &'static str,
}

impl IndexError {
    fn new(message: &'static str, source: impl std::fmt::Display) -> Self {
        eprintln!("{message} {source}");
        Self { message }
    }
}

impl std::fmt::Display for IndexError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}
