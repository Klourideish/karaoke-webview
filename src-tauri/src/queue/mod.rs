mod coordinator;
mod models;

#[cfg(test)]
mod tests;

pub(crate) use coordinator::{HostQueueCoordinator, ValidatedQueueEntry};
pub(crate) use models::{
    AddSongToQueueRequest, MoveQueueEntryRequest, QueueError, QueueErrorCode, QueueMutationRequest,
    QueueProjection, RemoveQueueEntryRequest, RemoveQueueVoteRequest, RetryFailedQueueEntryRequest,
    VoteForQueueEntryRequest,
};

use std::sync::Arc;
use tauri::{Emitter, State};

#[tauri::command]
pub(crate) fn get_queue_projection(
    coordinator: State<'_, Arc<HostQueueCoordinator>>,
    singers: State<'_, crate::session_singers::SessionSingerRegistry>,
) -> QueueProjection {
    coordinator.projection(&singers)
}

#[tauri::command]
pub(crate) fn add_song_to_queue(
    app: tauri::AppHandle,
    request: AddSongToQueueRequest,
    coordinator: State<'_, Arc<HostQueueCoordinator>>,
    singers: State<'_, crate::session_singers::SessionSingerRegistry>,
) -> Result<QueueProjection, QueueError> {
    let song_id = request.song_id.clone();
    let singer_id = request.singer_id.clone();
    coordinator.add_song(request, || {
        if !singers.contains(&singer_id) {
            return Err(singer_not_found());
        }
        let resolved = crate::media_library::resolve_indexed_song(&app, &song_id)
            .map_err(|error| QueueError::new(QueueErrorCode::SongNotFound, error.message))?;
        Ok(ValidatedQueueEntry {
            song_title: resolved.song.title,
            song_artist: resolved.song.artist,
        })
    })?;
    publish_projection(&app, &coordinator, &singers)
}

#[tauri::command]
pub(crate) fn remove_queue_entry(
    app: tauri::AppHandle,
    request: RemoveQueueEntryRequest,
    coordinator: State<'_, Arc<HostQueueCoordinator>>,
    singers: State<'_, crate::session_singers::SessionSingerRegistry>,
) -> Result<QueueProjection, QueueError> {
    coordinator.remove_entry(request)?;
    publish_projection(&app, &coordinator, &singers)
}

#[tauri::command]
pub(crate) fn move_queue_entry(
    app: tauri::AppHandle,
    request: MoveQueueEntryRequest,
    coordinator: State<'_, Arc<HostQueueCoordinator>>,
    singers: State<'_, crate::session_singers::SessionSingerRegistry>,
) -> Result<QueueProjection, QueueError> {
    coordinator.move_entry(request)?;
    publish_projection(&app, &coordinator, &singers)
}

#[tauri::command]
pub(crate) fn vote_for_queue_entry(
    app: tauri::AppHandle,
    request: VoteForQueueEntryRequest,
    coordinator: State<'_, Arc<HostQueueCoordinator>>,
    singers: State<'_, crate::session_singers::SessionSingerRegistry>,
) -> Result<QueueProjection, QueueError> {
    let singer_id = request.singer_id.clone();
    coordinator.vote_for_entry(request, || {
        singers
            .contains(&singer_id)
            .then_some(())
            .ok_or_else(singer_not_found)
    })?;
    publish_projection(&app, &coordinator, &singers)
}

#[tauri::command]
pub(crate) fn remove_queue_vote(
    app: tauri::AppHandle,
    request: RemoveQueueVoteRequest,
    coordinator: State<'_, Arc<HostQueueCoordinator>>,
    singers: State<'_, crate::session_singers::SessionSingerRegistry>,
) -> Result<QueueProjection, QueueError> {
    let singer_id = request.singer_id.clone();
    coordinator.remove_vote(request, || {
        singers
            .contains(&singer_id)
            .then_some(())
            .ok_or_else(singer_not_found)
    })?;
    publish_projection(&app, &coordinator, &singers)
}

