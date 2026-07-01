# 18 - Real Provider Supported Codex Model

## Objective

Keep the live real-provider proof on a Codex model accepted by the current
ChatGPT-backed Codex CLI auth path.

## Evidence

- Prior agents-vxapp E2E evidence:
  `/tmp/agents-orchestration-e2e-20260701T073149Z/real-provider/default-artifacts/summary.json`
- The prior default `gpt-5.3-codex` failed with provider status 400:
  the model is not supported when using Codex with a ChatGPT account.
- Rerun evidence with `T3CODE_REAL_PROVIDER_MODEL=gpt-5.4`:
  `/tmp/agents-orchestration-e2e-20260701T073149Z/real-provider-gpt54/artifacts/summary.json`

## Plan

1. Change the live real-provider probe default from `gpt-5.3-codex` to
   `gpt-5.4`.
2. Preserve `T3CODE_REAL_PROVIDER_MODEL` as an explicit operator override.
3. Add unit coverage that pins the default and the override behavior.
4. Rerun the agents-vxapp real-provider proof.

## Validation

```bash
bun test scripts/live-probe-config.test.ts
```
