# RFC-007 – Microphone Lifecycle

> **Authority**
>
> This RFC defines the architectural lifecycle for microphone management within Karaoke Webview.
>
> Accepted RFCs are authoritative.
>
> Implementations must conform to Accepted RFCs.
>
> If implementation conflicts with this RFC, stop and request a Design Review rather than silently changing the architecture.
>
> **Core Dependencies**
>
> This RFC extends:
>
> - RFC-001 – Host Authority
> - RFC-002 – Domain Model
> - RFC-003 – Performance Lifecycle
>
> It does not redefine those documents.

**Status:** Accepted

**Created:** 2026-07-11

**Last Updated:** 2026-07-11

**Authors:** Project

---

# 1. Summary

This RFC defines the authoritative lifecycle of microphone resources within Karaoke Webview.

Microphones are host-managed infrastructure resources that provide captured audio for karaoke performances.

The architecture separates microphone sources, microphone channels, singer assignments and performance participation into distinct responsibilities.

This separation allows local Windows microphones, future Android companion devices and future capture adapters to participate through the same host-managed lifecycle.

---

# 2. Motivation

Microphone management must support multiple physical capture technologies while presenting one consistent model to the rest of the application.

Playback, lyrics, scoring, recording and networking should never depend upon how audio enters the system.

Instead they consume host-managed microphone channels.

Separating microphone sources from microphone channels provides:

- transport independence
- stable singer assignment
- reliable recovery
- simplified future platform support
- deterministic performance preparation

---

# 3. Decisions

## RFC-007.1

### Decision

Microphone Channels are authoritative host-owned resources.

### Reason

Channels coordinate assignment, readiness and capture independently of the physical source.

---

## RFC-007.2

### Decision

Microphone Sources represent physical or remote audio origins.

Examples include:

- Windows capture devices
- Android companion devices
- Future capture adapters

### Reason

The source abstraction isolates hardware and transport differences from the host domain.

---

## RFC-007.3

### Decision

A Microphone Source never owns a Microphone Channel.

### Reason

Sources may disconnect or be replaced while preserving channel identity.

---

## RFC-007.4

### Decision

Channels are assigned to Session Singers.

### Reason

Assignment belongs to the karaoke session rather than individual performances.

---

## RFC-007.5

### Decision

A Session Singer may own at most one active channel.

### Reason

Initial implementation targets solo and duet performances.

Future RFCs may extend this behaviour.

---

## RFC-007.6

### Decision

Hybrid microphone assignment is the default.

The host automatically assigns suitable channels.

The operator may override assignments manually.

### Reason

Automatic assignment provides convenience while manual control supports recovery and live events.

---

## RFC-007.7

### Decision

Assigned channels remain open while assigned.

Channels close only when:

- explicitly released
- disconnected
- the assignment ends
- the Host Session ends

### Reason

Maintaining capture readiness reduces latency between performances.

---

## RFC-007.8

### Decision

Mute, gain, level, health, latency and calibration are channel properties rather than lifecycle states.

### Reason

Operational properties should not multiply lifecycle complexity.

---

## RFC-007.9

### Decision

Calibration is optional metadata.

### Reason

Readiness should not depend upon future scoring policies.

---

## RFC-007.10

### Decision

The authoritative channel lifecycle is:

available

↓

assigned

↓

opening

↓

ready

↓

armed

↓

capturing

↓

finalizing

↓

ready

Exceptional transition:

disconnected

Explicit release returns the channel to:

available

### Reason

The lifecycle separates assignment, preparation, capture and recovery.

---

## RFC-007.11

### Decision

Countdown arms channels.

Official capture begins at authoritative song time zero.

### Reason

Preparation should complete before scoring begins.

---

## RFC-007.12

### Decision

Channels finalize before Performance results become available.

### Reason

Capture completion must precede scoring finalization and history persistence.

---

## RFC-007.13

### Decision

Assignments normally persist across multiple performances.

### Reason

Singers commonly retain the same microphone throughout a karaoke session.

---

## RFC-007.14

### Decision

Microphone Sources may be replaced while preserving the assigned channel.

### Reason

Logical channel identity should remain stable during technical recovery.

---

## RFC-007.15

### Decision

Mute does not stop capture.

### Reason

Monitoring, diagnostics and future recording policies require continuous capture availability.

---

## RFC-007.16

### Decision

Disconnected channels retain identity for recovery.

### Reason

Temporary failures should not destroy assignment or singer relationships.

---

# 4. Consequences

## Benefits

- Transport-independent architecture.
- Stable singer assignment.
- Simple recovery.
- Consistent preparation.
- Shared lifecycle for Windows and Android.
- Reduced future refactoring.

## Trade-offs

- More explicit domain modelling.
- Additional host coordination.

## Risks

- Poor recovery implementation could delay performances.
- Future transports must honour lifecycle semantics.

---

# 5. Affected Modules

- Host Domain
- Microphone Manager
- Playback Preparation
- Performance Coordinator
- Android Companion
- Protocol
- Scoring
- Recording

---

# 6. Dependencies

- RFC-001 – Host Authority
- RFC-002 – Domain Model
- RFC-003 – Performance Lifecycle

---

# 7. Out of Scope

This RFC intentionally does not define:

- WASAPI implementation
- Android implementation
- protocol transport
- PCM formats
- jitter buffering
- scoring algorithms
- recording formats
- audio effects
- noise suppression
- UI

---

# 8. Non-Goals

This RFC does not:

- define capture implementation
- define networking
- define monitoring output
- define score calculation
- define recording policy

---

# 9. Future Work

This RFC is extended by:

- RFC-008 – Capture Sessions
- RFC-009 – Protocol & Connection State Machine
- RFC-010 – Scoring Pipeline
- RFC-012 – Recording & Media Capture

---

# 10. Implementation Notes

Implementations should treat Microphone Channels as long-lived host resources.

Capture technologies should adapt to the host lifecycle rather than redefining it.

All microphone implementations should expose identical lifecycle behaviour regardless of transport.

---

# 11. Quick Reference

✓ Host owns channels.

✓ Sources provide audio.

✓ Sources never own channels.

✓ Channels belong to Session Singers.

✓ Hybrid assignment.

✓ One active channel per singer.

✓ Assigned channels remain open.

✓ Mute is a property.

✓ Calibration is optional.

✓ Countdown arms channels.

✓ Capture begins at song time zero.

✓ Assignments persist.

✓ Source replacement preserves channels.

✓ Disconnection supports recovery.

---

# 12. Change Log

## 2026-07-11

Initial accepted version.

---

> **Relationship to the Core RFCs**
>
> RFC-001 defines authority.
>
> RFC-002 defines microphone terminology.
>
> RFC-003 defines how Performances progress.
>
> RFC-007 defines how microphone infrastructure participates within that lifecycle while remaining transport-independent.