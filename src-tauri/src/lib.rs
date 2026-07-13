mod capture;
mod development_protocol;
mod lyrics;
mod media_library;
mod microphones;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let development_protocol =
        std::sync::Arc::new(development_protocol::DevelopmentProtocolManager::new());
    let diagnostic_monitor =
        std::sync::Arc::new(capture::monitor::DiagnosticAudioMonitorManager::new());
    tauri::Builder::default()
        .manage(std::sync::Arc::clone(&development_protocol))
        .manage(std::sync::Arc::clone(&diagnostic_monitor))
        .manage(capture::DiagnosticCaptureManager::with_development(
            development_protocol,
            diagnostic_monitor,
        ))
        .manage(microphones::MicrophoneAssignmentRegistry::default())
        .manage(microphones::MicrophoneChannelRegistry::default())
        .manage(microphones::MicrophoneRecoveryRegistry::default())
        .manage(microphones::MicrophoneRegistryOperations::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            capture::diagnostic_capture_snapshot,
            capture::get_diagnostic_monitor_diagnostics,
            capture::get_diagnostic_monitor_status,
            capture::list_diagnostic_output_devices,
            capture::start_diagnostic_capture,
            capture::start_diagnostic_monitor,
            capture::stop_diagnostic_capture,
            capture::stop_diagnostic_monitor,
            development_protocol::get_development_protocol_status,
            development_protocol::get_development_stream_diagnostics,
            microphones::assign_microphone_channel,
            microphones::auto_assign_microphone_channel,
            microphones::clear_microphone_waiting_state,
            media_library::clear_library_index,
            media_library::load_library_index,
            media_library::load_library_settings,
            microphones::create_microphone_channel,
            microphones::discover_local_microphone_sources,
            microphones::evaluate_performance_microphone_readiness,
            microphones::get_microphone_recovery_states,
            microphones::leave_microphone_channel_assigned,
            development_protocol::list_development_network_sources,
            microphones::list_microphone_channels,
            microphones::list_microphone_assignments,
            microphones::list_microphone_waiting_states,
            lyrics::parse_song_lyrics,
            media_library::resolve_audio_source,
            microphones::remove_microphone_channel,
            microphones::replace_microphone_channel_source,
            microphones::replace_disconnected_microphone_channel_source,
            microphones::retry_microphone_channel_source,
            media_library::save_library_index,
            media_library::save_library_root,
            media_library::scan_media_library,
            development_protocol::start_development_protocol_listener,
            development_protocol::stop_development_protocol_listener,
            microphones::sync_session_singers,
            microphones::unassign_microphone_channel
        ])
        .run(tauri::generate_context!())
        .expect("error while running Karaoke Webview");
}
