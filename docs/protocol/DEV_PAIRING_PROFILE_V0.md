# Development Pairing Profile V0

**Status:** Development Only

**Created:** 2026-07-14

**Last Updated:** 2026-07-14

**Security:** INSECURE DEVELOPMENT HARNESS

---

> **Warning**
>
> This profile is an intentionally temporary plaintext development contract for QR-based Android
> pairing and participant self-setup.
>
> It is not production authentication.
>
> Production trust, encryption, replay protection, retained identity, and credential handling remain
> future work governed by Accepted RFCs.

---

# 1. Purpose

This document defines the temporary shared development contract for:

```text
Host pairing offer
        ↓
Android QR scan
        ↓
Android participant proposal
        ↓
Host validation and commit
        ↓
Android read-only participant projection
```

The central rule is:

```text
Android proposes. Host validates and commits. Android reflects the accepted result.
```

This profile exists so Host and Android agents can independently implement compatible development
pairing and participant setup without inventing extra protocol semantics.

---

# 2. Governing Authority

Accepted RFCs remain authoritative.

This profile is subordinate to:

- RFC-P-001 - Platform Authority
- RFC-P-002 - Platform Domain Model
- RFC-P-005 - Microphone Resource Model
- RFC-P-007 - Microphone Assignment & Channel Management
- RFC-P-008 - Platform Protocol & Connection State Machine
- RFC-A-001 - Android Client Authority & Boundaries

Where this development profile conflicts with an Accepted RFC, the Accepted RFC wins.

This profile is also compatible with the plaintext development exception described by RFC-P-008. It
does not relax production protocol security requirements.

---

# 3. Development-Only Status

Development Pairing Profile V0 is temporary and insecure.

It intentionally does not provide:

- production authentication;
- encrypted control traffic;
- retained trust;
- replay protection;
- permanent credentials;
- durable participant authority;
- production QR security.

The QR token is a short-lived development proof used to claim one offer. It must not be represented
as production security.

The insecure development listener remains disabled by default in production builds where build
configuration allows that distinction.

---

# 4. Identity Distinctions

These identities are distinct:

- `PairingOfferId`
- `PairingToken`
- `LocalParticipantProfileId`
- `ClientDeviceId`
- `ClientConnectionId`
- `ProtocolSessionId`
- `NetworkMicrophoneSourceId`
- `SessionSingerId`
- `MicrophoneChannelId`
- `MicrophoneAssignmentId`
- `AudioStreamId`

Android may remember local hints. Android does not own Host-domain identity.

Display names are not identities.

Pairing identity is not singer identity.

Connection identity is not stream authorization.

Stream authorization is not microphone assignment.

---

# 5. Pairing Offer

The Host creates a short-lived pairing offer.

Conceptual offer shape:

```json
{
  "profileVersion": 0,
  "offerId": "pairing-offer-opaque-host-id",
  "hostDisplayName": "Karaoke Host",
  "hostAddress": "192.168.1.78",
  "controlPort": 45820,
  "pairingToken": "random-single-use-token",
  "expiresAt": "2026-07-14T20:30:00Z",
  "pairingScope": {
    "kind": "generic"
  }
}
```

Singer-targeted offer shape:

```json
{
  "profileVersion": 0,
  "offerId": "pairing-offer-opaque-host-id",
  "hostDisplayName": "Karaoke Host",
  "hostAddress": "192.168.1.78",
  "controlPort": 45820,
  "pairingToken": "random-single-use-token",
  "expiresAt": "2026-07-14T20:30:00Z",
  "pairingScope": {
    "kind": "singer-targeted",
    "sessionSingerId": "host-owned-session-singer-id"
  }
}
```

The QR payload must not contain:

- permanent credentials;
- `SessionSinger` authority;
- microphone assignment authority;
- stream authorization;
- reusable secrets;
- queue mutation authority.

The `sessionSingerId` in a singer-targeted offer scopes the Host decision. It does not grant Android
authority over that singer.

---

# 6. Offer Lifecycle

Development offers use this lifecycle:

```text
created
→ displayed
→ claimed
→ awaiting-participant-setup
→ accepted
```

Terminal alternatives:

```text
rejected
expired
cancelled
```

## Rules

