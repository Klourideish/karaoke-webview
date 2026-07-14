use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
};

use crate::{
    microphones::{
        DiscoveredMicrophoneSource, MicrophoneAssignmentRegistry, MicrophoneChannelRegistry,
        MicrophoneRegistryOperations, MicrophoneSourceAvailability,
    },
    session_singers::{SessionSingerErrorCode, SessionSingerRegistry},
};

use super::models::{
    AssignMicrophoneToSingerRequest, CreateSingerWithMicrophoneRequest,
    ParticipantCommitDiagnosticOutcome, ParticipantCommitDiagnosticProjection,
    ParticipantCommitError, ParticipantCommitErrorCode, ParticipantCommitProjection,
    ParticipantMicrophoneState,
};

const IDEMPOTENCY_CACHE_LIMIT: usize = 128;

#[derive(Clone)]
struct CachedCommit {
    fingerprint: String,
    result: ParticipantCommitProjection,
}

#[derive(Default)]
struct CommitCache {
    entries: HashMap<String, CachedCommit>,
    order: VecDeque<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommitFailpoint {
    None,
    AfterSinger,
    AfterChannel,
    AfterAssignment,
}

pub(crate) struct ParticipantCommitCoordinator {
    operation: Mutex<()>,
    cache: Mutex<CommitCache>,
    diagnostics: Mutex<ParticipantCommitDiagnosticProjection>,
}

impl Default for ParticipantCommitCoordinator {
    fn default() -> Self {
        Self {
            operation: Mutex::new(()),
            cache: Mutex::new(CommitCache::default()),
            diagnostics: Mutex::new(ParticipantCommitDiagnosticProjection::default()),
        }
    }
}

struct ParticipantCommitAttempt {
    result: Result<ParticipantCommitProjection, ParticipantCommitError>,
    rollback_occurred: bool,
}

impl ParticipantCommitCoordinator {
    pub(crate) fn create_singer_with_microphone(
        &self,
        request: CreateSingerWithMicrophoneRequest,
        sources: &[DiscoveredMicrophoneSource],
        singers: &SessionSingerRegistry,
        channels: &MicrophoneChannelRegistry,
        assignments: &MicrophoneAssignmentRegistry,
        microphone_operations: &MicrophoneRegistryOperations,
    ) -> Result<ParticipantCommitProjection, ParticipantCommitError> {
        let request_id = request.request_id.clone();
        let requested_name = request.display_name.clone();
        let source_display_name = sources
            .iter()
            .find(|source| source.id == request.source_id)
            .map(|source| source.display_name.clone());
        let attempt = self.create_with_failpoint(
            request,
            sources,
            singers,
            channels,
            assignments,
            microphone_operations,
            CommitFailpoint::None,
        );
        self.record_attempt(request_id, requested_name, source_display_name, &attempt);
        attempt.result
    }

    #[allow(clippy::too_many_arguments)]
    fn create_with_failpoint(
        &self,
        request: CreateSingerWithMicrophoneRequest,
        sources: &[DiscoveredMicrophoneSource],
        singers: &SessionSingerRegistry,
        channels: &MicrophoneChannelRegistry,
        assignments: &MicrophoneAssignmentRegistry,
        microphone_operations: &MicrophoneRegistryOperations,
        failpoint: CommitFailpoint,
    ) -> ParticipantCommitAttempt {
        let mut rollback_occurred = false;
        let result = (|| {
            validate_request_id(&request.request_id)?;
            let normalized_name =
                SessionSingerRegistry::validate_display_name(&request.display_name)
                    .map_err(map_singer_validation_error)?;
            let fingerprint = format!("new\0{normalized_name}\0{}", request.source_id);
            let _operation = lock(&self.operation);
            if let Some(result) = self.cached_result(&request.request_id, &fingerprint)? {
                return Ok(result);
            }
            let _microphone_operation = microphone_operations.lock();
            channels.reconcile(sources);
            let source = validate_source(&request.source_id, sources)?;
            validate_source_claim(&request.source_id, None, channels, assignments)?;

            let singer = singers
                .create(Some(normalized_name))
                .map_err(map_singer_validation_error)?;
            let mut created_channel = None;
            let mut created_assignment = None;

            let commit_result = (|| {
                fail_if(failpoint, CommitFailpoint::AfterSinger)?;
                let channel = match channels.channel_for_source(&source.id) {
                    Some(channel) => channel,
                    None => {
                        let channel = channels
                            .create(&source.id, sources)
                            .map_err(map_channel_error)?;
                        created_channel = Some(channel.clone());
                        channel
                    }
                };
                fail_if(failpoint, CommitFailpoint::AfterChannel)?;
                let assignment = assignments
                    .assign(&channel.id, &singer.id)
                    .map_err(map_assignment_error)?;
                created_assignment = Some(assignment.clone());
                assignments.record_successful_source(&singer.id, &source.id);
                fail_if(failpoint, CommitFailpoint::AfterAssignment)?;
                Ok(ParticipantCommitProjection {
                    session_singer: singer.clone(),
                    microphone_state: ParticipantMicrophoneState::Ready,
                    source_display_name: source.display_name.clone(),
                    assignment_succeeded: true,
                })
            })();

            match commit_result {
                Ok(projection) => {
                    self.cache_result(&request.request_id, fingerprint, projection.clone());
                    Ok(projection)
                }
                Err(error) => {
                    rollback_occurred = true;
                    if let Some(assignment) = created_assignment {
                        assignments.unassign_if_matches(
                            &assignment.channel_id,
                            &assignment.singer_id,
                            assignment.sequence,
                        );
                    }
                    if let Some(channel) = created_channel {
                        if !assignments.is_channel_assigned(&channel.id) {
                            channels.remove_if_matches(&channel.id, &channel.source_id);
                        }
                    }
                    assignments.clear_unassigned_singer_metadata(&singer.id);
                    let _ = singers.remove_transaction_created(&singer.id);
                    Err(error)
                }
            }
        })();

        ParticipantCommitAttempt {
            result,
            rollback_occurred,
        }
    }

