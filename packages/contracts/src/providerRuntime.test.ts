import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { ProviderRuntimeEvent } from "./providerRuntime";

const decodeRuntimeEvent = Schema.decodeUnknownSync(ProviderRuntimeEvent);
const encodeRuntimeEvent = Schema.encodeSync(ProviderRuntimeEvent);

function expectRoundTrip(event: unknown) {
  const decoded = decodeRuntimeEvent(event);
  const encoded = encodeRuntimeEvent(decoded);
  expect(encoded).toEqual(event);
  return decoded;
}

describe("ProviderRuntimeEvent", () => {
  it("decodes turn.plan.updated for plan rendering", () => {
    const parsed = decodeRuntimeEvent({
      type: "turn.plan.updated",
      eventId: "event-1",
      provider: "claudeAgent",
      sessionId: "runtime-session-1",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        explanation: "Implement schema updates",
        plan: [
          { step: "Define event union", status: "completed" },
          { step: "Wire adapter mapping", status: "inProgress" },
        ],
      },
    });

    expect(parsed.type).toBe("turn.plan.updated");
    if (parsed.type !== "turn.plan.updated") {
      throw new Error("expected turn.plan.updated");
    }
    expect(parsed.payload.plan).toHaveLength(2);
    expect(parsed.payload.plan[1]?.status).toBe("inProgress");
  });

  it("decodes proposed-plan completion events", () => {
    const parsed = decodeRuntimeEvent({
      type: "turn.proposed.completed",
      eventId: "event-proposed-plan-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        planMarkdown: "# Ship it",
      },
    });

    expect(parsed.type).toBe("turn.proposed.completed");
    if (parsed.type !== "turn.proposed.completed") {
      throw new Error("expected turn.proposed.completed");
    }
    expect(parsed.payload.planMarkdown).toBe("# Ship it");
  });

  it("decodes user-input.requested with structured questions", () => {
    const parsed = decodeRuntimeEvent({
      type: "user-input.requested",
      eventId: "event-2",
      provider: "claudeAgent",
      sessionId: "runtime-session-2",
      createdAt: "2026-02-28T00:00:01.000Z",
      threadId: "thread-2",
      requestId: "request-1",
      payload: {
        questions: [
          {
            id: "sandbox_mode",
            header: "Sandbox",
            question: "Which mode should be used?",
            options: [
              {
                label: "workspace-write",
                description: "Allow edits in workspace only",
              },
              {
                label: "danger-full-access",
                description: "Allow unrestricted access",
              },
            ],
          },
        ],
      },
    });

    expect(parsed.type).toBe("user-input.requested");
    if (parsed.type !== "user-input.requested") {
      throw new Error("expected user-input.requested");
    }
    expect(parsed.payload.questions[0]?.id).toBe("sandbox_mode");
    expect(parsed.payload.questions[0]?.options).toHaveLength(2);
  });

  it("decodes user-input.resolved with answer map", () => {
    const parsed = decodeRuntimeEvent({
      type: "user-input.resolved",
      eventId: "event-3",
      provider: "claudeAgent",
      sessionId: "runtime-session-2",
      createdAt: "2026-02-28T00:00:02.000Z",
      threadId: "thread-2",
      requestId: "request-1",
      payload: {
        answers: {
          sandbox_mode: "workspace-write",
        },
      },
    });

    expect(parsed.type).toBe("user-input.resolved");
    if (parsed.type !== "user-input.resolved") {
      throw new Error("expected user-input.resolved");
    }
    expect(parsed.payload.answers.sandbox_mode).toBe("workspace-write");
  });

  it("decodes ui.command.requested and ui.command.result with capability manifests", () => {
    const requested = expectRoundTrip({
      type: "ui.command.requested",
      eventId: "event-ui-command-requested",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:03.000Z",
      threadId: "thread-3",
      requestId: "ui-command-request-1",
      payload: {
        requestId: "ui-command-request-1",
        correlationId: "ui-command-correlation-1",
        manifest: {
          manifestId: "spa-manifest-1",
          version: 1,
          registeredAt: "2026-02-28T00:00:02.000Z",
          commands: [
            {
              name: "navigate.toRoute",
              deterministic: true,
              requiresConfirmation: false,
              timeoutMs: 1_500,
              renderBlock: {
                type: "table",
                title: "Recurring Quotes",
                columns: [
                  {
                    key: "quoteNumber",
                    label: "Quote #",
                    type: "text",
                  },
                ],
                rows: [
                  {
                    quoteNumber: "Q-1001",
                  },
                ],
                rowActions: [
                  {
                    label: "Open quote",
                    command: "navigate.toRoute",
                    deterministic: true,
                    requiresConfirmation: false,
                    args: {
                      routeName: "quotes.show",
                    },
                  },
                ],
                summary: "Recurring quotes due this month",
              },
            },
          ],
        },
        command: {
          name: "navigate.toRoute",
          deterministic: true,
          requiresConfirmation: false,
          timeoutMs: 1_500,
          renderBlock: {
            type: "table",
            title: "Recurring Quotes",
            columns: [
              {
                key: "quoteNumber",
                label: "Quote #",
                type: "text",
              },
            ],
            rows: [
              {
                quoteNumber: "Q-1001",
              },
            ],
            rowActions: [
              {
                label: "Open quote",
                command: "navigate.toRoute",
                deterministic: true,
                requiresConfirmation: false,
                args: {
                  routeName: "quotes.show",
                },
              },
            ],
            summary: "Recurring quotes due this month",
          },
        },
        args: {
          routeName: "quotes.index",
        },
        advisoryContext: {
          routeSnapshot: {
            pathname: "/quotes",
            params: {
              tab: "generated-this-month",
            },
          },
          pageSnapshot: {
            pageKey: "quotes.index",
            pageTitle: "Recurring quotes",
          },
          userSnapshot: {
            userId: "user-render",
            displayName: "Test User",
          },
          capabilitySnapshot: {
            allowlisted: true,
            commandNames: ["navigate.toRoute"],
          },
        },
        allowlisted: true,
        requestedAt: "2026-02-28T00:00:03.000Z",
      },
    });

    expect(requested.type).toBe("ui.command.requested");
    if (requested.type !== "ui.command.requested") {
      throw new Error("expected ui.command.requested");
    }
    expect(requested.payload.manifest.commands[0]?.name).toBe("navigate.toRoute");
    expect(requested.payload.command.name).toBe("navigate.toRoute");
    expect(requested.payload.allowlisted).toBe(true);
    expect(requested.payload.advisoryContext?.routeSnapshot).toMatchObject({
      pathname: "/quotes",
    });
    expect(requested.payload.advisoryContext?.capabilitySnapshot).toMatchObject({
      allowlisted: true,
    });
    expect(requested.payload.command.renderBlock?.type).toBe("table");

    const renderBlock = expectRoundTrip({
      type: "agent.render_block",
      eventId: "event-render-block-1",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:03.500Z",
      threadId: "thread-3",
      requestId: "render-request-1",
      payload: {
        requestId: "render-request-1",
        block: {
          type: "table",
          title: "Recurring Quotes",
          columns: [
            {
              key: "quoteNumber",
              label: "Quote #",
            },
            {
              key: "generatedDate",
              label: "Generated",
              format: "date",
            },
          ],
          rows: [
            {
              quoteNumber: "Q-1001",
              generatedDate: "2026-02-01",
            },
          ],
          rowActions: [
            {
              label: "Open quote",
              command: "navigate.toRoute",
              deterministic: true,
              requiresConfirmation: false,
              args: {
                routeName: "quotes.show",
                quoteGuid: "quote-1001",
              },
            },
          ],
          summary: "Recurring quotes due this month",
        },
      },
    });

    expect(renderBlock.type).toBe("agent.render_block");
    if (renderBlock.type !== "agent.render_block") {
      throw new Error("expected agent.render_block");
    }
    expect(renderBlock.payload.block.type).toBe("table");
    if (renderBlock.payload.block.type !== "table") {
      throw new Error("expected table render block");
    }
    expect(renderBlock.payload.block.rowActions?.[0]?.command).toBe("navigate.toRoute");

    const summary = expectRoundTrip({
      type: "tool.summary",
      eventId: "event-tool-summary",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:03.600Z",
      threadId: "thread-3",
      turnId: "turn-1",
      raw: {
        source: "claude.sdk.message",
        method: "tool_use_summary",
        payload: {
          tenantId: "tenant-render",
          userId: "user-render",
          auditReference: "audit-render",
          toolUseId: "tool-render",
        },
      },
      payload: {
        summary: "Recurring quotes due this month loaded.",
        precedingToolUseIds: ["tool-use-1"],
      },
    });

    expect(summary.type).toBe("tool.summary");
    if (summary.type !== "tool.summary") {
      throw new Error("expected tool.summary");
    }
    expect(summary.payload.summary).toBe("Recurring quotes due this month loaded.");
    expect(summary.payload.precedingToolUseIds?.[0]).toBe("tool-use-1");

    const result = expectRoundTrip({
      type: "ui.command.result",
      eventId: "event-ui-command-result",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:04.000Z",
      threadId: "thread-3",
      requestId: "ui-command-request-1",
      payload: {
        requestId: "ui-command-request-1",
        correlationId: "ui-command-correlation-1",
        manifestId: "spa-manifest-1",
        command: "navigate.toRoute",
        status: "completed",
        result: {
          routeName: "quotes.index",
        },
        completedAt: "2026-02-28T00:00:04.000Z",
      },
    });

    expect(result.type).toBe("ui.command.result");
    if (result.type !== "ui.command.result") {
      throw new Error("expected ui.command.result");
    }
    expect(result.payload.status).toBe("completed");
    expect(result.payload.correlationId).toBe("ui-command-correlation-1");
    expect(result.payload.command).toBe("navigate.toRoute");
  });

  it("round-trips timeout, confirmation expiry, and pilot table render examples", () => {
    const timedOutResult = expectRoundTrip({
      type: "ui.command.result",
      eventId: "event-ui-command-timeout",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:05.000Z",
      threadId: "thread-timeout-1",
      requestId: "ui-command-timeout-1",
      payload: {
        requestId: "ui-command-timeout-1",
        correlationId: "ui-command-correlation-timeout-1",
        manifestId: "spa-manifest-timeout-1",
        command: "table.applyFilter",
        status: "timed_out",
        error: "UI command timed out waiting for filter confirmation.",
        timedOutAt: "2026-02-28T00:00:05.000Z",
        completedAt: "2026-02-28T00:00:05.000Z",
      },
    });

    expect(timedOutResult.type).toBe("ui.command.result");
    if (timedOutResult.type !== "ui.command.result") {
      throw new Error("expected ui.command.result");
    }
    expect(timedOutResult.payload.status).toBe("timed_out");
    expect(timedOutResult.payload.timedOutAt).toBe("2026-02-28T00:00:05.000Z");

    const confirmationExpired = expectRoundTrip({
      type: "request.resolved",
      eventId: "event-confirmation-expired",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:06.000Z",
      threadId: "thread-timeout-1",
      requestId: "approval-request-1",
      payload: {
        requestType: "command_execution_approval",
        decision: "expired",
        resolution: {
          operationId: "approval-request-1",
          reason: "User confirmation window expired.",
        },
      },
    });

    expect(confirmationExpired.type).toBe("request.resolved");
    if (confirmationExpired.type !== "request.resolved") {
      throw new Error("expected request.resolved");
    }
    expect(confirmationExpired.payload.decision).toBe("expired");

    const pilotRender = expectRoundTrip({
      type: "agent.render_block",
      eventId: "event-pilot-render-block",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:07.000Z",
      threadId: "thread-pilot-1",
      requestId: "render-pilot-1",
      payload: {
        requestId: "render-pilot-1",
        block: {
          type: "table",
          title: "Recurring Quotes Generated This Month",
          columns: [
            {
              key: "quoteNumber",
              label: "Quote #",
            },
            {
              key: "generatedDate",
              label: "Generated",
              format: "date",
            },
            {
              key: "customerName",
              label: "Customer",
            },
          ],
          rows: [
            {
              quoteNumber: "Q-2001",
              generatedDate: "2026-02-01",
              customerName: "Example Co",
            },
          ],
          rowActions: [
            {
              label: "Open quote",
              command: "navigate.toRoute",
              deterministic: true,
              requiresConfirmation: false,
              args: {
                routeName: "quotes.show",
                quoteGuid: "quote-2001",
              },
            },
          ],
          summary: "Pilot recurring quotes generated this month",
        },
      },
    });

    expect(pilotRender.type).toBe("agent.render_block");
    if (pilotRender.type !== "agent.render_block") {
      throw new Error("expected agent.render_block");
    }
    expect(pilotRender.payload.block.type).toBe("table");
  });

  it("round-trips session handoff, auth state, and MCP oauth completion events", () => {
    const sessionStarted = expectRoundTrip({
      type: "session.started",
      eventId: "event-session-started",
      provider: "codex",
      createdAt: "2026-02-28T00:00:08.000Z",
      threadId: "thread-auth-1",
      payload: {
        message: "Runtime session accepted with existing tenant session handoff.",
        resume: {
          handoffTokenId: "handoff-1",
        },
      },
    });

    expect(sessionStarted.type).toBe("session.started");
    if (sessionStarted.type !== "session.started") {
      throw new Error("expected session.started");
    }
    expect(sessionStarted.payload.resume).toMatchObject({
      handoffTokenId: "handoff-1",
    });

    const sessionConfigured = expectRoundTrip({
      type: "session.configured",
      eventId: "event-session-configured",
      provider: "codex",
      createdAt: "2026-02-28T00:00:08.100Z",
      threadId: "thread-auth-1",
      payload: {
        config: {
          authMode: "session-handoff",
          tenantId: "tenant-7",
          userId: "user-19",
        },
      },
    });

    expect(sessionConfigured.type).toBe("session.configured");
    if (sessionConfigured.type !== "session.configured") {
      throw new Error("expected session.configured");
    }
    expect(sessionConfigured.payload.config).toMatchObject({
      authMode: "session-handoff",
      tenantId: "tenant-7",
      userId: "user-19",
    });

    const authStatus = expectRoundTrip({
      type: "auth.status",
      eventId: "event-auth-status",
      provider: "codex",
      createdAt: "2026-02-28T00:00:08.200Z",
      threadId: "thread-auth-1",
      payload: {
        isAuthenticating: false,
        output: ["Authenticated runtime session handoff."],
      },
    });

    expect(authStatus.type).toBe("auth.status");
    if (authStatus.type !== "auth.status") {
      throw new Error("expected auth.status");
    }
    expect(authStatus.payload.isAuthenticating).toBe(false);

    const oauthCompleted = expectRoundTrip({
      type: "mcp.oauth.completed",
      eventId: "event-mcp-oauth-completed",
      provider: "codex",
      createdAt: "2026-02-28T00:00:08.300Z",
      threadId: "thread-auth-1",
      payload: {
        success: true,
        name: "google-drive",
      },
    });

    expect(oauthCompleted.type).toBe("mcp.oauth.completed");
    if (oauthCompleted.type !== "mcp.oauth.completed") {
      throw new Error("expected mcp.oauth.completed");
    }
    expect(oauthCompleted.payload.success).toBe(true);
    expect(oauthCompleted.payload.name).toBe("google-drive");
  });

  it("rejects legacy message.delta type", () => {
    expect(() =>
      decodeRuntimeEvent({
        type: "message.delta",
        eventId: "event-4",
        provider: "codex",
        sessionId: "runtime-session-3",
        createdAt: "2026-02-28T00:00:03.000Z",
        payload: { delta: "legacy" },
      }),
    ).toThrow();
  });

  it("rejects empty branded canonical ids", () => {
    expect(() =>
      decodeRuntimeEvent({
        type: "runtime.error",
        eventId: "event-5",
        provider: "codex",
        sessionId: "runtime-session-3",
        createdAt: "2026-02-28T00:00:03.000Z",
        threadId: "   ",
        payload: { message: "boom" },
      }),
    ).toThrow();
  });

  it("rejects malformed UI command request and result payloads", () => {
    expect(() =>
      decodeRuntimeEvent({
        type: "ui.command.requested",
        eventId: "event-ui-command-request-invalid",
        provider: "claudeAgent",
        createdAt: "2026-02-28T00:00:08.000Z",
        threadId: "thread-invalid-1",
        requestId: "ui-command-request-invalid",
        payload: {
          requestId: "ui-command-request-invalid",
          correlationId: "ui-command-correlation-invalid",
          manifest: {
            manifestId: "spa-manifest-invalid",
            version: 1,
            registeredAt: "2026-02-28T00:00:08.000Z",
            commands: [
              {
                name: "navigate.toRoute",
              },
            ],
          },
          command: {
            name: "navigate.toRoute",
          },
          args: [],
          allowlisted: true,
          requestedAt: "2026-02-28T00:00:08.000Z",
        },
      }),
    ).toThrow();

    expect(() =>
      decodeRuntimeEvent({
        type: "ui.command.result",
        eventId: "event-ui-command-result-invalid",
        provider: "claudeAgent",
        createdAt: "2026-02-28T00:00:09.000Z",
        threadId: "thread-invalid-1",
        requestId: "ui-command-request-invalid",
        payload: {
          requestId: "ui-command-request-invalid",
          correlationId: "ui-command-correlation-invalid",
          manifestId: "spa-manifest-invalid",
          command: "navigate.toRoute",
          status: "timeout",
          completedAt: "2026-02-28T00:00:09.000Z",
        },
      }),
    ).toThrow();
  });

  it("decodes normalized thread token usage snapshots", () => {
    const parsed = decodeRuntimeEvent({
      type: "thread.token-usage.updated",
      eventId: "event-token-usage-1",
      provider: "claudeAgent",
      createdAt: "2026-02-28T00:00:04.000Z",
      threadId: "thread-1",
      payload: {
        usage: {
          usedTokens: 31251,
          maxTokens: 200000,
          toolUses: 25,
          durationMs: 43567,
        },
      },
    });

    expect(parsed.type).toBe("thread.token-usage.updated");
    if (parsed.type !== "thread.token-usage.updated") {
      throw new Error("expected thread.token-usage.updated");
    }
    expect(parsed.payload.usage.maxTokens).toBe(200000);
    expect(parsed.payload.usage.usedTokens).toBe(31251);
  });
});
