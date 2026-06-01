# Reviewer Checklist

Before approving a `t3code-vxapp` PR, confirm:

- the affected UI panel, dispatch flow, or session behavior is named clearly
- `bun fmt`, `bun lint`, and `bun typecheck` evidence exists
- event flow, session handling, or UI-state risks are explicit when touched
- manual proof exists for user-visible interaction changes
