# RFC-A-002 — Android Audio Capture Lifecycle

**Status:** Accepted

**Created:** 2026-07-12

**Last Updated:** 2026-07-12

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
> - RFC-P-005 — Microphone Resource Model
> - RFC-P-006 — Capture Session Model
> - RFC-P-008 — Platform Protocol & Connection State Machine
>
> It does not redefine those documents.

---

> **Android Dependencies**
>
> This RFC extends:
>
> - RFC-A-001 — Android Client Authority & Boundaries
>
> It does not redefine that document.

---

> **Related RFCs**
>
> This RFC is commonly implemented alongside:
>
> - RFC-A-003 — Audio Frame & Buffer Contract
> - RFC-A-004 — Foreground Service, Privacy & Power
> - RFC-A-005 — Diagnostics & Validation

---

# 1. Summary

This RFC defines the authoritative local microphone-capture lifecycle for the Karaoke Webview Android Companion.

Android capture is a device-local responsibility implemented initially through `AudioRecord`.

The capture subsystem owns microphone initialization, reading, interruption handling, resource release, and local capture state.

It produces transport-neutral audio frames but does not own network transmission, Host stream authorization, singer assignment, scoring, or recording.

```text
User action
    ↓
Permission validation
    ↓
AudioRecord initialization
    ↓
Local capture
    ↓
CapturedAudioFrame production
    ↓
AudioFrameSink
```

---

# 2. Motivation

Android microphone capture is affected by:

- runtime permission;
- foreground-service restrictions;
- hardware format support;
- device routing;
- operating-system interruptions;
- process and lifecycle changes;
- concurrent microphone use;
- capture-thread scheduling;
- explicit user privacy actions.

Without a defined capture lifecycle, implementation may incorrectly couple:

- connection state;
- Host authorization;
- local microphone ownership;
- foreground-service state;
- frame transmission;
- Android UI state.

This RFC establishes one local capture model that remains independent from the future protocol implementation.

---

# 3. Capture Ownership

## RFC-A-002.1

### Decision

The Android capture subsystem owns the lifetime of the local microphone hardware session.

### Reason

Microphone initialization, reads, interruption handling, and release are Android-local responsibilities.

---

## RFC-A-002.2

### Decision

The initial Android capture backend uses `AudioRecord`.

### Reason

`AudioRecord` provides a direct, testable local capture boundary without requiring native audio frameworks before measured evidence justifies them.

---

## RFC-A-002.3

### Decision

The capture backend must remain replaceable behind an Android-local interface.

### Reason

Future profiling may justify Oboe, AAudio, or another implementation without changing the Android capture lifecycle or frame contract.

---

## RFC-A-002.4

### Decision

Capture state must be owned outside Composables.

### Reason

UI lifecycle and recomposition must not own microphone hardware or capture-thread lifetime.

---

## RFC-A-002.5

### Decision

The capture subsystem must expose immutable observable state to the UI.

### Reason

UI should render capture state and issue intents without directly mutating capture internals.

---

# 4. Capture Lifecycle

## RFC-A-002.6

### Decision

The Android microphone-service lifecycle is:

```text
idle
→ initializing
→ capturing
→ stopping
→ stopped
```

Exceptional non-terminal condition:

```text
capturing
→ interrupted
```

Terminal attempt outcome:

```text
initializing / capturing / interrupted / stopping
→ failed
```

### Reason

The lifecycle separates intent, hardware acquisition, active capture, interruption, cleanup, and failure.

---

## RFC-A-002.7

### Decision

State meanings are:

### `idle`

No capture attempt is active.

Permission may or may not be granted.

No microphone resources are held.

### `initializing`

The application is validating permission, configuration, service state, and microphone initialization.

No audio frame may be treated as valid before initialization succeeds.

### `capturing`

The microphone is active and the capture loop is producing frames.

### `interrupted`

Capture cannot currently produce valid audio because of an operating-system, routing, hardware, or priority interruption.

The capture attempt remains known but is not considered healthy.

### `stopping`

Capture shutdown has begun.

No new downstream frame ownership may be created after stop processing reaches this state.

### `stopped`

The capture attempt completed cleanup successfully.

