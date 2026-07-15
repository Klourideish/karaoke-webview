use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    sync::Mutex,
    time::{Duration, Instant, SystemTime},
};

use chrono::{DateTime, SecondsFormat, Utc};

use crate::{
    microphones::{
        DiscoveredMicrophoneSource, MicrophoneAssignmentRegistry, MicrophoneChannelRegistry,
        MicrophoneRegistryOperations,
    },
    participant_commit::{
        CreateSingerWithMicrophoneRequest, ParticipantCommitCoordinator, ParticipantCommitError,
        ParticipantCommitErrorCode,
    },
    session_singers::{SessionSingerErrorCode, SessionSingerRegistry},
};

use super::models::{
    AcceptedParticipantProjection, CreatePairingOfferRequest,
    DevelopmentPairingDiagnosticsProjection, DevelopmentPairingProjection,
    DevelopmentPairingStatusProjection, PairingClaim, PairingConnectionContext,
    PairingDecisionProjection, PairingError, PairingErrorCode, PairingOfferProjection,
    PairingOfferState, PairingOperatorActionRequest, PairingOutboundMessage, PairingQrPayload,
    PairingScopeProjection, ParticipantRevocation, ParticipantSetupProposal,
    PendingParticipantProjection, RevokedParticipantProjection, DEFAULT_PAIRING_LIFETIME_SECONDS,
};

const OFFER_REGISTRY_LIMIT: usize = 32;
const REQUEST_CACHE_LIMIT: usize = 128;
const HOST_DISPLAY_NAME: &str = "Karaoke Host";

#[derive(Clone)]
struct ClaimContext {
    connection: PairingConnectionContext,
    client_name: String,
}

#[derive(Clone)]
struct OfferRecord {
    offer_id: String,
    state: PairingOfferState,
    host_address: String,
    control_port: u16,
    expires_at: SystemTime,
    deadline: Instant,
    lifetime_seconds: u64,
    pairing_token: Option<String>,
    participant_setup_token: Option<String>,
    claim: Option<ClaimContext>,
    proposal: Option<ParticipantSetupProposal>,
    accepted_participant: Option<AcceptedParticipantProjection>,
    last_rejection: Option<PairingError>,
}

#[derive(Clone)]
struct CachedOffer {
    fingerprint: String,
    projection: PairingOfferProjection,
}

#[derive(Clone)]
struct CachedDecision {
    fingerprint: String,
    projection: DevelopmentPairingProjection,
}

#[derive(Default)]
struct OfferState {
    offers: VecDeque<OfferRecord>,
    current_offer_id: Option<String>,
    create_cache: HashMap<String, CachedOffer>,
    create_order: VecDeque<String>,
    decision_cache: HashMap<String, CachedDecision>,
    decision_order: VecDeque<String>,
    last_revoked_participant: Option<RevokedParticipantProjection>,
    diagnostics: DevelopmentPairingDiagnosticsProjection,
}

#[derive(Default)]
pub(crate) struct PairingOfferManager {
    state: Mutex<OfferState>,
}

pub(crate) struct DevelopmentPairingCoordinator {
    operations: Mutex<()>,
    offers: PairingOfferManager,
}

impl Default for DevelopmentPairingCoordinator {
    fn default() -> Self {
        Self {
            operations: Mutex::new(()),
            offers: PairingOfferManager::default(),
        }
    }
}

impl DevelopmentPairingCoordinator {
    pub(crate) fn create_offer(
        &self,
        request: CreatePairingOfferRequest,
        host_address: String,
        control_port: u16,
    ) -> Result<PairingOfferProjection, PairingError> {
        self.create_offer_with_lifetime(
            request,
            host_address,
            control_port,
            DEFAULT_PAIRING_LIFETIME_SECONDS,
        )
    }

    pub(crate) fn create_offer_with_lifetime(
        &self,
        request: CreatePairingOfferRequest,
        host_address: String,
        control_port: u16,
        lifetime_seconds: u64,
    ) -> Result<PairingOfferProjection, PairingError> {
        validate_request_id(&request.request_id)?;
        validate_host_address(&host_address)?;
        if lifetime_seconds == 0 {
            return Err(PairingError::new(
                PairingErrorCode::InvalidRequest,
                "Pairing offer lifetime must be positive.",
            ));
        }
        let _operation = lock(&self.operations);
        self.offers.create(
            request,
            host_address,
            control_port,
            Duration::from_secs(lifetime_seconds),
        )
    }

