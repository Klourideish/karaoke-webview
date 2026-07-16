# Host Queue Authority

**Status:** P6-003 prototype

Accepted Platform and Host RFCs remain authoritative. This note records the current Host implementation boundary and does not replace the RFCs.

## Ownership

`HostQueueCoordinator` owns queue-entry identity, stable song and requester references, deterministic future ordering, votes, progression policy, immutable projections, serialized mutations, bounded idempotency, and its retained worker lifecycle.

Queue does not own Performance countdown, playback state, or song lookup. React requests typed mutations and renders projections; it does not generate queue IDs, select the next entry, run timers, or infer authoritative lifecycle changes.

## Queue And Performance Boundary

The progression flow is:

```text
Queue selects and locks the next entry
    -> Queue requests a new Host-owned Performance
    -> Queue links the entry to the returned PerformanceId
    -> Performance owns readiness, countdown, playback, results, and terminal state
    -> Queue observes the matching typed terminal outcome
    -> Queue advances according to queue policy
```

Queue creates Performance immediately. The Accepted three-second countdown belongs only to `HostPerformanceCoordinator`. Queue UI countdown and playing presentation are derived from the linked immutable Performance projection.

Queue defers Performance creation while Playback is already `starting`, `playing`, or `paused`. Direct diagnostic playback is likewise rejected while a nonterminal Performance owns the session. These admissions serialize through the Performance operation boundary so an unrelated song cannot remain active while Queue reports a different linked Performance.

Queue removes an entry after matching `completed` or `stopped`. A matching `failed` Performance leaves the entry available for retry, pauses automatic progression, and exposes a concise failure. Retry creates a new Performance ID for the same queue entry. Queue never advances directly from an audio completion event.

## Launch Serialization

Queue mutations and background progression share one operation boundary. Performance creation uses a two-phase launch token because the coordinator cannot hold the queue lock while calling another coordinator:

1. select and mark one entry with a unique launch token;
2. release Queue locks and create Performance through the authoritative Performance boundary;
3. reacquire Queue locks and confirm the entry, token, and progression state still match;
4. link only a current launch; cancel a superseded Performance through the authoritative Performance cancellation path.

Pause, remove, and skip supersede an in-flight launch. A late Performance is never attached to a stale queue entry. Failure to cancel a superseded Performance is surfaced in diagnostics and pauses progression.

## Ordering And Voting

Future entries have deterministic base order. Manual earlier/later actions update that order. One SessionSinger may cast one vote on a future entry. Votes may improve an entry by at most five positions from base order; insertion order breaks ties. Active and locked entries cannot be reordered or voted on.

Voter identities remain internal. Normal projections expose only vote totals. Requester names are resolved from the current authoritative SessionSinger projection, so renames do not leave copied display names stale.

## Singer References

Queue insertion, voting, and singer removal share the Queue operation boundary. Singer removal is rejected while that singer owns an active queue entry or has a vote that would otherwise become stale. Queue does not cascade singer deletion or silently remove votes.

## Idempotency And Errors

Mutations use bounded coordinator-local request-result records. An identical successful retry is recognized before current song or singer validation, preventing a later domain change from turning a previously accepted retry into a duplicate or failure. Conflicting reuse of a request ID returns a typed error.

Typed reason codes remain separate from operator messages. Normal projections omit mutable collections, voter IDs, and registry internals.

## Shutdown And Diagnostics

Host shutdown stops Queue before Performance. Queue signals and joins its retained worker. Worker panics and join failures are recorded, progression is paused, and diagnostics expose the failure without silently detaching work.

Developer diagnostics show progression, current entry and linked Performance, transition revision, idempotency counts, and the last safe failure. They do not expose an authoritative queue mutation surface.

## Manual Verification

1. Add a singer and queue several indexed songs from Library.
2. Confirm the first entry immediately creates a Performance and its three-second countdown appears from Performance.
3. Let playback complete and confirm Queue advances once after Performance reaches terminal state.
4. Pause progression during preparation or countdown, then resume and confirm a new Performance owns the fresh countdown.
5. Skip during preparation, countdown, and playback; confirm linked playback stops where applicable and Queue advances safely.
6. Trigger playback failure; confirm progression pauses and retry uses the same entry with a new Performance ID.
7. Vote and reorder future entries; confirm the five-position vote cap and locked-entry restrictions.
8. Try removing a singer who owns an active entry or vote; confirm safe rejection.
9. Reload the frontend and confirm no duplicate Performance or Queue worker is created.

## V0 Limitations

- Queue state is session-local and is not persisted across Host restart.
- Queue history is not retained or projected.
- Android queue interaction is not implemented.
- Drag-and-drop and advanced playlist behavior are out of scope.
