# Host Domain Model

These contracts describe host-owned concepts. They are planning boundaries, not integrated runtime state. The Windows host remains authoritative; clients request actions and consume outcomes.

## Identity And Participation

**Singer** is the host-owned person/session identity. It is separate from a client, microphone, profile, and visible slot. Queue requests, votes, performances, scores, and history reference singer IDs, never display names.

**SingerProfile** is optional persistent identity with a stable profile ID, display name, and local four-digit PIN stored only as a salted hash. It owns performance history and personal bests without requiring email or a cloud account. Duplicate display names are valid.

**SessionSinger** is a temporary singer in one host session and may link to a profile. Temporary history can be attached to that profile if the singer upgrades during the same session.

**SingerSlot** is a temporary visible/session position, not identity. Singer-client onboarding assigns the first available slot; the operator may reorder it. A disconnected singer retains a slot for five minutes. Waiting singers can exist without active slots.

**Client** is a temporary connected app/device instance. Initial kinds are `android-phone`, `remote-operator`, and `test-client`; roles are `singer` and `operator`. Singer-role Android clients require a linked singer after onboarding. Operator clients consume no singer slot.

**ClientDevice** uses a stable random app-generated device ID. Identity must not depend on IP address, MAC address, model name, or display name. A device may suggest a prior profile, but onboarding must always provide a switch/not-you path.

## Audio And Requests

**MicrophoneSource** describes audio origin: a local Windows device, network client stream, or future adapter source.

**MicrophoneChannel** is host-owned and controllable. It has one source, zero or one singer, and initially at most one active channel per singer. It tracks mute, gain, level, connection/health, and future latency/scoring metadata.

**QueueItem** requests one deterministic media song for intended participants. It remains distinct from a live `Performance`.

## Performance And Session

**Performance** is created only when the host commits to playback. One occurrence owns its mode, participants, resource readiness, lifecycle, results, and history outcome.

**PerformanceRecord** is finalized durable history. It preserves status, participants, timestamps, scoring version, performance mode, lyric offset, and future recording references. Stopped, failed, and partial results are excluded from official leaderboards.

**HostSession** is initially the one active karaoke event in an application process. It coordinates singers, slots, clients, queue, current performance, microphone channels, and completed results without absorbing playback, lyric, network, or scoring implementation details.

## Karaoke Modes

The internal mode is `"standard" | "party" | "battle"`; UI labels may be Standard, Party, and Battle. A host session and its current/default karaoke mode are different concepts.

- **Standard:** one solo singer or two duet singers, queue-oriented, with only assigned participants scored.
- **Party:** all ready opted-in singers participate independently, with automatic inclusion and a `Sit this song out` choice. It does not require a queue. Late reconnects may receive visible partial/practice scores but not official leaderboard records.
- **Battle:** curated compatible songs use a battle map to assign verses, lines, roles, and shared choruses. Participants score only assigned material; shared sections score each microphone independently. History preserves battle-map and scoring versions. Initial UX targets two singers while contracts allow future expansion.

## Capacity

Capacity uses separate configuration concepts: maximum connected clients, maximum session singers, maximum active microphone channels, and visible singer slots. Initial planning targets are 4–5 typical singers, 6 visible slots, and up to 8 active microphone channels. Session singers may exceed visible slots, producing a waiting state when no slot or channel is available. These are not runtime constants yet.

See [performance lifecycle](performance-lifecycle.md) for orchestration and [protocol draft](protocol-draft.md) for client boundaries.
