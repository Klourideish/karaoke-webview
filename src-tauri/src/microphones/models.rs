use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MicrophoneSourceKind {
    WindowsDevice,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MicrophoneSourceAvailability {
    Available,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredMicrophoneSource {
    pub id: String,
    pub display_name: String,
    pub kind: MicrophoneSourceKind,
    pub availability: MicrophoneSourceAvailability,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MicrophoneChannelState {
    Available,
    Disconnected,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneChannel {
    pub id: String,
    pub source_id: String,
    pub source_display_name: String,
    pub state: MicrophoneChannelState,
}
