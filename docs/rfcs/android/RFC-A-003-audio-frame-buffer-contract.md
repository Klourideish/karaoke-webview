# RFC-A-003 — Audio Frame & Buffer Contract

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
> - RFC-A-002 — Android Audio Capture Lifecycle
>
> It does not redefine those documents.

---

> **Related RFCs**
>
> This RFC is commonly implemented alongside:
>
> - RFC-A-004 — Foreground Service, Privacy & Power
> - RFC-A-005 — Diagnostics & Validation
> - future Android Protocol Adapter RFC

---

# 1. Summary

This RFC defines the transport-neutral audio frame and buffering contract produced by the Android capture subsystem.

The Android capture engine converts local microphone reads into ordered `CapturedAudioFrame` objects and publishes them through an `AudioFrameSink`.

This boundary exists before networking.

It does not define the final Platform packet encoding, socket transport, encryption, pairing, or Host protocol adapter.

```text
AudioRecord
    │
    ▼
CapturedAudioFrame
    │
    ▼
Bounded Frame Queue
    │
    ▼
AudioFrameSink
```

---

# 2. Motivation

The Android capture subsystem and future protocol adapter must remain independently testable.

Without a stable frame boundary, capture code may become coupled directly to:

- UDP packet construction;
- socket availability;
- protocol session identity;
- encryption;
- Host authorization;
- network buffering;
- scoring assumptions.

This RFC defines one local frame model that can be consumed by:

- a diagnostic sink;
- a discard sink;
- a test sink;
- a future protocol sink;
- future local analysis consumers.

The capture engine produces audio observations.

Downstream adapters decide how those observations are consumed.

---

# 3. Frame Boundary

## RFC-A-003.1

### Decision

The Android capture subsystem publishes audio through a transport-neutral `CapturedAudioFrame` contract.

### Reason

Capture must not depend on the final network implementation.

---

## RFC-A-003.2

### Decision

Captured frames are delivered through an `AudioFrameSink` boundary.

Conceptually:

```kotlin
interface AudioFrameSink {
    suspend fun accept(frame: CapturedAudioFrame)
}
```

The exact language-level signature may vary while preserving the same ownership boundary.

### Reason

Consumers must be replaceable without changing microphone capture.

---

## RFC-A-003.3

### Decision

The capture subsystem must not construct final RFC-P-008 network packets directly.

### Reason

Platform packet framing, authentication, encryption, and transport belong to the future protocol adapter.

---

## RFC-A-003.4

### Decision

The initial Stage 1 sink may discard audio samples after updating diagnostics.

### Reason

Local capture quality must be proven before networking is introduced.

---

# 4. Initial Audio Profile

## RFC-A-003.5

### Decision

The initial requested frame profile is:

- mono;
- 48 kHz;
- signed PCM16;
- 10 ms nominal frame duration.

### Reason

This matches the initial Platform protocol profile while remaining simple and testable.

---

## RFC-A-003.6

### Decision

At 48 kHz mono, a complete 10 ms frame contains:

```text
480 samples
960 bytes of PCM16 payload
```

### Reason

The frame size must be deterministic for continuity, timing, and testing.

---

## RFC-A-003.7

### Decision

Frame metadata must identify the actual audio profile associated with the frame stream.

### Reason

The requested format and initialized hardware format may differ.

---

## RFC-A-003.8

### Decision

Frames must not be labelled as the requested format when the capture backend produced a different format.

### Reason

Consumers require truthful format information.

---

## RFC-A-003.9

### Decision

A capture attempt that cannot safely produce the accepted local frame profile must fail clearly or pass through an explicitly defined normalization boundary before publishing frames.

### Reason

Silent format mismatch would corrupt timing and audio interpretation.

---

# 5. CapturedAudioFrame Contract

## RFC-A-003.10

### Decision

Each `CapturedAudioFrame` contains at least:

- capture attempt ID;
- frame sequence number;
- first sample index;
- monotonic capture timestamp;
- sample count;
- sample rate;
- channel count;
- encoding;
- PCM sample payload.

### Reason

Consumers need identity, ordering, continuity, timing, format, and audio data.

---

## RFC-A-003.11

### Decision

The frame sequence number is monotonically increasing within one capture attempt.

### Reason

It provides simple frame ordering and gap detection.

---

## RFC-A-003.12

### Decision

Sequence numbers begin from an implementation-defined initial value and never move backwards within one capture attempt.

### Reason

Monotonic behavior matters more than a particular starting number.

---

## RFC-A-003.13

