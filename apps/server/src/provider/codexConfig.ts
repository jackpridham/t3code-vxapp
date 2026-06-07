export function readTopLevelTomlModelProvider(content: string): string | undefined {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      // For this narrow use case, only the root config keys matter.
      // Once a TOML table begins, later keys are no longer top-level.
      return undefined;
    }

    const match = trimmed.match(/^model_provider\s*=\s*["']([^"']+)["']/);
    if (match) return match[1];
  }
  return undefined;
}
