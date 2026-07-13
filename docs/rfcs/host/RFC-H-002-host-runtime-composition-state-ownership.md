# RFC-H-002 — Host Runtime Composition & State Ownership

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
> - RFC-P-007 — Microphone Assignment & Channel Management
>
> It does not redefine those documents.

---

> **Host Dependencies**
>
> This RFC extends:
>
> - RFC-H-001 — Windows Host Identity & Runtime Authority
>
> It does not redefine that document.

---

# 1. Summary

This RFC defines how authoritative runtime state is composed, owned and coordinated inside the Windows Host.

The Host follows three principles:

- Registries own state.
- Coordinators own behaviour.
- React owns presentation.

Every authoritative runtime object has exactly one owner.

---

# 2. Motivation

As the Host grows, responsibilities naturally multiply.

Without explicit ownership boundaries:

- duplicate registries appear;
- UI components become authoritative;
- asynchronous operations race;
- stale callbacks overwrite current state;
- native resources leak;
- subsystem responsibilities become unclear.

This RFC establishes one consistent runtime composition model.

---

# 3. Runtime Architecture

The Host follows the pattern:

```text
React
    │
Intent
    ▼
Typed Tauri Command
    ▼
Coordinator
    ▼
Registry
    ▼
Immutable Projection
    ▼
React
```

React requests work.

Coordinators perform work.

Registries own state.

---

# 4. Registry Ownership

## RFC-H-002.1

### Decision

Each authoritative domain concept has one registry.

### Reason

Multiple mutable owners inevitably diverge.

---

## RFC-H-002.2

### Decision

Registries own state.

They do not orchestrate workflows.

### Reason

State ownership and behavioural coordination are separate concerns.

---

## RFC-H-002.3

### Decision

Registries expose typed operations rather than unrestricted mutable access.

### Reason

Mutation boundaries remain explicit and testable.

---

## RFC-H-002.4

### Decision

Registries may expose immutable projections for frontend consumption.

### Reason

Presentation should never receive mutable runtime state.

---

## RFC-H-002.5

### Decision

Registries remain long-lived Host-owned objects.

### Reason

Their lifetime must not depend on UI lifecycle.

---

# 5. Coordinator Ownership

## RFC-H-002.6

### Decision

Coordinators own workflows involving multiple registries or external adapters.

### Reason

Cross-registry behaviour belongs outside individual registries.

---

## RFC-H-002.7

### Decision

Coordinators do not duplicate registry state.

### Reason

State duplication creates conflicting authority.

---

## RFC-H-002.8

### Decision

Coordinators execute authoritative decisions.

Examples include:

- automatic assignment;
- recovery;
- readiness evaluation;
- future protocol coordination.

### Reason

Decision making belongs at orchestration boundaries.

---

## RFC-H-002.9

### Decision

Coordinators serialize conflicting operations where necessary.

### Reason

Deterministic outcomes are preferred over concurrent mutation races.

---

# 6. Runtime Identity

## RFC-H-002.10

### Decision

Runtime identities use typed identifiers.

Examples include:

- SessionSingerId
- MicrophoneChannelId
- CaptureSessionId

### Reason

Typed identities prevent accidental cross-domain misuse.

---

## RFC-H-002.11

### Decision

Identifiers remain stable for the lifetime defined by their Platform RFC.

### Reason

Runtime references require deterministic identity.

---

# 7. Async Safety

## RFC-H-002.12

### Decision

Long-running operations carry operation identity where stale completion is possible.

### Reason

Older work must not overwrite newer runtime state.

---

## RFC-H-002.13

### Decision

Completed asynchronous work verifies it still applies before committing results.

### Reason

Protects against stale updates.

---

## RFC-H-002.14

### Decision

Cancellation is a valid outcome.

### Reason

Not every operation should complete once superseded.

---

# 8. Native Resource Ownership

## RFC-H-002.15

### Decision

Native resources belong to Host runtime objects.

Never to React components.

### Reason

UI remounts must not affect native lifetime.

---

## RFC-H-002.16

### Decision

Resource acquisition and release are explicit lifecycle events.

### Reason

Hidden ownership causes leaks.

---

# 9. Frontend Relationship

## RFC-H-002.17

### Decision

React never becomes an authoritative registry.

### Reason

Presentation remains presentation.

---

## RFC-H-002.18

### Decision

React requests actions through typed commands.

### Reason

Authority remains inside Rust.

---

## RFC-H-002.19

### Decision

Frontend hooks cache projections rather than duplicate runtime state.

### Reason

Hooks improve rendering, not authority.

---

# 10. Mutation Rules

## RFC-H-002.20

### Decision

Every mutation has one authoritative execution path.

### Reason

Competing mutation paths become inconsistent.

---

## RFC-H-002.21

### Decision

Mutations either complete atomically or fail with a typed reason.

### Reason

Partial state changes are difficult to recover safely.

---

## RFC-H-002.22

### Decision

Idempotent operations remain idempotent.

### Reason

Repeated commands should not corrupt state.

---

# 11. Testing

Runtime tests should verify:

- registry ownership;
- coordinator behaviour;
- stale operation rejection;
- serialized mutation;
- projection correctness;
- cleanup behaviour.

---

# 12. Consequences

## Benefits

- Clear ownership.
- Easier reasoning.
- Predictable async behaviour.
- Stable testing.
- Simpler future protocol integration.
- Thin frontend.

## Trade-offs

- More explicit runtime types.
- Slightly more coordination code.

## Risks

- Poor coordinator design may become overly centralised.
- Overly broad registries reduce modularity.

---

# 13. Affected Modules

- Rust Runtime
- Tauri Commands
- Registries
- Coordinators
- React Hooks
- Runtime Tests

---

# 14. Out of Scope

This RFC intentionally does not define:

- Windows adapters;
- playback;
- protocol implementation;
- validation;
- persistence.

These are defined by later Host RFCs.

---

# 15. Future Work

Extended by:

- RFC-H-003 — Frontend, Command & Projection Boundary
- RFC-H-004 — Host Adapter & Platform Integration Model
- RFC-H-005 — Host Validation, Diagnostics & Shutdown

---

# 16. Implementation Notes

Prefer small focused registries.

Prefer focused coordinators.

Avoid "god objects."

Long-running work should expose explicit lifecycle.

Typed projections should remain immutable.

Background workers should always have one clear owner.

---

# 17. Quick Reference

✓ One registry per domain concept.

✓ Registries own state.

✓ Coordinators own behaviour.

✓ React owns presentation.

✓ Typed identifiers.

✓ Typed commands.

✓ Immutable projections.

✓ Serialized conflicting operations.

✓ Reject stale async work.

✓ Explicit native resource ownership.

✓ Atomic mutations.

✓ Idempotent operations remain idempotent.

---

# 18. Change Log

## 2026-07-13

Initial accepted version.

---

> **Architecture Relationship**
>
> RFC-H-001 establishes the Windows Host as the authoritative runtime.
>
> RFC-H-002 defines how that runtime is internally composed, how ownership is divided between registries, coordinators and the frontend, and how authoritative state remains deterministic as the application grows.
