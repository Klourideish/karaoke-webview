use serde::{Deserialize, Serialize};

use crate::microphones::{MicrophoneAssignment, MicrophoneChannel};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectSingerMicrophoneRequest {
    pub request_id: String,
    pub session_singer_id: String,
    pub desired_source_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum MicrophoneSelectionStatus {
    Assigned,
    Cleared,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MicrophoneSelectionProjection {
    pub session_singer_id: String,
    pub status: MicrophoneSelectionStatus,
    pub channel: Option<MicrophoneChannel>,
    pub assignment: Option<MicrophoneAssignment>,
    pub source_display_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum MicrophoneSelectionErrorCode {
    InvalidRequest,
    RequestIdConflict,
    SingerNotFound,
    SourceUnavailable,
    SourceAlreadyClaimed,
    ChannelNotFound,
    AssignmentConflict,
    InternalError,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MicrophoneSelectionError {
    pub reason_code: MicrophoneSelectionErrorCode,
    pub message: String,
}

impl MicrophoneSelectionError {
    pub(crate) fn new(
        reason_code: MicrophoneSelectionErrorCode,
        message: impl Into<String>,
    ) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }
}