- The QR pairing token is random.
- The QR pairing token is single-use.
- The QR pairing token is consumed by the initial `pairing_claim`.
- The Host issues a separate `participantSetupToken` only after accepting the claim.
- The setup token is bound to the claimed connection, client device, and offer.
- The setup token expires with the pending participant setup.
- The setup token is consumed when the participant proposal is accepted or rejected.
- The setup token grants no singer, source, channel, assignment, queue, or stream authority.
- The offer is short-lived.
- The Host may cancel the offer.
- Expired offers cannot be reused.
- Cancelled offers cannot be reused.
- Duplicate claims are rejected.
- Accepted offers cannot be claimed again.
- Rejected offers cannot be converted into accepted offers without a new proposal or offer.
- The Host remains authoritative for every transition.

---

# 7. Android Local Profile

Android may persist:

- `localParticipantProfileId`;
- `preferredDisplayName`;
- optional local presentation preferences;
- prior Host-issued participant reference as a hint.

Android must not persist or own:

- `SessionSinger` authority;
- queue state;
- microphone assignment state;
- stream authorization;
- Host mutation rights;
- official score or history authority.

`localParticipantProfileId` is Android-local. It helps the Android UI remember the person using that
installation, but it does not identify a Host `SessionSinger`.

---

# 8. Participant Proposal

After a pairing claim is accepted for setup, Android sends a participant proposal using the
Host-issued `participantSetupToken`.

Conceptual shape:

```json
{
  "type": "participant_setup_proposal",
  "profileVersion": 0,
  "requestId": "new-android-request-id",
  "offerId": "pairing-offer-opaque-host-id",
  "participantSetupToken": "host-issued-short-lived-token",
  "clientDeviceId": "android-local-device-id",
  "localParticipantProfileId": "android-local-profile-id",
  "preferredDisplayName": "Kyle",
  "previousHostParticipantReference": "optional-host-issued-hint"
}
```

This message is a proposal, not a create-singer command.

Android must not assume that the proposed display name, previous reference, client device, microphone
source, channel, or assignment has been accepted until the Host replies.

---

# 9. Host Validation

The Host validates:

- offer existence;
- offer state;
- offer expiry;
- single-use claim state;
- participant setup token validity;
- participant setup token binding;
- participant setup token expiry;
- profile version;
- client device eligibility;
- source eligibility;
- display-name length;
- whitespace normalization;
- control characters;
- duplicate-name policy;
- session capacity;
- self-registration mode;
- operator approval policy.

Validation produces stable reason codes separately from human-facing messages.

Suggested rejection reason codes:

- `unsupported-profile-version`
- `offer-not-found`
- `offer-expired`
- `offer-cancelled`
- `offer-already-claimed`
- `offer-already-used`
- `invalid-token`
- `invalid-participant-setup-token`
- `invalid-display-name`
- `display-name-too-long`
- `display-name-empty`
- `display-name-control-characters`
- `duplicate-display-name-not-allowed`
- `session-capacity-reached`
- `self-registration-disabled`
- `operator-approval-required`
- `client-device-rejected`
- `network-source-ineligible`
- `target-singer-not-found`
- `target-singer-already-linked`
- `policy-rejected`
- `internal-error`

Exact human text may vary by implementation. Reason codes are the compatibility contract.

---

# 10. Host Acceptance

On acceptance, the Host may:

- create a new `SessionSinger`;
- resume or associate an existing `SessionSinger`;
- accept the proposed display name;
- normalize the proposed display name;
- register or associate a `NetworkMicrophoneSource`;
- create or select a Host-owned `MicrophoneChannel` where policy permits;
- create the Host-owned `MicrophoneAssignment` where policy permits;
- return a read-only participant projection.

Android does not perform these mutations.

The Host may also accept the participant without assigning a microphone if policy, capacity, source
health, or operator approval requires that outcome. The projection must make the resulting microphone
state clear.

---

# 11. Accepted Participant Projection

The Host returns a minimal read-only projection.

Conceptual shape:

```json
{
  "type": "participant_accepted",
  "profileVersion": 0,
  "requestId": "android-request-id",
  "status": "accepted",
  "hostDisplayName": "Karaoke Host",
  "sessionSingerId": "host-owned-session-singer-id",
  "acceptedDisplayName": "Kyle",
  "microphone": {
    "state": "ready",
    "message": "Microphone ready."
  },
  "queuedSongCount": 0,
  "nextUp": {
    "state": "not-next"
  }
}
```

The projection should avoid exposing internal channel IDs, assignment IDs, or mutable Host-domain
objects unless a future wire contract requires them.

Suggested microphone states:

- `unassigned`
- `waiting`
- `ready`
- `needs-attention`
- `disconnected`

Suggested next-up states:

- `unknown`
- `not-next`
- `next`
- `current`

