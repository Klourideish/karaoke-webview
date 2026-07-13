# Karaoke Webview Design Language

**Status:** Provisional guidance

This document describes a restrained initial visual and interaction language. It does not define exact fonts, colors, spacing tokens, component libraries, or final branding.

## Principles

- Calm and readable.
- Operator-focused.
- Status at a glance.
- Progressive disclosure.
- Consistent actions.
- Minimal technical jargon.
- Accessible contrast.
- Diagnostics visually distinct from public UI.

## Status Language

Use simple semantic statuses:

- Ready
- Needs attention
- Disconnected
- Waiting
- Active
- Stopped
- Failed

Recommended color meaning:

- green for healthy/ready;
- red for unavailable/failure;
- amber for waiting/degraded/attention;
- neutral for inactive/stopped.

Do not hard-code exact color values yet.

## Controls

- Primary action used sparingly.
- Destructive actions clearly separated.
- Dropdowns for direct selection.
- Collapsible advanced sections.
- Immediate local Stop where microphone/privacy is involved.
- Disabled controls should explain why where practical.

## Density

- Public operational screens should be concise.
- Developer screens may be dense.
- Details should appear on demand.
- Avoid displaying identifiers unless diagnosing.

## Terminology

Prefer:

- Singer
- Song
- Queue
- Microphone
- Ready
- Needs attention
- Add to Queue
- Requested by
- Upvote

Avoid in public UI:

- MicrophoneSource
- MicrophoneChannel
- Assignment sequence
- ProtocolSession
- CaptureAttempt
- Jitter window
- readiness enum names

## Meters

- Simple level bars in public UI.
- Detailed numerical meters only in Developer.
- Meter should communicate "input is working," not become an engineering dashboard.

## Android Relationship

- Share broad product identity.
- Do not force identical layouts.
- Host is operator-oriented.
- Android is participant-oriented.

## Accessibility

- Status must not rely on color alone.
- Icons require text or accessible labels.
- Controls require clear focus and disabled states.
- Important warnings use concise plain language.
