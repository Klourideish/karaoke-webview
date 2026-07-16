use std::time::{Duration, Instant};

use crate::microphones::{
    KaraokeMode, PerformanceMicrophoneReadiness, PerformanceMicrophoneReadinessStatus,
};

use super::{
    coordinator::{HostPerformanceCoordinator, COUNTDOWN_DURATION, RESULTS_DURATION},
    models::{
        CreatePerformanceRequest, PerformanceErrorCode, PerformanceLifecycleState,
        PerformanceMutationRequest, PerformanceSingerProjection, PerformanceSongProjection,
        PerformanceTerminalReason,
    },
};
use crate::playback::{
    HostPlaybackCoordinator, PlaybackErrorCode, PlaybackMutationRequest, PlaybackSongProjection,
    RequestSongPlayback,
};

fn readiness(status: PerformanceMicrophoneReadinessStatus) -> PerformanceMicrophoneReadiness {
    PerformanceMicrophoneReadiness {
        status,
        mode: KaraokeMode::Standard,
        participants: Vec::new(),
        locked_participants: Vec::new(),
        message: "test readiness".to_string(),
    }
}

#[test]
fn created_performance_enters_preparing_with_host_owned_identity() {
    let coordinator = HostPerformanceCoordinator::default();
    let projection = coordinator
        .create_validated(
            CreatePerformanceRequest {
                request_id: "request-1".to_string(),
                singer_id: "singer-1".to_string(),
                song_id: "song-1".to_string(),
            },
            PerformanceSingerProjection {
                id: "singer-1".to_string(),
                display_name: "Kyle".to_string(),
            },
            PerformanceSongProjection {
                id: "song-1".to_string(),
                title: "Taste".to_string(),
                artist: "Sabrina Carpenter".to_string(),
            },
            readiness(PerformanceMicrophoneReadinessStatus::Blocked),
        )
        .expect("Performance should be created");

    let active = projection.active.expect("active Performance");
    assert_eq!(active.id, "performance-1");
    assert_eq!(active.state, PerformanceLifecycleState::Preparing);
    assert!(coordinator.countdown_action(Instant::now()).is_none());
}

#[test]
fn playback_and_performance_admission_cannot_diverge() {
    let performance = HostPerformanceCoordinator::default();
    let playback = HostPlaybackCoordinator::default();
    playback
        .request_start(
            RequestSongPlayback {
                request_id: "manual-playback".to_string(),
                song_id: "song-0".to_string(),
            },
            || {
                Ok(PlaybackSongProjection {
                    id: "song-0".to_string(),
                    title: "Existing song".to_string(),
                    artist: "Artist".to_string(),
                    audio_path: "C:\\Music\\Existing.opus".to_string(),
                })
            },
        )
        .unwrap();

    let blocked = performance
        .create_validated_with_playback(
            CreatePerformanceRequest {
                request_id: "performance".to_string(),
                singer_id: "singer-1".to_string(),
                song_id: "song-1".to_string(),
            },
            PerformanceSingerProjection {
                id: "singer-1".to_string(),
                display_name: "Kyle".to_string(),
            },
            PerformanceSongProjection {
                id: "song-1".to_string(),
                title: "Queued song".to_string(),
                artist: "Artist".to_string(),
            },
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
            &playback,
        )
        .unwrap_err();
    assert_eq!(blocked.reason_code, PerformanceErrorCode::PerformanceActive);
    assert!(performance.projection().active.is_none());

    playback
        .report_failed(
            playback.projection().attempt_id.as_deref().unwrap(),
            PlaybackErrorCode::MediaFailed,
            "test failure".to_string(),
        )
        .unwrap();
    create(&performance, "active-performance");
    let invoked = std::cell::Cell::new(false);
    let blocked = performance
        .admit_direct_playback(|| {
            invoked.set(true);
            Ok(())
        })
        .unwrap_err();
    assert_eq!(
        blocked.reason_code,
        PlaybackErrorCode::PlaybackAlreadyActive
    );
    assert!(!invoked.get());
}