Queued-song count and next-up state are optional and future-compatible in V0.

---

# 12. Generic Pairing Flow

```text
Host opens Sync
→ Host creates generic pairing offer
→ Host displays QR payload
→ Android scans QR payload
→ Android connects to Host control endpoint
→ Android claims offer
→ Host validates offer and token
→ Host accepts claim for participant setup
→ Android confirms or enters preferred display name
→ Android submits participant proposal
→ Host validates proposal and policy
→ Host creates or resumes participant state
→ Host returns accepted projection
→ Singer appears in the Host singer bar
```

If validation fails, the Host returns a typed rejection. Android displays the rejection as a Host
decision.

---

# 13. Singer-Targeted Pairing Flow

```text
Host initiates pairing from an existing singer
→ Host creates singer-targeted pairing offer
→ Host displays QR payload
→ Android scans QR payload
→ Android connects to Host control endpoint
→ Android claims offer
→ Host validates offer, token, and target singer
→ Android confirms local profile
→ Android submits participant proposal
→ Host decides whether to associate the client with that singer
→ Host returns accepted or rejected projection
```

Singer-targeted pairing does not transfer mutation authority to Android.

The Host may reject the proposal if the target singer no longer exists, has become ineligible, is
already linked under a conflicting policy, or requires operator approval.

---

# 14. Physical Microphone Flow

The Sync modal may also offer physical microphone setup.

Baseline Host UI flow:

```text
Operator opens Sync
→ Operator chooses physical microphone setup
→ Operator selects a microphone
→ No mutation occurs yet
→ Operator clicks Next
→ Operator enters or confirms singer name
→ Host applies singer and assignment mutations
```

This is a Host UI flow, not a QR wire-message flow.

Selecting a microphone in the modal does not mutate Host state until the operator confirms the final
setup action.

---

# 15. Capture And Stream Authorization

Pairing does not start microphone capture.

Rules:

- Android still requires explicit local Start.
- Host still authorizes streaming.
- Pairing success and stream authorization are distinct.
- Control loss behavior remains governed by the active protocol profile.
- Android must not buffer disconnected or unauthorized audio for later replay.
- No audio captured before authorization may be transmitted as backlog.

Accepted participant setup may make a network source eligible for assignment. It does not authorize
audio packets by itself.

---

# 16. Returning-User Flow

Android may offer:

- cached preferred display name;
- prior Host participant reference;
- local presentation preferences.

The prior Host participant reference is only a hint.

The Host may:

- resume the referenced participant;
- create a new `SessionSinger`;
- reject the proposal;
- request clarification;
- normalize the display name;
- require operator approval.

Stale references grant no authority.

---

# 17. Operator Policy

The Host reserves these self-registration policy modes:

- `self-registration-automatic`
- `host-approval-required`
- `self-registration-disabled`

The initial development implementation may choose one explicit mode.

Regardless of mode, Android remains a requester and the Host remains authoritative.

---

# 18. JSON-Lines Control Transport

Development Pairing Profile V0 uses the same development control transport shape as the current
development interoperability profile unless superseded by a future profile:

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

Malformed JSON must not crash either process.

Unknown message types must produce a typed development error.

---

# 19. Message Catalogue

## 19.1 Pairing Offer Projection

Host-local or Host-to-UI projection. It may be used to render a QR code.

```json
{
  "type": "pairing_offer_projection",
  "profileVersion": 0,
  "offerId": "pairing-offer-opaque-host-id",
  "hostDisplayName": "Karaoke Host",
  "hostAddress": "192.168.1.78",
  "controlPort": 45820,
  "pairingToken": "random-single-use-token",
  "expiresAt": "2026-07-14T20:30:00Z",
  "lifetimeSeconds": 120,
  "pairingScope": {
    "kind": "generic"
  }
}
```

## 19.2 Pairing Claim

Android to Host.

```json
{
  "type": "pairing_claim",
  "profileVersion": 0,
  "requestId": "android-request-id",
  "offerId": "pairing-offer-opaque-host-id",
  "pairingToken": "random-single-use-token",
  "clientDeviceId": "android-local-device-id",
  "clientName": "Kyle's Phone"
}
```

## 19.3 Pairing Accepted For Setup

Host to Android.

```json
{
  "type": "pairing_accepted_for_setup",
  "profileVersion": 0,
  "requestId": "android-request-id",
  "offerId": "pairing-offer-opaque-host-id",
  "participantSetupToken": "host-issued-short-lived-token",
  "hostDisplayName": "Karaoke Host",
  "pairingScope": {
    "kind": "generic"
  },
  "participantSetupRequired": true
}
```

