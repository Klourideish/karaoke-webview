mod discovery;
mod models;

#[cfg(test)]
mod tests;

#[cfg(target_os = "windows")]
mod windows;

pub(crate) use models::DiscoveredMicrophoneSource;

#[tauri::command]
pub(crate) fn discover_local_microphone_sources() -> Result<Vec<DiscoveredMicrophoneSource>, String>
{
    discovery::discover_local_sources().map_err(|error| error.to_string())
}
