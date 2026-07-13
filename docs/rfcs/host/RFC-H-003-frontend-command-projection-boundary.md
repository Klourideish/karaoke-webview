# RFC-H-003 — Frontend, Command & Projection Boundary

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
>
> It does not redefine those documents.

---

> **Host Dependencies**
>
> This RFC extends:
>
> - RFC-H-001 — Windows Host Identity & Runtime Authority
> - RFC-H-002 — Host Runtime Composition & State Ownership
>
> It does not redefine those documents.

---

# 1. Summary

This RFC defines the architectural boundary between the React frontend and the authoritative Host runtime.

The frontend is responsible for presentation and operator interaction.

The Host runtime is responsible for authoritative state and decision making.

The frontend never becomes an authoritative owner of Platform state.

---

# 2. Motivation

React provides an excellent presentation framework but its component lifecycle is intentionally transient.

Authoritative runtime state must survive:

- component remounts;
- StrictMode behaviour;
- navigation changes;
- rendering optimisations;
- future frontend replacement.

This RFC separates presentation from authority.

---

# 3. Architectural Model

The Host follows the interaction model:

```text
Operator
    │
    ▼
React UI
    │
Intent
    ▼
Typed Hook
    │
    ▼
Typed Tauri Command
    │
    ▼
Rust Coordinator
    │
    ▼
Registry
    │
    ▼
Immutable Projection
    │
    ▼
React
```

Every frontend interaction follows this direction.

No authoritative mutation originates in React.

---

# 4. Frontend Responsibilities

## RFC-H-003.1

### Decision

React owns presentation.

Examples include:

- layout;
- dialogs;
- navigation;
- temporary selections;
- visual state;
- loading indicators;
- animations.

### Reason

Presentation remains independent from Platform authority.

---

## RFC-H-003.2

### Decision

Frontend state is disposable.

### Reason

Components may mount, unmount or remount at any time.

---

## RFC-H-003.3

### Decision

Frontend state never becomes the authoritative source of Platform truth.

### Reason

Only one authoritative runtime exists.

---

# 5. Commands

## RFC-H-003.4

### Decision

Frontend requests Host behaviour through typed commands.

### Reason

Commands express operator intent while preserving Host authority.

---

## RFC-H-003.5

### Decision

Commands request actions.

They do not directly mutate Host state.

### Reason

Mutation remains the responsibility of the Host runtime.

---

## RFC-H-003.6

### Decision

Command contracts should use explicit request and response models.

### Reason

Typed contracts improve correctness and future compatibility.

---

# 6. Immutable Projections

## RFC-H-003.7

### Decision

The Host exposes immutable projections of authoritative state.

### Reason

Presentation should observe rather than mutate.

---

## RFC-H-003.8

### Decision

Frontend projections may be cached.

### Reason

Caching improves rendering without changing authority.

---

## RFC-H-003.9

### Decision

Projection transport is not architecturally significant.

Polling, subscriptions or future streaming mechanisms remain implementation details.

### Reason

The frontend consumes state regardless of delivery mechanism.

---

# 7. React Hooks

## RFC-H-003.10

### Decision

Custom hooks encapsulate Host communication.

### Reason

UI components should remain focused on presentation.

---

## RFC-H-003.11

### Decision

Hooks never become authoritative registries.

### Reason

Authority remains inside the Host runtime.

---

## RFC-H-003.12

### Decision

Hooks expose immutable UI-facing models.

### Reason

Presentation remains isolated from runtime mutation.

---

# 8. StrictMode

## RFC-H-003.13

### Decision

The Host must tolerate duplicate frontend execution caused by React StrictMode.

### Reason

StrictMode is a development tool and must not produce duplicate authoritative mutations.

---

## RFC-H-003.14

### Decision

Authoritative operations should be idempotent where appropriate.

### Reason

Duplicate requests should not corrupt runtime state.

---

# 9. Errors

## RFC-H-003.15

### Decision

The Host returns stable, typed failure reasons.

### Reason

Frontend behaviour should not depend upon parsing human-readable messages.

---

## RFC-H-003.16

### Decision

Human-readable messages remain presentation concerns.

### Reason

Operator communication and programmatic behaviour are separate responsibilities.

---

# 10. Native Resources

## RFC-H-003.17

### Decision

React never owns native resources.

Examples include:

- WASAPI capture;
- playback;
- filesystem handles;
- timers;
- worker threads.

### Reason

Native lifetime must remain independent of UI lifetime.

---

# 11. Testing

Frontend tests should verify:

- command invocation;
- projection rendering;
- duplicate execution safety;
- error rendering;
- hook behaviour;
- StrictMode compatibility.

Runtime authority should be tested separately.

---

# 12. Consequences

## Benefits

- Thin frontend.
- Clear authority boundaries.
- Easier testing.
- Predictable rendering.
- Future frontend replacement becomes practical.

## Trade-offs

- Additional command contracts.
- More explicit projection models.

## Risks

- Poor projection design can expose unnecessary implementation details.
- Overly chatty commands may impact responsiveness.

---

# 13. Affected Modules

- React UI
- React Hooks
- Tauri Commands
- Rust Coordinators
- Runtime Registries

---

# 14. Out of Scope

This RFC intentionally does not define:

- registry implementation;
- adapter implementation;
- validation;
- diagnostics;
- playback;
- protocol.

These are defined by later Host RFCs.

---

# 15. Future Work

Extended by:

- RFC-H-004 — Host Adapter & Platform Integration Model
- RFC-H-005 — Host Validation, Diagnostics & Shutdown

---

# 16. Implementation Notes

Prefer declarative UI.

Prefer immutable projections.

Prefer typed request/response contracts.

Avoid embedding business logic inside components.

Keep presentation independent from runtime implementation.

---

# 17. Quick Reference

✓ React owns presentation.

✓ Rust owns authority.

✓ Commands express intent.

✓ Commands are typed.

✓ Projections are immutable.

✓ Hooks encapsulate Host communication.

✓ Hooks never become registries.

✓ StrictMode must not duplicate Host mutations.

✓ Native resources belong to Rust.

✓ UI reflects Host decisions.

---

# 18. Change Log

## 2026-07-13

Initial accepted version.

---

> **Architecture Relationship**
>
> RFC-H-001 establishes the Windows Host as the authoritative runtime.
>
> RFC-H-002 defines how authoritative runtime state is composed.
>
> RFC-H-003 defines how the React frontend requests Host behaviour and consumes immutable projections without becoming an authoritative owner of Platform state.
