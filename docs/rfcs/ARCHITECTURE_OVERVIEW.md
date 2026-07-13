# Karaoke Webview Platform — Architecture Overview

This is the first document a new contributor should read before opening source code.

Karaoke Webview is designed as a platform, not simply a Windows karaoke application. The long-term goal is a system where every implementation — Windows Host, Android Companion, future iOS clients, web remotes, protocol libraries, and hardware integrations — shares one common architectural language.

The Platform defines what the system is.

Individual implementations define how they participate.

This separation allows each implementation to evolve independently without redefining the core domain.

---

# 1. Architectural Layers

The project is divided into three governance layers:

```text
Platform
│
├── Universal Architecture
│
├──────────────┐
│              │
▼              ▼
Host        Android
│              │
Implementation  Implementation
```

Each layer has a distinct responsibility.

```text
Platform
    ↓
defines concepts

Host
    ↓
implements authority

Android
    ↓
implements participation
```

Each implementation layer depends on Platform.

The Platform never depends on Host.

The Platform never depends on Android.

---

# 2. Platform RFCs

Platform RFCs are the authoritative definition of Karaoke Webview.

They are operating-system independent. They should not depend on Windows, Android, Rust, React, Kotlin, AudioRecord, WASAPI, Tauri, or any other implementation technology.

Instead, they define the concepts every implementation must understand.

## RFC-P-001 — Platform Authority

Defines the Platform authority model.

Every distributed system needs exactly one authoritative owner of state. This RFC establishes that principle before any implementation exists.

## RFC-P-002 — Platform Domain Model

Defines the Platform vocabulary, including concepts such as Singer, SessionSinger, MicrophoneSource, MicrophoneChannel, Performance, and Queue.

Names become contracts. Every implementation uses the same language regardless of programming language or operating system.

## RFC-P-003 — Performance Lifecycle

Defines the lifecycle of a karaoke performance.

Playback, scoring, preparation, and completion all depend on a common lifecycle. Implementations coordinate around this lifecycle rather than inventing their own.

## RFC-P-004 — Karaoke Modes

Defines behavioural differences between performance modes such as Standard, Party, and Battle.

Modes are Platform policy rather than UI behaviour, keeping implementations consistent.

## RFC-P-005 — Microphone Resource Model

Defines microphone resources and separates MicrophoneSource from MicrophoneChannel.

Hardware changes. Platform identity should not. This separation enables Windows microphones, Android microphones, and future devices to coexist.

## RFC-P-006 — Capture Session Model

Defines capture ownership.

Capture becomes a reusable Platform resource. Consumers observe the same capture rather than competing for hardware.

## RFC-P-007 — Microphone Assignment & Channel Management

Defines channel ownership and assignment.

Assignments belong to stable Platform channels rather than volatile hardware. Disconnects therefore become recoverable.

## RFC-P-008 — Platform Protocol & Connection State Machine

Defines how external implementations communicate with the Platform.

Networking becomes another implementation detail. The Platform remains unchanged regardless of transport. This RFC is the bridge between Host, Android, and future clients.

## RFC-P-014 — Accepted Media File Types

Defines the accepted Platform media file types for normal karaoke performances.

Audio uses `.opus`.

Lyrics use `.ttml`.

These file types establish the shared media readiness contract without defining Host playback or parser implementation.

---

# 3. Host RFCs

Host RFCs define the authoritative Windows runtime.

They extend Platform RFCs. They never redefine Platform concepts.

## RFC-H-001 — Windows Host Identity & Runtime Authority

Defines the Windows Host as the authoritative runtime.

Without this document, authority could slowly migrate into UI code or external clients.

## RFC-H-002 — Host Runtime Composition & State Ownership

Defines runtime ownership.

Registries own state.

Coordinators own behaviour.

React owns presentation.

This is the operating model of the Host runtime.

## RFC-H-003 — Frontend, Command & Projection Boundary

Defines communication between React and Rust.

The UI requests.

The Host decides.

The UI reflects the decision.

This prevents business logic from migrating into the frontend.

## RFC-H-004 — Host Adapter & Platform Integration Model

Defines every integration boundary.

