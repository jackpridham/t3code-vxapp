export function getChangeKindTextClass(kind?: string | null): string {
  switch (kind) {
    case "added":
      return "text-success";
    case "modified":
      return "text-warning";
    case "deleted":
      return "text-destructive";
    case "renamed":
      return "text-info";
    default:
      return "text-muted-foreground/80";
  }
}
