use serde::{Deserialize, Serialize};

use crate::session_singers::SessionSingerProjection;

pub(crate) const DEFAULT_PAIRING_LIFETIME_SECONDS: u64 = 120;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PairingOfferState {
    Created,
    Displayed,
    Claimed,
    AwaitingParticipantSetup,
    AwaitingOperatorApproval,
    Accepted,
    Rejected,
    Expired,
    Cancelled,
}

impl PairingOfferState {
    pub(crate) fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Accepted | Self::Rejected | Self::Expired | Self::Cancelled
        )
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum PairingScopeProjection {
    Generic,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingQrPayload {
    #[serde(rename = "type")]
    pub message_type: String,
    pub profile_version: u8,
    pub offer_id: String,
    pub host_display_name: String,
    pub host_address: String,
    pub control_port: u16,
    pub pairing_token: String,
    pub expires_at: String,
    pub lifetime_seconds: u64,
    pub pairing_scope: PairingScopeProjection,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingOfferProjection {
    pub profile_version: u8,
    pub offer_id: String,
    pub host_display_name: String,
    pub host_address: String,
    pub control_port: u16,
    pub pairing_token: String,
    pub expires_at: String,
    pub lifetime_seconds: u64,
    pub pairing_scope: PairingScopeProjection,
    pub qr_payload: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatePairingOfferRequest {
    pub request_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingOperatorActionRequest {
    pub request_id: String,
    pub offer_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PairingConnectionContext {
    pub connection_id: String,
    pub client_device_id: String,
    pub source_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PairingClaim {
    pub profile_version: u8,
    pub request_id: String,
    pub offer_id: String,
    pub pairing_token: String,
    pub client_device_id: String,
    pub client_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParticipantSetupProposal {
    pub profile_version: u8,
    pub request_id: String,
    pub offer_id: String,
    pub participant_setup_token: String,
    pub client_device_id: String,
    pub local_participant_profile_id: String,
    pub preferred_display_name: String,
    pub previous_host_participant_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingParticipantProjection {
    pub request_id: String,
    pub client_device_id: String,
    pub client_name: String,
    pub local_participant_profile_id: String,
    pub preferred_display_name: String,
    pub previous_host_participant_reference: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ParticipantMicrophoneProjectionState {
    Ready,
    Unassigned,
    Waiting,
    NeedsAttention,
    Disconnected,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ParticipantMicrophoneProjection {
    pub state: ParticipantMicrophoneProjectionState,
    pub message: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ParticipantNextUpState {
    Unknown,
    NotNext,
    Next,
    Current,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ParticipantNextUpProjection {
    pub state: ParticipantNextUpState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcceptedParticipantProjection {
    pub status: String,
    pub host_display_name: String,
    pub session_singer_id: String,
    pub accepted_display_name: String,
    pub microphone: ParticipantMicrophoneProjection,
    pub queued_song_count: u32,
    pub next_up: ParticipantNextUpProjection,
}

impl AcceptedParticipantProjection {
    pub(crate) fn from_singer(host_display_name: String, singer: &SessionSingerProjection) -> Self {
        Self {
            status: "accepted".to_string(),
            host_display_name,
            session_singer_id: singer.id.clone(),
            accepted_display_name: singer.display_name.clone(),
            microphone: ParticipantMicrophoneProjection {
                state: ParticipantMicrophoneProjectionState::Ready,
                message: "Microphone ready.".to_string(),
            },
            queued_song_count: 0,
            next_up: ParticipantNextUpProjection {
                state: ParticipantNextUpState::NotNext,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevelopmentPairingStatusProjection {
    pub active_offer_id: Option<String>,
    pub lifecycle_state: Option<PairingOfferState>,
    pub host_address: Option<String>,
    pub control_port: Option<u16>,
    pub expires_in_seconds: Option<u64>,
    pub expires_at: Option<String>,
    pub lifetime_seconds: Option<u64>,
    pub claimed_client_name: Option<String>,
    pub claimed_client_device_id: Option<String>,
    pub participant_setup_token_issued: bool,
    pub pending_participant: Option<PendingParticipantProjection>,
    pub accepted_participant: Option<AcceptedParticipantProjection>,
    pub last_revoked_participant: Option<RevokedParticipantProjection>,
    pub last_rejection_reason: Option<PairingErrorCode>,
    pub last_rejection_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevelopmentPairingDiagnosticsProjection {
    pub retained_offer_count: usize,
    pub offers_created: u64,
    pub offers_expired: u64,
    pub offers_cancelled: u64,
    pub offers_consumed: u64,
    pub duplicate_claims: u64,
    pub invalid_tokens: u64,
    pub proposals_received: u64,
    pub accepted_participants: u64,
    pub revoked_participants: u64,
    pub rejected_proposals: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevokedParticipantProjection {
    pub session_singer_id: String,
    pub accepted_display_name: String,
    pub reason_code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevelopmentPairingProjection {
    pub status: DevelopmentPairingStatusProjection,
    pub diagnostics: DevelopmentPairingDiagnosticsProjection,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PairingErrorCode {
    UnsupportedProfileVersion,
    OfferNotFound,
    OfferExpired,
    OfferCancelled,
    OfferAlreadyClaimed,
    OfferAlreadyUsed,
    OfferAlreadyActive,
    InvalidToken,
    InvalidParticipantSetupToken,
    InvalidDisplayName,
    DisplayNameTooLong,
    DisplayNameEmpty,
    DisplayNameControlCharacters,
    DuplicateDisplayNameNotAllowed,
    SessionCapacityReached,
    SelfRegistrationDisabled,
    OperatorApprovalRequired,
    ClientDeviceRejected,
    NetworkSourceIneligible,
    TargetSingerNotFound,
    TargetSingerAlreadyLinked,
    PolicyRejected,
    MalformedJson,
    UnknownMessageType,
    MissingRequiredField,
    InvalidField,
    InvalidRequest,
    RequestIdConflict,
    InvalidState,
    ListenerNotActive,
    UnreachableHostAddress,
    InternalError,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingError {
    pub reason_code: PairingErrorCode,
    pub message: String,
}

impl PairingError {
    pub(crate) fn new(reason_code: PairingErrorCode, message: impl Into<String>) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PairingOutboundMessage {
    AcceptedForSetup {
        request_id: String,
        offer_id: String,
        participant_setup_token: String,
        host_display_name: String,
    },
    ParticipantAccepted {
        request_id: String,
        participant: AcceptedParticipantProjection,
    },
    ParticipantRejected {
        request_id: String,
        reason_code: PairingErrorCode,
        message: String,
    },
    ParticipantRevoked {
        session_singer_id: String,
        reason_code: String,
        message: String,
    },
    OfferExpired {
        offer_id: String,
    },
    OfferCancelled {
        offer_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParticipantRevocation {
    pub connection_id: Option<String>,
    pub outbound: PairingOutboundMessage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PairingDecisionProjection {
    pub projection: DevelopmentPairingProjection,
    pub outbound: Option<PairingOutboundMessage>,
}
