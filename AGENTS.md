# Karaoke Webview Repository Engineering Guide

Version: 2.0

This document defines the engineering philosophy of the Karaoke Webview repository.

Treat this guide with the same respect as architecture documentation.

Engineering principles should evolve only when the repository has demonstrably learned a better way to build software.

This document defines the engineering philosophy, architecture principles, and development methodology for the Karaoke Webview repository.

It is the authoritative engineering guide for all contributors, whether human or AI-assisted.

The purpose of this guide is not simply to define coding standards. It exists to preserve the engineering culture of the repository, reduce uncertainty during development, and ensure every implementation strengthens the platform over time.

This repository values deliberate engineering over rapid iteration.

Build deliberately.

Verify thoroughly.

Respect established architecture.

Leave the repository stronger than you found it.

---

# 1. Purpose

Karaoke Webview is a Host-authoritative karaoke platform.

The platform consists of two primary applications that work together through clearly defined responsibilities.

## Host

The Host application owns application authority.

It is responsible for:

- media library management;
- playback;
- performances;
- queues;
- participants;
- microphones;
- session singers;
- protocol authority;
- application state;
- diagnostics.

The Host is the single source of truth.

## Android

The Android application is a participant client.

It is responsible for:

- participant interaction;
- microphone capture;
- presentation;
- communication with the Host through the development protocol.

Android does not become authoritative.

It reflects Host authority.

---

# 2. Repository Philosophy

This repository is developed through deliberate architecture rather than rapid iteration.

Every completed phase should leave the repository in a stronger position than it found it.

The objective is not simply to build features.

The objective is to build a predictable, maintainable and verifiable karaoke platform that becomes easier to extend as it evolves.

Architecture exists to reduce uncertainty.

Every completed phase should make future phases simpler, not more complicated.

The platform thinks in systems.

The operator thinks in people.

Implementation should reduce operator effort rather than increase it.

The repository is designed to grow through extension rather than replacement.

Prefer extending established architecture over introducing parallel implementations.

## Incremental Engineering

The repository evolves through deliberate dependency rather than feature accumulation.

Implement foundational capabilities before dependent capabilities.

Do not optimise higher-level behaviour while foundational systems remain incomplete.

Examples include:

- Playback before Queue.
- Performance before automatic progression.
- Parsing before presentation.
- Authority before interaction.

Everything comes together eventually.

The objective is to get there the right way.

---

# 3. Engineering Principles

Engineering decisions throughout this repository follow one overriding principle.

> Do not implement something assuming it will work.
>
> Do not assume it works because you've implemented it.
>
> Verify it.

Confidence comes from verification, not implementation.

Correctness is more valuable than speed.

Understanding is more valuable than assumption.

Verification is more valuable than confidence.

Features are considered complete only after appropriate verification.

Verification may include:

- focused automated tests;
- integration validation;
- manual verification;
- architectural review.

The appropriate verification depends on the feature being implemented.

---

# 4. Repository Values

This repository values:

- correctness over speed;
- architecture over shortcuts;
- maintainability over clever implementations;
- deterministic behaviour over hidden behaviour;
- explicit ownership over shared responsibility;
- immutable projections over mutable application state;
- typed communication over ambiguous behaviour;
- thoughtful discussion before implementation;
- small focused changes over sweeping rewrites;
- verification before completion.

When uncertainty exists, prefer discussion before implementation.

When architecture is unclear, clarify ownership before writing code.

When implementation is complete, verify before committing.

Prefer solving problems through architecture before adding dependencies.

Every dependency increases long-term maintenance responsibility.

Add dependencies deliberately.

Remove them when they no longer provide value.

---

# 5. Platform Overview

The Karaoke Webview platform is divided into clearly defined responsibilities.

The Host owns application authority.

React provides Host presentation.

Android provides participant presentation and capture.

Communication occurs through explicitly defined protocols.

Every significant capability should belong to one authoritative owner.

Business logic should exist once.

Presentation layers should consume immutable projections rather than reconstruct business rules.

The platform should become simpler to reason about as new capabilities are added.

Every new capability should reinforce existing architecture rather than bypass it.

---

# 6. Authority Model

Authority is intentionally centralised.

The Host owns business decisions.

Presentation layers request.

The Host decides.

Presentation layers render the resulting projections.

Authority should never migrate into UI code for convenience.

React and Android are adapters.

They are not alternative implementations of Host behaviour.

