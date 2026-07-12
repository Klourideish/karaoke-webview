use std::collections::HashSet;

use super::{
    assignment_registry::MicrophoneAssignmentRegistry,
    channel_registry::MicrophoneChannelRegistry,
    models::{
        DiscoveredMicrophoneSource, KaraokeMode, LockedPerformanceMicrophone, MicrophoneAssignment,
        MicrophoneChannel, MicrophoneChannelState, MicrophoneRecoveryState,
        MicrophoneRecoveryStatus, MicrophoneSourceAvailability, ParticipantMicrophoneReadiness,
        PerformanceMicrophoneReadiness, PerformanceMicrophoneReadinessReason,
        PerformanceMicrophoneReadinessRequest, PerformanceMicrophoneReadinessStatus,
        PerformanceReadinessPhase,
    },
    recovery::MicrophoneRecoveryRegistry,
};

pub(crate) fn evaluate(
    request: &PerformanceMicrophoneReadinessRequest,
    sources: &[DiscoveredMicrophoneSource],
    channels: &MicrophoneChannelRegistry,
    assignments: &MicrophoneAssignmentRegistry,
    recovery: &MicrophoneRecoveryRegistry,
    diagnostic_source_id: Option<&str>,
) -> Result<PerformanceMicrophoneReadiness, String> {
    channels.reconcile(sources);
    recovery.reconcile(sources, &channels.list());

    if request.allow_automatic_recovery && request.phase == PerformanceReadinessPhase::Preparing {
        recover_exactly_one_eligible_source(request, sources, channels, assignments, recovery)?;
        channels.reconcile(sources);
        recovery.reconcile(sources, &channels.list());
    }

    let participant_ids = normalized_participants(&request.participant_singer_ids);
    let mut participants = participant_ids
        .iter()
        .map(|singer_id| {
            evaluate_participant(
                singer_id,
                sources,
                channels,
                assignments,
                recovery,
                diagnostic_source_id,
            )
        })
        .collect::<Vec<_>>();

    apply_mode_policy(request.mode, &mut participants);
    let locked_participants = participants
        .iter()
        .filter(|participant| participant.status == PerformanceMicrophoneReadinessStatus::Ready)
        .filter_map(|participant| {
            let assignment = participant.assignment.as_ref()?;
            let channel = participant.channel.as_ref()?;
            Some(LockedPerformanceMicrophone {
                singer_id: assignment.singer_id.clone(),
                channel_id: channel.id.clone(),
                source_id: channel.source_id.clone(),
            })
        })
        .collect::<Vec<_>>();
    let status = aggregate_status(request.mode, &participants, &participant_ids);
    let message = readiness_message(status, request.mode, &participants, &participant_ids);

    Ok(PerformanceMicrophoneReadiness {
        status,
        mode: request.mode,
        participants,
        locked_participants,
        message,
    })
}

fn recover_exactly_one_eligible_source(
    request: &PerformanceMicrophoneReadinessRequest,
    sources: &[DiscoveredMicrophoneSource],
    channels: &MicrophoneChannelRegistry,
    assignments: &MicrophoneAssignmentRegistry,
    recovery: &MicrophoneRecoveryRegistry,
) -> Result<(), String> {
    let participant_ids = normalized_participants(&request.participant_singer_ids);
    for singer_id in participant_ids {
        let Some(assignment) = assignments.assignment_for_singer(&singer_id) else {
            continue;
        };
        let Some(channel) = channels.get(&assignment.channel_id) else {
            continue;
        };
        if channel.state != MicrophoneChannelState::Disconnected {
            continue;
        }
        let Some(state) = recovery.get(&channel.id) else {
            continue;
        };
        if state.status != MicrophoneRecoveryStatus::ReplacementAvailable
            || state.eligible_replacement_source_ids.len() != 1
        {
            continue;
        }
        channels.replace_source(
            &channel.id,
            state.eligible_replacement_source_ids[0].as_str(),
            sources,
        )?;
    }
    Ok(())
}

