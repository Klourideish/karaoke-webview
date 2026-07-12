# RFC-013 – Microphone Assignment & Channel Management

> **Authority**
>
> This RFC defines the architectural rules governing Microphone Channel creation, assignment and management within Karaoke Webview.
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
> - RFC-004 – Karaoke Modes
> - RFC-007 – Microphone Lifecycle
> - RFC-008 – Capture Sessions
>
> These RFCs define the architectural contracts this RFC builds upon.
>
> ---
>
> **Related RFCs**
>
> This RFC is commonly implemented alongside:
>
> - RFC-005 – Profile & Identity
> - RFC-009 – Protocol & Connection State Machine
> - RFC-010 – Scoring Pipeline

**Status:** Accepted

**Created:** 2026-07-12

**Last Updated:** 2026-07-12

**Authors:** Project

---

# 1. Summary

This RFC defines how Microphone Sources become host-managed Microphone Channels and how those channels are assigned to Session Singers.

Assignments are explicit host-owned relationships that persist throughout a Host Session while remaining independent of temporary Capture Sessions.

```text
MicrophoneSource
        │
        ▼
MicrophoneChannel
        │
        ▼
MicrophoneAssignment
        │
        ▼
SessionSinger
```

Capture Sessions consume assigned channels but never own or redefine assignments.

---

# 2. Motivation

Discovery identifies available audio sources.

Capture temporarily consumes audio.

Neither determines who owns a microphone during a karaoke session.

This RFC separates:

- physical devices
- logical channels
- singer assignments
- temporary capture

allowing each responsibility to evolve independently.

---

# 3. Decisions

## RFC-013.1

### Decision

Microphone Channels are created on demand.

Discovery alone never creates channels.

### Reason

Discovery remains an inventory of available sources.

Channels represent active karaoke session infrastructure.

---

## RFC-013.2

### Decision

Channel identity is independent of Microphone Source identity.

### Reason

Sources may disconnect or be replaced while preserving logical channel ownership.

---

## RFC-013.3

### Decision

Assignments are explicit host-owned relationships.

Assignments connect:

- one Session Singer
- one Microphone Channel

### Reason

Assignments should be managed independently of channels and capture.

---

## RFC-013.4

### Decision

One Session Singer may have at most one active Microphone Channel.

### Reason

Initial implementation targets solo and duet performances.

Future RFCs may extend this behaviour.

---

## RFC-013.5

### Decision

One Microphone Source may back at most one active Microphone Channel.

### Reason

Prevent conflicting ownership of the same physical input.

---

## RFC-013.6

### Decision

Automatic assignment follows this order:

1. Existing healthy assignment.
2. Previous session assignment.
3. Existing available channel.
4. New channel created from a suitable source.
5. Waiting for microphone.

### Reason

Provides deterministic behaviour while preserving existing assignments.

---

## RFC-013.7

### Decision

Automatic assignment never steals an assigned channel.

### Reason

The host should never unexpectedly remove another singer's microphone.

---

## RFC-013.8

### Decision

The operator may manually:

- assign channels
- reassign channels
- replace sources
- unassign singers
- release unused channels

### Reason

Manual override remains authoritative.

---

## RFC-013.9

### Decision

Assignments persist across:

- performances
- discovery refresh
- workspace changes
- temporary source disconnects

Assignments do not initially persist across application restart.

### Reason

Live session continuity is more important than permanent persistence.

---

## RFC-013.10

### Decision

Source disconnection preserves:

- channel identity
- assignment
- singer relationship

### Reason

Temporary hardware failures should not destroy karaoke session state.

---

## RFC-013.11

### Decision

Before Performance preparation the host validates:

- source availability
- channel readiness
- assignment validity
- capture availability

### Reason

Preparation must guarantee required microphone resources exist before playback.

---

## RFC-013.12

### Decision

Normal reassignment is allowed only before countdown.

During playback automatic reassignment is prohibited.

### Reason

Changing microphone ownership during a performance would invalidate capture continuity.

---

## RFC-013.13

### Decision

Diagnostic Capture Sessions may use unassigned channels.

Diagnostic activity never participates in automatic singer assignment.

### Reason

Diagnostic testing remains isolated from karaoke session management.

---

## RFC-013.14

### Decision

Releasing a singer assignment returns the channel to Available.

The channel is not destroyed.

### Reason

Channels remain reusable host resources.

---

## RFC-013.15

### Decision

Capacity exhaustion creates a Waiting for Microphone state.

### Reason

Unavailable resources should be explicit rather than silently ignored.

---

## RFC-013.16

### Decision

Persistent preferences may later associate singers with preferred sources.

Runtime assignments are not restored across application restart.

### Reason

Preferences survive between sessions while avoiding stale hardware mappings.

---

# 4. Consequences

## Benefits

- Stable logical channel identity.
- Deterministic assignment.
- Simple source replacement.
- Better recovery.
- Clear separation of ownership.
- Future Android compatibility.

## Trade-offs

- Additional runtime relationship objects.
- Explicit assignment management.

## Risks

- Poor assignment handling could delay preparation.
- Recovery logic must remain deterministic.

---

# 5. Affected Modules

- Host Domain
- Session Manager
- Microphone Manager
- Assignment Manager
- Performance Coordinator
- Android Companion
- Protocol
- Operator Workspace

---

# 6. Dependencies

- RFC-001 – Host Authority
- RFC-002 – Domain Model
- RFC-003 – Performance Lifecycle
- RFC-004 – Karaoke Modes
- RFC-007 – Microphone Lifecycle
- RFC-008 – Capture Sessions

---

# 7. Out of Scope

This RFC intentionally does not define:

- protocol transport
- Android implementation
- scoring
- recording
- UI layout
- capture implementation
- database persistence

---

# 8. Non-Goals

This RFC does not:

- define microphone discovery
- define Capture Sessions
- define scoring ownership
- define recording ownership
- define remote networking

---

# 9. Future Work

This RFC is extended by:

- RFC-009 – Protocol & Connection State Machine
- RFC-010 – Scoring Pipeline
- RFC-012 – Recording & Media Capture

---

# 10. Implementation Notes

Assignments should remain explicit host-owned relationships.

Capture Sessions consume channels.

Channels consume sources.

Each layer owns exactly one responsibility.

---

# 11. Quick Reference

✓ Channels are created on demand.

✓ Discovery never creates channels.

✓ Channel identity is independent of source identity.

✓ Assignments are explicit.

✓ One singer per channel.

✓ One source per active channel.

✓ Automatic assignment is deterministic.

✓ Manual override is always available.

✓ Assignments persist throughout the Host Session.

✓ Disconnect preserves assignment.

✓ Releasing a singer returns the channel to Available.

✓ Waiting for Microphone is explicit.

✓ Future persistence stores preferences rather than runtime assignments.

---

# 12. Change Log

## 2026-07-12

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
> RFC-004 defines operational karaoke modes.
>
> RFC-007 defines microphone infrastructure.
>
> RFC-008 defines temporary Capture Sessions.
>
> RFC-013 defines how host-managed Microphone Channels are created, assigned, recovered and reused throughout a karaoke session.
