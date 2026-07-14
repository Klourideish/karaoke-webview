# Development Interoperability Profile V0

**Status:** Development Only

**Created:** 2026-07-13

**Last Updated:** 2026-07-13

**Security:** INSECURE DEVELOPMENT HARNESS

---

> **Warning**
>
> This profile is an intentionally temporary, plaintext development harness.
>
> It exists only to prove Android-to-Host microphone interoperability.
>
> It is not the production Karaoke Webview protocol.
>
> Production implementations must conform to RFC-P-008 security, pairing,
> trust, encryption, authentication, reconnect, and capability requirements.

---

# 1. Purpose

This document defines the minimum shared wire contract required to prove:

```text
Android AudioRecord
        ↓
CapturedAudioFrame
        ↓
Development Network Sink
        ↓
Windows Host Receiver
        ↓
NetworkMicrophoneSource
        ↓
Existing Host Capture Pipeline
        ↓
Existing RMS / Peak Meter
```

This profile intentionally supports:

- one Windows Host;
- one Android client;
- one active development audio stream;
- manual Host address entry;
- plaintext control traffic;
- plaintext UDP audio;
- no production trust or pairing.

---

# 2. Governing RFCs

This profile implements a temporary subset of:

- RFC-P-001 — Platform Authority
- RFC-P-005 — Microphone Resource Model
- RFC-P-006 — Capture Session Model
- RFC-P-007 — Microphone Assignment & Channel Management
- RFC-P-008 — Platform Protocol & Connection State Machine
- RFC-A-001 — Android Client Authority & Boundaries
- RFC-A-002 — Android Audio Capture Lifecycle
- RFC-A-003 — Audio Frame & Buffer Contract

Where this development profile conflicts with an Accepted RFC, the Accepted RFC wins.

The plaintext exception is permitted only because RFC-P-008 explicitly allows an insecure disposable development harness.

---

# 3. Scope

## Included

- manual Host IP entry;
- reliable plaintext development control connection;
- Host-assigned short stream identity;
- plaintext UDP PCM transmission;
- bounded sender and receiver queues;
- packet ordering and continuity metadata;
- start and stop control;
- heartbeat;
- basic diagnostics;
- one Host-side `NetworkMicrophoneSource`;
- use of the existing Host diagnostic meter.

## Excluded

- QR pairing;
- mDNS;
- retained trust;
- TLS;
- authenticated encryption;
- production authentication;
- session resume;
- clock synchronization;
- Host projections;
- singer assignment from Android;
- scoring;
- recording;
- live speaker monitoring;
- multiple simultaneous clients;
- internet routing;
- NAT traversal.

---

# 4. Default Endpoints

The Host listens on:

```text
Control TCP port: 45820
Audio UDP port:   45821
```

Both ports must remain configurable.

The Android client uses a manually entered IPv4 or IPv6 Host address.

The development UI must clearly label the connection as insecure.

---

# 5. Audio Profile

Development Profile V0 uses:

- mono;
- 48,000 Hz;
- signed PCM16;
- little-endian samples;
- 10 ms nominal frames;
- 480 samples per frame;
- 960 PCM payload bytes per complete frame.

No format negotiation occurs in V0.

A client that cannot produce this profile must fail clearly.

---

# 6. Control Transport

The development control plane uses:

```text
Plain TCP
UTF-8
One JSON object per line
LF-delimited
```

Every message contains:

```json
{
  "type": "message_type",
  "profileVersion": 0
}
```

Unknown message types must be rejected with a typed development error.

Malformed JSON must not crash either process.

---

# 7. Development Identity

The Android client provides:

- `clientDeviceId`
- `clientName`

`clientDeviceId` must be an opaque locally generated identifier.

It must not be derived from:

- IP address;
- MAC address;
- hardware serial;
- phone model.

The Host assigns:

- `clientConnectionId`
- `protocolSessionId`
- `networkMicrophoneSourceId`
- `audioStreamId`

These identities remain distinct even in the development harness.

---

# 8. Control Messages

## 8.1 Client Hello

Android sends immediately after connecting:

```json
{
  "type": "client_hello",
  "profileVersion": 0,
  "clientDeviceId": "opaque-installation-id",
  "clientName": "Android Phone",
  "audioProfile": {
    "sampleRateHz": 48000,
    "channelCount": 1,
    "encoding": "pcm_s16le",
    "frameDurationMs": 10,
    "samplesPerFrame": 480
  }
}
```

## 8.2 Host Hello Accepted

Host responds:

```json
{
  "type": "host_hello_accepted",
  "profileVersion": 0,
  "clientConnectionId": "development-connection-id",
  "protocolSessionId": "development-session-id",
  "networkMicrophoneSourceId": "network-mic-development-1",
  "audioUdpPort": 45821,
  "heartbeatIntervalMs": 1000
}
```

After this message, the Host may expose the connected Android client as a development `NetworkMicrophoneSource`.

Connection does not imply active streaming.

