# Host Performance Authority

**Status:** Implemented and integrated with the P6-003 Queue prototype

Accepted RFC-P-003 and the other Accepted Platform and Host RFCs remain authoritative. This note records the Host implementation boundary and does not replace the RFC lifecycle.

## Ownership

`HostPerformanceCoordinator` is one long-lived Host-owned coordinator. It owns Performance identity, lifecycle, readiness decisions, countdown and results deadlines, playback-attempt linkage, terminal outcomes, immutable projections, and bounded idempotency.

React requests operations and renders projections. It does not create Performance IDs, run lifecycle timers, decide readiness, select playback media, or infer terminal completion.

## Lifecycle

The implementation uses the Accepted lifecycle exactly:

```text
created -> preparing -> ready -> countdown -> playing
        -> finalizing -> results -> completed
```

`stopped` and `failed` are terminal. Preparation cancellation maps to `stopped` with `cancelled-before-playback`. Operator skip/end maps to `stopped` with `skipped-by-operator`. A retry always creates a new Performance ID and a new playback attempt.

Playback startup is not a Performance lifecycle state. Performance remains in `countdown` while the linked `HostPlaybackCoordinator` attempt is starting, and the playback sub-projection exposes that pending state. Performance enters `playing` only after the matching adapter acknowledgement.

## Readiness And Countdown

Performance invokes the existing microphone readiness evaluator with Standard-mode policy for the selected performer. Blocked or degraded readiness remains in `preparing`. Ready preparation passes through `ready` and starts the Host-owned three-second monotonic countdown.

Readiness is rechecked during countdown. If it becomes unready, the deadline is cancelled, pending playback startup is stopped where necessary, and lifecycle returns to `preparing`. Readiness during active playback remains observational and does not trigger automatic reassignment.

The retained worker owns deadline evaluation and projection ticks. Frontend remounts and workspace navigation do not restart countdown. Host shutdown signals and joins the same worker.

## Playback Boundary

At countdown expiry, Performance requests playback by stable Host song ID through `HostPlaybackCoordinator`. The authoritative library lookup and persistent HTML audio adapter remain unchanged. Matching playback reports are fanned out to Performance only after Playback accepts them.

Stale adapter reports cannot change Performance. Playback failure produces terminal `failed` with a safe typed reason. Operator skip requests Playback stop through the same coordinator before exposing the stopped Performance result.

## Finalisation And Results

Matching playback completion moves Performance through `finalizing` into `results`. Results owns a ten-second Host monotonic deadline, matching RFC-P-003's current default. The initial UI may be minimal, but React cannot skip or complete this phase. Expiry transitions to `completed`.

Queue links an entry to the Performance created for it and reacts only to the matching typed terminal outcome. Queue does not own the countdown or advance directly from an audio completion event.

## Diagnostics And Verification

The Developer workspace can create a Performance from an indexed song and an existing SessionSinger. It shows lifecycle, performer, song, countdown/results remaining time, readiness, playback attempt/state, and last transition. Cancel preparation and skip actions exercise typed Host commands.

Manual verification:

1. Create a singer with a ready microphone and index a valid song.
2. In Developer, choose the singer and song and create a Performance.
3. Confirm preparation becomes a three-second countdown.
4. Confirm `playing` appears only after audio starts.
5. Let playback finish and observe `results`, then `completed` after its Host deadline.
6. Cancel during preparation and verify `stopped / cancelled-before-playback`.
7. Skip countdown or playback and verify `stopped / skipped-by-operator`.
8. Disconnect the microphone during countdown and verify preparation waits rather than starting.
9. Trigger a playback failure and verify terminal `failed` without automatic retry.

## Current Limitations

- The current command creates one Standard-mode Performance with one performer.
- Party and Battle runtime participant structures remain future work.
- Queue progression consumes Performance terminal outcomes; persistence, history, and scoring are not implemented.
- Results UI is intentionally minimal even though its lifecycle deadline is authoritative.
