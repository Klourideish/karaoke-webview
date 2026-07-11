mod media_library;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            media_library::clear_library_index,
            media_library::load_library_index,
            media_library::load_library_settings,
            media_library::resolve_audio_source,
            media_library::save_library_index,
            media_library::save_library_root,
            media_library::scan_media_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running Karaoke Webview");
}