## 8.3 Host Hello Rejected

```json
{
  "type": "host_hello_rejected",
  "profileVersion": 0,
  "reasonCode": "unsupported_audio_profile",
  "message": "Development Profile V0 requires mono 48 kHz PCM16."
}
```

The Host closes the control connection after rejection.

## 8.4 Stream Request

Android sends only after local user Start Capture succeeds:

```json
{
  "type": "request_stream_authorization",
  "profileVersion": 0,
  "captureAttemptId": "android-runtime-attempt-id"
}
```

## 8.5 Stream Authorized

Host responds:

```json
{
  "type": "stream_authorized",
  "profileVersion": 0,
  "audioStreamId": 1,
  "audioUdpPort": 45821
}
```

`audioStreamId` is an unsigned 32-bit value assigned by the Host.

Android must not send accepted audio before receiving this message.

## 8.6 Stream Rejected

```json
{
  "type": "stream_rejected",
  "profileVersion": 0,
  "reasonCode": "stream_already_active",
  "message": "A development stream is already active."
}
```

## 8.7 Stop Stream

Android sends when local capture stops:

```json
{
  "type": "stop_stream",
  "profileVersion": 0,
  "audioStreamId": 1,
  "reasonCode": "local_user_stop"
}
```

## 8.8 Stream Stopped

Host responds:

```json
{
  "type": "stream_stopped",
  "profileVersion": 0,
  "audioStreamId": 1
}
```

The Host must stop accepting packets for that stream immediately.

The requested `audioStreamId` must match the active stream. A stale or mismatched ID receives a typed `audio-stream-id-mismatch` development error and must not stop a newer stream. When no stream is active, the Host returns `stream-not-active`.

## 8.9 Heartbeat

Either side may send:

```json
{
  "type": "heartbeat",
  "profileVersion": 0,
  "sentAtMonotonicMs": 123456789
}
```

Heartbeat interval:

```text
1,000 ms
```

The connection is considered lost after:

```text
3 consecutive missed heartbeat intervals
```

For V0, connection loss ends stream authorization immediately.

V0 does not resume the prior stream.

---

# 9. Audio Datagram Layout

All numeric fields are unsigned and little-endian.

Each UDP datagram contains exactly one complete 10 ms audio frame.

## 9.1 Header

| Offset | Size | Field                         |
| -----: | ---: | ----------------------------- |
|      0 |    4 | Magic bytes `KWAV`            |
|      4 |    1 | Audio profile version         |
|      5 |    1 | Flags                         |
|      6 |    2 | Header length                 |
|      8 |    4 | Audio stream ID               |
|     12 |    8 | Sequence number               |
|     20 |    8 | First sample index            |
|     28 |    8 | Capture timestamp nanoseconds |
|     36 |    2 | Sample count                  |
|     38 |    2 | Reserved                      |

Header length:

```text
40 bytes
```

## 9.2 Payload

Immediately following the header:

```text
960 bytes PCM16 little-endian
```

Total normal datagram size:

```text
1,000 bytes
```

This remains below a typical local-network MTU without fragmentation.

---

# 10. Header Field Semantics

## Magic

Must contain:

```text
K W A V
```

Packets with invalid magic are discarded.

## Audio Profile Version

Must equal:

```text
0
```

Unknown versions are discarded and counted.

## Flags

V0 defines no flags.

The value must be:

```text
0
```

## Header Length

Must equal:

```text
40
```

## Audio Stream ID

Must match a currently Host-authorized development stream.

Unknown or stopped stream IDs are discarded.

## Sequence Number

Monotonically increases by one for every locally produced frame within the active stream.

Sequence gaps are preserved and reported.

## First Sample Index

Identifies the first sample in the payload relative to the active Android capture attempt.

For contiguous complete frames:

```text
nextFirstSampleIndex =
previousFirstSampleIndex + previousSampleCount
```

## Capture Timestamp

Uses the Android monotonic clock.

Recommended source:

```text
SystemClock.elapsedRealtimeNanos()
```

V0 records this value for diagnostics only.

V0 does not perform Host/client clock synchronization.

## Sample Count

Must equal:

```text
480
```

for normal V0 packets.

## Reserved

Must be zero.

Receivers must ignore it after verifying packet length.

---

# 11. Packet Validation

The Host discards a packet if:

- datagram length is not exactly 1,000 bytes;
- magic is invalid;
- profile version is unsupported;
- header length is invalid;
- stream ID is unknown or unauthorized;
- sample count is not 480;
- reserved fields violate V0 requirements;
- sequence number is stale;
- packet is too late for the bounded receiver window.

Discarded packets increment typed diagnostics.

Malformed packets must never terminate the Host receiver.

---

# 12. Android Sender Rules

Android must:

