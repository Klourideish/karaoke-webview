pub(crate) mod backend;
pub(crate) mod levels;
mod manager;
mod models;

#[cfg(test)]
mod tests;

#[cfg(target_os = "windows")]
mod windows;

pub(crate) use manager::DiagnosticCaptureManager;
pub(crate) use models::{DiagnosticCaptureSnapshot, MicrophoneLevelSnapshot};

impl DiagnosticCaptureManager {
    pub(crate) fn occupied_source_for_readiness(&self) -> Option<String> {
        self.occupied_source_id()
    }
}

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
    development: tauri::State<
        '_,
        std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
    >,
) -> Result<DiagnosticCaptureSnapshot, String> {
    if !crate::microphones::is_microphone_source_available(&source_id, Some(&development))? {
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
