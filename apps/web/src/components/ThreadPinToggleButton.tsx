import { PinIcon } from "lucide-react";
import type React from "react";
import { cn } from "~/lib/utils";

export function ThreadPinToggleButton({
  pinned,
  className,
  onToggle,
}: {
  pinned: boolean;
  className?: string;
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = pinned ? "Unpin thread" : "Pin thread";

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pinned}
      title={label}
      data-thread-selection-safe
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        pinned && "text-foreground",
        className,
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle(event);
      }}
    >
      <PinIcon className="size-3.5" />
    </button>
  );
}
