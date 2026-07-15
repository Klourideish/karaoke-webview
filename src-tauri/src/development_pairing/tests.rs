use std::{sync::Arc, thread};

use crate::{
    microphones::{
        DiscoveredMicrophoneSource, MicrophoneAssignmentRegistry, MicrophoneChannelRegistry,
        MicrophoneRegistryOperations, MicrophoneSourceAvailability, MicrophoneSourceKind,
    },
    participant_commit::ParticipantCommitCoordinator,
    session_singers::SessionSingerRegistry,
};

use super::{models::*, DevelopmentPairingCoordinator};

fn create_offer(coordinator: &DevelopmentPairingCoordinator) -> PairingOfferProjection {
    coordinator
        .create_offer(
            CreatePairingOfferRequest {
                request_id: "host-offer-1".to_string(),
            },
            "192.168.1.78".to_string(),
            45_820,
        )
        .unwrap()
}

fn context() -> PairingConnectionContext {
    PairingConnectionContext {
        connection_id: "connection-1".to_string(),
        client_device_id: "device-1".to_string(),
        source_id: "network-source-1".to_string(),
    }
}

fn claim(coordinator: &DevelopmentPairingCoordinator, offer: &PairingOfferProjection) -> String {
    let response = coordinator
        .claim(
            context(),
            PairingClaim {
                profile_version: 0,
                request_id: "claim-1".to_string(),
                offer_id: offer.offer_id.clone(),
                pairing_token: offer.pairing_token.clone(),
                client_device_id: "device-1".to_string(),
                client_name: "Test phone".to_string(),
            },
        )
        .unwrap();
    match response {
        PairingOutboundMessage::AcceptedForSetup {
            participant_setup_token,
            ..
        } => participant_setup_token,
        _ => panic!("unexpected pairing response"),
    }
}

fn submit_proposal(
    coordinator: &DevelopmentPairingCoordinator,
    offer: &PairingOfferProjection,
    setup_token: String,
) {
    coordinator
        .submit_proposal(
            context(),
            ParticipantSetupProposal {
                profile_version: 0,
                request_id: "proposal-1".to_string(),
                offer_id: offer.offer_id.clone(),
                participant_setup_token: setup_token,
                client_device_id: "device-1".to_string(),
                local_participant_profile_id: "profile-1".to_string(),
                preferred_display_name: "  Kyle   Test  ".to_string(),
                previous_host_participant_reference: Some("stale-hint".to_string()),
            },
        )
        .unwrap();
}

fn source() -> DiscoveredMicrophoneSource {
    DiscoveredMicrophoneSource {
        id: "network-source-1".to_string(),
        display_name: "Test phone".to_string(),
        kind: MicrophoneSourceKind::NetworkClient,
        availability: MicrophoneSourceAvailability::Available,
        is_default: false,
    }
}

#[test]
fn offer_is_short_lived_single_use_and_qr_contains_no_singer_authority() {
    let coordinator = DevelopmentPairingCoordinator::default();
    let offer = create_offer(&coordinator);

    assert!(!offer.pairing_token.is_empty());
    assert_eq!(offer.lifetime_seconds, 120);
    assert!(offer.qr_payload.contains("pairing_offer_projection"));
    assert!(!offer.qr_payload.contains("sessionSingerId"));
    assert_eq!(
        coordinator.projection().status.lifecycle_state,
        Some(PairingOfferState::Displayed)
    );

    claim(&coordinator, &offer);
    let replay = coordinator
        .claim(
            context(),
            PairingClaim {
                profile_version: 0,
                request_id: "claim-2".to_string(),
                offer_id: offer.offer_id,
                pairing_token: offer.pairing_token,
                client_device_id: "device-1".to_string(),
                client_name: "Test phone".to_string(),
            },
        )
        .unwrap_err();
    assert_eq!(replay.reason_code, PairingErrorCode::OfferAlreadyClaimed);
    assert_eq!(coordinator.projection().diagnostics.duplicate_claims, 1);
}

