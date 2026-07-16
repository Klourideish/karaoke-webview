# Host Playback Authority

**Status:** Implemented and used by Host Performance authority

Accepted Platform and Host RFCs remain authoritative. This note records the current Host implementation boundary; it does not replace those RFCs.

## Ownership

`HostPlaybackCoordinator` is one long-lived Host-owned coordinator. It serializes playback requests, owns the active playback attempt and lifecycle state, and publishes immutable projections. React requests operations and reflects Host state.

```text
Stable SongId
    -> authoritative library-index lookup
    -> Host playback request and attempt
    -> immutable adapter projection
    -> persistent HTML audio adapter
    -> attempt-scoped outcome report
    -> Host lifecycle transition
```

The coordinator does not own audio decoding, lyric parsing, queue state, or Performance orchestration.

## Authoritative Song Lookup

Playback starts with a stable Host-owned song ID. The Host resolves that ID against the current accepted persisted library index, verifies that the indexed audio and lyric files still exist beneath the selected library root, and verifies their stable identity before publishing adapter data.

Frontend-supplied paths and complete song objects are not accepted by playback commands. Equivalent rescans preserve lookup while the media identity remains unchanged. Missing, removed, or invalidated songs produce typed failures and no playback attempt.

## Request, Projection, And Report Flow

`request_song_playback` creates a Host attempt in `starting` state. Its projection contains the attempt ID, selected song metadata, a Host-resolved audio path for the existing Tauri asset boundary, and the desired adapter action.

The one persistent HTML audio element applies `start`, `pause`, `resume`, and `stop` actions. Native `playing`, `ended`, and error outcomes are reported to the Host. The Host does not enter `playing` until the adapter reports a successful start, and it does not infer completion from the `play()` promise.

Pause, resume, stop, completion, and failure remain explicit Host lifecycle transitions. Automatic next-song selection is not part of this prerequisite.

Direct diagnostic playback is admitted only when no nonterminal Performance exists. Queue also waits while Playback is already active before creating its next Performance. Performance-owned playback bypasses the direct diagnostic admission check but still uses the same typed Playback coordinator operation.

## Attempt Identity And Idempotency

Every accepted start creates an opaque Host attempt ID. Adapter reports must match the current attempt; stale reports are rejected and counted without altering newer playback.

Mutation commands use caller request IDs with a bounded 128-entry coordinator-local result cache. An identical retry returns its prior result. Reusing a request ID for a different operation returns a typed conflict. The frontend also suppresses duplicate native outcome reports for one attempt/action epoch.

## Audio And Lyrics

The HTML audio element remains mounted across workspace changes and remains the actual playback clock. Lyrics load by the same authoritative song ID and continue to read time from that element. Seek remains an adapter-local transport operation and is not a new Host lifecycle decision.

The Performance footer is currently intentionally inert. The Host-resolved media URL uses Tauri's `asset://localhost` protocol, which is safe for direct HTML media playback but is not exposed as a CORS-readable Web Audio source. Connecting that element to a `MediaElementAudioSourceNode` causes the browser to substitute zero-valued output and can silence the routed audio. The playback element therefore remains directly connected to the webview media pipeline, with no analyser, secondary decoder, or presentation animation attached.

## Live Visualizer Feasibility

No existing repository seam can safely provide a genuinely live visualizer from the current Tauri asset source.

- A narrowly scoped read-only Tauri media protocol could emit the exact origin and CORS headers required by Web Audio. This could preserve genuinely live analysis and broad browser codec support, but it changes the trusted media-delivery boundary and requires Windows/Tauri security and audible-playback validation before adoption.
- Host-side extraction could project a compact bounded envelope without touching the playback element. It offers strong playback isolation but requires a Host decoder and format policy, adds bounded CPU work, and produces a derived approximation rather than a live signal response.
- No same-origin analysis source is currently available in the repository. The direct Tauri asset playback path must remain unchanged until one of the preceding boundaries receives explicit architectural approval.

The Host persists an optional lyric timing offset by stable song ID in app-local data. React retains only a temporary adjustment for the current song. Presentation composes the two values once:

```text
totalOffset = savedSongOffset + temporarySessionOffset
effectiveLyricTime = playbackTime - totalOffset
```

Positive values delay lyrics and negative values advance them. Saving is explicit, stores the current effective offset within `-3000 ms` to `+3000 ms`, and then clears the temporary adjustment. A song change also clears the temporary adjustment before loading the next Host projection. Persisted entries whose songs are absent remain inert and are never applied to another identity.

## Autoplay Constraint

The webview may reject `audio.play()` when its user-gesture policy is not satisfied. The adapter reports that rejection as a safe typed start failure. The Host never simulates successful playback, and the operator can retry from the existing transport after interacting with the application.

## Developer Verification

The Developer workspace lists currently indexed songs as song-ID playback requests and shows playback state, desired adapter action, attempt and song IDs, last adapter event, stale-event count, idempotency counters, and the last safe failure.

Manual verification:

1. Select an indexed song in Developer and request playback.
2. Confirm the Host first shows `starting`, then `playing` only after native audio begins.
3. Pause, resume, and seek; confirm lyrics remain synchronized.
4. Let playback finish and confirm `completed`.
5. Start another song and verify a stale prior attempt report cannot alter it.
6. Request a removed or stale song ID through tests and confirm no audio starts.

## Queue And Performance Relationship

Queue does not call Playback directly. Queue creates a Host-owned Performance, and Performance requests playback through this coordinator using the stable song ID. Performance owns the Accepted three-second countdown and produces the terminal outcome that Queue later consumes.
