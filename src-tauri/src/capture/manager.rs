use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::JoinHandle,
    time::Duration,
};

use super::{
    backend::{CaptureBackend, CaptureEnd, PlatformCaptureBackend},
    models::{DiagnosticCaptureSnapshot, DiagnosticCaptureStatus, MicrophoneLevelSnapshot},
};

const DIAGNOSTIC_CAPTURE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const CAPTURE_START_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
struct DiagnosticChannel {
    id: String,
    source_id: String,
}

struct ActiveCapture {
    stop: mpsc::Sender<()>,
    worker: JoinHandle<()>,
}

struct ManagerInner {
    channels: HashMap<String, DiagnosticChannel>,
    active: Option<ActiveCapture>,
    snapshot: DiagnosticCaptureSnapshot,
}

pub(crate) struct DiagnosticCaptureManager {
    operations: Mutex<()>,
    inner: Arc<Mutex<ManagerInner>>,
    backend: Arc<dyn CaptureBackend>,
    next_session: AtomicU64,
    session_timeout: Duration,
}

impl DiagnosticCaptureManager {
    pub(crate) fn new() -> Self {
        Self::with_backend(Arc::new(PlatformCaptureBackend), DIAGNOSTIC_CAPTURE_TIMEOUT)
    }

    #[cfg(test)]
    pub(crate) fn with_test_backend(
        backend: Arc<dyn CaptureBackend>,
        session_timeout: Duration,
    ) -> Self {
        Self::with_backend(backend, session_timeout)
    }

    fn with_backend(backend: Arc<dyn CaptureBackend>, session_timeout: Duration) -> Self {
        Self {
            operations: Mutex::new(()),
            inner: Arc::new(Mutex::new(ManagerInner {
                channels: HashMap::new(),
                active: None,
                snapshot: DiagnosticCaptureSnapshot::idle(),
            })),
            backend,
            next_session: AtomicU64::new(1),
            session_timeout,
        }
    }

    pub(crate) fn snapshot(&self) -> DiagnosticCaptureSnapshot {
        lock_inner(&self.inner).snapshot.clone()
    }

    pub(crate) fn start(&self, source_id: String) -> DiagnosticCaptureSnapshot {
        let _operation = lock_mutex(&self.operations);
        self.stop_locked();

        let session_number = self.next_session.fetch_add(1, Ordering::Relaxed);
        let session_id = format!("diagnostic-capture-{session_number}");
        let channel_id = format!("diagnostic-channel-{source_id}");
        {
            let mut inner = lock_inner(&self.inner);
            let channel =
                inner
                    .channels
                    .entry(source_id.clone())
                    .or_insert_with(|| DiagnosticChannel {
                        id: channel_id.clone(),
                        source_id: source_id.clone(),
                    });
            let retained_channel_id = channel.id.clone();
            debug_assert_eq!(channel.source_id, source_id);
            inner.snapshot = DiagnosticCaptureSnapshot {
                status: DiagnosticCaptureStatus::Starting,
                session_id: Some(session_id.clone()),
                source_id: Some(source_id.clone()),
                channel_id: Some(retained_channel_id),
                level: MicrophoneLevelSnapshot::idle(),
                error: None,
            };
        }

        let (stop_tx, stop_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let backend = Arc::clone(&self.backend);
        let inner = Arc::clone(&self.inner);
        let worker_session_id = session_id.clone();
        let worker_source_id = source_id.clone();
        let timeout = self.session_timeout;
        let worker = std::thread::spawn(move || {
            let level_inner = Arc::clone(&inner);
            let level_session_id = worker_session_id.clone();
            let outcome = backend.run(
                &worker_source_id,
                stop_rx,
                ready_tx,
                Box::new(move |level| {
                    let mut state = lock_inner(&level_inner);
                    if state.snapshot.session_id.as_deref() == Some(&level_session_id)
                        && matches!(
                            state.snapshot.status,
                            DiagnosticCaptureStatus::Starting | DiagnosticCaptureStatus::Active
                        )
                    {
                        state.snapshot.level = level;
                    }
                }),
                timeout,
            );

            let mut state = lock_inner(&inner);
            if state.snapshot.session_id.as_deref() != Some(&worker_session_id) {
                return;
            }
            match outcome {
                Ok(CaptureEnd::Stopped | CaptureEnd::TimedOut) => {
                    state.snapshot = DiagnosticCaptureSnapshot::idle();
                }
                Err(error) => {
                    state.snapshot.status = DiagnosticCaptureStatus::Failed;
                    state.snapshot.level = MicrophoneLevelSnapshot::idle();
                    state.snapshot.error = Some(error);
                }
            }
        });

        lock_inner(&self.inner).active = Some(ActiveCapture {
            stop: stop_tx,
            worker,
        });

        match ready_rx.recv_timeout(CAPTURE_START_TIMEOUT) {
            Ok(Ok(())) => {
                let mut inner = lock_inner(&self.inner);
                if inner.snapshot.session_id.as_deref() == Some(&session_id)
                    && inner.snapshot.status == DiagnosticCaptureStatus::Starting
                {
                    inner.snapshot.status = DiagnosticCaptureStatus::Active;
                }
            }
            Ok(Err(error)) => self.mark_failed(&session_id, error),
            Err(_) => {
                self.stop_active_worker();
                self.mark_failed(
                    &session_id,
                    "Microphone capture did not start in time.".to_string(),
                );
            }
        }

        self.snapshot()
    }

    pub(crate) fn stop(&self) -> DiagnosticCaptureSnapshot {
        let _operation = lock_mutex(&self.operations);
        self.stop_locked()
    }

    fn stop_locked(&self) -> DiagnosticCaptureSnapshot {
        {
            let mut inner = lock_inner(&self.inner);
            if inner.active.is_none() {
                inner.snapshot = DiagnosticCaptureSnapshot::idle();
                return inner.snapshot.clone();
            }
            inner.snapshot.status = DiagnosticCaptureStatus::Stopping;
            inner.snapshot.level = MicrophoneLevelSnapshot::idle();
            inner.snapshot.error = None;
        }

        self.stop_active_worker();
        let mut inner = lock_inner(&self.inner);
        inner.snapshot = DiagnosticCaptureSnapshot::idle();
        inner.snapshot.clone()
    }

    fn stop_active_worker(&self) {
        let active = lock_inner(&self.inner).active.take();
        if let Some(active) = active {
            let _ = active.stop.send(());
            if active.worker.thread().id() != std::thread::current().id() {
                let _ = active.worker.join();
            }
        }
    }

    fn mark_failed(&self, session_id: &str, error: String) {
        let mut inner = lock_inner(&self.inner);
        if inner.snapshot.session_id.as_deref() == Some(session_id) {
            inner.snapshot.status = DiagnosticCaptureStatus::Failed;
            inner.snapshot.level = MicrophoneLevelSnapshot::idle();
            inner.snapshot.error = Some(error);
        }
    }

    #[cfg(test)]
    pub(crate) fn channel_count(&self) -> usize {
        lock_inner(&self.inner).channels.len()
    }

    #[cfg(test)]
    pub(crate) fn channel_for_source(&self, source_id: &str) -> Option<(String, String)> {
        lock_inner(&self.inner)
            .channels
            .get(source_id)
            .map(|channel| (channel.id.clone(), channel.source_id.clone()))
    }
}

impl Drop for DiagnosticCaptureManager {
    fn drop(&mut self) {
        self.stop_active_worker();
    }
}

fn lock_inner(inner: &Arc<Mutex<ManagerInner>>) -> std::sync::MutexGuard<'_, ManagerInner> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn lock_mutex<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
