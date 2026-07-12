# Request For Comments (RFC)

RFCs are the authoritative architectural decisions for Karaoke Webview.

They describe how the system is intended to behave, not how it is implemented.

Rust, TypeScript, React, Android, protocol, scoring, recording, and future implementations must follow accepted RFCs.

---

## Namespaces

Karaoke Webview uses three RFC namespaces:

- `platform/` - cross-surface architectural rules for the whole Karaoke Webview platform.
- `host/` - Windows Host architecture that extends Platform RFCs.
- `android/` - Android Companion architecture that extends Platform RFCs.

The root `docs/rfcs/` directory contains indexes, migration notes, and governance documents only.

---

## Core Indexes

- `platform/CORE_PLATFORM_RFCS.md` - accepted shared Platform RFCs.
- `host/CORE_HOST_RFCS.md` - accepted Windows Host RFCs.
- `android/CORE_ANDROID_RFCS.md` - accepted Android Companion RFCs.

Empty Host or Android indexes are intentional until implementation-specific RFCs are accepted.

---

## Lifecycle

Design Review

Draft RFC

Discussion

Accepted RFC

Implementation

Validation

Commit

---

## Status

- Draft
- Accepted
- Superseded
- Deprecated
- Reserved

---

## Rules

Accepted RFCs are authoritative.

Platform RFCs override Host and Android RFCs when conflicts exist.

Host and Android RFCs extend Platform RFCs and never redefine Platform contracts.

Implementation must not silently violate an accepted RFC.

If implementation reveals an architectural conflict:

1. Stop implementation.
2. Report the conflict.
3. Request a new Design Review.

Do not redesign accepted architecture during implementation.

---

## Scope

RFCs define architecture.

They do not define implementation details, UI styling, Rust APIs, React components, Android APIs, packet formats, or database schemas unless those are themselves the architectural decision.

---

## Naming

Platform RFCs use:

```text
RFC-P-<three-digit-number>-<short-kebab-case-title>.md
```

Host RFCs use:

```text
RFC-H-<three-digit-number>-<short-kebab-case-title>.md
```

Android RFCs use:

```text
RFC-A-<three-digit-number>-<short-kebab-case-title>.md
```

Numbers are never reused inside a namespace.

Old flat `RFC-###` identifiers are historical aliases only. See `RFC_NAMESPACE_MIGRATION.md`.

---

## Templates

Use the namespace-specific templates:

- `platform/RFC-P-TEMPLATE.md`
- `host/RFC-H-TEMPLATE.md`
- `android/RFC-A-TEMPLATE.md`

---

## Reading Order

For contributors new to the project, the recommended reading order is:

1. `PLATFORM_ARCHITECTURE.md`
2. `platform/CORE_PLATFORM_RFCS.md`
3. `platform/RFC-P-001-platform-authority.md`
4. `platform/RFC-P-002-platform-domain-model.md`
5. `platform/RFC-P-003-performance-lifecycle.md`
6. `platform/RFC-P-004-karaoke-modes.md`
7. Topic-specific Platform RFCs
8. Relevant Host or Android RFCs

---

## Migration

The project migrated from the original flat RFC namespace to Platform, Host, and Android namespaces on 2026-07-12.

The migration preserves accepted architectural meaning.

See `RFC_NAMESPACE_MIGRATION.md` for the full mapping.