    pub(crate) fn claim(
        &self,
        connection: PairingConnectionContext,
        claim: PairingClaim,
    ) -> Result<PairingOutboundMessage, PairingError> {
        let _operation = lock(&self.operations);
        self.offers.claim(connection, claim)
    }

    pub(crate) fn submit_proposal(
        &self,
        connection: PairingConnectionContext,
        proposal: ParticipantSetupProposal,
    ) -> Result<(), PairingError> {
        let _operation = lock(&self.operations);
        self.offers.submit_proposal(connection, proposal)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn accept_proposal(
        &self,
        request: PairingOperatorActionRequest,
        sources: &[DiscoveredMicrophoneSource],
        participant_commits: &ParticipantCommitCoordinator,
        singers: &SessionSingerRegistry,
        channels: &MicrophoneChannelRegistry,
        assignments: &MicrophoneAssignmentRegistry,
        microphone_operations: &MicrophoneRegistryOperations,
    ) -> Result<PairingDecisionProjection, PairingError> {
        validate_request_id(&request.request_id)?;
        let _operation = lock(&self.operations);
        if let Some(projection) = self.offers.cached_decision(
            &request.request_id,
            &format!("accept\0{}", request.offer_id),
        )? {
            return Ok(PairingDecisionProjection {
                projection,
                outbound: None,
            });
        }
        let pending = self.offers.pending_for_decision(&request.offer_id)?;
        let normalized_name =
            SessionSingerRegistry::validate_display_name(&pending.proposal.preferred_display_name)
                .map_err(map_name_error)?;
        let commit = participant_commits.create_singer_with_microphone(
            CreateSingerWithMicrophoneRequest {
                request_id: format!("pairing-participant-{}", pending.offer_id),
                display_name: normalized_name,
                source_id: pending.source_id,
            },
            sources,
            singers,
            channels,
            assignments,
            microphone_operations,
        );
        match commit {
            Ok(commit) => {
                let participant = AcceptedParticipantProjection::from_singer(
                    HOST_DISPLAY_NAME.to_string(),
                    &commit.session_singer,
                );
                let outbound = PairingOutboundMessage::ParticipantAccepted {
                    request_id: pending.proposal.request_id,
                    participant: participant.clone(),
                };
                let projection = self.offers.finish_accept(&request.offer_id, participant)?;
                self.offers.cache_decision(
                    request.request_id,
                    format!("accept\0{}", request.offer_id),
                    projection.clone(),
                );
                Ok(PairingDecisionProjection {
                    projection,
                    outbound: Some(outbound),
                })
            }
            Err(error) => {
                let pairing_error = map_commit_error(error);
                let outbound = PairingOutboundMessage::ParticipantRejected {
                    request_id: pending.proposal.request_id,
                    reason_code: pairing_error.reason_code,
                    message: pairing_error.message.clone(),
                };
                let projection = self
                    .offers
                    .finish_reject(&request.offer_id, pairing_error.clone())?;
                self.offers.cache_decision(
                    request.request_id,
                    format!("accept\0{}", request.offer_id),
                    projection.clone(),
                );
                Ok(PairingDecisionProjection {
                    projection,
                    outbound: Some(outbound),
                })
            }
        }
    }

    pub(crate) fn reject_proposal(
        &self,
        request: PairingOperatorActionRequest,
    ) -> Result<PairingDecisionProjection, PairingError> {
        validate_request_id(&request.request_id)?;
        let _operation = lock(&self.operations);
        let fingerprint = format!("reject\0{}", request.offer_id);
        if let Some(projection) = self
            .offers
            .cached_decision(&request.request_id, &fingerprint)?
        {
            return Ok(PairingDecisionProjection {
                projection,
                outbound: None,
            });
        }
        let pending = self.offers.pending_for_decision(&request.offer_id)?;
        let error = PairingError::new(
            PairingErrorCode::OperatorApprovalRequired,
            "The Host operator rejected this participant.",
        );
        let outbound = PairingOutboundMessage::ParticipantRejected {
            request_id: pending.proposal.request_id,
            reason_code: error.reason_code,
            message: error.message.clone(),
        };
        let projection = self.offers.finish_reject(&request.offer_id, error)?;
        self.offers
            .cache_decision(request.request_id, fingerprint, projection.clone());
        Ok(PairingDecisionProjection {
            projection,
            outbound: Some(outbound),
        })
    }

    pub(crate) fn cancel_offer(
        &self,
        request: PairingOperatorActionRequest,
    ) -> Result<PairingDecisionProjection, PairingError> {
        validate_request_id(&request.request_id)?;
        let _operation = lock(&self.operations);
        self.offers.cancel(&request.offer_id)
    }

    pub(crate) fn expire_due(&self) -> Option<PairingOutboundMessage> {
        let _operation = lock(&self.operations);
        self.offers.expire_due()
    }

    pub(crate) fn connection_lost(&self, connection_id: &str) {
        let _operation = lock(&self.operations);
        self.offers.connection_lost(connection_id);
    }

    pub(crate) fn remove_participant<T, E>(
        &self,
        singer_id: &str,
        remove: impl FnOnce() -> Result<T, E>,
    ) -> Result<(T, Option<ParticipantRevocation>), E> {
        let _operation = lock(&self.operations);
        let removed = remove()?;
        let revocation = self.offers.revoke_accepted_participant(singer_id);
        Ok((removed, revocation))
    }

    pub(crate) fn listener_stopped(&self) {
        let _operation = lock(&self.operations);
        self.offers
            .cancel_current("The development listener stopped.");
    }

    pub(crate) fn projection(&self) -> DevelopmentPairingProjection {
        let _operation = lock(&self.operations);
        self.offers.projection()
    }

    #[cfg(test)]
    pub(super) fn expire_current_for_test(&self) {
        let _operation = lock(&self.operations);
        let mut state = lock(&self.offers.state);
        if let Some(offer) = current_offer_mut(&mut state) {
            offer.deadline = Instant::now();
        }
    }
}

struct PendingDecision {
    offer_id: String,
    source_id: String,
    proposal: ParticipantSetupProposal,
}

impl PairingOfferManager {
    fn create(
        &self,
        request: CreatePairingOfferRequest,
        host_address: String,
        control_port: u16,
        lifetime: Duration,
    ) -> Result<PairingOfferProjection, PairingError> {
        let fingerprint = format!("{host_address}\0{control_port}\0{}", lifetime.as_secs());
        let mut state = lock(&self.state);
        if let Some(cached) = state.create_cache.get(&request.request_id) {
            if cached.fingerprint != fingerprint {
                return Err(PairingError::new(
                    PairingErrorCode::RequestIdConflict,
                    "This request ID was already used for another pairing offer.",
                ));
            }
            return Ok(cached.projection.clone());
        }
        expire_locked(&mut state);
        if current_offer(&state).is_some_and(|offer| !offer.state.is_terminal()) {
            return Err(PairingError::new(
                PairingErrorCode::OfferAlreadyActive,
                "A development pairing offer is already active.",
            ));
        }
        let offer_id = format!("pairing-offer-{}", random_hex(16)?);
        let pairing_token = random_hex(32)?;
        let expires_at = SystemTime::now() + lifetime;
        let expires_at_text = format_timestamp(expires_at);
        let qr = PairingQrPayload {
            message_type: "pairing_offer_projection".to_string(),
            profile_version: 0,
            offer_id: offer_id.clone(),
            host_display_name: HOST_DISPLAY_NAME.to_string(),
            host_address: host_address.clone(),
            control_port,
            pairing_token: pairing_token.clone(),
            expires_at: expires_at_text.clone(),
            lifetime_seconds: lifetime.as_secs(),
            pairing_scope: PairingScopeProjection::Generic,
        };
        let projection = PairingOfferProjection {
            profile_version: 0,
            offer_id: offer_id.clone(),
            host_display_name: HOST_DISPLAY_NAME.to_string(),
            host_address: host_address.clone(),
            control_port,
            pairing_token: pairing_token.clone(),
            expires_at: expires_at_text,
            lifetime_seconds: lifetime.as_secs(),
            pairing_scope: PairingScopeProjection::Generic,
            qr_payload: serde_json::to_string(&qr).map_err(|_| {
                PairingError::new(
                    PairingErrorCode::InternalError,
                    "The pairing QR payload could not be created.",
                )
            })?,
        };
        let mut record = OfferRecord {
            offer_id: offer_id.clone(),
            state: PairingOfferState::Created,
            host_address,
            control_port,
            expires_at,
            deadline: Instant::now() + lifetime,
            lifetime_seconds: lifetime.as_secs(),
            pairing_token: Some(pairing_token),
            participant_setup_token: None,
            claim: None,
            proposal: None,
            accepted_participant: None,
            last_rejection: None,
        };
        record.state = PairingOfferState::Displayed;
        state.offers.push_back(record);
        state.current_offer_id = Some(offer_id);
        state.diagnostics.offers_created += 1;
        cache_offer(
            &mut state,
            request.request_id,
            fingerprint,
            projection.clone(),
        );
        trim_offers(&mut state);
        Ok(projection)
    }

