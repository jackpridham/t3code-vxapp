import { Effect, Layer, Option, Schema } from "effect";

import { OllamaModelSelection } from "@t3tools/contracts";
import { requestOllamaChat } from "../../provider/ollamaApi.ts";
import { resolveOllamaRuntimeConfig } from "../../provider/ollamaConfig.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  type ThreadTitleGenerationResult,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "../Prompts.ts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "../Utils.ts";

const OLLAMA_TIMEOUT_MS = 180_000;
const OLLAMA_JSON_SYSTEM_PROMPT =
  "Return only valid JSON matching the requested schema. Do not include markdown fences or extra text.";

export interface OllamaTextGenerationOptions {
  readonly fetch?: typeof fetch;
}

export const makeOllamaTextGeneration = (options?: OllamaTextGenerationOptions) =>
  Effect.gen(function* () {
    const serverSettingsService = yield* Effect.service(ServerSettingsService);

    const runOllamaJson = <S extends Schema.Top>({
      operation,
      cwd: _cwd,
      prompt,
      outputSchemaJson,
      modelSelection,
    }: {
      operation:
        | "generateCommitMessage"
        | "generatePrContent"
        | "generateBranchName"
        | "generateThreadTitle";
      cwd: string;
      prompt: string;
      outputSchemaJson: S;
      modelSelection: OllamaModelSelection;
    }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
      Effect.gen(function* () {
        const ollamaSettings = yield* Effect.mapError(
          Effect.map(
            serverSettingsService.getSettings,
            (settings) => settings.providers.ollamaLocal,
          ),
          (cause) =>
            new TextGenerationError({
              operation,
              detail: "Failed to read Ollama server settings.",
              cause,
            }),
        );
        const runtimeConfig = resolveOllamaRuntimeConfig(ollamaSettings);
        const response = yield* requestOllamaChat({
          baseUrl: runtimeConfig.baseUrl,
          body: {
            model: modelSelection.model,
            stream: false,
            format: toJsonSchemaObject(outputSchemaJson),
            messages: [
              { role: "system", content: OLLAMA_JSON_SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
          },
          ...(options?.fetch !== undefined ? { fetch: options.fetch } : {}),
        }).pipe(
          Effect.timeoutOption(OLLAMA_TIMEOUT_MS),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new TextGenerationError({ operation, detail: "Ollama request timed out." }),
                ),
              onSome: (value) => Effect.succeed(value),
            }),
          ),
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation,
                detail:
                  cause instanceof Error
                    ? `Ollama request failed: ${cause.message}`
                    : "Ollama request failed.",
                cause,
              }),
          ),
        );

        if (typeof response.error === "string" && response.error.trim().length > 0) {
          return yield* new TextGenerationError({
            operation,
            detail: `Ollama returned an error: ${response.error.trim()}`,
          });
        }

        const rawContent = response.message?.content?.trim();
        if (!rawContent) {
          return yield* new TextGenerationError({
            operation,
            detail: "Ollama returned an empty response.",
          });
        }

        return yield* Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))(rawContent).pipe(
          Effect.catchTag("SchemaError", (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Ollama returned invalid structured output.",
                cause,
              }),
            ),
          ),
        );
      });

    const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
      "OllamaTextGeneration.generateCommitMessage",
    )(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
      });

      if (input.modelSelection.provider !== "ollamaLocal") {
        return yield* new TextGenerationError({
          operation: "generateCommitMessage",
          detail: "Invalid model selection.",
        });
      }

      const generated = yield* runOllamaJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

    const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
      "OllamaTextGeneration.generatePrContent",
    )(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
      });

      if (input.modelSelection.provider !== "ollamaLocal") {
        return yield* new TextGenerationError({
          operation: "generatePrContent",
          detail: "Invalid model selection.",
        });
      }

      const generated = yield* runOllamaJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

    const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
      "OllamaTextGeneration.generateBranchName",
    )(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      if (input.modelSelection.provider !== "ollamaLocal") {
        return yield* new TextGenerationError({
          operation: "generateBranchName",
          detail: "Invalid model selection.",
        });
      }

      const generated = yield* runOllamaJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      };
    });

    const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
      "OllamaTextGeneration.generateThreadTitle",
    )(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      if (input.modelSelection.provider !== "ollamaLocal") {
        return yield* new TextGenerationError({
          operation: "generateThreadTitle",
          detail: "Invalid model selection.",
        });
      }

      const generated = yield* runOllamaJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizeThreadTitle(generated.title),
      } satisfies ThreadTitleGenerationResult;
    });

    return {
      generateCommitMessage,
      generatePrContent,
      generateBranchName,
      generateThreadTitle,
    } satisfies TextGenerationShape;
  });

export const OllamaTextGenerationLive = Layer.effect(TextGeneration, makeOllamaTextGeneration());

export function makeOllamaTextGenerationLive(options?: OllamaTextGenerationOptions) {
  return Layer.effect(TextGeneration, makeOllamaTextGeneration(options));
}