If ownership becomes unclear, stop and identify the correct authority boundary before implementing further work.

Protect established authority boundaries.

Extend existing authority before introducing new authority.

---

# 7. Known Architectural Decisions

The following architectural decisions are established within this repository.

Do not rediscover them during implementation.

Extend them where appropriate.

Do not replace them without explicit architectural review.

## Host Authority

The Host owns application authority.

Presentation layers request.

The Host decides.

Presentation layers render immutable projections.

## Stable Identity

Stable identities are authoritative.

Examples include:

- song identifiers;
- participant identifiers;
- session singer identifiers;
- performance identifiers;
- queue identifiers.

Identity should not be recreated in presentation layers.

## Coordinators

Long-lived behaviour belongs within Host-owned coordinators.

Prefer extending existing coordinators before introducing new ones.

Avoid duplicating business logic across multiple boundaries.

## Registries

Persistent application state should belong to Host-owned registries.

Registries should expose immutable projections.

## Protocols

Protocol behaviour is defined through documented message contracts.

Do not invent protocol behaviour that is not documented.

Protocol changes should follow the RFC process.

## Verification

Developer diagnostics exist to verify behaviour.

Diagnostics should expose authority rather than recreate business logic.

---

# 8. Development Workflow

Development follows a deliberate sequence.

Discussion

↓

Architecture

↓

RFC (where appropriate)

↓

Implementation

↓

Verification

↓

Review

↓

Commit

↓

Hardening

↓

Next capability

Do not skip stages simply because implementation appears straightforward.

Time spent clarifying architecture is rarely wasted.

Implementation should become simpler because architecture has already been agreed.

---

# 9. Repository Search Discipline

Inspect only the files directly related to the requested task.

Avoid broad repository exploration.

If the user identifies:

- a module;
- a symbol;
- an RFC;
- an architecture document;
- a protocol;
- or a specific file,

inspect those locations first.

Trust existing architecture.

Do not spend significant time rediscovering decisions that already exist.

When established documentation answers the question, follow the documentation.

Search should reduce uncertainty.

It should not replace architectural understanding.

Repository knowledge should accumulate through documentation,
not repeated rediscovery.

---

# 10. Scope Discipline

Remain within the requested task.

Do not perform:

- unrelated cleanup;
- speculative optimisation;
- opportunistic refactoring;
- architectural redesign;
- future roadmap work.

If additional improvements are identified:

Report them separately.

Do not silently include them.

Requested work takes priority over discoverable work.

Discovering possible improvements does not automatically make them part of the requested implementation.

---

# 11. Implementation Boundaries

Complete the requested task.

Do not continue implementation simply because additional improvements are possible.

If the requested feature is complete and appropriately verified:

STOP.

Do not automatically:

- optimise neighbouring systems;
- modernise unrelated implementations;
- perform opportunistic cleanup;
- expand architectural scope;
- implement future roadmap work;
- continue searching for "one final improvement."

If further work is discovered:

Report it under:

## Future Improvements

Do not implement it unless explicitly requested.

Completion is an engineering boundary.

Respect it.

---

# 12. Architectural Prerequisites

If implementation reveals a genuine architectural prerequisite:

STOP.

Explain:

- the missing boundary;
- why it is required;
- the smallest architectural addition necessary.

Do not work around architecture.

Do not silently expand the requested task.

Wait for approval before implementing architectural prerequisites.

The smallest correct prerequisite is preferable to a large redesign.

---

# 13. Phase Discipline

Roadmap phases exist to maintain repository focus.

Respect the current phase.

Implementation phases introduce capability.

Hardening phases improve existing capability.

Do not move Hardening work into implementation phases unless:

- it is required to complete the requested feature;
- it resolves a blocking defect introduced during the task;
- or explicit approval has been given.

Potential improvements should be reported rather than implemented.

Future roadmap work should remain within future roadmap phases.

Every completed phase should make the next phase easier.

Preserve the locked roadmap.

---

# 14. UI & UX Philosophy

The platform exists for operators and participants.

Interfaces should reduce effort rather than increase it.

Presentation should be calm, predictable and intentional.

Avoid unnecessary visual complexity.

Prefer clarity over decoration.

Prefer hierarchy over density.

Prefer whitespace over clutter.

The platform thinks in systems.

Users think in tasks.

UI should expose what users need to accomplish their current task.

Avoid presenting implementation details to operators.

Developer diagnostics should remain separate from operator workflows.

