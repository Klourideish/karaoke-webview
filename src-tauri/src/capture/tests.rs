use std::{
    sync::{mpsc, Arc},
    time::Duration,
};

use super::{
    backend::{CaptureBackend, CaptureEnd},
    levels::normalized_levels,
    manager::DiagnosticCaptureManager,
    models::{DiagnosticCaptureStatus, MicrophoneLevelSnapshot},
};

#[derive(Clone, Copy)]
enum FakeBehavior {
    Active,
    Fail,
    Timeout,
}

struct FakeBackend {
    behavior: FakeBehavior,
}

impl CaptureBackend for FakeBackend {
    fn run(
        &self,
        _source_id: &str,
        stop: mpsc::Receiver<()>,
        ready: mpsc::Sender<Result<(), String>>,
        levels: Box<dyn Fn(MicrophoneLevelSnapshot) + Send>,
        timeout: Duration,
    ) -> Result<CaptureEnd, String> {
        match self.behavior {
            FakeBehavior::Fail => {
                let message = "Capture backend failed.".to_string();
                let _ = ready.send(Err(message.clone()));
                Err(message)
            }
            FakeBehavior::Active => {
                let _ = ready.send(Ok(()));
                levels(normalized_levels(&[0.25, -0.5], 1));
                let _ = stop.recv();
                Ok(CaptureEnd::Stopped)
            }
            FakeBehavior::Timeout => {
                let _ = ready.send(Ok(()));
                std::thread::sleep(timeout);
                Ok(CaptureEnd::TimedOut)
            }
        }
    }
}

fn manager(behavior: FakeBehavior, timeout: Duration) -> DiagnosticCaptureManager {
    DiagnosticCaptureManager::with_test_backend(Arc::new(FakeBackend { behavior }), timeout)
}

#[test]
fn diagnostic_session_requires_explicit_start() {
    let manager = manager(FakeBehavior::Active, Duration::from_secs(1));
    assert_eq!(manager.snapshot().status, DiagnosticCaptureStatus::Idle);
    assert_eq!(manager.channel_count(), 0);
}

#[test]
fn diagnostic_session_starts_stops_and_preserves_its_channel() {
    let manager = manager(FakeBehavior::Active, Duration::from_secs(1));

    let active = manager.start("windows-mic-a".to_string());
    assert_eq!(active.status, DiagnosticCaptureStatus::Active);
    assert_eq!(active.source_id.as_deref(), Some("windows-mic-a"));
    assert_eq!(active.level.sequence, 1);

    assert_eq!(manager.stop().status, DiagnosticCaptureStatus::Idle);
    assert_eq!(manager.channel_count(), 1);
    assert_eq!(
        manager.channel_for_source("windows-mic-a"),
        Some((
            "diagnostic-channel-windows-mic-a".to_string(),
            "windows-mic-a".to_string(),
        ))
    );
}

#[test]
fn starting_another_diagnostic_session_replaces_the_previous_one() {
    let manager = manager(FakeBehavior::Active, Duration::from_secs(1));

    let first = manager.start("windows-mic-a".to_string());
    let second = manager.start("windows-mic-b".to_string());

    assert_ne!(first.session_id, second.session_id);
    assert_eq!(second.status, DiagnosticCaptureStatus::Active);
    assert_eq!(second.source_id.as_deref(), Some("windows-mic-b"));
    assert_eq!(manager.channel_count(), 2);
    manager.stop();
}

#[test]
fn diagnostic_session_stops_after_its_timeout() {
    let manager = manager(FakeBehavior::Timeout, Duration::from_millis(10));

    assert_eq!(
        manager.start("windows-mic-a".to_string()).status,
        DiagnosticCaptureStatus::Active
    );
    std::thread::sleep(Duration::from_millis(30));

    assert_eq!(manager.snapshot().status, DiagnosticCaptureStatus::Idle);
    assert_eq!(manager.channel_count(), 1);
}

#[test]
fn capture_failure_preserves_source_and_channel_context() {
    let manager = manager(FakeBehavior::Fail, Duration::from_secs(1));
    let failed = manager.start("windows-mic-a".to_string());

    assert_eq!(failed.status, DiagnosticCaptureStatus::Failed);
    assert_eq!(failed.source_id.as_deref(), Some("windows-mic-a"));
    assert_eq!(
        failed.channel_id.as_deref(),
        Some("diagnostic-channel-windows-mic-a")
    );
    assert_eq!(manager.channel_count(), 1);
}

#[test]
fn normalized_levels_report_rms_peak_and_clipping() {
    let level = normalized_levels(&[0.0, 0.5, -1.0], 7);

    assert!((level.rms - 0.645_497_2).abs() < 0.000_01);
    assert_eq!(level.peak, 1.0);
    assert!(level.clipping);
    assert_eq!(level.sequence, 7);
}

#[test]
fn normalized_levels_are_idle_for_empty_samples() {
    let level = normalized_levels(&[], 4);
    assert_eq!(level.rms, 0.0);
    assert_eq!(level.peak, 0.0);
    assert!(!level.clipping);
}

#[cfg(target_os = "windows")]
#[test]
#[ignore = "opens the current Windows microphone in shared mode"]
fn windows_shared_capture_smoke() {
    let source_id = crate::microphones::first_available_local_source_id()
        .expect("microphone discovery should complete")
        .expect("an available microphone is required");
    let manager = DiagnosticCaptureManager::new();

    let active = manager.start(source_id);
    assert_eq!(active.status, DiagnosticCaptureStatus::Active);
    std::thread::sleep(Duration::from_millis(200));
    assert!(manager.snapshot().level.sequence > 0);
    assert_eq!(manager.stop().status, DiagnosticCaptureStatus::Idle);
}
