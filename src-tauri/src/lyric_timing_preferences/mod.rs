mod models;
mod persistence;

use crate::media_library::{
    resolve_indexed_song, IndexedSongLookupError, IndexedSongLookupErrorCode,
};
pub use models::{
    LyricTimingPersistenceStatus, LyricTimingPreferenceError, LyricTimingPreferenceErrorCode,
    SongLyricTimingProjection,
};
use models::{PersistedLyricTimingPreferences, LYRIC_OFFSET_MAX_MS, LYRIC_OFFSET_MIN_MS};
use persistence::{preferences_path, read_preferences, write_preferences_atomically};
use std::{path::Path, sync::Mutex};

#[derive(Debug, Default)]
pub struct LyricTimingPreferenceCoordinator {
    inner: Mutex<PreferenceState>,
}

#[derive(Debug, Default)]
struct PreferenceState {
    preferences: PersistedLyricTimingPreferences,
    loaded: bool,
    persistence_status: Option<LyricTimingPersistenceStatus>,
    last_error: Option<String>,
}

impl LyricTimingPreferenceCoordinator {
    pub(crate) fn get(
        &self,
        path: &Path,
        song_id: &str,
    ) -> Result<SongLyricTimingProjection, LyricTimingPreferenceError> {
        let mut state = self.lock()?;
        Self::ensure_loaded(&mut state, path)?;
        Ok(Self::projection(&state, song_id))
    }

    pub(crate) fn save(
        &self,
        path: &Path,
        song_id: &str,
        offset_ms: i32,
    ) -> Result<SongLyricTimingProjection, LyricTimingPreferenceError> {
        validate_offset(offset_ms)?;
        let mut state = self.lock()?;
        Self::ensure_loaded(&mut state, path)?;
        let mut next = state.preferences.clone();
        next.offsets_by_song_id
            .insert(song_id.to_string(), offset_ms);
        if let Err(message) = write_preferences_atomically(path, &next) {
            state.persistence_status = Some(LyricTimingPersistenceStatus::Failed);
            state.last_error = Some(message.clone());
            return Err(persistence_error(message));
        }
        state.preferences = next;
        state.persistence_status = Some(LyricTimingPersistenceStatus::Saved);
        state.last_error = None;
        Ok(Self::projection(&state, song_id))
    }

    pub(crate) fn remove(
        &self,
        path: &Path,
        song_id: &str,
    ) -> Result<SongLyricTimingProjection, LyricTimingPreferenceError> {
        let mut state = self.lock()?;
        Self::ensure_loaded(&mut state, path)?;
        let mut next = state.preferences.clone();
        next.offsets_by_song_id.remove(song_id);
        if let Err(message) = write_preferences_atomically(path, &next) {
            state.persistence_status = Some(LyricTimingPersistenceStatus::Failed);
            state.last_error = Some(message.clone());
            return Err(persistence_error(message));
        }
        state.preferences = next;
        state.persistence_status = Some(LyricTimingPersistenceStatus::Removed);
        state.last_error = None;
        Ok(Self::projection(&state, song_id))
    }

    fn ensure_loaded(
        state: &mut PreferenceState,
        path: &Path,
    ) -> Result<(), LyricTimingPreferenceError> {
        if state.loaded {
            return Ok(());
        }
        match read_preferences(path) {
            Ok(preferences) => {
                if preferences.offsets_by_song_id.values().any(|offset_ms| {
                    !(LYRIC_OFFSET_MIN_MS..=LYRIC_OFFSET_MAX_MS).contains(offset_ms)
                }) {
                    let message = "Saved lyric timing contains an invalid offset.".to_string();
                    state.persistence_status = Some(LyricTimingPersistenceStatus::Failed);
                    state.last_error = Some(message.clone());
                    return Err(persistence_error(message));
                }
                state.preferences = preferences;
                state.loaded = true;
                state.persistence_status = Some(LyricTimingPersistenceStatus::Loaded);
                state.last_error = None;
                Ok(())
            }
            Err(message) => {
                state.persistence_status = Some(LyricTimingPersistenceStatus::Failed);
                state.last_error = Some(message.clone());
                Err(persistence_error(message))
            }
        }
    }

