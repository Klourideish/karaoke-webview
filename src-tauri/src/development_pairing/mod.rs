mod coordinator;
mod models;

#[cfg(test)]
mod tests;

pub(crate) use coordinator::DevelopmentPairingCoordinator;
pub(crate) use models::{
    AcceptedParticipantProjection, CreatePairingOfferRequest,
    DevelopmentPairingDiagnosticsProjection, DevelopmentPairingProjection, PairingClaim,
    PairingConnectionContext, PairingError, PairingErrorCode, PairingOfferProjection,
    PairingOperatorActionRequest, PairingOutboundMessage, PairingScopeProjection,
    ParticipantRevocation, ParticipantSetupProposal,
};

#[cfg(test)]
pub(crate) use models::PairingOfferState;

#[tauri::command]
pub(crate) fn create_development_pairing_offer(
    request: CreatePairingOfferRequest,
    coordinator: tauri::State<'_, std::sync::Arc<DevelopmentPairingCoordinator>>,
    development: tauri::State<
        '_,
        std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
    >,
) -> Result<PairingOfferProjection, PairingError> {
    let (host_address, control_port) = development.pairing_endpoint()?;
    coordinator.create_offer(request, host_address, control_port)
}

#[tauri::command]
pub(crate) fn get_development_pairing_status(
    coordinator: tauri::State<'_, std::sync::Arc<DevelopmentPairingCoordinator>>,
    development: tauri::State<
        '_,
        std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
    >,
) -> DevelopmentPairingProjection {
    if let Some(outbound) = coordinator.expire_due() {
        development.queue_pairing_outbound(outbound);
    }
    coordinator.projection()
}

#[tauri::command]
pub(crate) fn get_development_pairing_diagnostics(
    coordinator: tauri::State<'_, std::sync::Arc<DevelopmentPairingCoordinator>>,
) -> DevelopmentPairingDiagnosticsProjection {
    coordinator.projection().diagnostics
}

#[tauri::command]
pub(crate) fn cancel_development_pairing_offer(
    request: PairingOperatorActionRequest,
    coordinator: tauri::State<'_, std::sync::Arc<DevelopmentPairingCoordinator>>,
    development: tauri::State<
        '_,
        std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
    >,
) -> Result<DevelopmentPairingProjection, PairingError> {
    let decision = coordinator.cancel_offer(request)?;
    if let Some(outbound) = decision.outbound {
        development.queue_pairing_outbound(outbound);
    }
    Ok(decision.projection)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn accept_development_pairing_proposal(
    request: PairingOperatorActionRequest,
    coordinator: tauri::State<'_, std::sync::Arc<DevelopmentPairingCoordinator>>,
    participant_commits: tauri::State<'_, crate::participant_commit::ParticipantCommitCoordinator>,
    singers: tauri::State<'_, crate::session_singers::SessionSingerRegistry>,
    channels: tauri::State<'_, crate::microphones::MicrophoneChannelRegistry>,
    assignments: tauri::State<'_, crate::microphones::MicrophoneAssignmentRegistry>,
    operations: tauri::State<'_, crate::microphones::MicrophoneRegistryOperations>,
    development: tauri::State<
        '_,
        std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
    >,
) -> Result<DevelopmentPairingProjection, PairingError> {
    let sources = crate::microphones::discover_all_sources(Some(&development))
        .map_err(|error| PairingError::new(PairingErrorCode::InternalError, error))?;
    let decision = coordinator.accept_proposal(
        request,
        &sources,
        &participant_commits,
        &singers,
        &channels,
        &assignments,
        &operations,
    )?;
    if let Some(outbound) = decision.outbound {
        development.queue_pairing_outbound(outbound);
    }
    Ok(decision.projection)
}

#[tauri::command]
pub(crate) fn reject_development_pairing_proposal(
    request: PairingOperatorActionRequest,
    coordinator: tauri::State<'_, std::sync::Arc<DevelopmentPairingCoordinator>>,
    development: tauri::State<
        '_,
        std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
    >,
) -> Result<DevelopmentPairingProjection, PairingError> {
    let decision = coordinator.reject_proposal(request)?;
    if let Some(outbound) = decision.outbound {
        development.queue_pairing_outbound(outbound);
    }
    Ok(decision.projection)
}
