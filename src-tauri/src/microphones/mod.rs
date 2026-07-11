mod discovery;
mod models;

#[cfg(test)]
mod tests;

#[cfg(target_os = "windows")]
pub(crate) mod windows;

pub(crate) use models::DiscoveredMicrophoneSource;

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
pub(crate) fn discover_local_microphone_sources() -> Result<Vec<DiscoveredMicrophoneSource>, String>
{
    discovery::discover_local_sources().map_err(|error| error.to_string())
}
