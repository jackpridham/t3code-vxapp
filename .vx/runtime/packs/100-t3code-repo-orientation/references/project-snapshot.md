# Project Snapshot — t3code-vxapp

t3code-vxapp is a minimal web GUI for coding agents. Priorities:

1. Performance and reliability first — no regressions in startup, WebSocket
   responsiveness, or checkpoint rendering.
2. Architectural clarity — no speculative abstraction, no dead code.
3. Duplicate-logic avoidance — shared helpers live in one place.

The repo ships an Electron-less web surface; the heavy lifting happens in
T3 (WebSocket control plane) and external agents.
