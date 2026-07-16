use std::{
    collections::VecDeque,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::Duration,
};

use tauri::{Emitter, Manager};

use super::models::{
    AddSongToQueueRequest, MoveQueueEntryRequest, QueueCurrentProjection, QueueDiagnostics,
    QueueEntryProjection, QueueError, QueueErrorCode, QueueFailedProjection, QueueMutationRequest,
    QueueProjection, RemoveQueueEntryRequest, RemoveQueueVoteRequest, RetryFailedQueueEntryRequest,
    VoteForQueueEntryRequest,
};

const IDEMPOTENCY_CAPACITY: usize = 128;

#[derive(Debug, Clone)]
pub(crate) struct ValidatedQueueEntry {
    pub song_title: String,
    pub song_artist: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum EntryStatus {
    Queued,
    Launching(u64),
    Active(String),
    Failed(String),
}

#[derive(Debug, Clone)]
struct QueueEntryRecord {
    id: String,
    song_id: String,
    singer_id: String,
    song_title: String,
    song_artist: String,
    votes: Vec<String>,
    status: EntryStatus,
}

#[derive(Clone)]
struct CachedOperation {
    request_id: String,
    fingerprint: String,
}

struct QueueInner {
    revision: u64,
    entries: Vec<QueueEntryRecord>,
    next_entry_number: u64,
    next_launch_token: u64,
    progression_paused: bool,
    active_entry_id: Option<String>,
    preferred_entry_id: Option<String>,
    idempotency_hit_count: u64,
    idempotency_conflict_count: u64,
    operations: VecDeque<CachedOperation>,
    last_transition: Option<String>,
    last_failure: Option<String>,
    worker_failure: Option<String>,
}

impl Default for QueueInner {
    fn default() -> Self {
        Self {
            revision: 0,
            entries: Vec::new(),
            next_entry_number: 0,
            next_launch_token: 0,
            progression_paused: false,
            active_entry_id: None,
            preferred_entry_id: None,
            idempotency_hit_count: 0,
            idempotency_conflict_count: 0,
            operations: VecDeque::new(),
            last_transition: None,
            last_failure: None,
            worker_failure: None,
        }
    }
}

pub(crate) struct HostQueueCoordinator {
    operation: Mutex<()>,
    inner: Mutex<QueueInner>,
    pub(super) shutdown: AtomicBool,
    pub(super) worker: Mutex<Option<JoinHandle<()>>>,
}

impl Default for HostQueueCoordinator {
    fn default() -> Self {
        Self {
            operation: Mutex::new(()),
            inner: Mutex::new(QueueInner::default()),
            shutdown: AtomicBool::new(false),
            worker: Mutex::new(None),
        }
    }
}

impl HostQueueCoordinator {
    pub(crate) fn projection(
        &self,
        singers: &crate::session_singers::SessionSingerRegistry,
    ) -> QueueProjection {
        projection(&lock(&self.inner), |singer_id| {
            singers.get(singer_id).map(|singer| singer.display_name)
        })
    }

    #[cfg(test)]
    pub(crate) fn projection_for_test(&self) -> QueueProjection {
        projection(&lock(&self.inner), |singer_id| Some(singer_id.to_string()))
    }

    pub(crate) fn start_worker(self: &Arc<Self>, app: tauri::AppHandle) {
        let mut worker = lock(&self.worker);
        if worker.is_some() {
            return;
        }
        self.shutdown.store(false, Ordering::Release);
        let coordinator = Arc::clone(self);
        *worker = Some(std::thread::spawn(move || {
            let result = catch_unwind(AssertUnwindSafe(|| {
                while !coordinator.shutdown.load(Ordering::Acquire) {
                    coordinator.tick(&app);
                    std::thread::sleep(Duration::from_millis(100));
                }
            }));
            if result.is_err() {
                coordinator.record_worker_failure("Queue worker terminated unexpectedly.");
                let singers = app.state::<crate::session_singers::SessionSingerRegistry>();
                let _ = app.emit("queue-projection-changed", coordinator.projection(&singers));
            }
        }));
    }

