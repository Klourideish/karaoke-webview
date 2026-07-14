use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSingerProjection {
    pub id: String,
    pub display_name: String,
    pub created_order: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateSessionSingerRequest {
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameSessionSingerRequest {
    pub singer_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSingerError {
    pub reason_code: SessionSingerErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SessionSingerErrorCode {
    DisplayNameEmpty,
    DisplayNameTooLong,
    DisplayNameControlCharacters,
    SingerNotFound,
    SingerInUse,
}

impl SessionSingerError {
    pub(crate) fn new(reason_code: SessionSingerErrorCode, message: impl Into<String>) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }
}
