import { Schema } from "effect";
import type { VortexErrorResponse } from "@t3tools/contracts";
import {
  resolveVortexErrorDisplay,
  sanitizeVortexErrorMessage,
} from "@t3tools/shared/vortexErrors";
import { VortexAppsError } from "./Services/VortexApps.ts";
import { AgentsVxappOwnerClientError } from "./agentsVxappOwnerClient.ts";
import { AgentsVxappControlPlaneError } from "./Services/AgentsVxappControlPlane.ts";
import { AgentsVxappSidebarError } from "./Services/AgentsVxappSidebar.ts";

const isAgentsVxappSidebarError = Schema.is(AgentsVxappSidebarError);
const isAgentsVxappControlPlaneError = Schema.is(AgentsVxappControlPlaneError);
const isVortexAppsError = Schema.is(VortexAppsError);

function buildGenericErrorResponse(message: string): VortexErrorResponse {
  return {
    code: "99",
    title: "Server request failed",
    message: sanitizeVortexErrorMessage(message) || "An unexpected server error occurred.",
    ownerErrorCode: null,
  };
}

export function buildVortexWebSocketErrorResponse(error: unknown): VortexErrorResponse {
  if (error instanceof AgentsVxappOwnerClientError) {
    return {
      ...resolveVortexErrorDisplay({
        authoritySurface: error.authoritySurface,
        kind: "owner_contract_error",
        message: error.message,
        ownerErrorCode: error.ownerErrorCode,
      }),
      details: error.details,
      hints: [...error.hints],
    };
  }

  if (isAgentsVxappSidebarError(error)) {
    return {
      ...resolveVortexErrorDisplay({
        authoritySurface: error.authoritySurface ?? null,
        kind: "owner_contract_error",
        message: error.message,
        ownerErrorCode: error.ownerErrorCode ?? null,
      }),
      details: error.details ?? null,
      hints: error.hints ?? [],
    };
  }

  if (isAgentsVxappControlPlaneError(error)) {
    return {
      ...resolveVortexErrorDisplay({
        authoritySurface: error.authoritySurface ?? null,
        kind: "owner_contract_error",
        message: error.detail,
        ownerErrorCode: error.ownerErrorCode ?? null,
      }),
      details: error.details ?? null,
      hints: error.hints ?? [],
    };
  }

  if (isVortexAppsError(error)) {
    return buildGenericErrorResponse(error.detail);
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return buildGenericErrorResponse(error.message);
  }

  return buildGenericErrorResponse("An unexpected server error occurred.");
}
