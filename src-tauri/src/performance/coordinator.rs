use std::{
    collections::VecDeque,
    sync::{atomic::AtomicBool, Mutex},
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::{
    microphones::{PerformanceMicrophoneReadiness, PerformanceMicrophoneReadinessStatus},
    playback::{PlaybackProjection, PlaybackState},
};

use super::models::{
    CreatePerformanceRequest, PerformanceDetailsProjection, PerformanceDiagnostics,
    PerformanceError, PerformanceErrorCode, PerformanceFailureProjection,
    PerformanceLifecycleState, PerformanceMutationRequest, PerformancePlaybackProjection,
    PerformanceProjection, PerformanceSingerProjection, PerformanceSongProjection,
    PerformanceTerminalReason,
};

pub(crate) const COUNTDOWN_DURATION: Duration = Duration::from_secs(3);
pub(crate) const RESULTS_DURATION: Duration = Duration::from_secs(10);
const IDEMPOTENCY_CAPACITY: usize = 128;

#[derive(Clone)]
struct CachedOperation {
    request_id: String,
    fingerprint: String,
    result: Result<PerformanceProjection, PerformanceError>,
}

struct ActivePerformance {
    id: String,
    state: PerformanceLifecycleState,
    performer: PerformanceSingerProjection,
    song: PerformanceSongProjection,
    readiness: PerformanceMicrophoneReadiness,
    countdown_deadline: Option<Instant>,
    countdown_deadline_unix_ms: Option<u64>,
    results_deadline: Option<Instant>,
    results_deadline_unix_ms: Option<u64>,
    playback_attempt_id: Option<String>,
    playback_request_number: u64,
    playback_state: PlaybackState,
    terminal_reason: Option<PerformanceTerminalReason>,
    failure: Option<PerformanceFailureProjection>,
}

struct PerformanceInner {
    revision: u64,
    next_performance_number: u64,
    active: Option<ActivePerformance>,
    last_transition: Option<String>,
    stale_playback_event_count: u64,
    idempotency_hit_count: u64,
    idempotency_conflict_count: u64,
    operations: VecDeque<CachedOperation>,
}

impl Default for PerformanceInner {
    fn default() -> Self {
        Self {
            revision: 0,
            next_performance_number: 0,
            active: None,
            last_transition: None,
            stale_playback_event_count: 0,
            idempotency_hit_count: 0,
            idempotency_conflict_count: 0,
            operations: VecDeque::new(),
        }
    }
}

pub(crate) struct HostPerformanceCoordinator {
    operation: Mutex<()>,
    inner: Mutex<PerformanceInner>,
    pub(super) shutdown: AtomicBool,
    pub(super) worker: Mutex<Option<JoinHandle<()>>>,
}

impl Default for HostPerformanceCoordinator {
    fn default() -> Self {
        Self {
            operation: Mutex::new(()),
            inner: Mutex::new(PerformanceInner::default()),
            shutdown: AtomicBool::new(false),
            worker: Mutex::new(None),
        }
    }
}

impl HostPerformanceCoordinator {
    pub(crate) fn projection(&self) -> PerformanceProjection {
        projection(&lock(&self.inner), Instant::now())
    }

    pub(crate) fn create_validated(
        &self,
        request: CreatePerformanceRequest,
        performer: PerformanceSingerProjection,
        song: PerformanceSongProjection,
        readiness: PerformanceMicrophoneReadiness,
    ) -> Result<PerformanceProjection, PerformanceError> {
        let _operation = lock(&self.operation);
        let fingerprint = format!("create:{}:{}", request.singer_id, request.song_id);
        let mut inner = lock(&self.inner);
        if let Some(cached) = cached_result(&mut inner, &request.request_id, &fingerprint)? {
            return match cached {
                Ok(_) => Ok(projection(&inner, Instant::now())),
                Err(error) => Err(error),
            };
        }
        let result = if inner
            .active
            .as_ref()
            .is_some_and(|performance| !performance.state.is_terminal())
        {
            Err(PerformanceError::new(
                PerformanceErrorCode::PerformanceActive,
                "Finish or stop the current Performance before creating another one.",
            ))
        } else {
            inner.next_performance_number += 1;
            inner.active = Some(ActivePerformance {
                id: format!("performance-{}", inner.next_performance_number),
                state: PerformanceLifecycleState::Created,
                performer,
                song,
                readiness,
                countdown_deadline: None,
                countdown_deadline_unix_ms: None,
                results_deadline: None,
                results_deadline_unix_ms: None,
                playback_attempt_id: None,
                playback_request_number: 0,
                playback_state: PlaybackState::Idle,
                terminal_reason: None,
                failure: None,
            });
            transition(&mut inner, PerformanceLifecycleState::Preparing);
            Ok(projection(&inner, Instant::now()))
        };
        cache_result(&mut inner, request.request_id, fingerprint, result.clone());
        result
    }

    pub(crate) fn apply_readiness(
        &self,
        performance_id: &str,
        readiness: PerformanceMicrophoneReadiness,
        now: Instant,
    ) -> Result<PerformanceProjection, PerformanceError> {
        let _operation = lock(&self.operation);
        let mut inner = lock(&self.inner);
        let state = {
            let active = require_active_mut(&mut inner, performance_id)?;
            if active.state.is_terminal() {
                return Err(terminal_error());
            }
            active.readiness = readiness;
            active.state
        };
        let status = inner
            .active
            .as_ref()
            .expect("active Performance")
            .readiness
            .status;
        match (state, status) {
            (PerformanceLifecycleState::Preparing, PerformanceMicrophoneReadinessStatus::Ready) => {
                transition(&mut inner, PerformanceLifecycleState::Ready);
                begin_countdown(&mut inner, now);
            }
            (PerformanceLifecycleState::Countdown, readiness_status)
                if readiness_status != PerformanceMicrophoneReadinessStatus::Ready =>
            {
                let active = inner.active.as_mut().expect("active Performance");
                clear_countdown(active);
                if active.playback_state == PlaybackState::Starting {
                    active.playback_attempt_id = None;
                    active.playback_state = PlaybackState::Idle;
                }
                transition(&mut inner, PerformanceLifecycleState::Preparing);
            }
            _ => inner.revision += 1,
        }
        Ok(projection(&inner, now))
    }

    pub(crate) fn countdown_is_due(&self, now: Instant) -> bool {
        let _operation = lock(&self.operation);
        let inner = lock(&self.inner);
        let Some(active) = inner.active.as_ref() else {
            return false;
        };
        active.state == PerformanceLifecycleState::Countdown
            && active.playback_attempt_id.is_none()
            && active
                .countdown_deadline
                .is_some_and(|deadline| now >= deadline)
            && active.readiness.status == PerformanceMicrophoneReadinessStatus::Ready
    }

    pub(crate) fn countdown_action(&self, now: Instant) -> Option<(String, String, String)> {
        let _operation = lock(&self.operation);
        let mut inner = lock(&self.inner);
        let active = inner.active.as_mut()?;
        if active.state != PerformanceLifecycleState::Countdown
            || active.playback_attempt_id.is_some()
            || !active
                .countdown_deadline
                .is_some_and(|deadline| now >= deadline)
            || active.readiness.status != PerformanceMicrophoneReadinessStatus::Ready
        {
            return None;
        }
        active.playback_request_number += 1;
        Some((
            active.id.clone(),
            active.song.id.clone(),
            format!("{}:playback:{}", active.id, active.playback_request_number),
        ))
    }

    pub(crate) fn link_playback(
        &self,
        performance_id: &str,
        playback: &PlaybackProjection,
    ) -> Result<PerformanceProjection, PerformanceError> {
        let _operation = lock(&self.operation);
        let mut inner = lock(&self.inner);
        let active = require_active_mut(&mut inner, performance_id)?;
        if active.state != PerformanceLifecycleState::Countdown {
            return Err(invalid_state(
                "Playback may start only during Performance countdown.",
            ));
        }
        active.playback_attempt_id = playback.attempt_id.clone();
        active.playback_state = playback.state;
        inner.revision += 1;
        inner.last_transition = Some("countdown:playback-start-requested".to_string());
        Ok(projection(&inner, Instant::now()))
    }

    pub(crate) fn fail_start(
        &self,
        performance_id: &str,
        reason_code: PerformanceErrorCode,
        message: String,
    ) -> Result<PerformanceProjection, PerformanceError> {
        let _operation = lock(&self.operation);
        let mut inner = lock(&self.inner);
        require_active_mut(&mut inner, performance_id)?.failure =
            Some(PerformanceFailureProjection {
                reason_code,
                message,
            });
        transition(&mut inner, PerformanceLifecycleState::Failed);
        Ok(projection(&inner, Instant::now()))
    }

    pub(crate) fn observe_playback(
        &self,
        playback: &PlaybackProjection,
        now: Instant,
    ) -> Option<PerformanceProjection> {
        let _operation = lock(&self.operation);
        let mut inner = lock(&self.inner);
        let active = inner.active.as_mut()?;
        if active.playback_attempt_id.as_deref() != playback.attempt_id.as_deref() {
            inner.stale_playback_event_count += 1;
            inner.revision += 1;
            return Some(projection(&inner, now));
        }
        if active.state.is_terminal() {
            return Some(projection(&inner, now));
        }
        active.playback_state = playback.state;
        let state = active.state;
        match playback.state {
            PlaybackState::Playing if state == PerformanceLifecycleState::Countdown => {
                clear_countdown(inner.active.as_mut().expect("active Performance"));
                transition(&mut inner, PerformanceLifecycleState::Playing);
            }
            PlaybackState::Completed if state == PerformanceLifecycleState::Playing => {
                transition(&mut inner, PerformanceLifecycleState::Finalizing);
            }
            PlaybackState::Failed => {
                inner.active.as_mut().expect("active Performance").failure =
                    Some(PerformanceFailureProjection {
                        reason_code: PerformanceErrorCode::PlaybackFailed,
                        message: playback.failure_message.clone().unwrap_or_else(|| {
                            "Playback failed during this Performance.".to_string()
                        }),
                    });
                transition(&mut inner, PerformanceLifecycleState::Failed);
            }
            _ => inner.revision += 1,
        }
        Some(projection(&inner, now))
    }

    pub(crate) fn advance_finalizing(&self, now: Instant) -> Option<PerformanceProjection> {
        let _operation = lock(&self.operation);
        let mut inner = lock(&self.inner);
        if inner.active.as_ref()?.state != PerformanceLifecycleState::Finalizing {
            return None;
        }
        begin_results(&mut inner, now);
        Some(projection(&inner, now))
    }

    pub(crate) fn complete_results_if_due(&self, now: Instant) -> Option<PerformanceProjection> {
        let _operation = lock(&self.operation);
        let mut inner = lock(&self.inner);
        let active = inner.active.as_ref()?;
        if active.state != PerformanceLifecycleState::Results
            || !active
                .results_deadline
                .is_some_and(|deadline| now >= deadline)
        {
            return None;
        }
        transition(&mut inner, PerformanceLifecycleState::Completed);
        Some(projection(&inner, now))
    }

    pub(crate) fn cancel(
        &self,
        request: PerformanceMutationRequest,
    ) -> Result<PerformanceProjection, PerformanceError> {
        self.stop_with_reason(
            request,
            "cancel",
            PerformanceTerminalReason::CancelledBeforePlayback,
            |state| {
                matches!(
                    state,
                    PerformanceLifecycleState::Created
                        | PerformanceLifecycleState::Preparing
                        | PerformanceLifecycleState::Ready
                        | PerformanceLifecycleState::Countdown
                )
            },
        )
    }

    pub(crate) fn skip(
        &self,
        request: PerformanceMutationRequest,
    ) -> Result<PerformanceProjection, PerformanceError> {
        self.stop_with_reason(
            request,
            "skip",
            PerformanceTerminalReason::SkippedByOperator,
            |state| {
                matches!(
                    state,
                    PerformanceLifecycleState::Countdown | PerformanceLifecycleState::Playing
                )
            },
        )
    }

    fn stop_with_reason(
        &self,
        request: PerformanceMutationRequest,
        operation_name: &str,
        reason: PerformanceTerminalReason,
        allowed: impl FnOnce(PerformanceLifecycleState) -> bool,
    ) -> Result<PerformanceProjection, PerformanceError> {
        let _operation = lock(&self.operation);
        let fingerprint = format!("{operation_name}:{}", request.performance_id);
        let mut inner = lock(&self.inner);
        if let Some(cached) = cached_result(&mut inner, &request.request_id, &fingerprint)? {
            return cached;
        }
        let result = match require_active_mut(&mut inner, &request.performance_id) {
            Err(error) => Err(error),
            Ok(active) if active.state.is_terminal() => Err(terminal_error()),
            Ok(active) if !allowed(active.state) => Err(invalid_state(format!(
                "Performance cannot {operation_name} from its current state."
            ))),
            Ok(active) => {
                active.terminal_reason = Some(reason);
                clear_countdown(active);
                active.results_deadline = None;
                active.results_deadline_unix_ms = None;
                transition(&mut inner, PerformanceLifecycleState::Stopped);
                Ok(projection(&inner, Instant::now()))
            }
        };
        cache_result(&mut inner, request.request_id, fingerprint, result.clone());
        result
    }

    pub(crate) fn playback_attempt_for(&self, performance_id: &str) -> Option<String> {
        lock(&self.inner).active.as_ref().and_then(|active| {
            (active.id == performance_id)
                .then(|| active.playback_attempt_id.clone())
                .flatten()
        })
    }

    pub(crate) fn has_active_singer(&self, singer_id: &str) -> bool {
        lock(&self.inner)
            .active
            .as_ref()
            .is_some_and(|active| !active.state.is_terminal() && active.performer.id == singer_id)
    }
}

fn begin_countdown(inner: &mut PerformanceInner, now: Instant) {
    let active = inner.active.as_mut().expect("active Performance required");
    active.countdown_deadline = Some(now + COUNTDOWN_DURATION);
    active.countdown_deadline_unix_ms = Some(unix_ms_now() + COUNTDOWN_DURATION.as_millis() as u64);
    transition(inner, PerformanceLifecycleState::Countdown);
}

fn begin_results(inner: &mut PerformanceInner, now: Instant) {
    let active = inner.active.as_mut().expect("active Performance required");
    active.results_deadline = Some(now + RESULTS_DURATION);
    active.results_deadline_unix_ms = Some(unix_ms_now() + RESULTS_DURATION.as_millis() as u64);
    transition(inner, PerformanceLifecycleState::Results);
}

fn clear_countdown(active: &mut ActivePerformance) {
    active.countdown_deadline = None;
    active.countdown_deadline_unix_ms = None;
}

fn transition(inner: &mut PerformanceInner, next: PerformanceLifecycleState) {
    let active = inner.active.as_mut().expect("active Performance required");
    let prior = active.state;
    active.state = next;
    inner.revision += 1;
    inner.last_transition = Some(format!("{prior:?}->{next:?}"));
}

fn projection(inner: &PerformanceInner, now: Instant) -> PerformanceProjection {
    PerformanceProjection {
        revision: inner.revision,
        active: inner
            .active
            .as_ref()
            .map(|active| PerformanceDetailsProjection {
                id: active.id.clone(),
                state: active.state,
                performer: active.performer.clone(),
                song: active.song.clone(),
                countdown_deadline_unix_ms: active.countdown_deadline_unix_ms,
                countdown_remaining_ms: remaining(active.countdown_deadline, now),
                results_deadline_unix_ms: active.results_deadline_unix_ms,
                results_remaining_ms: remaining(active.results_deadline, now),
                readiness: active.readiness.clone(),
                playback: PerformancePlaybackProjection {
                    attempt_id: active.playback_attempt_id.clone(),
                    state: format!("{:?}", active.playback_state).to_lowercase(),
                    startup_pending: active.state == PerformanceLifecycleState::Countdown
                        && active.playback_attempt_id.is_some()
                        && active.playback_state == PlaybackState::Starting,
                },
                terminal_reason: active.terminal_reason,
                failure: active.failure.clone(),
            }),
        diagnostics: PerformanceDiagnostics {
            last_transition: inner.last_transition.clone(),
            stale_playback_event_count: inner.stale_playback_event_count,
            idempotency_hit_count: inner.idempotency_hit_count,
            idempotency_conflict_count: inner.idempotency_conflict_count,
        },
    }
}

fn remaining(deadline: Option<Instant>, now: Instant) -> Option<u64> {
    deadline.map(|deadline| deadline.saturating_duration_since(now).as_millis() as u64)
}

fn unix_ms_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn require_active_mut<'a>(
    inner: &'a mut PerformanceInner,
    performance_id: &str,
) -> Result<&'a mut ActivePerformance, PerformanceError> {
    inner
        .active
        .as_mut()
        .filter(|active| active.id == performance_id)
        .ok_or_else(|| {
            PerformanceError::new(
                PerformanceErrorCode::PerformanceNotFound,
                "This Performance is no longer available.",
            )
        })
}

