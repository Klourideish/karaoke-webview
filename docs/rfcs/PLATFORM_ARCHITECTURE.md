# Karaoke Webview Platform Architecture

This document is the entry point for the authoritative RFC tree.

```text
Karaoke Webview Platform
├── Platform RFCs
├── Windows Host RFCs
└── Android Companion RFCs
```

Platform RFCs define shared authority, vocabulary, lifecycle, resource contracts, and interoperability for every implementation surface.

Windows Host and Android Companion RFCs are sibling implementation namespaces beneath Platform. They extend Platform RFCs and must not redefine them.

RFC-P-008 is the accepted shared protocol and connection-state bridge between Host, Android, and future clients.

Future implementations may add their own namespace while extending Platform RFCs.

---

## Namespaces

- `platform/` - shared architectural truth for the whole Karaoke Webview platform.
- `host/` - Windows Host implementation architecture.
- `android/` - Android Companion implementation architecture.

---

## Current Platform RFCs

| Identifier | Title                                        | Status   |
| ---------- | -------------------------------------------- | -------- |
| RFC-P-001  | Platform Authority                           | Accepted |
| RFC-P-002  | Platform Domain Model                        | Accepted |
| RFC-P-003  | Performance Lifecycle                        | Accepted |
| RFC-P-004  | Karaoke Modes                                | Accepted |
| RFC-P-005  | Microphone Resource Model                    | Accepted |
| RFC-P-006  | Capture Session Model                        | Accepted |
| RFC-P-007  | Microphone Assignment & Channel Management   | Accepted |
| RFC-P-008  | Platform Protocol & Connection State Machine | Accepted |

---

## Namespace Rules

- Accepted Platform RFCs are authoritative for every implementation.
- Host and Android RFCs extend Platform RFCs.
- Host and Android RFCs never redefine Platform contracts.
- RFC identifiers are permanent within their namespace.
- Numbers are not reassigned based on implementation order.
- Accepted RFCs are not silently edited to change architectural meaning.
- Cross-namespace references must use the namespaced identifier.

---

## Reading Order

1. `platform/CORE_PLATFORM_RFCS.md`
2. `platform/RFC-P-001-platform-authority.md`
3. `platform/RFC-P-002-platform-domain-model.md`
4. `platform/RFC-P-003-performance-lifecycle.md`
5. `platform/RFC-P-004-karaoke-modes.md`
6. Topic-specific Platform RFCs
7. Relevant Host or Android RFCs

---

## Implementation Conflict Rule

If implementation conflicts with an Accepted RFC:

1. Stop implementation.
2. Report the conflict.
3. Request a Design Review.

Do not silently redesign accepted architecture during implementation.
