# Roadmap

Phone interaction is a core product direction, not an optional add-on. Sequence remains capability-first: implement, validate, refactor where needed, then polish.

## Completed Foundation

- recursive media-library scanner and persistent metadata index
- operator Library organisation with automatic refresh, alphabetical artist groups, and collapsible song browsing
- local Opus playback through one persistent audio element
- TTML parser and normalized lyric model
- lyric timing and synchronized fragment presentation
- classic fragment fill
- normalized inline TTML spacing and deterministic half-open lyric timing
- session-local signed lyric offset with operator controls
- Host-persisted per-song lyric timing composed with a temporary session adjustment
- Host-owned playback authority with stable indexed song lookup and attempt-scoped adapter reports
- Host-owned Performance authority with RFC-P-003 lifecycle, readiness, countdown, playback linkage, and results deadline
- Host-owned Queue prototype with deterministic ordering, bounded voting, and Performance-owned progression
- Host-owned session singer registry and atomic participant commit foundation
- Host Sync dialog and physical microphone onboarding through the atomic participant commit

## Immediate

- complete current lyric fill lead adjustment
- lyric presentation foundations

## Core Next

- extend participant onboarding with development phone pairing
- local microphone discovery
- microphone channel model
- local microphone capture and control
- client/protocol proof of concept
- development QR pairing and participant setup contract
- Android microphone relay proof of concept in its separate repository
- history/database foundation
- scoring foundation
- multi-display operator/TV separation

## Later

- Party and Battle implementation
- remote operator panel
- phone queue interaction
- Korean romanization
- effect presets and advanced styling
- recording
- external control adapters

Architecture direction and unresolved protocol decisions are tracked in [architecture vision](architecture-vision.md) and [protocol draft](protocol-draft.md).

# Platform

✔ Capture architecture
✔ Host ownership
✔ Development protocol
✔ Android microphone input
✔ Diagnostic capture
✔ Diagnostic audio monitoring

# UI

✔ Initial design language
✔ UI v0.1

# Next

→ UI consolidation
→ Navigation
✔ Queue experience
✔ Library queue integration through authoritative Queue commands
