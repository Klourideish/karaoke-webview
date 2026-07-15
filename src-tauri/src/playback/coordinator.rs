use std::{collections::VecDeque, sync::Mutex};

use super::models::{
    PlaybackAdapterAction, PlaybackDiagnostics, PlaybackError, PlaybackErrorCode,
    PlaybackMutationRequest, PlaybackProjection, PlaybackSongProjection, PlaybackState,
    RequestSongPlayback,
};

const IDEMPOTENCY_CAPACITY: usize = 128;

#[derive(Clone)]
struct CachedOperation {
    request_id: String,
    fingerprint: String,
    result: Result<PlaybackProjection, PlaybackError>,
}

struct PlaybackInner {
    revision: u64,
    state: PlaybackState,
    desired_action: PlaybackAdapterAction,
    attempt_id: Option<String>,
    song: Option<PlaybackSongProjection>,
    failure_reason: Option<PlaybackErrorCode>,
    failure_message: Option<String>,
    last_adapter_event: Option<String>,
    stale_event_count: u64,
    idempotency_hit_count: u64,
    idempotency_conflict_count: u64,
    next_attempt_number: u64,
    operations: VecDeque<CachedOperation>,
}

impl Default for PlaybackInner {
    fn default() -> Self {
        Self {
            revision: 0,
            state: PlaybackState::Idle,
            desired_action: PlaybackAdapterAction::None,
            attempt_id: None,
            song: None,
            failure_reason: None,
            failure_message: None,
            last_adapter_event: None,
            stale_event_count: 0,
            idempotency_hit_count: 0,
            idempotency_conflict_count: 0,
            next_attempt_number: 0,
            operations: VecDeque::new(),
        }
    }
}

#[derive(Default)]
pub(crate) struct HostPlaybackCoordinator {
    inner: Mutex<PlaybackInner>,
}

impl HostPlaybackCoordinator {
    pub(crate) fn projection(&self) -> PlaybackProjection {
        projection(&lock(&self.inner))
    }

    pub(crate) fn request_start(
        &self,
        request: RequestSongPlayback,
        resolve_song: impl FnOnce() -> Result<PlaybackSongProjection, PlaybackError>,
    ) -> Result<PlaybackProjection, PlaybackError> {
        let fingerprint = format!("start:{}", request.song_id);
        let mut inner = lock(&self.inner);
        if let Some(cached) = cached_result(&mut inner, &request.request_id, &fingerprint)? {
            return cached;
        }

        let result = if matches!(
            inner.state,
            PlaybackState::Starting | PlaybackState::Playing | PlaybackState::Paused
        ) {
            Err(PlaybackError::new(
                PlaybackErrorCode::PlaybackAlreadyActive,
                "Stop the current song before starting another one.",
            ))
        } else {
            resolve_song().map(|song| {
                inner.next_attempt_number += 1;
                inner.revision += 1;
                inner.attempt_id = Some(format!("playback-attempt-{}", inner.next_attempt_number));
                inner.song = Some(song);
                inner.state = PlaybackState::Starting;
                inner.desired_action = PlaybackAdapterAction::Start;
                inner.failure_reason = None;
                inner.failure_message = None;
                inner.last_adapter_event = Some("start-requested".to_string());
                projection(&inner)
            })
        };
        cache_result(&mut inner, request.request_id, fingerprint, result.clone());
        result
    }

    pub(crate) fn request_pause(
        &self,
        request: PlaybackMutationRequest,
    ) -> Result<PlaybackProjection, PlaybackError> {
        self.mutate(request, "pause", PlaybackState::Playing, |inner| {
            inner.revision += 1;
            inner.state = PlaybackState::Paused;
            inner.desired_action = PlaybackAdapterAction::Pause;
            inner.last_adapter_event = Some("pause-requested".to_string());
        })
    }

    pub(crate) fn request_resume(
        &self,
        request: PlaybackMutationRequest,
    ) -> Result<PlaybackProjection, PlaybackError> {
        self.mutate(request, "resume", PlaybackState::Paused, |inner| {
            inner.revision += 1;
            inner.state = PlaybackState::Starting;
            inner.desired_action = PlaybackAdapterAction::Resume;
            inner.failure_reason = None;
            inner.failure_message = None;
            inner.last_adapter_event = Some("resume-requested".to_string());
        })
    }

    pub(crate) fn request_stop(
        &self,
        request: PlaybackMutationRequest,
    ) -> Result<PlaybackProjection, PlaybackError> {
        let fingerprint = "stop".to_string();
        let mut inner = lock(&self.inner);
        if let Some(cached) = cached_result(&mut inner, &request.request_id, &fingerprint)? {
            return cached;
        }
        let result = if inner.attempt_id.is_none()
            || matches!(inner.state, PlaybackState::Idle | PlaybackState::Stopped)
        {
            Err(PlaybackError::new(
                PlaybackErrorCode::PlaybackNotActive,
                "No song is currently active.",
            ))
        } else {
            inner.revision += 1;
            inner.state = PlaybackState::Stopped;
            inner.desired_action = PlaybackAdapterAction::Stop;
            inner.last_adapter_event = Some("stop-requested".to_string());
            Ok(projection(&inner))
        };
        cache_result(&mut inner, request.request_id, fingerprint, result.clone());
        result
    }

