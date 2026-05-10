"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

type DialogCloseButtonProps = Omit<React.ComponentProps<typeof Button>, "size" | "variant"> & {
  title?: string;
};

export const DialogCloseButton = React.forwardRef<HTMLButtonElement, DialogCloseButtonProps>(
  function DialogCloseButton({ className, title = "Close", ...props }, ref) {
    return (
      <Button
        aria-label={title}
        className={cn("cursor-pointer", className)}
        ref={ref}
        size="icon"
        title={title}
        variant="ghost"
        {...props}
      >
        <XIcon />
      </Button>
    );
  },
);
