# Host Microphone Selection Transaction

**Status:** Implemented session-local foundation

Accepted Platform and Host RFCs remain authoritative. This note records the current Host implementation boundary and does not replace those RFCs.

## Purpose

The operator-facing microphone selector expresses one intent: choose or clear a singer's microphone. React sends that intent through `select_singer_microphone`; it does not sequence channel and assignment mutations.

```text
React selection intent
    ↓
Typed Tauri command
    ↓
MicrophoneSelectionCoordinator
    ↓
Host registries
    ↓
Immutable selection projection
```

## Request And Result

Each request contains:

- a caller-generated request ID;
- the Host-owned SessionSinger ID;
- the desired MicrophoneSource ID, or `null` to clear the selection.

The immutable result identifies the singer, assigned or cleared status, retained or selected channel, resulting assignment, and friendly source name. Registry internals remain Host-owned.

## Transaction Policy

The coordinator serializes its operations and then enters the shared microphone registry operation boundary. Its stable order is:

1. validate request identity and SessionSinger membership;
2. reconcile and validate source availability and ownership;
3. preserve and replace an assigned singer's existing channel source, or reuse/create an eligible channel for an unassigned singer;
4. create or clear the assignment;
5. update successful session-local source preference and recovery projections;
6. return an immutable result.

Clearing removes the assignment but preserves its channel as a reusable Host resource. Network and local sources follow the same Platform source/channel rules. Selection does not authorize network audio or start a CaptureSession.

## Rollback

All feasible validation runs before mutation. The coordinator records transaction-created or replaced state:

- a failed new assignment removes only the exact transaction assignment;
- a transaction-created channel is removed only if it remains unassigned and still matches;
- a failed source replacement restores the exact pre-transaction channel;
- pre-existing singers, unrelated channels, assignments, and sources are untouched.

Registry locks remain short-lived and are not nested. The coordinator lock and shared microphone operation lock provide deterministic serialization.

## Idempotency

Successful results are retained in a bounded in-memory cache of 128 request IDs:

- an identical retry returns the original authoritative result;
- reuse of a request ID for a different singer or source is rejected;
- failures may be retried with the same request ID;
- no idempotency state persists across application restart.

## Frontend Boundary

The Microphones workspace keeps only temporary selector and pending/error presentation state. One dropdown change issues one mutation command. After success, existing hooks refresh immutable Host projections. Failed requests leave the currently projected selection visible and retain the request ID for a safe retry.

Low-level channel, recovery, automatic-assignment, and diagnostic commands remain available for their existing focused workflows. They are no longer composed by React to implement normal microphone selection.

## Manual Verification

1. Assign an available local microphone to an unassigned singer.
2. Change that singer to another available microphone and confirm the channel identity remains stable in Developer diagnostics.
3. Clear the microphone and confirm the channel remains available while the assignment disappears.
4. Assign a healthy development network source and confirm no stream authorization starts.
5. Attempt an unavailable or already claimed source and confirm the previous selection remains intact.
6. Retry the failed selection and confirm no duplicate channel or assignment appears.

## Limitations

- State and idempotency are session-local and in memory.
- Performance-time reassignment restrictions remain governed by the existing readiness/lifecycle boundaries; this coordinator does not introduce Performance orchestration.
- Pairing and Android participant setup are not implemented here.
