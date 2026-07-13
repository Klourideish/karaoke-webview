# RFC-A-005 — Diagnostics & Validation

**Status:** Accepted

**Created:** 2026-07-13

**Last Updated:** 2026-07-13

**Authors:** Project

---

> **Authority**
>
> Accepted RFCs are authoritative.
>
> Android implementations must conform to Accepted Platform and Android RFCs.
>
> If implementation conflicts with this RFC, stop and request a Design Review rather than silently changing the architecture.

---

> **Platform Dependencies**
>
> This RFC extends:
>
> - RFC-P-001 — Platform Authority
> - RFC-P-008 — Platform Protocol & Connection State Machine
>
> It does not redefine those documents.

---

> **Android Dependencies**
>
> This RFC extends:
>
> - RFC-A-001 — Android Client Authority & Boundaries
> - RFC-A-002 — Android Audio Capture Lifecycle
> - RFC-A-003 — Audio Frame & Buffer Contract
> - RFC-A-004 — Foreground Service, Privacy & Power
>
> It does not redefine those documents.

---

# 1. Summary

This RFC defines the diagnostics, instrumentation, testing strategy and acceptance criteria for the Android Companion.

Diagnostics exist to validate the implementation, not to become authoritative Platform state.

The Android Companion must expose sufficient local information to verify that microphone capture is reliable before networking or protocol integration begins.

---

# 2. Motivation

Android behaves differently across:

- manufacturers;
- Android versions;
- microphone hardware;
- battery policies;
- thermal limits;
- scheduler behaviour.

Observable diagnostics allow these differences to be measured rather than guessed.

---

# 3. Principles

## RFC-A-005.1

### Decision

Diagnostics are local observations.

### Reason

They assist development and troubleshooting but do not become Platform authority.

---

## RFC-A-005.2

### Decision

Instrumentation must never modify capture behaviour.

### Reason

Diagnostics should observe the system rather than influence it.

---

## RFC-A-005.3

### Decision

Every diagnostic metric should have a clear purpose.

### Reason

Avoid collecting unnecessary information that complicates maintenance.

---

# 4. Required Audio Diagnostics

## RFC-A-005.4

The implementation shall expose:

- requested sample rate;
- actual sample rate;
- requested channel count;
- actual channel count;
- encoding format;
- capture attempt identifier;
- total frames captured;
- total samples captured.

---

## RFC-A-005.5

Capture quality diagnostics include:

- short reads;
- read failures;
- interruptions;
- restart attempts;
- current capture state;
- capture duration.

---

# 5. Buffer Diagnostics

## RFC-A-005.6

Expose:

- queue depth;
- maximum queue depth;
- dropped frame count;
- partial frame count;
- discarded partial frames;
- processing deadline misses.

---

## RFC-A-005.7

Queue capacity shall be observable.

### Reason

Backpressure cannot be evaluated without visibility.

---

# 6. Timing Diagnostics

## RFC-A-005.8

Measure:

- capture-loop duration;
- scheduling delay;
- timestamp monotonicity;
- frame sequence continuity.

---

## RFC-A-005.9

Sequence gaps must be observable.

### Reason

Dropped frames must never become invisible.

---

# 7. Memory Diagnostics

## RFC-A-005.10

Observe:

- current heap usage;
- approximate steady-state memory usage;
- allocation rate after warm-up;
- garbage collection count where available.

---

## RFC-A-005.11

Steady-state capture should avoid continuous allocation growth.

### Reason

Allocation pressure increases scheduling jitter.

---

# 8. Service Diagnostics

## RFC-A-005.12

Observe:

- foreground service uptime;
- service restart count;
- application foreground/background state;
- screen on/off state.

---

## RFC-A-005.13

Unexpected service termination shall be reported.

---

# 9. Device Diagnostics

## RFC-A-005.14

Where supported, observe:

- battery percentage;
- battery temperature;
- thermal status.

---

## RFC-A-005.15

Missing platform support is acceptable.

Unavailable diagnostics shall report "unsupported" rather than fabricated values.