fn create(coordinator: &HostPerformanceCoordinator, request_id: &str) -> String {
    coordinator
        .create_validated(
            CreatePerformanceRequest {
                request_id: request_id.to_string(),
                singer_id: "singer-1".to_string(),
                song_id: "song-1".to_string(),
            },
            PerformanceSingerProjection {
                id: "singer-1".to_string(),
                display_name: "Kyle".to_string(),
            },
            PerformanceSongProjection {
                id: "song-1".to_string(),
                title: "Taste".to_string(),
                artist: "Sabrina Carpenter".to_string(),
            },
            readiness(PerformanceMicrophoneReadinessStatus::Blocked),
        )
        .expect("Performance should be created")
        .active
        .expect("active Performance")
        .id
}

fn start_playback() -> (HostPlaybackCoordinator, crate::playback::PlaybackProjection) {
    let playback = HostPlaybackCoordinator::default();
    let projection = playback
        .request_start(
            RequestSongPlayback {
                request_id: "playback-request".to_string(),
                song_id: "song-1".to_string(),
            },
            || {
                Ok(PlaybackSongProjection {
                    id: "song-1".to_string(),
                    title: "Taste".to_string(),
                    artist: "Sabrina Carpenter".to_string(),
                    audio_path: "C:/library/song.opus".to_string(),
                })
            },
        )
        .expect("playback should start");
    (playback, projection)
}

#[test]
fn ready_performance_owns_three_second_countdown() {
    let coordinator = HostPerformanceCoordinator::default();
    let id = create(&coordinator, "request-ready");
    let now = Instant::now();
    let projection = coordinator
        .apply_readiness(
            &id,
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
            now,
        )
        .expect("readiness should apply");

    let active = projection.active.expect("active Performance");
    assert_eq!(active.state, PerformanceLifecycleState::Countdown);
    assert!(active
        .countdown_remaining_ms
        .is_some_and(|value| value <= 3_000));
    assert!(coordinator
        .countdown_action(now + COUNTDOWN_DURATION - Duration::from_millis(1))
        .is_none());
    assert_eq!(
        coordinator.countdown_action(now + COUNTDOWN_DURATION),
        Some((id.clone(), "song-1".to_string(), format!("{id}:playback:1"),))
    );
}

#[test]
fn playback_startup_remains_countdown_until_matching_acknowledgement() {
    let coordinator = HostPerformanceCoordinator::default();
    let id = create(&coordinator, "request-startup");
    let now = Instant::now();
    coordinator
        .apply_readiness(
            &id,
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
            now,
        )
        .expect("readiness should apply");
    let (playback, starting) = start_playback();
    let linked = coordinator
        .link_playback(&id, &starting)
        .expect("playback should link");
    assert_eq!(
        linked.active.as_ref().expect("active").state,
        PerformanceLifecycleState::Countdown
    );
    assert!(linked.active.expect("active").playback.startup_pending);

    let started = playback
        .report_started(starting.attempt_id.as_deref().expect("attempt"))
        .expect("adapter acknowledgement should succeed");
    let projection = coordinator
        .observe_playback(&started, now)
        .expect("Performance should observe playback");
    assert_eq!(
        projection.active.expect("active").state,
        PerformanceLifecycleState::Playing
    );
}

#[test]
fn completion_passes_through_results_deadline_before_completed() {
    let coordinator = HostPerformanceCoordinator::default();
    let id = create(&coordinator, "request-complete");
    let now = Instant::now();
    coordinator
        .apply_readiness(
            &id,
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
            now,
        )
        .expect("readiness should apply");
    let (playback, starting) = start_playback();
    coordinator.link_playback(&id, &starting).expect("link");
    let attempt = starting.attempt_id.as_deref().expect("attempt");
    let started = playback.report_started(attempt).expect("started");
    coordinator
        .observe_playback(&started, now)
        .expect("playing");
    let completed = playback.report_completed(attempt).expect("completed");
    let finalizing = coordinator
        .observe_playback(&completed, now)
        .expect("finalizing projection");
    assert_eq!(
        finalizing.active.expect("active").state,
        PerformanceLifecycleState::Finalizing
    );
    let results = coordinator
        .advance_finalizing(now)
        .expect("results projection");
    assert_eq!(
        results.active.as_ref().expect("active").state,
        PerformanceLifecycleState::Results
    );
    assert!(coordinator
        .complete_results_if_due(now + RESULTS_DURATION - Duration::from_millis(1))
        .is_none());
    assert_eq!(
        coordinator
            .complete_results_if_due(now + RESULTS_DURATION)
            .expect("completed projection")
            .active
            .expect("active")
            .state,
        PerformanceLifecycleState::Completed
    );
}