#[tauri::command]
pub(crate) fn pause_queue_progression(
    app: tauri::AppHandle,
    request: QueueMutationRequest,
    coordinator: State<'_, Arc<HostQueueCoordinator>>,
    singers: State<'_, crate::session_singers::SessionSingerRegistry>,
) -> Result<QueueProjection, QueueError> {
    coordinator.pause_progression(request)?;
    publish_projection(&app, &coordinator, &singers)
}

#[tauri::command]
pub(crate) fn resume_queue_progression(
    app: tauri::AppHandle,
    request: QueueMutationRequest,
    coordinator: State<'_, Arc<HostQueueCoordinator>>,
    singers: State<'_, crate::session_singers::SessionSingerRegistry>,
) -> Result<QueueProjection, QueueError> {
    coordinator.resume_progression(request)?;
    publish_projection(&app, &coordinator, &singers)
}

#[tauri::command]
pub(crate) fn skip_current_queue_entry(
    app: tauri::AppHandle,
    request: QueueMutationRequest,
    coordinator: State<'_, Arc<HostQueueCoordinator>>,
    performance: State<'_, Arc<crate::performance::HostPerformanceCoordinator>>,
    playback: State<'_, crate::playback::HostPlaybackCoordinator>,
    singers: State<'_, crate::session_singers::SessionSingerRegistry>,
) -> Result<QueueProjection, QueueError> {
    let stop_request_id = request.request_id.clone();
    coordinator.skip_current(request, |performance_id| {
        let active = performance
            .projection()
            .active
            .filter(|active| active.id == performance_id)
            .ok_or_else(|| {
                QueueError::new(
                    QueueErrorCode::PerformanceFailed,
                    "The linked Performance is no longer available.",
                )
            })?;
        let request = crate::performance::PerformanceMutationRequest {
            request_id: format!("{stop_request_id}:performance"),
            performance_id: performance_id.to_string(),
        };
        let result = match active.state {
            crate::performance::PerformanceLifecycleState::Created
            | crate::performance::PerformanceLifecycleState::Preparing
            | crate::performance::PerformanceLifecycleState::Ready => {
                crate::performance::cancel_preparation_owned(&app, request, &performance, &playback)
            }
            crate::performance::PerformanceLifecycleState::Countdown
            | crate::performance::PerformanceLifecycleState::Playing => {
                crate::performance::skip_performance_owned(&app, request, &performance, &playback)
            }
            _ => {
                return Err(QueueError::new(
                    QueueErrorCode::InvalidState,
                    "This Performance can no longer be skipped.",
                ));
            }
        };
        result
            .map(|_| ())
            .map_err(|error| QueueError::new(QueueErrorCode::PerformanceFailed, error.message))
    })?;
    publish_projection(&app, &coordinator, &singers)
}

#[tauri::command]
pub(crate) fn retry_failed_queue_entry(
    app: tauri::AppHandle,
    request: RetryFailedQueueEntryRequest,
    coordinator: State<'_, Arc<HostQueueCoordinator>>,
    singers: State<'_, crate::session_singers::SessionSingerRegistry>,
) -> Result<QueueProjection, QueueError> {
    coordinator.retry_failed(request)?;
    publish_projection(&app, &coordinator, &singers)
}

fn publish_projection(
    app: &tauri::AppHandle,
    coordinator: &HostQueueCoordinator,
    singers: &crate::session_singers::SessionSingerRegistry,
) -> Result<QueueProjection, QueueError> {
    let projection = coordinator.projection(singers);
    if let Err(error) = app.emit("queue-projection-changed", &projection) {
        eprintln!("Could not publish Queue projection: {error}");
    }
    Ok(projection)
}

fn singer_not_found() -> QueueError {
    QueueError::new(
        QueueErrorCode::SingerNotFound,
        "The selected singer is no longer in this session.",
    )
}
