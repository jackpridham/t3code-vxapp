import { Badge } from "~/components/ui/badge";

export function RuntimeSourceBadge({ label }: { label: string; status: string }) {
  return (
    <Badge className="h-5 border border-border/70 bg-background/70 px-1.5 text-[10px] font-medium">
      {label}
    </Badge>
  );
}

export function RuntimeValueCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">{label}</p>
      <p className="mt-1 text-xs font-medium text-foreground/90">{value ?? "unknown"}</p>
    </div>
  );
}

export function RuntimeBadgeList({
  emptyLabel,
  items,
}: {
  emptyLabel: string;
  items: readonly string[];
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {items.length > 0 ? (
        items.map((item) => (
          <Badge
            key={item}
            variant="outline"
            className="h-5 px-1.5 text-[10px] font-medium leading-none text-muted-foreground/80"
          >
            {item}
          </Badge>
        ))
      ) : (
        <span className="text-[11px] text-muted-foreground/70">{emptyLabel}</span>
      )}
    </div>
  );
}
