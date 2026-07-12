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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MicrophoneAssignmentMethod {
    Manual,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneAssignment {
    pub channel_id: String,
    pub singer_id: String,
    pub method: MicrophoneAssignmentMethod,
    pub sequence: u64,
}
