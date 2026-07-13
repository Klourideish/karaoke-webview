# Karaoke Webview Design Documents

This directory contains provisional product and interface design guidance for Karaoke Webview.

Design documents are not RFCs. Accepted Platform and Host RFCs remain authoritative for architecture, domain meaning, ownership, lifecycle, and runtime behavior. These documents describe how authoritative Host state should be projected into an operator-friendly experience.

UI design may evolve through testing and iteration without a new RFC unless a proposed change alters Platform architecture, Host authority, domain behavior, or runtime ownership.

Normal operator UI should avoid exposing internal Platform machinery unless the operator needs it. Diagnostic and engineering details should remain available, but should move toward Developer or Advanced tooling rather than dominating the public surface.

Current design documents:

- [UI Vision](UI_VISION.md)
- [UI v0.1](UI_V0.1.md)
- [Design Language](DESIGN_LANGUAGE.md)
