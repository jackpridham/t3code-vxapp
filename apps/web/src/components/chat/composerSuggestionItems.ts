import type { ProjectEntry, ProviderKind } from "@t3tools/contracts";

import { basenameOfPath } from "../../vscode-icons";
import type { SkillCatalogEntry } from "~/lib/skillCatalog";
import { buildSkillPromptReference } from "~/lib/skillCatalog";
import type { ComposerCommandItem } from "./ComposerCommandMenu";

export interface SearchableComposerModelOption {
  provider: ProviderKind;
  providerLabel: string;
  slug: string;
  name: string;
  searchSlug: string;
  searchName: string;
  searchProvider: string;
}

export function buildPathComposerItems(entries: readonly ProjectEntry[]): ComposerCommandItem[] {
  return entries.map((entry) => ({
    id: `path:${entry.kind}:${entry.path}`,
    type: "path",
    path: entry.path,
    pathKind: entry.kind,
    label: basenameOfPath(entry.path),
    description: entry.parentPath ?? "",
  }));
}

export function buildSkillComposerItems(
  entries: readonly SkillCatalogEntry[],
): ComposerCommandItem[] {
  return entries.map((entry) => ({
    id: `skill:${entry.name}`,
    type: "skill",
    skillName: entry.name,
    skillMarkdownPath: entry.skillMarkdownPath,
    label: entry.name,
    description: entry.displayPath,
  }));
}

export function buildSlashCommandComposerItems(queryInput: string): ComposerCommandItem[] {
  const slashCommandItems = [
    {
      id: "slash:model",
      type: "slash-command",
      command: "model",
      label: "/model",
      description: "Switch response model for this thread",
    },
    {
      id: "slash:plan",
      type: "slash-command",
      command: "plan",
      label: "/plan",
      description: "Switch this thread into plan mode",
    },
    {
      id: "slash:default",
      type: "slash-command",
      command: "default",
      label: "/default",
      description: "Switch this thread back to normal chat mode",
    },
  ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
  const query = queryInput.trim().toLowerCase();
  if (!query) {
    return [...slashCommandItems];
  }
  return slashCommandItems.filter(
    (item) => item.command.includes(query) || item.label.slice(1).includes(query),
  );
}

export function buildModelComposerItems(
  options: readonly SearchableComposerModelOption[],
  queryInput: string,
): ComposerCommandItem[] {
  const query = queryInput.trim().toLowerCase();
  return options
    .filter(({ searchSlug, searchName, searchProvider }) => {
      if (!query) return true;
      return (
        searchSlug.includes(query) || searchName.includes(query) || searchProvider.includes(query)
      );
    })
    .map(({ provider, providerLabel, slug, name }) => ({
      id: `model:${provider}:${slug}`,
      type: "model",
      provider,
      model: slug,
      label: name,
      description: `${providerLabel} · ${slug}`,
    }));
}

export { buildSkillPromptReference };