    fn claim(
        &self,
        connection: PairingConnectionContext,
        claim: PairingClaim,
    ) -> Result<PairingOutboundMessage, PairingError> {
        if claim.profile_version != 0 {
            return Err(PairingError::new(
                PairingErrorCode::UnsupportedProfileVersion,
                "Development Pairing Profile V0 is required.",
            ));
        }
        validate_request_id(&claim.request_id)?;
        if claim.client_device_id.trim().is_empty() || claim.client_name.trim().is_empty() {
            return Err(PairingError::new(
                PairingErrorCode::InvalidRequest,
                "A client device and name are required.",
            ));
        }
        if claim.client_device_id != connection.client_device_id {
            return Err(PairingError::new(
                PairingErrorCode::ClientDeviceRejected,
                "The pairing claim does not match the connected client device.",
            ));
        }
        let mut state = lock(&self.state);
        expire_locked(&mut state);
        let offer = find_offer_mut(&mut state, &claim.offer_id)?;
        match offer.state {
            PairingOfferState::Expired => return Err(offer_error(PairingErrorCode::OfferExpired)),
            PairingOfferState::Cancelled => {
                return Err(offer_error(PairingErrorCode::OfferCancelled))
            }
            PairingOfferState::Claimed
            | PairingOfferState::AwaitingParticipantSetup
            | PairingOfferState::AwaitingOperatorApproval => {
                state.diagnostics.duplicate_claims += 1;
                return Err(offer_error(PairingErrorCode::OfferAlreadyClaimed));
            }
            PairingOfferState::Accepted | PairingOfferState::Rejected => {
                return Err(offer_error(PairingErrorCode::OfferAlreadyUsed))
            }
            PairingOfferState::Created | PairingOfferState::Displayed => {}
        }
        if offer.pairing_token.as_deref() != Some(claim.pairing_token.as_str()) {
            state.diagnostics.invalid_tokens += 1;
            return Err(PairingError::new(
                PairingErrorCode::InvalidToken,
                "The pairing token is invalid.",
            ));
        }
        let setup_token = random_hex(32)?;
        offer.pairing_token = None;
        offer.participant_setup_token = Some(setup_token.clone());
        offer.claim = Some(ClaimContext {
            connection,
            client_name: claim.client_name,
        });
        offer.state = PairingOfferState::Claimed;
        offer.state = PairingOfferState::AwaitingParticipantSetup;
        state.diagnostics.offers_consumed += 1;
        Ok(PairingOutboundMessage::AcceptedForSetup {
            request_id: claim.request_id,
            offer_id: claim.offer_id,
            participant_setup_token: setup_token,
            host_display_name: HOST_DISPLAY_NAME.to_string(),
        })
    }

