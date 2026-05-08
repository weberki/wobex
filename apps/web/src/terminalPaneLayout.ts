import { DEFAULT_THREAD_TERMINAL_ID } from "./types";
import {
  getWorkspaceTerminalLayoutPresetSlotCount,
  normalizeWorkspaceTerminalLayoutPresetId,
  type WorkspaceTerminalLayoutPresetId,
} from "./workspaceTerminalLayoutPresets";

export type TerminalPaneSplitDirection = "horizontal" | "vertical";
export type TerminalPaneSplitPosition = "left" | "right" | "top" | "bottom";

export interface TerminalPaneLeafNode {
  type: "terminal";
  paneId: string;
  terminalIds: string[];
  activeTerminalId: string;
}

export interface TerminalPaneSplitNode {
  type: "split";
  id: string;
  direction: TerminalPaneSplitDirection;
  children: TerminalPaneLayoutNode[];
  weights: number[];
}

export type TerminalPaneLayoutNode = TerminalPaneLeafNode | TerminalPaneSplitNode;

function normalizeTerminalIds(terminalIds: readonly (string | null | undefined)[]): string[] {
  const ids = [
    ...new Set(terminalIds.map((terminalId) => terminalId?.trim() ?? "").filter(Boolean)),
  ];
  return ids.length > 0 ? ids : [DEFAULT_THREAD_TERMINAL_ID];
}

function resolveActiveTerminalId(
  activeTerminalId: string | null | undefined,
  terminalIds: readonly string[],
): string {
  const trimmedActiveTerminalId = activeTerminalId?.trim() ?? "";
  return terminalIds.includes(trimmedActiveTerminalId)
    ? trimmedActiveTerminalId
    : (terminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
}

function createTerminalLeaf(
  terminalIds: readonly string[],
  paneId: string,
  activeTerminalId: string | null | undefined,
): TerminalPaneLeafNode {
  const normalizedTerminalIds = normalizeTerminalIds(terminalIds);
  return {
    type: "terminal",
    paneId,
    terminalIds: normalizedTerminalIds,
    activeTerminalId: resolveActiveTerminalId(activeTerminalId, normalizedTerminalIds),
  };
}

function createTerminalSplit(
  id: string,
  direction: TerminalPaneSplitDirection,
  children: readonly TerminalPaneLayoutNode[],
): TerminalPaneSplitNode {
  return {
    type: "split",
    id,
    direction,
    children: [...children],
    weights: children.map(() => 1),
  };
}

function distributeTerminalIdsAcrossSlots(
  terminalIds: readonly string[],
  slotCount: number,
): string[][] {
  const normalizedTerminalIds = normalizeTerminalIds(terminalIds);
  const nextSlots = Array.from({ length: Math.max(1, slotCount) }, () => [] as string[]);

  normalizedTerminalIds.forEach((terminalId, index) => {
    const slotIndex = index < nextSlots.length ? index : index % nextSlots.length;
    nextSlots[slotIndex]?.push(terminalId);
  });

  return nextSlots.map((slotTerminalIds, index) =>
    slotTerminalIds.length > 0
      ? slotTerminalIds
      : [normalizedTerminalIds[index] ?? normalizedTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID],
  );
}

export function isTerminalPaneSplitNode(
  node: TerminalPaneLayoutNode,
): node is TerminalPaneSplitNode {
  return node.type === "split";
}

export function collectTerminalPaneTerminalIds(node: TerminalPaneLayoutNode): string[] {
  const terminalIds: string[] = [];
  const seenTerminalIds = new Set<string>();

  const visit = (layoutNode: TerminalPaneLayoutNode) => {
    if (layoutNode.type === "terminal") {
      for (const terminalId of layoutNode.terminalIds) {
        if (seenTerminalIds.has(terminalId)) continue;
        seenTerminalIds.add(terminalId);
        terminalIds.push(terminalId);
      }
      return;
    }

    for (const child of layoutNode.children) {
      visit(child);
    }
  };

  visit(node);
  return terminalIds;
}

export function layoutContainsTerminalPaneId(
  node: TerminalPaneLayoutNode,
  terminalId: string,
): boolean {
  if (node.type === "terminal") {
    return node.terminalIds.includes(terminalId);
  }
  return node.children.some((child) => layoutContainsTerminalPaneId(child, terminalId));
}

export function findFirstTerminalPaneId(node: TerminalPaneLayoutNode): string {
  if (node.type === "terminal") {
    return node.activeTerminalId || node.terminalIds[0] || DEFAULT_THREAD_TERMINAL_ID;
  }

  return findFirstTerminalPaneId(
    node.children[0] ?? createTerminalLeaf([], "pane-default", undefined),
  );
}

export function buildTerminalPaneLayoutFromPreset(input: {
  presetId: WorkspaceTerminalLayoutPresetId | string | null | undefined;
  terminalIds: readonly string[];
  activeTerminalId?: string | null | undefined;
}): TerminalPaneLayoutNode {
  const presetId = normalizeWorkspaceTerminalLayoutPresetId(input.presetId);
  const slotCount = getWorkspaceTerminalLayoutPresetSlotCount(presetId);
  const normalizedTerminalIds = normalizeTerminalIds(input.terminalIds);
  const activeTerminalId = resolveActiveTerminalId(input.activeTerminalId, normalizedTerminalIds);
  const slots = distributeTerminalIdsAcrossSlots(normalizedTerminalIds, slotCount);

  const leaf = (slotIndex: number) =>
    createTerminalLeaf(
      slots[slotIndex] ?? [DEFAULT_THREAD_TERMINAL_ID],
      `pane-${presetId}-${slotIndex + 1}`,
      activeTerminalId,
    );

  switch (presetId) {
    case "two-columns":
      return createTerminalSplit(`workspace-${presetId}-root`, "horizontal", [leaf(0), leaf(1)]);
    case "two-rows":
      return createTerminalSplit(`workspace-${presetId}-root`, "vertical", [leaf(0), leaf(1)]);
    case "top-main":
      return createTerminalSplit(`workspace-${presetId}-root`, "vertical", [
        leaf(0),
        createTerminalSplit(`workspace-${presetId}-bottom`, "horizontal", [leaf(1), leaf(2)]),
      ]);
    case "left-main":
      return createTerminalSplit(`workspace-${presetId}-root`, "horizontal", [
        leaf(0),
        createTerminalSplit(`workspace-${presetId}-right`, "vertical", [leaf(1), leaf(2)]),
      ]);
    case "quad":
      return createTerminalSplit(`workspace-${presetId}-root`, "vertical", [
        createTerminalSplit(`workspace-${presetId}-top`, "horizontal", [leaf(0), leaf(1)]),
        createTerminalSplit(`workspace-${presetId}-bottom`, "horizontal", [leaf(2), leaf(3)]),
      ]);
    case "single":
    default:
      return leaf(0);
  }
}
