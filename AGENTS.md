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
- Singer IDs are local stable identifiers; singer display names are editable metadata.
- Future voting and queue entries should reference singer IDs rather than display names.
- Queue behavior and voting semantics are not implemented yet.
- Use one continuously mounted real audio element when playback is introduced.
- Do not add Socket.IO or multi-client synchronisation.
- Do not add accounts or authentication.
- Do not add Docker unless a future task explicitly requires it.
- Do not add a local HTTP server unless explicitly justified by a future task.
- Do not implement future-phase features early.

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
- Report validation honestly.
- Do not commit unless explicitly instructed.