    fn submit_proposal(
        &self,
        connection: PairingConnectionContext,
        proposal: ParticipantSetupProposal,
    ) -> Result<(), PairingError> {
        if proposal.profile_version != 0 {
            return Err(PairingError::new(
                PairingErrorCode::UnsupportedProfileVersion,
                "Development Pairing Profile V0 is required.",
            ));
        }
        validate_request_id(&proposal.request_id)?;
        if proposal.client_device_id.trim().is_empty()
            || proposal.local_participant_profile_id.trim().is_empty()
        {
            return Err(PairingError::new(
                PairingErrorCode::InvalidRequest,
                "Participant profile and client device IDs are required.",
            ));
        }
        SessionSingerRegistry::validate_display_name(&proposal.preferred_display_name)
            .map_err(map_name_error)?;
        let mut state = lock(&self.state);
        expire_locked(&mut state);
        let offer = find_offer_mut(&mut state, &proposal.offer_id)?;
        if offer.state == PairingOfferState::AwaitingOperatorApproval {
            if offer.proposal.as_ref() == Some(&proposal) {
                return Ok(());
            }
            return Err(PairingError::new(
                PairingErrorCode::InvalidState,
                "A different participant proposal is already awaiting review.",
            ));
        }
        if offer.state != PairingOfferState::AwaitingParticipantSetup {
            return Err(state_error(offer.state));
        }
        let claim = offer.claim.as_ref().ok_or_else(|| {
            PairingError::new(
                PairingErrorCode::InvalidState,
                "The offer has no active claim.",
            )
        })?;
        if claim.connection != connection
            || proposal.client_device_id != connection.client_device_id
        {
            return Err(PairingError::new(
                PairingErrorCode::ClientDeviceRejected,
                "The participant proposal does not match the claimed connection.",
            ));
        }
        if offer.participant_setup_token.as_deref()
            != Some(proposal.participant_setup_token.as_str())
        {
            state.diagnostics.invalid_tokens += 1;
            return Err(PairingError::new(
                PairingErrorCode::InvalidParticipantSetupToken,
                "The participant setup token is invalid.",
            ));
        }
        offer.proposal = Some(proposal);
        offer.state = PairingOfferState::AwaitingOperatorApproval;
        state.diagnostics.proposals_received += 1;
        Ok(())
    }

