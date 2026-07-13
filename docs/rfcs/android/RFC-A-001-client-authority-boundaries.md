# RFC-A-001 — Android Client Authority & Boundaries

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
> - RFC-P-002 — Platform Domain Model
> - RFC-P-005 — Microphone Resource Model
> - RFC-P-007 — Microphone Assignment & Channel Management
> - RFC-P-008 — Platform Protocol & Connection State Machine
>
> It does not redefine those documents.

---

> **Android Dependencies**
>
> This RFC is the root Android architecture RFC.
>
> It has no Android RFC dependencies.

---

> **Related RFCs**
>
> This RFC is commonly implemented alongside:
>
> - RFC-A-002 — Android Audio Capture Lifecycle
> - RFC-A-003 — Audio Frame & Buffer Contract
> - RFC-A-004 — Foreground Service, Privacy & Power
> - RFC-A-005 — Diagnostics & Validation

---

# 1. Summary

This RFC defines the authority, ownership boundaries, and responsibilities of the Karaoke Webview Android Companion.

The Android Companion is a thin capture client.

It manages local Android responsibilities such as microphone permission, audio capture, buffering, foreground-service behavior, protocol participation, reconnection attempts, diagnostics, and local presentation.

It never becomes authoritative for Karaoke Webview domain state.

```text
Android Companion
        │
        ├── owns local capture and device lifecycle
        ├── sends observations and requests
        ├── displays read-only Host projections
        │
        ▼
Platform Protocol
        │
        ▼
Authoritative Host
```

---

# 2. Motivation

The Android Companion participates in a distributed system, but Karaoke Webview must retain one authoritative domain owner.

Without strict boundaries, the Android application could begin duplicating or mutating:

- singer state;
- microphone assignments;
- queue state;
- performance state;
- scoring;
- history;
- session ownership.

That would introduce conflicting state, synchronization races, recovery ambiguity, and unnecessary implementation complexity.

This RFC prevents that drift by defining Android as an active local capture client without granting it authority over the karaoke domain.

---

# 3. Decisions

## RFC-A-001.1

### Decision

The Android Companion is a thin capture client.

### Reason

It performs meaningful local work while remaining subordinate to Platform and Host authority.

---

## RFC-A-001.2

### Decision

The Android Companion owns local Android responsibilities, including:

- microphone permission flow;
- local microphone capture;
- audio frame production;
- bounded buffering;
- frame sequencing;
- foreground-service lifecycle;
- local interruption handling;
- reconnect attempts;
- protocol-client lifecycle;
- local diagnostics;
- local UI state;
- privacy controls.

### Reason

These responsibilities are device-local and cannot be delegated safely to the Host.

---

## RFC-A-001.3

### Decision

The Android Companion does not own or authoritatively mutate:

- `Singer`;
- `SingerProfile`;
- `SessionSinger`;
- `MicrophoneChannel`;
- `MicrophoneAssignment`;
- `QueueItem`;
- `Performance`;
- `PerformanceRecord`;
- `Score`;
- `History`;
- `HostSession`.

### Reason

These are authoritative Platform-domain concepts owned by the Host.

---

## RFC-A-001.4

### Decision

Android may send:

- connection requests;
- pairing requests;
- capability declarations;
- lifecycle requests;
- microphone observations;
- diagnostics;
- local user requests.

These messages do not directly commit Platform-domain mutations.

### Reason

Clients request or observe. The Host decides authoritative outcomes.

---

## RFC-A-001.5

### Decision

Android may receive and display immutable Host projections.

Examples may include:

- singer display name;
- assigned channel label;
- stream authorization state;
- Host mute state;
- upcoming participation state;
- connection instructions;
- operator messages.

### Reason

The client requires useful presentation context without receiving authority.

---

## RFC-A-001.6

### Decision

Host projections are presentation models, not local copies of authoritative domain entities.

### Reason

Android must not accidentally treat projected data as independent domain truth.

---

## RFC-A-001.7

### Decision

Host projections may be retained temporarily in memory for UI continuity and bounded reconnect behavior.

They must not be persisted as authoritative karaoke state.

### Reason

Temporary presentation continuity is useful, while persistent duplicated domain state creates synchronization risk.

---

## RFC-A-001.8

### Decision

Connection state, local capture state, stream authorization, source registration, channel assignment, and singer identity are separate concepts.

### Reason

Combining them would create invalid assumptions such as:

- connected means assigned;
- assigned means streaming;
- capturing means authorized;
- trusted means singer identity;
- disconnected means assignment deleted.

---

## RFC-A-001.9

### Decision

Pairing identity is separate from singer identity.

### Reason

A trusted Android installation is a client device, not inherently a karaoke participant.

---

## RFC-A-001.10

### Decision

Stream authorization is controlled by the Host and may be granted or revoked without changing connection or assignment state.

### Reason

The Host may require a client to remain connected while not transmitting accepted audio.

---

## RFC-A-001.11

### Decision

Android does not create or own `MicrophoneChannel` or `MicrophoneAssignment` records.

### Reason

Android exposes microphone observations that may become a Host-owned `NetworkMicrophoneSource`.

Channel creation and assignment remain Host responsibilities.

---

## RFC-A-001.12

### Decision

The Android user may stop local capture at any time.

A Host request cannot override an explicit local Stop action.

### Reason

Microphone access must remain locally visible, revocable, and consent-based.

---

## RFC-A-001.13

### Decision

Android must clearly indicate when local microphone capture is active.

### Reason

