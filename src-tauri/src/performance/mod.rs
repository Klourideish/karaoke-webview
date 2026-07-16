mod coordinator;
mod models;

#[cfg(test)]
mod tests;

use std::{
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant},
};

use tauri::{Emitter, Manager};

pub(crate) use coordinator::HostPerformanceCoordinator;
pub(crate) use models::{
    CreatePerformanceRequest, PerformanceError, PerformanceErrorCode, PerformanceLifecycleState,
    PerformanceMutationRequest, PerformanceProjection,
};
use models::{PerformanceSingerProjection, PerformanceSongProjection};

pub(crate) const PERFORMANCE_PROJECTION_EVENT: &str = "performance-projection-changed";
const READINESS_POLL_INTERVAL: Duration = Duration::from_millis(500);

impl HostPerformanceCoordinator {
    pub(crate) fn start_worker(self: &Arc<Self>, app: tauri::AppHandle) {
        let mut worker = lock(&self.worker);
        if worker.is_some() {
            return;
        }
        self.shutdown.store(false, Ordering::Release);
        let coordinator = Arc::clone(self);
        *worker = Some(std::thread::spawn(move || {
            let mut last_readiness_poll = Instant::now() - READINESS_POLL_INTERVAL;
            while !coordinator.shutdown.load(Ordering::Acquire) {
                let now = Instant::now();
                let poll_readiness = now.duration_since(last_readiness_poll)
                    >= READINESS_POLL_INTERVAL
                    || coordinator.countdown_is_due(now);
                tick(&app, &coordinator, poll_readiness);
                if poll_readiness {
                    last_readiness_poll = now;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }));
    }

    pub(crate) fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Release);
        if let Some(worker) = lock(&self.worker).take() {
            let _ = worker.join();
        }
    }
}

#[tauri::command]
pub(crate) fn get_performance_projection(
    coordinator: tauri::State<'_, Arc<HostPerformanceCoordinator>>,
) -> PerformanceProjection {
    coordinator.projection()
}

#[tauri::command]
pub(crate) fn create_performance(
    app: tauri::AppHandle,
    request: CreatePerformanceRequest,
    coordinator: tauri::State<'_, Arc<HostPerformanceCoordinator>>,
    singers: tauri::State<'_, crate::session_singers::SessionSingerRegistry>,
    playback: tauri::State<'_, crate::playback::HostPlaybackCoordinator>,
) -> Result<PerformanceProjection, PerformanceError> {
    create_performance_owned(&app, request, &coordinator, &singers, &playback)
}

pub(crate) fn create_performance_owned(
    app: &tauri::AppHandle,
    request: CreatePerformanceRequest,
    coordinator: &HostPerformanceCoordinator,
    singers: &crate::session_singers::SessionSingerRegistry,
    playback: &crate::playback::HostPlaybackCoordinator,
) -> Result<PerformanceProjection, PerformanceError> {
    let singer = singers.get(&request.singer_id).ok_or_else(|| {
        PerformanceError::new(
            PerformanceErrorCode::SingerNotFound,
            "The selected singer is no longer in this session.",
        )
    })?;
    let resolved = crate::media_library::resolve_indexed_song(app, &request.song_id)
        .map_err(map_song_error)?;
    crate::lyrics::validate_song_lyrics(app, &request.song_id)
        .map_err(|message| PerformanceError::new(PerformanceErrorCode::LyricsInvalid, message))?;
    let readiness = readiness(app, &request.singer_id, true, false, false)
        .map_err(|message| PerformanceError::new(PerformanceErrorCode::InternalError, message))?;
    let projection = coordinator.create_validated_with_playback(
        request,
        PerformanceSingerProjection {
            id: singer.id,
            display_name: singer.display_name,
        },
        PerformanceSongProjection {
            id: resolved.song.id,
            title: resolved.song.title,
            artist: resolved.song.artist,
        },
        readiness.clone(),
        playback,
    )?;
    let performance_id = projection
        .active
        .as_ref()
        .expect("created Performance")
        .id
        .clone();
    let projection = coordinator
        .apply_readiness(&performance_id, readiness, Instant::now())
        .unwrap_or(projection);
    publish(app, &projection);
    Ok(projection)
}