- retain the existing `AudioCaptureEngine`;
- retain the existing `CapturedAudioFrame` contract;
- implement networking as a new `AudioFrameSink`;
- keep its outgoing queue bounded;
- discard the oldest stale unsent frame when full;
- never replay dropped frames;
- stop transmission immediately when control is lost;
- stop transmission immediately when authorization is revoked;
- preserve sequence and sample-index discontinuities;
- retain local RMS and peak diagnostics;
- retain explicit local Stop authority.

Android must not:

- alter Host assignments;
- create Host channels;
- transmit before authorization;
- send frames captured before authorization as backlog;
- route audio to local or Host speakers.

---

# 13. Host Receiver Rules

The Host must:

- own the TCP and UDP listeners in Rust;
- create one development network-source adapter;
- expose a Platform-compatible `NetworkMicrophoneSource`;
- keep protocol and socket state outside React;
- validate all packet metadata;
- use a bounded receiver queue;
- maintain a small bounded reorder/jitter window;
- expose packet-loss and late-packet diagnostics;
- transform valid PCM frames into the existing capture-consumer boundary;
- allow the existing diagnostic meter to consume the stream;
- stop accepting packets when authorization ends.

The Host must not:

- create a Windows virtual microphone;
- expose raw PCM to React;
- play received audio through speakers;
- allow the adapter to bypass Host coordinators;
- silently assign the source to a singer;
- add scoring or recording in this phase.

---

# 14. Development Jitter Policy

V0 may use a small fixed receiver window.

Recommended starting target:

```text
30 ms
```

Recommended hard maximum:

```text
60 ms
```

The exact value is an implementation setting and must be observable.

Packets arriving after the accepted window are discarded.

Missing frames become explicit gaps.

No retransmission exists.

---

# 15. Connection Loss

When the control connection is lost:

1. Host revokes stream authorization immediately.
2. Host stops accepting audio packets for the stream.
3. Android stops UDP transmission immediately.
4. Android may continue local capture only under its local lifecycle policy.
5. Frames produced while disconnected are discarded.
6. No disconnected audio is replayed.
7. The development stream is closed.
8. A new connection creates a new stream identity.

Host-owned channel and assignment identities, where present, remain governed by RFC-P-007.

---

# 16. Required Diagnostics

## Android

Expose:

- control connection state;
- active stream ID;
- packets sent;
- bytes sent;
- send failures;
- outgoing queue depth;
- maximum queue depth;
- locally dropped network frames;
- last heartbeat age;
- capture-to-send delay.

## Host

Expose:

- connected development clients;
- active stream ID;
- packets received;
- valid packets;
- malformed packets;
- unauthorized packets;
- sequence gaps;
- late packets;
- estimated packet loss;
- receiver queue depth;
- jitter-window depth;
- capture handoff queue depth, maximum depth, and dropped stale frames;
- source health;
- current RMS and peak.

---

# 17. Development Security Rules

The UI on both implementations must display:

```text
INSECURE DEVELOPMENT CONNECTION
```

The development listener should bind only to local-network interfaces where practical.

The insecure profile must not be enabled by default in production builds.

No permanent credentials are exchanged.

No microphone data from this profile should be treated as private against local-network observers.

---

# 18. Initial Acceptance Criteria

Development Profile V0 succeeds when:

- Android connects using a manually entered Host address;
- Host accepts the development hello;
- Host exposes one `NetworkMicrophoneSource`;
- Android starts capture only after local user action;
- Android requests stream authorization;
- Host authorizes one stream;
- Android sends valid 1,000-byte UDP packets;
- Host validates and consumes the packets;
- speaking into the phone moves the existing Host RMS and peak meter;
- no audio is routed to speakers;
- Android Stop ends Host meter activity promptly;
- control loss stops packet acceptance immediately;
- reconnect creates a new stream without replaying stale audio;
- packet loss and queue depth are visible;
- a 10-minute physical-device run remains stable;
- both processes release sockets and workers cleanly.

---

# 19. Replacement Criteria

This profile must be replaced before production use by RFC-P-008-compliant:

- pairing;
- retained trust;
- encrypted control transport;
- encrypted and authenticated audio;
- replay protection;
- capability negotiation;
- timing exchange;
- session resume;
- production diagnostics.

---

# 20. Quick Reference

✓ Development only.

✓ Manual Host address.

✓ TCP JSON-lines control.

✓ UDP PCM audio.

✓ Ports 45820 and 45821 by default.

✓ One Android client.

✓ One active stream.

✓ Mono 48 kHz PCM16.

✓ 10 ms / 480-sample frames.

✓ 40-byte binary header.

✓ 960-byte PCM payload.

✓ 1,000-byte total datagram.

✓ Little-endian numeric fields.

✓ Host assigns stream ID.

✓ Android sends only after authorization.

✓ Buffers are bounded.

✓ Oldest stale outgoing frame is dropped first.

✓ No retransmission.

✓ No replay.

✓ No speaker monitoring.

✓ Existing Host meter is the first consumer.

✓ Plaintext must never become production default.

---

# 21. Change Log

## 2026-07-13

Initial Development Interoperability Profile V0.