No microphone resources remain held by that attempt.

### `failed`

The capture attempt terminated unsuccessfully.

The failure includes a typed reason and does not automatically restart.

---

## RFC-A-002.8

### Decision

A terminal `stopped` or `failed` capture attempt never restarts.

Retry creates a new capture-attempt identity.

### Reason

Completed attempts remain immutable and diagnosable.

---

# 5. Start Policy

## RFC-A-002.9

### Decision

Local capture begins only after an explicit visible user action.

### Reason

Microphone access must remain consent-based and visible.

---

## RFC-A-002.10

### Decision

Capture must not begin unless `RECORD_AUDIO` permission is currently granted.

### Reason

Permission is a mandatory precondition for microphone ownership.

---

## RFC-A-002.11

### Decision

A Host request may ask Android to prepare or begin capture, but Android must still satisfy local permission, foreground-service, privacy, and lifecycle requirements.

### Reason

Host authority does not override Android platform restrictions or local user consent.

---

## RFC-A-002.12

### Decision

A duplicate Start request for the same active attempt is idempotent or rejected with a typed reason.

It must not create a second `AudioRecord` instance.

### Reason

Only one local microphone capture attempt may own the Android microphone for the companion at a time.

---

## RFC-A-002.13

### Decision

Starting a new capture attempt while another attempt is active requires the existing attempt to stop and release its resources first.

### Reason

Overlapping microphone owners would create race conditions and undefined hardware behavior.

---

# 6. Audio Configuration

## RFC-A-002.14

### Decision

The initial requested capture configuration is:

- mono;
- 48 kHz;
- signed PCM16.

### Reason

This matches the initial Platform audio profile while remaining widely suitable for Android microphone capture.

---

## RFC-A-002.15

### Decision

The capture subsystem must record both requested and actual initialized audio configuration.

### Reason

Android hardware or routing may not exactly match the requested configuration.

---

## RFC-A-002.16

### Decision

The capture subsystem must not silently claim a requested format was obtained when the actual format differs.

### Reason

Frame consumers and diagnostics require truthful format metadata.

---

## RFC-A-002.17

### Decision

Unsupported or invalid capture configurations fail clearly before frames are published.

### Reason

Mislabelled audio is more harmful than a clean initialization failure.

---

## RFC-A-002.18

### Decision

The Android Companion does not assume exclusive microphone access.

### Reason

Android may arbitrate microphone input with higher-priority applications or system services.

---

# 7. Capture Loop

## RFC-A-002.19

### Decision

Audio reads occur on a dedicated capture execution context suitable for blocking microphone reads.

### Reason

The UI thread and general application scope must not be blocked by hardware capture.

---

## RFC-A-002.20

### Decision

The steady-state capture loop uses preallocated reusable buffers.

### Reason

Avoidable per-frame allocation increases garbage-collection pressure and scheduling jitter.

---

## RFC-A-002.21

### Decision

The capture loop produces frames according to RFC-A-003.

It does not serialize network packets directly.

### Reason

Capture and transport remain separate responsibilities.

---

## RFC-A-002.22

### Decision

Short reads are observable and handled explicitly.

They must not be silently represented as complete frames.

### Reason

Partial hardware reads affect continuity and diagnostics.

---

## RFC-A-002.23

### Decision

Read errors use typed failure or interruption reasons.

### Reason

The implementation must distinguish recoverable interruption from terminal capture failure.

---

## RFC-A-002.24

### Decision

The capture loop must remain responsive to Stop requests even while awaiting or processing audio reads.

### Reason

Local user privacy actions require prompt shutdown.

---

# 8. Interruption Handling

## RFC-A-002.25

### Decision

Capture interruptions are represented explicitly rather than hidden as silence.

### Reason

Silence and unavailable capture are different conditions.

---

## RFC-A-002.26

### Decision

Possible interruption sources include:

- microphone route change;
- higher-priority system capture;
- incoming communication activity;
- hardware loss;
- permission revocation;
- service restriction;
- unexpected `AudioRecord` state change.

### Reason

These conditions may suspend or invalidate local capture without changing Host-owned identity.

---

## RFC-A-002.27

### Decision

