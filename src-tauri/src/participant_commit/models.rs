use serde::{Deserialize, Serialize};

use crate::session_singers::SessionSingerProjection;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateSingerWithMicrophoneRequest {
    pub request_id: String,
    pub display_name: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssignMicrophoneToSingerRequest {
    pub request_id: String,
    pub singer_id: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ParticipantMicrophoneState {
    Ready,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ParticipantCommitProjection {
    pub session_singer: SessionSingerProjection,
    pub microphone_state: ParticipantMicrophoneState,
    pub source_display_name: String,
    pub assignment_succeeded: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ParticipantCommitDiagnosticOutcome {
    None,
    Success,
    Failure,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ParticipantCommitDiagnosticProjection {
    pub request_id: Option<String>,
    pub outcome: ParticipantCommitDiagnosticOutcome,
    pub singer_name: Option<String>,
    pub source_display_name: Option<String>,
    pub microphone_state: Option<ParticipantMicrophoneState>,
    pub rollback_occurred: bool,
    pub failure_reason: Option<ParticipantCommitErrorCode>,
    pub failure_message: Option<String>,
}

impl Default for ParticipantCommitDiagnosticProjection {
    fn default() -> Self {
        Self {
            request_id: None,
            outcome: ParticipantCommitDiagnosticOutcome::None,
            singer_name: None,
            source_display_name: None,
            microphone_state: None,
            rollback_occurred: false,
            failure_reason: None,
            failure_message: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ParticipantCommitError {
    pub reason_code: ParticipantCommitErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ParticipantCommitErrorCode {
    InvalidRequest,
    RequestIdConflict,
    SingerNotFound,
    InvalidDisplayName,
    SourceUnavailable,
    SourceIneligible,
    AssignmentConflict,
    InternalError,
}

impl ParticipantCommitError {
    pub(crate) fn new(reason_code: ParticipantCommitErrorCode, message: impl Into<String>) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }
}
