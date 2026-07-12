mod channel_registry;
mod discovery;
mod models;

#[cfg(test)]
mod tests;

#[cfg(target_os = "windows")]
pub(crate) mod windows;

pub(crate) use channel_registry::MicrophoneChannelRegistry;
pub(crate) use models::DiscoveredMicrophoneSource;
use models::MicrophoneChannel;

pub(crate) fn is_local_microphone_available(source_id: &str) -> Result<bool, String> {
    discovery::discover_local_sources()
        .map(|sources| {
            sources.iter().any(|source| {
                source.id == source_id
                    && source.availability == models::MicrophoneSourceAvailability::Available
            })
        })
        .map_err(|error| error.to_string())
}

#[cfg(test)]
pub(crate) fn first_available_local_source_id() -> Result<Option<String>, String> {
    discovery::discover_local_sources()
        .map(|sources| {
            sources
                .into_iter()
                .find(|source| {
                    source.availability == models::MicrophoneSourceAvailability::Available
                })
                .map(|source| source.id)
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn discover_local_microphone_sources(
    registry: tauri::State<'_, MicrophoneChannelRegistry>,
) -> Result<Vec<DiscoveredMicrophoneSource>, String> {
    let sources = discovery::discover_local_sources().map_err(|error| error.to_string())?;
    registry.reconcile(&sources);
    Ok(sources)
}

#[tauri::command]
pub(crate) fn list_microphone_channels(
    registry: tauri::State<'_, MicrophoneChannelRegistry>,
) -> Vec<MicrophoneChannel> {
    registry.list()
}

#[tauri::command]
pub(crate) fn create_microphone_channel(
    source_id: String,
    registry: tauri::State<'_, MicrophoneChannelRegistry>,
) -> Result<MicrophoneChannel, String> {
    let sources = discovery::discover_local_sources().map_err(|error| error.to_string())?;
    registry.create(&source_id, &sources)
}

#[tauri::command]
pub(crate) fn remove_microphone_channel(
    channel_id: String,
    registry: tauri::State<'_, MicrophoneChannelRegistry>,
) -> Result<(), String> {
    registry.remove(&channel_id)
}

#[tauri::command]
pub(crate) fn replace_microphone_channel_source(
    channel_id: String,
    source_id: String,
    registry: tauri::State<'_, MicrophoneChannelRegistry>,
) -> Result<MicrophoneChannel, String> {
    let sources = discovery::discover_local_sources().map_err(|error| error.to_string())?;
    registry.replace_source(&channel_id, &source_id, &sources)
}