#[test]
fn invalid_token_expiry_and_cancellation_are_terminal() {
    let coordinator = DevelopmentPairingCoordinator::default();
    let offer = create_offer(&coordinator);
    let invalid = coordinator
        .claim(
            context(),
            PairingClaim {
                profile_version: 0,
                request_id: "claim-bad".to_string(),
                offer_id: offer.offer_id.clone(),
                pairing_token: "wrong".to_string(),
                client_device_id: "device-1".to_string(),
                client_name: "Test phone".to_string(),
            },
        )
        .unwrap_err();
    assert_eq!(invalid.reason_code, PairingErrorCode::InvalidToken);

    coordinator
        .cancel_offer(PairingOperatorActionRequest {
            request_id: "cancel-1".to_string(),
            offer_id: offer.offer_id.clone(),
        })
        .unwrap();
    assert_eq!(
        coordinator.projection().status.lifecycle_state,
        Some(PairingOfferState::Cancelled)
    );

    let next = coordinator
        .create_offer(
            CreatePairingOfferRequest {
                request_id: "host-offer-2".to_string(),
            },
            "192.168.1.78".to_string(),
            45_820,
        )
        .unwrap();
    coordinator.expire_current_for_test();
    assert!(matches!(
        coordinator.expire_due(),
        Some(PairingOutboundMessage::OfferExpired { offer_id }) if offer_id == next.offer_id
    ));
    assert_eq!(
        coordinator.projection().status.lifecycle_state,
        Some(PairingOfferState::Expired)
    );
}

#[test]
fn phone_offer_rejects_loopback_and_unspecified_advertised_addresses_clearly() {
    let coordinator = DevelopmentPairingCoordinator::default();
    let loopback = coordinator
        .create_offer(
            CreatePairingOfferRequest {
                request_id: "loopback-offer".to_string(),
            },
            "127.0.0.1".to_string(),
            45_820,
        )
        .unwrap_err();
    assert_eq!(
        loopback.reason_code,
        PairingErrorCode::UnreachableHostAddress
    );
    assert!(loopback.message.contains("loopback"));

    let unspecified = coordinator
        .create_offer(
            CreatePairingOfferRequest {
                request_id: "unspecified-offer".to_string(),
            },
            "0.0.0.0".to_string(),
            45_820,
        )
        .unwrap_err();
    assert_eq!(
        unspecified.reason_code,
        PairingErrorCode::UnreachableHostAddress
    );
    assert!(unspecified.message.contains("0.0.0.0"));
    assert!(unspecified.message.contains("specific LAN address"));
}

#[test]
fn setup_token_is_distinct_bound_and_proposal_is_validated() {
    let coordinator = DevelopmentPairingCoordinator::default();
    let offer = create_offer(&coordinator);
    let setup_token = claim(&coordinator, &offer);
    assert_ne!(setup_token, offer.pairing_token);

    let wrong_device = coordinator
        .submit_proposal(
            PairingConnectionContext {
                client_device_id: "other-device".to_string(),
                ..context()
            },
            ParticipantSetupProposal {
                profile_version: 0,
                request_id: "proposal-bad".to_string(),
                offer_id: offer.offer_id.clone(),
                participant_setup_token: setup_token.clone(),
                client_device_id: "other-device".to_string(),
                local_participant_profile_id: "profile-1".to_string(),
                preferred_display_name: "Kyle".to_string(),
                previous_host_participant_reference: None,
            },
        )
        .unwrap_err();
    assert_eq!(
        wrong_device.reason_code,
        PairingErrorCode::ClientDeviceRejected
    );

    let malformed = coordinator
        .submit_proposal(
            context(),
            ParticipantSetupProposal {
                profile_version: 0,
                request_id: "proposal-empty".to_string(),
                offer_id: offer.offer_id,
                participant_setup_token: setup_token,
                client_device_id: "device-1".to_string(),
                local_participant_profile_id: "profile-1".to_string(),
                preferred_display_name: "   ".to_string(),
                previous_host_participant_reference: None,
            },
        )
        .unwrap_err();
    assert_eq!(malformed.reason_code, PairingErrorCode::DisplayNameEmpty);
}