    pub(crate) fn report_started(
        &self,
        attempt_id: &str,
    ) -> Result<PlaybackProjection, PlaybackError> {
        let mut inner = lock(&self.inner);
        verify_attempt(&mut inner, attempt_id)?;
        if inner.state == PlaybackState::Playing {
            return Ok(projection(&inner));
        }
        if inner.state != PlaybackState::Starting {
            return Err(invalid_state(
                "Playback cannot start from its current state.",
            ));
        }
        inner.state = PlaybackState::Playing;
        inner.revision += 1;
        inner.desired_action = PlaybackAdapterAction::None;
        inner.last_adapter_event = Some("adapter-started".to_string());
        Ok(projection(&inner))
    }

    pub(crate) fn report_completed(
        &self,
        attempt_id: &str,
    ) -> Result<PlaybackProjection, PlaybackError> {
        let mut inner = lock(&self.inner);
        verify_attempt(&mut inner, attempt_id)?;
        if inner.state == PlaybackState::Completed {
            return Ok(projection(&inner));
        }
        if !matches!(inner.state, PlaybackState::Playing | PlaybackState::Paused) {
            return Err(invalid_state(
                "Playback cannot complete from its current state.",
            ));
        }
        inner.state = PlaybackState::Completed;
        inner.revision += 1;
        inner.desired_action = PlaybackAdapterAction::None;
        inner.last_adapter_event = Some("adapter-completed".to_string());
        Ok(projection(&inner))
    }

    pub(crate) fn report_failed(
        &self,
        attempt_id: &str,
        reason_code: PlaybackErrorCode,
        message: String,
    ) -> Result<PlaybackProjection, PlaybackError> {
        let mut inner = lock(&self.inner);
        verify_attempt(&mut inner, attempt_id)?;
        if inner.state == PlaybackState::Failed {
            return Ok(projection(&inner));
        }
        if !matches!(
            inner.state,
            PlaybackState::Starting | PlaybackState::Playing | PlaybackState::Paused
        ) {
            return Err(invalid_state(
                "Playback cannot fail from its current state.",
            ));
        }
        inner.state = PlaybackState::Failed;
        inner.revision += 1;
        inner.desired_action = PlaybackAdapterAction::None;
        inner.failure_reason = Some(reason_code);
        inner.failure_message = Some(message);
        inner.last_adapter_event = Some("adapter-failed".to_string());
        Ok(projection(&inner))
    }

    fn mutate(
        &self,
        request: PlaybackMutationRequest,
        operation: &str,
        required_state: PlaybackState,
        mutation: impl FnOnce(&mut PlaybackInner),
    ) -> Result<PlaybackProjection, PlaybackError> {
        let fingerprint = operation.to_string();
        let mut inner = lock(&self.inner);
        if let Some(cached) = cached_result(&mut inner, &request.request_id, &fingerprint)? {
            return cached;
        }
        let result = if inner.state != required_state {
            Err(invalid_state(format!(
                "Playback cannot {operation} from its current state."
            )))
        } else {
            mutation(&mut inner);
            Ok(projection(&inner))
        };
        cache_result(&mut inner, request.request_id, fingerprint, result.clone());
        result
    }
}

fn verify_attempt(inner: &mut PlaybackInner, attempt_id: &str) -> Result<(), PlaybackError> {
    if inner.attempt_id.as_deref() == Some(attempt_id) {
        return Ok(());
    }
    inner.stale_event_count += 1;
    Err(PlaybackError::new(
        PlaybackErrorCode::StaleAttempt,
        "This playback event belongs to an older attempt.",
    ))
}

fn cached_result(
    inner: &mut PlaybackInner,
    request_id: &str,
    fingerprint: &str,
) -> Result<Option<Result<PlaybackProjection, PlaybackError>>, PlaybackError> {
    let Some(cached) = inner
        .operations
        .iter()
        .find(|operation| operation.request_id == request_id)
    else {
        return Ok(None);
    };
    let cached_fingerprint = cached.fingerprint.clone();
    let cached_result = cached.result.clone();
    if cached_fingerprint != fingerprint {
        inner.idempotency_conflict_count += 1;
        return Err(PlaybackError::new(
            PlaybackErrorCode::RequestIdConflict,
            "This playback request ID was already used for another operation.",
        ));
    }
    inner.idempotency_hit_count += 1;
    Ok(Some(cached_result))
}

fn cache_result(
    inner: &mut PlaybackInner,
    request_id: String,
    fingerprint: String,
    result: Result<PlaybackProjection, PlaybackError>,
) {
    if inner.operations.len() == IDEMPOTENCY_CAPACITY {
        inner.operations.pop_front();
    }
    inner.operations.push_back(CachedOperation {
        request_id,
        fingerprint,
        result,
    });
}

fn projection(inner: &PlaybackInner) -> PlaybackProjection {
    PlaybackProjection {
        revision: inner.revision,
        state: inner.state,
        desired_action: inner.desired_action,
        attempt_id: inner.attempt_id.clone(),
        song: inner.song.clone(),
        failure_reason: inner.failure_reason,
        failure_message: inner.failure_message.clone(),
        diagnostics: PlaybackDiagnostics {
            last_adapter_event: inner.last_adapter_event.clone(),
            stale_event_count: inner.stale_event_count,
            idempotency_hit_count: inner.idempotency_hit_count,
            idempotency_conflict_count: inner.idempotency_conflict_count,
        },
    }
}

fn invalid_state(message: impl Into<String>) -> PlaybackError {
    PlaybackError::new(PlaybackErrorCode::InvalidState, message)
}

fn lock(inner: &Mutex<PlaybackInner>) -> std::sync::MutexGuard<'_, PlaybackInner> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
