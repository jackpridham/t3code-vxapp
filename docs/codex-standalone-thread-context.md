# Standalone Codex Thread Context

This note captures the current confirmed behavior for standalone Codex-backed
threads launched by T3, especially `ollamaLocal`.

## Summary

- T3 launches `codex app-server` with a managed `CODEX_HOME`, runtime `cwd`,
  and `-c` config overrides.
- T3 injects collaboration-mode `developer_instructions`.
- T3 fingerprints `AGENTS.md` and `CLAUDE.md` to decide when to restart a
  provider session.
- Codex itself loads project instruction files and native standalone skills from
  the runtime `cwd`.
- A model claiming it had "no startup instructions" is not proof that
  `AGENTS.md` was missing.

## What T3 Injects

T3's explicit per-turn injection is the collaboration-mode wrapper sent through
`turn/start`:

- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/CodexDeveloperInstructions.ts`

T3 also computes an instruction fingerprint from `AGENTS.md` and `CLAUDE.md`
for session restart boundaries:

- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

That fingerprinting is not the same thing as the prompt payload. It is restart
logic.

## What Codex Injects

For standalone Codex-backed threads, Codex loads project instructions itself.
In the persisted rollout JSONL, this appears as a synthetic user-visible context
message like:

```text
# AGENTS.md instructions for /path/to/workspace
```

In the investigated `kb-vxapp` thread, the persisted rollout contained:

- the synthetic `AGENTS.md` instructions message
- the `cwd` and collaboration-mode turn context

Proof paths from the investigated thread:

- `/home/gizmo/.codex-ollama/sessions/2026/06/10/rollout-2026-06-10T20-10-56-019eb103-7b93-7510-91e2-ba93b7bcb7d4.jsonl`
- `/home/gizmo/kb-vxapp/AGENTS.md`

## Native Skill Discovery

Standalone Codex native skill discovery is not the same as T3's browser-side
skill suggestion catalog.

Confirmed native standalone Codex behavior:

- repo skills come from `.agents/skills`
- user skills come from `$HOME/.agents/skills`
- system skills come from bundled Codex skill locations
- legacy `.claude/skills` is not part of native standalone Codex `skills/list`
  discovery in this setup

This means:

- T3 browser composer suggestions should now prefer `.agents/skills`
- old `.claude/skills` references may still appear in historical messages
- standalone Codex runtime skill loading is `.agents/skills` driven
- those are different surfaces and should not be conflated

## Where To Inspect

When debugging a standalone Codex-backed thread, use these sources in order:

1. Managed `CODEX_HOME` config
2. Persisted rollout JSONL for the exact Codex thread id
3. Direct `config/read` against the same managed `codex app-server` launch
4. Direct `skills/list` against the same managed `codex app-server` launch

Useful files:

- `/home/gizmo/.codex-ollama/config.toml`
- `/home/gizmo/.codex-ollama/t3-ollama-gpu.config.toml`
- `/home/gizmo/.codex-ollama/state_5.sqlite`
- `/home/gizmo/.codex-ollama/sessions/.../rollout-*.jsonl`

Useful direct probe shape:

```bash
env CODEX_HOME=/home/gizmo/.codex-ollama \
  codex app-server \
  -c 'model="qwen3:8b"' \
  -c 'web_search="disabled"' \
  -c 'features.multi_agent=false' \
  -c 'model_provider="t3_ollama_gpu_provider"' \
  -c 'model_providers.t3_ollama_gpu_provider.name="Ollama GPU"' \
  -c 'model_providers.t3_ollama_gpu_provider.base_url="http://192.168.10.12:11435/v1/"' \
  -c 'model_providers.t3_ollama_gpu_provider.wire_api="responses"'
```

Then send:

- `initialize`
- `initialized`
- `config/read`
- `skills/list`

## Operational Conclusions

- If the rollout contains the synthetic `AGENTS.md` message, Codex loaded the
  project instructions.
- If `skills/list` returns repo skills from `.agents/skills`, native standalone
  Codex skill loading is working.
- If a model still claims it has no startup instructions, treat that as model
  behavior or instruction-following failure, not as proof that T3 skipped the
  project doc surface.