    pub(crate) fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Release);
        if let Some(worker) = lock(&self.worker).take() {
            if worker.join().is_err() {
                self.record_worker_failure("Queue worker could not be joined cleanly.");
            }
        }
    }

    pub(crate) fn add_song<F>(
        &self,
        request: AddSongToQueueRequest,
        validate: F,
    ) -> Result<(), QueueError>
    where
        F: FnOnce() -> Result<ValidatedQueueEntry, QueueError>,
    {
        let _operation = lock(&self.operation);
        let fingerprint = format!("add:{}:{}", request.singer_id, request.song_id);
        {
            let mut inner = lock(&self.inner);
            if cached_success(&mut inner, &request.request_id, &fingerprint)? {
                return Ok(());
            }
        }

        let validated = validate()?;
        let mut inner = lock(&self.inner);
        inner.next_entry_number += 1;
        let entry_id = format!("queue-entry-{}", inner.next_entry_number);
        inner.entries.push(QueueEntryRecord {
            id: entry_id,
            song_id: request.song_id,
            singer_id: request.singer_id,
            song_title: validated.song_title,
            song_artist: validated.song_artist,
            votes: Vec::new(),
            status: EntryStatus::Queued,
        });
        changed(&mut inner, "song-added");
        cache_success(&mut inner, request.request_id, fingerprint);
        Ok(())
    }

    pub(crate) fn remove_entry(&self, request: RemoveQueueEntryRequest) -> Result<(), QueueError> {
        let _operation = lock(&self.operation);
        let fingerprint = format!("remove:{}", request.entry_id);
        let mut inner = lock(&self.inner);
        if cached_success(&mut inner, &request.request_id, &fingerprint)? {
            return Ok(());
        }
        let index = find_entry(&inner, &request.entry_id)?;
        if matches!(inner.entries[index].status, EntryStatus::Active(_)) {
            return Err(QueueError::new(
                QueueErrorCode::EntryLocked,
                "Stop the current Performance before removing this queue entry.",
            ));
        }
        let removed_id = inner.entries.remove(index).id;
        if inner.active_entry_id.as_deref() == Some(&removed_id) {
            inner.active_entry_id = None;
        }
        if inner.preferred_entry_id.as_deref() == Some(&removed_id) {
            inner.preferred_entry_id = None;
        }
        changed(&mut inner, "entry-removed");
        cache_success(&mut inner, request.request_id, fingerprint);
        Ok(())
    }

    pub(crate) fn move_entry(&self, request: MoveQueueEntryRequest) -> Result<(), QueueError> {
        let _operation = lock(&self.operation);
        let fingerprint = format!("move:{}:{}", request.entry_id, request.target_index);
        let mut inner = lock(&self.inner);
        if cached_success(&mut inner, &request.request_id, &fingerprint)? {
            return Ok(());
        }
        let entry_index = find_entry(&inner, &request.entry_id)?;
        if inner.entries[entry_index].status != EntryStatus::Queued {
            return Err(locked_error("Only future queue entries can be reordered."));
        }
        let queued_indices = queued_indices(&inner);
        let current = queued_indices
            .iter()
            .position(|index| *index == entry_index)
            .ok_or_else(|| locked_error("Only future queue entries can be reordered."))?;
        let target = request
            .target_index
            .min(queued_indices.len().saturating_sub(1));
        if current != target {
            let mut queued = queued_indices
                .iter()
                .map(|index| inner.entries[*index].clone())
                .collect::<Vec<_>>();
            let entry = queued.remove(current);
            queued.insert(target, entry);
            for (entry, index) in queued.into_iter().zip(queued_indices) {
                inner.entries[index] = entry;
            }
            changed(&mut inner, "entry-moved");
        }
        cache_success(&mut inner, request.request_id, fingerprint);
        Ok(())
    }

    pub(crate) fn vote_for_entry<F>(
        &self,
        request: VoteForQueueEntryRequest,
        validate_singer: F,
    ) -> Result<(), QueueError>
    where
        F: FnOnce() -> Result<(), QueueError>,
    {
        let _operation = lock(&self.operation);
        let fingerprint = format!("vote:{}:{}", request.entry_id, request.singer_id);
        {
            let mut inner = lock(&self.inner);
            if cached_success(&mut inner, &request.request_id, &fingerprint)? {
                return Ok(());
            }
        }
        validate_singer()?;
        let mut inner = lock(&self.inner);
        let index = find_entry(&inner, &request.entry_id)?;
        let entry = &mut inner.entries[index];
        if entry.status != EntryStatus::Queued {
            return Err(locked_error("Votes affect future queue entries only."));
        }
        if entry.votes.contains(&request.singer_id) {
            return Err(QueueError::new(
                QueueErrorCode::DuplicateVote,
                "This singer has already voted for this entry.",
            ));
        }
        entry.votes.push(request.singer_id);
        changed(&mut inner, "vote-added");
        cache_success(&mut inner, request.request_id, fingerprint);
        Ok(())
    }

    pub(crate) fn remove_vote<F>(
        &self,
        request: RemoveQueueVoteRequest,
        validate_singer: F,
    ) -> Result<(), QueueError>
    where
        F: FnOnce() -> Result<(), QueueError>,
    {
        let _operation = lock(&self.operation);
        let fingerprint = format!("unvote:{}:{}", request.entry_id, request.singer_id);
        {
            let mut inner = lock(&self.inner);
            if cached_success(&mut inner, &request.request_id, &fingerprint)? {
                return Ok(());
            }
        }
        validate_singer()?;
        let mut inner = lock(&self.inner);
        let index = find_entry(&inner, &request.entry_id)?;
        let entry = &mut inner.entries[index];
        if entry.status != EntryStatus::Queued {
            return Err(locked_error("Votes affect future queue entries only."));
        }
        let vote_index = entry
            .votes
            .iter()
            .position(|singer_id| singer_id == &request.singer_id)
            .ok_or_else(|| {
                QueueError::new(
                    QueueErrorCode::VoteNotFound,
                    "This singer has not voted for this entry.",
                )
            })?;
        entry.votes.remove(vote_index);
        changed(&mut inner, "vote-removed");
        cache_success(&mut inner, request.request_id, fingerprint);
        Ok(())
    }

    pub(crate) fn pause_progression(
        &self,
        request: QueueMutationRequest,
    ) -> Result<(), QueueError> {
        let _operation = lock(&self.operation);
        let fingerprint = "pause".to_string();
        let mut inner = lock(&self.inner);
        if cached_success(&mut inner, &request.request_id, &fingerprint)? {
            return Ok(());
        }
        if !inner.progression_paused {
            inner.progression_paused = true;
            if let Some(index) = active_entry_index(&inner) {
                if matches!(inner.entries[index].status, EntryStatus::Launching(_)) {
                    inner.entries[index].status = EntryStatus::Queued;
                    inner.active_entry_id = None;
                }
            }
            changed(&mut inner, "progression-paused");
        }
        cache_success(&mut inner, request.request_id, fingerprint);
        Ok(())
    }

    pub(crate) fn resume_progression(
        &self,
        request: QueueMutationRequest,
    ) -> Result<(), QueueError> {
        let _operation = lock(&self.operation);
        let fingerprint = "resume".to_string();
        let mut inner = lock(&self.inner);
        if cached_success(&mut inner, &request.request_id, &fingerprint)? {
            return Ok(());
        }
        if inner.progression_paused {
            inner.progression_paused = false;
            changed(&mut inner, "progression-resumed");
        }
        cache_success(&mut inner, request.request_id, fingerprint);
        Ok(())
    }

    pub(crate) fn skip_current<F>(
        &self,
        request: QueueMutationRequest,
        stop_performance: F,
    ) -> Result<(), QueueError>
    where
        F: FnOnce(&str) -> Result<(), QueueError>,
    {
        let _operation = lock(&self.operation);
        let fingerprint = "skip-current".to_string();
        let (entry_id, performance_id) = {
            let mut inner = lock(&self.inner);
            if cached_success(&mut inner, &request.request_id, &fingerprint)? {
                return Ok(());
            }
            let Some(index) = active_entry_index(&inner) else {
                cache_success(&mut inner, request.request_id, fingerprint);
                return Ok(());
            };
            let entry = &inner.entries[index];
            let performance_id = match &entry.status {
                EntryStatus::Active(performance_id) => Some(performance_id.clone()),
                EntryStatus::Launching(_) => None,
                _ => return Err(locked_error("The selected entry is not active.")),
            };
            (entry.id.clone(), performance_id)
        };

        if let Some(performance_id) = performance_id {
            stop_performance(&performance_id)?;
        }

        let mut inner = lock(&self.inner);
        if let Some(index) = inner.entries.iter().position(|entry| entry.id == entry_id) {
            inner.entries.remove(index);
        }
        if inner.active_entry_id.as_deref() == Some(&entry_id) {
            inner.active_entry_id = None;
        }
        changed(&mut inner, "entry-skipped");
        cache_success(&mut inner, request.request_id, fingerprint);
        Ok(())
    }

    pub(crate) fn retry_failed(
        &self,
        request: RetryFailedQueueEntryRequest,
    ) -> Result<(), QueueError> {
        let _operation = lock(&self.operation);
        let fingerprint = format!("retry:{}", request.entry_id);
        let mut inner = lock(&self.inner);
        if cached_success(&mut inner, &request.request_id, &fingerprint)? {
            return Ok(());
        }
        let index = find_entry(&inner, &request.entry_id)?;
        if !matches!(inner.entries[index].status, EntryStatus::Failed(_)) {
            return Err(QueueError::new(
                QueueErrorCode::InvalidState,
                "Only a failed queue entry can be retried.",
            ));
        }
        inner.entries[index].status = EntryStatus::Queued;
        inner.preferred_entry_id = Some(request.entry_id);
        inner.progression_paused = false;
        inner.last_failure = None;
        changed(&mut inner, "entry-retried");
        cache_success(&mut inner, request.request_id, fingerprint);
        Ok(())
    }

    pub(crate) fn with_singer_reference_guard<T>(
        &self,
        singer_id: &str,
        action: impl FnOnce(bool) -> T,
    ) -> T {
        let _operation = lock(&self.operation);
        let inner = lock(&self.inner);
        let referenced = inner.entries.iter().any(|entry| {
            (!matches!(entry.status, EntryStatus::Failed(_)) && entry.singer_id == singer_id)
                || entry.votes.iter().any(|voter| voter == singer_id)
        });
        drop(inner);
        action(referenced)
    }

    fn tick(&self, app: &tauri::AppHandle) {
        let performance = app.state::<Arc<crate::performance::HostPerformanceCoordinator>>();
        let singers = app.state::<crate::session_singers::SessionSingerRegistry>();
        let playback = app.state::<crate::playback::HostPlaybackCoordinator>();
        let changed = self.tick_internal(
            &performance,
            !playback.projection().state.is_active(),
            |request| {
                crate::performance::create_performance_owned(
                    app,
                    request,
                    &performance,
                    &singers,
                    &playback,
                )
            },
            |performance_id| {
                crate::performance::cancel_preparation_owned(
                    app,
                    crate::performance::PerformanceMutationRequest {
                        request_id: format!("queue-stale-launch:{performance_id}"),
                        performance_id: performance_id.to_string(),
                    },
                    &performance,
                    &playback,
                )
                .map(|_| ())
            },
        );
        if changed {
            let _ = app.emit("queue-projection-changed", self.projection(&singers));
        }
    }

    pub(crate) fn tick_internal<Create, Cancel>(
        &self,
        performance: &crate::performance::HostPerformanceCoordinator,
        playback_available: bool,
        create_performance: Create,
        cancel_stale: Cancel,
    ) -> bool
    where
        Create: FnOnce(
            crate::performance::CreatePerformanceRequest,
        ) -> Result<
            crate::performance::PerformanceProjection,
            crate::performance::PerformanceError,
        >,
        Cancel: FnOnce(&str) -> Result<(), crate::performance::PerformanceError>,
    {
        let mut changed_any = false;
        let launch = {
            let _operation = lock(&self.operation);
            let mut inner = lock(&self.inner);
            changed_any |= reconcile_active(&mut inner, performance);

            if inner.active_entry_id.is_some() || inner.progression_paused || !playback_available {
                None
            } else if performance
                .projection()
                .active
                .as_ref()
                .is_some_and(|active| !active.state.is_terminal())
            {
                None
            } else {
                let next_id = choose_next_entry(&inner);
                next_id.map(|entry_id| {
                    inner.next_launch_token += 1;
                    let token = inner.next_launch_token;
                    let index = inner
                        .entries
                        .iter()
                        .position(|entry| entry.id == entry_id)
                        .expect("selected queue entry exists");
                    inner.entries[index].status = EntryStatus::Launching(token);
                    inner.active_entry_id = Some(entry_id.clone());
                    if inner.preferred_entry_id.as_deref() == Some(&entry_id) {
                        inner.preferred_entry_id = None;
                    }
                    let entry = &inner.entries[index];
                    let request = crate::performance::CreatePerformanceRequest {
                        request_id: format!("{}:launch:{token}", entry.id),
                        singer_id: entry.singer_id.clone(),
                        song_id: entry.song_id.clone(),
                    };
                    changed(&mut inner, "performance-launch-requested");
                    changed_any = true;
                    (entry_id, token, request)
                })
            }
        };

        let Some((entry_id, token, request)) = launch else {
            return changed_any;
        };
        let result = create_performance(request);
        let mut stale_performance = None;
        {
            let _operation = lock(&self.operation);
            let mut inner = lock(&self.inner);
            let launch_is_current = !inner.progression_paused
                && inner.active_entry_id.as_deref() == Some(&entry_id)
                && inner.entries.iter().any(|entry| {
                    entry.id == entry_id && entry.status == EntryStatus::Launching(token)
                });
            match result {
                Ok(projection) => {
                    let performance_id = projection.active.map(|active| active.id);
                    if launch_is_current {
                        if let Some(performance_id) = performance_id {
                            let index = inner
                                .entries
                                .iter()
                                .position(|entry| entry.id == entry_id)
                                .expect("launching queue entry exists");
                            inner.entries[index].status = EntryStatus::Active(performance_id);
                            changed(&mut inner, "performance-linked");
                            changed_any = true;
                        } else {
                            let index = inner
                                .entries
                                .iter()
                                .position(|entry| entry.id == entry_id)
                                .expect("launching queue entry exists");
                            inner.entries[index].status = EntryStatus::Failed(
                                "Performance creation returned no active Performance.".to_string(),
                            );
                            inner.entries[index].votes.clear();
                            inner.active_entry_id = None;
                            inner.progression_paused = true;
                            inner.last_failure = Some(
                                "Performance creation returned no active Performance.".to_string(),
                            );
                            changed(&mut inner, "performance-create-invalid-projection");
                            changed_any = true;
                        }
                    } else {
                        stale_performance = performance_id;
                    }
                }
                Err(error) if launch_is_current => {
                    let index = inner
                        .entries
                        .iter()
                        .position(|entry| entry.id == entry_id)
                        .expect("launching queue entry exists");
                    if error.reason_code
                        == crate::performance::PerformanceErrorCode::PerformanceActive
                    {
                        inner.entries[index].status = EntryStatus::Queued;
                        inner.active_entry_id = None;
                        changed(&mut inner, "performance-busy");
                    } else {
                        inner.entries[index].status = EntryStatus::Failed(error.message.clone());
                        inner.entries[index].votes.clear();
                        inner.active_entry_id = None;
                        inner.progression_paused = true;
                        inner.last_failure = Some(error.message);
                        changed(&mut inner, "performance-create-failed");
                    }
                    changed_any = true;
                }
                Err(_) => {}
            }
        }
        if let Some(performance_id) = stale_performance {
            if let Err(error) = cancel_stale(&performance_id) {
                let _operation = lock(&self.operation);
                let mut inner = lock(&self.inner);
                inner.progression_paused = true;
                inner.last_failure = Some(format!(
                    "A superseded Performance could not be cancelled: {}",
                    error.message
                ));
                changed(&mut inner, "stale-performance-cancel-failed");
                changed_any = true;
            }
        }
        changed_any
    }

    fn record_worker_failure(&self, message: &str) {
        let mut inner = lock(&self.inner);
        inner.worker_failure = Some(message.to_string());
        inner.progression_paused = true;
        changed(&mut inner, "worker-failed");
    }
}

