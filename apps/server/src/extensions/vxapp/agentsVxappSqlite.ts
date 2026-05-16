const DEFAULT_AGENTS_VXAPP_ROOT = "/home/gizmo/agents-vxapp";

export const AGENTS_VXAPP_ROOT =
  process.env.T3_AGENTS_VXAPP_ROOT?.trim() || DEFAULT_AGENTS_VXAPP_ROOT;