fn cached_result(
    inner: &mut PerformanceInner,
    request_id: &str,
    fingerprint: &str,
) -> Result<Option<Result<PerformanceProjection, PerformanceError>>, PerformanceError> {
    let Some(cached) = inner
        .operations
        .iter()
        .find(|entry| entry.request_id == request_id)
    else {
        return Ok(None);
    };
    let cached_fingerprint = cached.fingerprint.clone();
    let cached_result = cached.result.clone();
    if cached_fingerprint != fingerprint {
        inner.idempotency_conflict_count += 1;
        return Err(PerformanceError::new(
            PerformanceErrorCode::RequestIdConflict,
            "This Performance request ID was already used for another operation.",
        ));
    }
    inner.idempotency_hit_count += 1;
    Ok(Some(cached_result))
}

fn cache_result(
    inner: &mut PerformanceInner,
    request_id: String,
    fingerprint: String,
    result: Result<PerformanceProjection, PerformanceError>,
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

fn terminal_error() -> PerformanceError {
    PerformanceError::new(
        PerformanceErrorCode::PerformanceTerminal,
        "A terminal Performance cannot be changed. Create a new Performance to retry.",
    )
}

fn invalid_state(message: impl Into<String>) -> PerformanceError {
    PerformanceError::new(PerformanceErrorCode::InvalidState, message)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
