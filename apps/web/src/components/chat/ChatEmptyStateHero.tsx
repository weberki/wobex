import { memo } from "react";

type ChatEmptyStateHeroProps = {
  projectName: string | undefined;
};

export const ChatEmptyStateHero = memo(function ChatEmptyStateHero({
  projectName,
}: ChatEmptyStateHeroProps) {
  return (
    <div className="flex flex-col items-center gap-5 py-16 select-none">
      <div
        data-empty-state-logo-slot
        aria-hidden="true"
        className="size-14 rounded-lg bg-muted/30 border border-border/60"
      />
      <div className="flex flex-col items-center gap-0.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground/90">Let's build</h1>
        {projectName ? (
          <span className="text-lg text-muted-foreground/40">{projectName}</span>
        ) : null}
      </div>
    </div>
  );
});
