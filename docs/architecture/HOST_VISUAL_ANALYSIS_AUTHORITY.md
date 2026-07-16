# Host Visual Analysis Authority

**Status:** Approved

**Implementation:** P6-006B

Accepted Platform and Host RFCs remain authoritative. This document defines the approved implementation boundary for derived visual analysis. It does not transfer authority from Playback, Performance, Queue, the media library, or lyrics.

## Purpose

The Host Visual Analysis Service provides a bounded amplitude envelope for the active accepted song. React may use that envelope to render calm performer-facing bars without touching or rerouting the audible playback path.

Visual analysis is optional presentation data. Its absence, cancellation, or failure must not alter authoritative runtime behavior.

## Ownership

`HostVisualAnalysisService` is one long-lived Host-owned service. It owns:

- authoritative accepted-song lookup;
- media-path validation through the existing library boundary;
- decoding for analysis only;
- bounded amplitude-envelope generation;
- cancellation and stale-result rejection;
- bounded immutable-resource caching and eviction;
- immutable status projections;
- focused diagnostics;
- deterministic worker shutdown.

The service owns exactly one long-lived worker responsible for decoding and envelope generation.

Playback remains authoritative for audible output, playback position, duration, transport state, and completion. Performance remains authoritative for performer lifecycle and countdown. Queue remains authoritative for ordering and progression.

## Non Goals

The Host Visual Analysis Service SHALL NOT:

- perform audible playback;
- alter Playback timing;
- alter Playback authority;
- alter Performance lifecycle;
- alter Queue progression;
- alter lyric timing or offsets;
- infer countdown state;
- become a synchronization source;
- expose PCM;
- expose filesystem paths;
- expose decoder internals;
- expose media implementation details to React;
- become a transport or seeking API.

## Media Boundary

Requests identify media by stable Host-owned `SongId` only. The service resolves the current accepted indexed song through the existing authoritative media-library lookup. React never supplies or receives a filesystem path, complete media object, PCM buffer, decoder handle, or codec-specific state.

The approved decoder stack is:

```toml
symphonia = { version = "0.6.0", default-features = false, features = ["ogg"] }
symphonia-adapter-libopus = { version = "0.3.0", features = ["bundled"] }
```

Only the Ogg demuxer is enabled. The adapter supplies Opus decoding through bundled libopus. Unsupported containers, codecs, malformed streams, and corrupt files fail analysis independently.

## Analysis Model

The service decodes PCM and computes channel-safe RMS energy over 50 millisecond windows, initially producing 20 samples per second. Channel energy is combined from mean-square values before taking the square root, avoiding phase cancellation.

The completed envelope is normalized deterministically against a documented robust track reference and quantized to unsigned 8-bit values. The service performs no FFT and makes no frequency-band claim.

The stored resource contains one energy value per analysis bucket. It does not pre-expand presentation bars into every frame.

## Resource Budget

The initial implementation uses these hard bounds:

- maximum stored samples per resource: 72,000;
- maximum cached resources: 8;
- maximum concurrent decodes: 1;
- maximum pending request: 1 current-Performance request;
- maximum service-owned envelope and working-buffer memory: 2 MiB;
- cache eviction: least recently used, constrained by entry count and memory;
- cancellation checks: after every decoded packet and during envelope compaction.

When an envelope exceeds 72,000 samples, adjacent samples are compacted deterministically and the bucket duration doubles. RMS-compatible compaction uses:

```text
combined = sqrt((left^2 + right^2) / 2)
```

Compaction may repeat as necessary. Memory therefore remains bounded while arbitrarily long accepted media remains analysable where practical. Temporal detail may decrease for exceptionally long tracks, but duration alone does not make a track unsupported.

Fixed-resolution incremental or chunked analysis is future work and is not part of P6-006B.

## Cache Identity

`SongId` remains the authoritative media identity. Because the current identity is path-derived and audio content may be replaced at the same path, cache freshness additionally uses internal validation metadata:

```text
SongId + canonical audio length + audio modification timestamp
```

The metadata fingerprint exists solely for cache freshness. It never becomes part of the authoritative identity model and is never projected. If reliable metadata cannot be obtained, the service bypasses the cache and regenerates analysis.

## Lifecycle And Trigger

Analysis begins asynchronously during authoritative Performance preparation, after accepted-song validation succeeds. It must not delay or change Performance creation, readiness, countdown, or playback.

