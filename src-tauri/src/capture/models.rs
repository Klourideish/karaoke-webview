use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MonitorSampleEncoding {
    Float32,
}

#[derive(Debug, Clone)]
pub(crate) struct CaptureAudioFrame {
    pub samples: Vec<f32>,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub sequence: u64,
    pub encoding: MonitorSampleEncoding,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiagnosticCaptureStatus {
    Idle,
    Starting,
    Active,
    Stopping,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneLevelSnapshot {
    pub rms: f32,
    pub peak: f32,
    pub clipping: bool,
    pub sequence: u64,
}

impl MicrophoneLevelSnapshot {
    pub const fn idle() -> Self {
        Self {
            rms: 0.0,
            peak: 0.0,
            clipping: false,
            sequence: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCaptureSnapshot {
    pub status: DiagnosticCaptureStatus,
    pub session_id: Option<String>,
    pub source_id: Option<String>,
    pub channel_id: Option<String>,
    pub level: MicrophoneLevelSnapshot,
    pub error: Option<String>,
}

impl DiagnosticCaptureSnapshot {
    pub fn idle() -> Self {
        Self {
            status: DiagnosticCaptureStatus::Idle,
            session_id: None,
            source_id: None,
            channel_id: None,
            level: MicrophoneLevelSnapshot::idle(),
            error: None,
        }
    }
}