### Decision

A new capture attempt begins a new local sequence domain.

### Reason

Sequence continuity must not be implied across independent hardware sessions.

---

## RFC-A-003.14

### Decision

`firstSampleIndex` identifies the position of the frame’s first sample within the active capture attempt.

### Reason

Sample position provides exact audio continuity independently of scheduling time.

---

## RFC-A-003.15

### Decision

The next complete contiguous frame normally begins at:

```text
previous.firstSampleIndex + previous.sampleCount
```

### Reason

Consumers can detect missing or discontinuous sample ranges.

---

## RFC-A-003.16

### Decision

The monotonic capture timestamp represents the capture timeline of the frame’s first sample or the closest reliable approximation exposed by the backend.

### Reason

The Platform requires a monotonic timing basis for future Host alignment.

---

## RFC-A-003.17

### Decision

Capture timestamps must use a monotonic clock rather than wall-clock time.

### Reason

Wall clocks may jump because of time-zone, synchronization, or user changes.

---

## RFC-A-003.18

### Decision

Timestamp meaning must remain consistent for the lifetime of one capture attempt.

### Reason

Changing timestamp semantics mid-attempt would make timing diagnostics invalid.

---

## RFC-A-003.19

### Decision

`sampleCount` describes valid samples in the frame payload.

### Reason

Consumers must not infer validity from buffer capacity.

---

## RFC-A-003.20

### Decision

Frame payload ownership must be explicit.

A producer must not mutate sample data after ownership has been transferred to the sink.

### Reason

Reused mutable buffers can otherwise corrupt asynchronously consumed frames.

---

# 6. Buffer Ownership and Reuse

## RFC-A-003.21

### Decision

The steady-state capture loop should reuse preallocated buffers.

### Reason

Per-frame allocation increases garbage-collection pressure and scheduling jitter.

---

## RFC-A-003.22

### Decision

Buffer reuse must not violate frame ownership.

Allowed strategies include:

- bounded buffer pool;
- copy into a preallocated queue slot;
- ownership transfer with later buffer return;
- equivalent explicit ownership model.

### Reason

Allocation reduction must not introduce data races or mutation-after-publication.

---

## RFC-A-003.23

### Decision

The implementation must not expose an `AudioRecord` working buffer directly to asynchronous consumers unless exclusive ownership is transferred.

### Reason

The capture backend may reuse that buffer immediately.

---

## RFC-A-003.24

### Decision

Frame buffers must have bounded lifetime and bounded total capacity.

### Reason

The application must not accumulate unbounded microphone data in memory.

---

## RFC-A-003.25

### Decision

Sensitive audio buffers should become unreachable promptly after consumption and must not be intentionally persisted during Stage 1.

### Reason

The capture sandbox is not a recording system.

---

# 7. Short Reads and Partial Frames

## RFC-A-003.26

### Decision

Short hardware reads are not automatically published as complete 10 ms frames.

### Reason

A partial read is not equivalent to a complete nominal frame.

---

## RFC-A-003.27

### Decision

The frame assembler may combine valid short reads until one complete frame is available.

### Reason

Android hardware reads may not align exactly with the application’s nominal frame size.

---

## RFC-A-003.28

### Decision

The partial-frame assembly buffer is bounded.

### Reason

Hardware or lifecycle failure must not create unbounded accumulation.

---

## RFC-A-003.29

### Decision

When capture stops or fails, an incomplete trailing frame may be discarded.

It must not be padded and published as genuine captured audio unless a later RFC explicitly defines that behavior.

### Reason

Synthetic padding would obscure the actual captured sample sequence.

---

## RFC-A-003.30

### Decision

Short-read count and discarded partial-sample count are observable diagnostics.

### Reason

Capture quality and device behavior must be measurable.

---

# 8. Queueing and Backpressure

## RFC-A-003.31

### Decision

Any queue between capture and frame consumption must be strictly bounded.

### Reason

Microphone capture must never create unbounded latency or memory growth.

---

## RFC-A-003.32

### Decision

Queue capacity is an Android implementation setting and must be reported through diagnostics.

### Reason

The exact capacity may be tuned through measurement without changing the architectural rule.

---

## RFC-A-003.33

### Decision

When the bounded outgoing queue is full, the oldest stale queued frame is discarded before accepting newer real-time audio.

### Reason

Current audio is more valuable than delayed audio for metering and scoring.

---

## RFC-A-003.34

### Decision

Dropped frames are never replayed later.

### Reason

The audio path is real-time, not a reliable recording transport.

