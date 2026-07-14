# Development Host Receiver V0

This document describes the Windows Host side of the insecure Development Interoperability Profile V0.

It is not the production Platform protocol.

## Security

The development receiver is an intentionally insecure plaintext harness.

Use it only on trusted development networks or loopback.

It does not provide pairing, authentication, encryption, replay protection, retained trust, or production reconnect semantics.

## Enabling

Open the Developer workspace and use the **Start Listener** button in the **Network microphone receiver** section.

The listener is not started automatically on application startup.

Default endpoints:

- TCP control: `127.0.0.1:45820`
- UDP audio: `127.0.0.1:45821`

The bind address and ports are configurable through the Host command boundary for development tests. The default UI action starts the listener on loopback. Synthetic tests or development tooling may call `start_development_protocol_listener` with an explicit request such as:

```json
{
  "request": {
    "bindAddress": "0.0.0.0",
    "tcpPort": 45820,
    "udpPort": 45821
  }
}
```

Use `127.0.0.1` for local-only tests. Use a LAN interface address or `0.0.0.0` only when intentionally testing from another device on a trusted development network.

A Windows firewall prompt may appear if the listener is configured to bind beyond loopback.

## Synthetic Sender Shape

Synthetic tests should send:

- JSON-lines TCP control messages from `DEV_INTEROP_PROFILE_V0.md`;
- 1,000-byte UDP datagrams;
- `KWAV` magic;
- profile version `0`;
- 40-byte little-endian header;
- stream ID assigned by the Host;
- monotonically increasing sequence number;
- 480 mono PCM16 little-endian samples.

Useful test streams:

- silence;
- deterministic sine or constant samples;
- clipping samples;
- duplicate packets;
- sequence gaps;
- out-of-order packets;
- malformed datagrams;
- abrupt control disconnect.

## Diagnostics

The Developer workspace shows:

- listener state;
- bound TCP and UDP ports;
- connected development client name;
- network source ID;
- stream authorization;
- source health;
- packet counters;
- jitter queue depth;
- capture handoff queue depth, maximum depth, and dropped stale frames;
- sequence gaps.

The existing diagnostic CaptureSession meter consumes valid network PCM through the Host capture boundary.

The V0 capture handoff holds at most four 10 ms frames (40 ms). When a stalled consumer fills it, the Host drops the oldest queued frame before accepting the newest frame. This prevents unbounded memory and latency growth and never replays stale audio. Stream stop, connection loss, listener stop, and CaptureSession stop clear the queue.

`stop_stream` succeeds only when its `audioStreamId` matches the active stream. A stale ID receives `audio-stream-id-mismatch` without stopping a newer stream; a request with no active stream receives `stream-not-active`.

Raw PCM remains in Rust and is never projected to React.

## Shutdown

Use **Stop Listener** to revoke stream authorization, remove the development network source projection, stop socket workers, and return the diagnostic meter to idle.

Stopping the listener does not delete user media, singer state, channels, or assignments.

## Known V0 Limitations

- one development client;
- one active stream;
- plaintext control and audio;
- no Android production pairing;
- no QR code;
- no mDNS;
- no TLS;
- no encrypted UDP;
- no session resume;
- no scoring;
- no recording;
- no speaker monitoring.