fn reconcile_active(
    inner: &mut QueueInner,
    performance: &crate::performance::HostPerformanceCoordinator,
) -> bool {
    let Some(index) = active_entry_index(inner) else {
        return false;
    };
    let EntryStatus::Active(performance_id) = inner.entries[index].status.clone() else {
        return false;
    };
    match performance.lifecycle_for(&performance_id) {
        Some(crate::performance::PerformanceLifecycleState::Completed)
        | Some(crate::performance::PerformanceLifecycleState::Stopped) => {
            inner.entries.remove(index);
            inner.active_entry_id = None;
            changed(inner, "performance-terminal:advance");
            true
        }
        Some(crate::performance::PerformanceLifecycleState::Failed) => {
            inner.entries[index].status = EntryStatus::Failed("Performance failed.".to_string());
            inner.entries[index].votes.clear();
            inner.active_entry_id = None;
            inner.progression_paused = true;
            inner.last_failure = Some("Performance failed.".to_string());
            changed(inner, "performance-failed");
            true
        }
        _ => false,
    }
}

fn choose_next_entry(inner: &QueueInner) -> Option<String> {
    if let Some(preferred) = inner.preferred_entry_id.as_ref() {
        if inner
            .entries
            .iter()
            .any(|entry| &entry.id == preferred && entry.status == EntryStatus::Queued)
        {
            return Some(preferred.clone());
        }
    }
    resolve_queue_order(
        &inner
            .entries
            .iter()
            .filter(|entry| entry.status == EntryStatus::Queued)
            .cloned()
            .collect::<Vec<_>>(),
    )
    .first()
    .map(|entry| entry.id.clone())
}

