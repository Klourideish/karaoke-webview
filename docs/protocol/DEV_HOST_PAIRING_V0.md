# Development Host Pairing V0

This document describes the Host implementation of
[`DEV_PAIRING_PROFILE_V0.md`](DEV_PAIRING_PROFILE_V0.md). It is an intentionally insecure local
development harness, not production pairing or authentication.

Accepted Platform and Host RFCs remain authoritative. Android proposes participant data; the Host
validates, commits, and projects the accepted result.

## Host Ownership

One Host-owned `DevelopmentPairingCoordinator` owns the active offer, its short-lived credentials,
claim binding, pending proposal, decision, bounded history, and diagnostics. Tauri commands and the
development control connection request operations from that coordinator; React never owns pairing
state or participant mutations.

The coordinator delegates accepted generic participant proposals to the existing
`ParticipantCommitCoordinator`. That atomic boundary creates the `SessionSinger`, selects or creates
the channel for the already connected network source, and creates the assignment. Pairing does not
mutate microphone registries directly. Later microphone changes continue through the existing
`MicrophoneSelectionCoordinator`.

## Offer Lifecycle

Development V0 permits one active offer. The default lifetime is 120 seconds, and retained terminal
records and idempotency results are bounded.

```text
created -> displayed -> claimed -> awaiting-participant-setup
        -> awaiting-operator-approval -> accepted | rejected
displayed or pending -> expired | cancelled
```

The QR pairing token is random, short-lived, and consumed by the first valid claim. A duplicate or
concurrent claim is rejected. After a valid claim, the Host issues a different random
`participantSetupToken`, bound to the offer, control connection, client device, and network source.
The setup token is invalidated by expiry, cancellation, or control loss.

## QR Payload

The Sync dialog encodes the exact serialized Host offer projection. It contains:

- profile version `0`;
- offer ID;
- Host display name;
- concrete LAN address and control port;
- single-use pairing token;
- expiry and lifetime;
- generic pairing scope.

The Host refuses to create a phone offer when the development listener is stopped or advertises
`127.0.0.1`, `0.0.0.0`, or another non-routable destination. The QR never contains singer, channel,
assignment, queue, or stream authority.

## Control Flow

The existing UTF-8 JSON-lines connection handles `pairing_claim` and
`participant_setup_proposal`. A successful claim receives `pairing_accepted_for_setup` with the
Host-issued setup token. A valid proposal becomes an immutable pending projection for operator
review.

Accept and Reject are Host operator decisions. Accept invokes the participant commit coordinator and
queues `participant_accepted` to the claimed connection. Reject queues `participant_rejected` and
leaves singer, channel, and assignment state unchanged. Request IDs make retries idempotent;
conflicting reuse is rejected.

Pairing acceptance does not authorize an audio stream or start capture. Existing explicit Android
Start and Host stream authorization rules remain separate.

When an accepted `SessionSinger` is removed, the same Host-owned removal operation clears the
pairing coordinator's accepted relationship, revokes the matching development stream authorization,
and queues `participant_revoked` to the connected participant. If a stream was active, the Host also
queues the existing `stream_stopped` outcome first. Repeated removal attempts do not produce
duplicate lifecycle messages.

## Sync UI

The singer-bar **Sync** action offers:

- **Connect phone**: create and display an insecure development QR, show expiry and claim progress,
  review the participant proposal, then Accept or Reject;
- **Use physical microphone**: retain the existing atomic physical onboarding flow.

Closing or cancelling a non-terminal phone flow invalidates its offer. Expired, cancelled, or
rejected flows can generate a fresh offer. No raw setup token or registry identifier is shown in the
normal operator UI.

## Diagnostics

The Developer workspace projects the active offer ID, lifecycle state, advertised endpoint, expiry,
claimed client, whether a setup token was issued, pending and accepted names, and bounded counters
for created, consumed, expired, cancelled, duplicate, invalid, accepted, and rejected activity.
Participant revocations and the last revoked participant are also projected for Developer testing.
Raw pairing and setup tokens are intentionally omitted.

## Synthetic Verification

1. Start the development listener on a specific reachable LAN address.
2. Open **Sync**, choose **Connect phone**, and read the serialized QR offer projection.
3. Send a valid `pairing_claim` over that same client's control connection.
4. Read `pairing_accepted_for_setup` and return its exact `participantSetupToken` in a valid
   `participant_setup_proposal`.
5. Confirm the Host shows the pending participant without creating a singer.
6. Accept and verify one singer, channel, and assignment appear through Host projections.
7. Repeat with Reject, expiry, cancellation, duplicate claim, wrong token, and abrupt disconnect;
   verify no participant mutation occurs.

The Rust pairing and development protocol tests provide the current synthetic client harness. This
does not establish physical Android interoperability.

## Security and Limitations

- plaintext local-network control traffic;
- QR token is not production authentication;
- no encryption, retained trust, replay-resistant production session, or internet pairing;
- one active development client and one active pairing offer;
- generic participant creation only;
- no queue mutation, persistence, or session resume;
- disabled unless the operator explicitly starts the insecure development listener.

Local-network observers may read or alter this traffic. Use it only on a trusted development network
and stop the listener when testing is complete.
