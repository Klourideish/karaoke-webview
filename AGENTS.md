# AGENTS.md

## Project

- This is a completely new Windows-only desktop project.
- The browser-based `karaoke-app` repository is reference material only.
- Do not copy code, configuration, dependencies, scripts, tests, architecture, assets, documentation, folder structure, or Git history from the reference repository.
- Target Windows only unless a later task explicitly expands scope.

## Architecture

- React and TypeScript own the interface and ordinary application state.
- Tauri and Rust own privileged desktop and filesystem operations.
- Keep the React/Tauri boundary typed.
- Keep Tauri capabilities narrowly scoped.
- Do not grant unrestricted filesystem access.
- Keep responsibilities in focused modules; avoid growing multi-responsibility files.
- Prefer behavior-preserving extraction before adding new subsystem responsibilities.
- Do not split tightly coupled state machines solely to satisfy line-count targets.
- Keep Rust media responsibilities focused: scanner, persistence, playback access, and future lyrics belong in separate modules.
- Do not add TTML parsing to the media-library scanner module.
- Preserve the desktop shell regions: top information bar, singer bar, left navigation, active central workspace, persistent right queue, and persistent bottom transport.
- SessionSinger identity and membership are Host-owned; React requests singer changes and renders immutable projections.
- Singer IDs are session-local stable identifiers; singer display names are editable metadata.
- Future voting and queue entries should reference singer IDs rather than display names.
- Queue behavior and voting semantics are not implemented yet.
- Use one continuously mounted real audio element when playback is introduced.
- Do not add Socket.IO or multi-client synchronisation.
- Do not add accounts or authentication.
- Do not add Docker unless a future task explicitly requires it.
- Do not add a local HTTP server unless explicitly justified by a future task.
- Do not implement future-phase features early.

### Authoritative Host Direction

- The Windows application is the authoritative host for sessions, singers, playback, lyrics, queue outcomes, microphones, performances, and future scoring/history.
- External clients are lightweight requesters and selected-state consumers; the host validates requests and emits authoritative outcomes.
- Networking is an adapter around host-domain actions, not a second source of domain truth.
- Keep media library, playback, lyrics, microphone, protocol, and future scoring responsibilities in separate modules.
- Add new domain work around existing boundaries; do not leak Android-, UDP-, WebRTC-, or other transport-specific concepts into core models.
- Android clients are planned; no Apple client scope is planned.

## Media Direction For Future Tasks

- Audio will use `.opus`.
- Lyrics will use `.ttml`.
- Pairing will eventually use exact same-folder filename stems.
- Local library discovery pairs `.opus` and `.ttml` files by exact same-folder filename stems.
- Do not parse lyrics, play audio, or enqueue songs until those features are explicitly requested.

## Workflow

- Inspect existing code before editing.
- Keep each task within scope.
- Preserve unrelated behaviour.
- Add focused tests for changed behaviour.
- Run `.\scripts\validate.ps1`.
- Every new user-facing or architectural capability must include a clear manual verification path through normal UI, Developer diagnostics, or a documented test harness.
- Report validation honestly.
- Do not commit unless explicitly instructed.

## Architecture Workflow

Major architectural changes follow this process:

Design Review

Draft RFC

Discussion

Accepted RFC

Implementation

Validation

Commit

Accepted RFCs are authoritative.

Canonical RFCs live under `docs/rfcs/platform/`, `docs/rfcs/host/`, and `docs/rfcs/android/`.

Use namespaced RFC identifiers such as `RFC-P-001`, `RFC-H-001`, and `RFC-A-001` for new work.

Platform RFCs override Host and Android RFCs when conflicts exist.

Host and Android RFCs extend Platform RFCs and must not redefine Platform contracts.

RFC identifiers are permanent.

Do not silently redesign accepted architecture.

If implementation conflicts with an Accepted RFC:

1. Stop.
2. Report the conflict.
3. Request a Design Review.

Small fixes, styling work, and implementation details do not require RFCs unless they change accepted architecture.
