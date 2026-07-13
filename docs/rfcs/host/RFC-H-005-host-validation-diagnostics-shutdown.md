# RFC-H-005 — Host Validation, Diagnostics & Shutdown

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
>
> It does not redefine that document.

---

> **Host Dependencies**
>
> This RFC extends:
>
> - RFC-H-001 — Windows Host Identity & Runtime Authority
> - RFC-H-002 — Host Runtime Composition & State Ownership
> - RFC-H-003 — Frontend, Command & Projection Boundary
> - RFC-H-004 — Host Adapter & Platform Integration Model
>
> It does not redefine those documents.

---

# 1. Summary

This RFC defines the validation, diagnostics and shutdown principles for the Windows Host.

Validation demonstrates implementation correctness.

Diagnostics observe runtime behaviour.

Shutdown guarantees deterministic release of Host-owned resources.

Together they establish the minimum engineering standard for Host implementations.

---

# 2. Motivation

The Windows Host owns long-lived runtime state and native resources.

Correctness requires more than successful compilation.

Every implementation should be:

- reproducible;
- observable;
- deterministic;
- safely releasable.

---

# 3. Validation Philosophy

## RFC-H-005.1

### Decision

Validation is part of the architecture.

### Reason

Architectural quality includes proving correctness.

---

## RFC-H-005.2

### Decision

Passing validation is necessary but not sufficient for implementation acceptance.

### Reason

Manual verification remains essential for behaviour involving real hardware or operator interaction.

---

## RFC-H-005.3

### Decision

Validation results shall be reported honestly.

### Reason

Confidence must be based on actual evidence rather than assumptions.

---

# 4. Validation Pipeline

Host validation should normally include:

- formatting;
- linting;
- TypeScript validation;
- frontend tests;
- production build;
- Rust formatting;
- cargo check;
- Rust tests;
- hardware smoke tests where applicable;
- manual verification.

Repository validation scripts remain the preferred entry point.

---

## RFC-H-005.4

### Decision

Validation scripts should provide a consistent entry point.

### Reason

Developers and automation should validate the Host using the same process.

---

# 5. Diagnostics

## RFC-H-005.5

### Decision

Diagnostics observe runtime behaviour.

They never become authoritative Platform state.

### Reason

Observation and authority remain separate concerns.

---

## RFC-H-005.6

### Decision

Diagnostics should expose implementation health.

Examples include:

- capture metrics;
- readiness;
- queue depth;
- discovery status;
- protocol state.

### Reason

Operational visibility improves debugging and validation.

---

## RFC-H-005.7

### Decision

Unsupported diagnostics shall be reported explicitly.

### Reason

Missing information is preferable to fabricated information.

---

# 6. Resource Lifetime

## RFC-H-005.8

### Decision

Every acquired Host resource has one clearly defined owner.

### Reason

Ownership ambiguity causes leaks.

---

## RFC-H-005.9

### Decision

Every acquired resource has one explicit release path.

Examples include:

- capture workers;
- WASAPI streams;
- timers;
- threads;
- protocol listeners;
- filesystem watchers.

### Reason

Deterministic cleanup simplifies recovery and shutdown.

---

# 7. Shutdown

## RFC-H-005.10

### Decision

Host shutdown releases resources in a deterministic order.

### Reason

Orderly shutdown prevents orphaned runtime state.

---

## RFC-H-005.11

### Decision

Background work should terminate before native resources are released.

### Reason

Running workers should never outlive their dependencies.

---

## RFC-H-005.12

### Decision

Unexpected shutdown shall not leave persistent Platform authority.

### Reason

Runtime authority ends with the Host process.

---

# 8. Testing

Tests should verify:

- runtime ownership;
- lifecycle transitions;
- cleanup behaviour;
- repeated start/stop operations;
- stale operation rejection;
- deterministic shutdown.

Hardware behaviour should be validated separately where required.

---

# 9. Manual Verification

Manual verification remains appropriate for:

- physical microphone behaviour;
- device disconnect/reconnect;
- operator workflows;
- playback behaviour;
- user interface interactions;
- hardware-specific behaviour.

Manual verification should clearly distinguish:

- completed;
- not completed;
- not applicable.

---

# 10. Reporting

Implementation summaries should include:

- RFC compliance;
- architectural conflicts, if any;
- implementation summary;
- validation performed;
- manual testing remaining;
- Git status;
- commit status.

This provides a consistent review process for future contributors and AI implementation agents.

---

# 11. Consequences

## Benefits

- Repeatable validation.
- Honest implementation reporting.
- Predictable shutdown.
- Easier debugging.
- Stable long-running runtime.

## Trade-offs

- More disciplined development workflow.
- Additional validation effort.

## Risks

- Incomplete manual verification may hide hardware-specific issues.
- Excessive diagnostics may reduce clarity if not curated.

---

# 12. Affected Modules

- Validation Scripts
- Rust Runtime
- React Frontend
- Capture
- Playback
- Future Protocol Server

---

# 13. Out of Scope

This RFC intentionally does not define:

- Platform policy;
- playback implementation;
- protocol implementation;
- persistence;
- Android diagnostics.

These are defined by Platform or implementation RFCs.

---

# 14. Future Work

Future implementation RFCs should define subsystem-specific diagnostics while remaining consistent with this document.

---

# 15. Implementation Notes

Prefer deterministic behaviour.

Prefer explicit ownership.

Prefer repeatable validation.

Prefer concise diagnostics.

Always report what was actually verified.

---

# 16. Quick Reference

✓ Validation is architectural.

✓ Manual verification remains important.

✓ Diagnostics observe.

✓ Diagnostics never become authority.

✓ Validation results are reported honestly.

✓ Every resource has one owner.

✓ Every resource has one release path.

✓ Shutdown is deterministic.

✓ Runtime authority ends with the Host process.

✓ Implementation summaries follow a consistent structure.

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
> RFC-H-004 defines integration through Host Adapters.
>
> RFC-H-005 establishes the engineering standards by which Host implementations are validated, observed and safely shut down.
