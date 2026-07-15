use serde::{Deserialize, Serialize};

use crate::microphones::PerformanceMicrophoneReadiness;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PerformanceLifecycleState {
    Created,
    Preparing,
    Ready,
    Countdown,
    Playing,
    Finalizing,
    Results,
    Completed,
    Stopped,
    Failed,
}

impl PerformanceLifecycleState {
    pub(crate) fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Stopped | Self::Failed)
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PerformanceTerminalReason {
    CancelledBeforePlayback,
    SkippedByOperator,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerformanceSingerProjection {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerformanceSongProjection {
    pub id: String,
    pub title: String,
    pub artist: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerformancePlaybackProjection {
    pub attempt_id: Option<String>,
    pub state: String,
    pub startup_pending: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerformanceFailureProjection {
    pub reason_code: PerformanceErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerformanceDetailsProjection {
    pub id: String,
    pub state: PerformanceLifecycleState,
    pub performer: PerformanceSingerProjection,
    pub song: PerformanceSongProjection,
    pub countdown_deadline_unix_ms: Option<u64>,
    pub countdown_remaining_ms: Option<u64>,
    pub results_deadline_unix_ms: Option<u64>,
    pub results_remaining_ms: Option<u64>,
    pub readiness: PerformanceMicrophoneReadiness,
    pub playback: PerformancePlaybackProjection,
    pub terminal_reason: Option<PerformanceTerminalReason>,
    pub failure: Option<PerformanceFailureProjection>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerformanceDiagnostics {
    pub last_transition: Option<String>,
    pub stale_playback_event_count: u64,
    pub idempotency_hit_count: u64,
    pub idempotency_conflict_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerformanceProjection {
    pub revision: u64,
    pub active: Option<PerformanceDetailsProjection>,
    pub diagnostics: PerformanceDiagnostics,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatePerformanceRequest {
    pub request_id: String,
    pub singer_id: String,
    pub song_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerformanceMutationRequest {
    pub request_id: String,
    pub performance_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PerformanceErrorCode {
    SingerNotFound,
    SongNotFound,
    SongUnavailable,
    LyricsInvalid,
    PerformanceActive,
    PerformanceNotFound,
    PerformanceTerminal,
    InvalidState,
    PlaybackFailed,
    RequestIdConflict,
    InternalError,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerformanceError {
    pub reason_code: PerformanceErrorCode,
    pub message: String,
}

impl PerformanceError {
    pub(crate) fn new(reason_code: PerformanceErrorCode, message: impl Into<String>) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }
}