#[test]
fn accept_uses_participant_commit_and_returns_read_only_projection() {
    let coordinator = DevelopmentPairingCoordinator::default();
    let offer = create_offer(&coordinator);
    let setup_token = claim(&coordinator, &offer);
    submit_proposal(&coordinator, &offer, setup_token);
    let singers = SessionSingerRegistry::default();
    let channels = MicrophoneChannelRegistry::default();
    let assignments = MicrophoneAssignmentRegistry::default();
    let operations = MicrophoneRegistryOperations::default();

    let decision = coordinator
        .accept_proposal(
            PairingOperatorActionRequest {
                request_id: "accept-1".to_string(),
                offer_id: offer.offer_id,
            },
            &[source()],
            &ParticipantCommitCoordinator::default(),
            &singers,
            &channels,
            &assignments,
            &operations,
        )
        .unwrap();

    assert_eq!(singers.list().len(), 1);
    assert_eq!(singers.list()[0].display_name, "Kyle Test");
    assert_eq!(channels.list().len(), 1);
    assert_eq!(assignments.list().len(), 1);
    assert_eq!(
        decision.projection.status.lifecycle_state,
        Some(PairingOfferState::Accepted)
    );
    assert!(matches!(
        decision.outbound,
        Some(PairingOutboundMessage::ParticipantAccepted { .. })
    ));
}

#[test]
fn removing_an_accepted_participant_clears_linkage_and_notifies_once() {
    let coordinator = DevelopmentPairingCoordinator::default();
    let offer = create_offer(&coordinator);
    let setup_token = claim(&coordinator, &offer);
    submit_proposal(&coordinator, &offer, setup_token);
    let singers = SessionSingerRegistry::default();
    let channels = MicrophoneChannelRegistry::default();
    let assignments = MicrophoneAssignmentRegistry::default();
    let operations = MicrophoneRegistryOperations::default();
    coordinator
        .accept_proposal(
            PairingOperatorActionRequest {
                request_id: "accept-for-removal".to_string(),
                offer_id: offer.offer_id,
            },
            &[source()],
            &ParticipantCommitCoordinator::default(),
            &singers,
            &channels,
            &assignments,
            &operations,
        )
        .unwrap();
    let singer_id = singers.list()[0].id.clone();

    let (removed, revocation) = coordinator
        .remove_participant(&singer_id, || {
            singers.remove_transaction_created(&singer_id)
        })
        .unwrap();

    assert_eq!(removed.id, singer_id);
    assert!(coordinator
        .projection()
        .status
        .accepted_participant
        .is_none());
    assert_eq!(
        coordinator
            .projection()
            .status
            .last_revoked_participant
            .as_ref()
            .map(|participant| participant.session_singer_id.as_str()),
        Some(singer_id.as_str())
    );
    assert_eq!(coordinator.projection().diagnostics.revoked_participants, 1);
    assert!(matches!(
        revocation,
        Some(ParticipantRevocation {
            outbound: PairingOutboundMessage::ParticipantRevoked { .. },
            ..
        })
    ));

    let (_, duplicate) = coordinator
        .remove_participant(&singer_id, || Ok::<_, ()>(()))
        .unwrap();
    assert!(duplicate.is_none());
    assert_eq!(coordinator.projection().diagnostics.revoked_participants, 1);
}

#[test]
fn rejection_and_commit_failure_leave_authoritative_state_unchanged() {
    let coordinator = DevelopmentPairingCoordinator::default();
    let offer = create_offer(&coordinator);
    let setup_token = claim(&coordinator, &offer);
    submit_proposal(&coordinator, &offer, setup_token);

    coordinator
        .reject_proposal(PairingOperatorActionRequest {
            request_id: "reject-1".to_string(),
            offer_id: offer.offer_id,
        })
        .unwrap();
    assert_eq!(
        coordinator.projection().status.lifecycle_state,
        Some(PairingOfferState::Rejected)
    );

    let coordinator = DevelopmentPairingCoordinator::default();
    let offer = create_offer(&coordinator);
    let setup_token = claim(&coordinator, &offer);
    submit_proposal(&coordinator, &offer, setup_token);
    let singers = SessionSingerRegistry::default();
    let channels = MicrophoneChannelRegistry::default();
    let assignments = MicrophoneAssignmentRegistry::default();
    let decision = coordinator
        .accept_proposal(
            PairingOperatorActionRequest {
                request_id: "accept-fail".to_string(),
                offer_id: offer.offer_id,
            },
            &[],
            &ParticipantCommitCoordinator::default(),
            &singers,
            &channels,
            &assignments,
            &MicrophoneRegistryOperations::default(),
        )
        .unwrap();
    assert_eq!(
        decision.projection.status.lifecycle_state,
        Some(PairingOfferState::Rejected)
    );
    assert!(singers.list().is_empty());
    assert!(channels.list().is_empty());
    assert!(assignments.list().is_empty());
}

