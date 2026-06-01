# Maintainability Rules — t3code-vxapp

- Keep modules under ~300 lines where possible. Split by concern, not by
  file size alone.
- Named exports over default exports.
- No runtime `any`; use narrowed types or `unknown` + guards.
- Dead code must be deleted, not commented out.
- Feature flags must have a removal plan; otherwise, don't add them.
