use super::models::{PersistedLyricTimingPreferences, PREFERENCE_SCHEMA_VERSION};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;

pub(crate) fn preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Could not locate the application data folder.".to_string())?;
    Ok(data_dir.join("lyric-timing-preferences.json"))
}

pub(crate) fn read_preferences(path: &Path) -> Result<PersistedLyricTimingPreferences, String> {
    if !path.exists() {
        return Ok(PersistedLyricTimingPreferences::default());
    }

    let contents = fs::read_to_string(path).map_err(|source| {
        eprintln!("Could not read lyric timing preferences. {source}");
        "Could not read saved lyric timing.".to_string()
    })?;
    let preferences: PersistedLyricTimingPreferences =
        serde_json::from_str(&contents).map_err(|source| {
            eprintln!("Could not parse lyric timing preferences. {source}");
            "Could not read saved lyric timing.".to_string()
        })?;
    if preferences.schema_version != PREFERENCE_SCHEMA_VERSION {
        return Err("The saved lyric timing format is not supported.".to_string());
    }
    Ok(preferences)
}

pub(crate) fn write_preferences_atomically(
    path: &Path,
    preferences: &PersistedLyricTimingPreferences,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| {
            eprintln!("Could not create the lyric timing preference folder. {source}");
            "Could not save lyric timing.".to_string()
        })?;
    }

    let contents = serde_json::to_vec_pretty(preferences).map_err(|source| {
        eprintln!("Could not serialize lyric timing preferences. {source}");
        "Could not save lyric timing.".to_string()
    })?;
    let temporary_path = path.with_extension("json.tmp");
    {
        let mut file = File::create(&temporary_path).map_err(|source| {
            eprintln!("Could not create temporary lyric timing preferences. {source}");
            "Could not save lyric timing.".to_string()
        })?;
        file.write_all(&contents).map_err(|source| {
            eprintln!("Could not write lyric timing preferences. {source}");
            "Could not save lyric timing.".to_string()
        })?;
        file.sync_all().map_err(|source| {
            eprintln!("Could not flush lyric timing preferences. {source}");
            "Could not save lyric timing.".to_string()
        })?;
    }

    if !path.exists() {
        return fs::rename(&temporary_path, path).map_err(|source| {
            let _ = fs::remove_file(&temporary_path);
            eprintln!("Could not install lyric timing preferences. {source}");
            "Could not save lyric timing.".to_string()
        });
    }

    let backup_path = path.with_extension("json.bak");
    let _ = fs::remove_file(&backup_path);
    fs::rename(path, &backup_path).map_err(|source| {
        let _ = fs::remove_file(&temporary_path);
        eprintln!("Could not prepare lyric timing preferences for replacement. {source}");
        "Could not save lyric timing.".to_string()
    })?;
    match fs::rename(&temporary_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&backup_path);
            Ok(())
        }
        Err(source) => {
            let _ = fs::rename(&backup_path, path);
            let _ = fs::remove_file(&temporary_path);
            eprintln!("Could not replace lyric timing preferences. {source}");
            Err("Could not save lyric timing.".to_string())
        }
    }
}
