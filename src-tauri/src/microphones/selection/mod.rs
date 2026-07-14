mod coordinator;
mod models;

#[cfg(test)]
mod tests;

pub(crate) use coordinator::MicrophoneSelectionCoordinator;
pub(crate) use models::{
    MicrophoneSelectionError, MicrophoneSelectionProjection, SelectSingerMicrophoneRequest,
};

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn select_singer_microphone(
    request: SelectSingerMicrophoneRequest,
    coordinator: tauri::State<'_, MicrophoneSelectionCoordinator>,
    singers: tauri::State<'_, crate::session_singers::SessionSingerRegistry>,
    channels: tauri::State<'_, crate::microphones::MicrophoneChannelRegistry>,
    assignments: tauri::State<'_, crate::microphones::MicrophoneAssignmentRegistry>,
    recovery: tauri::State<'_, crate::microphones::MicrophoneRecoveryRegistry>,
    operations: tauri::State<'_, crate::microphones::MicrophoneRegistryOperations>,
    development: tauri::State<
        '_,
        std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
    >,
) -> Result<MicrophoneSelectionProjection, MicrophoneSelectionError> {
    let sources =
        crate::microphones::discover_all_sources(Some(&development)).map_err(|error| {
            MicrophoneSelectionError::new(
                models::MicrophoneSelectionErrorCode::InternalError,
                error,
            )
        })?;
    coordinator.select(
        request,
        &sources,
        &singers,
        &channels,
        &assignments,
        &recovery,
        &operations,
    )
}
