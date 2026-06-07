# Maintenance Loop

## Purpose

This skill should improve itself as parent-sync work uncovers new failure modes or reliable solutions.

## Default Behavior

When a parent-sync task teaches something reusable, do not leave that lesson trapped in the conversation. Patch this skill before closeout.

The expected behavior is explicit:

- say that the skill is being updated
- write the smallest durable note that will help next time
- place the note in the right reference file instead of bloating `SKILL.md`

## Suggested User-Facing Wording

Use short direct statements such as:

- `I'm updating the parent-sync skill so next time this conflict pattern is handled up front.`
- `I'm updating the parent-sync skill to record this backport rule for future syncs.`
- `I'm updating the parent-sync skill to capture this blocker and the safe workaround.`

## What Belongs Where

### Update `SKILL.md` when:

- the trigger conditions changed
- the top-level workflow changed
- the self-maintenance rule itself needs to be stronger or clearer

### Update `references/conflict-hotspots.md` when:

- a recurring merge seam is discovered
- a file or subsystem repeatedly causes dry-run merge pain
- a subsystem should be classified as `do not blind-merge`

### Update `references/known-parent-gaps-*.md` when:

- a new upstream bug fix should be tracked
- a previously tracked gap is now present in the fork
- a risk changes from `evaluate` to `must-port`

### Update `references/sync-playbook.md` when:

- the practical sync procedure changes
- a better sequence of commands or classification steps is proven

### Update `references/scope-and-boundaries.md` when:

- repo-specific constraints change
- a new architectural boundary becomes important for future syncs

## Minimum Standard

If the lesson can be stated in one paragraph or a few bullets, record it immediately.

Do not wait for a separate documentation pass if the knowledge is already clear.

## Closeout Rule

A parent-sync task is not fully closed when it discovered a reusable blocker or solution but left the skill stale.
