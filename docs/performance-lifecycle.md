# Performance Lifecycle

A `Performance` represents one host-committed occurrence of a song. Commands request transitions; host events announce validated outcomes. A client command such as `REQUEST_START` never changes authoritative state by itself.

```text
created -> preparing -> ready -> countdown -> playing -> finalizing -> results -> completed
   |           |          |          |          |
   +-----------+----------+----------+----------+--> stopped
               +----------+----------+----------+--> failed
```

Normal playback has no mid-song paused performance state. `stopped`, `failed`, and `completed` are terminal. Retry always creates a new Performance ID.

Preparation requires audio and lyrics for normal karaoke. Microphones are required when capture or scoring is enabled; scoring may instead enter an explicit disabled/degraded mode. Participant membership is finalized before countdown, and Battle also requires a valid battle map.

Lyric failure blocks normal readiness. The operator may retry, return the request to the queue, or explicitly choose audio-only playback. Audio-only performances are unscored and excluded from normal leaderboards.

Countdown defaults to three host-authoritative seconds. Audio remains at time zero while phones and TV receive synchronized countdown state. Microphone buffering may begin; scoring begins at song time zero. Participants lock when playback begins.

Finalization completes before results. Results remain visible for up to ten seconds unless the host chooses `Continue now`. Queue advancement occurs only after safe finalization.

## Session Flow

Session flow is independent of performance lifecycle:

```text
running -> pause-requested -> paused -> running
    ^             |
    +-------------+  cancel pause request
```

If pause is requested during a song, that performance continues through finalization and results. No next performance prepares after the request, and the session becomes paused after results. An idle session may move directly from running to paused. Resume returns it to running.

Emergency Stop terminates the current performance. The stopped result is non-official; retry creates a new performance.

## History And Leaderboards

SQLite is likely suitable for growing history, but no database is implemented yet. The media filesystem remains authoritative for songs.

Every finalized completed performance should remain as its own record. Personal bests and leaderboards are derived by query, not destructive replacement. Records preserve scoring algorithm version and, for Battle, battle-map version. Official, partial, practice, stopped, failed, and audio-only outcomes remain distinct. Official comparisons require compatible song, mode, and scoring configuration.
