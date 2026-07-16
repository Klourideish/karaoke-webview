use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueEntryProjection {
    pub id: String,
    pub song_id: String,
    pub requester_singer_id: String,
    pub requester_display_name: String,
    pub song_title: String,
    pub song_artist: String,
    pub vote_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueCurrentProjection {
    pub entry: QueueEntryProjection,
    pub performance_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueFailedProjection {
    pub entry: QueueEntryProjection,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueDiagnostics {
    pub active_queue_count: usize,
    pub current_entry_id: Option<String>,
    pub linked_performance_id: Option<String>,
    pub progression_paused: bool,
    pub last_transition: Option<String>,
    pub last_failure: Option<String>,
    pub worker_failure: Option<String>,
    pub idempotency_hit_count: u64,
    pub idempotency_conflict_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueProjection {
    pub revision: u64,
    pub current: Option<QueueCurrentProjection>,
    pub queued: Vec<QueueEntryProjection>,
    pub failed: Vec<QueueFailedProjection>,
    pub progression_paused: bool,
    pub diagnostics: QueueDiagnostics,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddSongToQueueRequest {
    pub request_id: String,
    pub song_id: String,
    pub singer_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoveQueueEntryRequest {
    pub request_id: String,
    pub entry_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MoveQueueEntryRequest {
    pub request_id: String,
    pub entry_id: String,
    pub target_index: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoteForQueueEntryRequest {
    pub request_id: String,
    pub entry_id: String,
    pub singer_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoveQueueVoteRequest {
    pub request_id: String,
    pub entry_id: String,
    pub singer_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueMutationRequest {
    pub request_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetryFailedQueueEntryRequest {
    pub request_id: String,
    pub entry_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum QueueErrorCode {
    SingerNotFound,
    SongNotFound,
    EntryNotFound,
    EntryLocked,
    InvalidState,
    DuplicateVote,
    VoteNotFound,
    PerformanceFailed,
    RequestIdConflict,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueError {
    pub reason_code: QueueErrorCode,
    pub message: String,
}

impl QueueError {
    pub(crate) fn new(reason_code: QueueErrorCode, message: impl Into<String>) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }
}
