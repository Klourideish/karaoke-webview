use super::{
    models::{
        AssignMicrophoneToSingerRequest, CreateSingerWithMicrophoneRequest,
        ParticipantCommitDiagnosticOutcome, ParticipantCommitErrorCode,
    },
    ParticipantCommitCoordinator,
};
use crate::{
    microphones::{
        DiscoveredMicrophoneSource, MicrophoneAssignmentRegistry, MicrophoneChannelRegistry,
        MicrophoneRegistryOperations, MicrophoneSourceAvailability, MicrophoneSourceKind,
    },
    session_singers::SessionSingerRegistry,
};

struct Fixture {
    coordinator: ParticipantCommitCoordinator,
    singers: SessionSingerRegistry,
    channels: MicrophoneChannelRegistry,
    assignments: MicrophoneAssignmentRegistry,
    operations: MicrophoneRegistryOperations,
    sources: Vec<DiscoveredMicrophoneSource>,
}

impl Fixture {
    fn new(kind: MicrophoneSourceKind) -> Self {
        Self {
            coordinator: ParticipantCommitCoordinator::default(),
            singers: SessionSingerRegistry::default(),
            channels: MicrophoneChannelRegistry::default(),
            assignments: MicrophoneAssignmentRegistry::default(),
            operations: MicrophoneRegistryOperations::default(),
            sources: vec![source(
                "source-1",
                kind,
                MicrophoneSourceAvailability::Available,
            )],
        }
    }

    fn create(
        &self,
        request_id: &str,
    ) -> Result<super::ParticipantCommitProjection, super::ParticipantCommitError> {
        self.coordinator.create_singer_with_microphone(
            CreateSingerWithMicrophoneRequest {
                request_id: request_id.to_string(),
                display_name: "  Lead   Singer  ".to_string(),
                source_id: "source-1".to_string(),
            },
            &self.sources,
            &self.singers,
            &self.channels,
            &self.assignments,
            &self.operations,
        )
    }
}

fn source(
    id: &str,
    kind: MicrophoneSourceKind,
    availability: MicrophoneSourceAvailability,
) -> DiscoveredMicrophoneSource {
    DiscoveredMicrophoneSource {
        id: id.to_string(),
        display_name: format!("Microphone {id}"),
        kind,
        availability,
        is_default: false,
    }
}

#[test]
fn new_singer_commit_supports_local_and_network_sources() {
    for kind in [
        MicrophoneSourceKind::WindowsDevice,
        MicrophoneSourceKind::NetworkClient,
    ] {
        let fixture = Fixture::new(kind);
        let result = fixture.create("request-1").unwrap();
        assert_eq!(result.session_singer.display_name, "Lead Singer");
        assert!(result.assignment_succeeded);
        let channel = fixture.channels.list().pop().unwrap();
        assert_ne!(channel.id, channel.source_id);
        assert_eq!(fixture.assignments.list().len(), 1);
    }
}

#[test]
fn existing_singer_can_receive_an_available_source() {
    let fixture = Fixture::new(MicrophoneSourceKind::WindowsDevice);
    let singer = fixture.singers.create(Some("Alex".to_string())).unwrap();
    let result = fixture
        .coordinator
        .assign_microphone_to_existing_singer(
            AssignMicrophoneToSingerRequest {
                request_id: "request-1".to_string(),
                singer_id: singer.id.clone(),
                source_id: "source-1".to_string(),
            },
            &fixture.sources,
            &fixture.singers,
            &fixture.channels,
            &fixture.assignments,
            &fixture.operations,
        )
        .unwrap();
    assert_eq!(result.session_singer.id, singer.id);
    assert_eq!(fixture.channels.list().len(), 1);
    assert_eq!(fixture.assignments.list().len(), 1);
}

#[test]
fn unavailable_and_claimed_sources_fail_before_mutation() {
    let mut fixture = Fixture::new(MicrophoneSourceKind::WindowsDevice);
    fixture.sources[0].availability = MicrophoneSourceAvailability::Unavailable;
    assert_eq!(
        fixture.create("request-1").unwrap_err().reason_code,
        ParticipantCommitErrorCode::SourceUnavailable
    );
    assert!(fixture.singers.list().is_empty());
    assert!(fixture.channels.list().is_empty());

    fixture.sources[0].availability = MicrophoneSourceAvailability::Available;
    let existing = fixture
        .singers
        .create(Some("Existing".to_string()))
        .unwrap();
    let channel = fixture
        .channels
        .create("source-1", &fixture.sources)
        .unwrap();
    fixture
        .assignments
        .assign(&channel.id, &existing.id)
        .unwrap();
    assert_eq!(
        fixture.create("request-2").unwrap_err().reason_code,
        ParticipantCommitErrorCode::AssignmentConflict
    );
    assert_eq!(fixture.singers.list().len(), 1);
}