Interfaces should become simpler as architecture becomes stronger.

Presentation should reflect Host authority rather than recreate business logic.

When introducing new UI:

- reduce operator decisions;
- preserve consistency;
- prefer progressive disclosure;
- expose complexity only where appropriate.

Every interaction should have a clear purpose.

---

# 15. Validation Discipline

Implementation is not completion.

Validation is part of implementation.

Every task should be validated appropriately.

Validation normally progresses from:

1. Focused validation.
2. Broader validation.
3. Full project validation (where appropriate).
4. Manual verification.

Prefer validating the area that changed before validating the entire repository.

Avoid repeatedly running identical validation without new changes.

Validation exists to increase confidence rather than consume time.

When reporting validation:

- report what was executed;
- report what passed;
- report what remains manually verified;
- report known limitations honestly.

Do not claim verification that has not been performed.

---

# 16. Manual Verification

Every user-facing capability should have a straightforward manual verification path.

Implementation is not considered complete until appropriate manual verification has been identified or completed.

Manual verification should be practical.

Prefer scenarios that closely resemble real usage.

Examples include:

- pairing a real Android device;
- loading a real media library;
- performing playback;
- verifying lyrics during playback;
- exercising Host workflows;
- validating operator interactions.

Manual verification should confirm behaviour.

It should not merely demonstrate functionality.

Where manual verification remains outstanding, report it clearly.

---

# 17. Documentation Discipline

Documentation is part of implementation.

Do not treat documentation as an afterthought.

When behaviour changes:

- update architecture where appropriate;
- update RFCs where appropriate;
- update protocol documentation where appropriate;
- update roadmap documentation where appropriate;
- update developer guidance where appropriate.

Documentation should reduce future uncertainty.

Prefer updating existing documentation before creating duplicate documents.

Repository knowledge should accumulate through documentation rather than repeated rediscovery.

Documentation should explain decisions, not merely describe code.

---

# 18. Windows Development

The repository is developed primarily on Windows.

Prefer Windows-compatible solutions.

Respect existing tooling.

Avoid introducing unnecessary platform-specific behaviour.

Be aware of:

- build locks;
- stale development processes;
- file watcher behaviour;
- CRLF/LF handling;
- Windows filesystem characteristics.

Development should remain reliable on the primary development platform.

Cross-platform improvements are welcome when they preserve Windows reliability.

---

# 19. Git Discipline

Git history is part of the engineering record.

Commits should represent complete, verified work.

Do not create commits unless explicitly requested.

Do not include unrelated changes within focused work.

Keep commits cohesive.

When implementation completes:

- report validation;
- report remaining manual verification;
- report repository state honestly.

Do not claim the working tree is clean unless it has been verified.

Do not stage unrelated work.

Treat commit history as documentation.

Future contributors should understand why a change exists by reading its history.

---

# 20. Preferred Response Format

Implementation responses should be concise, factual and reproducible.

Where appropriate, conclude implementation work using the following structure.

## Completed

Summarise the requested work that was completed.

Do not include unrelated improvements.

## Validation

Report:

- focused validation;
- broader validation;
- full validation (where appropriate);
- build status.

Report validation honestly.

## Manual Verification

Clearly identify any remaining manual verification.

Do not claim manual verification that has not been performed.

## Git Status

Report:

- repository status;
- staged status;
- commit status (if requested);
- remaining uncommitted work.

## Future Improvements

If additional improvements were identified:

Report them separately.

Do not implement them unless explicitly requested.

Requested work takes priority over discoverable work.

---

# 21. Repository Evolution

This repository evolves deliberately.

Growth should occur through extension rather than replacement.

Prefer strengthening existing architecture before introducing new architecture.

Implement foundational capabilities before dependent capabilities.

Do not optimise higher-level behaviour while foundational systems remain incomplete.

The repository evolves through deliberate dependency rather than feature accumulation.

Examples include:

- Playback before Queue.
- Performance before automatic progression.
- Parsing before presentation.
- Authority before interaction.

Everything comes together eventually.

The objective is to get there the right way.

Engineering principles should evolve only when the repository has demonstrably learned a better way to build software.

Treat this guide as an engineering document.

Do not modify it casually.

---

# 22. Closing Principles

Leave the repository stronger than you found it.

Build deliberately.

Verify thoroughly.

Respect established architecture.

Protect authority boundaries.

Confidence comes from verification, not implementation.