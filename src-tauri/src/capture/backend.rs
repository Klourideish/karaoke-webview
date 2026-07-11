use std::{
    sync::mpsc::{Receiver, Sender},
    time::Duration,
};

use super::models::MicrophoneLevelSnapshot;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CaptureEnd {
    Stopped,
    TimedOut,
}

pub(crate) trait CaptureBackend: Send + Sync {
    fn run(
        &self,
        source_id: &str,
        stop: Receiver<()>,
        ready: Sender<Result<(), String>>,
        levels: Box<dyn Fn(MicrophoneLevelSnapshot) + Send>,
        timeout: Duration,
    ) -> Result<CaptureEnd, String>;
}

pub(crate) struct PlatformCaptureBackend;

impl CaptureBackend for PlatformCaptureBackend {
    fn run(
        &self,
        source_id: &str,
        stop: Receiver<()>,
        ready: Sender<Result<(), String>>,
        levels: Box<dyn Fn(MicrophoneLevelSnapshot) + Send>,
        timeout: Duration,
    ) -> Result<CaptureEnd, String> {
        platform_capture(source_id, stop, ready, levels, timeout)
    }
}

#[cfg(target_os = "windows")]
fn platform_capture(
    source_id: &str,
    stop: Receiver<()>,
    ready: Sender<Result<(), String>>,
    levels: Box<dyn Fn(MicrophoneLevelSnapshot) + Send>,
    timeout: Duration,
) -> Result<CaptureEnd, String> {
    super::windows::run_shared_capture(source_id, stop, ready, levels, timeout)
}

#[cfg(not(target_os = "windows"))]
fn platform_capture(
    _source_id: &str,
    _stop: Receiver<()>,
    ready: Sender<Result<(), String>>,
    _levels: Box<dyn Fn(MicrophoneLevelSnapshot) + Send>,
    _timeout: Duration,
) -> Result<CaptureEnd, String> {
    let message = "Diagnostic microphone capture is available only on Windows.".to_string();
    let _ = ready.send(Err(message.clone()));
    Err(message)
}
