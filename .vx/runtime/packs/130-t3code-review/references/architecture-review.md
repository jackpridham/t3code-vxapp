# Architecture Review — t3code-vxapp

Reviewers check:

1. Does the change respect the store boundary? (no reactive state outside
   designated stores)
2. Is the WebSocket control-plane contract preserved?
3. Are new files in the right domain directory?
4. Are new dependencies justified? Prefer native Bun/Vite APIs.
5. Is the change reversible without a data migration?
