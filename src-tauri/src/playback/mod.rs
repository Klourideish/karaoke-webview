mod coordinator;
mod models;

#[cfg(test)]
mod tests;

use tauri::{Emitter, Manager};

pub(crate) use coordinator::HostPlaybackCoordinator;
pub(crate) use models::{
    PlaybackError, PlaybackErrorCode, PlaybackFailureKind, PlaybackFailureReportRequest,
    PlaybackMutationRequest, PlaybackProjection, PlaybackReportRequest, PlaybackSongProjection,
    PlaybackState, RequestSongPlayback,
};

pub(crate) const PLAYBACK_PROJECTION_EVENT: &str = "playback-projection-changed";

#[tauri::command]
pub(crate) fn get_playback_projection(
    coordinator: tauri::State<'_, HostPlaybackCoordinator>,
) -> PlaybackProjection {
    coordinator.projection()
}

#[tauri::command]
pub(crate) fn request_song_playback(
    app: tauri::AppHandle,
    request: RequestSongPlayback,
    coordinator: tauri::State<'_, HostPlaybackCoordinator>,
) -> Result<PlaybackProjection, PlaybackError> {
    request_song_playback_owned(&app, &coordinator, request)
}

pub(crate) fn request_song_playback_owned(
    app: &tauri::AppHandle,
    coordinator: &HostPlaybackCoordinator,
    request: RequestSongPlayback,
) -> Result<PlaybackProjection, PlaybackError> {
    let song_id = request.song_id.clone();
    let projection = coordinator.request_start(request, || {
        let resolved = crate::media_library::resolve_indexed_song(app, &song_id)
            .map_err(map_song_lookup_error)?;
        app.asset_protocol_scope()
            .allow_file(&resolved.audio_path)
            .map_err(|_| {
                PlaybackError::new(
                    PlaybackErrorCode::SongUnavailable,
                    "Could not access this song's audio file.",
                )
            })?;
        Ok(PlaybackSongProjection {
            id: resolved.song.id,
            title: resolved.song.title,
            artist: resolved.song.artist,
            audio_path: crate::media_library::path_to_string(&resolved.audio_path),
        })
    })?;
    publish(app, &projection);
    Ok(projection)
}

#[tauri::command]
pub(crate) fn request_playback_pause(
    app: tauri::AppHandle,
    request: PlaybackMutationRequest,
    coordinator: tauri::State<'_, HostPlaybackCoordinator>,
) -> Result<PlaybackProjection, PlaybackError> {
    publish_result(&app, coordinator.request_pause(request))
}

#[tauri::command]
pub(crate) fn request_playback_resume(
    app: tauri::AppHandle,
    request: PlaybackMutationRequest,
    coordinator: tauri::State<'_, HostPlaybackCoordinator>,
) -> Result<PlaybackProjection, PlaybackError> {
    publish_result(&app, coordinator.request_resume(request))
}

#[tauri::command]
pub(crate) fn request_playback_stop(
    app: tauri::AppHandle,
    request: PlaybackMutationRequest,
    coordinator: tauri::State<'_, HostPlaybackCoordinator>,
) -> Result<PlaybackProjection, PlaybackError> {
    request_playback_stop_owned(&app, &coordinator, request)
}

pub(crate) fn request_playback_stop_owned(
    app: &tauri::AppHandle,
    coordinator: &HostPlaybackCoordinator,
    request: PlaybackMutationRequest,
) -> Result<PlaybackProjection, PlaybackError> {
    publish_result(app, coordinator.request_stop(request))
}

#[tauri::command]
pub(crate) fn report_playback_started(
    app: tauri::AppHandle,
    request: PlaybackReportRequest,
    coordinator: tauri::State<'_, HostPlaybackCoordinator>,
) -> Result<PlaybackProjection, PlaybackError> {
    publish_playback_report(&app, coordinator.report_started(&request.attempt_id))
}

#[tauri::command]
pub(crate) fn report_playback_completed(
    app: tauri::AppHandle,
    request: PlaybackReportRequest,
    coordinator: tauri::State<'_, HostPlaybackCoordinator>,
) -> Result<PlaybackProjection, PlaybackError> {
    publish_playback_report(&app, coordinator.report_completed(&request.attempt_id))
}

#[tauri::command]
pub(crate) fn report_playback_failed(
    app: tauri::AppHandle,
    request: PlaybackFailureReportRequest,
    coordinator: tauri::State<'_, HostPlaybackCoordinator>,
) -> Result<PlaybackProjection, PlaybackError> {
    let message = request
        .message
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| "Playback could not start or continue.".to_string());
    publish_playback_report(
        &app,
        coordinator.report_failed(
            &request.attempt_id,
            match request.kind {
                PlaybackFailureKind::StartRejected => PlaybackErrorCode::AdapterStartFailed,
                PlaybackFailureKind::MediaError => PlaybackErrorCode::MediaFailed,
            },
            message,
        ),
    )
}

fn publish_playback_report(
    app: &tauri::AppHandle,
    result: Result<PlaybackProjection, PlaybackError>,
) -> Result<PlaybackProjection, PlaybackError> {
    let projection = publish_result(app, result)?;
    crate::performance::observe_playback_projection(app, &projection);
    Ok(projection)
}

fn publish_result(
    app: &tauri::AppHandle,
    result: Result<PlaybackProjection, PlaybackError>,
) -> Result<PlaybackProjection, PlaybackError> {
    if let Ok(projection) = &result {
        publish(app, projection);
    }
    result
}

fn publish(app: &tauri::AppHandle, projection: &PlaybackProjection) {
    if let Err(error) = app.emit(PLAYBACK_PROJECTION_EVENT, projection) {
        eprintln!("Could not publish playback projection: {error}");
    }
}

fn map_song_lookup_error(error: crate::media_library::IndexedSongLookupError) -> PlaybackError {
    use crate::media_library::IndexedSongLookupErrorCode as Lookup;
    let reason_code = match error.reason_code {
        Lookup::LibraryNotSelected => PlaybackErrorCode::LibraryNotSelected,
        Lookup::IndexUnavailable => PlaybackErrorCode::LibraryIndexUnavailable,
        Lookup::SongNotFound => PlaybackErrorCode::SongNotFound,
        Lookup::SongUnavailable => PlaybackErrorCode::SongUnavailable,
    };
    PlaybackError::new(reason_code, error.message)
}
