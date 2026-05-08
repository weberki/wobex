import { memo } from "react";
import { GitBranchIcon, PaperclipIcon, PlusIcon, TerminalIcon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { ComposerImageAttachment } from "../../composerDraftStore";
import type { TerminalContextDraft } from "../../lib/terminalContext";

type Props = {
  images: readonly ComposerImageAttachment[];
  terminalContexts: readonly TerminalContextDraft[];
  branchName: string | null;
  onRemoveImage: (id: string) => void;
  onOpenImagePreview: (id: string) => void;
  onRemoveTerminalContext: (id: string) => void;
  onFocusTerminalContext: (id: string) => void;
  onAddImage: () => void;
};

function Pin(props: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  onRemove?: () => void;
  removeAriaLabel?: string;
}) {
  const baseClass =
    "inline-flex items-center gap-1.5 rounded-[14px] border border-border/60 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground";
  const hoverClass = "cursor-pointer hover:text-foreground";

  const content = (
    <>
      {props.icon}
      <span>{props.label}</span>
      {props.onRemove ? (
        <button
          type="button"
          aria-label={props.removeAriaLabel ?? `Remove ${props.label}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onRemove?.();
          }}
          className="ml-0.5 rounded hover:text-foreground"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </>
  );

  // No onClick: static pin
  if (!props.onClick) {
    return <span className={baseClass}>{content}</span>;
  }

  // Has onClick and onRemove: use span + keyDown to avoid nested buttons
  if (props.onRemove) {
    return (
      <span
        className={cn(baseClass, hoverClass)}
        role="button"
        tabIndex={0}
        onClick={props.onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onClick?.();
          }
        }}
      >
        {content}
      </span>
    );
  }

  // Has onClick without onRemove: use native button
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(baseClass, hoverClass, "text-left")}
    >
      {content}
    </button>
  );
}

export const ComposerContextPinRow = memo(function ComposerContextPinRow(props: Props) {
  const hasAny =
    props.images.length > 0 || props.terminalContexts.length > 0 || props.branchName !== null;

  if (!hasAny) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-muted/20 px-2.5 py-1.5">
      {props.images.length > 0 ? (
        <Pin
          icon={<PaperclipIcon className="size-3.5" />}
          label={props.images.length === 1 ? "1 image" : `${props.images.length} images`}
          onClick={() => props.onOpenImagePreview(props.images[0]!.id)}
          onRemove={() => {
            for (const img of props.images) props.onRemoveImage(img.id);
          }}
          removeAriaLabel="Remove images"
        />
      ) : null}
      {props.terminalContexts.map((ctx) => (
        <Pin
          key={ctx.id}
          icon={<TerminalIcon className="size-3.5" />}
          label={ctx.terminalLabel}
          onClick={() => props.onFocusTerminalContext(ctx.id)}
          onRemove={() => props.onRemoveTerminalContext(ctx.id)}
          removeAriaLabel={`Remove terminal context ${ctx.terminalLabel}`}
        />
      ))}
      {props.branchName ? (
        <Pin icon={<GitBranchIcon className="size-3.5" />} label={props.branchName} />
      ) : null}
      <button
        type="button"
        onClick={props.onAddImage}
        className="inline-flex items-center gap-1 rounded-[14px] border border-dashed border-border/60 px-2.5 py-1 text-xs text-muted-foreground/70 hover:text-foreground"
      >
        <PlusIcon className="size-3" />
        add
      </button>
    </div>
  );
});
