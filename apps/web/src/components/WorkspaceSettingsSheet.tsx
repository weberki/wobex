import { CheckIcon } from "lucide-react";
import { type ReactNode } from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "./ui/sheet";
import {
  buildTerminalPaneLayoutFromPreset,
  type TerminalPaneLayoutNode,
} from "../terminalPaneLayout";
import {
  WORKSPACE_TERMINAL_LAYOUT_PRESETS,
  type WorkspaceTerminalLayoutPresetId,
} from "../workspaceTerminalLayoutPresets";

function WorkspaceLayoutPreviewNode(props: {
  node: TerminalPaneLayoutNode;
  activeTerminalId: string | null | undefined;
}) {
  if (props.node.type === "terminal") {
    const isActive = props.node.activeTerminalId === props.activeTerminalId;
    const terminalCount = props.node.terminalIds.length;
    return (
      <div
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-[10px] border p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
          isActive
            ? "border-primary/50 bg-primary/10"
            : "border-border/70 bg-background/92 dark:bg-background/60",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Terminal
          </div>
          <Badge variant={isActive ? "default" : "outline"} size="sm" className="shrink-0">
            {terminalCount}
          </Badge>
        </div>
        <div className="mt-auto text-xs font-medium text-foreground">
          {isActive ? "Active" : "Idle"}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 gap-1.5",
        props.node.direction === "horizontal" ? "flex-row" : "flex-col",
      )}
    >
      {props.node.children.map((child) => (
        <div key={workspaceLayoutPreviewNodeKey(child)} className="flex min-h-0 min-w-0 flex-1">
          <WorkspaceLayoutPreviewNode node={child} activeTerminalId={props.activeTerminalId} />
        </div>
      ))}
    </div>
  );
}

function workspaceLayoutPreviewNodeKey(node: TerminalPaneLayoutNode): string {
  if (node.type === "terminal") {
    return `terminal:${node.paneId}:${node.terminalIds.join(",")}:${node.activeTerminalId}`;
  }
  return `split:${node.id}:${node.direction}`;
}

function WorkspaceLayoutPresetPreview(props: {
  presetId: WorkspaceTerminalLayoutPresetId;
  activeTerminalId: string | null | undefined;
  terminalIds: readonly string[];
}) {
  const layout = buildTerminalPaneLayoutFromPreset({
    presetId: props.presetId,
    terminalIds: props.terminalIds,
    activeTerminalId: props.activeTerminalId,
  });

  return (
    <div className="relative h-24 overflow-hidden rounded-[10px] border border-border/80 bg-card/90 p-1.5">
      <WorkspaceLayoutPreviewNode node={layout} activeTerminalId={props.activeTerminalId} />
    </div>
  );
}

export interface WorkspaceSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceTitle?: string;
  selectedPresetId: WorkspaceTerminalLayoutPresetId;
  onSelectPreset: (presetId: WorkspaceTerminalLayoutPresetId) => void;
  terminalIds?: readonly string[];
  activeTerminalId?: string | null;
  footer?: ReactNode;
}

export function WorkspaceSettingsSheet(props: WorkspaceSettingsSheetProps) {
  const previewTerminalIds = props.terminalIds ?? ["default"];
  const activeTerminalId = props.activeTerminalId ?? previewTerminalIds[0] ?? null;
  const selectedPreset = WORKSPACE_TERMINAL_LAYOUT_PRESETS.find(
    (preset) => preset.id === props.selectedPresetId,
  );

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetPopup side="right" className="w-[min(92vw,460px)] max-w-[460px]" keepMounted>
        <SheetHeader>
          <SheetTitle>Workspace settings</SheetTitle>
          <SheetDescription>
            {props.workspaceTitle
              ? `Choose how terminals are arranged inside ${props.workspaceTitle}.`
              : "Choose how terminals are arranged for this workspace."}
          </SheetDescription>
        </SheetHeader>

        <SheetPanel className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">Layout preset</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Presentation only. Terminal membership and project ownership stay unchanged.
                </div>
              </div>
              <Badge variant="outline" size="sm">
                {previewTerminalIds.length} terminal{previewTerminalIds.length === 1 ? "" : "s"}
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {WORKSPACE_TERMINAL_LAYOUT_PRESETS.map((preset) => {
                const isSelected = preset.id === props.selectedPresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn(
                      "group rounded-2xl border p-3 text-left transition-colors",
                      isSelected
                        ? "border-primary/60 bg-primary/6 shadow-sm"
                        : "border-border/80 bg-card/50 hover:border-foreground/18 hover:bg-accent/45",
                    )}
                    aria-pressed={isSelected}
                    onClick={() => props.onSelectPreset(preset.id)}
                  >
                    <WorkspaceLayoutPresetPreview
                      presetId={preset.id}
                      activeTerminalId={activeTerminalId}
                      terminalIds={previewTerminalIds}
                    />

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-foreground">{preset.title}</div>
                      <div className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {preset.slotCount} pane{preset.slotCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {preset.description}
                    </div>
                    {isSelected && selectedPreset ? (
                      <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                        <CheckIcon className="size-3.5" />
                        Active preset
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          {selectedPreset ? (
            <section className="rounded-2xl border border-border/70 bg-muted/32 p-4">
              <div className="text-sm font-medium text-foreground">{selectedPreset.title}</div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                {selectedPreset.description}
              </div>
            </section>
          ) : null}
        </SheetPanel>

        <SheetFooter variant="bare">
          {props.footer ?? (
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              Close
            </Button>
          )}
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}

export default WorkspaceSettingsSheet;