An interrupted capture attempt may recover only when the existing attempt remains valid and the backend can safely resume.

Otherwise, the attempt transitions to `failed` and retry creates a new attempt.

### Reason

Not every Android capture interruption supports reliable in-place recovery.

---

## RFC-A-002.28

### Decision

Permission revocation immediately ends valid capture and requires resource release.

### Reason

Capture cannot continue without local permission.

---

## RFC-A-002.29

### Decision

Interruption does not mutate Host singer, channel, assignment, queue, or performance state.

### Reason

Android reports local capture health; the Host determines Platform consequences.

---

# 9. Stop and Cleanup

## RFC-A-002.30

### Decision

The Android user may stop capture at any time.

### Reason

Local privacy authority is absolute.

---

## RFC-A-002.31

### Decision

Stop must:

1. prevent publication of new valid frames;
2. request capture-loop termination;
3. stop `AudioRecord` where safe;
4. release `AudioRecord`;
5. release attempt-owned buffers and execution resources;
6. update observable state;
7. stop related foreground-service capture ownership when appropriate.

### Reason

Capture shutdown must be explicit and complete.

---

## RFC-A-002.32

### Decision

Cleanup is required on:

- explicit local Stop;
- Host stop request accepted locally;
- permission loss;
- terminal read error;
- unrecoverable interruption;
- service shutdown;
- application-controlled capture replacement;
- process teardown where callbacks remain available.

### Reason

No failure path may intentionally retain microphone resources.

---

## RFC-A-002.33

### Decision

Cleanup operations must be safe when requested repeatedly.

### Reason

Concurrent lifecycle signals may attempt to stop the same capture attempt.

---

## RFC-A-002.34

### Decision

A failed cleanup operation must be observable through diagnostics and typed failure state.

### Reason

Silent resource-release failure makes future capture attempts unreliable.

---

# 10. Relationship to Connection and Streaming

## RFC-A-002.35

### Decision

Local capture state is independent from Platform connection state.

### Reason

Android may be connected without capturing or capturing locally while transmission is temporarily unavailable.

---

## RFC-A-002.36

### Decision

Local capture state is independent from Host stream authorization.

### Reason

The Host controls accepted transmission, while Android controls local hardware ownership.

---

## RFC-A-002.37

### Decision

During a short reconnect grace period, the current capture attempt may remain active if permitted by RFC-P-008 and local policy.

Frames produced during this period are discarded locally.

### Reason

Keeping hardware active briefly may reduce restart latency without creating stale transmission.

---

## RFC-A-002.38

### Decision

Frames captured while transmission is unauthorized or disconnected are never replayed later.

### Reason

Karaoke microphone observations must remain real-time.

---

## RFC-A-002.39

### Decision

Loss of stream authorization does not automatically require immediate `AudioRecord` release.

The exact local continuation policy must remain bounded, visible, and compliant with privacy and foreground-service rules.

### Reason

Authorization and local hardware lifecycle are separate, while indefinite hidden capture remains prohibited.

---

# 11. Capture Attempt Identity

## RFC-A-002.40

### Decision

Every capture start creates a unique runtime capture-attempt identity.

### Reason

Diagnostics, retries, and stale callback rejection require attempt isolation.

---

## RFC-A-002.41

### Decision

Callbacks, frames, and state updates from an older attempt must not overwrite a newer attempt.

### Reason

Asynchronous shutdown and restart may otherwise produce stale state corruption.

---

## RFC-A-002.42

### Decision

Capture-attempt identities are runtime-only and are not restored across process restart.

### Reason

A restarted process must revalidate permission, service state, and microphone ownership.

---

# 12. Failure Model

## RFC-A-002.43

### Decision

Capture failures use stable typed reason codes.

Examples include:

- permission-denied;
- permission-revoked;
- service-start-rejected;
- unsupported-format;
- audio-record-initialization-failed;
- audio-record-invalid-state;
- hardware-read-error;
- hardware-disconnected;
- interrupted-unrecoverable;
- capture-loop-terminated;
- cleanup-failed.

### Reason

Typed reasons support UI, tests, diagnostics, and future protocol reporting.

---

## RFC-A-002.44

