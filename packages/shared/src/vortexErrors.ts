import type { AgentsVxappOwnerBoundaryErrorKind, VortexErrorCode } from "@t3tools/contracts";
import { VortexErrorCodeValue } from "@t3tools/contracts";

export interface ResolveVortexErrorDisplayInput {
  readonly authoritySurface?: string | null | undefined;
  readonly code?: VortexErrorCode | null | undefined;
  readonly kind?: AgentsVxappOwnerBoundaryErrorKind | null | undefined;
  readonly message?: string | null | undefined;
  readonly ownerErrorCode?: string | null | undefined;
}

export interface VortexErrorDisplay {
  readonly code: VortexErrorCode;
  readonly title: string;
  readonly message: string;
  readonly ownerErrorCode: string | null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function sanitizeVortexErrorMessage(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const firstLine = value.split("\n")[0] ?? value;
  const withoutStack = firstLine.replace(/\s+at\s+.+$/u, "");
  const withoutPrefix = withoutStack.replace(/^[A-Za-z0-9_]+Error:\s*/u, "");
  return normalizeWhitespace(withoutPrefix);
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function detectCodeFromInput(input: {
  readonly kind: AgentsVxappOwnerBoundaryErrorKind | null;
  readonly message: string;
}): VortexErrorCode {
  if (
    includesAny(input.message, [
      "thread-specific binding resolved a generated workspace for the wrong role",
      "generated workspace for the wrong role",
      "wrong role",
    ])
  ) {
    return VortexErrorCodeValue.OwnerRoleWorkspaceMismatch;
  }

  if (
    includesAny(input.message, [
      "runtime_authority_missing",
      "workspace is required",
      "authoritative role-session workspace is missing",
      "runtime authority",
    ])
  ) {
    return VortexErrorCodeValue.OwnerRuntimeAuthorityMissing;
  }

  if (includesAny(input.message, ["did not provide surface"])) {
    return VortexErrorCodeValue.OwnerSurfaceMissing;
  }

  if (includesAny(input.message, ["is ambiguous"])) {
    return VortexErrorCodeValue.OwnerSurfaceAmbiguous;
  }

  switch (input.kind) {
    case "transport_error":
      return VortexErrorCodeValue.OwnerTransportFailure;
    case "decode_error":
      return VortexErrorCodeValue.OwnerDecodeFailure;
    case "missing_required_field":
      return VortexErrorCodeValue.OwnerMissingRequiredField;
    case "owner_contract_error":
      return VortexErrorCodeValue.OwnerContractFailure;
    default:
      return VortexErrorCodeValue.UnknownVortexFailure;
  }
}

function displayFromCode(
  code: VortexErrorCode,
): Omit<VortexErrorDisplay, "code" | "ownerErrorCode"> {
  switch (code) {
    case VortexErrorCodeValue.OwnerTransportFailure:
      return {
        title: "Owner connection failed",
        message: "T3 could not read authority data from agents-vxapp.",
      };
    case VortexErrorCodeValue.OwnerDecodeFailure:
      return {
        title: "Owner response invalid",
        message: "Agents-vxapp returned authority data in an invalid format.",
      };
    case VortexErrorCodeValue.OwnerMissingRequiredField:
      return {
        title: "Owner payload incomplete",
        message: "Agents-vxapp returned authority data without a required field.",
      };
    case VortexErrorCodeValue.OwnerContractFailure:
      return {
        title: "Owner contract error",
        message: "Agents-vxapp rejected or could not materialize the requested authority surface.",
      };
    case VortexErrorCodeValue.OwnerSurfaceMissing:
      return {
        title: "Owner surface missing",
        message: "Agents-vxapp did not expose the requested authority surface in its manifest.",
      };
    case VortexErrorCodeValue.OwnerSurfaceAmbiguous:
      return {
        title: "Owner surface ambiguous",
        message: "Agents-vxapp exposed multiple commands for the same authority surface.",
      };
    case VortexErrorCodeValue.OwnerRuntimeAuthorityMissing:
      return {
        title: "Runtime authority unavailable",
        message: "Agents-vxapp could not resolve the authoritative runtime workspace for this row.",
      };
    case VortexErrorCodeValue.OwnerRoleWorkspaceMismatch:
      return {
        title: "Role workspace binding mismatch",
        message:
          "Agents-vxapp resolved a generated workspace for the wrong role. Check the thread-specific role binding and generated workspace mapping.",
      };
    case VortexErrorCodeValue.UnknownVortexFailure:
      return {
        title: "Vortex authority error",
        message: "T3 hit an unexpected vortex authority failure.",
      };
  }
}

export function resolveVortexErrorDisplay(
  input: ResolveVortexErrorDisplayInput,
): VortexErrorDisplay {
  const sanitizedMessage = sanitizeVortexErrorMessage(input.message);
  const code =
    input.code ?? detectCodeFromInput({ kind: input.kind ?? null, message: sanitizedMessage });
  const display = displayFromCode(code);

  return {
    code,
    title: display.title,
    message: display.message,
    ownerErrorCode: input.ownerErrorCode ?? null,
  };
}
