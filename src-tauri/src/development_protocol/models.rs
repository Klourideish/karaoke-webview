use serde::{Deserialize, Serialize};

use crate::capture::MicrophoneLevelSnapshot;
use crate::microphones::DiscoveredMicrophoneSource;

pub(crate) const DEFAULT_TCP_PORT: u16 = 45_820;
pub(crate) const DEFAULT_UDP_PORT: u16 = 45_821;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartDevelopmentProtocolRequest {
    pub tcp_port: Option<u16>,
    pub udp_port: Option<u16>,
    pub bind_address: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DevelopmentListenerState {
    Stopped,
    Starting,
    Listening,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DevelopmentSourceHealth {
    ConnectedNotAuthorized,
    AuthorizedAwaitingAudio,
    Healthy,
    Degraded,
    Disconnected,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevelopmentProtocolStatus {
    pub listener_state: DevelopmentListenerState,
    pub bind_address: String,
    pub tcp_port: u16,
    pub udp_port: u16,
    pub connected_client_count: u8,
    pub current_connection_id: Option<String>,
    pub current_session_id: Option<String>,
    pub connected_client_name: Option<String>,
    pub source_id: Option<String>,
    pub stream_authorized: bool,
    pub active_stream_id: Option<u32>,
    pub source_health: DevelopmentSourceHealth,
    pub last_heartbeat_age_ms: Option<u64>,
    pub malformed_control_messages: u64,
    pub rejected_control_messages: u64,
    pub closure_reason: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevelopmentStreamDiagnostics {
    pub active_stream_id: Option<u32>,
    pub packets_received: u64,
    pub valid_packets: u64,
    pub malformed_packets: u64,
    pub unauthorized_packets: u64,
    pub duplicate_packets: u64,
    pub stale_packets: u64,
    pub late_packets: u64,
    pub sequence_gaps: u64,
    pub estimated_packet_loss: f32,
    pub receiver_queue_depth: usize,
    pub maximum_queue_depth: usize,
    pub jitter_window_depth: usize,
    pub jitter_target_ms: u64,
    pub jitter_max_ms: u64,
    pub audio_handoff_capacity_frames: usize,
    pub audio_handoff_queue_depth: usize,
    pub audio_handoff_maximum_queue_depth: usize,
    pub audio_handoff_dropped_frames: u64,
    pub current_source_health: DevelopmentSourceHealth,
    pub last_valid_packet_age_ms: Option<u64>,
    pub level: MicrophoneLevelSnapshot,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevelopmentProtocolProjection {
    pub status: DevelopmentProtocolStatus,
    pub diagnostics: DevelopmentStreamDiagnostics,
    pub sources: Vec<DiscoveredMicrophoneSource>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum ClientControlMessage {
    ClientHello {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "clientDeviceId")]
        client_device_id: String,
        #[serde(rename = "clientName")]
        client_name: String,
        #[serde(rename = "audioProfile")]
        audio_profile: DevelopmentAudioProfile,
    },
    RequestStreamAuthorization {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "captureAttemptId")]
        capture_attempt_id: String,
    },
    StopStream {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "audioStreamId")]
        audio_stream_id: u32,
        #[serde(rename = "reasonCode")]
        reason_code: String,
    },
    Heartbeat {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "sentAtMonotonicMs")]
        sent_at_monotonic_ms: Option<u64>,
    },
    PairingClaim {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "offerId")]
        offer_id: String,
        #[serde(rename = "pairingToken")]
        pairing_token: String,
        #[serde(rename = "clientDeviceId")]
        client_device_id: String,
        #[serde(rename = "clientName")]
        client_name: String,
    },
    ParticipantSetupProposal {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "offerId")]
        offer_id: String,
        #[serde(rename = "participantSetupToken")]
        participant_setup_token: String,
        #[serde(rename = "clientDeviceId")]
        client_device_id: String,
        #[serde(rename = "localParticipantProfileId")]
        local_participant_profile_id: String,
        #[serde(rename = "preferredDisplayName")]
        preferred_display_name: String,
        #[serde(rename = "previousHostParticipantReference")]
        previous_host_participant_reference: Option<String>,
    },
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevelopmentAudioProfile {
    pub sample_rate_hz: u32,
    pub channel_count: u16,
    pub encoding: String,
    pub frame_duration_ms: u16,
    pub samples_per_frame: u16,
}

impl DevelopmentAudioProfile {
    pub(crate) fn is_v0_exact(&self) -> bool {
        self.sample_rate_hz == 48_000
            && self.channel_count == 1
            && self.encoding == "pcm_s16le"
            && self.frame_duration_ms == 10
            && self.samples_per_frame == 480
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum HostControlMessage {
    HostHelloAccepted {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "clientConnectionId")]
        client_connection_id: String,
        #[serde(rename = "protocolSessionId")]
        protocol_session_id: String,
        #[serde(rename = "networkMicrophoneSourceId")]
        network_microphone_source_id: String,
        #[serde(rename = "audioUdpPort")]
        audio_udp_port: u16,
        #[serde(rename = "heartbeatIntervalMs")]
        heartbeat_interval_ms: u64,
    },
    HostHelloRejected {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "reasonCode")]
        reason_code: String,
        message: String,
    },
    StreamAuthorized {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "audioStreamId")]
        audio_stream_id: u32,
        #[serde(rename = "audioUdpPort")]
        audio_udp_port: u16,
    },
    StreamRejected {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "reasonCode")]
        reason_code: String,
        message: String,
    },
    StreamStopped {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "audioStreamId")]
        audio_stream_id: u32,
    },
    Heartbeat {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "sentAtMonotonicMs")]
        sent_at_monotonic_ms: u64,
    },
    DevelopmentError {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "reasonCode")]
        reason_code: String,
        message: String,
    },
    DevelopmentPairingError {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "requestId")]
        request_id: Option<String>,
        #[serde(rename = "reasonCode")]
        reason_code: crate::development_pairing::PairingErrorCode,
        message: String,
    },
    PairingAcceptedForSetup {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "offerId")]
        offer_id: String,
        #[serde(rename = "participantSetupToken")]
        participant_setup_token: String,
        #[serde(rename = "hostDisplayName")]
        host_display_name: String,
        #[serde(rename = "pairingScope")]
        pairing_scope: crate::development_pairing::PairingScopeProjection,
        #[serde(rename = "participantSetupRequired")]
        participant_setup_required: bool,
    },
    ParticipantAccepted {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(flatten)]
        participant: crate::development_pairing::AcceptedParticipantProjection,
    },
    ParticipantRejected {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "requestId")]
        request_id: String,
        status: String,
        #[serde(rename = "reasonCode")]
        reason_code: crate::development_pairing::PairingErrorCode,
        message: String,
    },
    ParticipantRevoked {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        status: String,
        #[serde(rename = "sessionSingerId")]
        session_singer_id: String,
        #[serde(rename = "reasonCode")]
        reason_code: String,
        message: String,
    },
    PairingOfferExpired {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "offerId")]
        offer_id: String,
        #[serde(rename = "reasonCode")]
        reason_code: String,
        message: String,
    },
    PairingOfferCancelled {
        #[serde(rename = "profileVersion")]
        profile_version: u8,
        #[serde(rename = "offerId")]
        offer_id: String,
        #[serde(rename = "reasonCode")]
        reason_code: String,
        message: String,
    },
}