## 19.4 Participant Setup Proposal

Android to Host.

```json
{
  "type": "participant_setup_proposal",
  "profileVersion": 0,
  "requestId": "new-android-request-id",
  "offerId": "pairing-offer-opaque-host-id",
  "participantSetupToken": "host-issued-short-lived-token",
  "clientDeviceId": "android-local-device-id",
  "localParticipantProfileId": "android-local-profile-id",
  "preferredDisplayName": "Kyle",
  "previousHostParticipantReference": "optional-host-issued-hint"
}
```

## 19.5 Participant Accepted

Host to Android.

```json
{
  "type": "participant_accepted",
  "profileVersion": 0,
  "requestId": "android-request-id",
  "status": "accepted",
  "hostDisplayName": "Karaoke Host",
  "sessionSingerId": "host-owned-session-singer-id",
  "acceptedDisplayName": "Kyle",
  "microphone": {
    "state": "ready",
    "message": "Microphone ready."
  },
  "queuedSongCount": 0,
  "nextUp": {
    "state": "not-next"
  }
}
```

## 19.6 Participant Rejected

Host to Android.

```json
{
  "type": "participant_rejected",
  "profileVersion": 0,
  "requestId": "android-request-id",
  "status": "rejected",
  "reasonCode": "operator-approval-required",
  "message": "The Host operator must approve this participant."
}
```

## 19.7 Offer Expired

Host to Android or Host-local projection.

```json
{
  "type": "pairing_offer_expired",
  "profileVersion": 0,
  "offerId": "pairing-offer-opaque-host-id",
  "reasonCode": "offer-expired",
  "message": "This pairing code expired."
}
```

## 19.8 Offer Cancelled

Host to Android or Host-local projection.

```json
{
  "type": "pairing_offer_cancelled",
  "profileVersion": 0,
  "offerId": "pairing-offer-opaque-host-id",
  "reasonCode": "offer-cancelled",
  "message": "The Host cancelled this pairing code."
}
```

## 19.9 Development Error

Either side may send a typed development error.

```json
{
  "type": "development_pairing_error",
  "profileVersion": 0,
  "requestId": "optional-correlated-request-id",
  "reasonCode": "malformed-json",
  "message": "The message could not be parsed."
}
```

Suggested development error reason codes:

- `malformed-json`
- `unknown-message-type`
- `unsupported-profile-version`
- `missing-required-field`
- `invalid-field`
- `invalid-state`
- `policy-rejected`
- `internal-error`

---

# 20. Security Warning

Development Pairing Profile V0 is plaintext.

Local-network observers may see:

- Host address;
- control port;
- pairing token;
- participant setup token;
- display names;
- client device IDs;
- participant proposals;
- accepted projections.

The QR token is not production security.

The profile exchanges no permanent credentials.

This profile must not be enabled silently as production functionality.

---

# 21. Acceptance Criteria

This profile is complete when Host and Android agents can independently implement:

- QR payload parsing;
- single-use offer claim;
- duplicate-claim rejection;
- Host-issued participant setup token handoff;
- participant setup proposal;
- Host validation;
- stable rejection reason codes;
- accepted participant projection;
- expiry and cancellation;
- returning local profile hints;
- clear distinction between pairing, participant setup, assignment, and stream authorization.

No implementation should need to invent additional protocol semantics to complete this V0 flow.

---

# 22. Out Of Scope

This profile intentionally does not define:

- production cryptography;
- retained trust;
- replay protection;
- QR rendering libraries;
- Android UI implementation;
- Host UI implementation;
- queue mutation from Android;
- song search from Android;
- scoring;
- recording;
- multiple simultaneous pairing claims;
- internet pairing;
- cloud relay;
- mDNS;
- TLS;
- encrypted UDP.

---

# 23. Quick Reference

✓ Development only.

✓ QR payload is short-lived and single-use.

✓ QR token is not production authentication.

✓ Android may persist local profile hints.

✓ Android does not own Host `SessionSinger`.

✓ Android sends participant proposals.

✓ Host validates and commits.

✓ Host may create or resume session singer state.

✓ Host owns source, channel, and assignment mutations.

✓ Android receives a read-only projection.

✓ Pairing does not start capture.

✓ Pairing does not authorize streaming.

✓ Returning-user references are hints only.

✓ Production security remains future work.

---

# 24. Change Log

## 2026-07-14

Initial Development Pairing Profile V0.