### Decision

Failure messages may include human-readable context, but logic must not depend on message text.

### Reason

Machine behavior requires stable reason codes.

---

## RFC-A-002.45

### Decision

Capture failure does not delete client trust, Host source identity, channel identity, or assignment identity.

### Reason

Local capture failure and Platform-domain identity are separate lifecycles.

---

# 13. Consequences

## Benefits

- Explicit local microphone lifecycle.
- Clear separation from networking and Host authority.
- Reliable cleanup.
- Testable state transitions.
- Reduced UI coupling.
- Safe retry behavior.
- Future capture-backend replacement remains possible.
- Interruption and failure are visible rather than hidden.

## Trade-offs

- More explicit state and typed failure handling.
- Capture replacement requires coordinated stop/start sequencing.
- Android device variance still requires real-hardware validation.
- Short reconnect grace behavior adds lifecycle complexity.

## Risks

- Vendor-specific Android behavior may differ.
- Blocking reads may delay Stop if backend handling is poor.
- Incorrect interruption recovery may publish invalid frames.
- Stale callbacks may corrupt state unless attempt identity is enforced.
- Foreground-service and permission timing may vary by Android version.

---

# 14. Affected Modules

- Android Audio
- Android Service
- Android UI State
- Android Diagnostics
- Android Permission Handling
- Android Protocol Adapter
- Android Lifecycle Coordination

---

# 15. Out of Scope

This RFC intentionally does not define:

- exact frame data structure;
- queue capacity;
- network transport;
- packet encoding;
- stream encryption;
- QR pairing;
- Host discovery;
- Host projection UI;
- scoring;
- recording;
- local speaker monitoring;
- Oboe or AAudio adoption;
- power-lock policy;
- final diagnostics thresholds.

These are defined by related Platform or Android RFCs.

---

# 16. Non-Goals

This RFC does not:

- make Android authoritative;
- define the Platform protocol;
- guarantee exclusive microphone access;
- require networking for local capture;
- permit stale audio replay;
- permit overlapping local capture attempts;
- define scoring analysis;
- define recording retention;
- allow Composables to own capture resources.

---

# 17. Future Work

This RFC is extended by:

- RFC-A-003 — Audio Frame & Buffer Contract
- RFC-A-004 — Foreground Service, Privacy & Power
- RFC-A-005 — Diagnostics & Validation
- future Android Protocol Adapter RFC
- future Android audio-backend optimization RFC, if measurements justify it

---

# 18. Implementation Notes

Use an interface around the capture backend so tests can supply fake audio input.

Prefer serialized start and stop operations.

Ensure state updates are scoped to the active capture-attempt identity.

Do not publish mutable hardware buffers directly to consumers unless ownership transfer is explicit.

Capture-loop cancellation must be tested against blocked or delayed reads.

Treat actual initialized audio format as diagnostic truth.

Avoid optimistic UI transitions to `capturing` until `AudioRecord` is initialized and the capture loop is active.

---

# 19. Quick Reference

✓ `AudioRecord` is the initial backend.

✓ Capture state lives outside Composables.

✓ Explicit user action starts capture.

✓ Permission is required.

✓ One local capture attempt at a time.

✓ States are typed and observable.

✓ Retry creates a new attempt.

✓ Requested and actual formats are both reported.

✓ No exclusive-access assumption.

✓ Capture uses dedicated execution context.

✓ Steady-state buffers are reused.

✓ Short reads and interruptions are explicit.

✓ Stop always releases resources.

✓ Local user Stop always wins.

✓ Connection and capture are separate.

✓ Unauthorized or disconnected frames are discarded.

✓ Stale audio is never replayed.

✓ Stale attempt callbacks cannot overwrite newer state.

---

# 20. Change Log

## 2026-07-12

Initial accepted version.

---

> **Architecture Relationship**
>
> RFC-A-001 defines Android authority and boundaries.
>
> RFC-P-005 defines microphone resources.
>
> RFC-P-006 defines Host Capture Sessions.
>
> RFC-P-008 defines connection and stream behavior.
>
> RFC-A-002 defines how Android owns and manages its local microphone-capture attempt without acquiring Host-domain authority.
