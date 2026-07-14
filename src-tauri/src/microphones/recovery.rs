use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};

use super::models::{
    DiscoveredMicrophoneSource, MicrophoneChannel, MicrophoneChannelState, MicrophoneRecoveryState,
    MicrophoneRecoveryStatus, MicrophoneSourceAvailability, MicrophoneSourcePresence,
};

#[derive(Default)]
struct RecoveryInner {
    leave_assigned_channels: HashSet<String>,
    states: Vec<MicrophoneRecoveryState>,
}

#[derive(Default)]
pub(crate) struct MicrophoneRecoveryRegistry {
    inner: Mutex<RecoveryInner>,
}

impl MicrophoneRecoveryRegistry {
    pub(crate) fn list(&self) -> Vec<MicrophoneRecoveryState> {
        lock(&self.inner).states.clone()
    }

    pub(crate) fn get(&self, channel_id: &str) -> Option<MicrophoneRecoveryState> {
        lock(&self.inner)
            .states
            .iter()
            .find(|state| state.channel_id == channel_id)
            .cloned()
    }

    pub(crate) fn reconcile(
        &self,
        sources: &[DiscoveredMicrophoneSource],
        channels: &[MicrophoneChannel],
    ) {
        let channel_ids = channels
            .iter()
            .map(|channel| channel.id.as_str())
            .collect::<HashSet<_>>();
        let claimed_source_ids = channels
            .iter()
            .map(|channel| channel.source_id.as_str())
            .collect::<HashSet<_>>();
        let mut inner = lock(&self.inner);
        inner
            .leave_assigned_channels
            .retain(|channel_id| channel_ids.contains(channel_id.as_str()));
        let leave_assigned_channels = inner.leave_assigned_channels.clone();
        let previous_states = inner
            .states
            .iter()
            .map(|state| (state.channel_id.as_str(), state))
            .collect::<HashMap<_, _>>();
        let next_states = channels
            .iter()
            .map(|channel| {
                let source_presence = source_presence(channel, sources);
                if channel.state == MicrophoneChannelState::Available {
                    return healthy_state(channel, source_presence);
                }

                let eligible_replacements = eligible_replacements(sources, &claimed_source_ids);
                let leave_assigned = leave_assigned_channels.contains(&channel.id);
                let mut state = disconnected_state(
                    channel,
                    source_presence,
                    eligible_replacements,
                    leave_assigned,
                );
                if let Some(previous) = previous_states.get(channel.id.as_str()) {
                    if previous.status == MicrophoneRecoveryStatus::RecoveryFailed
                        && previous.source_presence == state.source_presence
                    {
                        state.status = MicrophoneRecoveryStatus::RecoveryFailed;
                        state.reason = previous.reason.clone();
                    }
                }
                state
            })
            .collect::<Vec<_>>();
        for state in &next_states {
            if state.status == MicrophoneRecoveryStatus::Healthy {
                inner.leave_assigned_channels.remove(&state.channel_id);
            }
        }
        inner.states = next_states;
    }

    pub(crate) fn mark_recovering(&self, channel_id: &str) -> Result<(), String> {
        let mut inner = lock(&self.inner);
        let Some(state) = inner
            .states
            .iter_mut()
            .find(|state| state.channel_id == channel_id)
        else {
            return Err("The microphone recovery state no longer exists.".to_string());
        };
        state.status = MicrophoneRecoveryStatus::Recovering;
        state.reason = "Checking the original microphone source.".to_string();
        Ok(())
    }

    pub(crate) fn mark_retry_failed(
        &self,
        channel_id: &str,
    ) -> Result<MicrophoneRecoveryState, String> {
        let mut inner = lock(&self.inner);
        let Some(state) = inner
            .states
            .iter_mut()
            .find(|state| state.channel_id == channel_id)
        else {
            return Err("The microphone recovery state no longer exists.".to_string());
        };
        if state.status != MicrophoneRecoveryStatus::Healthy {
            state.status = MicrophoneRecoveryStatus::RecoveryFailed;
            state.reason = "The original microphone source is still unavailable.".to_string();
        }
        Ok(state.clone())
    }

    pub(crate) fn mark_discovery_failed(
        &self,
        channel_id: &str,
    ) -> Result<MicrophoneRecoveryState, String> {
        let mut inner = lock(&self.inner);
        let Some(state) = inner
            .states
            .iter_mut()
            .find(|state| state.channel_id == channel_id)
        else {
            return Err("The microphone recovery state no longer exists.".to_string());
        };
        state.status = MicrophoneRecoveryStatus::RecoveryFailed;
        state.reason = "Microphone discovery failed while retrying the source.".to_string();
        Ok(state.clone())
    }

    pub(crate) fn leave_assigned(
        &self,
        channel_id: &str,
    ) -> Result<MicrophoneRecoveryState, String> {
        let mut inner = lock(&self.inner);
        let Some(index) = inner
            .states
            .iter()
            .position(|state| state.channel_id == channel_id)
        else {
            return Err("The microphone recovery state no longer exists.".to_string());
        };
        if inner.states[index].status == MicrophoneRecoveryStatus::Healthy {
            return Err("This microphone channel is already healthy.".to_string());
        }
        inner.leave_assigned_channels.insert(channel_id.to_string());
        let state = &mut inner.states[index];
        state.status = MicrophoneRecoveryStatus::Disconnected;
        state.reason = "Left assigned while the operator decides how to recover it.".to_string();
        Ok(state.clone())
    }

