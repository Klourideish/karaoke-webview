# Host SessionSinger Authority

**Status:** Implemented session-local foundation

Accepted Platform and Host RFCs remain authoritative. This document records the current Host implementation boundary; it does not replace those RFCs.

## Why Host Ownership Is Required

`SessionSinger` is authoritative karaoke-session state. React may request singer changes and render immutable projections, but it cannot create identities or commit membership locally. Host ownership keeps singer identity stable across UI remounts and gives cross-registry workflows one deterministic execution boundary.

```text
React intent
    ↓
Typed Tauri command
    ↓
Host registry or coordinator
    ↓
Immutable SessionSinger projection
    ↓
React presentation
```

## Registry Scope

`SessionSingerRegistry` owns session-local:

- opaque Host-generated singer IDs;
- normalized display names;
- creation order;
- current session membership.

The registry does not own profiles, queue state, microphone assignments, scores, history, or persistence. Duplicate display names are allowed because display names are metadata, not identity.

Names are trimmed, repeated whitespace is collapsed, control characters are rejected, and the normalized name is limited to 40 Unicode scalar values.

## Frontend Boundary

The frontend loads singer projections with `list_session_singers` and requests create, rename, and remove operations through typed commands. It does not generate singer IDs and does not publish singer membership back to Rust.

The previous `sync_session_singers` authority path has been removed. Microphone commands validate singer references against `SessionSingerRegistry`.

## Removal Policy

Removal is rejected with `singer-in-use` while the singer has a microphone assignment or an explicit waiting-for-microphone state. Removal does not cascade into other registries. Queue, active Performance, and history references are not implemented yet; their future authoritative registries must participate in this validation before singer removal can cover those relationships.

## Participant Commit Coordinator

`ParticipantCommitCoordinator` supports two session-local operations:

- create a new singer and assign an existing eligible microphone source;
- assign an existing eligible source to an existing singer.

The coordinator serializes its own operations and then enters the existing microphone operation boundary. The stable order is:

1. validate request, singer/name, source, channel claim, and assignment eligibility;
2. create the singer when requested;
3. reuse an eligible channel or create one on demand;
4. create the assignment;
5. return an immutable result projection.

Registry locks are acquired only for individual typed operations. The coordinator does not hold one registry lock while acquiring another.

## Rollback

The coordinator records resources created by the current operation. On failure it reverses mutations in this order:

1. remove the exact assignment created by the operation;
2. remove the exact newly created channel if it remains unassigned;
3. remove the newly created singer.

Pre-existing channels, sources, singers, and assignments are never removed by rollback.

## Idempotency

Participant commits require a caller-provided request ID. The coordinator keeps a bounded in-memory cache of 128 successful results:

- an identical retry returns the prior authoritative projection;
- a conflicting reuse of the same request ID is rejected;
- no state is persisted across application restart.

This is intentionally focused infrastructure for physical microphone setup and future development pairing, not a general distributed transaction system.

## Relationship To P5-002

Future pairing may submit a validated participant proposal to this coordinator. Pairing remains responsible for offer, claim, setup-token, connection, and policy validation. The participant coordinator remains responsible only for the authoritative singer/source/channel/assignment commit.

Normal microphone changes for an existing singer use the separate Host-owned transaction documented in [HOST_MICROPHONE_SELECTION_TRANSACTION.md](HOST_MICROPHONE_SELECTION_TRANSACTION.md).

## Host Sync Verification Path

The singer bar exposes a Sync dialog for physical microphone onboarding. Microphone selection, name
entry, Back, and Cancel are presentation-only. Final confirmation sends one
`create_session_singer_with_microphone` request with a stable operation ID; React neither creates a
singer ID nor sequences registry mutations.

The coordinator publishes one immutable diagnostic snapshot for Developer tooling. It reports the
last request, safe success or failure details, and whether rollback ran. It does not expose mutable
registries or rollback internals. This gives participant commits an explicit manual verification path
before development QR pairing is added.

## Known Limitations

- Session singers are in-memory and reset on application restart.
- The Host currently seeds four default session singers to preserve the existing operator experience.
- Queue, Performance, profile, and history ownership are not implemented here.
- No QR pairing, retained identity, or Android behavior is included.
- The Connect phone choice is intentionally disabled until P5-002.
