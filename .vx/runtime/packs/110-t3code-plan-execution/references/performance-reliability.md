# Performance and Reliability — t3code-vxapp

- No synchronous I/O on the render path.
- WebSocket reconnect must be idempotent and bounded (exponential backoff
  with a cap).
- Avoid large JSON payloads in hot paths; prefer streaming.
- Every state mutation must go through the store; no ad-hoc reactive state
  outside designated stores.
