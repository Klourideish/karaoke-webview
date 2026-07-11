# RFC-008 – Capture Sessions

> **Authority**
>
> This RFC defines the architectural lifecycle for audio Capture Sessions within Karaoke Webview.
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
> - RFC-007 – Microphone Lifecycle
>
> These RFCs define the architectural contracts this RFC builds upon.
>
> ---
>
> **Related RFCs**
>
> This RFC is commonly implemented alongside:
>
> - RFC-009 – Protocol & Connection State Machine
> - RFC-010 – Scoring Pipeline
> - RFC-012 – Recording & Media Capture

**Status:** Accepted

**Created:** 2026-07-11

**Last Updated:** 2026-07-11

**Authors:** Project

---

# 1. Summary

This RFC defines the lifecycle, ownership and responsibilities of Capture Sessions within Karaoke Webview.

A Capture Session represents the temporary use of a Microphone Channel to produce audio for one specific purpose.

Capture Sessions are host-owned runtime objects that coordinate audio capture without changing the identity or lifecycle of the underlying microphone infrastructure.

Capture Sessions form the single producer of microphone audio within Karaoke Webview. Downstream systems consume the Capture Session rather than independently accessing microphone hardware

MicrophoneSource
        │
        ▼
MicrophoneChannel
        │
        ▼
CaptureSession
        │
        ├──────────► Meter
        ├──────────► Scoring
        └──────────► Recording

---

# 2. Motivation

Microphone Channels are long-lived resources.

Audio capture is temporary.

Separating these concepts allows the same microphone channel to support:

- diagnostic testing
- karaoke performances
- calibration
- future recording
- future scoring

without redefining the microphone architecture.

---

# 3. Decisions

## RFC-008.1

### Decision

Capture Sessions are temporary host-owned runtime objects.

### Reason

The Host coordinates capture independently of the underlying microphone channel.

---

## RFC-008.2

### Decision

Capture Sessions are distinct from:

- Microphone Sources
- Microphone Channels
- Performances

### Reason

Capture represents temporary stream ownership rather than permanent infrastructure.

---

## RFC-008.3

### Decision

Capture Session kinds are:

- diagnostic
- performance
- calibration

### Reason

Different capture purposes require different behaviour while sharing the same capture pipeline.

---

## RFC-008.4

### Decision

The Capture Session lifecycle is:

created

↓

starting

↓

active

↓

stopping

↓

completed

Exceptional terminal state:

failed

### Reason

Capture requires explicit setup and cleanup independent of microphone discovery.

---

## RFC-008.5

### Decision

Only one active Capture Session may exist for a Microphone Channel.

### Reason

Multiple independent sessions must not compete for ownership of the same channel.

---

## RFC-008.6

### Decision

Only one diagnostic Capture Session may exist globally.

### Reason

Diagnostic testing is an operator function and should remain simple.

Starting a new diagnostic session automatically stops the previous one.

---

## RFC-008.7

### Decision

Performance Capture Sessions may execute concurrently across multiple Microphone Channels.

### Reason

Party Mode and future multiplayer scenarios require simultaneous capture.

---

## RFC-008.8

### Decision

Diagnostic Capture Sessions have no interaction with:

- singers
- queue
- scoring
- history
- recording

### Reason

Diagnostic testing exists solely to verify microphone functionality.

---

## RFC-008.9

### Decision

Performance Capture Sessions are associated with:

- Performance ID
- Microphone Channel ID
- Session Singer ID

### Reason

Official performances require deterministic ownership.

---

## RFC-008.10

### Decision

Recording and Scoring consume existing Performance Capture Sessions.

They do not open independent capture devices.

### Reason

Only one capture stream should exist for each active microphone channel.

---

## RFC-008.11

### Decision

Raw PCM remains within the host capture subsystem.

Frontend consumers receive normalized level snapshots only.

### Reason

The frontend should visualize capture rather than process raw audio.

---