    pub(crate) fn assign_microphone_to_existing_singer(
        &self,
        request: AssignMicrophoneToSingerRequest,
        sources: &[DiscoveredMicrophoneSource],
        singers: &SessionSingerRegistry,
        channels: &MicrophoneChannelRegistry,
        assignments: &MicrophoneAssignmentRegistry,
        microphone_operations: &MicrophoneRegistryOperations,
    ) -> Result<ParticipantCommitProjection, ParticipantCommitError> {
        validate_request_id(&request.request_id)?;
        let fingerprint = format!("existing\0{}\0{}", request.singer_id, request.source_id);
        let _operation = lock(&self.operation);
        if let Some(result) = self.cached_result(&request.request_id, &fingerprint)? {
            return Ok(result);
        }
        let _microphone_operation = microphone_operations.lock();
        channels.reconcile(sources);
        let singer = singers.get(&request.singer_id).ok_or_else(|| {
            ParticipantCommitError::new(
                ParticipantCommitErrorCode::SingerNotFound,
                "The selected session singer no longer exists.",
            )
        })?;
        let source = validate_source(&request.source_id, sources)?;
        validate_source_claim(
            &request.source_id,
            Some(&request.singer_id),
            channels,
            assignments,
        )?;

        if let Some(existing) = assignments.assignment_for_singer(&singer.id) {
            let channel = channels.get(&existing.channel_id).ok_or_else(|| {
                ParticipantCommitError::new(
                    ParticipantCommitErrorCode::InternalError,
                    "The singer's microphone channel no longer exists.",
                )
            })?;
            if channel.source_id == source.id {
                let projection = ParticipantCommitProjection {
                    session_singer: singer,
                    microphone_state: ParticipantMicrophoneState::Ready,
                    source_display_name: source.display_name.clone(),
                    assignment_succeeded: true,
                };
                self.cache_result(&request.request_id, fingerprint, projection.clone());
                return Ok(projection);
            }
            return Err(ParticipantCommitError::new(
                ParticipantCommitErrorCode::AssignmentConflict,
                "This singer already has a different microphone.",
            ));
        }

        let mut created_channel = None;
        let channel = match channels.channel_for_source(&source.id) {
            Some(channel) => channel,
            None => {
                let channel = channels
                    .create(&source.id, sources)
                    .map_err(map_channel_error)?;
                created_channel = Some(channel.clone());
                channel
            }
        };
        let assignment = match assignments.assign(&channel.id, &singer.id) {
            Ok(assignment) => assignment,
            Err(error) => {
                if let Some(created) = created_channel {
                    channels.remove_if_matches(&created.id, &created.source_id);
                }
                return Err(map_assignment_error(error));
            }
        };
        assignments.record_successful_source(&singer.id, &source.id);
        let projection = ParticipantCommitProjection {
            session_singer: singer,
            microphone_state: ParticipantMicrophoneState::Ready,
            source_display_name: source.display_name.clone(),
            assignment_succeeded: true,
        };
        debug_assert!(assignments
            .assignment_for_singer(&projection.session_singer.id)
            .is_some_and(|current| current.sequence == assignment.sequence));
        self.cache_result(&request.request_id, fingerprint, projection.clone());
        Ok(projection)
    }

    fn cached_result(
        &self,
        request_id: &str,
        fingerprint: &str,
    ) -> Result<Option<ParticipantCommitProjection>, ParticipantCommitError> {
        let cache = lock(&self.cache);
        let Some(cached) = cache.entries.get(request_id) else {
            return Ok(None);
        };
        if cached.fingerprint != fingerprint {
            return Err(ParticipantCommitError::new(
                ParticipantCommitErrorCode::RequestIdConflict,
                "This request ID was already used for a different participant operation.",
            ));
        }
        Ok(Some(cached.result.clone()))
    }

