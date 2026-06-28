let nextServerRequestId = 10_000;
let pendingSkillsListRequestId: number | string | null = null;
let pendingUserInputRequestId: number | null = null;

const writeMessage = (message: unknown) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const respond = (id: number | string, result: unknown) => {
  writeMessage({ id, result });
};

const respondError = (id: number | string, code: number, message: string) => {
  writeMessage({
    id,
    error: {
      code,
      message,
    },
  });
};

const sendRequest = (method: string, params: unknown) => {
  const id = nextServerRequestId++;
  writeMessage({ id, method, params });
  return id;
};

const makeThreadResponse = (threadId: string) => ({
  approvalPolicy: "never",
  approvalsReviewer: "auto_review",
  cwd: process.cwd(),
  model: "gpt-5.3-codex",
  modelProvider: "openai",
  sandbox: {
    type: "dangerFullAccess",
  },
  thread: {
    cliVersion: "mock",
    createdAt: 1_797_984_000,
    cwd: process.cwd(),
    ephemeral: false,
    id: threadId,
    modelProvider: "openai",
    preview: "Legacy approval reviewer thread",
    source: "appServer",
    status: {
      type: "idle",
    },
    turns: [],
    updatedAt: 1_797_984_000,
  },
});

const handleMethod = (message: Record<string, unknown>) => {
  const method = message.method;
  if (typeof method !== "string") {
    return;
  }

  switch (method) {
    case "initialize": {
      respond(message.id as number | string, {
        userAgent: "mock-codex-app-server",
        codexHome: process.cwd(),
        platformFamily: process.platform === "win32" ? "windows" : "unix",
        platformOs: process.platform === "darwin" ? "macos" : process.platform,
      });
      return;
    }
    case "initialized": {
      writeMessage({
        method: "item/agentMessage/delta",
        params: {
          delta: "Mock server is ready.",
          itemId: "item-1",
          threadId: "thread-1",
          turnId: "turn-1",
        },
      });
      return;
    }
    case "account/read": {
      respond(message.id as number | string, {
        account: {
          type: "chatgpt",
          email: "mock@example.com",
          planType: "plus",
        },
        requiresOpenaiAuth: false,
      });
      return;
    }
    case "thread/resume": {
      respond(message.id as number | string, makeThreadResponse("legacy-thread"));
      return;
    }
    case "skills/list": {
      pendingSkillsListRequestId = message.id as number | string;
      pendingUserInputRequestId = sendRequest("item/tool/requestUserInput", {
        itemId: "item-approval-1",
        threadId: "thread-1",
        turnId: "turn-1",
        questions: [
          {
            id: "approved",
            header: "Approve",
            question: "Continue with the mock skills request?",
            options: [
              {
                label: "yes",
                description: "Approve the request",
              },
            ],
          },
        ],
      });
      return;
    }
    default: {
      if (message.id !== undefined) {
        respondError(message.id as number | string, -32601, `Unhandled request: ${method}`);
      }
    }
  }
};

const handleResponse = (message: Record<string, unknown>) => {
  if (message.id !== pendingUserInputRequestId) {
    return;
  }

  pendingUserInputRequestId = null;

  respond(pendingSkillsListRequestId!, {
    data: [
      {
        cwd: process.cwd(),
        errors: [],
        skills: [],
      },
    ],
  });
  pendingSkillsListRequestId = null;
};

let remainder = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  remainder += chunk;
  const lines = remainder.split("\n");
  remainder = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const message = JSON.parse(trimmed) as Record<string, unknown>;
    if ("method" in message) {
      handleMethod(message);
      continue;
    }
    if ("id" in message) {
      handleResponse(message);
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
