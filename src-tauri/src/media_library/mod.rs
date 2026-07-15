pub mod models;
mod persistence;
mod playback;
mod refresh;
mod scanner;

use models::{LibraryIndex, LibraryScanResult, LibrarySettings};
use persistence::{
    clear_library_index_for_root, library_index_path, load_library_index_for_root,
    read_library_settings, same_root, write_library_index_atomically, write_library_settings,
};
pub(crate) use scanner::path_to_string;
use scanner::scan_media_library_path;
use std::path::PathBuf;

pub(crate) use refresh::MediaLibraryRefreshCoordinator;

#[tauri::command]
pub fn scan_media_library(root_path: String) -> Result<LibraryScanResult, String> {
    scan_media_library_path(PathBuf::from(root_path)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_library_settings(app: tauri::AppHandle) -> Result<LibrarySettings, String> {
    read_library_settings(&settings_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_library_root(
    app: tauri::AppHandle,
    root_path: String,
) -> Result<LibrarySettings, String> {
    let path = PathBuf::from(root_path);
    if !path.is_dir() {
        return Err("The selected library folder is not available.".to_string());
    }

    let settings = LibrarySettings {
        library_root: Some(path_to_string(&path)),
    };
    write_library_settings(&settings_path(&app)?, &settings).map_err(|error| error.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub fn load_library_index(
    app: tauri::AppHandle,
    root_path: String,
) -> Result<models::LibraryIndexLoadResult, String> {
    load_library_index_for_root(&library_index_path(&app)?, &root_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_library_index(
    app: tauri::AppHandle,
    scan_result: LibraryScanResult,
) -> Result<(), String> {
    let settings =
        read_library_settings(&settings_path(&app)?).map_err(|error| error.to_string())?;
    if !settings
        .library_root
        .as_ref()
        .is_some_and(|root_path| same_root(root_path, &scan_result.root_path))
    {
        return Err("The library folder changed before the index could be saved.".to_string());
    }

    write_library_index_atomically(&library_index_path(&app)?, &LibraryIndex::from(scan_result))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_library_index(app: tauri::AppHandle, root_path: String) -> Result<(), String> {
    clear_library_index_for_root(&library_index_path(&app)?, &root_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn select_library_location(
    app: tauri::AppHandle,
    root_path: String,
    coordinator: tauri::State<'_, MediaLibraryRefreshCoordinator>,
) -> Result<LibraryScanResult, refresh::LibraryRefreshError> {
    coordinator.select_and_refresh(
        &settings_path(&app).map_err(|message| {
            refresh::LibraryRefreshError::new(
                refresh::LibraryRefreshErrorCode::SettingsFailed,
                message,
            )
        })?,
        &library_index_path(&app).map_err(|message| {
            refresh::LibraryRefreshError::new(
                refresh::LibraryRefreshErrorCode::IndexFailed,
                message,
            )
        })?,
        root_path,
    )
}

#[tauri::command]
pub(crate) fn refresh_media_library(
    app: tauri::AppHandle,
    root_path: String,
    coordinator: tauri::State<'_, MediaLibraryRefreshCoordinator>,
) -> Result<LibraryScanResult, refresh::LibraryRefreshError> {
    coordinator.rescan(
        &settings_path(&app).map_err(|message| {
            refresh::LibraryRefreshError::new(
                refresh::LibraryRefreshErrorCode::SettingsFailed,
                message,
            )
        })?,
        &library_index_path(&app).map_err(|message| {
            refresh::LibraryRefreshError::new(
                refresh::LibraryRefreshErrorCode::IndexFailed,
                message,
            )
        })?,
        root_path,
    )
}

#[cfg(test)]
mod tests;

pub(crate) use persistence::settings_path;
#[cfg(test)]
pub(crate) use playback::resolve_lyric_source_for_song;
pub(crate) use playback::{
    IndexedPlaybackSong, IndexedSongLookupError, IndexedSongLookupErrorCode,
};
pub(crate) fn resolve_indexed_song(
    app: &tauri::AppHandle,
    song_id: &str,
) -> Result<IndexedPlaybackSong, IndexedSongLookupError> {
    playback::resolve_indexed_song_for_paths(
        &settings_path(app).map_err(|message| IndexedSongLookupError {
            reason_code: IndexedSongLookupErrorCode::IndexUnavailable,
            message,
        })?,
        &persistence::library_index_path(app).map_err(|message| IndexedSongLookupError {
            reason_code: IndexedSongLookupErrorCode::IndexUnavailable,
            message,
        })?,
        song_id,
    )
}