## RFC-008.12

### Decision

Leaving the diagnostic workspace stops the active diagnostic Capture Session.

### Reason

Diagnostic capture should never continue invisibly.

---

## RFC-008.13

### Decision

Diagnostic Capture Sessions automatically stop after five minutes.

### Reason

Prevent forgotten diagnostic sessions from reserving microphone resources indefinitely.

---

## RFC-008.14

### Decision

Capture failure preserves:

- Microphone Source
- Microphone Channel
- Assignment

Only the Capture Session terminates.

### Reason

Capture failures should not destroy microphone identity or assignment.

---

## RFC-008.15

### Decision

Retrying capture creates a new Capture Session.

### Reason

Terminal sessions remain immutable.

---

## RFC-008.16

### Decision

Shared-mode capture is preferred for the initial implementation.

### Reason

Shared mode provides better compatibility with Windows and other desktop applications.

---

## RFC-008.17

### Decision

Capture Sessions publish audio to independent consumers.

Consumers may include:

- level metering
- scoring
- recording

Each consumer subscribes to the same capture stream.

### Reason

The capture backend should own audio acquisition while downstream systems remain independent.

---

# 4. Consequences

## Benefits

- Clear separation between infrastructure and capture.
- One capture stream per microphone channel.
- Simple diagnostic workflow.
- Extensible consumer model.
- Shared backend for future scoring and recording.
- Reduced duplication.

## Trade-offs

- Additional runtime object.
- Explicit lifecycle management.
- Capture ownership becomes a coordinated subsystem.

## Risks

- Poor cleanup could reserve microphone resources.
- Multiple consumers must remain synchronized.
- Future transports must honour the capture lifecycle.

---

# 5. Affected Modules

- Host Domain
- Capture Manager
- Microphone Manager
- Performance Coordinator
- Diagnostic Workspace
- Scoring
- Recording

---

# 6. Dependencies

- RFC-001 – Host Authority
- RFC-002 – Domain Model
- RFC-003 – Performance Lifecycle
- RFC-007 – Microphone Lifecycle

---

# 7. Out of Scope

This RFC intentionally does not define:

- WASAPI implementation
- Android implementation
- protocol transport
- PCM formats
- recording codecs
- scoring algorithms
- UI rendering
- monitoring output

---

# 8. Non-Goals

This RFC does not:

- define audio processing
- define recording implementation
- define scoring implementation
- define protocol transport
- define monitoring behaviour

---

# 9. Future Work

This RFC is extended by:

- RFC-009 – Protocol & Connection State Machine
- RFC-010 – Scoring Pipeline
- RFC-012 – Recording & Media Capture

---

# 10. Implementation Notes

Capture Sessions should own the lifetime of active audio streams.

Microphone Channels remain long-lived infrastructure.

Consumers should subscribe to Capture Sessions rather than opening independent device streams.

The frontend should never receive raw PCM data.

---

# 11. Quick Reference

✓ Host owns Capture Sessions.

✓ Capture Session ≠ Microphone Channel.

✓ One Capture Session per channel.

✓ One diagnostic Capture Session globally.

✓ Performance Capture Sessions may run concurrently.

✓ Diagnostic capture has no scoring or history.

✓ Raw PCM remains inside the host.

✓ Frontend receives normalized level snapshots only.

✓ Recording and Scoring consume existing capture.

✓ Leaving the diagnostic workspace stops capture.

✓ Five-minute diagnostic timeout.

✓ Retry creates a new Capture Session.

---

# 12. Change Log

## 2026-07-11

Initial accepted version.

---

> **Relationship to the Core RFCs**
>
> RFC-001 defines authority.
>
> RFC-002 defines the domain vocabulary.
>
> RFC-003 defines Performance behaviour.
>
> RFC-007 defines microphone infrastructure.
>
> RFC-008 defines how temporary audio capture is coordinated without changing the ownership or lifecycle of microphone resources.