fn projection(inner: &QueueInner, singer_name: impl Fn(&str) -> Option<String>) -> QueueProjection {
    let make_entry = |entry: &QueueEntryRecord| QueueEntryProjection {
        id: entry.id.clone(),
        song_id: entry.song_id.clone(),
        requester_singer_id: entry.singer_id.clone(),
        requester_display_name: singer_name(&entry.singer_id)
            .unwrap_or_else(|| "Singer unavailable".to_string()),
        song_title: entry.song_title.clone(),
        song_artist: entry.song_artist.clone(),
        vote_count: entry.votes.len(),
    };
    let current = inner.active_entry_id.as_ref().and_then(|active_id| {
        inner
            .entries
            .iter()
            .find(|entry| &entry.id == active_id)
            .map(|entry| QueueCurrentProjection {
                entry: make_entry(entry),
                performance_id: match &entry.status {
                    EntryStatus::Active(performance_id) => Some(performance_id.clone()),
                    _ => None,
                },
            })
    });
    let queued_records = inner
        .entries
        .iter()
        .filter(|entry| entry.status == EntryStatus::Queued)
        .cloned()
        .collect::<Vec<_>>();
    let queued = resolve_queue_order(&queued_records)
        .iter()
        .map(&make_entry)
        .collect();
    let failed = inner
        .entries
        .iter()
        .filter_map(|entry| match &entry.status {
            EntryStatus::Failed(message) => Some(QueueFailedProjection {
                entry: make_entry(entry),
                message: message.clone(),
            }),
            _ => None,
        })
        .collect();
    let linked_performance_id = current
        .as_ref()
        .and_then(|current| current.performance_id.clone());
    QueueProjection {
        revision: inner.revision,
        current,
        queued,
        failed,
        progression_paused: inner.progression_paused,
        diagnostics: QueueDiagnostics {
            active_queue_count: inner
                .entries
                .iter()
                .filter(|entry| !matches!(entry.status, EntryStatus::Failed(_)))
                .count(),
            current_entry_id: inner.active_entry_id.clone(),
            linked_performance_id,
            progression_paused: inner.progression_paused,
            last_transition: inner.last_transition.clone(),
            last_failure: inner.last_failure.clone(),
            worker_failure: inner.worker_failure.clone(),
            idempotency_hit_count: inner.idempotency_hit_count,
            idempotency_conflict_count: inner.idempotency_conflict_count,
        },
    }
}

