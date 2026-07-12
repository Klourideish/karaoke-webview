# Karaoke Webview Core Architecture

This document identifies the four foundational RFCs that define the core architecture of Karaoke Webview.

Every subsequent RFC extends these foundations rather than replacing them.

---

## RFC-001 — Host Authority

**Question:** Who owns the system?

Defines the authoritative ownership model for the entire application.

---

## RFC-002 — Domain Model

**Question:** What are the core concepts?

Defines the shared vocabulary used throughout the project.

---

## RFC-003 — Performance Lifecycle

**Question:** How does a performance progress?

Defines the authoritative lifecycle of a karaoke performance.

---

## RFC-004 — Karaoke Modes

**Question:** When do different operational rules apply?

Defines the supported operational modes and how they extend the shared lifecycle.

---

## Architectural Foundation

Together these four RFCs establish the architectural foundation of Karaoke Webview.

Future RFCs are expected to extend these documents rather than redefine them.

Changes to these Core RFCs should be rare and should only occur following a successful Design Review.

## Reserved RFC Numbers

The following RFC numbers are intentionally reserved for future architectural work:

- RFC-009 – Protocol & Connection State Machine
- RFC-010 – Scoring Pipeline
- RFC-011 – Battle Performance Coordination
- RFC-012 – Recording & Media Capture

RFC numbers are stable architectural identifiers and are not reassigned based on implementation order.