#[test]
fn accept_retry_is_idempotent_and_conflicting_request_id_is_rejected() {
    let coordinator = DevelopmentPairingCoordinator::default();
    let offer = create_offer(&coordinator);
    let setup_token = claim(&coordinator, &offer);
    submit_proposal(&coordinator, &offer, setup_token);
    let singers = SessionSingerRegistry::default();
    let channels = MicrophoneChannelRegistry::default();
    let assignments = MicrophoneAssignmentRegistry::default();
    let operations = MicrophoneRegistryOperations::default();
    let commits = ParticipantCommitCoordinator::default();
    let request = PairingOperatorActionRequest {
        request_id: "accept-1".to_string(),
        offer_id: offer.offer_id,
    };

    coordinator
        .accept_proposal(
            request.clone(),
            &[source()],
            &commits,
            &singers,
            &channels,
            &assignments,
            &operations,
        )
        .unwrap();
    let retried = coordinator
        .accept_proposal(
            request,
            &[source()],
            &commits,
            &singers,
            &channels,
            &assignments,
            &operations,
        )
        .unwrap();
    assert!(retried.outbound.is_none());
    assert_eq!(singers.list().len(), 1);
    assert_eq!(channels.list().len(), 1);
    assert_eq!(assignments.list().len(), 1);

    let conflict = coordinator
        .reject_proposal(PairingOperatorActionRequest {
            request_id: "accept-1".to_string(),
            offer_id: coordinator
                .projection()
                .status
                .active_offer_id
                .expect("accepted offer remains projected"),
        })
        .unwrap_err();
    assert_eq!(conflict.reason_code, PairingErrorCode::RequestIdConflict);
}

#[test]
fn retained_offer_registry_remains_bounded() {
    let coordinator = DevelopmentPairingCoordinator::default();
    for index in 0..40 {
        let offer = coordinator
            .create_offer(
                CreatePairingOfferRequest {
                    request_id: format!("host-offer-{index}"),
                },
                "192.168.1.78".to_string(),
                45_820,
            )
            .unwrap();
        coordinator
            .cancel_offer(PairingOperatorActionRequest {
                request_id: format!("cancel-offer-{index}"),
                offer_id: offer.offer_id,
            })
            .unwrap();
    }

    assert!(coordinator.projection().diagnostics.retained_offer_count <= 32);
}

#[test]
fn concurrent_claims_allow_one_winner() {
    let coordinator = Arc::new(DevelopmentPairingCoordinator::default());
    let offer = create_offer(&coordinator);
    let workers = (0..2)
        .map(|index| {
            let coordinator = Arc::clone(&coordinator);
            let offer = offer.clone();
            thread::spawn(move || {
                coordinator.claim(
                    context(),
                    PairingClaim {
                        profile_version: 0,
                        request_id: format!("claim-{index}"),
                        offer_id: offer.offer_id,
                        pairing_token: offer.pairing_token,
                        client_device_id: "device-1".to_string(),
                        client_name: "Test phone".to_string(),
                    },
                )
            })
        })
        .collect::<Vec<_>>();
    let results = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
}

#[test]
fn connection_loss_invalidates_pending_setup_without_creating_a_singer() {
    let coordinator = DevelopmentPairingCoordinator::default();
    let offer = create_offer(&coordinator);
    claim(&coordinator, &offer);
    coordinator.connection_lost("connection-1");

    assert_eq!(
        coordinator.projection().status.lifecycle_state,
        Some(PairingOfferState::Rejected)
    );
    assert!(
        !coordinator
            .projection()
            .status
            .participant_setup_token_issued
    );
}