fn resolve_queue_order(base_queued: &[QueueEntryRecord]) -> Vec<QueueEntryRecord> {
    let mut entries_with_base = base_queued.iter().cloned().enumerate().collect::<Vec<_>>();
    for index in 1..entries_with_base.len() {
        let mut position = index;
        while position > 0 {
            let left_votes = entries_with_base[position - 1].1.votes.len();
            let right_votes = entries_with_base[position].1.votes.len();
            let right_base = entries_with_base[position].0;
            if right_votes > left_votes && position > right_base.saturating_sub(5) {
                entries_with_base.swap(position - 1, position);
                position -= 1;
            } else {
                break;
            }
        }
    }
    entries_with_base
        .into_iter()
        .map(|(_, entry)| entry)
        .collect()
}

fn queued_indices(inner: &QueueInner) -> Vec<usize> {
    inner
        .entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| entry.status == EntryStatus::Queued)
        .map(|(index, _)| index)
        .collect()
}

fn active_entry_index(inner: &QueueInner) -> Option<usize> {
    inner
        .active_entry_id
        .as_ref()
        .and_then(|id| inner.entries.iter().position(|entry| &entry.id == id))
}

fn find_entry(inner: &QueueInner, entry_id: &str) -> Result<usize, QueueError> {
    inner
        .entries
        .iter()
        .position(|entry| entry.id == entry_id)
        .ok_or_else(|| {
            QueueError::new(
                QueueErrorCode::EntryNotFound,
                "The selected queue entry was not found.",
            )
        })
}

fn cached_success(
    inner: &mut QueueInner,
    request_id: &str,
    fingerprint: &str,
) -> Result<bool, QueueError> {
    let Some(cached) = inner
        .operations
        .iter()
        .find(|operation| operation.request_id == request_id)
    else {
        return Ok(false);
    };
    if cached.fingerprint != fingerprint {
        inner.idempotency_conflict_count += 1;
        return Err(QueueError::new(
            QueueErrorCode::RequestIdConflict,
            "This request ID was already used for another queue operation.",
        ));
    }
    inner.idempotency_hit_count += 1;
    Ok(true)
}

fn cache_success(inner: &mut QueueInner, request_id: String, fingerprint: String) {
    if inner.operations.len() == IDEMPOTENCY_CAPACITY {
        inner.operations.pop_front();
    }
    inner.operations.push_back(CachedOperation {
        request_id,
        fingerprint,
    });
}

fn changed(inner: &mut QueueInner, transition: &str) {
    inner.revision += 1;
    inner.last_transition = Some(transition.to_string());
}

fn locked_error(message: &str) -> QueueError {
    QueueError::new(QueueErrorCode::EntryLocked, message)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
