pub mod models;
mod persistence;
mod playback;
mod scanner;

use models::{LibraryIndex, LibraryScanResult, LibrarySettings, MediaSong, ResolvedAudioSource};
use persistence::{
    clear_library_index_for_root, library_index_path, load_library_index_for_root,
    read_library_settings, same_root, write_library_index_atomically, write_library_settings,
};
use playback::resolve_audio_source_for_song;
use scanner::{path_to_string, scan_media_library_path};
use std::path::PathBuf;
use tauri::Manager;

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
pub fn resolve_audio_source(
    app: tauri::AppHandle,
    song: MediaSong,
) -> Result<ResolvedAudioSource, String> {
    let resolved = resolve_audio_source_for_song(&settings_path(&app)?, song)
        .map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_file(&resolved.audio_path)
        .map_err(|error| {
            eprintln!("Could not allow audio file through asset protocol: {error}");
            "Could not access this audio file.".to_string()
        })?;
    Ok(resolved)
}

#[cfg(test)]
mod tests;

pub(crate) use persistence::settings_path;
pub(crate) use playback::resolve_lyric_source_for_song;
