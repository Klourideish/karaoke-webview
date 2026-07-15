mod coordinator;
mod models;

#[cfg(test)]
mod tests;

pub(crate) use coordinator::ParticipantCommitCoordinator;
pub(crate) use models::{
    AssignMicrophoneToSingerRequest, CreateSingerWithMicrophoneRequest,
    ParticipantCommitDiagnosticProjection, ParticipantCommitError, ParticipantCommitErrorCode,
    ParticipantCommitProjection,
};

#[tauri::command]
pub(crate) fn get_participant_commit_diagnostics(
    coordinator: tauri::State<'_, ParticipantCommitCoordinator>,
) -> ParticipantCommitDiagnosticProjection {
    coordinator.diagnostics()
}

#[tauri::command]
pub(crate) fn create_session_singer_with_microphone(
    request: CreateSingerWithMicrophoneRequest,
    coordinator: tauri::State<'_, ParticipantCommitCoordinator>,
    singers: tauri::State<'_, crate::session_singers::SessionSingerRegistry>,
    channels: tauri::State<'_, crate::microphones::MicrophoneChannelRegistry>,
    assignments: tauri::State<'_, crate::microphones::MicrophoneAssignmentRegistry>,
    operations: tauri::State<'_, crate::microphones::MicrophoneRegistryOperations>,
    development: tauri::State<
        '_,
        std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
    >,
) -> Result<ParticipantCommitProjection, ParticipantCommitError> {
    let sources =
        crate::microphones::discover_all_sources(Some(&development)).map_err(|error| {
            ParticipantCommitError::new(models::ParticipantCommitErrorCode::InternalError, error)
        })?;
    coordinator.create_singer_with_microphone(
        request,
        &sources,
        &singers,
        &channels,
        &assignments,
        &operations,
    )
}

#[tauri::command]
pub(crate) fn assign_microphone_to_existing_singer(
    request: AssignMicrophoneToSingerRequest,
    coordinator: tauri::State<'_, ParticipantCommitCoordinator>,
    singers: tauri::State<'_, crate::session_singers::SessionSingerRegistry>,
    channels: tauri::State<'_, crate::microphones::MicrophoneChannelRegistry>,
    assignments: tauri::State<'_, crate::microphones::MicrophoneAssignmentRegistry>,
    operations: tauri::State<'_, crate::microphones::MicrophoneRegistryOperations>,
    development: tauri::State<
        '_,
        std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
    >,
) -> Result<ParticipantCommitProjection, ParticipantCommitError> {
    let sources =
        crate::microphones::discover_all_sources(Some(&development)).map_err(|error| {
            ParticipantCommitError::new(models::ParticipantCommitErrorCode::InternalError, error)
        })?;
    coordinator.assign_microphone_to_existing_singer(
        request,
        &sources,
        &singers,
        &channels,
        &assignments,
        &operations,
    )
}