---

## RFC-A-003.35

### Decision

Queue overflow increments a typed local dropped-frame diagnostic.

### Reason

Backpressure must remain visible.

---

## RFC-A-003.36

### Decision

A slow sink must not indefinitely block microphone hardware reads.

### Reason

Capture stability must not depend on downstream consumer speed.

---

## RFC-A-003.37

### Decision

The sink or queue consumer may be cancelled independently during capture shutdown.

### Reason

Stop and cleanup must not deadlock behind a blocked consumer.

---

# 9. Ordering and Continuity

## RFC-A-003.38

### Decision

Frames are emitted in capture order.

### Reason

Downstream consumers require one deterministic local audio sequence.

---

## RFC-A-003.39

### Decision

The Android frame boundary does not reorder frames.

### Reason

Network reordering belongs to the future Platform protocol and Host jitter-buffer layers.

---

## RFC-A-003.40

### Decision

A discontinuity is represented through sequence or sample-index gaps rather than by silently renumbering remaining frames.

### Reason

Consumers must be able to observe missing audio honestly.

---

## RFC-A-003.41

### Decision

Local dropped frames preserve the original sequence and sample progression of later frames.

### Reason

Reassigning indexes would hide the discontinuity.

---

## RFC-A-003.42

### Decision

Frames from different capture attempts must never share one continuity domain.

### Reason

Hardware restart creates a new stream of observations.

---

# 10. Invalid and Silent Audio

## RFC-A-003.43

### Decision

PCM16 samples are interpreted using their full signed 16-bit range.

### Reason

Metering and future normalization require deterministic sample semantics.

---

## RFC-A-003.44

### Decision

Silence is valid captured audio and must not be treated as a hardware failure by itself.

### Reason

A quiet microphone and a broken capture path are different states.

---

## RFC-A-003.45

### Decision

Interruption, unavailable hardware, and failed reads must not be represented solely by synthetic zero-filled frames.

### Reason

Consumers need to distinguish real silence from missing capture.

---

## RFC-A-003.46

### Decision

Malformed frame metadata or payload-length mismatch must be rejected before publication.

### Reason

Invalid frames must not reach diagnostics or future protocol serialization.

---

## RFC-A-003.47

### Decision

Frame validation uses typed failure reasons.

### Reason

Tests and diagnostics must not depend on free-text errors.

---

# 11. Relationship to Diagnostics

## RFC-A-003.48

### Decision

The frame pipeline exposes metrics sufficient to observe:

- frames produced;
- samples produced;
- short reads;
- partial-frame accumulation;
- discarded partial samples;
- current queue depth;
- maximum queue depth;
- dropped frames;
- sink processing duration;
- capture-to-consumption delay;
- sequence gaps;
- sample-index gaps.

### Reason

The local pipeline must be validated before networking depends on it.

---

## RFC-A-003.49

### Decision

Local RMS and peak metrics may be computed as a diagnostic consumer of captured frames.

### Reason

Metering validates the capture path without changing the frame contract.

---

## RFC-A-003.50

### Decision

Local diagnostic processing must not become authoritative scoring.

### Reason

Official scoring remains Host-owned.

---

## RFC-A-003.51

### Decision

Diagnostic consumers must obey the same bounded-buffer and ownership rules as future network consumers.

### Reason

Stage 1 should exercise the same fundamental pipeline constraints used later.

---

# 12. Relationship to Platform Networking

## RFC-A-003.52

### Decision

`CapturedAudioFrame` is not the RFC-P-008 wire packet.

### Reason

The local model and network representation have different responsibilities.

---

## RFC-A-003.53

### Decision

The future Android protocol adapter will transform local frames into negotiated Platform audio packets.

### Reason

Protocol metadata, stream identity, encryption, and authentication belong to the adapter.

---

## RFC-A-003.54

### Decision

Local capture-attempt identity is distinct from Platform `AudioStreamId`.

### Reason

A local hardware attempt may exist before or without Host stream authorization.

---

## RFC-A-003.55

### Decision

Frames produced while no Platform stream is authorized may be consumed locally or discarded, but are never transmitted later as backlog.

### Reason

Platform audio must remain real-time and Host-authorized.

---

## RFC-A-003.56

### Decision

A future negotiated format change creates a new Platform audio stream and may require a new local capture attempt or explicit normalization stage.

### Reason

Format identity must remain stable within each stream.

---

# 13. Concurrency

## RFC-A-003.57

### Decision

One active capture attempt has one authoritative frame sequence.

