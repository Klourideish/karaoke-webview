use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub(crate) const LYRIC_OFFSET_MIN_MS: i32 = -3_000;
pub(crate) const LYRIC_OFFSET_MAX_MS: i32 = 3_000;
pub(crate) const PREFERENCE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SongLyricTimingProjection {
    pub song_id: String,
    pub saved_offset_ms: Option<i32>,
    pub persistence_status: LyricTimingPersistenceStatus,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LyricTimingPersistenceStatus {
    Loaded,
    Saved,
    Removed,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LyricTimingPreferenceErrorCode {
    OffsetOutOfRange,
    SongNotFound,
    SongUnavailable,
    PersistenceFailed,
    InternalError,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LyricTimingPreferenceError {
    pub reason_code: LyricTimingPreferenceErrorCode,
    pub message: String,
}

impl LyricTimingPreferenceError {
    pub(crate) fn new(
        reason_code: LyricTimingPreferenceErrorCode,
        message: impl Into<String>,
    ) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedLyricTimingPreferences {
    pub schema_version: u32,
    pub offsets_by_song_id: BTreeMap<String, i32>,
}

impl Default for PersistedLyricTimingPreferences {
    fn default() -> Self {
        Self {
            schema_version: PREFERENCE_SCHEMA_VERSION,
            offsets_by_song_id: BTreeMap::new(),
        }
    }
}
