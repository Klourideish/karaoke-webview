use crate::capture::models::{CaptureAudioFrame, MonitorSampleEncoding};

use super::{
    manager::DiagnosticAudioMonitorManager,
    models::{DiagnosticMonitorState, StartDiagnosticMonitorRequest},
};

fn request() -> StartDiagnosticMonitorRequest {
    StartDiagnosticMonitorRequest {
        source_id: "windows-mic-primary".to_string(),
        output_device_id: "default".to_string(),
        gain: 0.25,
    }
}

fn frame(sequence: u64, sample: f32) -> CaptureAudioFrame {
    CaptureAudioFrame {
        samples: vec![sample; 480],
        sample_rate_hz: 48_000,
        channels: 1,
        sequence,
        encoding: MonitorSampleEncoding::Float32,
    }
}

#[test]
fn diagnostic_monitor_explicit_start_stop_lifecycle() {
    let manager = DiagnosticAudioMonitorManager::new();

    assert_eq!(manager.status().state, DiagnosticMonitorState::Idle);
    let status = manager.start(request()).unwrap();
    assert_eq!(status.state, DiagnosticMonitorState::Active);
    assert_eq!(status.source_id.as_deref(), Some("windows-mic-primary"));

    let status = manager.stop();
    assert_eq!(status.state, DiagnosticMonitorState::Stopped);
}

#[test]
fn diagnostic_monitor_rejects_invalid_gain() {
    let manager = DiagnosticAudioMonitorManager::new();
    let mut request = request();
    request.gain = 1.5;

    let error = manager.start(request).unwrap_err();

    assert_eq!(error.reason, "invalid-gain");
}

#[test]
fn diagnostic_monitor_ignores_frames_from_stale_source() {
    let manager = DiagnosticAudioMonitorManager::new();
    manager.start(request()).unwrap();

    manager.consume_frame("other-source", frame(1, 0.5));

    assert_eq!(manager.diagnostics().samples_written, 0);
}

#[test]
fn diagnostic_monitor_consumes_same_capture_stream_frames() {
    let manager = DiagnosticAudioMonitorManager::new();
    manager.start(request()).unwrap();

    manager.consume_frame("windows-mic-primary", frame(1, 0.5));

    let diagnostics = manager.diagnostics();
    assert_eq!(diagnostics.input_sample_rate_hz, Some(48_000));
    assert_eq!(diagnostics.input_channels, Some(1));
    assert_eq!(diagnostics.samples_consumed, 480);
    assert_eq!(diagnostics.samples_written, 480);
}

#[test]
fn diagnostic_monitor_queue_is_bounded_and_clears_on_stop() {
    let manager = DiagnosticAudioMonitorManager::new();
    manager.start(request()).unwrap();
    assert_eq!(manager.queue_capacity_for_test(), 8);

    for sequence in 0..16 {
        manager.consume_frame("windows-mic-primary", frame(sequence, 0.1));
    }
    assert!(manager.diagnostics().maximum_queue_depth <= 1);

    manager.stop();
    assert_eq!(manager.diagnostics().queue_depth, 0);
}

#[test]
fn diagnostic_monitor_start_stop_stress() {
    let manager = DiagnosticAudioMonitorManager::new();
    for _ in 0..25 {
        manager.start(request()).unwrap();
        manager.consume_frame("windows-mic-primary", frame(1, 0.25));
        manager.stop();
    }
    assert_eq!(manager.status().state, DiagnosticMonitorState::Stopped);
}
