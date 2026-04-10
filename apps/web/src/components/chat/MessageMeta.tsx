import { memo } from "react";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { formatTimestamp } from "../../timestampFormat";
import { cn } from "~/lib/utils";

interface MessageMetaProps {
  createdAt: string;
  timestampFormat: TimestampFormat;
  duration?: string | null;
  align?: "left" | "right";
  className?: string;
}

function formatMessageMeta(
  createdAt: string,
  duration: string | null | undefined,
  timestampFormat: TimestampFormat,
): string {
  if (!duration) {
    return formatTimestamp(createdAt, timestampFormat);
  }
  return `${formatTimestamp(createdAt, timestampFormat)} • ${duration}`;
}

export const MessageMeta = memo(function MessageMeta({
  createdAt,
  timestampFormat,
  duration,
  align = "left",
  className,
}: MessageMetaProps) {
  return (
    <p
      className={cn(
        "text-[12px] text-foreground/70",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {formatMessageMeta(createdAt, duration, timestampFormat)}
    </p>
  );
});
