import { type ComponentProps, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME } from "./composerPickerStyles";

type PickerTriggerButtonProps = {
  icon?: ReactNode;
  label: ReactNode;
  compact?: boolean;
} & Omit<ComponentProps<typeof Button>, "children" | "size">;

export function PickerTriggerButton({
  icon,
  label,
  compact = false,
  className,
  variant = "ghost",
  ...buttonProps
}: PickerTriggerButtonProps) {
  return (
    <Button
      {...buttonProps}
      size="sm"
      variant={variant}
      data-composer-picker-trigger="true"
      className={cn(
        "min-w-0 justify-start overflow-hidden whitespace-nowrap px-1.5 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
        COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
        compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56",
        className,
      )}
    >
      <span
        className={cn(
          "flex min-w-0 w-full items-center gap-2 overflow-hidden",
          compact ? "max-w-36" : undefined,
        )}
      >
        {icon ? (
          <span className="inline-flex size-4 shrink-0 items-center justify-center">{icon}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
      </span>
    </Button>
  );
}
