# Architecture Vision

Karaoke Webview is planned as a distributed, local-first karaoke ecosystem centred on one authoritative Windows host. The existing desktop application will evolve around its working media, playback, lyric, and shell boundaries rather than be replaced.

```text
Android singer/mic clients ---- requests + microphone audio ----+
Remote operator ------------- privileged requests -------------+--> Windows host --> TV presentation
Test clients ---------------- protocol validation --------------+       |
                                                                       +--> Operator display
```

## Responsibilities

The Windows host is the processing centre and sole authority for the media library, session, singers, queue and voting outcomes, playback, lyric parsing/timing/rendering, microphone channels, performances, and future recording, scoring, results, and history.

The operator display is a control surface over host-owned state. The TV is a presentation-only output. Android phones are lightweight personal and microphone clients. A future remote operator is a privileged requesting client, not another host. Test clients exercise the same public protocol boundaries.

Clients may send microphone audio, request host actions, and receive selected authoritative state. They do not own queue, playback, or session truth; become Windows microphone devices; duplicate desktop business logic; or decide official scores and performance transitions.

Networking will be an adapter around host-domain commands and events. Protocol concepts remain separate from transport choices, and both remain separate from playback, lyrics, media-library, microphone, and scoring implementations. No Apple client is planned. The Android companion will live in a separate repository.

Development follows a capability-first sequence: build capability, validate it, refactor where necessary, and only then make it beautiful. See the [domain model](domain-model.md), [performance lifecycle](performance-lifecycle.md), [protocol draft](protocol-draft.md), and [roadmap](roadmap.md).
