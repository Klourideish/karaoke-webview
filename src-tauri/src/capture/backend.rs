use std::{
    sync::mpsc::{Receiver, Sender},
    time::Duration,
};

use super::models::{CaptureAudioFrame, MicrophoneLevelSnapshot};

pub(crate) type LevelConsumer = Box<dyn Fn(MicrophoneLevelSnapshot) + Send>;
pub(crate) type AudioFrameConsumer = Box<dyn Fn(CaptureAudioFrame) + Send>;

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
        levels: LevelConsumer,
        audio_frames: AudioFrameConsumer,
        timeout: Duration,
    ) -> Result<CaptureEnd, String>;
}

pub(crate) struct PlatformCaptureBackend {
    development: Option<std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>>,
}

impl PlatformCaptureBackend {
    pub(crate) fn new(
        development: Option<
            std::sync::Arc<crate::development_protocol::DevelopmentProtocolManager>,
        >,
    ) -> Self {
        Self { development }
    }
}

impl CaptureBackend for PlatformCaptureBackend {
    fn run(
        &self,
        source_id: &str,
        stop: Receiver<()>,
        ready: Sender<Result<(), String>>,
        levels: LevelConsumer,
        audio_frames: AudioFrameConsumer,
        timeout: Duration,
    ) -> Result<CaptureEnd, String> {
        if source_id.starts_with("network-mic-") {
            if let Some(development) = &self.development {
                return development.run_capture(
                    source_id,
                    stop,
                    ready,
                    levels,
                    audio_frames,
                    timeout,
                );
            }
        }
        platform_capture(source_id, stop, ready, levels, audio_frames, timeout)
    }
}

#[cfg(target_os = "windows")]
fn platform_capture(
    source_id: &str,
    stop: Receiver<()>,
    ready: Sender<Result<(), String>>,
    levels: LevelConsumer,
    audio_frames: AudioFrameConsumer,
    timeout: Duration,
) -> Result<CaptureEnd, String> {
    super::windows::run_shared_capture(source_id, stop, ready, levels, audio_frames, timeout)
}

#[cfg(not(target_os = "windows"))]
fn platform_capture(
    _source_id: &str,
    _stop: Receiver<()>,
    ready: Sender<Result<(), String>>,
    _levels: LevelConsumer,
    _audio_frames: AudioFrameConsumer,
    _timeout: Duration,
) -> Result<CaptureEnd, String> {
    let message = "Diagnostic microphone capture is available only on Windows.".to_string();
    let _ = ready.send(Err(message.clone()));
    Err(message)
}
