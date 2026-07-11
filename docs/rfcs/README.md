# Request For Comments (RFC)

## Purpose

RFCs are the authoritative architectural decisions for Karaoke Webview.

They describe _how the system is intended to behave_, not how it is implemented.

Rust, TypeScript, React, Android and networking implementations must follow accepted RFCs.

---

## Core RFCs

RFC-001 through RFC-004 define the architectural foundation of Karaoke Webview.

These RFCs establish:

- Authority
- Vocabulary
- Behaviour
- Operational Modes

Future RFCs are expected to extend these documents rather than replace them.

Changes to Core RFCs should be rare and require a Design Review.

---

## Lifecycle

Design Review
↓

Draft RFC
↓

Discussion
↓

Accepted RFC
↓

Implementation
↓

Validation
↓

Commit

---

## Status

Draft

Accepted

Superseded

Deprecated

---

## Rules

Accepted RFCs are authoritative.

Implementation must not silently violate an accepted RFC.

If implementation reveals an architectural conflict:

- stop implementation
- report the conflict
- request a new Design Review

Do not redesign accepted architecture during implementation.

---

## Scope

RFCs define architecture.

They do not define:

- implementation details
- UI styling
- Rust APIs
- React components
- Android APIs
- packet formats
- database schemas

unless those are themselves the architectural decision.

---

## Naming

RFC-001
RFC-002
...

Numbers are never reused.

Superseded RFCs remain in the repository.

---

## References

RFCs may depend upon earlier RFCs.

Implementation prompts should reference only the RFCs relevant to the task.

---

## Accepted

An Accepted RFC represents the current architectural authority for its subject.

Accepted RFCs are considered frozen.

Implementation must conform to Accepted RFCs.

If implementation reveals a conflict with an Accepted RFC, the implementation should stop and a new Design Review should be requested.

Accepted RFCs are never silently modified during feature development.

---

## Foundational RFCs

RFC-001 through RFC-004 define the architectural foundation of Karaoke Webview.

Changes to these RFCs should be rare.

Where possible, future RFCs should extend these documents rather than modify them.

If modification becomes necessary, the existing RFC should normally be superseded rather than rewritten.

---

## Architecture Authority

Accepted RFCs are the authoritative source for architectural decisions.

Implementation must conform to Accepted RFCs.

If implementation conflicts with an Accepted RFC:

1. Stop implementation.
2. Report the conflict.
3. Request a Design Review.

Do not silently redesign accepted architecture.

---

RFC filenames must use:

RFC-<three-digit-number>-<short-kebab-case-title>.md

The number and filename listed in the RFC index are authoritative.
Renaming an RFC file requires updating all documentation references in the same change.

---

## Reading Order

For contributors new to the project, the recommended reading order is:

1. CORE_RFCS.md
2. RFC-001 – Host Authority
3. RFC-002 – Domain Model
4. RFC-003 – Performance Lifecycle
5. RFC-004 – Karaoke Modes

Additional RFCs build upon this foundation.

---

## Naming Convention

RFC documents use the following filename format:

RFC-<number>-<short-title>.md

Examples:

- RFC-001-host-authority.md
- RFC-002-domain-model.md
- RFC-003-performance-lifecycle.md

The RFC number is the authoritative identifier.

The filename is descriptive for readability and repository navigation.