    fn pending_for_decision(&self, offer_id: &str) -> Result<PendingDecision, PairingError> {
        let mut state = lock(&self.state);
        expire_locked(&mut state);
        let offer = find_offer(&state, offer_id)?;
        if offer.state != PairingOfferState::AwaitingOperatorApproval {
            return Err(state_error(offer.state));
        }
        let claim = offer.claim.as_ref().ok_or_else(|| {
            PairingError::new(
                PairingErrorCode::InvalidState,
                "The pairing claim is missing.",
            )
        })?;
        let proposal = offer.proposal.clone().ok_or_else(|| {
            PairingError::new(
                PairingErrorCode::InvalidState,
                "No participant proposal is awaiting review.",
            )
        })?;
        Ok(PendingDecision {
            offer_id: offer.offer_id.clone(),
            source_id: claim.connection.source_id.clone(),
            proposal,
        })
    }

    fn finish_accept(
        &self,
        offer_id: &str,
        participant: AcceptedParticipantProjection,
    ) -> Result<DevelopmentPairingProjection, PairingError> {
        let mut state = lock(&self.state);
        let offer = find_offer_mut(&mut state, offer_id)?;
        if offer.state != PairingOfferState::AwaitingOperatorApproval {
            return Err(state_error(offer.state));
        }
        offer.state = PairingOfferState::Accepted;
        offer.participant_setup_token = None;
        offer.accepted_participant = Some(participant);
        state.diagnostics.accepted_participants += 1;
        Ok(projection_locked(&state))
    }

    fn finish_reject(
        &self,
        offer_id: &str,
        error: PairingError,
    ) -> Result<DevelopmentPairingProjection, PairingError> {
        let mut state = lock(&self.state);
        let offer = find_offer_mut(&mut state, offer_id)?;
        if offer.state != PairingOfferState::AwaitingOperatorApproval {
            return Err(state_error(offer.state));
        }
        offer.state = PairingOfferState::Rejected;
        offer.participant_setup_token = None;
        offer.last_rejection = Some(error);
        state.diagnostics.rejected_proposals += 1;
        Ok(projection_locked(&state))
    }

    fn cancel(&self, offer_id: &str) -> Result<PairingDecisionProjection, PairingError> {
        let mut state = lock(&self.state);
        expire_locked(&mut state);
        let offer = find_offer_mut(&mut state, offer_id)?;
        let outbound = if offer.state == PairingOfferState::Cancelled {
            None
        } else if offer.state.is_terminal() {
            return Err(state_error(offer.state));
        } else {
            offer.state = PairingOfferState::Cancelled;
            offer.pairing_token = None;
            offer.participant_setup_token = None;
            state.diagnostics.offers_cancelled += 1;
            Some(PairingOutboundMessage::OfferCancelled {
                offer_id: offer_id.to_string(),
            })
        };
        Ok(PairingDecisionProjection {
            projection: projection_locked(&state),
            outbound,
        })
    }

    fn cancel_current(&self, message: &str) {
        let mut state = lock(&self.state);
        let Some(offer) = current_offer_mut(&mut state) else {
            return;
        };
        if offer.state.is_terminal() {
            return;
        }
        offer.state = PairingOfferState::Cancelled;
        offer.pairing_token = None;
        offer.participant_setup_token = None;
        offer.last_rejection = Some(PairingError::new(PairingErrorCode::OfferCancelled, message));
        state.diagnostics.offers_cancelled += 1;
    }

