# Karaoke Webview

Karaoke Webview is a new Windows-only desktop foundation for a future karaoke application. It is built with Tauri 2, React, TypeScript, Vite, npm, Vitest, ESLint, and Prettier.

This project was created independently. The separate browser-based `karaoke-app` repository is reference material only; no source code, configuration, dependencies, scripts, assets, documentation, architecture, or Git history are shared.

## Prerequisites

- Windows 10 or Windows 11
- Microsoft Edge WebView2 Runtime
- Node.js LTS and npm
- Rust stable MSVC toolchain
- Visual Studio 2022 or Visual Studio 2022 Build Tools with Desktop development with C++
- MSVC C++ build tools
- Windows 10 or Windows 11 SDK

Visual Studio Code is an editor and does not provide the native C++ compiler required by Tauri.

## Install

```powershell
npm install
```

## Development

```powershell
npm run dev
```

## Media Library

The library scans a user-selected local folder for karaoke pairs:

- audio files use `.opus`
- lyric files use `.ttml`
- both files must be in the same folder
- both files must have the exact same filename stem, such as `Artist - Song.opus` and `Artist - Song.ttml`

Choose or change the folder from the Library workspace, then use Rescan after changing files on disk. Invalid or incomplete pairs are shown in Library diagnostics.

The filesystem scan remains authoritative. The app keeps a lightweight metadata-only library index in its own local application-data folder so previously discovered songs can appear while startup validation checks for changes. Audio files and TTML files are not copied into application storage, parsed lyrics are not cached, and no database is used at this stage.

Use Rebuild library index if the saved index needs to be discarded and recreated from a fresh scan. This only affects application-owned index data; it does not modify media files.

## Local Playback

Library songs can be loaded directly into the player as a playback foundation. Local `.opus` audio is played from its original source path through a narrow Tauri media-source resolver and the Tauri asset protocol; media files are not copied, transcoded, cached as audio data, or read fully into frontend memory.

The app owns one persistent audio element at the shell level. The bottom transport controls play, pause, seek, and volume, while the top bar shows current-song metadata. Queue-driven playback and lyric rendering are not implemented yet.

## Validation

```powershell
.\scripts\validate.ps1
```

## Frontend Build

```powershell
npm run build
```

The frontend output is written to `dist`.

## Desktop Packaging

```powershell
npm run tauri:build
```

Tauri packaging output is generated under `src-tauri\target\release\bundle` when native prerequisites are installed and the build succeeds.
