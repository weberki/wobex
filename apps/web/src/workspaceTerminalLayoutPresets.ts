import { DEFAULT_THREAD_TERMINAL_ID, type ThreadTerminalGroup } from "./types";

export type WorkspaceTerminalLayoutPresetId =
  | "single"
  | "two-columns"
  | "two-rows"
  | "top-main"
  | "left-main"
  | "quad";

export interface WorkspaceTerminalLayoutPresetDefinition {
  id: WorkspaceTerminalLayoutPresetId;
  title: string;
  description: string;
  slotCount: number;
}

export const DEFAULT_WORKSPACE_TERMINAL_LAYOUT_PRESET_ID: WorkspaceTerminalLayoutPresetId =
  "single";

export const WORKSPACE_TERMINAL_LAYOUT_PRESETS: readonly WorkspaceTerminalLayoutPresetDefinition[] =
  [
    {
      id: "single",
      title: "Single",
      description: "One focused terminal.",
      slotCount: 1,
    },
    {
      id: "two-columns",
      title: "Two Columns",
      description: "Two terminals side by side.",
      slotCount: 2,
    },
    {
      id: "two-rows",
      title: "Two Rows",
      description: "Two terminals stacked vertically.",
      slotCount: 2,
    },
    {
      id: "top-main",
      title: "Top + Bottom",
      description: "One large terminal above two smaller panes.",
      slotCount: 3,
    },
    {
      id: "left-main",
      title: "Left + Stack",
      description: "One large pane on the left and two stacked on the right.",
      slotCount: 3,
    },
    {
      id: "quad",
      title: "Quad",
      description: "Four equally visible terminals.",
      slotCount: 4,
    },
  ] as const;

const WORKSPACE_TERMINAL_LAYOUT_PRESET_BY_ID = new Map(
  WORKSPACE_TERMINAL_LAYOUT_PRESETS.map((preset) => [preset.id, preset]),
);

function normalizeTerminalIds(terminalIds: readonly string[]): string[] {
  const ids = [...new Set(terminalIds.map((terminalId) => terminalId.trim()).filter(Boolean))];
  return ids.length > 0 ? ids : [DEFAULT_THREAD_TERMINAL_ID];
}

export function normalizeWorkspaceTerminalLayoutPresetId(
  presetId: WorkspaceTerminalLayoutPresetId | string | null | undefined,
): WorkspaceTerminalLayoutPresetId {
  return WORKSPACE_TERMINAL_LAYOUT_PRESET_BY_ID.has(presetId as WorkspaceTerminalLayoutPresetId)
    ? (presetId as WorkspaceTerminalLayoutPresetId)
    : DEFAULT_WORKSPACE_TERMINAL_LAYOUT_PRESET_ID;
}

export function getWorkspaceTerminalLayoutPreset(
  presetId: WorkspaceTerminalLayoutPresetId | string | null | undefined,
): WorkspaceTerminalLayoutPresetDefinition {
  return (
    WORKSPACE_TERMINAL_LAYOUT_PRESET_BY_ID.get(
      normalizeWorkspaceTerminalLayoutPresetId(presetId),
    ) ??
    WORKSPACE_TERMINAL_LAYOUT_PRESET_BY_ID.get(DEFAULT_WORKSPACE_TERMINAL_LAYOUT_PRESET_ID) ?? {
      id: DEFAULT_WORKSPACE_TERMINAL_LAYOUT_PRESET_ID,
      title: "Single",
      description: "One focused terminal.",
      slotCount: 1,
    }
  );
}

export function getWorkspaceTerminalLayoutPresetSlotCount(
  presetId: WorkspaceTerminalLayoutPresetId | string | null | undefined,
): number {
  return getWorkspaceTerminalLayoutPreset(presetId).slotCount;
}

export function ensureWorkspaceTerminalIdsForPreset(
  terminalIds: readonly string[],
  presetId: WorkspaceTerminalLayoutPresetId | string | null | undefined,
  createTerminalId: () => string,
): string[] {
  const nextTerminalIds = normalizeTerminalIds(terminalIds);
  const requiredSlotCount = getWorkspaceTerminalLayoutPresetSlotCount(presetId);
  const usedTerminalIds = new Set(nextTerminalIds);
  let fallbackIndex = 1;
  let attempts = 0;
  const maxAttempts = Math.max(8, requiredSlotCount * 8);

  while (nextTerminalIds.length < requiredSlotCount) {
    attempts += 1;
    if (attempts > maxAttempts) {
      const fallbackTerminalId = `terminal-${fallbackIndex}`;
      fallbackIndex += 1;
      if (!usedTerminalIds.has(fallbackTerminalId)) {
        usedTerminalIds.add(fallbackTerminalId);
        nextTerminalIds.push(fallbackTerminalId);
      }
      continue;
    }
    const nextTerminalId = createTerminalId().trim();
    if (nextTerminalId.length === 0 || usedTerminalIds.has(nextTerminalId)) {
      continue;
    }
    usedTerminalIds.add(nextTerminalId);
    nextTerminalIds.push(nextTerminalId);
  }

  return nextTerminalIds;
}

export function createWorkspaceTerminalGroupFromPreset(
  presetId: WorkspaceTerminalLayoutPresetId | string | null | undefined,
  terminalIds: readonly string[],
): ThreadTerminalGroup {
  const normalizedPresetId = normalizeWorkspaceTerminalLayoutPresetId(presetId);
  const normalizedTerminalIds = normalizeTerminalIds(terminalIds);

  return {
    id: `workspace-${normalizedPresetId}`,
    terminalIds: normalizedTerminalIds,
  };
}
