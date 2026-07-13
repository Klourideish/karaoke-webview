mod jitter;
mod manager;
mod models;
mod packet;

pub(crate) use manager::DevelopmentProtocolManager;
pub(crate) use models::{
    DevelopmentProtocolProjection, DevelopmentProtocolStatus, DevelopmentStreamDiagnostics,
    StartDevelopmentProtocolRequest,
};

#[tauri::command]
pub(crate) fn start_development_protocol_listener(
    request: Option<StartDevelopmentProtocolRequest>,
    manager: tauri::State<'_, std::sync::Arc<DevelopmentProtocolManager>>,
) -> Result<DevelopmentProtocolProjection, String> {
    manager.start(request.unwrap_or(StartDevelopmentProtocolRequest {
        tcp_port: None,
        udp_port: None,
        bind_address: None,
    }))
}

#[tauri::command]
pub(crate) fn stop_development_protocol_listener(
    manager: tauri::State<'_, std::sync::Arc<DevelopmentProtocolManager>>,
) -> DevelopmentProtocolProjection {
    manager.stop()
}

#[tauri::command]
pub(crate) fn get_development_protocol_status(
    manager: tauri::State<'_, std::sync::Arc<DevelopmentProtocolManager>>,
) -> DevelopmentProtocolStatus {
    manager.projection().status
}

#[tauri::command]
pub(crate) fn list_development_network_sources(
    manager: tauri::State<'_, std::sync::Arc<DevelopmentProtocolManager>>,
) -> Vec<crate::microphones::DiscoveredMicrophoneSource> {
    manager.sources()
}

#[tauri::command]
pub(crate) fn get_development_stream_diagnostics(
    manager: tauri::State<'_, std::sync::Arc<DevelopmentProtocolManager>>,
) -> DevelopmentStreamDiagnostics {
    manager.projection().diagnostics
}