#[test]
fn cancel_and_skip_map_to_stopped_terminal_reasons() {
    let cancelled = HostPerformanceCoordinator::default();
    let cancelled_id = create(&cancelled, "request-cancel");
    let projection = cancelled
        .cancel(PerformanceMutationRequest {
            request_id: "cancel-1".to_string(),
            performance_id: cancelled_id,
        })
        .expect("preparation should cancel");
    let active = projection.active.expect("active");
    assert_eq!(active.state, PerformanceLifecycleState::Stopped);
    assert_eq!(
        active.terminal_reason,
        Some(PerformanceTerminalReason::CancelledBeforePlayback)
    );

    let skipped = HostPerformanceCoordinator::default();
    let skipped_id = create(&skipped, "request-skip");
    skipped
        .apply_readiness(
            &skipped_id,
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
            Instant::now(),
        )
        .expect("countdown");
    let projection = skipped
        .skip(PerformanceMutationRequest {
            request_id: "skip-1".to_string(),
            performance_id: skipped_id,
        })
        .expect("countdown should skip");
    let active = projection.active.expect("active");
    assert_eq!(active.state, PerformanceLifecycleState::Stopped);
    assert_eq!(
        active.terminal_reason,
        Some(PerformanceTerminalReason::SkippedByOperator)
    );
}

#[test]
fn playback_failure_is_terminal_and_retry_requires_new_performance() {
    let coordinator = HostPerformanceCoordinator::default();
    let id = create(&coordinator, "request-failure");
    let now = Instant::now();
    coordinator
        .apply_readiness(
            &id,
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
            now,
        )
        .expect("countdown");
    let (playback, starting) = start_playback();
    coordinator.link_playback(&id, &starting).expect("link");
    let failed = playback
        .report_failed(
            starting.attempt_id.as_deref().expect("attempt"),
            PlaybackErrorCode::MediaFailed,
            "Media failed".to_string(),
        )
        .expect("failure report");
    let projection = coordinator
        .observe_playback(&failed, now)
        .expect("failure projection");
    assert_eq!(
        projection.active.expect("active").state,
        PerformanceLifecycleState::Failed
    );

    let next_id = create(&coordinator, "request-retry");
    assert_ne!(id, next_id);
}

#[test]
fn readiness_loss_during_startup_returns_to_preparing() {
    let coordinator = HostPerformanceCoordinator::default();
    let id = create(&coordinator, "request-readiness-loss");
    let now = Instant::now();
    coordinator
        .apply_readiness(
            &id,
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
            now,
        )
        .expect("countdown");
    coordinator
        .countdown_action(now + COUNTDOWN_DURATION)
        .expect("first playback request");
    let (_playback, starting) = start_playback();
    coordinator.link_playback(&id, &starting).expect("link");
    let projection = coordinator
        .apply_readiness(
            &id,
            readiness(PerformanceMicrophoneReadinessStatus::Blocked),
            now,
        )
        .expect("blocked readiness");
    let active = projection.active.expect("active");
    assert_eq!(active.state, PerformanceLifecycleState::Preparing);
    assert!(active.playback.attempt_id.is_none());

    coordinator
        .apply_readiness(
            &id,
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
            now,
        )
        .expect("readiness should recover");
    assert_eq!(
        coordinator.countdown_action(now + COUNTDOWN_DURATION),
        Some((id.clone(), "song-1".to_string(), format!("{id}:playback:2"),))
    );
}

