use std::{sync::Arc, thread};

use crate::{
    microphones::{
        DiscoveredMicrophoneSource, MicrophoneAssignmentRegistry, MicrophoneChannelRegistry,
        MicrophoneRecoveryRegistry, MicrophoneRegistryOperations, MicrophoneSourceAvailability,
        MicrophoneSourceKind,
    },
    session_singers::SessionSingerRegistry,
};

use super::{
    models::{
        MicrophoneSelectionErrorCode, MicrophoneSelectionStatus, SelectSingerMicrophoneRequest,
    },
    MicrophoneSelectionCoordinator,
};

struct Fixture {
    coordinator: MicrophoneSelectionCoordinator,
    singers: SessionSingerRegistry,
    channels: MicrophoneChannelRegistry,
    assignments: MicrophoneAssignmentRegistry,
    recovery: MicrophoneRecoveryRegistry,
    operations: MicrophoneRegistryOperations,
    sources: Vec<DiscoveredMicrophoneSource>,
}

impl Fixture {
    fn new() -> Self {
        Self {
            coordinator: MicrophoneSelectionCoordinator::default(),
            singers: SessionSingerRegistry::default(),
            channels: MicrophoneChannelRegistry::default(),
            assignments: MicrophoneAssignmentRegistry::default(),
            recovery: MicrophoneRecoveryRegistry::default(),
            operations: MicrophoneRegistryOperations::default(),
            sources: vec![
                source("source-1", MicrophoneSourceKind::WindowsDevice),
                source("source-2", MicrophoneSourceKind::WindowsDevice),
            ],
        }
    }

    fn singer(&self, name: &str) -> String {
        self.singers.create(Some(name.to_string())).unwrap().id
    }

    fn select(
        &self,
        request_id: &str,
        singer_id: &str,
        source_id: Option<&str>,
    ) -> Result<super::MicrophoneSelectionProjection, super::MicrophoneSelectionError> {
        self.coordinator.select(
            request(request_id, singer_id, source_id),
            &self.sources,
            &self.singers,
            &self.channels,
            &self.assignments,
            &self.recovery,
            &self.operations,
        )
    }
}

fn source(id: &str, kind: MicrophoneSourceKind) -> DiscoveredMicrophoneSource {
    DiscoveredMicrophoneSource {
        id: id.to_string(),
        display_name: format!("Microphone {id}"),
        kind,
        availability: MicrophoneSourceAvailability::Available,
        is_default: false,
    }
}

fn request(
    request_id: &str,
    singer_id: &str,
    source_id: Option<&str>,
) -> SelectSingerMicrophoneRequest {
    SelectSingerMicrophoneRequest {
        request_id: request_id.to_string(),
        session_singer_id: singer_id.to_string(),
        desired_source_id: source_id.map(str::to_string),
    }
}

#[test]
fn assigns_an_unassigned_singer_with_one_host_transaction() {
    let fixture = Fixture::new();
    let singer_id = fixture.singer("Alex");

    let result = fixture
        .select("request-1", &singer_id, Some("source-1"))
        .unwrap();

    assert_eq!(result.status, MicrophoneSelectionStatus::Assigned);
    assert_eq!(fixture.channels.list().len(), 1);
    assert_eq!(fixture.assignments.list().len(), 1);
    assert_eq!(
        result.assignment,
        fixture.assignments.assignment_for_singer(&singer_id)
    );
}

#[test]
fn changing_source_preserves_channel_and_assignment_identity() {
    let fixture = Fixture::new();
    let singer_id = fixture.singer("Alex");
    let original = fixture
        .select("request-1", &singer_id, Some("source-1"))
        .unwrap();
    let original_channel = original.channel.unwrap();
    let original_assignment = original.assignment.unwrap();

    let changed = fixture
        .select("request-2", &singer_id, Some("source-2"))
        .unwrap();

    assert_eq!(changed.channel.as_ref().unwrap().id, original_channel.id);
    assert_eq!(changed.channel.as_ref().unwrap().source_id, "source-2");
    assert_eq!(changed.assignment, Some(original_assignment));
    assert_eq!(fixture.channels.list().len(), 1);
}

