use std::{collections::HashMap, sync::Mutex};

use super::models::{
    DiscoveredMicrophoneSource, MicrophoneChannel, MicrophoneChannelState,
    MicrophoneSourceAvailability,
};

#[derive(Default)]
struct RegistryInner {
    channels: Vec<MicrophoneChannel>,
    next_channel_number: u64,
}

#[derive(Default)]
pub(crate) struct MicrophoneChannelRegistry {
    inner: Mutex<RegistryInner>,
}

impl MicrophoneChannelRegistry {
    pub(crate) fn list(&self) -> Vec<MicrophoneChannel> {
        lock(&self.inner).channels.clone()
    }

    pub(crate) fn contains(&self, channel_id: &str) -> bool {
        lock(&self.inner)
            .channels
            .iter()
            .any(|channel| channel.id == channel_id)
    }

    pub(crate) fn get(&self, channel_id: &str) -> Option<MicrophoneChannel> {
        lock(&self.inner)
            .channels
            .iter()
            .find(|channel| channel.id == channel_id)
            .cloned()
    }

    pub(crate) fn create(
        &self,
        source_id: &str,
        sources: &[DiscoveredMicrophoneSource],
    ) -> Result<MicrophoneChannel, String> {
        let source = available_source(source_id, sources)?;
        let mut inner = lock(&self.inner);
        if inner
            .channels
            .iter()
            .any(|channel| channel.source_id == source_id)
        {
            return Err("This microphone source already backs a channel.".to_string());
        }

        inner.next_channel_number += 1;
        let channel = MicrophoneChannel {
            id: format!("microphone-channel-{}", inner.next_channel_number),
            source_id: source.id.clone(),
            source_display_name: source.display_name.clone(),
            state: MicrophoneChannelState::Available,
        };
        inner.channels.push(channel.clone());
        Ok(channel)
    }

    pub(crate) fn remove(&self, channel_id: &str) -> Result<(), String> {
        let mut inner = lock(&self.inner);
        let Some(index) = inner
            .channels
            .iter()
            .position(|channel| channel.id == channel_id)
        else {
            return Err("The microphone channel no longer exists.".to_string());
        };
        inner.channels.remove(index);
        Ok(())
    }

    pub(crate) fn replace_source(
        &self,
        channel_id: &str,
        source_id: &str,
        sources: &[DiscoveredMicrophoneSource],
    ) -> Result<MicrophoneChannel, String> {
        let source = available_source(source_id, sources)?;
        let mut inner = lock(&self.inner);
        if inner
            .channels
            .iter()
            .any(|channel| channel.id != channel_id && channel.source_id == source_id)
        {
            return Err("This microphone source already backs a channel.".to_string());
        }
        let Some(channel) = inner
            .channels
            .iter_mut()
            .find(|channel| channel.id == channel_id)
        else {
            return Err("The microphone channel no longer exists.".to_string());
        };

        channel.source_id = source.id.clone();
        channel.source_display_name = source.display_name.clone();
        channel.state = MicrophoneChannelState::Available;
        Ok(channel.clone())
    }

    pub(crate) fn reconcile(&self, sources: &[DiscoveredMicrophoneSource]) {
        let source_by_id = sources
            .iter()
            .map(|source| (source.id.as_str(), source))
            .collect::<HashMap<_, _>>();
        let mut inner = lock(&self.inner);
        for channel in &mut inner.channels {
            match source_by_id.get(channel.source_id.as_str()) {
                Some(source) => {
                    channel.source_display_name = source.display_name.clone();
                    channel.state =
                        if source.availability == MicrophoneSourceAvailability::Available {
                            MicrophoneChannelState::Available
                        } else {
                            MicrophoneChannelState::Disconnected
                        };
                }
                None => channel.state = MicrophoneChannelState::Disconnected,
            }
        }
    }
}

fn available_source<'a>(
    source_id: &str,
    sources: &'a [DiscoveredMicrophoneSource],
) -> Result<&'a DiscoveredMicrophoneSource, String> {
    sources
        .iter()
        .find(|source| {
            source.id == source_id && source.availability == MicrophoneSourceAvailability::Available
        })
        .ok_or_else(|| "The selected microphone source is not available.".to_string())
}

