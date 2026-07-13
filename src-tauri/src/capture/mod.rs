pub(crate) mod backend;
pub(crate) mod levels;
mod manager;
mod models;
pub(crate) mod monitor;

#[cfg(test)]
mod tests;

#[cfg(target_os = "windows")]
mod windows;

pub(crate) use manager::DiagnosticCaptureManager;
pub(crate) use models::{
    CaptureAudioFrame, DiagnosticCaptureSnapshot, MicrophoneLevelSnapshot, MonitorSampleEncoding,
};

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

#[tauri::command]
pub(crate) fn list_diagnostic_output_devices() -> Vec<monitor::DiagnosticOutputDevice> {
    monitor::list_output_devices()
}

#[tauri::command]
pub(crate) fn get_diagnostic_monitor_status(
    manager: tauri::State<'_, std::sync::Arc<monitor::DiagnosticAudioMonitorManager>>,
) -> monitor::DiagnosticMonitorStatus {
    manager.status()
}

#[tauri::command]
pub(crate) fn get_diagnostic_monitor_diagnostics(
    manager: tauri::State<'_, std::sync::Arc<monitor::DiagnosticAudioMonitorManager>>,
) -> monitor::DiagnosticMonitorDiagnostics {
    manager.diagnostics()
}

#[tauri::command]
pub(crate) fn start_diagnostic_monitor(
    request: monitor::StartDiagnosticMonitorRequest,
    capture: tauri::State<'_, DiagnosticCaptureManager>,
    manager: tauri::State<'_, std::sync::Arc<monitor::DiagnosticAudioMonitorManager>>,
    development: tauri::State<
        '_,
        std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
    >,
) -> Result<monitor::DiagnosticMonitorStatus, monitor::DiagnosticMonitorCommandError> {
    if !crate::microphones::is_microphone_source_available(&request.source_id, Some(&development))?
    {
        return Err(monitor::DiagnosticMonitorCommandError::new(
            "source-unavailable",
            "The selected microphone is no longer available.",
        ));
    }
    if capture.occupied_source_id().as_deref() != Some(&request.source_id) {
        return Err(monitor::DiagnosticMonitorCommandError::new(
            "capture-session-unavailable",
            "Start a microphone test before monitoring this source.",
        ));
    }
    manager.start(request)
}

#[tauri::command]
pub(crate) fn stop_diagnostic_monitor(
    manager: tauri::State<'_, std::sync::Arc<monitor::DiagnosticAudioMonitorManager>>,
) -> monitor::DiagnosticMonitorStatus {
    manager.stop()
}
