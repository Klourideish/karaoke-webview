use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Instant,
};

use crate::capture::CaptureAudioFrame;

use super::{
    models::{
        DiagnosticMonitorCommandError, DiagnosticMonitorDiagnostics, DiagnosticMonitorState,
        DiagnosticMonitorStatus, StartDiagnosticMonitorRequest,
    },
    output::MonitorOutputWorker,
    queue::MonitorQueue,
};

const MONITOR_QUEUE_CAPACITY: usize = 8;

struct MonitorInner {
    status: DiagnosticMonitorStatus,
    diagnostics: DiagnosticMonitorDiagnostics,
    active_since: Option<Instant>,
    worker: Option<MonitorOutputWorker>,
}

pub(crate) struct DiagnosticAudioMonitorManager {
    operations: Mutex<()>,
    inner: Mutex<MonitorInner>,
    queue: MonitorQueue,
    next_attempt: AtomicU64,
}

impl Default for DiagnosticAudioMonitorManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DiagnosticAudioMonitorManager {
    pub(crate) fn new() -> Self {
        Self {
            operations: Mutex::new(()),
            inner: Mutex::new(MonitorInner {
                status: DiagnosticMonitorStatus::idle(),
                diagnostics: DiagnosticMonitorDiagnostics::idle(MONITOR_QUEUE_CAPACITY),
                active_since: None,
                worker: None,
            }),
            queue: MonitorQueue::new(MONITOR_QUEUE_CAPACITY),
            next_attempt: AtomicU64::new(1),
        }
    }

    pub(crate) fn start(
        &self,
        request: StartDiagnosticMonitorRequest,
    ) -> Result<DiagnosticMonitorStatus, DiagnosticMonitorCommandError> {
        let _operation = lock(&self.operations);
        if !request.gain.is_finite() || !(0.0..=1.0).contains(&request.gain) {
            return Err(DiagnosticMonitorCommandError::new(
                "invalid-gain",
                "Monitoring gain must be between 0% and 100%.",
            ));
        }
        if request.source_id.trim().is_empty() {
            return Err(DiagnosticMonitorCommandError::new(
                "source-unavailable",
                "Choose a microphone source before monitoring.",
            ));
        }
        if request.output_device_id.trim().is_empty() {
            return Err(DiagnosticMonitorCommandError::new(
                "output-device-unavailable",
                "Choose an output device before monitoring.",
            ));
        }

        if let Some(worker) = lock(&self.inner).worker.take() {
            worker.stop();
        }
        self.queue.clear();
        let attempt = self.next_attempt.fetch_add(1, Ordering::Relaxed);
        let attempt_id = format!("diagnostic-monitor-{attempt}");
        {
            let mut inner = lock(&self.inner);
            inner.status = DiagnosticMonitorStatus {
                attempt_id: Some(attempt_id.clone()),
                state: DiagnosticMonitorState::Starting,
                source_id: Some(request.source_id.clone()),
                output_device_id: Some(request.output_device_id.clone()),
                gain: request.gain,
                message: Some("Starting diagnostic monitoring.".to_string()),
                failure_reason: None,
            };
        }
        let worker = match MonitorOutputWorker::start(&request.output_device_id) {
            Ok(worker) => worker,
            Err(message) => {
                let mut inner = lock(&self.inner);
                inner.status.state = DiagnosticMonitorState::Failed;
                inner.status.message = Some("Diagnostic monitoring could not start.".to_string());
                inner.status.failure_reason = Some(message.clone());
                return Err(DiagnosticMonitorCommandError::new(
                    "output-device-unavailable",
                    message,
                ));
            }
        };
        let mut inner = lock(&self.inner);
        inner.status = DiagnosticMonitorStatus {
            attempt_id: Some(attempt_id),
            state: DiagnosticMonitorState::Active,
            source_id: Some(request.source_id),
            output_device_id: Some(request.output_device_id),
            gain: request.gain,
            message: Some("Diagnostic monitoring is active.".to_string()),
            failure_reason: None,
        };
        inner.diagnostics = DiagnosticMonitorDiagnostics::idle(MONITOR_QUEUE_CAPACITY);
        inner.diagnostics.gain = request.gain;
        inner.active_since = Some(Instant::now());
        inner.worker = Some(worker);
        Ok(inner.status.clone())
    }

