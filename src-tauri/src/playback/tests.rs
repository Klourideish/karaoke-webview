use super::{
    models::{
        PlaybackError, PlaybackErrorCode, PlaybackMutationRequest, PlaybackSongProjection,
        PlaybackState, RequestSongPlayback,
    },
    HostPlaybackCoordinator,
};

fn song(id: &str) -> PlaybackSongProjection {
    PlaybackSongProjection {
        id: id.to_string(),
        title: "Song".to_string(),
        artist: "Artist".to_string(),
        audio_path: "C:\\Music\\Artist - Song.opus".to_string(),
    }
}

fn start(
    coordinator: &HostPlaybackCoordinator,
    request_id: &str,
    song_id: &str,
) -> Result<super::models::PlaybackProjection, PlaybackError> {
    coordinator.request_start(
        RequestSongPlayback {
            request_id: request_id.to_string(),
            song_id: song_id.to_string(),
        },
        || Ok(song(song_id)),
    )
}

#[test]
fn start_requires_adapter_acknowledgement_and_completes_once() {
    let coordinator = HostPlaybackCoordinator::default();
    let requested = start(&coordinator, "request-1", "song-1").unwrap();
    let attempt = requested.attempt_id.clone().unwrap();
    assert_eq!(requested.state, PlaybackState::Starting);

    let playing = coordinator.report_started(&attempt).unwrap();
    assert_eq!(playing.state, PlaybackState::Playing);
    assert_eq!(coordinator.report_started(&attempt).unwrap(), playing);

    let completed = coordinator.report_completed(&attempt).unwrap();
    assert_eq!(completed.state, PlaybackState::Completed);
    assert_eq!(coordinator.report_completed(&attempt).unwrap(), completed);
}

#[test]
fn failure_and_stale_reports_are_safe() {
    let coordinator = HostPlaybackCoordinator::default();
    let requested = start(&coordinator, "request-1", "song-1").unwrap();
    let attempt = requested.attempt_id.clone().unwrap();

    let stale = coordinator.report_started("older-attempt").unwrap_err();
    assert_eq!(stale.reason_code, PlaybackErrorCode::StaleAttempt);
    assert_eq!(coordinator.projection().state, PlaybackState::Starting);
    assert_eq!(coordinator.projection().diagnostics.stale_event_count, 1);

    let failed = coordinator
        .report_failed(
            &attempt,
            PlaybackErrorCode::AdapterStartFailed,
            "The webview blocked playback.".to_string(),
        )
        .unwrap();
    assert_eq!(failed.state, PlaybackState::Failed);
    assert_eq!(
        failed.failure_reason,
        Some(PlaybackErrorCode::AdapterStartFailed)
    );
}

#[test]
fn completed_prior_attempt_cannot_change_a_newer_start() {
    let coordinator = HostPlaybackCoordinator::default();
    let first_attempt = start(&coordinator, "first-start", "song-1")
        .unwrap()
        .attempt_id
        .unwrap();
    coordinator.report_started(&first_attempt).unwrap();
    coordinator.report_completed(&first_attempt).unwrap();

    let second = start(&coordinator, "second-start", "song-2").unwrap();
    let stale = coordinator.report_completed(&first_attempt).unwrap_err();

    assert_eq!(stale.reason_code, PlaybackErrorCode::StaleAttempt);
    assert_eq!(coordinator.projection().attempt_id, second.attempt_id);
    assert_eq!(coordinator.projection().state, PlaybackState::Starting);
    assert_eq!(coordinator.projection().song.unwrap().id, "song-2");
}

#[test]
fn pause_resume_and_stop_follow_host_transitions() {
    let coordinator = HostPlaybackCoordinator::default();
    let attempt = start(&coordinator, "start", "song-1")
        .unwrap()
        .attempt_id
        .unwrap();
    coordinator.report_started(&attempt).unwrap();

    let paused = coordinator
        .request_pause(PlaybackMutationRequest {
            request_id: "pause".to_string(),
        })
        .unwrap();
    assert_eq!(paused.state, PlaybackState::Paused);

    let resuming = coordinator
        .request_resume(PlaybackMutationRequest {
            request_id: "resume".to_string(),
        })
        .unwrap();
    assert_eq!(resuming.state, PlaybackState::Starting);
    coordinator.report_started(&attempt).unwrap();

    let stopped = coordinator
        .request_stop(PlaybackMutationRequest {
            request_id: "stop".to_string(),
        })
        .unwrap();
    assert_eq!(stopped.state, PlaybackState::Stopped);
}

#[test]
fn start_is_idempotent_and_request_id_conflicts_are_rejected() {
    let coordinator = HostPlaybackCoordinator::default();
    let first = start(&coordinator, "request-1", "song-1").unwrap();
    let retry = start(&coordinator, "request-1", "song-1").unwrap();
    assert_eq!(retry.attempt_id, first.attempt_id);

    let conflict = start(&coordinator, "request-1", "song-2").unwrap_err();
    assert_eq!(conflict.reason_code, PlaybackErrorCode::RequestIdConflict);
    assert_eq!(coordinator.projection().attempt_id, first.attempt_id);
    assert_eq!(
        coordinator.projection().diagnostics.idempotency_hit_count,
        1
    );
    assert_eq!(
        coordinator
            .projection()
            .diagnostics
            .idempotency_conflict_count,
        1
    );
}

#[test]
fn second_active_song_is_rejected_without_replacing_the_attempt() {
    let coordinator = HostPlaybackCoordinator::default();
    let first = start(&coordinator, "request-1", "song-1").unwrap();
    let error = start(&coordinator, "request-2", "song-2").unwrap_err();

    assert_eq!(error.reason_code, PlaybackErrorCode::PlaybackAlreadyActive);
    assert_eq!(coordinator.projection().attempt_id, first.attempt_id);
    assert_eq!(coordinator.projection().song.unwrap().id, "song-1");
}
