# RFC-H-004 — Host Adapter & Platform Integration Model

**Status:** Accepted

**Created:** 2026-07-13

**Last Updated:** 2026-07-13

**Authors:** Project

---

> **Authority**
>
> Accepted RFCs are authoritative.
>
> Host implementations must conform to Accepted Platform and Host RFCs.
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
> - RFC-P-006 — Capture Session Model
> - RFC-P-008 — Platform Protocol & Connection State Machine
>
> It does not redefine those documents.

---

> **Host Dependencies**
>
> This RFC extends:
>
> - RFC-H-001 — Windows Host Identity & Runtime Authority
> - RFC-H-002 — Host Runtime Composition & State Ownership
> - RFC-H-003 — Frontend, Command & Projection Boundary
>
> It does not redefine those documents.

---

# 1. Summary

This RFC defines the Host Adapter model.

Host Adapters isolate external systems from the authoritative Platform runtime.

They translate observations, capabilities and lifecycle events into Platform-compatible models without introducing additional authority.

Every external dependency enters the Platform through an explicit Host Adapter.

---

# 2. Motivation

The Windows Host integrates with many external systems.

Examples include:

- Windows Core Audio
- WASAPI
- local filesystem
- future Android clients
- future Bluetooth devices
- future MIDI devices
- future protocol listeners

Without a consistent adapter boundary:

- operating-system details leak into Platform logic;
- Platform concepts become platform-specific;
- integrations duplicate business logic;
- testing becomes difficult.

The Host Adapter pattern prevents these outcomes.

---

# 3. Architectural Model

Every external system follows the same structure:

```text
External System
        │
        ▼
Host Adapter
        │
Translation
        │
        ▼
Coordinator
        │
        ▼
Platform Registry
        │
        ▼
Immutable Projection
```

Platform concepts remain independent of external implementation details.

---

# 4. Adapter Responsibilities

## RFC-H-004.1

### Decision

Adapters observe external systems.

### Reason

Observation is separate from Platform authority.

---

## RFC-H-004.2

### Decision

Adapters translate external data into Platform-compatible models.

### Reason

Platform contracts remain operating-system independent.

---

## RFC-H-004.3

### Decision

Adapters expose capabilities and diagnostics where appropriate.

### Reason

The Host requires visibility into external resources without exposing implementation details.

---

## RFC-H-004.4

### Decision

Adapters own translation.

They do not own Platform policy.

### Reason

Behavioural decisions belong to Host coordinators.

---

# 5. Platform Authority

## RFC-H-004.5

### Decision

Adapters never become authoritative owners of Platform state.

### Reason

Platform authority remains centralized within the Host runtime.

---

## RFC-H-004.6

### Decision

Adapters request changes through Host coordinators.

They do not directly mutate registries.

### Reason

All authoritative mutations follow one execution path.

---

## RFC-H-004.7

### Decision

Platform registries remain unaware of external implementation details.

### Reason

Platform concepts remain portable and testable.

---

# 6. Adapter Lifetime

## RFC-H-004.8

### Decision

Adapters are Host-owned runtime objects.

### Reason

Their lifetime must not depend upon UI components.

---

## RFC-H-004.9

### Decision

Resource acquisition and cleanup are explicit lifecycle events.

### Reason

External resources require deterministic ownership.

---

# 7. Replaceability

## RFC-H-004.10

### Decision

Adapters are replaceable implementations.

### Reason

Changing an external technology should not require Platform redesign.

---

## RFC-H-004.11

### Decision

Multiple adapters may implement the same Platform concept.

Examples include:

- Windows microphone
- Android microphone
- future USB audio interface

### Reason

Platform abstractions describe behaviour rather than implementation.

---

# 8. Supported Adapter Types

Examples include:

- Windows microphone discovery
- WASAPI capture
- Local media library
- Future Android protocol server
- Future Bluetooth discovery
- Future MIDI devices
- Future cloud synchronization

These are implementation examples rather than architectural requirements.

---

# 9. Error Handling

## RFC-H-004.12

### Decision

Adapters report failures using typed Host models.

### Reason

Platform behaviour should not depend on operating-system error strings.

---

## RFC-H-004.13

### Decision

Adapters may expose implementation diagnostics.

### Reason

Diagnostics aid validation without becoming Platform authority.

---

# 10. Testing

Adapter tests should verify:

- translation correctness;
- lifecycle management;
- error handling;
- cleanup;
- capability reporting;
- deterministic behaviour.

Platform policy should be tested separately.

---

# 11. Consequences

## Benefits

- Platform remains operating-system independent.
- Integrations remain replaceable.
- Testing becomes simpler.
- External APIs remain isolated.
- Future protocol support fits naturally.

## Trade-offs

- Additional translation code.
- More explicit integration boundaries.

## Risks

- Poor adapter design may expose implementation details.
- Overly broad adapters may become difficult to maintain.

---

# 12. Affected Modules

- Windows Audio
- Filesystem
- Future Protocol Server
- Future Android Integration
- Future Device Integrations

---

# 13. Out of Scope

This RFC intentionally does not define:

- Platform policy;
- microphone implementation;
- protocol wire format;
- playback;
- persistence.

These are defined by Platform or implementation RFCs.

---

# 14. Future Work

Implemented by:

- RFC-H-006 — Windows Microphone Discovery Adapter
- RFC-H-007 — WASAPI Capture Adapter
- RFC-H-010 — Media Library & Filesystem Authority
- Future Android Protocol Adapter RFC
- Future MIDI Adapter RFC

---

# 15. Implementation Notes

Keep adapters focused.

Translate rather than reinterpret.

Expose capabilities, not operating-system details.

Keep Platform models free from Windows-specific concepts.

Prefer composition over inheritance.

---

# 16. Quick Reference

✓ Every external system enters through a Host Adapter.

✓ Adapters observe.

✓ Adapters translate.

✓ Adapters expose capabilities.

✓ Adapters never own Platform authority.

✓ Adapters never bypass coordinators.

✓ Registries remain platform-independent.

✓ Adapters are replaceable.

✓ Cleanup is explicit.

✓ Platform models remain portable.

---

# 17. Change Log

## 2026-07-13

Initial accepted version.

---

> **Architecture Relationship**
>
> RFC-H-001 establishes the Windows Host as the authoritative runtime.
>
> RFC-H-002 defines runtime ownership.
>
> RFC-H-003 defines the frontend boundary.
>
> RFC-H-004 defines how every external system—Windows APIs, filesystems, Android clients, and future integrations—enters the Platform through replaceable Host Adapters while preserving Platform authority.
