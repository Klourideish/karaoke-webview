use super::models::{
    DiscoveredMicrophoneSource, MicrophoneSourceAvailability, MicrophoneSourceKind,
};

#[cfg(target_os = "windows")]
use super::windows;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlatformMicrophoneSource {
    pub platform_id: String,
    pub display_name: String,
    pub available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlatformDiscovery {
    pub sources: Vec<PlatformMicrophoneSource>,
    pub default_platform_id: Option<String>,
}

pub(crate) fn discover_local_sources() -> Result<Vec<DiscoveredMicrophoneSource>, DiscoveryError> {
    discover_sources_with(platform_discovery)
}

pub(crate) fn discover_sources_with(
    discover: impl FnOnce() -> Result<PlatformDiscovery, DiscoveryError>,
) -> Result<Vec<DiscoveredMicrophoneSource>, DiscoveryError> {
    let snapshot = discover()?;
    Ok(map_platform_sources(snapshot))
}

pub(crate) fn map_platform_sources(snapshot: PlatformDiscovery) -> Vec<DiscoveredMicrophoneSource> {
    let default_platform_id = snapshot.default_platform_id.as_deref();
    let mut sources = snapshot
        .sources
        .into_iter()
        .map(|source| DiscoveredMicrophoneSource {
            id: stable_source_id(&source.platform_id),
            display_name: source.display_name,
            kind: MicrophoneSourceKind::WindowsDevice,
            availability: if source.available {
                MicrophoneSourceAvailability::Available
            } else {
                MicrophoneSourceAvailability::Unavailable
            },
            is_default: default_platform_id == Some(source.platform_id.as_str()),
        })
        .collect::<Vec<_>>();

    sources.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    sources
}

pub(crate) fn stable_source_id(platform_id: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in platform_id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("windows-mic-{hash:016x}")
}

#[cfg(target_os = "windows")]
fn platform_discovery() -> Result<PlatformDiscovery, DiscoveryError> {
    windows::discover_windows_microphones()
}

#[cfg(not(target_os = "windows"))]
fn platform_discovery() -> Result<PlatformDiscovery, DiscoveryError> {
    Err(DiscoveryError::message(
        "Local microphone discovery is available only on Windows.",
    ))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DiscoveryError {
    message: String,
}

impl DiscoveryError {
    pub(crate) fn platform(context: &'static str, source: impl std::fmt::Display) -> Self {
        eprintln!("{context} {source}");
        Self {
            message: "Could not discover local microphone inputs.".to_string(),
        }
    }

    pub(crate) fn message(message: &'static str) -> Self {
        Self {
            message: message.to_string(),
        }
    }
}

impl std::fmt::Display for DiscoveryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}
