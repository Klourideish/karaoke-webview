# Diagnostic Audio Monitoring

Diagnostic audio monitoring is a developer-only Host tool for checking whether a selected microphone source is producing intelligible audio through a selected Windows output path.

It is not karaoke playback, recording, scoring, production monitoring, a virtual microphone, or an audience mix.

## Architecture

The monitor attaches to the existing Host-owned diagnostic `CaptureSession` stream:

```text
MicrophoneSource
  -> Diagnostic CaptureSession
     -> RMS / peak meter
     -> DiagnosticAudioMonitor
```

The monitor does not open a second microphone input stream. Raw PCM remains in Rust and is never sent to React.

## Safety

Monitoring is off by default and requires an explicit Developer action.

Use headphones to prevent acoustic feedback.

Gain is bounded from 0% to 100% and defaults to 25%.

## Sources

Supported diagnostic sources are:

- local Windows microphone sources;
- development network microphone sources.

The selected source must already be available and must have an active diagnostic microphone test.

## Queue And Latency

Monitor audio uses a small bounded queue. The initial capacity is eight frames, targeting low latency and preventing monitor output from backpressuring microphone capture. If the monitor falls behind, stale monitor frames are dropped first.

Diagnostics expose queue depth, maximum depth, dropped frames, resets, and estimated buffered latency.

## Gap Policy

The monitor does not mutate the authoritative capture timeline. Missing or late audio is represented only in monitor diagnostics. Synthetic silence, if later required by a real output adapter, must remain monitor-local and must not feed scoring, recording, or CaptureSession state.

## Known Limitations

This foundation establishes the Host-owned monitor lifecycle, source validation, Rust-side capture fan-out, bounded queue, Windows shared-mode output adapter, diagnostics, and Developer UI. Manual headphone testing is still required to verify audible output quality and feedback safety on real devices.

## Field validation

Diagnostic audio monitoring was tested using a development-protocol microphone over WiFi in a non-ideal environment (host separated from the router by one floor, approximately 4 m vertical distance). Subjective listening indicated negligible additional latency, validating the existing CaptureSession fan-out architecture for developer monitoring.
