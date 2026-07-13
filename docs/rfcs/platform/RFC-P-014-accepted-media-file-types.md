# RFC-P-014 — Accepted Media File Types

**Status:** Accepted

**Created:** 2026-07-13

**Last Updated:** 2026-07-13

**Authors:** Project

---

> **Authority**
>
> Accepted RFCs are authoritative.
>
> Platform, Host, Android, protocol, and future implementation RFCs must conform to this RFC.
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

> **Related RFCs**
>
> This RFC is commonly implemented alongside:
>
> - RFC-H-001 — Windows Host Identity & Runtime Authority
> - RFC-H-004 — Host Adapter & Platform Integration Model
> - RFC-H-005 — Host Validation, Diagnostics & Shutdown

---

# 1. Summary

This RFC defines the accepted Platform media file types for normal Karaoke Webview performances.

The accepted audio file type is `.opus`.

The accepted lyrics file type is `.ttml`.

These file types form the shared Platform contract for media readiness while leaving filesystem discovery, decoding, playback engines, parsing implementation and user interface behaviour to Host or implementation-specific RFCs.

---

# 2. Motivation

Karaoke performance readiness depends on both playable audio and synchronized readable lyrics.

Without accepted file types:

- implementations may accept incompatible media formats;
- lyric timing may differ between clients;
- media library behaviour may become implementation-specific;
- normal performance readiness may be evaluated inconsistently;
- parser and playback work may begin without a stable contract.

This RFC establishes a narrow shared file-type contract before media player and lyrics parser implementation begins.

---

# 3. Media Roles

## RFC-P-014.1

### Decision

Normal karaoke performances use one accepted audio asset and one accepted lyrics asset.

### Reason

RFC-P-003 requires valid audio and lyrics for normal karaoke readiness.

---

## RFC-P-014.2

### Decision

The accepted audio file extension is `.opus`.

### Reason

The Platform requires a single canonical audio file type for initial interoperability.

---

## RFC-P-014.3

### Decision

The accepted lyrics file extension is `.ttml`.

### Reason

The Platform requires a single canonical lyric and timing file type for initial interoperability.

---

# 4. Readiness

## RFC-P-014.4

### Decision

A normal karaoke Performance is not media-ready unless both accepted assets are available:

- one `.opus` audio asset;
- one `.ttml` lyrics asset.

### Reason

Normal karaoke playback requires synchronized audio and readable lyrics.

---

## RFC-P-014.5

### Decision

Audio-only playback requires an explicit future override and is not the default normal readiness path.

### Reason

RFC-P-003 allows audio-only playback only as an explicit exceptional path.

---

# 5. Unsupported Files

## RFC-P-014.6

### Decision

Unsupported media or lyrics file types shall fail with typed reasons.

### Reason

Implementations must not silently reinterpret unsupported files as accepted Platform media.

---

## RFC-P-014.7

### Decision

Unsupported files must not become authoritative Platform media assets.

### Reason

Platform media readiness must remain deterministic across implementations.

---

# 6. Platform vs Implementation

## RFC-P-014.8

### Decision

This RFC defines accepted Platform file roles and extensions only.

It does not define:

- filesystem scanning;
- file pairing;
- media library indexing;
- audio decoding;
- playback engine selection;
- TTML parser internals;
- rendering style;
- transport encoding.

### Reason

Accepted file types are Platform contracts. Implementation mechanics belong beneath Host adapters or future implementation RFCs.

---

## RFC-P-014.9

### Decision

Host implementations own filesystem access, playback engines and lyrics parsing.

### Reason

Native resource ownership and external system integration are Host responsibilities.

---

# 7. Consequences

## Benefits

- Stable initial media contract.
- Consistent readiness checks.
- Clear parser and playback targets.
- Reduced implementation drift.
- Future clients share one media vocabulary.

## Trade-offs

- Other media formats are intentionally excluded from the normal path.
- Conversion or import workflows may be needed later.

## Risks

- Existing karaoke libraries may use other formats.
- TTML rendering requirements may require future clarification.
- Opus playback support depends on Host implementation choices.

---

# 8. Affected Modules

- Platform Domain
- Host Runtime
- Host Media Library
- Host Playback Adapter
- Host Lyrics Parser
- Host Frontend Projection
- Future Protocol Projections

---

# 9. Out of Scope

This RFC intentionally does not define:

- media library implementation;
- local filesystem authority;
- media import workflow;
- playback engine;
- audio decoder;
- TTML parser implementation;
- lyric rendering design;
- scoring;
- recording;
- persistence;
- Android media playback.

These are defined by Host or future implementation RFCs.

---

# 10. Future Work

Future RFCs may define:

- Host media library and filesystem authority;
- Host playback adapter;
- TTML parser behaviour;
- media import and validation workflow;
- audio-only override policy;
- additional accepted formats.

---

# 11. Implementation Notes

Treat extension checks as an initial Platform validation boundary.

Keep decoding and parsing behind Host adapters.

Expose media and lyric readiness through immutable Host projections.

Reject unsupported file types with stable typed failures.

---

# 12. Quick Reference

✓ Accepted audio file type is `.opus`.

✓ Accepted lyrics file type is `.ttml`.

✓ Normal readiness requires both accepted audio and accepted lyrics.

✓ Audio-only playback requires an explicit future override.

✓ Unsupported file types fail with typed reasons.

✓ Platform defines file roles; Host defines implementation mechanics.

✓ React never owns media files, parsers or playback engines.

---

# 13. Change Log

## 2026-07-13

Initial accepted version.

---

> **Architecture Relationship**
>
> RFC-P-003 defines that normal karaoke performances require audio and lyrics.
>
> RFC-P-014 defines the accepted Platform file types used to satisfy that media readiness contract.