---

# 10. Local Meter

## RFC-A-005.16

The Android application may compute:

- RMS
- Peak

for local diagnostics.

---

## RFC-A-005.17

These values are non-authoritative.

### Reason

Official scoring remains Host-owned.

---

# 11. Testing Strategy

Testing is divided into four categories.

---

## Unit Tests

Validate:

- lifecycle transitions;
- frame sequencing;
- sample index progression;
- bounded queues;
- frame dropping;
- state models;
- diagnostics counters.

---

## Integration Tests

Validate:

- AudioRecord wrapper;
- foreground service lifecycle;
- permission handling;
- frame publication;
- interruption handling.

---

## Instrumented Device Tests

Validate:

- permission requests;
- microphone capture;
- service notifications;
- screen-off behaviour;
- lifecycle transitions.

---

## Manual Validation

Validate:

- Start Capture;
- Stop Capture;
- repeated capture cycles;
- permission revocation;
- screen lock;
- incoming interruption;
- diagnostics updates.

---

# 12. Stage 1 Acceptance Criteria

Android P1 is accepted when:

✓ RECORD_AUDIO permission flow works.

✓ Foreground service starts correctly.

✓ Notification remains visible.

✓ Explicit Start begins capture.

✓ Explicit Stop ends capture.

✓ AudioRecord initializes successfully.

✓ 48 kHz mono PCM16 capture succeeds.

✓ 10 ms frames are produced.

✓ Frame sequence remains monotonic.

✓ Sample index remains continuous.

✓ Queue remains bounded.

✓ Frame dropping behaves correctly.

✓ Local RMS and Peak update.

✓ Five-minute capture completes.

✓ Screen-off capture remains stable.

✓ Resources release cleanly.

✓ No networking exists.

✓ No Platform authority exists.

---

# 13. Stage 2 Acceptance Criteria

Under RFC-P-008 protocol integration:

✓ Frames pass into the protocol adapter.

✓ Host receives observations.

✓ Existing Host RMS meter responds.

✓ No Windows virtual microphone exists.

✓ No speaker monitoring occurs.

---

# 14. Consequences

## Benefits

- Objective implementation quality.
- Easier debugging.
- Comparable measurements across devices.
- Future optimisation guided by data.
- Easier AI-assisted development.

## Trade-offs

- Additional instrumentation code.
- Slightly more complex debug UI.

## Risks

- Vendor-specific APIs may expose different metrics.
- Some diagnostics may not exist on older Android versions.

---

# 15. Affected Modules

- Android Audio
- Android Diagnostics
- Android UI
- Android Tests
- Android Service

---

# 16. Out of Scope

This RFC does not define:

- networking;
- Host diagnostics;
- protocol diagnostics;
- scoring;
- recording.

---

# 17. Future Work

Future RFCs may introduce:

- protocol diagnostics;
- network latency metrics;
- Host synchronization metrics;
- audio jitter measurements.

---

# 18. Implementation Notes

Diagnostics should be inexpensive.

Prefer immutable snapshots.

Do not allocate excessively simply to produce diagnostics.

Keep diagnostic collection independent from protocol implementation.

---

# 19. Quick Reference

✓ Diagnostics are observational.

✓ Diagnostics never become Platform authority.

✓ Queue behaviour is measurable.

✓ Timing is measurable.

✓ Memory is measurable.

✓ Service health is measurable.

✓ Local meter is diagnostic only.

✓ Testing progresses:

- Unit
- Integration
- Instrumented
- Manual

✓ Stage 1 completes before networking.

✓ Stage 2 uses RFC-P-008.

---

# 20. Change Log

## 2026-07-13

Initial accepted version.

---

> **Architecture Relationship**
>
> RFC-A-001 defines Android ownership.
>
> RFC-A-002 defines capture.
>
> RFC-A-003 defines frame production.
>
> RFC-A-004 defines foreground service and privacy.
>
> RFC-A-005 defines how implementation quality is measured before Android participates in the Platform protocol.