    fn expire_due(&self) -> Option<PairingOutboundMessage> {
        let mut state = lock(&self.state);
        let offer_id = current_offer(&state)
            .filter(|offer| !offer.state.is_terminal() && Instant::now() >= offer.deadline)
            .map(|offer| offer.offer_id.clone())?;
        expire_locked(&mut state);
        Some(PairingOutboundMessage::OfferExpired { offer_id })
    }

    fn connection_lost(&self, connection_id: &str) {
        let mut state = lock(&self.state);
        let Some(offer) = current_offer_mut(&mut state) else {
            return;
        };
        if offer.state.is_terminal()
            || !offer
                .claim
                .as_ref()
                .is_some_and(|claim| claim.connection.connection_id == connection_id)
        {
            return;
        }
        offer.state = PairingOfferState::Rejected;
        offer.participant_setup_token = None;
        offer.last_rejection = Some(PairingError::new(
            PairingErrorCode::InvalidState,
            "The participant disconnected before setup completed.",
        ));
        state.diagnostics.rejected_proposals += 1;
    }

    fn revoke_accepted_participant(&self, singer_id: &str) -> Option<ParticipantRevocation> {
        let mut state = lock(&self.state);
        let index = state.offers.iter().position(|offer| {
            offer
                .accepted_participant
                .as_ref()
                .is_some_and(|participant| participant.session_singer_id == singer_id)
        })?;
        let (participant, connection_id) = {
            let offer = state.offers.get_mut(index)?;
            let participant = offer.accepted_participant.take()?;
            let connection_id = offer
                .claim
                .as_ref()
                .map(|claim| claim.connection.connection_id.clone());
            offer.pairing_token = None;
            offer.participant_setup_token = None;
            offer.claim = None;
            offer.proposal = None;
            (participant, connection_id)
        };
        let reason_code = "session-singer-removed".to_string();
        let message = "The Host removed this participant from the karaoke session.".to_string();
        state.last_revoked_participant = Some(RevokedParticipantProjection {
            session_singer_id: participant.session_singer_id.clone(),
            accepted_display_name: participant.accepted_display_name,
            reason_code: reason_code.clone(),
            message: message.clone(),
        });
        state.diagnostics.revoked_participants += 1;
        Some(ParticipantRevocation {
            connection_id,
            outbound: PairingOutboundMessage::ParticipantRevoked {
                session_singer_id: singer_id.to_string(),
                reason_code,
                message,
            },
        })
    }

    fn cached_decision(
        &self,
        request_id: &str,
        fingerprint: &str,
    ) -> Result<Option<DevelopmentPairingProjection>, PairingError> {
        let state = lock(&self.state);
        let Some(cached) = state.decision_cache.get(request_id) else {
            return Ok(None);
        };
        if cached.fingerprint != fingerprint {
            return Err(PairingError::new(
                PairingErrorCode::RequestIdConflict,
                "This request ID was already used for another pairing decision.",
            ));
        }
        Ok(Some(cached.projection.clone()))
    }

    fn cache_decision(
        &self,
        request_id: String,
        fingerprint: String,
        projection: DevelopmentPairingProjection,
    ) {
        let mut state = lock(&self.state);
        if !state.decision_cache.contains_key(&request_id) {
            state.decision_order.push_back(request_id.clone());
        }
        state.decision_cache.insert(
            request_id,
            CachedDecision {
                fingerprint,
                projection,
            },
        );
        while state.decision_order.len() > REQUEST_CACHE_LIMIT {
            if let Some(id) = state.decision_order.pop_front() {
                state.decision_cache.remove(&id);
            }
        }
    }

