use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartDiagnosticMonitorRequest {
    pub source_id: String,
    pub output_device_id: String,
    pub gain: f32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticOutputDevice {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
}

impl DiagnosticOutputDevice {
    pub(crate) fn default_output() -> Self {
        Self {
            id: "default".to_string(),
            display_name: "Default Windows output".to_string(),
            is_default: true,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DiagnosticMonitorState {
    Idle,
    Starting,
    Active,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticMonitorStatus {
    pub attempt_id: Option<String>,
    pub state: DiagnosticMonitorState,
    pub source_id: Option<String>,
    pub output_device_id: Option<String>,
    pub gain: f32,
    pub message: Option<String>,
    pub failure_reason: Option<String>,
}

impl DiagnosticMonitorStatus {
    pub(crate) fn idle() -> Self {
        Self {
            attempt_id: None,
            state: DiagnosticMonitorState::Idle,
            source_id: None,
            output_device_id: None,
            gain: 0.25,
            message: None,
            failure_reason: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticMonitorDiagnostics {
    pub queue_capacity: usize,
    pub queue_depth: usize,
    pub maximum_queue_depth: usize,
    pub dropped_monitor_frames: u64,
    pub underruns: u64,
    pub resets: u64,
    pub buffered_latency_ms: u64,
    pub input_sample_rate_hz: Option<u32>,
    pub output_sample_rate_hz: Option<u32>,
    pub input_channels: Option<u16>,
    pub output_channels: Option<u16>,
    pub gain: f32,
    pub samples_consumed: u64,
    pub samples_written: u64,
    pub synthetic_silence_samples: u64,
}

impl DiagnosticMonitorDiagnostics {
    pub(crate) fn idle(capacity: usize) -> Self {
        Self {
            queue_capacity: capacity,
            queue_depth: 0,
            maximum_queue_depth: 0,
            dropped_monitor_frames: 0,
            underruns: 0,
            resets: 0,
            buffered_latency_ms: 0,
            input_sample_rate_hz: None,
            output_sample_rate_hz: None,
            input_channels: None,
            output_channels: None,
            gain: 0.25,
            samples_consumed: 0,
            samples_written: 0,
            synthetic_silence_samples: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticMonitorCommandError {
    pub reason: String,
    pub message: String,
}

impl DiagnosticMonitorCommandError {
    pub(crate) fn new(reason: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            message: message.into(),
        }
    }
}

impl From<String> for DiagnosticMonitorCommandError {
    fn from(message: String) -> Self {
        Self::new("monitor-command-failed", message)
    }
}