#[tauri::command]
pub(crate) fn cancel_preparation(
    app: tauri::AppHandle,
    request: PerformanceMutationRequest,
    coordinator: tauri::State<'_, Arc<HostPerformanceCoordinator>>,
    playback: tauri::State<'_, crate::playback::HostPlaybackCoordinator>,
) -> Result<PerformanceProjection, PerformanceError> {
    cancel_preparation_owned(&app, request, &coordinator, &playback)
}

pub(crate) fn cancel_preparation_owned(
    app: &tauri::AppHandle,
    request: PerformanceMutationRequest,
    coordinator: &HostPerformanceCoordinator,
    playback: &crate::playback::HostPlaybackCoordinator,
) -> Result<PerformanceProjection, PerformanceError> {
    stop_linked_playback(app, coordinator, playback, &request, "cancel")?;
    let projection = coordinator.cancel(request)?;
    publish(app, &projection);
    Ok(projection)
}

#[tauri::command]
pub(crate) fn skip_performance(
    app: tauri::AppHandle,
    request: PerformanceMutationRequest,
    coordinator: tauri::State<'_, Arc<HostPerformanceCoordinator>>,
    playback: tauri::State<'_, crate::playback::HostPlaybackCoordinator>,
) -> Result<PerformanceProjection, PerformanceError> {
    skip_performance_owned(&app, request, &coordinator, &playback)
}

pub(crate) fn skip_performance_owned(
    app: &tauri::AppHandle,
    request: PerformanceMutationRequest,
    coordinator: &HostPerformanceCoordinator,
    playback: &crate::playback::HostPlaybackCoordinator,
) -> Result<PerformanceProjection, PerformanceError> {
    stop_linked_playback(app, coordinator, playback, &request, "skip")?;
    let projection = coordinator.skip(request)?;
    publish(app, &projection);
    Ok(projection)
}

pub(crate) fn observe_playback_projection(
    app: &tauri::AppHandle,
    playback: &crate::playback::PlaybackProjection,
) {
    let coordinator = app.state::<Arc<HostPerformanceCoordinator>>();
    if let Some(projection) = coordinator.observe_playback(playback, Instant::now()) {
        publish(app, &projection);
    }
}

