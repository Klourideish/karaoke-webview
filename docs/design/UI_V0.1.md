# Karaoke Webview UI v0.1

## Status

- Provisional
- Version 0.1
- Intended for review and operator testing
- No runtime work is implied by this document alone

UI v0.1 is a working baseline. It may change after operator testing.

Accepted Platform and Host RFCs remain authoritative. This document does not redefine Platform concepts, move authority into React, or require implementation changes by itself.

## Core UI Principles

- Operator-first language.
- Platform complexity remains hidden until needed.
- Information appears where it is naturally used.
- Public UI avoids direct internal-resource terminology.
- Diagnostics move toward Developer.
- Simple tasks remain simple.
- Complex recovery remains available when needed.
- Queue is the normal route from Library to Performance.
- Public UI does not provide a normal "Play Now" path.

The Platform may internally manage `MicrophoneSource`, `MicrophoneChannel`, `MicrophoneAssignment`, `CaptureSession`, `QueueItem`, `Performance`, `ProtocolSession`, readiness, and recovery states.

The normal operator UI should present singers, songs, queue, microphones, current performance, clear status, and simple actions.

The UI requests. The Host decides. The UI reflects the decision.

## Navigation

UI v0.1 uses Performance-first navigation:

- Performance;
- Library;
- Queue;
- Singers;
- Microphones;
- History;
- Settings;
- Developer.

Home is removed from the provisional Host navigation. Current-performance and attention concepts should
be placed where operators naturally use them rather than collected in a placeholder Home surface.

Normal operator workspaces should not repeat their own title and description at the top of the page.
Navigation already identifies the active area. Concise navigation help appears through delayed hover or
keyboard-focus tooltips instead.

Tooltips should feel deliberate rather than eager. Normal operator workspaces should reclaim the
space left by removed title blocks, with Performance using the available presentation height.

## Library

Purpose: find a song and add it to the queue.

Decisions:

- no public Play button;
- normal action is Add to Queue;
- search remains primary;
- the primary controls are Library location and Rescan;
- choosing a location and rescanning both request one complete Host-owned scan and index refresh;
- artists and their songs are presented alphabetically in independently collapsible groups;
- artist grouping should make large libraries easier to browse;
- unavailable songs show a simple reason;
- technical media diagnostics stay in Developer or Advanced Library Diagnostics.

Example:

```text
Library location  Rescan

42 songs · 11 artists

▸ Artist
  Song
```

This document does not define filesystem implementation.

## Queue

Purpose: show upcoming performances and allow fair community ordering.

Queue item should show:

- song;
- requested by;
- upvote action;
- vote count;
- operator actions where appropriate.

Direction:

- votes can promote popular songs;
- waiting time or queue position must prevent starvation;
- songs already waiting for a configurable number of entries or duration should gradually become protected or promoted;
- operator override remains available;
- exact fairness algorithm is not fixed in UI v0.1 and requires later Platform/domain design before implementation.

UI v0.1 records product intent, not the final queue-ranking formula.

## Now Singing / Performance

Keep this simpler than the current diagnostic model.

Show:

- singer;
- song;
- essential controls;
- clear microphone readiness indicator.

Use the existing singer bar where practical.

Microphone status:

- green microphone icon when connected and ready;
- red microphone icon when unavailable or not working;
- selecting the warning can open the Microphones workspace.

Do not show:

- lyrics-ready status;
- media parser status;
- capture lifecycle internals;
- detailed readiness reason codes.

Lyrics should be displayed as part of the upcoming/current performance experience, not reported as a technical readiness item.

The synchronized lyric presentation uses a restrained rolling window of previous, current, and
upcoming lines. When authored line timings overlap, the newly active line receives current emphasis
immediately while the earlier line may remain briefly visible as it leaves. This is presentation-only:
authored TTML timing, playback authority, seek behavior, and fragment timing remain unchanged.
Performance lyrics use a large readability-first hierarchy and a friendly rounded local font stack:
the current line is dominant from several metres away, while previous and upcoming context remains
legible without competing for attention. Long authored lines wrap naturally without changing text.

