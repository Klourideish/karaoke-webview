mod capture;
mod lyrics;
mod media_library;
mod microphones;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(capture::DiagnosticCaptureManager::new())
        .manage(microphones::MicrophoneChannelRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            capture::diagnostic_capture_snapshot,
            capture::start_diagnostic_capture,
            capture::stop_diagnostic_capture,
            media_library::clear_library_index,
            media_library::load_library_index,
            media_library::load_library_settings,
            microphones::create_microphone_channel,
            microphones::discover_local_microphone_sources,
            microphones::list_microphone_channels,
            lyrics::parse_song_lyrics,
            media_library::resolve_audio_source,
            microphones::remove_microphone_channel,
            microphones::replace_microphone_channel_source,
            media_library::save_library_index,
            media_library::save_library_root,
            media_library::scan_media_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running Karaoke Webview");
}
