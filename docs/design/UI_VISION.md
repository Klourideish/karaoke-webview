# Karaoke Webview UI Vision

**Status:** Provisional product direction

Karaoke Webview is a karaoke host console, not a generic media player.

The Platform should think in systems. The operator should think in people.

The Host may coordinate playback, lyrics, microphones, queue policy, performances, protocol sessions, readiness, and recovery. The operator experience should translate that complexity into singers, songs, queue, microphones, current performance, clear status, and simple actions.

The related interaction principle is:

The UI requests. The Host decides. The UI reflects the decision.

## Experience Direction

Karaoke Webview should be operator-first. It should help the person running the session answer:

- Who is singing?
- What is next?
- Are the microphones ready?
- What needs attention?
- What can I safely do now?

The product should emphasize social karaoke. It should make community flow, singer readiness, and song selection more visible than implementation details.

Technical complexity should be hidden until needed. Diagnostics remain available for development, hardware troubleshooting, and validation, but they are not the normal product surface.

## Workspace Direction

Recommended long-term conceptual structure:

Operational:

- Home
- Library
- Queue
- Now Singing / Performance
- Singers
- Microphones
- History

Configuration:

- Settings

Engineering:

- Developer

Operational workspaces should focus on session flow. Settings should hold product-level configuration. Developer should contain protocol, packet, capture, parser, and runtime diagnostics.

## Host And Android

Host and Android have distinct user experiences.

The Host serves the operator. It provides session control, recovery, performance state, library access, queue management, and microphone oversight.

Android serves the participant. It should focus on connection, microphone readiness, simple capture controls, and selected read-only Host projections.

Android never gains authoritative karaoke-domain control.

## Current Application Relationship

The current desktop app already has a useful shell: Perform, Library, Microphones, Settings, persistent Queue, singer bar, and bottom transport.

Some current surfaces are intentionally diagnostic-heavy because the product is still proving subsystems. UI v0.1 treats those diagnostics as validation tooling, not the final operator experience.

This vision is a direction, not a fixed visual specification.