#[test]
fn clearing_assignment_preserves_the_channel() {
    let fixture = Fixture::new();
    let singer_id = fixture.singer("Alex");
    let assigned = fixture
        .select("request-1", &singer_id, Some("source-1"))
        .unwrap();
    let channel = assigned.channel.unwrap();

    let cleared = fixture.select("request-2", &singer_id, None).unwrap();

    assert_eq!(cleared.status, MicrophoneSelectionStatus::Cleared);
    assert!(cleared.assignment.is_none());
    assert_eq!(fixture.channels.list(), vec![channel]);
    assert!(fixture.assignments.list().is_empty());
}

#[test]
fn clearing_a_disconnected_assignment_preserves_channel_recovery_state() {
    let mut fixture = Fixture::new();
    let singer_id = fixture.singer("Alex");
    fixture
        .select("request-1", &singer_id, Some("source-1"))
        .unwrap();
    fixture.channels.reconcile(&[]);
    fixture.recovery.reconcile(&[], &fixture.channels.list());
    fixture.sources[0].availability = MicrophoneSourceAvailability::Unavailable;
    let disconnected_channel = fixture.channels.list().pop().unwrap();
    let recovery_state = fixture.recovery.list().pop().unwrap();

    fixture.select("request-2", &singer_id, None).unwrap();

    assert_eq!(fixture.channels.list(), vec![disconnected_channel]);
    assert_eq!(fixture.recovery.list(), vec![recovery_state]);
    assert!(fixture.assignments.list().is_empty());
}

#[test]
fn unavailable_and_claimed_sources_fail_before_mutation() {
    let mut fixture = Fixture::new();
    fixture.sources[0].availability = MicrophoneSourceAvailability::Unavailable;
    let singer_id = fixture.singer("Alex");
    let unavailable = fixture
        .select("request-1", &singer_id, Some("source-1"))
        .unwrap_err();
    assert_eq!(
        unavailable.reason_code,
        MicrophoneSelectionErrorCode::SourceUnavailable
    );
    assert!(fixture.channels.list().is_empty());
    assert!(fixture.assignments.list().is_empty());

    fixture.sources[0].availability = MicrophoneSourceAvailability::Available;
    let other_singer = fixture.singer("Taylor");
    fixture
        .select("request-2", &other_singer, Some("source-1"))
        .unwrap();
    let claimed = fixture
        .select("request-3", &singer_id, Some("source-1"))
        .unwrap_err();
    assert_eq!(
        claimed.reason_code,
        MicrophoneSelectionErrorCode::SourceAlreadyClaimed
    );
    assert!(fixture
        .assignments
        .assignment_for_singer(&singer_id)
        .is_none());
}

#[test]
fn channel_and_assignment_failures_roll_back_transaction_state() {
    for failpoint in ["before-channel", "after-channel", "after-assignment"] {
        let fixture = Fixture::new();
        let singer_id = fixture.singer("Alex");
        let result = fixture.coordinator.select_with_test_failpoint(
            request(
                &format!("request-{failpoint}"),
                &singer_id,
                Some("source-1"),
            ),
            &fixture.sources,
            &fixture.singers,
            &fixture.channels,
            &fixture.assignments,
            &fixture.recovery,
            &fixture.operations,
            failpoint,
        );

        assert_eq!(
            result.unwrap_err().reason_code,
            MicrophoneSelectionErrorCode::InternalError
        );
        assert!(fixture.channels.list().is_empty());
        assert!(fixture.assignments.list().is_empty());
    }
}