The top-bar lyric timing control distinguishes a Host-saved song offset, a temporary adjustment, and
their effective total. Both adjustments use `100 ms` steps within the supported `-3000 ms` to
`+3000 ms` range. Negative values show lyrics earlier and positive values show them later. Saving is
explicit and keyed by stable song identity; temporary timing resets when the song changes and can be
reset without removing the saved value. Neither value alters playback, parsed timestamps, TTML, or
song metadata. Presentation applies `totalOffset = savedSongOffset + temporarySessionOffset` once.
Lines and timed fragments use half-open authored intervals (`start <= effective time < end`).
Meaningful inline TTML spacing is preserved while formatting indentation is ignored.

Do not overload the performance area with queue or singer statistics.

## Singers

Keep the Host singer view restrained.

Session singer identity and membership are Host-owned. The interface requests add, rename, and remove operations and reflects the returned Host projection.

Show only information needed for session operation, such as:

- name;
- microphone status;
- small queue count if useful;
- direct actions.

Avoid turning this into a full profile/dashboard.

Some participant information, such as "3 songs queued," may be better projected to the Android client rather than occupying the Host performance area.

The persistent singer bar may show compact microphone readiness dots for quick operator awareness.
Dots should remain restrained, accessible, and derived from Host microphone projections.

The singer bar provides one restrained Sync action. Its first implemented path guides the operator
through physical microphone selection, singer naming, and confirmation. Selection and navigation do
not mutate Host state; final confirmation invokes one atomic Host participant commit. The development
phone path displays a short-lived QR offer, waits for the phone's participant proposal, and requires
an explicit operator Accept or Reject decision before the Host commits participant state.

The Sync flow is intentionally compact:

1. choose physical microphone setup;
2. choose an eligible local microphone;
3. enter the singer name;
4. confirm singer and microphone together.

Development phone pairing is deliberately labelled insecure. Its QR payload contains only the
short-lived connection offer, and the dialog shows accepted participant state only after the Host
coordinator has validated and committed the proposal.

Developer contains a read-only participant onboarding verification panel so manual testing can
confirm the atomic result or safe failure without exposing registry internals in normal UI.

## Microphones

This section reflects the agreed simplified operator model.

Primary interaction for each singer:

- singer name;
- microphone dropdown;
- simple input volume meter;
- clear connected/ready state;
- clear unavailable state.

The operator should not normally need to understand:

- `MicrophoneChannel`;
- `MicrophoneAssignment`;
- source IDs;
- assignment methods;
- recovery-state enums.

Available sources may appear in a collapsible or secondary section showing simple health/status.

Recovery should use human language:

- Retry
- Choose another microphone
- Leave unassigned

Developer diagnostics remain separate.

## History

Purpose: review completed performances.

Show a simple chronological view first.

Potential future additions:

- score;
- favorite;
- notes;
- mode;
- timestamps.

Do not expose lifecycle internals by default.

## Settings

Settings contains product-level configuration only, including likely areas such as:

- audio output;
- library;
- appearance;
- performance defaults;
- Android companion;
- privacy;
- future integrations.

Do not make Settings a dumping ground for developer toggles.

## Developer

Developer contains:

- development protocol controls;
- packet diagnostics;
- capture diagnostics;
- jitter buffer information;
- diagnostic audio monitoring;
- recovery testing;
- runtime inspection;
- parser diagnostics;
- validation tools.

The insecure development listener belongs here long term.

UI-002 establishes Developer as its own Host workspace so protocol, capture, monitor, and runtime
diagnostics can remain available without dominating normal operator microphone workflows.

Developer tools must remain available during active development, but should not dominate the public operator experience.

Developer remains the workspace that keeps an explicit heading and explanatory context because it is
intentionally separate from normal operator flow.

## Android Companion Direction

Normal participant UI should eventually emphasize:

- connected Host;
- QR pairing and participant setup;
- microphone ready state;
- simple input meter;
- Start/Stop;
- read-only Host projections such as queued-song count where useful.

Developer mode may show:

- packet counts;
- queue depth;
- heartbeat;
- thermal data;
- loop timing;
- stream IDs;
- insecure connection status.

Android never gains authoritative karaoke-domain control.

## Open Questions

- Exact navigation structure.
- Whether Home and Now Singing remain separate.
- Final queue fairness policy.
- How operator overrides appear.
- Degree of artist-folder nesting.
- When diagnostics graduate into Developer.
- Visual language and branding.
- Android projection scope.

## Non-Goals

UI v0.1 does not:

- redefine Platform architecture;
- define final styling;
- implement queue ranking;
- implement public release behavior;
- remove diagnostics immediately;
- require a frontend rewrite;
- define responsive/mobile layouts for the Host;
- define audience-screen presentation.