- During countdown, analysis may continue but the visualizer remains hidden.
- During playback, a ready envelope may be rendered against authoritative playback time.
- Pause freezes presentation at the existing playback position.
- Resume and seek select the corresponding envelope position immediately.
- Song replacement cancels or supersedes older work.
- Completion, failure, and inactive states clear presentation while reusable cached data may remain.
- Application shutdown cancels pending work, joins the worker, and records join failure diagnostically.

Generation tokens prevent cancelled or superseded analysis from publishing stale results.

## Projection Contract

The service publishes a lightweight immutable status projection:

```text
VisualAnalysisProjection
- revision
- songId
- status: loading | ready | unavailable
- resourceId, optional
- sampleCount
- bucketDurationMs, optional
- durationMs, optional
- failureReason, optional
- failureMessage, optional
```

Status is available through one typed read command and one projection-changed event. The envelope is not repeated in status events.

When status becomes `ready`, React retrieves the immutable resource once:

```text
VisualAnalysisResource
- resourceId
- songId
- bucketDurationMs
- energy: bounded unsigned 8-bit values
```

An evicted or superseded resource returns typed `resource-not-found`. React then requests the current status projection. P6-006B does not require polling, incremental chunks, PCM transport, or custom media delivery.

## Presentation

React renders 36 bars in the reserved Performance footer. Twelve bars represent recent energy and 24 represent upcoming energy. This balances fullscreen detail, narrow-window readability, and calm interpolation without changing the semantic count across responsive layouts.

The renderer uses the existing stable playback-time callback. A component-owned animation frame may draw directly to a canvas while playback is active, but it must not update React state every frame or create another clock.

Animation stops while hidden, paused, inactive, failed, or unmounted. Seek and pause redraw once. Attack, release, interpolation, and falloff are disposable presentation behavior. The renderer never infers lifecycle or completion from amplitude.

The implementation must not use `AudioContext`, `MediaElementAudioSource`, a second media element, a second decoder in React, or any connection to the audible media graph.

## Failure And Cancellation

Typed failures distinguish at least:

- `song-not-found`;
- `song-unavailable`;
- `unsupported-container`;
- `unsupported-codec`;
- `decode-failed`;
- `cancelled`;
- `resource-not-found`;
- `internal-error`.

Corrupt or unsupported media produces an unavailable analysis projection. Playback, Performance, Queue, lyrics, and audible output continue normally. Worker panic, cancellation counts, cache behavior, and shutdown failures remain Developer diagnostics.

## Security And Licensing

No filesystem path, PCM, decoder state, or mutable resource is projected to React.

Distribution must include the required notices for Symphonia, `symphonia-adapter-libopus`, `opusic-sys`, and bundled libopus. The implementation may not be considered release-ready until the repository has an appropriate third-party notice mechanism.

## Implementation Preconditions

Implementation must not begin until:

1. CMake is installed and verified on the Windows development environment.
2. Representative karaoke `.opus` files decode successfully with the approved stack.
3. Baseline executable and installer sizes are recorded.
4. The dependency-integrated executable and installer sizes are measured and accepted.
5. Third-party licence-notice requirements have an approved release path.

If any precondition fails, implementation stops for reassessment.

## Verification

Automated verification must cover authoritative lookup, mono and stereo Ogg Opus fixtures, deterministic envelopes, silence, corrupt and unsupported media, resource bounds, compaction, cancellation, stale-result rejection, cache eviction, immutable resource retrieval, worker shutdown, StrictMode, and playback isolation.

Frontend tests must prove that analysis never creates an `AudioContext`, connects to the media element, introduces another clock, or continues recurring frame work while inactive.

Manual verification must cover countdown-to-playback presentation, pause, resume, seek, song replacement during analysis, failure isolation, normal and fullscreen layouts, narrow windows, audible playback integrity, Queue progression, and lyric synchronization.

## Known Limitations

- The visualization is an amplitude approximation, not frequency analysis.
- Adaptive compaction reduces temporal detail for exceptionally long tracks.
- File length and modification time may theoretically miss same-size replacements with preserved timestamps.
- A resource may be evicted between status delivery and retrieval; typed recovery is required.
- The immutable resource is transferred once through JSON and remains bounded to 72,000 values.
- Fixed-resolution chunked analysis and persistent analysis caches are outside P6-006B.

## Implementation Gate

This document approves the architecture only. Production implementation requires explicit acceptance to proceed.

After implementation and verification, update the document status to:

```text
Status: Implemented
```
