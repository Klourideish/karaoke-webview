# Protocol Draft (Non-Final)

This document captures direction, not an implemented or stable wire protocol.

Karaoke Webview will use app-specific direct communication on a local WLAN first. The Windows host is authoritative. Phones never appear as Windows microphone devices. Control and audio transport are separate, while protocol semantics remain independent of transport. Android singer/microphone support comes first; a remote operator follows later.

## Possible Control Messages

- `HELLO`, `HELLO_ACK`
- `ONBOARD_SINGER`, `PROFILE_LOGIN`, `PROFILE_CREATE`, `SINGER_ASSIGNED`
- `MIC_START`, `MIC_STOP`, `MUTE_STATE`, `CLIENT_STATUS`
- `PERFORMANCE_STATE`, `COUNTDOWN_STATE`
- `PING`, `PONG`, `DISCONNECT`

Clients send requests; the host validates them and emits authoritative outcomes/state. Message names and payloads are provisional.

## Initial Audio Concept

The proof-of-concept target is mono, 48 kHz, signed 16-bit PCM in roughly 10 ms frames. Each frame needs protocol/session/client/channel identifiers, a sequence number, and a first-sample index and/or capture timestamp. The PC handles reorder and jitter. Initial priorities are capture and future scoring; live self-monitoring is not required.

## Unresolved Decisions

- UDP versus WebRTC
- control transport
- PCM versus Opus after proof of concept
- discovery and QR pairing
- authentication/token format
- clock synchronization
- jitter-buffer policy
- encryption
- reconnect semantics
- exact binary packet format

See [architecture vision](architecture-vision.md) and [domain model](domain-model.md). No networking functionality is currently claimed.
