use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum KaraokeMode {
    Standard,
    Party,
    Battle,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MicrophoneSourceKind {
    WindowsDevice,
    NetworkClient,
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
    Automatic,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MicrophoneWaitingReason {
    NoEligibleMicrophone,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneWaitingState {
    pub singer_id: String,
    pub reason: MicrophoneWaitingReason,
    pub message: String,
    pub sequence: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AutomaticAssignmentStatus {
    Assigned,
    Waiting,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticAssignmentResult {
    pub status: AutomaticAssignmentStatus,
    pub assignment: Option<MicrophoneAssignment>,
    pub waiting_state: Option<MicrophoneWaitingState>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MicrophoneSourcePresence {
    Available,
    Unavailable,
    Missing,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MicrophoneRecoveryStatus {
    Healthy,
    Disconnected,
    Recovering,
    ReplacementAvailable,
    RecoveryFailed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneRecoveryState {
    pub channel_id: String,
    pub status: MicrophoneRecoveryStatus,
    pub source_presence: MicrophoneSourcePresence,
    pub reason: String,
    pub eligible_replacement_source_ids: Vec<String>,
    pub automatic_replacement_eligible: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneAssignment {
    pub channel_id: String,
    pub singer_id: String,
    pub method: MicrophoneAssignmentMethod,
    pub sequence: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PerformanceReadinessPhase {
    Preparing,
    Countdown,
    Playing,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMicrophoneReadinessRequest {
    pub mode: KaraokeMode,
    pub participant_singer_ids: Vec<String>,
    pub allow_automatic_recovery: bool,
    pub phase: PerformanceReadinessPhase,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PerformanceMicrophoneReadinessStatus {
    Ready,
    Degraded,
    Blocked,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PerformanceMicrophoneReadinessReason {
    Ready,
    NoAssignment,
    WaitingForMicrophone,
    ChannelDisconnected,
    SourceUnavailable,
    DiagnosticSessionActive,
    ConflictingAssignment,
    RecoveryAvailable,
    RecoveryFailed,
    ExcludedByPartyMode,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantMicrophoneReadiness {
    pub singer_id: String,
    pub status: PerformanceMicrophoneReadinessStatus,
    pub reason: PerformanceMicrophoneReadinessReason,
    pub message: String,
    pub assignment: Option<MicrophoneAssignment>,
    pub channel: Option<MicrophoneChannel>,
    pub recovery: Option<MicrophoneRecoveryState>,
    pub capture_available: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LockedPerformanceMicrophone {
    pub singer_id: String,
    pub channel_id: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMicrophoneReadiness {
    pub status: PerformanceMicrophoneReadinessStatus,
    pub mode: KaraokeMode,
    pub participants: Vec<ParticipantMicrophoneReadiness>,
    pub locked_participants: Vec<LockedPerformanceMicrophone>,
    pub message: String,
}
