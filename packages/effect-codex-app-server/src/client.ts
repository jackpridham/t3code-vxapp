import { Effect, Layer, Schema, Scope, ServiceMap, Stdio } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as CodexRpc from "./_generated/meta.gen.ts";
import * as CodexError from "./errors.ts";
import * as CodexProtocol from "./protocol.ts";
import {
  decodeNotificationPayload,
  decodeOptionalPayload,
  encodeOptionalPayload,
  runHandler,
} from "./_internal/shared.ts";
import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";

export interface CodexAppServerClientOptions {
  readonly logIncoming?: boolean;
  readonly logOutgoing?: boolean;
  readonly logger?: (
    event: CodexProtocol.CodexAppServerProtocolLogEvent,
  ) => Effect.Effect<void, never>;
}

interface CodexAppServerClientRaw {
  readonly notifications: CodexProtocol.CodexAppServerPatchedProtocol["incomingNotifications"];
  readonly requests: CodexProtocol.CodexAppServerPatchedProtocol["incomingRequests"];
  readonly request: CodexProtocol.CodexAppServerPatchedProtocol["request"];
  readonly notify: CodexProtocol.CodexAppServerPatchedProtocol["notify"];
  readonly respond: CodexProtocol.CodexAppServerPatchedProtocol["respond"];
  readonly respondError: CodexProtocol.CodexAppServerPatchedProtocol["respondError"];
}

export interface CodexAppServerClientShape {
  readonly raw: CodexAppServerClientRaw;
  readonly request: <M extends CodexRpc.ClientRequestMethod>(
    method: M,
    payload: CodexRpc.ClientRequestParamsByMethod[M],
  ) => Effect.Effect<CodexRpc.ClientRequestResponsesByMethod[M], CodexError.CodexAppServerError>;
  readonly notify: <M extends CodexRpc.ClientNotificationMethod>(
    method: M,
    payload: CodexRpc.ClientNotificationParamsByMethod[M],
  ) => Effect.Effect<void, CodexError.CodexAppServerError>;
  readonly handleServerRequest: <M extends CodexRpc.ServerRequestMethod>(
    method: M,
    handler: (
      payload: CodexRpc.ServerRequestParamsByMethod[M],
    ) => Effect.Effect<CodexRpc.ServerRequestResponsesByMethod[M], CodexError.CodexAppServerError>,
  ) => Effect.Effect<void>;
  readonly handleServerNotification: <M extends CodexRpc.ServerNotificationMethod>(
    method: M,
    handler: (
      payload: CodexRpc.ServerNotificationParamsByMethod[M],
    ) => Effect.Effect<void, CodexError.CodexAppServerError>,
  ) => Effect.Effect<void>;
  readonly handleUnknownServerRequest: (
    handler: (
      method: string,
      params: unknown,
    ) => Effect.Effect<unknown, CodexError.CodexAppServerError>,
  ) => Effect.Effect<void>;
  readonly handleUnknownServerNotification: (
    handler: (
      method: string,
      params: unknown,
    ) => Effect.Effect<void, CodexError.CodexAppServerError>,
  ) => Effect.Effect<void>;
}

export class CodexAppServerClient extends ServiceMap.Service<
  CodexAppServerClient,
  CodexAppServerClientShape
>()("effect-codex-app-server/CodexAppServerClient") {}

type ServerRequestHandler = (
  payload: unknown,
) => Effect.Effect<unknown, CodexError.CodexAppServerError>;
type ServerNotificationHandler = (
  payload: unknown,
) => Effect.Effect<void, CodexError.CodexAppServerError>;

const LEGACY_APPROVALS_REVIEWER = "auto_review";
const NORMALIZED_APPROVALS_REVIEWER = "guardian_subagent";
const APPROVALS_REVIEWER_KEYS = new Set(["approvalsReviewer", "approvals_reviewer"]);

export const normalizeLegacyApprovalsReviewerPayload = (payload: unknown): unknown => {
  if (Array.isArray(payload)) {
    let changed = false;
    const normalized = payload.map((item) => {
      const next = normalizeLegacyApprovalsReviewerPayload(item);
      changed ||= next !== item;
      return next;
    });
    return changed ? normalized : payload;
  }

  if (typeof payload !== "object" || payload === null) {
    return payload;
  }

  let changed = false;
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    const next =
      APPROVALS_REVIEWER_KEYS.has(key) && value === LEGACY_APPROVALS_REVIEWER
        ? NORMALIZED_APPROVALS_REVIEWER
        : normalizeLegacyApprovalsReviewerPayload(value);
    normalized[key] = next;
    changed ||= next !== value;
  }

  return changed ? normalized : payload;
};