Hidden microphone use is incompatible with the privacy model.

---

## RFC-A-001.14

### Decision

Android must not emulate a Windows microphone device.

### Reason

The companion communicates through the Karaoke Webview Platform Protocol and exposes a network microphone source through the Host adapter.

---

## RFC-A-001.15

### Decision

Android must not perform authoritative karaoke scoring.

### Reason

Official scoring belongs to the Host and consumes Host-owned Capture Sessions.

Local diagnostic analysis may be introduced later only when explicitly classified as non-authoritative.

---

## RFC-A-001.16

### Decision

Android must not independently implement queue, performance, lyrics, or history logic.

### Reason

These behaviors belong to the Host platform and may only be projected read-only where useful.

---

## RFC-A-001.17

### Decision

Android local runtime state is not automatically restored as active capture or active protocol participation after process death or device restart.

### Reason

Microphone access and streaming require fresh lifecycle validation and visible user consent.

---

## RFC-A-001.18

### Decision

Android implementation-specific architecture may extend Platform RFCs but may never redefine or contradict them.

### Reason

The Android Companion is one implementation beneath the shared Platform architecture.

---

# 4. Authority Boundaries

## Android owns

```text
Permission
Capture
Buffers
Frames
Service lifecycle
Local UI
Local diagnostics
Reconnect attempts
Privacy controls
```

## Host owns

```text
Trust acceptance
Protocol session authority
Network MicrophoneSource registration
MicrophoneChannel creation
MicrophoneAssignment
Singer identity
Queue
Performance
Scoring
Recording policy
History
```

## Shared through Platform protocol

```text
Requests
Observations
Capabilities
Diagnostics
Read-only projections
Authorization outcomes
Connection lifecycle
```

---

# 5. Consequences

## Benefits

- One authoritative karaoke domain.
- Reduced state synchronization complexity.
- Android remains small and testable.
- Host features can evolve without forcing equivalent Android domain changes.
- Future clients may follow the same boundary.
- Local privacy remains enforceable.
- Android implementation agents receive clear architectural limits.

## Trade-offs

- Android depends on Host projections for meaningful karaoke context.
- Some UI actions require a request/response round trip.
- Offline karaoke-domain behavior is intentionally limited.
- The Android UI cannot assume a request has succeeded until the Host confirms it.

## Risks

- Poorly named projection models could be mistaken for authoritative entities.
- Implementation shortcuts may accidentally duplicate Host state.
- Client requests may be presented optimistically before authoritative confirmation.
- Capture and connection state may become incorrectly coupled if state ownership is not kept explicit.

---

# 6. Affected Modules

- Android UI
- Android Audio
- Android Service
- Android Protocol
- Android Network
- Android Diagnostics
- Android Local Storage
- Platform Projection Models

---

# 7. Out of Scope

This RFC intentionally does not define:

- `AudioRecord` configuration;
- capture buffer dimensions;
- audio frame layout;
- foreground-service implementation details;
- transport selection;
- packet encoding;
- pairing UI;
- QR format;
- network security libraries;
- diagnostics metrics;
- visual design;
- Host implementation details.

These are defined by later Android or Platform RFCs.

---

# 8. Non-Goals

This RFC does not:

- define the Platform Protocol;
- define scoring;
- define recording;
- define Android audio framing;
- define Host projections in detail;
- permit Android domain authority;
- create an offline karaoke mode;
- permit hidden background microphone use;
- define Windows virtual-device behavior.

---

# 9. Future Work

This RFC is extended by:

- RFC-A-002 — Android Audio Capture Lifecycle
- RFC-A-003 — Audio Frame & Buffer Contract
- RFC-A-004 — Foreground Service, Privacy & Power
- RFC-A-005 — Diagnostics & Validation
- future Android Protocol Adapter RFC
- future Android Host Projection RFC

---

# 10. Implementation Notes

Use immutable local state models.

Name projected Platform state clearly, for example:

```text
SingerProjection
ChannelProjection
AssignmentProjection
PerformanceProjection
```

Do not reuse authoritative Platform entity names where that would imply local ownership.

Local UI actions that affect Host state should produce explicit requests and wait for authoritative results.

Avoid persistence of Host projections unless a later RFC defines a narrow, non-authoritative cache.

Keep Android state ownership outside Composables.

Composables should render state and issue intents rather than own capture, service, or protocol lifecycles.

---

# 11. Quick Reference

✓ Android is a thin capture client.

✓ Android owns local permission, capture, buffering, service, diagnostics, and privacy.

✓ Host owns karaoke-domain state.

✓ Client actions are requests.

✓ Host responses are authoritative outcomes.

✓ Host data on Android is read-only projection data.

✓ Pairing identity is not singer identity.

✓ Connection is not stream authorization.

✓ Stream authorization is not assignment.

✓ Android never creates Host channels or assignments.

✓ Local user Stop always wins.

✓ Active capture must be visible.

✓ Android does not emulate a Windows microphone.

✓ Android-specific RFCs extend but never redefine Platform RFCs.

---

# 12. Change Log

## 2026-07-12

Initial accepted version.

---

> **Architecture Relationship**
>
> RFC-P-001 defines Platform authority.
>
> RFC-P-002 defines shared domain vocabulary.
>
> RFC-P-005 defines microphone resources.
>
> RFC-P-007 defines channel and assignment ownership.
>
> RFC-P-008 defines shared protocol behavior.
>
> RFC-A-001 defines how the Android Companion participates without acquiring authoritative karaoke-domain ownership.
