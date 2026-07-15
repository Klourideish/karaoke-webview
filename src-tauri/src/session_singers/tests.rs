use std::{collections::HashSet, sync::Arc, thread};

use crate::{
    development_pairing::{
        CreatePairingOfferRequest, DevelopmentPairingCoordinator, PairingClaim,
        PairingConnectionContext, PairingOperatorActionRequest, PairingOutboundMessage,
        ParticipantSetupProposal,
    },
    development_protocol::DevelopmentProtocolManager,
    microphones::{
        MicrophoneAssignmentRegistry, MicrophoneChannelRegistry, MicrophoneRegistryOperations,
    },
    participant_commit::ParticipantCommitCoordinator,
};

use super::{SessionSingerErrorCode, SessionSingerRegistry};

#[test]
fn registry_starts_without_placeholder_singers() {
    assert!(SessionSingerRegistry::default().list().is_empty());
}

#[test]
fn create_rename_and_remove_preserve_host_owned_identity() {
    let registry = SessionSingerRegistry::default();
    let singer = registry
        .create(Some("  Lead   Singer  ".to_string()))
        .unwrap();
    assert_eq!(singer.display_name, "Lead Singer");
    assert_eq!(singer.id, "singer-1");

    let renamed = registry.rename(&singer.id, "New Name").unwrap();
    assert_eq!(renamed.id, singer.id);
    assert_eq!(registry.remove(&singer.id, false).unwrap().id, singer.id);
    assert!(registry.list().is_empty());
}

#[test]
fn duplicate_display_names_are_allowed_but_ids_remain_distinct() {
    let registry = SessionSingerRegistry::default();
    let first = registry.create(Some("Alex".to_string())).unwrap();
    let second = registry.create(Some("Alex".to_string())).unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(first.display_name, second.display_name);
}

#[test]
fn display_name_validation_is_typed() {
    let registry = SessionSingerRegistry::default();
    assert_eq!(
        registry
            .create(Some("   ".to_string()))
            .unwrap_err()
            .reason_code,
        SessionSingerErrorCode::DisplayNameEmpty
    );
    assert_eq!(
        registry
            .create(Some("a".repeat(41)))
            .unwrap_err()
            .reason_code,
        SessionSingerErrorCode::DisplayNameTooLong
    );
    assert_eq!(
        registry
            .create(Some("Bad\nName".to_string()))
            .unwrap_err()
            .reason_code,
        SessionSingerErrorCode::DisplayNameControlCharacters
    );
}

#[test]
fn missing_and_in_use_singers_are_rejected() {
    let registry = SessionSingerRegistry::default();
    assert_eq!(
        registry.rename("missing", "Name").unwrap_err().reason_code,
        SessionSingerErrorCode::SingerNotFound
    );
    assert_eq!(
        registry.remove("missing", false).unwrap_err().reason_code,
        SessionSingerErrorCode::SingerNotFound
    );
    let singer = registry.create(Some("Alex".to_string())).unwrap();
    assert_eq!(
        registry.remove(&singer.id, true).unwrap_err().reason_code,
        SessionSingerErrorCode::SingerInUse
    );
}

#[test]
fn concurrent_creation_is_serialized_and_unique() {
    let registry = Arc::new(SessionSingerRegistry::default());
    let handles = (0..16)
        .map(|index| {
            let registry = Arc::clone(&registry);
            thread::spawn(move || registry.create(Some(format!("Singer {index}"))).unwrap().id)
        })
        .collect::<Vec<_>>();
    let ids = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<HashSet<_>>();
    assert_eq!(ids.len(), 16);
    assert_eq!(registry.list().len(), 16);
}

#[test]
fn host_removal_revokes_an_accepted_participant_and_active_stream() {
    let pairing = Arc::new(DevelopmentPairingCoordinator::default());
    let development = DevelopmentProtocolManager::with_pairing(Arc::clone(&pairing));
    development.handle_control_line_for_test(
        r#"{"type":"client_hello","profileVersion":0,"clientDeviceId":"dev-1","clientName":"Synthetic Android","audioProfile":{"sampleRateHz":48000,"channelCount":1,"encoding":"pcm_s16le","frameDurationMs":10,"samplesPerFrame":480}}"#,
    );
    let protocol = development.projection();
    let connection = PairingConnectionContext {
        connection_id: protocol.status.current_connection_id.unwrap(),
        client_device_id: "dev-1".to_string(),
        source_id: protocol.status.source_id.unwrap(),
    };
    let offer = pairing
        .create_offer(
            CreatePairingOfferRequest {
                request_id: "remove-offer".to_string(),
            },
            "192.168.1.78".to_string(),
            45_820,
        )
        .unwrap();
    let setup_token = match pairing
        .claim(
            connection.clone(),
            PairingClaim {
                profile_version: 0,
                request_id: "remove-claim".to_string(),
                offer_id: offer.offer_id.clone(),
                pairing_token: offer.pairing_token,
                client_device_id: "dev-1".to_string(),
                client_name: "Synthetic Android".to_string(),
            },
        )
        .unwrap()
    {
        PairingOutboundMessage::AcceptedForSetup {
            participant_setup_token,
            ..
        } => participant_setup_token,
        other => panic!("unexpected claim response: {other:?}"),
    };
    pairing
        .submit_proposal(
            connection,
            ParticipantSetupProposal {
                profile_version: 0,
                request_id: "remove-proposal".to_string(),
                offer_id: offer.offer_id.clone(),
                participant_setup_token: setup_token,
                client_device_id: "dev-1".to_string(),
                local_participant_profile_id: "profile-1".to_string(),
                preferred_display_name: "Kyle".to_string(),
                previous_host_participant_reference: None,
            },
        )
        .unwrap();
    let singers = SessionSingerRegistry::default();
    let channels = MicrophoneChannelRegistry::default();
    let assignments = MicrophoneAssignmentRegistry::default();
    let operations = MicrophoneRegistryOperations::default();
    pairing
        .accept_proposal(
            PairingOperatorActionRequest {
                request_id: "remove-accept".to_string(),
                offer_id: offer.offer_id,
            },
            &development.sources(),
            &ParticipantCommitCoordinator::default(),
            &singers,
            &channels,
            &assignments,
            &operations,
        )
        .unwrap();
    let singer_id = singers.list()[0].id.clone();
    let channel_id = assignments
        .assignment_for_singer(&singer_id)
        .unwrap()
        .channel_id;
    assignments.unassign(&channel_id).unwrap();
    development.handle_control_line_for_test(
        r#"{"type":"request_stream_authorization","profileVersion":0,"captureAttemptId":"attempt-1"}"#,
    );
    assert!(development.projection().status.stream_authorized);

    super::remove_session_singer_owned(
        &singer_id,
        &singers,
        &assignments,
        &operations,
        &pairing,
        &development,
    )
    .unwrap();

    assert!(!singers.contains(&singer_id));
    assert!(pairing.projection().status.accepted_participant.is_none());
    assert_eq!(pairing.projection().diagnostics.revoked_participants, 1);
    assert!(!development.projection().status.stream_authorized);
}