#[test]
fn rollback_restores_pre_existing_channels_exactly() {
    let fixture = Fixture::new();
    let singer_id = fixture.singer("Alex");
    let assigned = fixture
        .select("request-1", &singer_id, Some("source-1"))
        .unwrap();
    let original_channel = assigned.channel.unwrap();
    let original_assignment = assigned.assignment.unwrap();

    let result = fixture.coordinator.select_with_test_failpoint(
        request("request-2", &singer_id, Some("source-2")),
        &fixture.sources,
        &fixture.singers,
        &fixture.channels,
        &fixture.assignments,
        &fixture.recovery,
        &fixture.operations,
        "after-channel",
    );

    assert_eq!(
        result.unwrap_err().reason_code,
        MicrophoneSelectionErrorCode::InternalError
    );
    assert_eq!(fixture.channels.list(), vec![original_channel]);
    assert_eq!(fixture.assignments.list(), vec![original_assignment]);
}

#[test]
fn retries_are_idempotent_and_conflicting_request_ids_are_rejected() {
    let fixture = Fixture::new();
    let singer_id = fixture.singer("Alex");
    let first = fixture
        .select("request-1", &singer_id, Some("source-1"))
        .unwrap();
    let retried = fixture
        .select("request-1", &singer_id, Some("source-1"))
        .unwrap();

    assert_eq!(first, retried);
    assert_eq!(fixture.channels.list().len(), 1);
    assert_eq!(fixture.assignments.list().len(), 1);
    let conflict = fixture
        .select("request-1", &singer_id, Some("source-2"))
        .unwrap_err();
    assert_eq!(
        conflict.reason_code,
        MicrophoneSelectionErrorCode::RequestIdConflict
    );
}

#[test]
fn concurrent_selection_operations_serialize_without_stealing() {
    let coordinator = Arc::new(MicrophoneSelectionCoordinator::default());
    let singers = Arc::new(SessionSingerRegistry::default());
    let channels = Arc::new(MicrophoneChannelRegistry::default());
    let assignments = Arc::new(MicrophoneAssignmentRegistry::default());
    let recovery = Arc::new(MicrophoneRecoveryRegistry::default());
    let operations = Arc::new(MicrophoneRegistryOperations::default());
    let sources = Arc::new(vec![source(
        "source-1",
        MicrophoneSourceKind::WindowsDevice,
    )]);
    let singer_ids = [
        singers.create(Some("Alex".to_string())).unwrap().id,
        singers.create(Some("Taylor".to_string())).unwrap().id,
    ];
    let workers = singer_ids
        .into_iter()
        .enumerate()
        .map(|(index, singer_id)| {
            let coordinator = Arc::clone(&coordinator);
            let singers = Arc::clone(&singers);
            let channels = Arc::clone(&channels);
            let assignments = Arc::clone(&assignments);
            let recovery = Arc::clone(&recovery);
            let operations = Arc::clone(&operations);
            let sources = Arc::clone(&sources);
            thread::spawn(move || {
                coordinator.select(
                    request(&format!("request-{index}"), &singer_id, Some("source-1")),
                    &sources,
                    &singers,
                    &channels,
                    &assignments,
                    &recovery,
                    &operations,
                )
            })
        });
    let results = workers
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();

    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
    assert_eq!(channels.list().len(), 1);
    assert_eq!(assignments.list().len(), 1);
}

#[test]
fn network_source_is_supported_without_stream_authorization_side_effects() {
    let mut fixture = Fixture::new();
    fixture.sources = vec![source(
        "network-source-1",
        MicrophoneSourceKind::NetworkClient,
    )];
    let singer_id = fixture.singer("Alex");

    let result = fixture
        .select("request-1", &singer_id, Some("network-source-1"))
        .unwrap();

    assert_eq!(result.status, MicrophoneSelectionStatus::Assigned);
    assert_eq!(result.channel.unwrap().source_id, "network-source-1");
    // The coordinator has no protocol manager dependency and cannot authorize a stream.
}
