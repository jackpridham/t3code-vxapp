import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Expands shell-style home paths before passing them to spawned processes.
 * Child process env values are not shell-expanded, so CODEX_HOME=~/.codex
 * must be normalized by the server first.
 */
export function expandHomePath(value: string): string {
  if (!value) return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}
