use std::{
    collections::VecDeque,
    sync::{Condvar, Mutex},
    time::Duration,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PushResult {
    Enqueued { dropped_oldest: bool },
    Closed,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ReceiveResult {
    Frame(Vec<i16>),
    Timeout,
    Closed,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct AudioHandoffSnapshot {
    pub depth: usize,
    pub maximum_depth: usize,
}

struct AudioHandoffState {
    frames: VecDeque<Vec<i16>>,
    maximum_depth: usize,
    closed: bool,
}

pub(super) struct AudioHandoff {
    capacity: usize,
    state: Mutex<AudioHandoffState>,
    available: Condvar,
}

impl AudioHandoff {
    pub(super) fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "audio handoff capacity must be positive");
        Self {
            capacity,
            state: Mutex::new(AudioHandoffState {
                frames: VecDeque::with_capacity(capacity),
                maximum_depth: 0,
                closed: false,
            }),
            available: Condvar::new(),
        }
    }

    pub(super) fn push(&self, frame: Vec<i16>) -> PushResult {
        let mut state = lock(&self.state);
        if state.closed {
            return PushResult::Closed;
        }
        let dropped_oldest = state.frames.len() == self.capacity;
        if dropped_oldest {
            state.frames.pop_front();
        }
        state.frames.push_back(frame);
        state.maximum_depth = state.maximum_depth.max(state.frames.len());
        self.available.notify_one();
        PushResult::Enqueued { dropped_oldest }
    }

    pub(super) fn receive_timeout(&self, timeout: Duration) -> ReceiveResult {
        let state = lock(&self.state);
        let (mut state, _) = self
            .available
            .wait_timeout_while(state, timeout, |state| {
                state.frames.is_empty() && !state.closed
            })
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(frame) = state.frames.pop_front() {
            ReceiveResult::Frame(frame)
        } else if state.closed {
            ReceiveResult::Closed
        } else {
            ReceiveResult::Timeout
        }
    }

    pub(super) fn clear(&self) {
        let mut state = lock(&self.state);
        state.frames.clear();
        state.maximum_depth = 0;
    }

    pub(super) fn close_and_clear(&self) {
        let mut state = lock(&self.state);
        state.frames.clear();
        state.maximum_depth = 0;
        state.closed = true;
        self.available.notify_all();
    }

    pub(super) fn snapshot(&self) -> AudioHandoffSnapshot {
        let state = lock(&self.state);
        AudioHandoffSnapshot {
            depth: state.frames.len(),
            maximum_depth: state.maximum_depth,
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, thread, time::Duration};

    use super::*;

    #[test]
    fn queue_is_bounded_and_preserves_newest_frames() {
        let handoff = AudioHandoff::new(4);
        for value in 0..6 {
            let result = handoff.push(vec![value]);
            assert_eq!(
                result,
                PushResult::Enqueued {
                    dropped_oldest: value >= 4
                }
            );
        }

        assert_eq!(
            handoff.snapshot(),
            AudioHandoffSnapshot {
                depth: 4,
                maximum_depth: 4
            }
        );
        for value in 2..6 {
            assert_eq!(
                handoff.receive_timeout(Duration::ZERO),
                ReceiveResult::Frame(vec![value])
            );
        }
    }

    #[test]
    fn stalled_consumer_does_not_block_producer_or_grow_queue() {
        let handoff = Arc::new(AudioHandoff::new(4));
        let producer = Arc::clone(&handoff);
        let (done, completed) = std::sync::mpsc::channel();
        thread::spawn(move || {
            for value in 0..10_000 {
                producer.push(vec![value]);
            }
            done.send(()).unwrap();
        });

        completed.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(handoff.snapshot().depth, 4);
        for value in 9_996..10_000 {
            assert_eq!(
                handoff.receive_timeout(Duration::ZERO),
                ReceiveResult::Frame(vec![value])
            );
        }
    }

    #[test]
    fn clear_prevents_stale_replay_and_keeps_queue_reusable() {
        let handoff = AudioHandoff::new(4);
        handoff.push(vec![1]);
        handoff.push(vec![2]);
        handoff.clear();

        assert_eq!(
            handoff.receive_timeout(Duration::ZERO),
            ReceiveResult::Timeout
        );
        handoff.push(vec![3]);
        assert_eq!(
            handoff.receive_timeout(Duration::ZERO),
            ReceiveResult::Frame(vec![3])
        );
    }

    #[test]
    fn closing_clears_and_wakes_a_waiting_consumer() {
        let handoff = Arc::new(AudioHandoff::new(4));
        let consumer = Arc::clone(&handoff);
        let worker = thread::spawn(move || consumer.receive_timeout(Duration::from_secs(5)));
        thread::sleep(Duration::from_millis(10));

        handoff.close_and_clear();

        assert_eq!(worker.join().unwrap(), ReceiveResult::Closed);
        assert_eq!(handoff.push(vec![1]), PushResult::Closed);
        assert_eq!(handoff.snapshot().depth, 0);
    }
}