#[test]
fn create_requests_are_idempotent_and_conflicts_are_typed() {
    let coordinator = HostPerformanceCoordinator::default();
    let first = create(&coordinator, "same-request");
    let second = create(&coordinator, "same-request");
    assert_eq!(first, second);
    coordinator
        .cancel(PerformanceMutationRequest {
            request_id: "cancel-idempotent-create".to_string(),
            performance_id: first.clone(),
        })
        .expect("preparation should cancel");
    let retried = coordinator
        .create_validated(
            CreatePerformanceRequest {
                request_id: "same-request".to_string(),
                singer_id: "singer-1".to_string(),
                song_id: "song-1".to_string(),
            },
            PerformanceSingerProjection {
                id: "singer-1".to_string(),
                display_name: "Kyle".to_string(),
            },
            PerformanceSongProjection {
                id: "song-1".to_string(),
                title: "Taste".to_string(),
                artist: "Sabrina Carpenter".to_string(),
            },
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
        )
        .expect("identical retry should return current authority");
    assert_eq!(
        retried.active.expect("active").state,
        PerformanceLifecycleState::Stopped
    );

    let conflict = coordinator
        .create_validated(
            CreatePerformanceRequest {
                request_id: "same-request".to_string(),
                singer_id: "singer-2".to_string(),
                song_id: "song-1".to_string(),
            },
            PerformanceSingerProjection {
                id: "singer-2".to_string(),
                display_name: "Mum".to_string(),
            },
            PerformanceSongProjection {
                id: "song-1".to_string(),
                title: "Taste".to_string(),
                artist: "Sabrina Carpenter".to_string(),
            },
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
        )
        .expect_err("request ID reuse should conflict");
    assert_eq!(
        conflict.reason_code,
        PerformanceErrorCode::RequestIdConflict
    );
}

#[test]
fn stale_and_duplicate_playback_reports_do_not_change_lifecycle() {
    let coordinator = HostPerformanceCoordinator::default();
    let id = create(&coordinator, "request-stale");
    let now = Instant::now();
    coordinator
        .apply_readiness(
            &id,
            readiness(PerformanceMicrophoneReadinessStatus::Ready),
            now,
        )
        .expect("countdown");
    let (playback, first) = start_playback();
    coordinator.link_playback(&id, &first).expect("link");
    let first_attempt = first.attempt_id.as_deref().expect("first attempt");
    let started = playback.report_started(first_attempt).expect("started");
    coordinator
        .observe_playback(&started, now)
        .expect("playing projection");
    let duplicate = playback
        .report_started(first_attempt)
        .expect("duplicate report");
    let projection = coordinator
        .observe_playback(&duplicate, now)
        .expect("duplicate observation");
    assert_eq!(
        projection.active.expect("active").state,
        PerformanceLifecycleState::Playing
    );

    playback
        .request_stop(PlaybackMutationRequest {
            request_id: "stop-first".to_string(),
        })
        .expect("stop first");
    let second = playback
        .request_start(
            RequestSongPlayback {
                request_id: "start-second".to_string(),
                song_id: "song-2".to_string(),
            },
            || {
                Ok(PlaybackSongProjection {
                    id: "song-2".to_string(),
                    title: "Second".to_string(),
                    artist: "Artist".to_string(),
                    audio_path: "C:/library/second.opus".to_string(),
                })
            },
        )
        .expect("second playback");
    let stale = coordinator
        .observe_playback(&second, now)
        .expect("stale observation diagnostics");
    assert_eq!(
        stale.active.expect("active").state,
        PerformanceLifecycleState::Playing
    );
    assert_eq!(stale.diagnostics.stale_playback_event_count, 1);
}

#[test]
fn projection_is_immutable_and_shutdown_is_idempotent() {
    let coordinator = HostPerformanceCoordinator::default();
    create(&coordinator, "request-projection");
    let mut snapshot = coordinator.projection();
    snapshot.active.as_mut().expect("snapshot").state = PerformanceLifecycleState::Failed;
    assert_eq!(
        coordinator
            .projection()
            .active
            .expect("authoritative")
            .state,
        PerformanceLifecycleState::Preparing
    );
    coordinator.shutdown();
    coordinator.shutdown();
}

#[test]
fn active_performer_blocks_removal_until_performance_is_terminal() {
    let coordinator = HostPerformanceCoordinator::default();
    let id = create(&coordinator, "request-singer-relationship");
    assert!(coordinator.has_active_singer("singer-1"));
    coordinator
        .cancel(PerformanceMutationRequest {
            request_id: "cancel-singer-relationship".to_string(),
            performance_id: id,
        })
        .expect("preparation should cancel");
    assert!(!coordinator.has_active_singer("singer-1"));
}
