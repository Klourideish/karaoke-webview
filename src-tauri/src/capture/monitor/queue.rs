use std::{collections::VecDeque, sync::Mutex, time::Duration};

use crate::capture::CaptureAudioFrame;

#[derive(Debug)]
pub(crate) struct MonitorQueue {
    capacity: usize,
    inner: Mutex<QueueInner>,
}

#[derive(Debug, Default)]
struct QueueInner {
    frames: VecDeque<CaptureAudioFrame>,
    max_depth: usize,
    dropped_frames: u64,
    resets: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct QueueSnapshot {
    pub capacity: usize,
    pub depth: usize,
    pub max_depth: usize,
    pub dropped_frames: u64,
    pub resets: u64,
    pub buffered_latency_ms: u64,
}

impl MonitorQueue {
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            inner: Mutex::new(QueueInner::default()),
        }
    }

    pub(crate) fn push(&self, frame: CaptureAudioFrame) {
        let mut inner = lock(&self.inner);
        while inner.frames.len() >= self.capacity {
            inner.frames.pop_front();
            inner.dropped_frames += 1;
        }
        inner.frames.push_back(frame);
        inner.max_depth = inner.max_depth.max(inner.frames.len());
    }

    pub(crate) fn pop(&self) -> Option<CaptureAudioFrame> {
        lock(&self.inner).frames.pop_front()
    }

    pub(crate) fn clear(&self) {
        let mut inner = lock(&self.inner);
        inner.frames.clear();
        inner.resets += 1;
    }

    pub(crate) fn snapshot(&self) -> QueueSnapshot {
        let inner = lock(&self.inner);
        let buffered_latency_ms = inner
            .frames
            .iter()
            .map(frame_duration)
            .sum::<Duration>()
            .as_millis() as u64;
        QueueSnapshot {
            capacity: self.capacity,
            depth: inner.frames.len(),
            max_depth: inner.max_depth,
            dropped_frames: inner.dropped_frames,
            resets: inner.resets,
            buffered_latency_ms,
        }
    }

    #[cfg(test)]
    pub(crate) fn capacity(&self) -> usize {
        self.capacity
    }
}

fn frame_duration(frame: &CaptureAudioFrame) -> Duration {
    if frame.sample_rate_hz == 0 || frame.channels == 0 {
        return Duration::ZERO;
    }
    let frames = frame.samples.len() as u64 / u64::from(frame.channels);
    Duration::from_secs_f64(frames as f64 / f64::from(frame.sample_rate_hz))
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