### Reason

Multiple producers must not write into the same sequence domain.

---

## RFC-A-003.58

### Decision

Multiple consumers may observe one local frame stream only through an explicit fan-out boundary.

### Reason

Capture should not independently duplicate hardware reads for each consumer.

---

## RFC-A-003.59

### Decision

A consumer failure must not silently terminate the microphone capture loop unless that consumer is explicitly required by the active mode.

### Reason

Optional diagnostics should not own capture lifetime.

---

## RFC-A-003.60

### Decision

Stale asynchronous work from an earlier capture attempt must be rejected using capture-attempt identity.

### Reason

Delayed consumers must not publish state into a newer attempt.

---

# 14. Consequences

## Benefits

- Capture remains independent from networking.
- Frame ordering and timing are explicit.
- Buffer ownership is testable.
- Memory and latency remain bounded.
- Future protocol code receives a stable local input contract.
- Diagnostic and network sinks can use the same pipeline.
- Missing audio remains observable.
- Per-frame allocation pressure can be minimized safely.

## Trade-offs

- Buffer pooling or bounded queue slots increase implementation complexity.
- Partial-read assembly requires explicit bookkeeping.
- Dropping stale frames sacrifices completeness to preserve real-time behavior.
- Consumers must respect ownership and cancellation rules.

## Risks

- Incorrect buffer reuse may corrupt frame payloads.
- Slow consumers may cause local frame drops.
- Incorrect sample-index progression may damage future timeline alignment.
- Device-specific short-read behavior may require tuning.
- Overly large queues may hide performance problems while increasing latency.

---

# 15. Affected Modules

- Android Audio
- Android Frame Model
- Android Buffer Pool
- Android Diagnostics
- Android Local Meter
- Android Protocol Adapter
- Android Test Fakes

---

# 16. Out of Scope

This RFC intentionally does not define:

- final Platform packet encoding;
- UDP socket behavior;
- encryption or authentication;
- QR pairing;
- Host discovery;
- stream authorization messages;
- Host jitter-buffer behavior;
- compressed codecs;
- local recording;
- scoring algorithms;
- exact queue capacity;
- exact buffer-pool implementation;
- UI visual design.

---

# 17. Non-Goals

This RFC does not:

- define networking;
- guarantee delivery;
- permit unbounded buffering;
- replay stale frames;
- treat silence as failure;
- hide missing audio using synthetic silence;
- make local diagnostics authoritative;
- allow mutable payloads to be reused after ownership transfer;
- persist captured audio.

---

# 18. Future Work

This RFC is extended by:

- RFC-A-004 — Foreground Service, Privacy & Power
- RFC-A-005 — Diagnostics & Validation
- future Android Protocol Adapter RFC
- future Platform packet encoding specification
- future compressed-audio capability RFC, if required

---

# 19. Implementation Notes

Prefer one reusable frame assembler per active capture attempt.

Consider a small bounded pool of PCM arrays or fixed-size frame slots.

Do not optimize by exposing mutable buffers without clear ownership.

Use `SystemClock.elapsedRealtimeNanos()` or an equivalent monotonic source when hardware timestamps are not available.

Where Android exposes a more accurate capture timestamp, preserve the semantic meaning and report its quality.

Avoid using wall-clock timestamps in frame continuity logic.

Test frame assembly with arbitrary short-read boundaries rather than only exact 480-sample reads.

Test queue overflow deterministically using a deliberately slow fake sink.

---

# 20. Quick Reference

✓ `AudioRecord` produces transport-neutral frames.

✓ `CapturedAudioFrame` is not a network packet.

✓ Initial profile is mono 48 kHz PCM16.

✓ Nominal frame duration is 10 ms.

✓ Complete frames contain 480 samples.

✓ Sequence number is monotonic per capture attempt.

✓ First sample index tracks continuity.

✓ Capture timestamp uses a monotonic clock.

✓ Payload ownership is explicit.

✓ Steady-state buffers are reused safely.

✓ Short reads may be assembled.

✓ Partial trailing frames may be discarded.

✓ Queues are strictly bounded.

✓ Oldest stale queued frames are dropped first.

✓ Dropped audio is never replayed.

✓ Slow consumers do not indefinitely block capture.

✓ Silence is valid audio.

✓ Missing capture is not hidden as silence.

✓ Local meter is diagnostic only.

✓ Platform stream identity remains separate from local attempt identity.

---

# 21. Change Log

## 2026-07-13

Initial accepted version.

---

> **Architecture Relationship**