Windows APIs, Android, filesystems, and future hardware all enter through Host Adapters.

Adapters translate. They never become Platform authority.

## RFC-H-005 — Host Validation, Diagnostics & Shutdown

Defines engineering quality.

Validation, diagnostics, and deterministic shutdown are architectural principles rather than optional practices.

---

# 4. Android RFCs

Android RFCs define a thin capture client.

Android participates in the Platform. It never becomes Platform authority.

## RFC-A-001 — Client Authority & Boundaries

Defines Android's role.

Android observes, captures, streams, and displays. It never owns karaoke state.

## RFC-A-002 — Audio Capture Lifecycle

Defines microphone capture.

Capture becomes deterministic and independent from networking.

## RFC-A-003 — Audio Frame & Buffer Contract

Defines locally captured audio observations.

Frames remain transport-neutral. Networking is layered separately.

## RFC-A-004 — Foreground Service, Privacy & Power

Defines Android lifecycle requirements.

Privacy and operating-system expectations become explicit architecture.

## RFC-A-005 — Diagnostics & Validation

Defines implementation quality.

The Android client proves reliable capture before networking or broader integration depends on it.

---

# 5. Core Architectural Principles

Several principles appear repeatedly throughout the RFCs.

## One Authority

Exactly one runtime owns Platform state.

Authority is never distributed accidentally.

## Stable Identity

Identity outlives implementation.

A microphone channel is not a Windows device.

A singer is not a UI component.

Identity remains stable while implementations change.

## Separation of Responsibility

State ownership, behaviour, presentation, hardware, and networking each have a distinct owner.

## Replaceable Implementations

Every external dependency is replaceable: Windows APIs, Android, filesystem access, protocol transports, and future hardware.

None redefine Platform concepts.

## Transport Independence

The Platform does not know whether observations arrive from WASAPI, AudioRecord, USB, Bluetooth, or a future protocol.

They all become Platform resources.

## Deterministic Runtime

Ownership, lifecycle, cleanup, and recovery are explicit.

Predictability is preferred over convenience.

## Observable Behaviour

Diagnostics observe.

They never become authority.

Validation proves correctness.

---

# 6. What This Architecture Enables

Although the Platform begins with a Windows Host and Android Companion, the architecture is intentionally broader.

It naturally supports:

- local Windows karaoke;
- Android companion microphones;
- multiple simultaneous microphone technologies;
- additional client platforms such as iOS, web, and desktop;
- replaceable protocol transports;
- distributed audio capture;
- future cloud synchronization;
- multiple operator interfaces;
- hardware controllers;
- streaming integrations;
- extensible media libraries;
- additional performance modes;
- future persistence layers;
- new scoring engines;
- AI-assisted features that consume Platform projections without becoming authoritative.

None of these require redefining the Platform because the abstractions already exist.

---

# 7. Why RFC Governance Matters

The RFCs do more than document decisions.

They create a shared architectural vocabulary.

Instead of asking:

> How should we implement this?

The better questions become:

> Which Platform concept does this belong to?

and:

> Which layer owns this responsibility?

That reduces ambiguity and allows implementation work to happen independently while remaining compatible.

---

# 8. Fresh Implementation Perspective

If this repository contained only the RFCs and no code, it would still contain a complete architectural specification.

A team could independently build the Windows Host, the Android Companion, a protocol library, or a future web client, and provided they followed the RFCs, each implementation would interoperate because they share the same Platform language and authority model.

That is the strongest aspect of this governance model: the code is an implementation of the architecture, not the architecture itself.

---

# 9. Contributor Reading Path

New contributors should read:

1. `ARCHITECTURE_OVERVIEW.md`
2. `PLATFORM_ARCHITECTURE.md`
3. `platform/CORE_PLATFORM_RFCS.md`
4. `platform/RFC-P-001-platform-authority.md`
5. `platform/RFC-P-002-platform-domain-model.md`
6. `platform/RFC-P-003-performance-lifecycle.md`
7. `platform/RFC-P-004-karaoke-modes.md`
8. Topic-specific Platform RFCs
9. Relevant Host or Android RFCs