const normalizeLegacyApprovalsReviewerTyped = <A>(payload: A): A =>
  normalizeLegacyApprovalsReviewerPayload(payload) as A;

export const make = Effect.fn("effect-codex-app-server/CodexAppServerClient.make")(function* (
  stdio: Stdio.Stdio,
  options: CodexAppServerClientOptions = {},
  terminationError?: Effect.Effect<CodexError.CodexAppServerError>,
): Effect.fn.Return<CodexAppServerClientShape, never, Scope.Scope> {
  const requestHandlers = new Map<string, ServerRequestHandler>();
  const notificationHandlers = new Map<string, Array<ServerNotificationHandler>>();
  let unknownRequestHandler:
    | ((method: string, params: unknown) => Effect.Effect<unknown, CodexError.CodexAppServerError>)
    | undefined;
  let unknownNotificationHandler:
    | ((method: string, params: unknown) => Effect.Effect<void, CodexError.CodexAppServerError>)
    | undefined;

  const getServerRequestParamSchema = <M extends CodexRpc.ServerRequestMethod>(
    method: M,
  ):
    | Schema.Codec<CodexRpc.ServerRequestParamsByMethod[M], CodexRpc.ServerRequestParamsByMethod[M]>
    | undefined => CodexRpc.SERVER_REQUEST_PARAMS[method] as never;

  const getServerRequestResponseSchema = <M extends CodexRpc.ServerRequestMethod>(
    method: M,
  ):
    | Schema.Codec<
        CodexRpc.ServerRequestResponsesByMethod[M],
        CodexRpc.ServerRequestResponsesByMethod[M]
      >
    | undefined => CodexRpc.SERVER_REQUEST_RESPONSES[method] as never;

  const getClientRequestParamSchema = <M extends CodexRpc.ClientRequestMethod>(
    method: M,
  ):
    | Schema.Codec<CodexRpc.ClientRequestParamsByMethod[M], CodexRpc.ClientRequestParamsByMethod[M]>
    | undefined => CodexRpc.CLIENT_REQUEST_PARAMS[method] as never;

  const getClientRequestResponseSchema = <M extends CodexRpc.ClientRequestMethod>(
    method: M,
  ):
    | Schema.Codec<
        CodexRpc.ClientRequestResponsesByMethod[M],
        CodexRpc.ClientRequestResponsesByMethod[M]
      >
    | undefined => CodexRpc.CLIENT_REQUEST_RESPONSES[method] as never;

  const getClientNotificationParamSchema = <M extends CodexRpc.ClientNotificationMethod>(
    method: M,
  ):
    | Schema.Codec<
        CodexRpc.ClientNotificationParamsByMethod[M],
        CodexRpc.ClientNotificationParamsByMethod[M]
      >
    | undefined => CodexRpc.CLIENT_NOTIFICATION_PARAMS[method] as never;

  const dispatchNotification = (
    notification: CodexProtocol.CodexAppServerIncomingNotification,
  ): Effect.Effect<void, never> => {
    const schema =
      notification.method in CodexRpc.SERVER_NOTIFICATION_PARAMS
        ? CodexRpc.SERVER_NOTIFICATION_PARAMS[
            notification.method as CodexRpc.ServerNotificationMethod
          ]
        : undefined;
    const handlers = notificationHandlers.get(notification.method) ?? [];

    if (schema) {
      return decodeNotificationPayload(
        notification.method,
        schema,
        normalizeLegacyApprovalsReviewerPayload(notification.params),
      ).pipe(
        Effect.flatMap((decoded) =>
          Effect.forEach(handlers, (handler) => handler(decoded), { discard: true }),
        ),
        Effect.catch(() => Effect.void),
      );
    }

    return unknownNotificationHandler
      ? unknownNotificationHandler(notification.method, notification.params).pipe(
          Effect.catch(() => Effect.void),
        )
      : Effect.void;
  };

  const dispatchRequest = (
    request: CodexProtocol.CodexAppServerIncomingRequest,
  ): Effect.Effect<unknown, CodexError.CodexAppServerError> => {
    if (request.method in CodexRpc.SERVER_REQUEST_PARAMS) {
      const method = request.method as CodexRpc.ServerRequestMethod;
      const payloadSchema = getServerRequestParamSchema(method);
      const responseSchema = getServerRequestResponseSchema(method);
      const handler = requestHandlers.get(method);

      return decodeOptionalPayload(
        method,
        payloadSchema,
        normalizeLegacyApprovalsReviewerPayload(request.params),
      ).pipe(
        Effect.flatMap((decoded) => runHandler(handler, decoded, method)),
        Effect.flatMap((result) =>
          encodeOptionalPayload(
            method,
            responseSchema,
            normalizeLegacyApprovalsReviewerTyped(result),
          ),
        ),
      );
    }

    return unknownRequestHandler
      ? unknownRequestHandler(request.method, request.params)
      : Effect.fail(CodexError.CodexAppServerRequestError.methodNotFound(request.method));
  };

  const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
    stdio,
    ...(terminationError ? { terminationError } : {}),
    ...(options.logIncoming !== undefined ? { logIncoming: options.logIncoming } : {}),
    ...(options.logOutgoing !== undefined ? { logOutgoing: options.logOutgoing } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    onNotification: dispatchNotification,
    onRequest: dispatchRequest,
  });

  const request = <M extends CodexRpc.ClientRequestMethod>(
    method: M,
    payload: CodexRpc.ClientRequestParamsByMethod[M],
  ): Effect.Effect<CodexRpc.ClientRequestResponsesByMethod[M], CodexError.CodexAppServerError> =>
    encodeOptionalPayload(
      method,
      getClientRequestParamSchema(method),
      normalizeLegacyApprovalsReviewerTyped(payload),
    ).pipe(
      Effect.flatMap((encoded) => transport.request(method, encoded)),
      Effect.flatMap(
        (
          raw,
        ): Effect.Effect<
          CodexRpc.ClientRequestResponsesByMethod[M],
          CodexError.CodexAppServerError
        > =>
          decodeOptionalPayload(
            method,
            getClientRequestResponseSchema(method),
            normalizeLegacyApprovalsReviewerPayload(raw),
          ),
      ),
    );

  const notify = <M extends CodexRpc.ClientNotificationMethod>(
    method: M,
    payload: CodexRpc.ClientNotificationParamsByMethod[M],
  ) =>
    encodeOptionalPayload(
      method,
      getClientNotificationParamSchema(method),
      normalizeLegacyApprovalsReviewerTyped(payload),
    ).pipe(Effect.flatMap((encoded) => transport.notify(method, encoded)));

  return CodexAppServerClient.of({
    raw: {
      notifications: transport.incomingNotifications,
      requests: transport.incomingRequests,
      request: transport.request,
      notify: transport.notify,
      respond: transport.respond,
      respondError: transport.respondError,
    },
    request,
    notify,
    handleServerRequest: (method, handler) =>
      Effect.sync(() => {
        requestHandlers.set(method, handler as ServerRequestHandler);
      }),
    handleServerNotification: (method, handler) =>
      Effect.sync(() => {
        const current = notificationHandlers.get(method) ?? [];
        current.push(handler as ServerNotificationHandler);
        notificationHandlers.set(method, current);
      }),
    handleUnknownServerRequest: (handler) =>
      Effect.sync(() => {
        unknownRequestHandler = handler;
      }),
    handleUnknownServerNotification: (handler) =>
      Effect.sync(() => {
        unknownNotificationHandler = handler;
      }),
  });
});

