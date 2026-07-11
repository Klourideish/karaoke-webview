# RFC-002 – Domain Model

**Status:** Accepted

**Created:** 2026-07-11

**Last Updated:** 2026-07-11

**Authors:** Project

---

# 1. Summary

This RFC defines the shared domain vocabulary for Karaoke Webview.

Its purpose is to establish clear, consistent terminology for the application's core entities without defining their implementation or behaviour.

Future architectural discussions, RFCs and implementations should use the terminology defined here rather than introducing competing concepts.

This RFC intentionally defines *what* the system consists of rather than *how* it behaves.

---

# 2. Motivation

As Karaoke Webview evolves into a distributed platform, the number of participating systems increases significantly.

These include:

- Windows host
- Android companion clients
- Remote operator interfaces
- Playback
- Queue management
- Microphones
- Performances
- History
- Scoring

Without a shared vocabulary, different subsystems may begin referring to the same concept using different terminology, creating ambiguity and unnecessary complexity.

RFC-002 establishes a single authoritative language for the project.

---

# 3. Decisions

## RFC-002.1

### Decision

A **Host Session** represents the complete runtime state of a karaoke session.

### Reason

All active singers, performances, queue items, connected clients and microphone assignments exist within a Host Session.

---

## RFC-002.2

### Decision

A **Singer** represents a person participating in karaoke.

### Reason

A singer is a real-world participant rather than a UI object or network connection.

---

## RFC-002.3

### Decision

A **Singer Profile** represents the persistent identity of a singer.

### Reason

Profiles store long-term information such as names, preferences and historical performance data independently of any individual session.

---

## RFC-002.4

### Decision

A **Session Singer** represents a singer participating in the current Host Session.

### Reason

Session participation is temporary and should remain independent of persistent profile data.

---

## RFC-002.5

### Decision

A **Client** represents a connected application.

### Reason

A client communicates with the host but does not define the physical device on which it is running.

---

## RFC-002.6

### Decision

A **Client Device** represents the physical hardware hosting a client.

### Reason

Separating Client from Client Device allows reconnects, trusted devices and future platform support without changing application identity.

---

## RFC-002.7

### Decision

A **Queue Item** represents the intention to perform a song.

### Reason

A queued song is not yet a performance.

---

## RFC-002.8

### Decision

A **Performance** represents an actual karaoke performance.

### Reason

Performances are created only when playback begins and become part of permanent history when completed.

---

## RFC-002.9

### Decision

A **Performance Record** represents the persistent historical record of a completed performance.

### Reason

History should remain immutable after finalisation.

---

## RFC-002.10

### Decision

A **Microphone Source** represents the origin of captured audio.

### Reason

Sources may originate from local devices or future network clients.

---

## RFC-002.11

### Decision

A **Microphone Channel** represents a host-managed capture channel.

### Reason

Channels provide a consistent abstraction regardless of microphone source.

---

## RFC-002.12

### Decision

Future architectural concepts should extend this vocabulary rather than introducing competing terminology.

### Reason

Maintaining a consistent domain language improves maintainability and architectural clarity.

---

# 4. Consequences

## Benefits

- Shared terminology across the project.
- Clear separation of persistent and session data.
- Easier subsystem integration.
- Simpler documentation.
- Reduced ambiguity.
- Cleaner implementation boundaries.

## Trade-offs

- Additional domain objects require explicit modelling.
- Similar concepts remain intentionally separate.

## Risks

- New features may attempt to bypass the established vocabulary.

This should be avoided by extending the existing model where appropriate.

---

# 5. Affected Modules

- Host Domain
- Queue
- Playback
- Lyrics
- Performances
- Profiles
- History
- Microphones
- Android Companion
- Protocol
- Scoring

---

# 6. Dependencies

- RFC-001 – Host Authority

---

# 7. Out of Scope

This RFC intentionally does not define:

- lifecycle behaviour
- networking
- playback
- scoring
- database schema
- packet formats
- UI implementation
- Rust implementation
- TypeScript implementation

These subjects belong to future RFCs.

---

# 8. Non-Goals

This RFC does not:

- define implementation classes
- define database tables
- define API contracts
- define UI state
- define networking protocols

Its purpose is solely to establish the project's shared vocabulary.

---

# 9. Future Work

This RFC is extended by:

- RFC-003 – Performance Lifecycle
- RFC-005 – Profile & Identity
- RFC-006 – History & Leaderboards
- RFC-007 – Microphone Lifecycle
- RFC-009 – Protocol & Connection State Machine
- RFC-010 – Scoring Pipeline

---

# 10. Implementation Notes

Implementations should preserve the distinctions defined in this RFC.

Objects should not be merged purely for implementation convenience if doing so removes important domain meaning.

Future systems should reuse the terminology established here rather than introducing alternative names for equivalent concepts.

---

# 11. Quick Reference

✓ Host Session is the root runtime context.

✓ Singer represents a person.

✓ Singer Profile represents persistent identity.

✓ Session Singer represents current participation.

✓ Client represents a connected application.

✓ Client Device represents physical hardware.

✓ Queue Item represents intent to perform.

✓ Performance represents an active or completed performance.

✓ Performance Record represents permanent history.

✓ Microphone Source represents audio origin.

✓ Microphone Channel represents host-managed capture.

✓ Future concepts extend this vocabulary.

---

# 12. Change Log

## 2026-07-11

Initial accepted version.

---

> **Relationship to RFC-001**
>
> RFC-001 establishes **who owns the system**.
>
> RFC-002 establishes **the language used to describe the system**.
>
> All future RFCs are expected to use the terminology defined here consistently.