    fn projection(&self) -> DevelopmentPairingProjection {
        let mut state = lock(&self.state);
        expire_locked(&mut state);
        projection_locked(&state)
    }
}

fn projection_locked(state: &OfferState) -> DevelopmentPairingProjection {
    let offer = current_offer(state);
    DevelopmentPairingProjection {
        status: DevelopmentPairingStatusProjection {
            active_offer_id: offer.map(|offer| offer.offer_id.clone()),
            lifecycle_state: offer.map(|offer| offer.state),
            host_address: offer.map(|offer| offer.host_address.clone()),
            control_port: offer.map(|offer| offer.control_port),
            expires_in_seconds: offer.map(|offer| {
                if offer.state.is_terminal() {
                    0
                } else {
                    offer
                        .deadline
                        .saturating_duration_since(Instant::now())
                        .as_secs()
                }
            }),
            expires_at: offer.map(|offer| format_timestamp(offer.expires_at)),
            lifetime_seconds: offer.map(|offer| offer.lifetime_seconds),
            claimed_client_name: offer
                .and_then(|offer| offer.claim.as_ref().map(|claim| claim.client_name.clone())),
            claimed_client_device_id: offer.and_then(|offer| {
                offer
                    .claim
                    .as_ref()
                    .map(|claim| claim.connection.client_device_id.clone())
            }),
            participant_setup_token_issued: offer
                .is_some_and(|offer| offer.participant_setup_token.is_some()),
            pending_participant: offer.and_then(pending_projection),
            accepted_participant: offer.and_then(|offer| offer.accepted_participant.clone()),
            last_revoked_participant: state.last_revoked_participant.clone(),
            last_rejection_reason: offer
                .and_then(|offer| offer.last_rejection.as_ref().map(|error| error.reason_code)),
            last_rejection_message: offer.and_then(|offer| {
                offer
                    .last_rejection
                    .as_ref()
                    .map(|error| error.message.clone())
            }),
        },
        diagnostics: state.diagnostics.clone_with_count(state.offers.len()),
    }
}

trait DiagnosticsCount {
    fn clone_with_count(&self, retained_offer_count: usize) -> Self;
}

impl DiagnosticsCount for DevelopmentPairingDiagnosticsProjection {
    fn clone_with_count(&self, retained_offer_count: usize) -> Self {
        let mut projection = self.clone();
        projection.retained_offer_count = retained_offer_count;
        projection
    }
}

fn pending_projection(offer: &OfferRecord) -> Option<PendingParticipantProjection> {
    let proposal = offer.proposal.as_ref()?;
    let claim = offer.claim.as_ref()?;
    Some(PendingParticipantProjection {
        request_id: proposal.request_id.clone(),
        client_device_id: proposal.client_device_id.clone(),
        client_name: claim.client_name.clone(),
        local_participant_profile_id: proposal.local_participant_profile_id.clone(),
        preferred_display_name: proposal.preferred_display_name.clone(),
        previous_host_participant_reference: proposal.previous_host_participant_reference.clone(),
    })
}

fn expire_locked(state: &mut OfferState) {
    let Some(offer) = current_offer_mut(state) else {
        return;
    };
    if offer.state.is_terminal() || Instant::now() < offer.deadline {
        return;
    }
    offer.state = PairingOfferState::Expired;
    offer.pairing_token = None;
    offer.participant_setup_token = None;
    state.diagnostics.offers_expired += 1;
}

fn current_offer(state: &OfferState) -> Option<&OfferRecord> {
    let id = state.current_offer_id.as_deref()?;
    state.offers.iter().find(|offer| offer.offer_id == id)
}

fn current_offer_mut(state: &mut OfferState) -> Option<&mut OfferRecord> {
    let id = state.current_offer_id.clone()?;
    state.offers.iter_mut().find(|offer| offer.offer_id == id)
}

fn find_offer<'a>(state: &'a OfferState, offer_id: &str) -> Result<&'a OfferRecord, PairingError> {
    state
        .offers
        .iter()
        .find(|offer| offer.offer_id == offer_id)
        .ok_or_else(|| offer_error(PairingErrorCode::OfferNotFound))
}

fn find_offer_mut<'a>(
    state: &'a mut OfferState,
    offer_id: &str,
) -> Result<&'a mut OfferRecord, PairingError> {
    state
        .offers
        .iter_mut()
        .find(|offer| offer.offer_id == offer_id)
        .ok_or_else(|| offer_error(PairingErrorCode::OfferNotFound))
}

fn cache_offer(
    state: &mut OfferState,
    request_id: String,
    fingerprint: String,
    projection: PairingOfferProjection,
) {
    state.create_order.push_back(request_id.clone());
    state.create_cache.insert(
        request_id,
        CachedOffer {
            fingerprint,
            projection,
        },
    );
    while state.create_order.len() > REQUEST_CACHE_LIMIT {
        if let Some(id) = state.create_order.pop_front() {
            state.create_cache.remove(&id);
        }
    }
}

