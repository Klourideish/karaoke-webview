use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
};

use crate::{
    microphones::{
        DiscoveredMicrophoneSource, MicrophoneAssignmentRegistry, MicrophoneChannelRegistry,
        MicrophoneRecoveryRegistry, MicrophoneRegistryOperations, MicrophoneSourceAvailability,
    },
    session_singers::SessionSingerRegistry,
};

use super::models::{
    MicrophoneSelectionError, MicrophoneSelectionErrorCode, MicrophoneSelectionProjection,
    MicrophoneSelectionStatus, SelectSingerMicrophoneRequest,
};

const IDEMPOTENCY_CACHE_LIMIT: usize = 128;

#[derive(Clone)]
struct CachedSelection {
    fingerprint: String,
    result: MicrophoneSelectionProjection,
}

#[derive(Default)]
struct SelectionCache {
    entries: HashMap<String, CachedSelection>,
    order: VecDeque<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SelectionFailpoint {
    None,
    BeforeChannelMutation,
    AfterChannelMutation,
    AfterAssignmentMutation,
}

pub(crate) struct MicrophoneSelectionCoordinator {
    operation: Mutex<()>,
    cache: Mutex<SelectionCache>,
}

impl Default for MicrophoneSelectionCoordinator {
    fn default() -> Self {
        Self {
            operation: Mutex::new(()),
            cache: Mutex::new(SelectionCache::default()),
        }
    }
}

impl MicrophoneSelectionCoordinator {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn select(
        &self,
        request: SelectSingerMicrophoneRequest,
        sources: &[DiscoveredMicrophoneSource],
        singers: &SessionSingerRegistry,
        channels: &MicrophoneChannelRegistry,
        assignments: &MicrophoneAssignmentRegistry,
        recovery: &MicrophoneRecoveryRegistry,
        microphone_operations: &MicrophoneRegistryOperations,
    ) -> Result<MicrophoneSelectionProjection, MicrophoneSelectionError> {
        self.select_with_failpoint(
            request,
            sources,
            singers,
            channels,
            assignments,
            recovery,
            microphone_operations,
            SelectionFailpoint::None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn select_with_failpoint(
        &self,
        request: SelectSingerMicrophoneRequest,
        sources: &[DiscoveredMicrophoneSource],
        singers: &SessionSingerRegistry,
        channels: &MicrophoneChannelRegistry,
        assignments: &MicrophoneAssignmentRegistry,
        recovery: &MicrophoneRecoveryRegistry,
        microphone_operations: &MicrophoneRegistryOperations,
        failpoint: SelectionFailpoint,
    ) -> Result<MicrophoneSelectionProjection, MicrophoneSelectionError> {
        validate_request(&request)?;
        let fingerprint = format!(
            "{}\0{}",
            request.session_singer_id,
            request.desired_source_id.as_deref().unwrap_or("<clear>")
        );
        let _coordinator_operation = lock(&self.operation);
        if let Some(cached) = self.cached_result(&request.request_id, &fingerprint)? {
            return Ok(cached);
        }
        let _microphone_operation = microphone_operations.lock();
        channels.reconcile(sources);
        if !singers.contains(&request.session_singer_id) {
            return Err(MicrophoneSelectionError::new(
                MicrophoneSelectionErrorCode::SingerNotFound,
                "The selected session singer no longer exists.",
            ));
        }

        let result = match request.desired_source_id.as_deref() {
            Some(source_id) => self.assign_source(
                &request.session_singer_id,
                source_id,
                sources,
                channels,
                assignments,
                recovery,
                failpoint,
            )?,
            None => self.clear_selection(&request.session_singer_id, channels, assignments)?,
        };
        self.cache_result(&request.request_id, fingerprint, result.clone());
        Ok(result)
    }

    #[allow(clippy::too_many_arguments)]
    fn assign_source(
        &self,
        singer_id: &str,
        source_id: &str,
        sources: &[DiscoveredMicrophoneSource],
        channels: &MicrophoneChannelRegistry,
        assignments: &MicrophoneAssignmentRegistry,
        recovery: &MicrophoneRecoveryRegistry,
        failpoint: SelectionFailpoint,
    ) -> Result<MicrophoneSelectionProjection, MicrophoneSelectionError> {
        let source = sources
            .iter()
            .find(|source| {
                source.id == source_id
                    && source.availability == MicrophoneSourceAvailability::Available
            })
            .ok_or_else(|| {
                MicrophoneSelectionError::new(
                    MicrophoneSelectionErrorCode::SourceUnavailable,
                    "The selected microphone is not available.",
                )
            })?;
        let existing_assignment = assignments.assignment_for_singer(singer_id);

        if let Some(existing_assignment) = existing_assignment {
            let original_channel =
                channels
                    .get(&existing_assignment.channel_id)
                    .ok_or_else(|| {
                        MicrophoneSelectionError::new(
                            MicrophoneSelectionErrorCode::ChannelNotFound,
                            "The singer's microphone channel no longer exists.",
                        )
                    })?;
            if original_channel.source_id == source.id {
                return Ok(assigned_projection(
                    singer_id,
                    original_channel,
                    existing_assignment,
                    source.display_name.clone(),
                ));
            }
            if channels.channel_for_source(&source.id).is_some() {
                return Err(MicrophoneSelectionError::new(
                    MicrophoneSelectionErrorCode::SourceAlreadyClaimed,
                    "The selected microphone already backs another channel.",
                ));
            }
            fail_if(failpoint, SelectionFailpoint::BeforeChannelMutation)?;
            let replaced = channels
                .replace_source(&original_channel.id, &source.id, sources)
                .map_err(map_channel_error)?;
            if let Err(error) = fail_if(failpoint, SelectionFailpoint::AfterChannelMutation) {
                channels.restore_if_matches(&replaced, &original_channel);
                return Err(error);
            }
            assignments.record_successful_source(singer_id, &source.id);
            recovery.clear_channel(&replaced.id);
            recovery.reconcile(sources, &channels.list());
            return Ok(assigned_projection(
                singer_id,
                replaced,
                existing_assignment,
                source.display_name.clone(),
            ));
        }

        let existing_channel = channels.channel_for_source(&source.id);
        if existing_channel.as_ref().is_some_and(|channel| {
            assignments
                .list()
                .iter()
                .any(|assignment| assignment.channel_id == channel.id)
        }) {
            return Err(MicrophoneSelectionError::new(
                MicrophoneSelectionErrorCode::SourceAlreadyClaimed,
                "The selected microphone is already assigned to another singer.",
            ));
        }
        fail_if(failpoint, SelectionFailpoint::BeforeChannelMutation)?;
        let mut created_channel = None;
        let channel = match existing_channel {
            Some(channel) => channel,
            None => {
                let channel = channels
                    .create(&source.id, sources)
                    .map_err(map_channel_error)?;
                created_channel = Some(channel.clone());
                channel
            }
        };
        if let Err(error) = fail_if(failpoint, SelectionFailpoint::AfterChannelMutation) {
            rollback_created_channel(channels, assignments, created_channel.as_ref());
            return Err(error);
        }
        let assignment = match assignments.assign(&channel.id, singer_id) {
            Ok(assignment) => assignment,
            Err(error) => {
                rollback_created_channel(channels, assignments, created_channel.as_ref());
                return Err(map_assignment_error(error));
            }
        };
        if let Err(error) = fail_if(failpoint, SelectionFailpoint::AfterAssignmentMutation) {
            assignments.unassign_if_matches(
                &assignment.channel_id,
                &assignment.singer_id,
                assignment.sequence,
            );
            rollback_created_channel(channels, assignments, created_channel.as_ref());
            return Err(error);
        }
        assignments.record_successful_source(singer_id, &source.id);
        recovery.reconcile(sources, &channels.list());
        Ok(assigned_projection(
            singer_id,
            channel,
            assignment,
            source.display_name.clone(),
        ))
    }

    fn clear_selection(
        &self,
        singer_id: &str,
        channels: &MicrophoneChannelRegistry,
        assignments: &MicrophoneAssignmentRegistry,
    ) -> Result<MicrophoneSelectionProjection, MicrophoneSelectionError> {
        let retained_channel =
            if let Some(assignment) = assignments.assignment_for_singer(singer_id) {
                let channel = channels.get(&assignment.channel_id).ok_or_else(|| {
                    MicrophoneSelectionError::new(
                        MicrophoneSelectionErrorCode::ChannelNotFound,
                        "The singer's microphone channel no longer exists.",
                    )
                })?;
                assignments
                    .unassign(&assignment.channel_id)
                    .map_err(map_assignment_error)?;
                Some(channel)
            } else {
                if assignments.waiting_for_singer(singer_id).is_some() {
                    assignments
                        .clear_waiting(singer_id)
                        .map_err(map_assignment_error)?;
                }
                None
            };
        Ok(MicrophoneSelectionProjection {
            session_singer_id: singer_id.to_string(),
            status: MicrophoneSelectionStatus::Cleared,
            channel: retained_channel,
            assignment: None,
            source_display_name: None,
        })
    }

    fn cached_result(
        &self,
        request_id: &str,
        fingerprint: &str,
    ) -> Result<Option<MicrophoneSelectionProjection>, MicrophoneSelectionError> {
        let cache = lock(&self.cache);
        let Some(cached) = cache.entries.get(request_id) else {
            return Ok(None);
        };
        if cached.fingerprint != fingerprint {
            return Err(MicrophoneSelectionError::new(
                MicrophoneSelectionErrorCode::RequestIdConflict,
                "This request ID was already used for a different microphone selection.",
            ));
        }
        Ok(Some(cached.result.clone()))
    }

    fn cache_result(
        &self,
        request_id: &str,
        fingerprint: String,
        result: MicrophoneSelectionProjection,
    ) {
        let mut cache = lock(&self.cache);
        if !cache.entries.contains_key(request_id) {
            cache.order.push_back(request_id.to_string());
        }
        cache.entries.insert(
            request_id.to_string(),
            CachedSelection {
                fingerprint,
                result,
            },
        );
        while cache.order.len() > IDEMPOTENCY_CACHE_LIMIT {
            if let Some(expired) = cache.order.pop_front() {
                cache.entries.remove(&expired);
            }
        }
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn select_with_test_failpoint(
        &self,
        request: SelectSingerMicrophoneRequest,
        sources: &[DiscoveredMicrophoneSource],
        singers: &SessionSingerRegistry,
        channels: &MicrophoneChannelRegistry,
        assignments: &MicrophoneAssignmentRegistry,
        recovery: &MicrophoneRecoveryRegistry,
        microphone_operations: &MicrophoneRegistryOperations,
        failpoint: &'static str,
    ) -> Result<MicrophoneSelectionProjection, MicrophoneSelectionError> {
        let failpoint = match failpoint {
            "before-channel" => SelectionFailpoint::BeforeChannelMutation,
            "after-channel" => SelectionFailpoint::AfterChannelMutation,
            "after-assignment" => SelectionFailpoint::AfterAssignmentMutation,
            _ => SelectionFailpoint::None,
        };
        self.select_with_failpoint(
            request,
            sources,
            singers,
            channels,
            assignments,
            recovery,
            microphone_operations,
            failpoint,
        )
    }
}

fn validate_request(
    request: &SelectSingerMicrophoneRequest,
) -> Result<(), MicrophoneSelectionError> {
    if request.request_id.trim().is_empty()
        || request.request_id.chars().count() > 128
        || request.session_singer_id.trim().is_empty()
        || request
            .desired_source_id
            .as_deref()
            .is_some_and(str::is_empty)
    {
        return Err(MicrophoneSelectionError::new(
            MicrophoneSelectionErrorCode::InvalidRequest,
            "A valid microphone selection request is required.",
        ));
    }
    Ok(())
}

fn assigned_projection(
    singer_id: &str,
    channel: crate::microphones::MicrophoneChannel,
    assignment: crate::microphones::MicrophoneAssignment,
    source_display_name: String,
) -> MicrophoneSelectionProjection {
    MicrophoneSelectionProjection {
        session_singer_id: singer_id.to_string(),
        status: MicrophoneSelectionStatus::Assigned,
        channel: Some(channel),
        assignment: Some(assignment),
        source_display_name: Some(source_display_name),
    }
}

fn rollback_created_channel(
    channels: &MicrophoneChannelRegistry,
    assignments: &MicrophoneAssignmentRegistry,
    created_channel: Option<&crate::microphones::MicrophoneChannel>,
) {
    if let Some(channel) = created_channel {
        if !assignments.is_channel_assigned(&channel.id) {
            channels.remove_if_matches(&channel.id, &channel.source_id);
        }
    }
}

fn map_channel_error(error: String) -> MicrophoneSelectionError {
    MicrophoneSelectionError::new(MicrophoneSelectionErrorCode::AssignmentConflict, error)
}

fn map_assignment_error(error: String) -> MicrophoneSelectionError {
    MicrophoneSelectionError::new(MicrophoneSelectionErrorCode::AssignmentConflict, error)
}

fn fail_if(
    actual: SelectionFailpoint,
    expected: SelectionFailpoint,
) -> Result<(), MicrophoneSelectionError> {
    if actual == expected {
        Err(MicrophoneSelectionError::new(
            MicrophoneSelectionErrorCode::InternalError,
            "The microphone selection could not be completed.",
        ))
    } else {
        Ok(())
    }
}

fn lock<T>(inner: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
