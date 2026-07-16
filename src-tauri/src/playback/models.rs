use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PlaybackState {
    Idle,
    Starting,
    Playing,
    Paused,
    Stopped,
    Completed,
    Failed,
}

impl PlaybackState {
    pub(crate) fn is_active(self) -> bool {
        matches!(self, Self::Starting | Self::Playing | Self::Paused)
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PlaybackAdapterAction {
    None,
    Start,
    Pause,
    Resume,
    Stop,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackSongProjection {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub audio_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackDiagnostics {
    pub last_adapter_event: Option<String>,
    pub stale_event_count: u64,
    pub idempotency_hit_count: u64,
    pub idempotency_conflict_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackProjection {
    pub revision: u64,
    pub state: PlaybackState,
    pub desired_action: PlaybackAdapterAction,
    pub attempt_id: Option<String>,
    pub song: Option<PlaybackSongProjection>,
    pub failure_reason: Option<PlaybackErrorCode>,
    pub failure_message: Option<String>,
    pub diagnostics: PlaybackDiagnostics,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RequestSongPlayback {
    pub request_id: String,
    pub song_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackMutationRequest {
    pub request_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackReportRequest {
    pub attempt_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackFailureReportRequest {
    pub attempt_id: String,
    pub kind: PlaybackFailureKind,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PlaybackFailureKind {
    StartRejected,
    MediaError,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PlaybackErrorCode {
    LibraryNotSelected,
    LibraryIndexUnavailable,
    SongNotFound,
    SongUnavailable,
    PlaybackAlreadyActive,
    PlaybackNotActive,
    InvalidState,
    StaleAttempt,
    RequestIdConflict,
    AdapterStartFailed,
    MediaFailed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackError {
    pub reason_code: PlaybackErrorCode,
    pub message: String,
}

impl PlaybackError {
    pub(crate) fn new(reason_code: PlaybackErrorCode, message: impl Into<String>) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }
}
