# RFC-P-004 – Karaoke Modes

> **Authority**
>
> This RFC defines the operational modes supported by Karaoke Webview.
>
> Accepted RFCs are authoritative. Implementations must conform to them.
>
> If implementation conflicts with this RFC, stop and request a Design Review rather than silently changing the architecture.

**Status:** Accepted

**Created:** 2026-07-11

**Last Updated:** 2026-07-11

**Authors:** Project

---

# 1. Summary

This RFC defines the supported karaoke operating modes.

Operational modes determine how singers participate, how performances are organised, how results are interpreted, and whether scores become part of permanent history.

Modes extend the common Performance Lifecycle defined in RFC-P-003 without redefining it.

Every mode shares the same architectural foundation while applying different participation and scoring rules.

---

# 2. Motivation

Not every karaoke session has the same objective.

Some sessions focus on traditional karaoke.

Others favour relaxed social participation.

Future competitive sessions require structured scoring and performer allocation.

Rather than creating separate systems, Karaoke Webview supports multiple operational modes built upon the same host-authoritative architecture.

---

# 3. Decisions

## RFC-P-004.1

### Decision

Karaoke Webview supports three operational modes:

- Standard
- Party
- Battle

### Reason

These modes cover traditional karaoke, casual social play, and structured competition while remaining extensible.

---

## RFC-P-004.2

### Decision

All modes share the same Platform Authority, Platform Domain Model and Performance Lifecycle.

### Reason

Operational modes modify rules rather than replacing the core architecture.

---

## RFC-P-004.3

### Decision

Mode selection belongs to the Host Session.

### Reason

Every active Performance within a Host Session should operate under one consistent ruleset.

---

## RFC-P-004.4

### Decision

Standard Mode supports one or two active singers.

### Reason

Traditional karaoke commonly consists of solo performances and duets.

---

## RFC-P-004.5

### Decision

Standard Mode records official performance history.

### Reason

Standard Mode represents normal karaoke sessions and therefore contributes to persistent statistics and leaderboards.

---

## RFC-P-004.6

### Decision

Party Mode allows all connected participants to sing.

### Reason

Party Mode prioritises participation over structured competition.

---

## RFC-P-004.7

### Decision

Party Mode provides personal feedback without affecting official leaderboards.

### Reason

Party sessions should remain relaxed and encourage participation without permanently influencing competitive history.

---

## RFC-P-004.8

### Decision

Battle Mode provides structured competitive performances.

### Reason

Battle Mode is intended for organised competition rather than free participation.

---

## RFC-P-004.9

### Decision

Battle Mode assigns singing responsibility according to battle rules.

Assignments may include:

- alternating verses
- predefined vocalist sections
- shared chorus participation

### Reason

Competitive performances require clear ownership of scoring intervals.

---

## RFC-P-004.10

### Decision

Battle Mode contributes to official competitive history.

### Reason

Battle performances represent organised competition rather than casual participation.

---

## RFC-P-004.11

### Decision

Future operational modes may extend this RFC without modifying existing mode behaviour.

### Reason

The architecture should remain extensible while preserving compatibility.

---

# 4. Consequences

## Benefits

- One architecture supports multiple experiences.
- Minimal duplicated implementation.
- Clear separation between casual and competitive play.
- Consistent subsystem behaviour.
- Extensible for future modes.

## Trade-offs

- Additional mode-specific behaviour must remain isolated.
- Some subsystems require conditional behaviour based on mode.

## Risks

- Future implementations may incorrectly place mode-specific logic inside shared lifecycle systems.

This should be avoided by extending behaviour through mode policies rather than modifying core architecture.

---

# 5. Affected Modules

- Host Session
- Queue
- Performances
- Scoring
- History
- Microphones
- Android Companion
- Operator Interface
- TV Presentation

---

# 6. Dependencies

- RFC-P-001 – Platform Authority
- RFC-P-002 – Platform Domain Model
- RFC-P-003 – Performance Lifecycle

---

# 7. Out of Scope

This RFC intentionally does not define:

- scoring algorithms
- battle map implementation
- microphone routing
- protocol messages
- UI layout
- lyric rendering
- recording
- database schema

These are defined by future RFCs.

---

# 8. Non-Goals

This RFC does not:

- redefine the Performance Lifecycle
- redefine Platform Authority
- redefine Domain terminology
- specify scoring implementation
- define battle choreography

Its purpose is solely to define operational policy.

---

# 9. Future Work

This RFC is extended by:

- RFC-P-013 – History & Leaderboards
- RFC-P-005 – Microphone Resource Model
- RFC-P-009 – Scoring Pipeline
- RFC-P-010 – Battle Performance Coordination

---

# 10. Implementation Notes

Subsystems should determine behavioural differences through the current Host Session mode rather than branching on unrelated state.

Shared infrastructure should remain mode-independent wherever practical.

Mode-specific behaviour should be isolated behind policy decisions rather than duplicated implementations.

---

# 11. Quick Reference

✓ Three supported modes.

✓ Standard = traditional karaoke.

✓ Party = casual participation.

✓ Battle = structured competition.

✓ Standard supports solo and duet.

✓ Party allows all participants.

✓ Battle assigns singing responsibility.

✓ Standard and Battle contribute to official history.

✓ Party does not affect official leaderboards.

✓ Modes extend the Performance Lifecycle rather than replacing it.

---

# 12. Change Log

## 2026-07-11

Initial accepted version.

---

> **Relationship to the Core RFCs**
>
> RFC-P-001 establishes authority.
>
> RFC-P-002 establishes vocabulary.
>
> RFC-P-003 establishes lifecycle.
>
> RFC-P-004 establishes operational policy.
>
> Together these four RFCs form the architectural foundation of Karaoke Webview.
