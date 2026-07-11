# RFC-003 – Performance Lifecycle

> **Authority**
>
> This RFC defines architectural decisions for Karaoke Webview.
>
> Accepted RFCs are authoritative. Implementations must conform to them.
>
> If implementation conflicts with this RFC, stop and request a Design Review
> rather than silently changing the architecture.

**Status:** Accepted

**Created:** 2026-07-11

**Last Updated:** 2026-07-11

**Authors:** Project

---

# 1. Summary

This RFC defines the authoritative lifecycle of a karaoke Performance.

A Queue Item represents an intention to perform a song. A Performance represents one actual attempt to perform that song and is created only when the host commits to preparing it for playback.

The Windows host owns all lifecycle transitions. Playback, lyrics, microphones, scoring, clients, results, history, and queue progression react to those transitions without independently deciding the Performance state.

Normal performances do not pause midway through a song. Session pause requests take effect between performances.

---

# 2. Motivation

A karaoke performance coordinates several independent subsystems:

- playback
- lyrics
- microphone capture
- connected clients
- scoring
- recording
- results
- history
- queue progression

Without a single authoritative lifecycle, those systems could disagree about whether a performance has begun, ended, failed, or produced an official result.

The lifecycle defined here provides stable transition points while preserving the existing separation between playback, lyrics, microphones, scoring, networking, and persistence.

---

# 3. Decisions

## RFC-003.1

### Decision

A Queue Item is not a Performance.

### Reason

A queued song represents an intention. It may be removed, reordered, or skipped before any performance occurs.

---

## RFC-003.2

### Decision

A Performance is created when the host commits to preparing a queued or directly selected song for playback.

### Reason

Preparation requires a stable Performance identity, but merely adding a song to the queue must not create historical performance data.

---

## RFC-003.3

### Decision

The authoritative Performance states are:

- `created`
- `preparing`
- `ready`
- `countdown`
- `playing`
- `finalizing`
- `results`
- `completed`
- `stopped`
- `failed`

### Reason

These states provide clear coordination points without combining subsystem-specific details into the lifecycle.

---

## RFC-003.4

### Decision

The normal successful transition sequence is:

```text
created
→ preparing
→ ready
→ countdown
→ playing
→ finalizing
→ results
→ completed
```

### Reason

A controlled transition sequence prevents subsystems from independently advancing the Performance.

---

## RFC-003.5

### Decision

The host is the sole authority for Performance state transitions.

### Reason

Playback, clients, microphones, scoring, and queue progression require one consistent lifecycle.

Subsystems may report readiness, completion, degradation, or failure, but the host coordinator decides the resulting transition.

---

## RFC-003.6

### Decision

Preparation gathers readiness from independent subsystems.

Preparation may evaluate:

- audio availability
- lyric availability
- participant readiness
- microphone readiness
- client connectivity
- scoring availability
- mode-specific requirements

### Reason

Subsystem readiness must remain separate from the Performance lifecycle while still contributing to the host’s decision.

---

## RFC-003.7

### Decision

Valid audio and lyrics are required for a normal karaoke Performance.

### Reason

A normal karaoke experience requires both synchronized playback and readable lyrics.

A lyric failure therefore blocks transition to `ready`.

---

## RFC-003.8

### Decision

When lyrics cannot be prepared, the operator may:

- retry lyric preparation
- return the item to the queue
- explicitly continue in audio-only mode

### Reason

Audio-only playback may still be useful for testing, instrumental playback, or exceptional recovery.

Audio-only Performances are unscored and excluded from normal karaoke leaderboards.

---

## RFC-003.9

### Decision

The default countdown is three seconds and is host-authoritative.

During countdown:

- participants are finalized
- microphone sources must already be ready
- microphone buffering may begin
- phones and presentation surfaces receive countdown state
- playback remains at song time zero
- scoring has not yet begun

### Reason

Countdown prepares participants and systems without creating a competing media timeline.

---

## RFC-003.10

### Decision

Participants are locked when playback begins.

### Reason

Official scoring, recording, microphone routing, and history require a stable participant snapshot.

Mode-specific rules may classify late reconnects as partial or practice participants, but they do not silently change the original official participant set.

---

## RFC-003.11

### Decision

The real host playback clock remains authoritative while the Performance is `playing`.

### Reason

Lyrics, scoring, microphone alignment, and clients must derive timing from one source rather than independent timers.

---

## RFC-003.12

### Decision

Normal karaoke Performances do not support mid-song pause.

### Reason

Pausing midway through a song disrupts natural karaoke flow, scoring intervals, microphone capture, and performance continuity.

Emergency Stop remains available as a separate action.

---

## RFC-003.13

### Decision

Session pause is controlled separately from Performance state.

The authoritative Session Flow states are:

- `running`
- `pause-requested`
- `paused`

### Reason

Session flow controls whether another Performance may begin without interrupting the current song.

---

## RFC-003.14

### Decision

A pause requested during a Performance takes effect only after the current Performance has finalized and displayed its results.

### Reason

The current song should finish naturally while still allowing the operator to suspend automatic queue progression.

---

## RFC-003.15

### Decision

When playback ends naturally, the Performance enters `finalizing` before it may enter `results`.

Finalization may include:

- ending the scored interval
- flushing microphone buffers
- completing score calculations
- completing recording metadata
- creating the durable Performance Record
- finalizing the related Queue Item

### Reason

The next Performance must not begin before official results and history are safe.

---

## RFC-003.16

### Decision

Results display for up to ten seconds by default.

The host may choose **Continue now** to end the result period early.

### Reason

