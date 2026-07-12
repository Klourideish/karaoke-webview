# RFC Namespace Migration

**Date:** 2026-07-12

This document records the migration from the original flat RFC namespace to Platform, Host, and Android RFC namespaces.

The migration preserves accepted architectural meaning. It changes canonical identifiers and file locations only.

Old identifiers are superseded.

New namespaced identifiers are permanent.

Git history preserves the previous documents.

No future implementation should reference old identifiers.

---

## Namespace Mapping

| Old identifier             | Old title                                  | New identifier | New title                                    | New canonical file                                               |
| -------------------------- | ------------------------------------------ | -------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| RFC-001                    | Host Authority                             | RFC-P-001      | Platform Authority                           | `platform/RFC-P-001-platform-authority.md`                       |
| RFC-002                    | Domain Model                               | RFC-P-002      | Platform Domain Model                        | `platform/RFC-P-002-platform-domain-model.md`                    |
| RFC-003                    | Performance Lifecycle                      | RFC-P-003      | Performance Lifecycle                        | `platform/RFC-P-003-performance-lifecycle.md`                    |
| RFC-004                    | Karaoke Modes                              | RFC-P-004      | Karaoke Modes                                | `platform/RFC-P-004-karaoke-modes.md`                            |
| RFC-007                    | Microphone Lifecycle                       | RFC-P-005      | Microphone Resource Model                    | `platform/RFC-P-005-microphone-resource-model.md`                |
| RFC-008                    | Capture Sessions                           | RFC-P-006      | Capture Session Model                        | `platform/RFC-P-006-capture-session-model.md`                    |
| RFC-013                    | Microphone Assignment & Channel Management | RFC-P-007      | Microphone Assignment & Channel Management   | `platform/RFC-P-007-microphone-assignment-channel-management.md` |
| planned RFC-009            | Protocol & Connection State Machine        | RFC-P-008      | Platform Protocol & Connection State Machine | `platform/RFC-P-008-protocol-connection-state-machine.md`        |
| reserved RFC-010           | Scoring Pipeline                           | RFC-P-009      | Scoring Pipeline                             | reserved                                                         |
| reserved RFC-011           | Battle Performance Coordination            | RFC-P-010      | Battle Performance Coordination              | reserved                                                         |
| reserved RFC-012           | Recording & Media Capture                  | RFC-P-011      | Recording & Media Capture                    | reserved                                                         |
| previous RFC-005 reference | Profile & Identity                         | RFC-P-012      | Profile & Identity                           | reserved                                                         |
| previous RFC-006 reference | History & Leaderboards                     | RFC-P-013      | History & Leaderboards                       | reserved                                                         |

---

## Canonical Tree

Canonical RFC documents now live under:

- `platform/`
- `host/`
- `android/`

The root `docs/rfcs/` directory contains indexes, migration notes, and namespace-level governance only.

---

## Stability Rules

- Old flat identifiers are historical aliases only.
- New implementation prompts should reference namespaced identifiers.
- New RFCs must use the appropriate namespace prefix.
- Namespace numbers are stable and not reassigned based on implementation order.
- Accepted RFCs remain authoritative after migration.
- Superseding an RFC requires a Design Review; moving it between namespaces does not supersede it by itself.

---

## Classification Notes

- `RFC-P-001` is named Platform Authority because it defines platform-level authority for the ecosystem: the Windows host owns authoritative state and external clients remain lightweight requesters.
- `RFC-P-005` is named Microphone Resource Model because it defines microphone sources, channels, assignments, and resource lifecycle independently of a specific Windows API.
- `RFC-P-006` is named Capture Session Model because it defines capture-session ownership independent of any specific capture backend.
- Host-specific and Android-specific guidance should be added in `host/` or `android/` RFCs only when it extends Platform RFCs without changing their accepted decisions.

---

## Non-Goals

This migration does not:

- change accepted architectural decisions;
- implement networking, Android, scoring, recording, or database behavior;
- create Host or Android architecture beyond namespace templates;
- preserve duplicate canonical copies of migrated RFCs in the root directory.
