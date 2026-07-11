# RFC-001 – Host Authority

> **Foundational RFC**
>
> This RFC establishes the core architectural philosophy of Karaoke Webview.
>
> Unless explicitly superseded by a future Accepted RFC, every architectural
> decision within this repository is expected to remain consistent with the
> host-authority model defined here.
>
> All subsequent RFCs extend this document rather than replace it.

**Status:** Accepted

**Created:** 2026-07-11

**Last Updated:** 2026-07-11

**Authors:** Project

---

## Architectural Principle

RFC-001 defines the architectural philosophy of Karaoke Webview.

Future RFCs extend this philosophy by defining additional behaviour, but should not contradict it.

If a future proposal requires changing the host-authority model, that proposal must explicitly supersede RFC-001 following a new Design Review.

This requirement exists to preserve architectural stability throughout the lifetime of the project.

---

# 1. Summary

Karaoke Webview is designed around a single authoritative Windows host.

The host is responsible for all authoritative application state, including media playback, lyric timing, singers, queue management, performances, microphone management, scoring, history and future distributed coordination.

External applications, including future Android clients and remote operator interfaces, are companion clients. They extend the user experience but never become authoritative sources of application state.

This architectural model is intended to maximise consistency, simplify synchronisation, minimise duplicated logic and provide a stable foundation for future distributed features.

---

# 2. Motivation

A karaoke session contains multiple independent systems that must remain synchronised.

These include:

- playback
- lyric timing
- singer participation
- queue progression
- scoring
- microphone assignment
- performance history

Allowing multiple devices to independently control these systems introduces unnecessary complexity, conflicting state and synchronisation issues.

Instead, Karaoke Webview adopts a single-authority architecture where the Windows desktop application owns all business logic and application state.

External clients communicate with the host through well-defined interfaces without becoming independent authorities.

---

# 3. Decisions

## RFC-001.1

### Decision

The Windows desktop application is the sole authoritative host.

### Reason

A single source of truth ensures deterministic playback, queue progression, scoring, lyric timing and performance state.

---

## RFC-001.2

### Decision

External clients submit requests but never become authoritative.

### Reason

Clients may disconnect, reconnect or experience latency. Central authority guarantees consistent behaviour for every participant.

---

## RFC-001.3

### Decision

Playback timing is owned exclusively by the host.

### Reason

The host maintains the authoritative playback clock. Clients consume synchronised playback state rather than generating independent timelines.

---

## RFC-001.4

### Decision

Performance lifecycle management is owned by the host.

### Reason

Performance creation, preparation, playback, results and history require deterministic lifecycle management.

---

## RFC-001.5

### Decision

Microphone channels are host-owned resources.

### Reason

Audio sources may originate from local devices or future network clients, but channel ownership remains centralised.

---

## RFC-001.6

### Decision

Networking is an adapter around the host domain rather than part of the host domain.

### Reason

Transport technology must remain replaceable without affecting playback, queue management, scoring or other core systems.

---

## RFC-001.7

### Decision

The architecture is local-first.

### Reason

Normal operation must not depend upon cloud infrastructure or external services.

---

## RFC-001.8

### Decision

Android applications are companion clients.

### Reason

Android devices extend the karaoke experience through microphone capture and personal interaction while the Windows host remains the processing centre.

---

# 4. Consequences

## Benefits

- Single authoritative playback timeline.
- Deterministic queue behaviour.
- Reliable lyric synchronisation.
- Simplified client reconnection.
- Consistent scoring.
- Reduced duplicated logic.
- Transport-independent architecture.
- Easier testing and debugging.

## Trade-offs

- The host application must remain available.
- Most processing occurs on the Windows host.
- Companion clients intentionally have limited authority.

## Risks

- Host failure ends the active karaoke session.
- Future scaling depends upon maintaining clear subsystem boundaries.

These trade-offs are considered acceptable for the intended architecture.

---

# 5. Affected Modules

This RFC establishes the architectural foundation for the entire project.

Affected modules include:

- Host Domain
- Media Library
- Playback
- Lyrics
- Queue
- Performances
- Microphones
- History
- Scoring
- Protocol
- Android Companion
- Remote Operator

---

# 6. Dependencies

None.

This RFC is the architectural root of the project.

---

# 7. Out of Scope

This RFC intentionally does not define:

- networking protocol
- packet formats
- transport technology
- microphone capture implementation
- Android implementation
- scoring algorithms
- database schema
- user interface implementation
- Rust implementation
- React implementation

These subjects are defined by future RFCs.

---

# 8. Non-Goals

This architecture intentionally does **not** support:

- multiple authoritative hosts
- peer-to-peer playback authority
- cloud-first operation
- clients independently advancing the queue
- clients independently controlling playback
- clients maintaining independent performance history
- duplicated business logic across host and clients

---

# 9. Future Work

This RFC is extended by:

- RFC-002 – Domain Model
- RFC-003 – Performance Lifecycle
- RFC-004 – Karaoke Modes
- RFC-005 – Profile & Identity
- RFC-006 – History & Leaderboards
- RFC-007 – Microphone Lifecycle
- RFC-009 – Protocol & Connection State Machine
- RFC-010 – Scoring Pipeline

---

# 10. Implementation Notes

Implementations should preserve a strict separation between authoritative host logic and client adapters.

Subsystems should communicate through host-owned contracts rather than allowing clients to manipulate application state directly.

Future transports, platforms and client types should integrate by adapting to the host domain rather than modifying it.

---

# 11. Quick Reference

✓ Windows desktop application is the authoritative host.

✓ Clients submit requests only.

✓ Playback authority belongs to the host.

✓ Queue authority belongs to the host.

✓ Performance authority belongs to the host.

✓ Microphone channels belong to the host.

✓ History belongs to the host.

✓ Networking is an adapter.

✓ Local-first architecture.

✓ Android is a companion client.

---

# 12. Change Log

## 2026-07-11

Initial accepted version.
