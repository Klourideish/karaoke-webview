# RFC-H-001 — Windows Host Identity & Runtime Authority

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
> - RFC-P-003 — Performance Lifecycle
>
> It does not redefine those documents.

---

> **Host Dependencies**
>
> This RFC is the root Host architecture RFC.
>
> It has no Host RFC dependencies.

---

> **Related RFCs**
>
> This RFC is commonly implemented alongside:
>
> - RFC-H-002 — Host Runtime Composition & State Ownership
> - RFC-H-003 — Frontend, Command & Projection Boundary
> - RFC-H-004 — Host Adapter & Platform Integration Model
> - RFC-H-005 — Host Validation, Diagnostics & Shutdown

---

# 1. Summary

This RFC establishes the Windows Host as the authoritative runtime implementation of the Karaoke Webview Platform.

The Host owns all mutable karaoke-domain state, runtime coordination, hardware integration, playback authority, and Platform decision making.

The React frontend provides presentation and user interaction.

Rust owns authoritative runtime behaviour.

---

# 2. Motivation

The Platform RFCs define _what_ Karaoke Webview is.

This RFC defines _how the Windows Host fulfils those contracts._

Without an explicit Host identity there is a risk that:

- React becomes authoritative.
- Windows APIs leak into Platform concepts.
- External clients become peer authorities.
- Native resources become owned by UI components.
- Future implementations diverge from the intended architecture.

This RFC prevents those outcomes.

---

# 3. Host Identity

## RFC-H-001.1

### Decision

The Windows Host is the authoritative runtime implementation of the Karaoke Webview Platform.

### Reason

Exactly one runtime authority simplifies ownership, coordination and recovery.

---

## RFC-H-001.2

### Decision

The Windows Host remains fully functional without Android clients or future remote devices.

### Reason

External clients extend the Host rather than becoming requirements.

---

## RFC-H-001.3

### Decision

The Windows Host operates as a local-first application.

### Reason

The primary operator is expected to be physically present at the Host machine.

---

## RFC-H-001.4

### Decision

The Windows Host is responsible for coordinating Platform state regardless of the number of connected clients.

### Reason

Platform authority remains centralized.

---

# 4. Authority

## RFC-H-001.5

### Decision

Rust owns all authoritative mutable runtime state.

Examples include:

- singers;
- microphone registries;
- assignments;
- performances;
- readiness;
- playback coordination;
- future protocol sessions.

### Reason

Authoritative logic belongs in one runtime.

---

## RFC-H-001.6

### Decision

React owns presentation state only.

### Reason

Presentation and domain authority remain separate.

---

## RFC-H-001.7

### Decision

Platform decisions originate within the Host runtime.

### Reason

External adapters provide observations and requests rather than authoritative mutations.

---

## RFC-H-001.8

### Decision

The Host is responsible for resolving conflicting requests.

### Reason

Clients should never negotiate authority between themselves.

---

# 5. Runtime Ownership

## RFC-H-001.9

### Decision

Native resources are owned by Rust.

Examples include:

- WASAPI capture;
- filesystem access;
- playback engines;
- protocol listeners;
- timers;
- worker threads.

### Reason

Native resource lifetime must remain independent of UI lifetime.

---

## RFC-H-001.10

### Decision

The React frontend never directly owns native resources.

### Reason

Component remounts must not affect authoritative runtime ownership.

---

## RFC-H-001.11

### Decision

Runtime coordinators own long-lived Platform behaviour.

### Reason

Complex operations require stable ownership boundaries.

---

# 6. Windows Responsibility

The Host owns:

- Windows integration;
- local media library;
- playback;
- lyrics;
- microphone discovery;
- capture;
- diagnostics;
- future protocol server;
- future persistence.

These are implementation responsibilities, not Platform contracts.

---

# 7. External Clients

## RFC-H-001.12

### Decision

Android and future clients participate through Platform Protocol.

### Reason

The Host never grants external clients Platform authority.

---

## RFC-H-001.13

### Decision

Remote devices become observations of Platform resources.

### Reason

They extend existing Platform abstractions rather than introducing parallel ones.

---

# 8. Process Lifetime

## RFC-H-001.14

### Decision

Authoritative runtime state exists only while the Host process is alive unless explicitly persisted by future RFCs.

### Reason

Runtime authority and persistence remain separate concerns.

---

## RFC-H-001.15

### Decision

Unexpected process termination ends all runtime authority immediately.

### Reason

No hidden authority continues outside the Host process.

---

# 9. Consequences

## Benefits

- One authoritative runtime.
- Clear ownership boundaries.
- Easier testing.
- Easier recovery.
- Future networking remains straightforward.
- Stable Platform implementation.

## Trade-offs

- Rust owns more responsibility.
- UI becomes intentionally thinner.

## Risks

- Poor coordinator design could centralize too much behaviour.
- Windows-specific implementation details must remain beneath Platform abstractions.

---

# 10. Affected Modules

- Rust Runtime
- React Frontend
- Tauri Commands
- Native Windows Adapters
- Future Protocol Server
- Playback
- Capture

---

# 11. Out of Scope

This RFC intentionally does not define:

- microphone implementation;
- playback implementation;
- protocol implementation;
- persistence;
- media library;
- validation;
- frontend architecture.

These are defined by later Host RFCs.

---

# 12. Future Work

Extended by:

- RFC-H-002 — Runtime Composition & State Ownership
- RFC-H-003 — Frontend, Command & Projection Boundary
- RFC-H-004 — Host Adapter & Platform Integration Model
- RFC-H-005 — Host Validation, Diagnostics & Shutdown

---

# 13. Implementation Notes

Prefer Host-owned coordinators over distributed ownership.

Keep Platform-domain logic inside Rust.

Treat React as an immutable projection layer.

Avoid exposing Windows-specific implementation details beyond Host adapters.

---

# 14. Quick Reference

✓ Windows Host is authoritative.

✓ Rust owns mutable runtime state.

✓ React owns presentation.

✓ Native resources belong to Rust.

✓ External clients never gain Platform authority.

✓ Platform decisions originate within the Host.

✓ Runtime ends with the Host process.

✓ Windows APIs remain behind Host adapters.

---

# 15. Change Log

## 2026-07-13

Initial accepted version.

---

> **Architecture Relationship**
>
> RFC-P-001 defines Platform authority.
>
> RFC-H-001 defines how the Windows Host fulfils that authority as the primary runtime implementation.
