use std::collections::HashSet;

use super::{
    assignment_registry::MicrophoneAssignmentRegistry,
    channel_registry::MicrophoneChannelRegistry,
    models::{
        AutomaticAssignmentResult, AutomaticAssignmentStatus, DiscoveredMicrophoneSource,
        MicrophoneAssignment, MicrophoneChannel, MicrophoneChannelState,
        MicrophoneSourceAvailability,
    },
};

pub(crate) fn auto_assign(
    singer_id: &str,
    sources: &[DiscoveredMicrophoneSource],
    channels: &MicrophoneChannelRegistry,
    assignments: &MicrophoneAssignmentRegistry,
) -> Result<AutomaticAssignmentResult, String> {
    if let Some(existing) = assignments.assignment_for_singer(singer_id) {
        return Ok(assigned(existing));
    }

    let all_channels = channels.list();
    let assigned_channel_ids = assignments
        .list()
        .into_iter()
        .map(|assignment| assignment.channel_id)
        .collect::<HashSet<_>>();
    let preferred_source = assignments.preferred_source_for_singer(singer_id);

    if let Some(source_id) = preferred_source.as_deref() {
        if let Some(channel) = healthy_unassigned_channels(&all_channels, &assigned_channel_ids)
            .find(|channel| channel.source_id == source_id)
        {
            return assign_channel(singer_id, channel, channels, assignments);
        }
        if let Some(source) = available_unclaimed_sources(sources, &all_channels)
            .find(|source| source.id == source_id)
        {
            let channel = channels.create(&source.id, sources)?;
            return assign_channel(singer_id, &channel, channels, assignments);
        }
    }

    if let Some(channel) = healthy_unassigned_channels(&all_channels, &assigned_channel_ids).next()
    {
        return assign_channel(singer_id, channel, channels, assignments);
    }

    if let Some(source) = available_unclaimed_sources(sources, &all_channels).next() {
        let channel = channels.create(&source.id, sources)?;
        return assign_channel(singer_id, &channel, channels, assignments);
    }

    let waiting_state = assignments.mark_waiting(singer_id);
    Ok(AutomaticAssignmentResult {
        status: AutomaticAssignmentStatus::Waiting,
        assignment: None,
        waiting_state: Some(waiting_state),
    })
}

fn healthy_unassigned_channels<'a>(
    channels: &'a [MicrophoneChannel],
    assigned_channel_ids: &'a HashSet<String>,
) -> impl Iterator<Item = &'a MicrophoneChannel> {
    let mut eligible = channels
        .iter()
        .filter(|channel| {
            channel.state == MicrophoneChannelState::Available
                && !assigned_channel_ids.contains(&channel.id)
        })
        .collect::<Vec<_>>();
    eligible.sort_by(|left, right| left.id.cmp(&right.id));
    eligible.into_iter()
}

fn available_unclaimed_sources<'a>(
    sources: &'a [DiscoveredMicrophoneSource],
    channels: &[MicrophoneChannel],
) -> impl Iterator<Item = &'a DiscoveredMicrophoneSource> {
    let claimed_source_ids = channels
        .iter()
        .map(|channel| channel.source_id.as_str())
        .collect::<HashSet<_>>();
    let mut eligible = sources
        .iter()
        .filter(|source| {
            source.availability == MicrophoneSourceAvailability::Available
                && !claimed_source_ids.contains(source.id.as_str())
        })
        .collect::<Vec<_>>();
    eligible.sort_by(|left, right| left.id.cmp(&right.id));
    eligible.into_iter()
}

fn assign_channel(
    singer_id: &str,
    channel: &MicrophoneChannel,
    channels: &MicrophoneChannelRegistry,
    assignments: &MicrophoneAssignmentRegistry,
) -> Result<AutomaticAssignmentResult, String> {
    if !channels.contains(&channel.id) {
        return Err("The selected persistent microphone channel no longer exists.".to_string());
    }
    let assignment = assignments.assign_automatically(&channel.id, singer_id)?;
    assignments.record_successful_source(singer_id, &channel.source_id);
    Ok(assigned(assignment))
}