export const layerChildProcess = (
  handle: ChildProcessSpawner.ChildProcessHandle,
  options: CodexAppServerClientOptions = {},
): Layer.Layer<CodexAppServerClient> => {
  const stdio = makeChildStdio(handle);
  const terminationError = makeTerminationError(handle);
  return Layer.effect(CodexAppServerClient, make(stdio, options, terminationError));
};

export interface CodexAppServerCommandLayerOptions extends CodexAppServerClientOptions {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export const layerCommand = (
  options: CodexAppServerCommandLayerOptions,
): Layer.Layer<
  CodexAppServerClient,
  CodexError.CodexAppServerSpawnError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Layer.effect(
    CodexAppServerClient,
    Effect.acquireRelease(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const command = ChildProcess.make(options.command, [...(options.args ?? [])], {
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
          shell: process.platform === "win32",
        });
        return yield* spawner.spawn(command).pipe(
          Effect.mapError(
            (cause) =>
              new CodexError.CodexAppServerSpawnError({
                command: [options.command, ...(options.args ?? [])].join(" "),
                cause,
              }),
          ),
        );
      }),
      (handle) => handle.kill().pipe(Effect.orDie),
    ).pipe(
      Effect.flatMap((handle) =>
        make(makeChildStdio(handle), options, makeTerminationError(handle)),
      ),
    ),
  );