#[test]
fn failures_roll_back_new_singer_channel_and_assignment() {
    for failpoint in ["after-singer", "after-channel", "after-assignment"] {
        let fixture = Fixture::new(MicrophoneSourceKind::WindowsDevice);
        let result = fixture.coordinator.create_with_test_failpoint(
            CreateSingerWithMicrophoneRequest {
                request_id: format!("request-{failpoint}"),
                display_name: "Alex".to_string(),
                source_id: "source-1".to_string(),
            },
            &fixture.sources,
            &fixture.singers,
            &fixture.channels,
            &fixture.assignments,
            &fixture.operations,
            failpoint,
        );
        assert_eq!(
            result.unwrap_err().reason_code,
            ParticipantCommitErrorCode::InternalError
        );
        assert!(fixture.singers.list().is_empty());
        assert!(fixture.channels.list().is_empty());
        assert!(fixture.assignments.list().is_empty());
        assert!(fixture
            .assignments
            .preferred_source_for_singer("singer-1")
            .is_none());
    }
}

#[test]
fn rollback_preserves_pre_existing_unassigned_channel() {
    let fixture = Fixture::new(MicrophoneSourceKind::WindowsDevice);
    let existing_channel = fixture
        .channels
        .create("source-1", &fixture.sources)
        .unwrap();
    let result = fixture.coordinator.create_with_test_failpoint(
        CreateSingerWithMicrophoneRequest {
            request_id: "request-1".to_string(),
            display_name: "Alex".to_string(),
            source_id: "source-1".to_string(),
        },
        &fixture.sources,
        &fixture.singers,
        &fixture.channels,
        &fixture.assignments,
        &fixture.operations,
        "after-assignment",
    );
    assert!(result.is_err());
    assert_eq!(fixture.channels.list(), vec![existing_channel]);
    assert!(fixture.assignments.list().is_empty());
}

#[test]
fn retries_are_idempotent_and_conflicting_request_ids_are_rejected() {
    let fixture = Fixture::new(MicrophoneSourceKind::WindowsDevice);
    let first = fixture.create("request-1").unwrap();
    let repeated = fixture.create("request-1").unwrap();
    assert_eq!(first, repeated);
    assert_eq!(fixture.singers.list().len(), 1);
    assert_eq!(fixture.channels.list().len(), 1);
    assert_eq!(fixture.assignments.list().len(), 1);

    let conflict = fixture.coordinator.create_singer_with_microphone(
        CreateSingerWithMicrophoneRequest {
            request_id: "request-1".to_string(),
            display_name: "Different".to_string(),
            source_id: "source-1".to_string(),
        },
        &fixture.sources,
        &fixture.singers,
        &fixture.channels,
        &fixture.assignments,
        &fixture.operations,
    );
    assert_eq!(
        conflict.unwrap_err().reason_code,
        ParticipantCommitErrorCode::RequestIdConflict
    );
}

#[test]
fn source_disconnect_preserves_committed_identity_relationships() {
    let fixture = Fixture::new(MicrophoneSourceKind::NetworkClient);
    let result = fixture.create("request-1").unwrap();
    fixture.channels.reconcile(&[]);
    let channel = fixture.channels.list().pop().unwrap();
    assert_eq!(
        channel.state,
        crate::microphones::MicrophoneChannelState::Disconnected
    );
    assert_eq!(
        fixture
            .assignments
            .assignment_for_singer(&result.session_singer.id)
            .unwrap()
            .channel_id,
        channel.id
    );
    assert!(fixture.singers.contains(&result.session_singer.id));
}

#[test]
fn diagnostics_project_success_and_safe_failure_outcomes() {
    let fixture = Fixture::new(MicrophoneSourceKind::WindowsDevice);
    let result = fixture.create("request-success").unwrap();
    let success = fixture.coordinator.diagnostics();
    assert_eq!(success.outcome, ParticipantCommitDiagnosticOutcome::Success);
    assert_eq!(success.request_id.as_deref(), Some("request-success"));
    assert_eq!(
        success.singer_name,
        Some(result.session_singer.display_name)
    );
    assert_eq!(
        success.source_display_name.as_deref(),
        Some("Microphone source-1")
    );
    assert!(!success.rollback_occurred);
    assert!(success.failure_reason.is_none());

    let failed_fixture = Fixture::new(MicrophoneSourceKind::WindowsDevice);
    let failure = failed_fixture.coordinator.create_with_test_failpoint(
        CreateSingerWithMicrophoneRequest {
            request_id: "request-failure".to_string(),
            display_name: "Alex".to_string(),
            source_id: "source-1".to_string(),
        },
        &failed_fixture.sources,
        &failed_fixture.singers,
        &failed_fixture.channels,
        &failed_fixture.assignments,
        &failed_fixture.operations,
        "after-channel",
    );
    assert!(failure.is_err());
    let diagnostic = failed_fixture.coordinator.diagnostics();
    assert_eq!(
        diagnostic.outcome,
        ParticipantCommitDiagnosticOutcome::Failure
    );
    assert_eq!(
        diagnostic.failure_reason,
        Some(ParticipantCommitErrorCode::InternalError)
    );
    assert!(diagnostic.rollback_occurred);
    assert!(diagnostic.microphone_state.is_none());
}