fn normalized_participants(participant_ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    participant_ids
        .iter()
        .filter_map(|singer_id| {
            let trimmed = singer_id.trim();
            if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect()
}

fn evaluate_participant(
    singer_id: &str,
    sources: &[DiscoveredMicrophoneSource],
    channels: &MicrophoneChannelRegistry,
    assignments: &MicrophoneAssignmentRegistry,
    recovery: &MicrophoneRecoveryRegistry,
    diagnostic_source_id: Option<&str>,
) -> ParticipantMicrophoneReadiness {
    if assignments
        .list_waiting()
        .iter()
        .any(|waiting| waiting.singer_id == singer_id)
    {
        return participant_blocked(
            singer_id,
            PerformanceMicrophoneReadinessReason::WaitingForMicrophone,
            "This singer is waiting for a microphone.",
            None,
            None,
            None,
            true,
        );
    }

    let Some(assignment) = assignments.assignment_for_singer(singer_id) else {
        return participant_blocked(
            singer_id,
            PerformanceMicrophoneReadinessReason::NoAssignment,
            "This singer does not have a microphone assignment.",
            None,
            None,
            None,
            true,
        );
    };

    let Some(channel) = channels.get(&assignment.channel_id) else {
        return participant_blocked(
            singer_id,
            PerformanceMicrophoneReadinessReason::ConflictingAssignment,
            "This singer's assigned microphone channel no longer exists.",
            Some(assignment),
            None,
            None,
            true,
        );
    };

    let recovery_state = recovery.get(&channel.id);
    if channel.state == MicrophoneChannelState::Disconnected {
        let reason = match recovery_state.as_ref().map(|state| &state.status) {
            Some(MicrophoneRecoveryStatus::ReplacementAvailable) => {
                PerformanceMicrophoneReadinessReason::RecoveryAvailable
            }
            Some(MicrophoneRecoveryStatus::RecoveryFailed) => {
                PerformanceMicrophoneReadinessReason::RecoveryFailed
            }
            _ => PerformanceMicrophoneReadinessReason::ChannelDisconnected,
        };
        let message = match reason {
            PerformanceMicrophoneReadinessReason::RecoveryAvailable => {
                "This microphone channel needs source recovery before countdown."
            }
            PerformanceMicrophoneReadinessReason::RecoveryFailed => {
                "Microphone source recovery failed for this channel."
            }
            _ => "This microphone channel is disconnected.",
        };
        return participant_blocked(
            singer_id,
            reason,
            message,
            Some(assignment),
            Some(channel),
            recovery_state,
            true,
        );
    }

    let source_available = sources.iter().any(|source| {
        source.id == channel.source_id
            && source.availability == MicrophoneSourceAvailability::Available
    });
    if !source_available {
        return participant_blocked(
            singer_id,
            PerformanceMicrophoneReadinessReason::SourceUnavailable,
            "The assigned microphone source is not available.",
            Some(assignment),
            Some(channel),
            recovery_state,
            true,
        );
    }

    if diagnostic_source_id == Some(channel.source_id.as_str()) {
        return participant_blocked(
            singer_id,
            PerformanceMicrophoneReadinessReason::DiagnosticSessionActive,
            "A diagnostic capture session is using this microphone source.",
            Some(assignment),
            Some(channel),
            recovery_state,
            false,
        );
    }

    ParticipantMicrophoneReadiness {
        singer_id: singer_id.to_string(),
        status: PerformanceMicrophoneReadinessStatus::Ready,
        reason: PerformanceMicrophoneReadinessReason::Ready,
        message: "Microphone path is ready for preparation.".to_string(),
        assignment: Some(assignment),
        channel: Some(channel),
        recovery: recovery_state,
        capture_available: true,
    }
}

fn participant_blocked(
    singer_id: &str,
    reason: PerformanceMicrophoneReadinessReason,
    message: &str,
    assignment: Option<MicrophoneAssignment>,
    channel: Option<MicrophoneChannel>,
    recovery: Option<MicrophoneRecoveryState>,
    capture_available: bool,
) -> ParticipantMicrophoneReadiness {
    ParticipantMicrophoneReadiness {
        singer_id: singer_id.to_string(),
        status: PerformanceMicrophoneReadinessStatus::Blocked,
        reason,
        message: message.to_string(),
        assignment,
        channel,
        recovery,
        capture_available,
    }
}

fn apply_mode_policy(mode: KaraokeMode, participants: &mut [ParticipantMicrophoneReadiness]) {
    if mode != KaraokeMode::Party {
        return;
    }

    for participant in participants {
        if participant.status == PerformanceMicrophoneReadinessStatus::Blocked {
            participant.status = PerformanceMicrophoneReadinessStatus::Degraded;
            participant.reason = PerformanceMicrophoneReadinessReason::ExcludedByPartyMode;
            participant.message =
                "This singer would be excluded from the locked Party participant set.".to_string();
        }
    }
}

fn aggregate_status(
    mode: KaraokeMode,
    participants: &[ParticipantMicrophoneReadiness],
    participant_ids: &[String],
) -> PerformanceMicrophoneReadinessStatus {
    if participant_ids.is_empty() {
        return PerformanceMicrophoneReadinessStatus::Blocked;
    }

    if mode == KaraokeMode::Standard && !(1..=2).contains(&participant_ids.len()) {
        return PerformanceMicrophoneReadinessStatus::Blocked;
    }

    match mode {
        KaraokeMode::Party => {
            if participants.iter().any(|participant| {
                participant.status == PerformanceMicrophoneReadinessStatus::Ready
            }) {
                if participants.iter().any(|participant| {
                    participant.status != PerformanceMicrophoneReadinessStatus::Ready
                }) {
                    PerformanceMicrophoneReadinessStatus::Degraded
                } else {
                    PerformanceMicrophoneReadinessStatus::Ready
                }
            } else {
                PerformanceMicrophoneReadinessStatus::Blocked
            }
        }
        KaraokeMode::Standard | KaraokeMode::Battle => {
            if participants.iter().all(|participant| {
                participant.status == PerformanceMicrophoneReadinessStatus::Ready
            }) {
                PerformanceMicrophoneReadinessStatus::Ready
            } else {
                PerformanceMicrophoneReadinessStatus::Blocked
            }
        }
    }
}

fn readiness_message(
    status: PerformanceMicrophoneReadinessStatus,
    mode: KaraokeMode,
    participants: &[ParticipantMicrophoneReadiness],
    participant_ids: &[String],
) -> String {
    if participant_ids.is_empty() {
        return "Select at least one proposed participant.".to_string();
    }
    if mode == KaraokeMode::Standard && !(1..=2).contains(&participant_ids.len()) {
        return "Standard mode supports one solo singer or two duet singers.".to_string();
    }
    match status {
        PerformanceMicrophoneReadinessStatus::Ready => {
            "Microphones are ready for Performance preparation.".to_string()
        }
        PerformanceMicrophoneReadinessStatus::Degraded => {
            "Party mode can proceed with ready singers; unready singers are excluded before countdown."
                .to_string()
        }
        PerformanceMicrophoneReadinessStatus::Blocked => {
            if participants.iter().any(|participant| {
                participant.reason == PerformanceMicrophoneReadinessReason::DiagnosticSessionActive
            }) {
                "Stop diagnostic capture before preparing this Performance.".to_string()
            } else {
                "Microphone readiness blocks Performance preparation.".to_string()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::microphones::models::{
        MicrophoneAssignmentMethod, MicrophoneSourceKind, MicrophoneWaitingReason,
        MicrophoneWaitingState,
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

    fn request(
        mode: KaraokeMode,
        participant_singer_ids: Vec<&str>,
    ) -> PerformanceMicrophoneReadinessRequest {
        PerformanceMicrophoneReadinessRequest {
            mode,
            participant_singer_ids: participant_singer_ids
                .into_iter()
                .map(str::to_string)
                .collect(),
            allow_automatic_recovery: false,
            phase: PerformanceReadinessPhase::Preparing,
        }
    }

    fn registries() -> (
        MicrophoneChannelRegistry,
        MicrophoneAssignmentRegistry,
        MicrophoneRecoveryRegistry,
        Vec<DiscoveredMicrophoneSource>,
    ) {
        let channels = MicrophoneChannelRegistry::default();
        let assignments = MicrophoneAssignmentRegistry::default();
        let recovery = MicrophoneRecoveryRegistry::default();
        assignments.sync_session_singers(vec!["singer-1".to_string(), "singer-2".to_string()]);
        let sources = vec![
            source("windows-mic-a", MicrophoneSourceAvailability::Available),
            source("windows-mic-b", MicrophoneSourceAvailability::Available),
        ];
        (channels, assignments, recovery, sources)
    }

    #[test]
    fn standard_participant_with_ready_assignment_locks_channel_snapshot() {
        let (channels, assignments, recovery, sources) = registries();
        let channel = channels.create("windows-mic-a", &sources).unwrap();
        assignments.assign(&channel.id, "singer-1").unwrap();

        let result = evaluate(
            &request(KaraokeMode::Standard, vec!["singer-1"]),
            &sources,
            &channels,
            &assignments,
            &recovery,
            None,
        )
        .unwrap();

        assert_eq!(result.status, PerformanceMicrophoneReadinessStatus::Ready);
        assert_eq!(
            result.locked_participants,
            vec![LockedPerformanceMicrophone {
                singer_id: "singer-1".to_string(),
                channel_id: channel.id,
                source_id: "windows-mic-a".to_string(),
            }]
        );
    }

    #[test]
    fn missing_assignment_blocks_standard_preparation() {
        let (channels, assignments, recovery, sources) = registries();

        let result = evaluate(
            &request(KaraokeMode::Standard, vec!["singer-1"]),
            &sources,
            &channels,
            &assignments,
            &recovery,
            None,
        )
        .unwrap();

        assert_eq!(result.status, PerformanceMicrophoneReadinessStatus::Blocked);
        assert_eq!(
            result.participants[0].reason,
            PerformanceMicrophoneReadinessReason::NoAssignment
        );
    }

    #[test]
    fn diagnostic_capture_blocks_capture_availability() {
        let (channels, assignments, recovery, sources) = registries();
        let channel = channels.create("windows-mic-a", &sources).unwrap();
        assignments.assign(&channel.id, "singer-1").unwrap();

        let result = evaluate(
            &request(KaraokeMode::Standard, vec!["singer-1"]),
            &sources,
            &channels,
            &assignments,
            &recovery,
            Some("windows-mic-a"),
        )
        .unwrap();

        assert_eq!(result.status, PerformanceMicrophoneReadinessStatus::Blocked);
        assert_eq!(
            result.participants[0].reason,
            PerformanceMicrophoneReadinessReason::DiagnosticSessionActive
        );
        assert!(!result.participants[0].capture_available);
    }

    #[test]
    fn disconnected_assignment_can_be_recovered_before_countdown_when_exactly_one_source_exists() {
        let (channels, assignments, recovery, mut sources) = registries();
        let channel = channels.create("windows-mic-a", &sources).unwrap();
        assignments.assign(&channel.id, "singer-1").unwrap();
        sources = vec![source(
            "windows-mic-b",
            MicrophoneSourceAvailability::Available,
        )];
        channels.reconcile(&sources);
        recovery.reconcile(&sources, &channels.list());
        let mut recovery_request = request(KaraokeMode::Standard, vec!["singer-1"]);
        recovery_request.allow_automatic_recovery = true;

        let result = evaluate(
            &recovery_request,
            &sources,
            &channels,
            &assignments,
            &recovery,
            None,
        )
        .unwrap();

        assert_eq!(result.status, PerformanceMicrophoneReadinessStatus::Ready);
        assert_eq!(
            channels.get(&channel.id).unwrap().source_id,
            "windows-mic-b"
        );
        assert_eq!(assignments.list()[0].channel_id, channel.id);
    }

    #[test]
    fn automatic_recovery_is_not_performed_during_countdown() {
        let (channels, assignments, recovery, mut sources) = registries();
        let channel = channels.create("windows-mic-a", &sources).unwrap();
        assignments.assign(&channel.id, "singer-1").unwrap();
        sources = vec![source(
            "windows-mic-b",
            MicrophoneSourceAvailability::Available,
        )];
        channels.reconcile(&sources);
        recovery.reconcile(&sources, &channels.list());
        let mut recovery_request = request(KaraokeMode::Standard, vec!["singer-1"]);
        recovery_request.allow_automatic_recovery = true;
        recovery_request.phase = PerformanceReadinessPhase::Countdown;

        let result = evaluate(
            &recovery_request,
            &sources,
            &channels,
            &assignments,
            &recovery,
            None,
        )
        .unwrap();

        assert_eq!(result.status, PerformanceMicrophoneReadinessStatus::Blocked);
        assert_eq!(
            channels.get(&channel.id).unwrap().source_id,
            "windows-mic-a"
        );
    }

    #[test]
    fn multiple_replacement_sources_require_operator_recovery() {
        let (channels, assignments, recovery, initial_sources) = registries();
        let channel = channels.create("windows-mic-a", &initial_sources).unwrap();
        assignments.assign(&channel.id, "singer-1").unwrap();
        let sources = vec![
            source("windows-mic-b", MicrophoneSourceAvailability::Available),
            source("windows-mic-c", MicrophoneSourceAvailability::Available),
        ];
        channels.reconcile(&sources);
        recovery.reconcile(&sources, &channels.list());
        let mut recovery_request = request(KaraokeMode::Standard, vec!["singer-1"]);
        recovery_request.allow_automatic_recovery = true;

        let result = evaluate(
            &recovery_request,
            &sources,
            &channels,
            &assignments,
            &recovery,
            None,
        )
        .unwrap();

        assert_eq!(result.status, PerformanceMicrophoneReadinessStatus::Blocked);
        assert_eq!(
            channels.get(&channel.id).unwrap().source_id,
            "windows-mic-a"
        );
    }

    #[test]
    fn party_mode_excludes_unready_singers_and_returns_degraded() {
        let (channels, assignments, recovery, sources) = registries();
        let channel = channels.create("windows-mic-a", &sources).unwrap();
        assignments.assign(&channel.id, "singer-1").unwrap();

        let result = evaluate(
            &request(KaraokeMode::Party, vec!["singer-1", "singer-2"]),
            &sources,
            &channels,
            &assignments,
            &recovery,
            None,
        )
        .unwrap();

        assert_eq!(
            result.status,
            PerformanceMicrophoneReadinessStatus::Degraded
        );
        assert_eq!(result.locked_participants.len(), 1);
        assert_eq!(
            result.participants[1].reason,
            PerformanceMicrophoneReadinessReason::ExcludedByPartyMode
        );
    }

    #[test]
    fn battle_mode_blocks_when_any_required_participant_is_unready() {
        let (channels, assignments, recovery, sources) = registries();
        let channel = channels.create("windows-mic-a", &sources).unwrap();
        assignments.assign(&channel.id, "singer-1").unwrap();

        let result = evaluate(
            &request(KaraokeMode::Battle, vec!["singer-1", "singer-2"]),
            &sources,
            &channels,
            &assignments,
            &recovery,
            None,
        )
        .unwrap();

        assert_eq!(result.status, PerformanceMicrophoneReadinessStatus::Blocked);
    }

    #[test]
    fn waiting_state_is_reported_separately_from_disconnected_assignment() {
        let (channels, assignments, recovery, sources) = registries();
        assignments.mark_waiting("singer-1");

        let result = evaluate(
            &request(KaraokeMode::Standard, vec!["singer-1"]),
            &sources,
            &channels,
            &assignments,
            &recovery,
            None,
        )
        .unwrap();

        assert_eq!(
            result.participants[0].reason,
            PerformanceMicrophoneReadinessReason::WaitingForMicrophone
        );
        assert_eq!(
            assignments.list_waiting(),
            vec![MicrophoneWaitingState {
                singer_id: "singer-1".to_string(),
                reason: MicrophoneWaitingReason::NoEligibleMicrophone,
                message: "No available unassigned microphone channel or source was found."
                    .to_string(),
                sequence: 1,
            }]
        );
    }

    #[test]
    fn manual_assignment_method_is_preserved_by_readiness() {
        let (channels, assignments, recovery, sources) = registries();
        let channel = channels.create("windows-mic-a", &sources).unwrap();
        assignments.assign(&channel.id, "singer-1").unwrap();

        let result = evaluate(
            &request(KaraokeMode::Standard, vec!["singer-1"]),
            &sources,
            &channels,
            &assignments,
            &recovery,
            None,
        )
        .unwrap();

        assert_eq!(
            result.participants[0].assignment.as_ref().unwrap().method,
            MicrophoneAssignmentMethod::Manual
        );
    }
}
