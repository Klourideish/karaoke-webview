# RFC-A-004 — Foreground Service, Privacy & Power

**Status:** Accepted

**Created:** 2026-07-13

**Last Updated:** 2026-07-13

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
> - RFC-P-008 — Platform Protocol & Connection State Machine
>
> It does not redefine those documents.

---

> **Android Dependencies**
>
> This RFC extends:
>
> - RFC-A-001 — Android Client Authority & Boundaries
> - RFC-A-002 — Android Audio Capture Lifecycle
> - RFC-A-003 — Audio Frame & Buffer Contract
>
> It does not redefine those documents.

---

# 1. Summary

This RFC defines how the Android Companion owns microphone permissions, foreground service behaviour, user privacy, battery interaction and power management.

These concerns are entirely Android-local.

The Host never controls Android operating-system permissions or foreground-service policy.

---

# 2. Motivation

Android aggressively manages:

- background execution;
- microphone access;
- battery usage;
- foreground services;
- process lifetime.

These behaviours differ between Android versions and manufacturers.

Rather than leaking these concerns into Platform architecture, Android owns them locally.

---

# 3. Foreground Service Ownership

## RFC-A-004.1

### Decision

Active microphone capture requires a foreground service.

### Reason

Long-running microphone capture must comply with Android platform requirements.

---

## RFC-A-004.2

### Decision

The foreground service owns:

- notification lifetime;
- service lifetime;
- capture ownership;
- capture notification actions.

### Reason

Capture and service lifecycles must remain synchronized.

---

## RFC-A-004.3

### Decision

Capture may not continue after the foreground service has terminated.

### Reason

Background microphone use must remain explicit and visible.

---

# 4. User Privacy

## RFC-A-004.4

### Decision

Microphone capture must always be initiated by an explicit user action.

### Reason

Microphone access requires informed user intent.

---

## RFC-A-004.5

### Decision

The application must clearly indicate when capture is active.

### Reason

Users must never be unaware that the microphone is recording.

---

## RFC-A-004.6

### Decision

The persistent notification must remain visible while capture is active.

### Reason

The notification forms part of Android's privacy model.

---

## RFC-A-004.7

### Decision

The notification must expose an immediate Stop action.

### Reason

Users must always retain immediate local control.

---

## RFC-A-004.8

### Decision

The Android user may stop capture regardless of Host requests.

### Reason

Local privacy authority always takes precedence.

---

# 5. Permission Model

## RFC-A-004.9

### Decision

Capture requires RECORD_AUDIO permission.

### Reason

Android platform policy.

---

## RFC-A-004.10

### Decision

Permission state must remain observable.

Possible states include:

- unknown
- granted
- denied
- permanently denied

### Reason

UI behaviour depends upon permission state.

---

## RFC-A-004.11

### Decision

Permission revocation immediately invalidates active capture.

### Reason

Continued microphone use is no longer permitted.

---

# 6. Battery & Power

## RFC-A-004.12

### Decision

Wake locks are not part of the baseline implementation.

### Reason

Complexity should only be introduced after profiling demonstrates a need.

---

## RFC-A-004.13

### Decision

Wi-Fi locks are also deferred until measurement proves necessity.

### Reason

Avoid premature optimisation.

---

## RFC-A-004.14

### Decision

Battery optimisation work is measurement-driven.

### Reason

Device behaviour varies considerably.

---

# 7. Lifecycle

## RFC-A-004.15

### Decision

The foreground service and capture lifecycle remain separate but coordinated.

### Reason

Capture may fail while the service remains alive long enough to report diagnostics.

---

## RFC-A-004.16

### Decision

Unexpected service termination is observable through diagnostics.

### Reason

Unexpected restarts must be measurable.

---

## RFC-A-004.17

### Decision

Process death ends capture.

No attempt is made to silently restore capture on application restart.

### Reason

User consent must be re-established.

---

# 8. Consequences

## Benefits

- Android privacy remains platform compliant.
- Users always understand when capture is active.
- Service behaviour remains predictable.
- Platform architecture remains Android-independent.

## Trade-offs

- Foreground notification is always visible during capture.
- Some vendor-specific battery behaviour may still require investigation.

## Risks

- Manufacturer firmware may terminate services unexpectedly.
- Android platform behaviour changes between OS versions.

---

# 9. Affected Modules

- Android Service
- Android UI
- Android Permission Handling
- Android Diagnostics

---

# 10. Out of Scope

This RFC intentionally does not define:

- networking;
- protocol;
- packet framing;
- Host discovery;
- microphone buffering;
- scoring;
- recording.

---

# 11. Future Work

Possible future RFCs may define:

- wake-lock policy;
- Wi-Fi lock policy;
- Android battery optimisation guidance.

Only after profiling demonstrates necessity.

---

# 12. Implementation Notes

Measure first.

Only introduce:

- WakeLock
- WifiLock
- ForegroundService optimisations
- native audio backends

after profiling demonstrates a measurable benefit.

---

# 13. Quick Reference

✓ Foreground service owns capture lifetime.

✓ Persistent notification required.

✓ Explicit Start required.

✓ Explicit Stop always available.

✓ Local user Stop overrides Host requests.

✓ RECORD_AUDIO required.

✓ Permission revocation ends capture.

✓ Wake locks deferred.

✓ Wi-Fi locks deferred.

✓ Optimise only after measurement.

---

# 14. Change Log

## 2026-07-13

Initial accepted version.

---

> **Architecture Relationship**
>
> RFC-A-001 defines Android authority.
>
> RFC-A-002 defines microphone capture.
>
> RFC-A-003 defines audio frames.
>
> RFC-A-004 defines how Android safely owns microphone permissions, foreground services and power behaviour without affecting Platform authority.
