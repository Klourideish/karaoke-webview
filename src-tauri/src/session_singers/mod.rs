mod models;
mod registry;

#[cfg(test)]
mod tests;

pub(crate) use models::{
    CreateSessionSingerRequest, RenameSessionSingerRequest, SessionSingerError,
    SessionSingerErrorCode, SessionSingerProjection,
};
pub(crate) use registry::SessionSingerRegistry;

#[tauri::command]
pub(crate) fn list_session_singers(
    registry: tauri::State<'_, SessionSingerRegistry>,
) -> Vec<SessionSingerProjection> {
    registry.list()
}

#[tauri::command]
pub(crate) fn create_session_singer(
    request: CreateSessionSingerRequest,
    registry: tauri::State<'_, SessionSingerRegistry>,
) -> Result<SessionSingerProjection, SessionSingerError> {
    registry.create(request.display_name)
}

#[tauri::command]
pub(crate) fn rename_session_singer(
    request: RenameSessionSingerRequest,
    registry: tauri::State<'_, SessionSingerRegistry>,
) -> Result<SessionSingerProjection, SessionSingerError> {
    registry.rename(&request.singer_id, &request.display_name)
}

#[tauri::command]
pub(crate) fn remove_session_singer(
    singer_id: String,
    registry: tauri::State<'_, SessionSingerRegistry>,
    assignments: tauri::State<'_, crate::microphones::MicrophoneAssignmentRegistry>,
    operations: tauri::State<'_, crate::microphones::MicrophoneRegistryOperations>,
) -> Result<SessionSingerProjection, SessionSingerError> {
    let _operation = operations.lock();
    let in_use = assignments.assignment_for_singer(&singer_id).is_some()
        || assignments.waiting_for_singer(&singer_id).is_some();
    let removed = registry.remove(&singer_id, in_use)?;
    assignments.clear_unassigned_singer_metadata(&singer_id);
    Ok(removed)
}