    pub(crate) fn clear_channel(&self, channel_id: &str) {
        let mut inner = lock(&self.inner);
        inner.leave_assigned_channels.remove(channel_id);
        inner.states.retain(|state| state.channel_id != channel_id);
    }
}

fn source_presence(
    channel: &MicrophoneChannel,
    sources: &[DiscoveredMicrophoneSource],
) -> MicrophoneSourcePresence {
    match sources.iter().find(|source| source.id == channel.source_id) {
        Some(source) if source.availability == MicrophoneSourceAvailability::Available => {
            MicrophoneSourcePresence::Available
        }
        Some(_) => MicrophoneSourcePresence::Unavailable,
        None => MicrophoneSourcePresence::Missing,
    }
}

fn eligible_replacements(
    sources: &[DiscoveredMicrophoneSource],
    claimed_source_ids: &HashSet<&str>,
) -> Vec<String> {
    let mut eligible = sources
        .iter()
        .filter(|source| {
            source.availability == MicrophoneSourceAvailability::Available
                && !claimed_source_ids.contains(source.id.as_str())
        })
        .map(|source| source.id.clone())
        .collect::<Vec<_>>();
    eligible.sort();
    eligible
}

fn healthy_state(
    channel: &MicrophoneChannel,
    source_presence: MicrophoneSourcePresence,
) -> MicrophoneRecoveryState {
    MicrophoneRecoveryState {
        channel_id: channel.id.clone(),
        status: MicrophoneRecoveryStatus::Healthy,
        source_presence,
        reason: "The original microphone source is available.".to_string(),
        eligible_replacement_source_ids: Vec::new(),
        automatic_replacement_eligible: false,
    }
}

fn disconnected_state(
    channel: &MicrophoneChannel,
    source_presence: MicrophoneSourcePresence,
    eligible_replacement_source_ids: Vec<String>,
    leave_assigned: bool,
) -> MicrophoneRecoveryState {
    let automatic_replacement_eligible = eligible_replacement_source_ids.len() == 1;
    let (status, reason) = if leave_assigned {
        (
            MicrophoneRecoveryStatus::Disconnected,
            "Left assigned while the operator decides how to recover it.".to_string(),
        )
    } else if eligible_replacement_source_ids.is_empty() {
        (
            MicrophoneRecoveryStatus::Disconnected,
            source_loss_reason(&source_presence),
        )
    } else {
        (
            MicrophoneRecoveryStatus::ReplacementAvailable,
            if automatic_replacement_eligible {
                "One eligible replacement source is available; operator confirmation is required."
                    .to_string()
            } else {
                "Multiple replacement sources are available; choose one explicitly.".to_string()
            },
        )
    };

    MicrophoneRecoveryState {
        channel_id: channel.id.clone(),
        status,
        source_presence,
        reason,
        eligible_replacement_source_ids,
        automatic_replacement_eligible,
    }
}

fn source_loss_reason(source_presence: &MicrophoneSourcePresence) -> String {
    match source_presence {
        MicrophoneSourcePresence::Unavailable => {
            "The original microphone source is present but unavailable.".to_string()
        }
        MicrophoneSourcePresence::Missing => {
            "The original microphone source is no longer discovered.".to_string()
        }
        MicrophoneSourcePresence::Available => {
            "The microphone channel is disconnected.".to_string()
        }
    }
}