fn trim_offers(state: &mut OfferState) {
    while state.offers.len() > OFFER_REGISTRY_LIMIT {
        let removable = state
            .offers
            .front()
            .is_some_and(|offer| offer.state.is_terminal());
        if !removable {
            break;
        }
        state.offers.pop_front();
    }
}

fn random_hex(byte_count: usize) -> Result<String, PairingError> {
    let mut bytes = vec![0u8; byte_count];
    getrandom::fill(&mut bytes).map_err(|_| {
        PairingError::new(
            PairingErrorCode::InternalError,
            "Secure development pairing material could not be generated.",
        )
    })?;
    let mut output = String::with_capacity(byte_count * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    Ok(output)
}

fn format_timestamp(timestamp: SystemTime) -> String {
    DateTime::<Utc>::from(timestamp).to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn validate_host_address(address: &str) -> Result<(), PairingError> {
    let parsed = address.parse::<IpAddr>().map_err(|_| {
        PairingError::new(
            PairingErrorCode::UnreachableHostAddress,
            "The listener bind address is not a valid IP address. Use a specific LAN address for phone pairing.",
        )
    })?;
    if parsed.is_loopback() {
        return Err(PairingError::new(
            PairingErrorCode::UnreachableHostAddress,
            "The development listener is bound to loopback. Restart it in Developer on a specific LAN address before pairing a phone.",
        ));
    }
    if parsed.is_unspecified() {
        return Err(PairingError::new(
            PairingErrorCode::UnreachableHostAddress,
            "The listener is bound to 0.0.0.0, which cannot be advertised to a phone. Choose a specific LAN address in Developer and restart the listener.",
        ));
    }
    Ok(())
}

fn validate_request_id(request_id: &str) -> Result<(), PairingError> {
    if request_id.trim().is_empty() || request_id.chars().count() > 128 {
        return Err(PairingError::new(
            PairingErrorCode::InvalidRequest,
            "A valid pairing request ID is required.",
        ));
    }
    Ok(())
}

fn offer_error(code: PairingErrorCode) -> PairingError {
    let message = match code {
        PairingErrorCode::OfferNotFound => "The pairing offer was not found.",
        PairingErrorCode::OfferExpired => "This pairing offer expired.",
        PairingErrorCode::OfferCancelled => "This pairing offer was cancelled.",
        PairingErrorCode::OfferAlreadyClaimed => "This pairing offer was already claimed.",
        PairingErrorCode::OfferAlreadyUsed => "This pairing offer was already used.",
        _ => "The pairing offer is not available.",
    };
    PairingError::new(code, message)
}

fn state_error(state: PairingOfferState) -> PairingError {
    match state {
        PairingOfferState::Expired => offer_error(PairingErrorCode::OfferExpired),
        PairingOfferState::Cancelled => offer_error(PairingErrorCode::OfferCancelled),
        state if state.is_terminal() => offer_error(PairingErrorCode::OfferAlreadyUsed),
        _ => PairingError::new(
            PairingErrorCode::InvalidState,
            "The pairing offer is not ready for this action.",
        ),
    }
}

fn map_name_error(error: crate::session_singers::SessionSingerError) -> PairingError {
    let code = match error.reason_code {
        SessionSingerErrorCode::DisplayNameEmpty => PairingErrorCode::DisplayNameEmpty,
        SessionSingerErrorCode::DisplayNameTooLong => PairingErrorCode::DisplayNameTooLong,
        SessionSingerErrorCode::DisplayNameControlCharacters => {
            PairingErrorCode::DisplayNameControlCharacters
        }
        _ => PairingErrorCode::InvalidDisplayName,
    };
    PairingError::new(code, error.message)
}

fn map_commit_error(error: ParticipantCommitError) -> PairingError {
    let code = match error.reason_code {
        ParticipantCommitErrorCode::InvalidDisplayName => PairingErrorCode::InvalidDisplayName,
        ParticipantCommitErrorCode::SourceUnavailable
        | ParticipantCommitErrorCode::SourceIneligible => PairingErrorCode::NetworkSourceIneligible,
        ParticipantCommitErrorCode::InvalidRequest => PairingErrorCode::InvalidRequest,
        ParticipantCommitErrorCode::RequestIdConflict => PairingErrorCode::RequestIdConflict,
        _ => PairingErrorCode::InternalError,
    };
    PairingError::new(code, error.message)
}

fn lock<T>(inner: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
