mod capture;
mod development_pairing;
mod development_protocol;
mod lyrics;
mod media_library;
mod microphones;
mod participant_commit;
mod playback;
mod session_singers;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let development_pairing =
        std::sync::Arc::new(development_pairing::DevelopmentPairingCoordinator::default());
    let development_protocol = std::sync::Arc::new(
        development_protocol::DevelopmentProtocolManager::with_pairing(std::sync::Arc::clone(
            &development_pairing,
        )),
    );
    let diagnostic_monitor =
        std::sync::Arc::new(capture::monitor::DiagnosticAudioMonitorManager::new());
    tauri::Builder::default()
        .manage(std::sync::Arc::clone(&development_protocol))
        .manage(development_pairing)
        .manage(std::sync::Arc::clone(&diagnostic_monitor))
        .manage(capture::DiagnosticCaptureManager::with_development(
            development_protocol,
            diagnostic_monitor,
        ))
        .manage(microphones::MicrophoneAssignmentRegistry::default())
        .manage(microphones::MicrophoneChannelRegistry::default())
        .manage(microphones::MicrophoneRecoveryRegistry::default())
        .manage(microphones::MicrophoneRegistryOperations::default())
        .manage(microphones::selection::MicrophoneSelectionCoordinator::default())
        .manage(session_singers::SessionSingerRegistry::default())
        .manage(participant_commit::ParticipantCommitCoordinator::default())
        .manage(media_library::MediaLibraryRefreshCoordinator::default())
        .manage(playback::HostPlaybackCoordinator::default())
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
            participant_commit::assign_microphone_to_existing_singer,
            participant_commit::get_participant_commit_diagnostics,
            development_protocol::get_development_protocol_status,
            development_protocol::get_development_stream_diagnostics,
            development_pairing::get_development_pairing_status,
            development_pairing::get_development_pairing_diagnostics,
            microphones::assign_microphone_channel,
            microphones::auto_assign_microphone_channel,
            microphones::clear_microphone_waiting_state,
            session_singers::create_session_singer,
            participant_commit::create_session_singer_with_microphone,
            media_library::clear_library_index,
            media_library::load_library_index,
            media_library::load_library_settings,
            microphones::create_microphone_channel,
            microphones::discover_local_microphone_sources,
            microphones::evaluate_performance_microphone_readiness,
            microphones::get_microphone_recovery_states,
            microphones::leave_microphone_channel_assigned,
            session_singers::list_session_singers,
            development_protocol::list_development_network_sources,
            microphones::list_microphone_channels,
            microphones::list_microphone_assignments,
            microphones::list_microphone_waiting_states,
            lyrics::parse_song_lyrics,
            playback::get_playback_projection,
            playback::request_song_playback,
            playback::request_playback_pause,
            playback::request_playback_resume,
            playback::request_playback_stop,
            playback::report_playback_started,
            playback::report_playback_completed,
            playback::report_playback_failed,
            media_library::refresh_media_library,
            microphones::remove_microphone_channel,
            session_singers::remove_session_singer,
            microphones::replace_microphone_channel_source,
            microphones::replace_disconnected_microphone_channel_source,
            microphones::retry_microphone_channel_source,
            microphones::selection::select_singer_microphone,
            session_singers::rename_session_singer,
            media_library::save_library_index,
            media_library::save_library_root,
            media_library::select_library_location,
            media_library::scan_media_library,
            development_protocol::start_development_protocol_listener,
            development_protocol::stop_development_protocol_listener,
            development_pairing::create_development_pairing_offer,
            development_pairing::cancel_development_pairing_offer,
            development_pairing::accept_development_pairing_proposal,
            development_pairing::reject_development_pairing_proposal,
            microphones::unassign_microphone_channel
        ])
        .run(tauri::generate_context!())
        .expect("error while running Karaoke Webview");
}