    fn cache_result(
        &self,
        request_id: &str,
        fingerprint: String,
        result: ParticipantCommitProjection,
    ) {
        let mut cache = lock(&self.cache);
        if !cache.entries.contains_key(request_id) {
            cache.order.push_back(request_id.to_string());
        }
        cache.entries.insert(
            request_id.to_string(),
            CachedCommit {
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

    pub(crate) fn diagnostics(&self) -> ParticipantCommitDiagnosticProjection {
        lock(&self.diagnostics).clone()
    }

    fn record_attempt(
        &self,
        request_id: String,
        requested_name: String,
        source_display_name: Option<String>,
        attempt: &ParticipantCommitAttempt,
    ) {
        let projection = match &attempt.result {
            Ok(result) => ParticipantCommitDiagnosticProjection {
                request_id: Some(request_id),
                outcome: ParticipantCommitDiagnosticOutcome::Success,
                singer_name: Some(result.session_singer.display_name.clone()),
                source_display_name: Some(result.source_display_name.clone()),
                microphone_state: Some(result.microphone_state),
                rollback_occurred: false,
                failure_reason: None,
                failure_message: None,
            },
            Err(error) => ParticipantCommitDiagnosticProjection {
                request_id: Some(request_id),
                outcome: ParticipantCommitDiagnosticOutcome::Failure,
                singer_name: Some(requested_name),
                source_display_name,
                microphone_state: None,
                rollback_occurred: attempt.rollback_occurred,
                failure_reason: Some(error.reason_code),
                failure_message: Some(error.message.clone()),
            },
        };
        *lock(&self.diagnostics) = projection;
    }

    #[cfg(test)]
    pub(super) fn create_with_test_failpoint(
        &self,
        request: CreateSingerWithMicrophoneRequest,
        sources: &[DiscoveredMicrophoneSource],
        singers: &SessionSingerRegistry,
        channels: &MicrophoneChannelRegistry,
        assignments: &MicrophoneAssignmentRegistry,
        microphone_operations: &MicrophoneRegistryOperations,
        failpoint: &'static str,
    ) -> Result<ParticipantCommitProjection, ParticipantCommitError> {
        let request_id = request.request_id.clone();
        let requested_name = request.display_name.clone();
        let source_display_name = sources
            .iter()
            .find(|source| source.id == request.source_id)
            .map(|source| source.display_name.clone());
        let failpoint = match failpoint {
            "after-singer" => CommitFailpoint::AfterSinger,
            "after-channel" => CommitFailpoint::AfterChannel,
            "after-assignment" => CommitFailpoint::AfterAssignment,
            _ => CommitFailpoint::None,
        };
        let attempt = self.create_with_failpoint(
            request,
            sources,
            singers,
            channels,
            assignments,
            microphone_operations,
            failpoint,
        );
        self.record_attempt(request_id, requested_name, source_display_name, &attempt);
        attempt.result
    }
}

fn validate_request_id(request_id: &str) -> Result<(), ParticipantCommitError> {
    if request_id.trim().is_empty() || request_id.chars().count() > 128 {
        return Err(ParticipantCommitError::new(
            ParticipantCommitErrorCode::InvalidRequest,
            "A valid participant operation ID is required.",
        ));
    }
    Ok(())
}

fn validate_source<'a>(
    source_id: &str,
    sources: &'a [DiscoveredMicrophoneSource],
) -> Result<&'a DiscoveredMicrophoneSource, ParticipantCommitError> {
    sources
        .iter()
        .find(|source| {
            source.id == source_id && source.availability == MicrophoneSourceAvailability::Available
        })
        .ok_or_else(|| {
            ParticipantCommitError::new(
                ParticipantCommitErrorCode::SourceUnavailable,
                "The selected microphone is not available.",
            )
        })
}

fn validate_source_claim(
    source_id: &str,
    intended_singer_id: Option<&str>,
    channels: &MicrophoneChannelRegistry,
    assignments: &MicrophoneAssignmentRegistry,
) -> Result<(), ParticipantCommitError> {
    let Some(channel) = channels.channel_for_source(source_id) else {
        return Ok(());
    };
    if let Some(assignment) = assignments
        .list()
        .into_iter()
        .find(|assignment| assignment.channel_id == channel.id)
    {
        if intended_singer_id != Some(assignment.singer_id.as_str()) {
            return Err(ParticipantCommitError::new(
                ParticipantCommitErrorCode::AssignmentConflict,
                "The selected microphone is already assigned to another singer.",
            ));
        }
    }
    Ok(())
}

fn map_singer_validation_error(
    error: crate::session_singers::SessionSingerError,
) -> ParticipantCommitError {
    ParticipantCommitError::new(
        match error.reason_code {
            SessionSingerErrorCode::SingerNotFound => ParticipantCommitErrorCode::SingerNotFound,
            _ => ParticipantCommitErrorCode::InvalidDisplayName,
        },
        error.message,
    )
}

fn map_channel_error(error: String) -> ParticipantCommitError {
    ParticipantCommitError::new(ParticipantCommitErrorCode::SourceIneligible, error)
}

fn map_assignment_error(error: String) -> ParticipantCommitError {
    ParticipantCommitError::new(ParticipantCommitErrorCode::AssignmentConflict, error)
}

fn fail_if(
    actual: CommitFailpoint,
    expected: CommitFailpoint,
) -> Result<(), ParticipantCommitError> {
    if actual == expected {
        Err(ParticipantCommitError::new(
            ParticipantCommitErrorCode::InternalError,
            "The participant operation could not be completed.",
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
