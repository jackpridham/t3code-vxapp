import assert from "node:assert/strict";
import { it } from "@effect/vitest";

import { readTopLevelTomlModelProvider } from "./codexConfig.ts";

it("returns undefined when no top-level model_provider exists", () => {
  assert.equal(readTopLevelTomlModelProvider('model = "gpt-5-codex"\n'), undefined);
});

it("returns the top-level model_provider when present", () => {
  assert.equal(
    readTopLevelTomlModelProvider('model = "gpt-5-codex"\nmodel_provider = "portkey"\n'),
    "portkey",
  );
});

it("supports single-quoted model_provider values", () => {
  assert.equal(readTopLevelTomlModelProvider("model_provider = 'mistral'\n"), "mistral");
});

it("ignores comments and surrounding whitespace", () => {
  assert.equal(
    readTopLevelTomlModelProvider(["# comment", "", '  model_provider = "azure"  '].join("\n")),
    "azure",
  );
});

it("ignores model_provider keys inside TOML sections", () => {
  assert.equal(
    readTopLevelTomlModelProvider(
      [
        'model = "gpt-5-codex"',
        "",
        "[model_providers.portkey]",
        'base_url = "https://api.portkey.ai/v1"',
        'model_provider = "should-be-ignored"',
      ].join("\n"),
    ),
    undefined,
  );
});

it("stops scanning once a section header begins", () => {
  assert.equal(
    readTopLevelTomlModelProvider(
      [
        'model = "gpt-5-codex"',
        "[profiles.deep-review]",
        'model_provider = "should-not-be-read"',
      ].join("\n"),
    ),
    undefined,
  );
});
