---
name: 143-t3code-pr-closeout
description: PR summary and reviewer checklist guidance for t3code-vxapp review surfaces.
---

# t3code-vxapp PR Closeout

Use this pack to prepare the PR-facing review summary for `t3code-vxapp` work.
This repo's closeout authority remains commit-scoped by default, so treat this
pack as review-surface guidance rather than push/publication authority.

## Authority

This pack grants: read, inspect, pr-comment, pr-review.
This pack forbids: edit, commit, push, stash, deploy, branch-delete.
Closeout authority and lifecycle capability are decided by the resolved pack
profile, not by this SKILL.md alone.

## Worker Rules

- Carry the affected UI or dispatch/session surface, validation, and next review
  action into the review summary.
- If the diff changes event flow, websocket/session handling, or UI state
  placement, the summary must name that explicitly.
- Block review approval if `bun fmt`, `bun lint`, `bun typecheck`, or needed
  manual flow proof is missing.

## References

- `references/pr-summary.md`
- `references/reviewer-checklist.md`