fn assigned(assignment: MicrophoneAssignment) -> AutomaticAssignmentResult {
    AutomaticAssignmentResult {
        status: AutomaticAssignmentStatus::Assigned,
        assignment: Some(assignment),
        waiting_state: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::microphones::models::{MicrophoneAssignmentMethod, MicrophoneSourceKind};

    fn source(id: &str) -> DiscoveredMicrophoneSource {
        DiscoveredMicrophoneSource {
            id: id.to_string(),
            display_name: format!("Source {id}"),
            kind: MicrophoneSourceKind::WindowsDevice,
            availability: MicrophoneSourceAvailability::Available,
            is_default: false,
        }
    }

    fn registries() -> (MicrophoneChannelRegistry, MicrophoneAssignmentRegistry) {
        let channels = MicrophoneChannelRegistry::default();
        let assignments = MicrophoneAssignmentRegistry::default();
        (channels, assignments)
    }

    #[test]
    fn healthy_existing_and_manual_assignments_are_preserved() {
        let (channels, assignments) = registries();
        let sources = [source("windows-mic-a")];
        let channel = channels.create("windows-mic-a", &sources).unwrap();
        let manual = assignments.assign(&channel.id, "singer-1").unwrap();

        let result = auto_assign("singer-1", &sources, &channels, &assignments).unwrap();

        assert_eq!(result.assignment, Some(manual));
        assert_eq!(
            assignments.list()[0].method,
            MicrophoneAssignmentMethod::Manual
        );
        assert_eq!(channels.list().len(), 1);
    }

    #[test]
    fn previous_source_is_preferred() {
        let (channels, assignments) = registries();
        let sources = [source("windows-mic-a"), source("windows-mic-b")];
        let preferred = channels.create("windows-mic-b", &sources).unwrap();
        channels.create("windows-mic-a", &sources).unwrap();
        assignments.record_successful_source("singer-1", "windows-mic-b");

        let result = auto_assign("singer-1", &sources, &channels, &assignments).unwrap();

        assert_eq!(result.assignment.unwrap().channel_id, preferred.id);
    }

    #[test]
    fn existing_channel_is_used_before_creating_another() {
        let (channels, assignments) = registries();
        let sources = [source("windows-mic-a"), source("windows-mic-b")];
        let existing = channels.create("windows-mic-b", &sources).unwrap();

        let result = auto_assign("singer-1", &sources, &channels, &assignments).unwrap();

        assert_eq!(result.assignment.unwrap().channel_id, existing.id);
        assert_eq!(channels.list().len(), 1);
    }

    #[test]
    fn available_source_creates_a_channel_deterministically() {
        let (channels, assignments) = registries();
        let sources = [source("windows-mic-z"), source("windows-mic-a")];

        let result = auto_assign("singer-1", &sources, &channels, &assignments).unwrap();

        let assignment = result.assignment.unwrap();
        assert_eq!(
            channels.get(&assignment.channel_id).unwrap().source_id,
            "windows-mic-a"
        );
    }

    #[test]
    fn assigned_channels_are_not_stolen() {
        let (channels, assignments) = registries();
        let sources = [source("windows-mic-a")];
        let channel = channels.create("windows-mic-a", &sources).unwrap();
        assignments.assign(&channel.id, "singer-1").unwrap();

        let result = auto_assign("singer-2", &sources, &channels, &assignments).unwrap();

        assert_eq!(result.status, AutomaticAssignmentStatus::Waiting);
        assert_eq!(assignments.list()[0].singer_id, "singer-1");
    }

    #[test]
    fn duplicate_requests_are_idempotent() {
        let (channels, assignments) = registries();
        let sources = [source("windows-mic-a")];

        let first = auto_assign("singer-1", &sources, &channels, &assignments).unwrap();
        let second = auto_assign("singer-1", &sources, &channels, &assignments).unwrap();

        assert_eq!(first.assignment, second.assignment);
        assert_eq!(channels.list().len(), 1);
        assert_eq!(assignments.list().len(), 1);
    }

    #[test]
    fn waiting_is_explicit_preserved_and_cleared_after_success() {
        let (channels, assignments) = registries();

        let waiting = auto_assign("singer-1", &[], &channels, &assignments).unwrap();
        let repeated = auto_assign("singer-1", &[], &channels, &assignments).unwrap();
        assert_eq!(waiting.waiting_state, repeated.waiting_state);

        let sources = [source("windows-mic-a")];
        let assigned = auto_assign("singer-1", &sources, &channels, &assignments).unwrap();
        assert_eq!(assigned.status, AutomaticAssignmentStatus::Assigned);
        assert!(assignments.list_waiting().is_empty());
    }

    #[test]
    fn diagnostic_channels_are_never_candidates() {
        let (channels, assignments) = registries();
        let result = auto_assign("singer-1", &[], &channels, &assignments).unwrap();

        assert_eq!(result.status, AutomaticAssignmentStatus::Waiting);
        assert!(assignments
            .list()
            .iter()
            .all(|assignment| !assignment.channel_id.starts_with("diagnostic-channel-")));
    }
}
