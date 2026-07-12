mod assignment_registry;
mod automatic_assignment;
mod channel_registry;
mod discovery;
mod models;
mod performance_readiness;
mod recovery;

#[cfg(test)]
mod tests;

#[cfg(target_os = "windows")]
pub(crate) mod windows;

pub(crate) use assignment_registry::MicrophoneAssignmentRegistry;
pub(crate) use channel_registry::MicrophoneChannelRegistry;
pub(crate) use models::DiscoveredMicrophoneSource;
use models::{
    AutomaticAssignmentResult, MicrophoneAssignment, MicrophoneChannel, MicrophoneRecoveryState,
    MicrophoneWaitingState, PerformanceMicrophoneReadiness, PerformanceMicrophoneReadinessRequest,
};
pub(crate) use recovery::MicrophoneRecoveryRegistry;
use std::sync::{Mutex, MutexGuard};

#[derive(Default)]
pub(crate) struct MicrophoneRegistryOperations(Mutex<()>);

impl MicrophoneRegistryOperations {
    fn lock(&self) -> MutexGuard<'_, ()> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

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
    recovery: tauri::State<'_, MicrophoneRecoveryRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<Vec<DiscoveredMicrophoneSource>, String> {
    let _operation = operations.lock();
    let sources = discovery::discover_local_sources().map_err(|error| error.to_string())?;
    registry.reconcile(&sources);
    recovery.reconcile(&sources, &registry.list());
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
    assignments: tauri::State<'_, MicrophoneAssignmentRegistry>,
    recovery: tauri::State<'_, MicrophoneRecoveryRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<(), String> {
    let _operation = operations.lock();
    remove_persistent_channel(&registry, &assignments, &channel_id)?;
    recovery.clear_channel(&channel_id);
    Ok(())
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

#[tauri::command]
pub(crate) fn sync_session_singers(
    singer_ids: Vec<String>,
    assignments: tauri::State<'_, MicrophoneAssignmentRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Vec<MicrophoneAssignment> {
    let _operation = operations.lock();
    assignments.sync_session_singers(singer_ids)
}

#[tauri::command]
pub(crate) fn list_microphone_assignments(
    assignments: tauri::State<'_, MicrophoneAssignmentRegistry>,
) -> Vec<MicrophoneAssignment> {
    assignments.list()
}

#[tauri::command]
pub(crate) fn assign_microphone_channel(
    channel_id: String,
    singer_id: String,
    channels: tauri::State<'_, MicrophoneChannelRegistry>,
    assignments: tauri::State<'_, MicrophoneAssignmentRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<MicrophoneAssignment, String> {
    let _operation = operations.lock();
    let assignment = assign_persistent_channel(&channels, &assignments, &channel_id, &singer_id)?;
    let channel = channels.get(&channel_id).ok_or_else(|| {
        "The selected persistent microphone channel no longer exists.".to_string()
    })?;
    assignments.record_successful_source(&singer_id, &channel.source_id);
    Ok(assignment)
}

#[tauri::command]
pub(crate) fn unassign_microphone_channel(
    channel_id: String,
    channels: tauri::State<'_, MicrophoneChannelRegistry>,
    assignments: tauri::State<'_, MicrophoneAssignmentRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<(), String> {
    let _operation = operations.lock();
    require_persistent_channel(&channels, &channel_id)?;
    assignments.unassign(&channel_id)
}

fn assign_persistent_channel(
    channels: &MicrophoneChannelRegistry,
    assignments: &MicrophoneAssignmentRegistry,
    channel_id: &str,
    singer_id: &str,
) -> Result<MicrophoneAssignment, String> {
    require_persistent_channel(channels, channel_id)?;
    assignments.assign(channel_id, singer_id)
}

fn remove_persistent_channel(
    channels: &MicrophoneChannelRegistry,
    assignments: &MicrophoneAssignmentRegistry,
    channel_id: &str,
) -> Result<(), String> {
    if assignments.is_channel_assigned(channel_id) {
        return Err("Unassign this microphone channel before removing it.".to_string());
    }
    channels.remove(channel_id)
}

fn require_persistent_channel(
    channels: &MicrophoneChannelRegistry,
    channel_id: &str,
) -> Result<(), String> {
    if channels.contains(channel_id) {
        Ok(())
    } else {
        Err("The selected persistent microphone channel no longer exists.".to_string())
    }
}

#[tauri::command]
pub(crate) fn auto_assign_microphone_channel(
    singer_id: String,
    channels: tauri::State<'_, MicrophoneChannelRegistry>,
    assignments: tauri::State<'_, MicrophoneAssignmentRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<AutomaticAssignmentResult, String> {
    let _operation = operations.lock();
    let sources = discovery::discover_local_sources().map_err(|error| error.to_string())?;
    channels.reconcile(&sources);
    automatic_assignment::auto_assign(&singer_id, &sources, &channels, &assignments)
}

#[tauri::command]
pub(crate) fn list_microphone_waiting_states(
    assignments: tauri::State<'_, MicrophoneAssignmentRegistry>,
) -> Vec<MicrophoneWaitingState> {
    assignments.list_waiting()
}

#[tauri::command]
pub(crate) fn clear_microphone_waiting_state(
    singer_id: String,
    assignments: tauri::State<'_, MicrophoneAssignmentRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<(), String> {
    let _operation = operations.lock();
    if !assignments.has_session_singer(&singer_id) {
        return Err("The selected session singer no longer exists.".to_string());
    }
    assignments.clear_waiting(&singer_id)
}

#[tauri::command]
pub(crate) fn get_microphone_recovery_states(
    channels: tauri::State<'_, MicrophoneChannelRegistry>,
    recovery: tauri::State<'_, MicrophoneRecoveryRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<Vec<MicrophoneRecoveryState>, String> {
    let _operation = operations.lock();
    let sources = discovery::discover_local_sources().map_err(|error| error.to_string())?;
    channels.reconcile(&sources);
    recovery.reconcile(&sources, &channels.list());
    Ok(recovery.list())
}

#[tauri::command]
pub(crate) fn retry_microphone_channel_source(
    channel_id: String,
    channels: tauri::State<'_, MicrophoneChannelRegistry>,
    recovery: tauri::State<'_, MicrophoneRecoveryRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<MicrophoneRecoveryState, String> {
    let _operation = operations.lock();
    require_persistent_channel(&channels, &channel_id)?;
    if recovery.get(&channel_id).is_none() {
        let initial_sources =
            discovery::discover_local_sources().map_err(|error| error.to_string())?;
        channels.reconcile(&initial_sources);
        recovery.reconcile(&initial_sources, &channels.list());
    }
    recovery.mark_recovering(&channel_id)?;
    let sources = match discovery::discover_local_sources() {
        Ok(sources) => sources,
        Err(error) => {
            recovery.mark_discovery_failed(&channel_id)?;
            return Err(error.to_string());
        }
    };
    channels.reconcile(&sources);
    recovery.reconcile(&sources, &channels.list());
    let state = recovery
        .get(&channel_id)
        .ok_or_else(|| "The microphone recovery state no longer exists.".to_string())?;
    if state.status == models::MicrophoneRecoveryStatus::Healthy {
        Ok(state)
    } else {
        recovery.mark_retry_failed(&channel_id)
    }
}

#[tauri::command]
pub(crate) fn replace_disconnected_microphone_channel_source(
    channel_id: String,
    source_id: String,
    channels: tauri::State<'_, MicrophoneChannelRegistry>,
    recovery: tauri::State<'_, MicrophoneRecoveryRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<MicrophoneChannel, String> {
    let _operation = operations.lock();
    require_persistent_channel(&channels, &channel_id)?;
    let sources = discovery::discover_local_sources().map_err(|error| error.to_string())?;
    channels.reconcile(&sources);
    recovery.reconcile(&sources, &channels.list());
    let state = recovery
        .get(&channel_id)
        .ok_or_else(|| "The microphone recovery state no longer exists.".to_string())?;
    if state.status == models::MicrophoneRecoveryStatus::Healthy {
        return Err("This microphone channel is already healthy.".to_string());
    }
    if !state
        .eligible_replacement_source_ids
        .iter()
        .any(|eligible| eligible == &source_id)
    {
        return Err("The selected replacement source is not eligible.".to_string());
    }
    let channel = channels.replace_source(&channel_id, &source_id, &sources)?;
    recovery.clear_channel(&channel_id);
    recovery.reconcile(&sources, &channels.list());
    Ok(channel)
}

#[tauri::command]
pub(crate) fn leave_microphone_channel_assigned(
    channel_id: String,
    channels: tauri::State<'_, MicrophoneChannelRegistry>,
    recovery: tauri::State<'_, MicrophoneRecoveryRegistry>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<MicrophoneRecoveryState, String> {
    let _operation = operations.lock();
    require_persistent_channel(&channels, &channel_id)?;
    recovery.leave_assigned(&channel_id)
}

#[tauri::command]
pub(crate) fn evaluate_performance_microphone_readiness(
    request: PerformanceMicrophoneReadinessRequest,
    channels: tauri::State<'_, MicrophoneChannelRegistry>,
    assignments: tauri::State<'_, MicrophoneAssignmentRegistry>,
    recovery: tauri::State<'_, MicrophoneRecoveryRegistry>,
    capture: tauri::State<'_, crate::capture::DiagnosticCaptureManager>,
    operations: tauri::State<'_, MicrophoneRegistryOperations>,
) -> Result<PerformanceMicrophoneReadiness, String> {
    let _operation = operations.lock();
    let sources = discovery::discover_local_sources().map_err(|error| error.to_string())?;
    performance_readiness::evaluate(
        &request,
        &sources,
        &channels,
        &assignments,
        &recovery,
        capture.occupied_source_for_readiness().as_deref(),
    )
}