    fn projection(state: &PreferenceState, song_id: &str) -> SongLyricTimingProjection {
        SongLyricTimingProjection {
            song_id: song_id.to_string(),
            saved_offset_ms: state.preferences.offsets_by_song_id.get(song_id).copied(),
            persistence_status: state
                .persistence_status
                .unwrap_or(LyricTimingPersistenceStatus::Loaded),
            last_error: state.last_error.clone(),
        }
    }

    fn lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, PreferenceState>, LyricTimingPreferenceError> {
        self.inner.lock().map_err(|_| {
            LyricTimingPreferenceError::new(
                LyricTimingPreferenceErrorCode::InternalError,
                "Lyric timing preferences are unavailable.",
            )
        })
    }
}

#[tauri::command]
pub fn get_song_lyric_timing(
    app: tauri::AppHandle,
    song_id: String,
    coordinator: tauri::State<'_, LyricTimingPreferenceCoordinator>,
) -> Result<SongLyricTimingProjection, LyricTimingPreferenceError> {
    validate_song(&app, &song_id)?;
    coordinator.get(
        &preferences_path(&app).map_err(persistence_error)?,
        &song_id,
    )
}

#[tauri::command]
pub fn save_song_lyric_offset(
    app: tauri::AppHandle,
    song_id: String,
    offset_ms: i32,
    coordinator: tauri::State<'_, LyricTimingPreferenceCoordinator>,
) -> Result<SongLyricTimingProjection, LyricTimingPreferenceError> {
    validate_song(&app, &song_id)?;
    coordinator.save(
        &preferences_path(&app).map_err(persistence_error)?,
        &song_id,
        offset_ms,
    )
}

#[tauri::command]
pub fn remove_song_lyric_offset(
    app: tauri::AppHandle,
    song_id: String,
    coordinator: tauri::State<'_, LyricTimingPreferenceCoordinator>,
) -> Result<SongLyricTimingProjection, LyricTimingPreferenceError> {
    validate_song(&app, &song_id)?;
    coordinator.remove(
        &preferences_path(&app).map_err(persistence_error)?,
        &song_id,
    )
}

fn validate_offset(offset_ms: i32) -> Result<(), LyricTimingPreferenceError> {
    if !(LYRIC_OFFSET_MIN_MS..=LYRIC_OFFSET_MAX_MS).contains(&offset_ms) {
        return Err(LyricTimingPreferenceError::new(
            LyricTimingPreferenceErrorCode::OffsetOutOfRange,
            "Lyric timing must be between -3000 ms and +3000 ms.",
        ));
    }
    Ok(())
}

fn validate_song(app: &tauri::AppHandle, song_id: &str) -> Result<(), LyricTimingPreferenceError> {
    resolve_indexed_song(app, song_id)
        .map(|_| ())
        .map_err(map_song_error)
}

fn map_song_error(error: IndexedSongLookupError) -> LyricTimingPreferenceError {
    let reason_code = match error.reason_code {
        IndexedSongLookupErrorCode::SongNotFound => LyricTimingPreferenceErrorCode::SongNotFound,
        IndexedSongLookupErrorCode::SongUnavailable => {
            LyricTimingPreferenceErrorCode::SongUnavailable
        }
        IndexedSongLookupErrorCode::LibraryNotSelected
        | IndexedSongLookupErrorCode::IndexUnavailable => {
            LyricTimingPreferenceErrorCode::SongNotFound
        }
    };
    LyricTimingPreferenceError::new(reason_code, error.message)
}

fn persistence_error(message: impl Into<String>) -> LyricTimingPreferenceError {
    LyricTimingPreferenceError::new(LyricTimingPreferenceErrorCode::PersistenceFailed, message)
}

#[cfg(test)]
mod tests;