fn lock(inner: &Mutex<RegistryInner>) -> std::sync::MutexGuard<'_, RegistryInner> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::microphones::models::MicrophoneSourceKind;

    fn source(id: &str, availability: MicrophoneSourceAvailability) -> DiscoveredMicrophoneSource {
        DiscoveredMicrophoneSource {
            id: id.to_string(),
            display_name: format!("Source {id}"),
            kind: MicrophoneSourceKind::WindowsDevice,
            availability,
            is_default: false,
        }
    }

    #[test]
    fn channels_are_created_only_on_demand_with_host_owned_ids() {
        let registry = MicrophoneChannelRegistry::default();
        let sources = [source(
            "windows-mic-a",
            MicrophoneSourceAvailability::Available,
        )];

        registry.reconcile(&sources);
        assert!(registry.list().is_empty());

        let channel = registry.create("windows-mic-a", &sources).unwrap();
        assert_eq!(channel.id, "microphone-channel-1");
        assert!(!channel.id.contains("windows-mic-a"));
    }

    #[test]
    fn one_source_cannot_back_two_channels() {
        let registry = MicrophoneChannelRegistry::default();
        let sources = [source(
            "windows-mic-a",
            MicrophoneSourceAvailability::Available,
        )];
        registry.create("windows-mic-a", &sources).unwrap();

        assert_eq!(
            registry.create("windows-mic-a", &sources).unwrap_err(),
            "This microphone source already backs a channel."
        );
    }

    #[test]
    fn distinct_sources_create_distinct_channels() {
        let registry = MicrophoneChannelRegistry::default();
        let sources = [
            source("windows-mic-a", MicrophoneSourceAvailability::Available),
            source("windows-mic-b", MicrophoneSourceAvailability::Available),
        ];

        let first = registry.create("windows-mic-a", &sources).unwrap();
        let second = registry.create("windows-mic-b", &sources).unwrap();

        assert_ne!(first.id, second.id);
        assert_ne!(first.source_id, second.source_id);
    }

    #[test]
    fn reconciliation_preserves_channel_identity_through_disconnect_and_recovery() {
        let registry = MicrophoneChannelRegistry::default();
        let available = [source(
            "windows-mic-a",
            MicrophoneSourceAvailability::Available,
        )];
        let original = registry.create("windows-mic-a", &available).unwrap();

        registry.reconcile(&[]);
        let disconnected = registry.list().remove(0);
        assert_eq!(disconnected.id, original.id);
        assert_eq!(disconnected.state, MicrophoneChannelState::Disconnected);

        registry.reconcile(&available);
        let recovered = registry.list().remove(0);
        assert_eq!(recovered.id, original.id);
        assert_eq!(recovered.state, MicrophoneChannelState::Available);
    }

    #[test]
    fn unavailable_source_preserves_disconnected_channel() {
        let registry = MicrophoneChannelRegistry::default();
        let available = [source(
            "windows-mic-a",
            MicrophoneSourceAvailability::Available,
        )];
        let channel = registry.create("windows-mic-a", &available).unwrap();

        registry.reconcile(&[source(
            "windows-mic-a",
            MicrophoneSourceAvailability::Unavailable,
        )]);

        let reconciled = registry.list().remove(0);
        assert_eq!(reconciled.id, channel.id);
        assert_eq!(reconciled.state, MicrophoneChannelState::Disconnected);
    }

    #[test]
    fn source_replacement_preserves_channel_identity() {
        let registry = MicrophoneChannelRegistry::default();
        let sources = [
            source("windows-mic-a", MicrophoneSourceAvailability::Available),
            source("windows-mic-b", MicrophoneSourceAvailability::Available),
        ];
        let original = registry.create("windows-mic-a", &sources).unwrap();

        let replaced = registry
            .replace_source(&original.id, "windows-mic-b", &sources)
            .unwrap();

        assert_eq!(replaced.id, original.id);
        assert_eq!(replaced.source_id, "windows-mic-b");
    }

    #[test]
    fn removal_and_invalid_commands_are_explicit() {
        let registry = MicrophoneChannelRegistry::default();
        let sources = [source(
            "windows-mic-a",
            MicrophoneSourceAvailability::Available,
        )];
        let channel = registry.create("windows-mic-a", &sources).unwrap();

        registry.remove(&channel.id).unwrap();
        assert!(registry.list().is_empty());
        assert_eq!(
            registry.remove(&channel.id).unwrap_err(),
            "The microphone channel no longer exists."
        );
        assert_eq!(
            registry.create("missing", &sources).unwrap_err(),
            "The selected microphone source is not available."
        );
    }
}
