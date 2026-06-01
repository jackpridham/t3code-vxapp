# Duplication Review — t3code-vxapp

Check for:

- Two components doing the same layout job under different names.
- Store actions that duplicate a helper.
- Inline string constants that should be enums.
- Repeated `fetch` patterns that should be a client helper.

If duplication is found, ask the worker to consolidate before approving.
