# Ollama Codex Integration Session Artifact

This artifact records the material changes made during the Ollama local-model integration session, including the Codex runtime/config changes, T3 wiring changes, and the final live verification outcome.

## Outcome

`ollamaLocal` now works as a Codex-backed provider inside T3 for real tool execution with `qwen3:8b`, and unsupported local models are now rejected before they can degrade into broken agent turns.

Authoritative live proof:

- local dev web: `http://127.0.0.1:5733`
- local dev server: `http://127.0.0.1:3773`
- Ollama endpoint: `http://192.168.10.12:11435/api`
- live smoke artifact: `.vx/live-probes/t3-ollama-codex-selection-smoke/summary.json`
- verified thread: `thread-ollama-smoke-1780839994893`
- verified project: `project-ollama-smoke-1780839994893`
- verified model/provider: `ollamaLocal` + `qwen3:8b`
- verified tool probe: `smoke-tool-ok`

The final smoke proof shows a real `thread.turn.start` dispatch, `tool.started`, `tool.completed`, and the filesystem side effect at `.vx/live-probes/t3-ollama-codex-selection-smoke/workspace/smoke-tool.txt`.

Live compatibility matrix for Codex-backed agent turns on the current Ollama endpoint:

- `qwen3:8b`: verified for agent/tool turns
- `qwen2.5-coder:14b`: unsupported for agent turns in T3
- `qwen2.5-coder:7b`: unsupported for agent turns in T3
- `deepseek-coder-v2:16b`: unsupported for agent turns in T3

## What Changed

### 1. `ollamaLocal` now uses the Codex harness for coding-agent behavior

The direct Ollama HTTP chat path was not sufficient for file-editing and tool-based coding behavior. The runtime moved onto the Codex harness path so Ollama can behave like a real coding agent through Codex rather than as a plain chat transport.

Primary files:

- `apps/server/src/provider/Layers/OllamaAdapter.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Services/OllamaAdapter.ts`
- `apps/server/src/provider/Services/CodexAdapter.ts`

### 2. Managed Codex config/profile support for OpenAI and Ollama

T3 now maintains separate managed Codex config for:

- OpenAI-backed Codex sessions
- Ollama-backed Codex sessions

Primary files:

- `apps/server/src/provider/codexProfileConfig.ts`
- `apps/server/src/provider/codexProfileConfig.test.ts`
- `apps/server/src/provider/codexAppServer.ts`

Important design details:

- managed OpenAI and Ollama homes remain isolated through `CODEX_HOME`
- profile files are still written for CLI/profile-compatible Codex surfaces
- app-server launches no longer rely on `--profile`

### 3. Critical app-server launch fix

The main runtime failure discovered during live verification was that `codex app-server` does not support `--profile`. The previous launch path passed `--profile`, which caused Codex app-server to exit with code `1` before session startup.

Fix:

- app-server sessions now use `-c` config overrides instead of `--profile`
- the managed Ollama provider id was normalized to `t3_ollama_gpu_provider` so dotted `-c` config keys are valid

Primary files:

- `apps/server/src/provider/codexAppServer.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/codexProfileConfig.ts`

### 4. Ollama provider reachability and status semantics

Provider status was updated so `installed` means reachable for `ollamaLocal`, with a timed health probe and clearer status semantics for settings and picker UX.

Primary files:

- `apps/server/src/provider/ollamaApi.ts`
- `apps/server/src/provider/Layers/OllamaProvider.ts`
- `apps/server/src/provider/ollamaModelSupport.ts`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`

### 5. Local-model tool routing and compatibility guardrails

The original Ollama Codex path exposed Codex built-in `web_search` and `multi_agent` tool surfaces to local models. In practice that caused empty-name or unsupported tool calls for `ollamaLocal`, even when plain chat still worked.

Fix:

- managed Ollama Codex sessions now set `web_search = "disabled"`
- managed Ollama Codex sessions now set `features.multi_agent = false`
- live verification now requires a real shell tool call and filesystem side effect, not just a text-only reply
- T3 now records per-model Ollama agent support metadata in the provider snapshot
- unsupported Ollama models now fail fast at the provider boundary instead of entering a broken tool turn

Primary files:

- `packages/contracts/src/server.ts`
- `apps/server/src/provider/codexProfileConfig.ts`
- `apps/server/src/provider/ollamaModelSupport.ts`
- `apps/server/src/provider/Layers/OllamaProvider.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/integration/ollamaLocal.live.integration.test.ts`
- `scripts/live-ollama-codex-selection-smoke.ts`

### 6. Git/text generation support for Ollama

Ollama was wired into the T3 text-generation path so git/title/branch/summary generation can route to the local model when selected.

Primary files:

- `apps/server/src/git/Layers/OllamaTextGeneration.ts`
- `apps/server/src/git/Layers/RoutingTextGeneration.ts`
- `apps/server/src/git/Services/TextGeneration.ts`

### 7. Persistence and orchestration correctness

Coverage was added for:

- finalized thread message persistence
- restart/recovery replay from persisted history
- checkpoint revert trimming before the next turn

Primary files:

- `apps/server/integration/orchestrationEngine.integration.test.ts`
- `apps/server/integration/OrchestrationEngineHarness.integration.ts`

### 8. Real picker/session smoke verification

A real live verification script was added and then corrected so it can prove:

- the real T3 picker selects `ollamaLocal`
- the resulting turn dispatch uses the Ollama model/provider
- the session reaches a real tool turn
- the tool completes and leaves a verified filesystem artifact

Primary file:

- `scripts/live-ollama-codex-selection-smoke.ts`

Important verifier learnings:

- browser websocket frame capture alone is not sufficient as the only proof source
- `orchestration.getThreadById` returns thread/session summary but not message bodies
- authoritative fallback must use:
  - `orchestration.getThreadById`
  - `orchestration.listThreadMessages`
- local-model verification must check a real tool side effect, not only assistant text

### 9. Standalone Codex instruction and skill loading proof

Follow-up investigation against a real `ollamaLocal` standalone thread confirmed:

- Codex persisted a synthetic `# AGENTS.md instructions for /home/gizmo/kb-vxapp` message in the rollout JSONL for the live thread
- the same rollout also persisted the collaboration-mode turn context injected by T3
- therefore `AGENTS.md` was actually loaded for the standalone Codex-backed thread, even though the model later answered as if it had no startup instructions
- the model's self-report was wrong; the persisted rollout is the authoritative proof source

