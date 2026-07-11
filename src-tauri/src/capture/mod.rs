mod backend;
mod levels;
mod manager;
mod models;

#[cfg(test)]
mod tests;

#[cfg(target_os = "windows")]
mod windows;

pub(crate) use manager::DiagnosticCaptureManager;
use models::DiagnosticCaptureSnapshot;

#[tauri::command]
pub(crate) fn diagnostic_capture_snapshot(
    manager: tauri::State<'_, DiagnosticCaptureManager>,
) -> DiagnosticCaptureSnapshot {
    manager.snapshot()
}

#[tauri::command]
pub(crate) fn start_diagnostic_capture(
    source_id: String,
    manager: tauri::State<'_, DiagnosticCaptureManager>,
) -> Result<DiagnosticCaptureSnapshot, String> {
    if !crate::microphones::is_local_microphone_available(&source_id)? {
        return Err("The selected microphone is no longer available.".to_string());
    }
    Ok(manager.start(source_id))
}

#[tauri::command]
pub(crate) fn stop_diagnostic_capture(
    manager: tauri::State<'_, DiagnosticCaptureManager>,
) -> DiagnosticCaptureSnapshot {
    manager.stop()
}