fn tick(
    app: &tauri::AppHandle,
    coordinator: &Arc<HostPerformanceCoordinator>,
    poll_readiness: bool,
) {
    let projection = coordinator.projection();
    let Some(active) = projection.active else {
        return;
    };
    match active.state {
        PerformanceLifecycleState::Preparing | PerformanceLifecycleState::Countdown => {
            let pending_attempt = active.playback.attempt_id.clone();
            if poll_readiness {
                if let Ok(readiness) = readiness(
                    app,
                    &active.performer.id,
                    active.state == PerformanceLifecycleState::Preparing,
                    active.state == PerformanceLifecycleState::Countdown,
                    false,
                ) {
                    if let Ok(updated) =
                        coordinator.apply_readiness(&active.id, readiness, Instant::now())
                    {
                        if updated.active.as_ref().is_some_and(|next| {
                            next.state == PerformanceLifecycleState::Preparing
                                && pending_attempt.is_some()
                        }) {
                            let _ = crate::playback::request_playback_stop_owned(
                                app,
                                &app.state::<crate::playback::HostPlaybackCoordinator>(),
                                crate::playback::PlaybackMutationRequest {
                                    request_id: format!(
                                        "{}:readiness-lost:{}:playback-stop",
                                        active.id,
                                        pending_attempt.as_deref().unwrap_or("unknown")
                                    ),
                                },
                            );
                        }
                        publish(app, &updated);
                    }
                }
            }
            if let Some((performance_id, song_id, playback_request_id)) =
                coordinator.countdown_action(Instant::now())
            {
                let request = crate::playback::RequestSongPlayback {
                    request_id: playback_request_id,
                    song_id,
                };
                match crate::playback::request_song_playback_owned(
                    app,
                    &app.state::<crate::playback::HostPlaybackCoordinator>(),
                    request,
                ) {
                    Ok(playback) => {
                        if let Ok(updated) = coordinator.link_playback(&performance_id, &playback) {
                            publish(app, &updated);
                        }
                    }
                    Err(error) => {
                        if let Ok(failed) = coordinator.fail_start(
                            &performance_id,
                            PerformanceErrorCode::PlaybackFailed,
                            error.message,
                        ) {
                            publish(app, &failed);
                        }
                    }
                }
            }
        }
        PerformanceLifecycleState::Results => {
            publish(app, &coordinator.projection());
            if let Some(completed) = coordinator.complete_results_if_due(Instant::now()) {
                publish(app, &completed);
            }
        }
        PerformanceLifecycleState::Finalizing => {
            if let Some(results) = coordinator.advance_finalizing(Instant::now()) {
                publish(app, &results);
            }
        }
        PerformanceLifecycleState::Playing => {
            if poll_readiness {
                if let Ok(readiness) = readiness(app, &active.performer.id, false, false, true) {
                    if let Ok(updated) =
                        coordinator.apply_readiness(&active.id, readiness, Instant::now())
                    {
                        publish(app, &updated);
                    }
                }
            }
        }
        _ => {}
    }
}

fn readiness(
    app: &tauri::AppHandle,
    singer_id: &str,
    allow_automatic_recovery: bool,
    countdown: bool,
    playing: bool,
) -> Result<crate::microphones::PerformanceMicrophoneReadiness, String> {
    crate::microphones::evaluate_performance_readiness_owned(
        app,
        crate::microphones::PerformanceMicrophoneReadinessRequest {
            mode: crate::microphones::KaraokeMode::Standard,
            participant_singer_ids: vec![singer_id.to_string()],
            allow_automatic_recovery,
            phase: if playing {
                crate::microphones::PerformanceReadinessPhase::Playing
            } else if countdown {
                crate::microphones::PerformanceReadinessPhase::Countdown
            } else {
                crate::microphones::PerformanceReadinessPhase::Preparing
            },
        },
    )
}

fn stop_linked_playback(
    app: &tauri::AppHandle,
    coordinator: &HostPerformanceCoordinator,
    playback: &crate::playback::HostPlaybackCoordinator,
    request: &PerformanceMutationRequest,
    operation: &str,
) -> Result<(), PerformanceError> {
    if coordinator
        .playback_attempt_for(&request.performance_id)
        .is_some()
    {
        crate::playback::request_playback_stop_owned(
            app,
            playback,
            crate::playback::PlaybackMutationRequest {
                request_id: format!("{}:{operation}:playback-stop", request.request_id),
            },
        )
        .map_err(|error| {
            PerformanceError::new(PerformanceErrorCode::PlaybackFailed, error.message)
        })?;
    }
    Ok(())
}

fn publish(app: &tauri::AppHandle, projection: &PerformanceProjection) {
    if let Err(error) = app.emit(PERFORMANCE_PROJECTION_EVENT, projection) {
        eprintln!("Could not publish Performance projection: {error}");
    }
}

fn map_song_error(error: crate::media_library::IndexedSongLookupError) -> PerformanceError {
    use crate::media_library::IndexedSongLookupErrorCode as Lookup;
    PerformanceError::new(
        match error.reason_code {
            Lookup::SongNotFound => PerformanceErrorCode::SongNotFound,
            Lookup::SongUnavailable => PerformanceErrorCode::SongUnavailable,
            Lookup::LibraryNotSelected | Lookup::IndexUnavailable => {
                PerformanceErrorCode::SongUnavailable
            }
        },
        error.message,
    )
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