Results should be visible without unnecessarily slowing the natural flow of a karaoke session.

---

## RFC-003.17

### Decision

Queue advancement occurs only after safe finalization.

If Session Flow is:

- `running`, the next Performance may prepare after results
- `pause-requested`, the Host Session enters `paused`
- `paused`, no new Performance prepares until resumed

### Reason

Queue progression must not race scoring, history storage, or operator pause intent.

---

## RFC-003.18

### Decision

`stopped` is a terminal state for an operator-ended Performance.

### Reason

A stopped Performance did occur, but did not complete normally.

Stopped Performances:

- may retain diagnostic or partial information
- do not produce official leaderboard results
- are not resumed
- require a new Performance ID for retry

---

## RFC-003.19

### Decision

`failed` is a terminal state for an unrecoverable technical failure.

### Reason

A failed attempt must remain distinguishable from an operator stop or normal completion.

Failed Performances:

- do not produce official leaderboard results
- preserve useful diagnostic context
- leave the queue recoverable
- require a new Performance ID for retry

---

## RFC-003.20

### Decision

A completed, stopped, or failed Performance cannot return to an active state.

### Reason

Historical identity and lifecycle integrity require terminal states to remain terminal.

A replay or retry creates a new Performance.

---

## RFC-003.21

### Decision

Commands and events are distinct.

Commands request actions, including:

- prepare
- start
- stop
- cancel countdown
- continue from results
- request session pause
- resume session flow

Events report authoritative outcomes, including:

- Performance created
- Performance preparing
- Performance ready
- Countdown started
- Performance started
- Performance finalizing
- Results available
- Performance completed
- Performance stopped
- Performance failed

### Reason

Clients and operator interfaces may request changes, but only the host emits authoritative lifecycle events.

---

## RFC-003.22

### Decision

History consumes finalized Performance outcomes rather than low-level playback events.

### Reason

Playback ending does not necessarily mean scoring, recording, and persistence have completed successfully.

---

# 4. Consequences

## Benefits

- One authoritative lifecycle.
- Clear integration points for playback, lyrics, microphones, scoring, and clients.
- Safe finalization before queue advancement.
- Natural uninterrupted karaoke playback.
- Explicit recovery and failure behaviour.
- Clear distinction between queued intentions and actual performances.
- Reliable history and leaderboard eligibility.

## Trade-offs

- Mid-song pause is unavailable during normal operation.
- Preparation and finalization add explicit orchestration stages.
- The next song may wait briefly for scoring and history to complete.
- Audio-only playback requires an explicit operator override.

## Risks

- Poorly implemented subsystem readiness could delay preparation.
- Slow scoring or persistence could delay queue advancement.
- Implementations may incorrectly treat the audio `ended` event as full Performance completion.

These risks should be mitigated through clear subsystem boundaries, timeouts, diagnostics, and focused tests.

---

# 5. Affected Modules

- Host Domain
- Performance Coordinator
- Queue
- Playback
- Lyrics
- Microphones
- Connected Clients
- Scoring
- Recording
- History
- Operator Interface
- TV Presentation

---

# 6. Dependencies

- RFC-001 – Host Authority
- RFC-002 – Domain Model

---

# 7. Out of Scope

This RFC intentionally does not define:

- mode-specific participant selection
- scoring algorithms
- microphone capture implementation
- network transport
- client protocol message encoding
- recording formats
- database schema
- UI styling
- countdown visual design
- detailed recovery-interface design

---

# 8. Non-Goals

This RFC does not support:

- clients independently changing Performance state
- multiple simultaneous authoritative Performances
- normal mid-song pause and resume
- queue advancement directly from the audio `ended` event
- mutation of finalized Performance history
- reuse of a terminal Performance ID for retry
- automatic official scoring for audio-only playback

---

# 9. Future Work

This RFC is extended by:

- RFC-004 – Karaoke Modes
- RFC-006 – History & Leaderboards
- RFC-007 – Microphone Lifecycle
- RFC-008 – Capture Sessions
- RFC-009 – Protocol & Connection State Machine
- RFC-010 – Scoring Pipeline
- RFC-011 – Battle Maps
- RFC-012 – Recording & Media Capture

---

# 10. Implementation Notes

The Performance coordinator should orchestrate lifecycle transitions without absorbing subsystem implementation details.

Playback should continue to own media control and the authoritative playback clock.

Lyrics should react to song selection and playback timing.

Microphones should report readiness and capture status.

Scoring should consume authorized participant audio during the scored interval.

History should persist only finalized outcomes.

Existing pure lifecycle validation helpers may implement these transition rules, but runtime integration is outside this RFC.

---

# 11. Quick Reference

✓ Queue Item means intention to perform.

✓ Performance is created when the host commits to preparation.

✓ Host owns all lifecycle transitions.

✓ Normal flow is created → preparing → ready → countdown → playing → finalizing → results → completed.

✓ Normal karaoke requires audio and lyrics.

✓ Audio-only playback requires an explicit unscored override.

✓ Countdown is three seconds by default.

✓ Participants lock when playback begins.

✓ Normal performances do not pause mid-song.

✓ Session pause takes effect between performances.

✓ Results display for up to ten seconds.

✓ Queue advancement waits for safe finalization.

✓ Stop and failure are terminal and non-official.

✓ Retry creates a new Performance.

✓ Clients send commands; the host emits events.

---

# 12. Change Log

## 2026-07-11

Initial accepted version.

---

> **Relationship to the Core RFCs**
>
> RFC-001 establishes who owns authority.
>
> RFC-002 establishes the domain vocabulary.
>
> RFC-003 establishes how a Performance progresses through time.