    pub(crate) fn stop(&self) -> DiagnosticMonitorStatus {
        let _operation = lock(&self.operations);
        self.stop_with_reason(None)
    }

    pub(crate) fn stop_for_source(&self, source_id: &str, message: &str) {
        let _operation = lock(&self.operations);
        let should_stop = lock(&self.inner)
            .status
            .source_id
            .as_deref()
            .is_some_and(|active| active == source_id);
        if should_stop {
            let _ = self.stop_with_reason(Some(message));
        }
    }

    pub(crate) fn consume_frame(&self, source_id: &str, frame: CaptureAudioFrame) {
        let status = self.status();
        if status.state != DiagnosticMonitorState::Active
            || status.source_id.as_deref() != Some(source_id)
        {
            return;
        }
        let sample_rate = frame.sample_rate_hz;
        let channels = frame.channels;
        let sequence = frame.sequence;
        let encoding = frame.encoding;
        let sample_count = frame.samples.len() as u64;
        self.queue.push(frame);
        let Some(frame) = self.queue.pop() else {
            let mut inner = lock(&self.inner);
            inner.diagnostics.underruns += 1;
            return;
        };
        let consumed = frame.samples.len() as u64;
        let sent = lock(&self.inner)
            .worker
            .as_ref()
            .map(|worker| worker.send_frame(frame, status.gain))
            .unwrap_or(Err(()))
            .is_ok();
        let mut inner = lock(&self.inner);
        let queue = self.queue.snapshot();
        inner.diagnostics.queue_depth = queue.depth;
        inner.diagnostics.maximum_queue_depth = queue.max_depth;
        inner.diagnostics.dropped_monitor_frames = queue.dropped_frames;
        inner.diagnostics.resets = queue.resets;
        inner.diagnostics.buffered_latency_ms = queue.buffered_latency_ms;
        inner.diagnostics.input_sample_rate_hz = Some(sample_rate);
        inner.diagnostics.output_sample_rate_hz = Some(sample_rate);
        inner.diagnostics.input_channels = Some(channels);
        inner.diagnostics.output_channels = Some(channels.max(1));
        let _ = (sequence, encoding);
        inner.diagnostics.samples_consumed += sample_count;
        if sent {
            inner.diagnostics.samples_written += consumed;
        } else {
            inner.diagnostics.dropped_monitor_frames += 1;
        }
    }

    pub(crate) fn status(&self) -> DiagnosticMonitorStatus {
        lock(&self.inner).status.clone()
    }

    pub(crate) fn diagnostics(&self) -> DiagnosticMonitorDiagnostics {
        let mut diagnostics = lock(&self.inner).diagnostics.clone();
        let queue = self.queue.snapshot();
        diagnostics.queue_depth = queue.depth;
        diagnostics.maximum_queue_depth = queue.max_depth;
        diagnostics.dropped_monitor_frames = queue.dropped_frames;
        diagnostics.resets = queue.resets;
        diagnostics.buffered_latency_ms = queue.buffered_latency_ms;
        diagnostics
    }

    fn stop_with_reason(&self, message: Option<&str>) -> DiagnosticMonitorStatus {
        let worker = {
            let mut inner = lock(&self.inner);
            if inner.status.state == DiagnosticMonitorState::Active {
                inner.status.state = DiagnosticMonitorState::Stopping;
                inner.status.message = Some("Stopping diagnostic monitoring.".to_string());
            }
            inner.worker.take()
        };
        if let Some(worker) = worker {
            worker.stop();
        }
        self.queue.clear();
        let mut inner = lock(&self.inner);
        let gain = inner.status.gain;
        inner.status = DiagnosticMonitorStatus::idle();
        inner.status.state = DiagnosticMonitorState::Stopped;
        inner.status.gain = gain;
        inner.status.message = message.map(str::to_string);
        inner.active_since = None;
        inner.status.clone()
    }
}

impl Drop for DiagnosticAudioMonitorManager {
    fn drop(&mut self) {
        if let Some(worker) = lock(&self.inner).worker.take() {
            worker.stop();
        }
        self.queue.clear();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
impl DiagnosticAudioMonitorManager {
    pub(crate) fn queue_capacity_for_test(&self) -> usize {
        self.queue.capacity()
    }
}