Follow-up investigation also confirmed the native standalone Codex skill boundary:

- `skills/list` for `/home/gizmo/kb-vxapp` returned repo skills from `.agents/skills`
- `skills/list` also returned user and bundled system skills
- `.claude/skills` was not part of the native standalone Codex `skills/list` result in this setup
- T3's browser-side `.claude/skills` suggestion catalog and Codex native standalone skill discovery are different surfaces

Authoritative proof sources from the investigation:

- managed Ollama Codex home: `/home/gizmo/.codex-ollama`
- managed trust config: `/home/gizmo/.codex-ollama/config.toml`
- managed profile config: `/home/gizmo/.codex-ollama/t3-ollama-gpu.config.toml`
- persisted thread state: `/home/gizmo/.codex-ollama/state_5.sqlite`
- investigated rollout:
  - `/home/gizmo/.codex-ollama/sessions/2026/06/10/rollout-2026-06-10T20-10-56-019eb103-7b93-7510-91e2-ba93b7bcb7d4.jsonl`

Operational conclusion:

- when debugging standalone Codex-backed `ollamaLocal` behavior, do not infer instruction or skill loading from the model's self-description alone
- inspect rollout JSONL plus direct `config/read` and `skills/list` probes against the same managed `codex app-server` launch

## Web/UI Changes

Relevant UI changes made or relied on in this session:

- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/chat/ProviderModelPicker.browser.tsx`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/modelSelection.ts`
- `apps/web/src/composerDraftStore.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/session-logic.ts`

The picker still exposes reachable Ollama models, but the ChatView agent-turn selection path now resolves only verified Ollama agent models. Unsupported models remain available only where non-agent text-generation behavior is still valid.

## Codex/Ollama Runtime Contract

Final effective contract for the Codex-backed Ollama path:

- Ollama endpoint for direct T3 health/model discovery: `http://192.168.10.12:11435/api`
- Ollama OpenAI-compatible Responses base for Codex: `http://192.168.10.12:11435/v1/`
- managed provider id: `t3_ollama_gpu_provider`
- verified agent model: `qwen3:8b`
- unsupported agent models on the current endpoint:
  - `qwen2.5-coder:14b`
  - `qwen2.5-coder:7b`
  - `deepseek-coder-v2:16b`
- unsupported models fail fast with `provider.turn.start.failed`
- app-server launch style: `codex app-server -c ...`

## Verification Commands Used

Core validation:

```bash
bun fmt
bun lint
bun typecheck
```

Focused server verification:

```bash
cd apps/server
bun run test src/provider/Layers/OllamaProvider.test.ts src/provider/Layers/OllamaAdapter.test.ts src/provider/codexProfileConfig.test.ts
```

Focused web verification:

```bash
cd apps/web
bun run test src/modelSelection.test.ts src/composerDraftStore.test.ts
```

Live tool-turn verification:

```bash
T3_WEB_BASE_URL=http://127.0.0.1:5733 \
T3_SERVER_BASE_URL=http://127.0.0.1:3773 \
OLLAMA_BASE_URL=http://192.168.10.12:11435/api \
OLLAMA_MODEL=qwen3:8b \
bun run scripts/live-ollama-codex-selection-smoke.ts
```

## Residual Notes

- The verified Codex-backed Ollama agent contract is currently limited to `qwen3:8b`.
- Unsupported Ollama models are intentionally guarded until they pass the same live tool-turn proof.
- The guardrail is scoped to Codex-backed agent turns; non-agent local-model text-generation paths can remain broader where they do not claim tool support.