fn lock(inner: &Mutex<RecoveryInner>) -> std::sync::MutexGuard<'_, RecoveryInner> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::microphones::{
        assignment_registry::MicrophoneAssignmentRegistry,
        channel_registry::MicrophoneChannelRegistry,
        models::{MicrophoneAssignmentMethod, MicrophoneSourceKind},
    };

    fn source(id: &str, availability: MicrophoneSourceAvailability) -> DiscoveredMicrophoneSource {
        DiscoveredMicrophoneSource {
            id: id.to_string(),
            display_name: format!("Source {id}"),
            kind: MicrophoneSourceKind::WindowsDevice,
            availability,
            is_default: false,
        }
    }

    fn assigned_channel() -> (
        MicrophoneChannelRegistry,
        MicrophoneAssignmentRegistry,
        MicrophoneChannel,
        Vec<DiscoveredMicrophoneSource>,
    ) {
        let channels = MicrophoneChannelRegistry::default();
        let assignments = MicrophoneAssignmentRegistry::default();
        let sources = vec![source(
            "windows-mic-a",
            MicrophoneSourceAvailability::Available,
        )];
        let channel = channels.create("windows-mic-a", &sources).unwrap();
        assignments.assign(&channel.id, "singer-1").unwrap();
        (channels, assignments, channel, sources)
    }

    #[test]
    fn unavailable_and_missing_sources_preserve_channel_and_assignment() {
        let (channels, assignments, channel, _) = assigned_channel();
        let recovery = MicrophoneRecoveryRegistry::default();

        let unavailable = [source(
            "windows-mic-a",
            MicrophoneSourceAvailability::Unavailable,
        )];
        channels.reconcile(&unavailable);
        recovery.reconcile(&unavailable, &channels.list());
        let unavailable_state = recovery.get(&channel.id).unwrap();
        assert_eq!(
            unavailable_state.source_presence,
            MicrophoneSourcePresence::Unavailable
        );
        assert_eq!(
            unavailable_state.status,
            MicrophoneRecoveryStatus::Disconnected
        );

        channels.reconcile(&[]);
        recovery.reconcile(&[], &channels.list());
        let missing_state = recovery.get(&channel.id).unwrap();
        assert_eq!(
            missing_state.source_presence,
            MicrophoneSourcePresence::Missing
        );
        assert_eq!(
            channels.get(&channel.id).unwrap().state,
            MicrophoneChannelState::Disconnected
        );
        assert_eq!(assignments.list()[0].channel_id, channel.id);
        assert_eq!(
            assignments.list()[0].method,
            MicrophoneAssignmentMethod::Manual
        );
    }

    #[test]
    fn original_source_return_restores_the_same_channel() {
        let (channels, assignments, channel, sources) = assigned_channel();
        let recovery = MicrophoneRecoveryRegistry::default();
        channels.reconcile(&[]);
        recovery.reconcile(&[], &channels.list());

        channels.reconcile(&sources);
        recovery.reconcile(&sources, &channels.list());

        assert_eq!(
            recovery.get(&channel.id).unwrap().status,
            MicrophoneRecoveryStatus::Healthy
        );
        assert_eq!(
            channels.get(&channel.id).unwrap().source_id,
            "windows-mic-a"
        );
        assert_eq!(assignments.list()[0].channel_id, channel.id);
    }

    #[test]
    fn replacement_eligibility_is_deterministic_and_never_steals_claimed_sources() {
        let (channels, _, channel, _) = assigned_channel();
        let recovery = MicrophoneRecoveryRegistry::default();
        let sources = [
            source("windows-mic-b", MicrophoneSourceAvailability::Available),
            source("windows-mic-c", MicrophoneSourceAvailability::Available),
        ];
        channels.reconcile(&sources);
        recovery.reconcile(&sources, &channels.list());
        let multiple = recovery.get(&channel.id).unwrap();
        assert_eq!(
            multiple.status,
            MicrophoneRecoveryStatus::ReplacementAvailable
        );
        assert_eq!(
            multiple.eligible_replacement_source_ids,
            vec!["windows-mic-b", "windows-mic-c"]
        );
        assert!(!multiple.automatic_replacement_eligible);

        let claimed = channels.create("windows-mic-b", &sources).unwrap();
        recovery.reconcile(&sources, &channels.list());
        let one = recovery.get(&channel.id).unwrap();
        assert_eq!(one.eligible_replacement_source_ids, vec!["windows-mic-c"]);
        assert!(one.automatic_replacement_eligible);
        assert_eq!(
            channels.get(&claimed.id).unwrap().source_id,
            "windows-mic-b"
        );
    }

    #[test]
    fn explicit_replacement_preserves_channel_and_assignment_identity() {
        let (channels, assignments, channel, _) = assigned_channel();
        let recovery = MicrophoneRecoveryRegistry::default();
        let sources = [source(
            "windows-mic-b",
            MicrophoneSourceAvailability::Available,
        )];
        channels.reconcile(&sources);
        recovery.reconcile(&sources, &channels.list());

        let replaced = channels
            .replace_source(&channel.id, "windows-mic-b", &sources)
            .unwrap();
        recovery.reconcile(&sources, &channels.list());

        assert_eq!(replaced.id, channel.id);
        assert_eq!(assignments.list()[0].channel_id, channel.id);
        assert_eq!(
            recovery.get(&channel.id).unwrap().status,
            MicrophoneRecoveryStatus::Healthy
        );
    }

    #[test]
    fn leave_assigned_and_failed_retry_are_idempotent() {
        let (channels, assignments, channel, _) = assigned_channel();
        let recovery = MicrophoneRecoveryRegistry::default();
        channels.reconcile(&[]);
        recovery.reconcile(&[], &channels.list());

        let held = recovery.leave_assigned(&channel.id).unwrap();
        let held_again = recovery.leave_assigned(&channel.id).unwrap();
        assert_eq!(held, held_again);
        recovery.mark_recovering(&channel.id).unwrap();
        let failed = recovery.mark_retry_failed(&channel.id).unwrap();
        let failed_again = recovery.mark_retry_failed(&channel.id).unwrap();
        assert_eq!(failed, failed_again);
        assert_eq!(assignments.list()[0].channel_id, channel.id);
    }

    #[test]
    fn diagnostic_channels_never_receive_recovery_state() {
        let recovery = MicrophoneRecoveryRegistry::default();
        recovery.reconcile(&[], &[]);

        assert!(recovery.get("diagnostic-channel-windows-mic-a").is_none());
    }
}
