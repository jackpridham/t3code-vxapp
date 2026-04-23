import { basenameOfPath } from "../vscode-icons";
import { parseSkillPromptReference } from "./skillCatalog";

export interface SkillReferenceDisplay {
  kind: "skill";
  label: string;
  originalPath: string;
}

export function resolveSkillReferenceDisplay(pathValue: string): SkillReferenceDisplay | null {
  const reference = parseSkillPromptReference(pathValue);
  if (!reference) {
    return null;
  }

  return {
    kind: "skill",
    label: reference.skillName,
    originalPath: reference.skillMarkdownPath,
  };
}

export function labelForMentionPath(pathValue: string): string {
  return resolveSkillReferenceDisplay(pathValue)?.label ?? basenameOfPath(pathValue);
}
