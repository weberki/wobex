import { type EnvironmentId, type MessageId, type TurnId } from "@wobex/contracts";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChatEmptyStateHero } from "./ChatEmptyStateHero";
import {
  measureElement as measureVirtualElement,
  type VirtualItem,
  useVirtualizer,
} from "@tanstack/react-virtual";
import { deriveTimelineEntries, formatElapsed } from "../../session-logic";
import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX } from "../../chat-scroll";
import { type TurnDiffSummary } from "../../types";
import { summarizeTurnDiffStats } from "../../lib/turnDiffTree";
import ChatMarkdown from "../ChatMarkdown";
import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  type LucideIcon,
  SquarePenIcon,
  TerminalIcon,
  Undo2Icon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { clamp } from "effect/Number";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ChangedFilesTree } from "./ChangedFilesTree";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  MAX_VISIBLE_WORK_LOG_ENTRIES,
  deriveMessagesTimelineRows,
  estimateMessagesTimelineRowHeight,
  normalizeCompactToolLabel,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { type TimestampFormat } from "@wobex/contracts/settings";
import { formatTimestamp } from "../../timestampFormat";
import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";

const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8;
const SHOW_MESSAGE_TIMESTAMPS = false;

interface MessagesTimelineProps {
  hasMessages: boolean;
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnStartedAt: string | null;
  scrollContainer: HTMLDivElement | null;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
  completionSummary: string | null;
  completionTurnDiffSummary: TurnDiffSummary | null;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  nowIso: string;
  expandedWorkGroups: Record<string, boolean>;
  onToggleWorkGroup: (groupId: string) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  activeThreadEnvironmentId: EnvironmentId;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  projectName: string | undefined;
  onVirtualizerSnapshot?: (snapshot: {
    totalSize: number;
    measurements: ReadonlyArray<{
      id: string;
      kind: MessagesTimelineRow["kind"];
      index: number;
      size: number;
      start: number;
      end: number;
    }>;
  }) => void;
}

export const MessagesTimeline = memo(function MessagesTimeline({
  hasMessages,
  isWorking,
  activeTurnInProgress,
  activeTurnStartedAt,
  scrollContainer,
  timelineEntries,
  completionDividerBeforeEntryId,
  completionSummary,
  completionTurnDiffSummary,
  turnDiffSummaryByAssistantMessageId,
  nowIso,
  expandedWorkGroups,
  onToggleWorkGroup,
  onOpenTurnDiff,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  isRevertingCheckpoint,
  onImageExpand,
  activeThreadEnvironmentId,
  markdownCwd,
  resolvedTheme,
  timestampFormat,
  workspaceRoot,
  projectName,
  onVirtualizerSnapshot,
}: MessagesTimelineProps) {
  const timelineRootRef = useRef<HTMLDivElement | null>(null);
  const [timelineWidthPx, setTimelineWidthPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const timelineRoot = timelineRootRef.current;
    if (!timelineRoot) return;

    const updateWidth = (nextWidth: number) => {
      setTimelineWidthPx((previousWidth) => {
        if (previousWidth !== null && Math.abs(previousWidth - nextWidth) < 0.5) {
          return previousWidth;
        }
        return nextWidth;
      });
    };

    updateWidth(timelineRoot.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      updateWidth(timelineRoot.getBoundingClientRect().width);
    });
    observer.observe(timelineRoot);
    return () => {
      observer.disconnect();
    };
  }, [hasMessages, isWorking]);

  const rows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        completionDividerBeforeEntryId,
        isWorking,
        activeTurnStartedAt,
      }),
    [timelineEntries, completionDividerBeforeEntryId, isWorking, activeTurnStartedAt],
  );

  const firstUnvirtualizedRowIndex = useMemo(() => {
    const firstTailRowIndex = Math.max(rows.length - ALWAYS_UNVIRTUALIZED_TAIL_ROWS, 0);
    if (!activeTurnInProgress) return firstTailRowIndex;

    const turnStartedAtMs =
      typeof activeTurnStartedAt === "string" ? Date.parse(activeTurnStartedAt) : Number.NaN;
    let firstCurrentTurnRowIndex = -1;
    if (!Number.isNaN(turnStartedAtMs)) {
      firstCurrentTurnRowIndex = rows.findIndex((row) => {
        if (row.kind === "working") return true;
        if (!row.createdAt) return false;
        const rowCreatedAtMs = Date.parse(row.createdAt);
        return !Number.isNaN(rowCreatedAtMs) && rowCreatedAtMs >= turnStartedAtMs;
      });
    }

    if (firstCurrentTurnRowIndex < 0) {
      firstCurrentTurnRowIndex = rows.findIndex(
        (row) => row.kind === "message" && row.message.streaming,
      );
    }

    if (firstCurrentTurnRowIndex < 0) return firstTailRowIndex;

    for (let index = firstCurrentTurnRowIndex - 1; index >= 0; index -= 1) {
      const previousRow = rows[index];
      if (!previousRow || previousRow.kind !== "message") continue;
      if (previousRow.message.role === "user") {
        return Math.min(index, firstTailRowIndex);
      }
      if (previousRow.message.role === "assistant" && !previousRow.message.streaming) {
        break;
      }
    }

    return Math.min(firstCurrentTurnRowIndex, firstTailRowIndex);
  }, [activeTurnInProgress, activeTurnStartedAt, rows]);

  const virtualizedRowCount = clamp(firstUnvirtualizedRowIndex, {
    minimum: 0,
    maximum: rows.length,
  });
  const virtualMeasurementScopeKey =
    timelineWidthPx === null ? "width:unknown" : `width:${Math.round(timelineWidthPx)}`;

  const rowVirtualizer = useVirtualizer({
    count: virtualizedRowCount,
    getScrollElement: () => scrollContainer,
    // Scope cached row measurements to the current timeline width so offscreen
    // rows do not keep stale heights after wrapping changes.
    getItemKey: (index: number) => {
      const rowId = rows[index]?.id ?? String(index);
      return `${virtualMeasurementScopeKey}:${rowId}`;
    },
    estimateSize: (index: number) => {
      const row = rows[index];
      if (!row) return 96;
      return estimateMessagesTimelineRowHeight(row, {
        expandedWorkGroups,
        timelineWidthPx,
        completionTurnDiffSummary,
        turnDiffSummaryByAssistantMessageId,
      });
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });
  useEffect(() => {
    if (timelineWidthPx === null) return;
    rowVirtualizer.measure();
  }, [rowVirtualizer, timelineWidthPx]);
  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const viewportHeight = instance.scrollRect?.height ?? 0;
      const scrollOffset = instance.scrollOffset ?? 0;
      const itemIntersectsViewport =
        item.end > scrollOffset && item.start < scrollOffset + viewportHeight;
      if (itemIntersectsViewport) {
        return false;
      }
      const remainingDistance = instance.getTotalSize() - (scrollOffset + viewportHeight);
      return remainingDistance > AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    };
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [rowVirtualizer]);
  const pendingMeasureFrameRef = useRef<number | null>(null);
  const onTimelineImageLoad = useCallback(() => {
    if (pendingMeasureFrameRef.current !== null) return;
    pendingMeasureFrameRef.current = window.requestAnimationFrame(() => {
      pendingMeasureFrameRef.current = null;
      rowVirtualizer.measure();
    });
  }, [rowVirtualizer]);
  useEffect(() => {
    return () => {
      const frame = pendingMeasureFrameRef.current;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);
  useLayoutEffect(() => {
    if (!onVirtualizerSnapshot) {
      return;
    }
    onVirtualizerSnapshot({
      totalSize: rowVirtualizer.getTotalSize(),
      measurements: rowVirtualizer.measurementsCache
        .slice(0, virtualizedRowCount)
        .flatMap((measurement) => {
          const row = rows[measurement.index];
          if (!row) {
            return [];
          }
          return [
            {
              id: row.id,
              kind: row.kind,
              index: measurement.index,
              size: measurement.size,
              start: measurement.start,
              end: measurement.end,
            },
          ];
        }),
    });
  }, [onVirtualizerSnapshot, rowVirtualizer, rows, virtualizedRowCount]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const nonVirtualizedRows = rows.slice(virtualizedRowCount);
  const [allDirectoriesExpandedByTurnId, setAllDirectoriesExpandedByTurnId] = useState<
    Record<string, boolean>
  >({});
  const onToggleAllDirectories = useCallback((turnId: TurnId) => {
    setAllDirectoriesExpandedByTurnId((current) => ({
      ...current,
      [turnId]: !(current[turnId] ?? true),
    }));
  }, []);

  const renderRowContent = (row: TimelineRow) => (
    <div
      className="pb-4"
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" &&
        (() => {
          const groupId = row.id;
          const groupedEntries = row.groupedEntries;
          const isExpanded = expandedWorkGroups[groupId] ?? false;
          const hasOverflow = groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
          const visibleEntries =
            hasOverflow && !isExpanded
              ? groupedEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
              : groupedEntries;
          const hiddenCount = groupedEntries.length - visibleEntries.length;
          const onlyToolEntries = groupedEntries.every((entry) => entry.tone === "tool");
          const onlyThinkingEntries = groupedEntries.every((entry) => entry.tone === "thinking");
          const showHeader = hasOverflow || (!onlyToolEntries && !onlyThinkingEntries);
          const groupLabel = onlyThinkingEntries
            ? "Thinking"
            : onlyToolEntries
              ? "Tool calls"
              : "Work log";

          if (onlyThinkingEntries) {
            return (
              <ThinkingWorkGroup
                entries={groupedEntries}
                groupId={groupId}
                isExpanded={isExpanded}
                onToggle={() => onToggleWorkGroup(groupId)}
              />
            );
          }

          return (
            <div className="rounded-xl border border-border/45 bg-card/25 px-2 py-1.5">
              {showHeader && (
                <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
                    {groupLabel} ({groupedEntries.length})
                  </p>
                  {hasOverflow && (
                    <button
                      type="button"
                      className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground/55 transition-colors duration-150 hover:text-foreground/75"
                      onClick={() => onToggleWorkGroup(groupId)}
                    >
                      {isExpanded ? "Show less" : `Show ${hiddenCount} more`}
                    </button>
                  )}
                </div>
              )}
              <div className="space-y-0.5">
                {visibleEntries.map((workEntry) => (
                  <SimpleWorkEntryRow key={`work-row:${workEntry.id}`} workEntry={workEntry} />
                ))}
              </div>
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "user" &&
        (() => {
          const userImages = row.message.attachments ?? [];
          const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text);
          const terminalContexts = displayedUserMessage.contexts;
          const canRevertAgentWork = revertTurnCountByUserMessageId.has(row.message.id);
          return (
            <div className="flex justify-end">
              <div className="group relative max-w-[80%] rounded-lg border border-border/35 bg-secondary/80 px-3.5 py-2.5 shadow-sm">
                {userImages.length > 0 && (
                  <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
                    {userImages.map(
                      (image: NonNullable<TimelineMessage["attachments"]>[number]) => (
                        <div
                          key={image.id}
                          className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
                        >
                          {image.previewUrl ? (
                            <button
                              type="button"
                              className="h-full w-full cursor-zoom-in"
                              aria-label={`Preview ${image.name}`}
                              onClick={() => {
                                const preview = buildExpandedImagePreview(userImages, image.id);
                                if (!preview) return;
                                onImageExpand(preview);
                              }}
                            >
                              <img
                                src={image.previewUrl}
                                alt={image.name}
                                className="block h-auto max-h-[220px] w-full object-cover"
                                onLoad={onTimelineImageLoad}
                                onError={onTimelineImageLoad}
                              />
                            </button>
                          ) : (
                            <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/70">
                              {image.name}
                            </div>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                )}
                {(displayedUserMessage.visibleText.trim().length > 0 ||
                  terminalContexts.length > 0) && (
                  <UserMessageBody
                    text={displayedUserMessage.visibleText}
                    terminalContexts={terminalContexts}
                  />
                )}
                <div
                  className={cn(
                    "flex items-center justify-end gap-2",
                    SHOW_MESSAGE_TIMESTAMPS ? "mt-1.5" : "mt-1",
                  )}
                >
                  <div className="flex items-center gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
                    {displayedUserMessage.copyText && (
                      <MessageCopyButton text={displayedUserMessage.copyText} />
                    )}
                    {canRevertAgentWork && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={isRevertingCheckpoint || isWorking}
                        onClick={() => onRevertUserMessage(row.message.id)}
                        title="Revert to this message"
                      >
                        <Undo2Icon className="size-3" />
                      </Button>
                    )}
                  </div>
                  {SHOW_MESSAGE_TIMESTAMPS ? (
                    <p className="text-right text-xs text-muted-foreground/50">
                      {formatTimestamp(row.message.createdAt, timestampFormat)}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "assistant" &&
        (() => {
          const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");
          const turnSummary =
            turnDiffSummaryByAssistantMessageId.get(row.message.id) ??
            (row.showCompletionDivider ? completionTurnDiffSummary : null);
          return (
            <>
              {row.showCompletionDivider && (
                <div className="my-3 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
                    {completionSummary ? `Response • ${completionSummary}` : "Response"}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className="min-w-0 px-1 py-0.5">
                <ChatMarkdown
                  text={messageText}
                  cwd={markdownCwd}
                  isStreaming={Boolean(row.message.streaming)}
                />
                {turnSummary ? (
                  <ChangedFilesCard
                    turnSummary={turnSummary}
                    resolvedTheme={resolvedTheme}
                    onOpenTurnDiff={onOpenTurnDiff}
                    onToggleAllDirectories={onToggleAllDirectories}
                    allDirectoriesExpanded={
                      allDirectoriesExpandedByTurnId[turnSummary.turnId] ?? true
                    }
                  />
                ) : null}
                {SHOW_MESSAGE_TIMESTAMPS ? (
                  <p className="mt-1.5 text-xs text-muted-foreground/50">
                    {formatMessageMeta(
                      row.message.createdAt,
                      row.message.streaming
                        ? formatElapsed(row.durationStart, nowIso)
                        : formatElapsed(row.durationStart, row.message.completedAt),
                      timestampFormat,
                    )}
                  </p>
                ) : null}
              </div>
            </>
          );
        })()}

      {row.kind === "proposed-plan" && (
        <div className="min-w-0 px-1 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            environmentId={activeThreadEnvironmentId}
            cwd={markdownCwd}
            workspaceRoot={workspaceRoot}
          />
        </div>
      )}

      {row.kind === "working" && (
        <div className="py-0.5 pl-1.5">
          <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground/70">
            <span className="inline-flex items-center gap-[3px]">
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse" />
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:200ms]" />
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:400ms]" />
            </span>
            <span>
              {row.createdAt
                ? `Working for ${formatWorkingTimer(row.createdAt, nowIso) ?? "0s"}`
                : "Working..."}
            </span>
          </div>
        </div>
      )}
    </div>
  );

  if (!hasMessages && !isWorking) {
    return (
      <div className="flex h-full items-center justify-center">
        <ChatEmptyStateHero projectName={projectName} />
      </div>
    );
  }

  return (
    <div
      ref={timelineRootRef}
      data-timeline-root="true"
      className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden"
    >
      {virtualizedRowCount > 0 && (
        <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {virtualRows.map((virtualRow: VirtualItem) => {
            const row = rows[virtualRow.index];
            if (!row) return null;

            return (
              <div
                key={`virtual-row:${row.id}`}
                data-index={virtualRow.index}
                data-virtual-row-id={row.id}
                data-virtual-row-kind={row.kind}
                data-virtual-row-size={virtualRow.size}
                data-virtual-row-start={virtualRow.start}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {renderRowContent(row)}
              </div>
            );
          })}
        </div>
      )}

      {nonVirtualizedRows.map((row) => (
        <div key={`non-virtual-row:${row.id}`}>{renderRowContent(row)}</div>
      ))}
    </div>
  );
});

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
type TimelineWorkEntry = Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"][number];
type TimelineRow = MessagesTimelineRow;

const ChangedFilesCard = memo(function ChangedFilesCard(props: {
  turnSummary: TurnDiffSummary;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onToggleAllDirectories: (turnId: TurnId) => void;
}) {
  const checkpointFiles = props.turnSummary.files;
  if (checkpointFiles.length === 0) {
    return null;
  }

  const summaryStat = summarizeTurnDiffStats(checkpointFiles);
  const changedFileCountLabel = String(checkpointFiles.length);

  return (
    <div className="mt-2 rounded-lg border border-[color:var(--color-border-light,var(--border))] bg-[color:var(--composer-surface,var(--card))] p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
          <span>Changed files ({changedFileCountLabel})</span>
          {hasNonZeroStat(summaryStat) && (
            <>
              <span className="mx-1">•</span>
              <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
            </>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-scroll-anchor-ignore
            onClick={() => props.onToggleAllDirectories(props.turnSummary.turnId)}
          >
            {props.allDirectoriesExpanded ? "Collapse all" : "Expand all"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => props.onOpenTurnDiff(props.turnSummary.turnId, checkpointFiles[0]?.path)}
          >
            View diff
          </Button>
        </div>
      </div>
      <ChangedFilesTree
        key={`changed-files-tree:${props.turnSummary.turnId}`}
        turnId={props.turnSummary.turnId}
        files={checkpointFiles}
        allDirectoriesExpanded={props.allDirectoriesExpanded}
        resolvedTheme={props.resolvedTheme}
        onOpenTurnDiff={props.onOpenTurnDiff}
      />
    </div>
  );
});

function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatMessageMeta(
  createdAt: string,
  duration: string | null,
  timestampFormat: TimestampFormat,
): string {
  if (!duration) return formatTimestamp(createdAt, timestampFormat);
  return `${formatTimestamp(createdAt, timestampFormat)} • ${duration}`;
}

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
}) {
  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
              {props.text.slice(cursor, matchIndex)}
            </span>,
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
              {props.text.slice(cursor)}
            </span>,
          );
        }

        return (
          <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(<span key="user-message-terminal-context-inline-text">{props.text}</span>);
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
      {props.text}
    </div>
  );
});

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "text-foreground/92",
    };
  }
  if (tone === "thinking") {
    return {
      icon: BotIcon,
      className: "text-foreground/92",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-foreground/92",
    };
  }
  return {
    icon: ZapIcon,
    className: "text-foreground/92",
  };
}

function workToneClass(tone: "thinking" | "tool" | "info" | "error"): string {
  if (tone === "error") return "text-rose-300/50 dark:text-rose-300/50";
  if (tone === "tool") return "text-muted-foreground/70";
  if (tone === "thinking") return "text-muted-foreground/50";
  return "text-muted-foreground/40";
}

function workEntryPreview(
  workEntry: Pick<TimelineWorkEntry, "detail" | "command" | "changedFiles">,
) {
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  return workEntry.changedFiles!.length === 1
    ? firstPath
    : `${firstPath} +${workEntry.changedFiles!.length - 1} more`;
}

function workEntryRawCommand(
  workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (workEntry.requestKind === "command") return TerminalIcon;
  if (workEntry.requestKind === "file-read") return EyeIcon;
  if (workEntry.requestKind === "file-change") return SquarePenIcon;
  if (workEntry.activityKind.startsWith("review.")) return EyeIcon;
  if (workEntry.activityKind === "command-output.delta") return TerminalIcon;
  if (workEntry.activityKind === "file-change-output.delta") return SquarePenIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return TerminalIcon;
  }
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return SquarePenIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return HammerIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

function workEntryPayloadRecord(workEntry: TimelineWorkEntry): Record<string, unknown> | null {
  return workEntry.payload && typeof workEntry.payload === "object"
    ? (workEntry.payload as Record<string, unknown>)
    : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function workEntryPayloadDataRecord(workEntry: TimelineWorkEntry): Record<string, unknown> | null {
  const payload = workEntryPayloadRecord(workEntry);
  return recordValue(payload?.data);
}

function workEntryPayloadItemRecord(workEntry: TimelineWorkEntry): Record<string, unknown> | null {
  const data = workEntryPayloadDataRecord(workEntry);
  return recordValue(data?.item) ?? data;
}

function workEntryStatus(workEntry: TimelineWorkEntry): string | null {
  const payload = workEntryPayloadRecord(workEntry);
  const rawStatus = typeof payload?.status === "string" ? payload.status : null;
  if (rawStatus) {
    return rawStatus;
  }
  if (workEntry.activityKind.endsWith(".started")) return "started";
  if (workEntry.activityKind.endsWith(".updated")) return "in progress";
  if (workEntry.activityKind.endsWith(".completed")) return "completed";
  return null;
}

function workEntryStatusLabel(status: string | null): string | null {
  if (!status) return null;
  return capitalizePhrase(status.replaceAll("_", " "));
}

function workEntryStatusClassName(status: string | null): string {
  if (!status) {
    return "border-border/60 bg-background/70 text-muted-foreground/75";
  }
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error")) {
    return "border-rose-500/30 bg-rose-500/10 text-rose-200 dark:text-rose-200";
  }
  if (normalized.includes("complete") || normalized.includes("done")) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 dark:text-emerald-200";
  }
  return "border-sky-500/30 bg-sky-500/10 text-sky-200 dark:text-sky-200";
}

function workEntryKindLabel(workEntry: TimelineWorkEntry): string | null {
  switch (workEntry.itemType) {
    case "command_execution":
      return "Command";
    case "file_change":
      return "Edit";
    case "mcp_tool_call":
      return "MCP";
    case "dynamic_tool_call":
      return "Tool";
    case "web_search":
      return "Web";
    case "image_view":
      return "Image";
    case "collab_agent_tool_call":
      return "Agent team";
    default:
      if (workEntry.activityKind.startsWith("hook.")) return "Hook";
      if (workEntry.activityKind.startsWith("task.")) return "Task";
      if (workEntry.activityKind.startsWith("thinking.")) return "Thinking";
      return null;
  }
}

interface TimelineAgentState {
  threadId: string;
  status: string;
  message: string | null;
}

function workEntryAgentStates(workEntry: TimelineWorkEntry): TimelineAgentState[] {
  const item = workEntryPayloadItemRecord(workEntry);
  const agentStates =
    item && typeof item.agentsStates === "object"
      ? (item.agentsStates as Record<string, unknown>)
      : null;
  if (!agentStates) {
    return [];
  }

  return Object.entries(agentStates).flatMap(([threadId, state]) => {
    const record = recordValue(state);
    if (!record) {
      return [];
    }
    const status = typeof record.status === "string" ? record.status : null;
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (!status) {
      return [];
    }
    return [{ threadId, status, message: message.length > 0 ? message : null }];
  });
}

function workEntryBody(workEntry: TimelineWorkEntry): {
  text: string;
  monospace: boolean;
} | null {
  const rawDetail = workEntry.detail;
  if (!rawDetail || rawDetail.trim().length === 0) {
    return null;
  }

  if (
    workEntry.activityKind.startsWith("thinking.") ||
    workEntry.activityKind.startsWith("review.") ||
    workEntry.activityKind === "tool.summary"
  ) {
    return {
      text: rawDetail.trim(),
      monospace: false,
    };
  }

  if (
    workEntry.activityKind === "command-output.delta" ||
    workEntry.activityKind === "file-change-output.delta" ||
    workEntry.activityKind === "hook.progress" ||
    workEntry.activityKind === "hook.completed"
  ) {
    return {
      text: rawDetail,
      monospace: true,
    };
  }

  if (rawDetail.includes("\n")) {
    return {
      text: rawDetail.trim(),
      monospace: Boolean(workEntry.command),
    };
  }

  return null;
}

function workEntryStructuredValue(
  record: Record<string, unknown> | null,
  key: string,
): unknown | undefined {
  if (!record || !(key in record)) {
    return undefined;
  }
  return record[key];
}

function workEntryToolInput(workEntry: TimelineWorkEntry): unknown {
  const item = workEntryPayloadItemRecord(workEntry);
  const data = workEntryPayloadDataRecord(workEntry);
  return workEntryStructuredValue(item, "input") ?? workEntryStructuredValue(data, "input");
}

function workEntryToolResult(workEntry: TimelineWorkEntry): unknown {
  const item = workEntryPayloadItemRecord(workEntry);
  const data = workEntryPayloadDataRecord(workEntry);
  return workEntryStructuredValue(item, "result") ?? workEntryStructuredValue(data, "result");
}

function workEntryHookRecord(workEntry: TimelineWorkEntry): Record<string, unknown> | null {
  return workEntryPayloadRecord(workEntry);
}

function stringifyStructuredValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function hasStructuredWorkEntryDetails(workEntry: TimelineWorkEntry): boolean {
  return Boolean(
    workEntryBody(workEntry) ||
    workEntryRawCommand(workEntry) ||
    workEntry.command ||
    (workEntry.changedFiles?.length ?? 0) > 0 ||
    workEntryAgentStates(workEntry).length > 0 ||
    stringifyStructuredValue(workEntryToolInput(workEntry)) ||
    stringifyStructuredValue(workEntryToolResult(workEntry)) ||
    (workEntry.activityKind.startsWith("hook.") &&
      (() => {
        const hook = workEntryHookRecord(workEntry);
        return (
          typeof hook?.hookName === "string" ||
          typeof hook?.hookEvent === "string" ||
          typeof hook?.stdout === "string" ||
          typeof hook?.stderr === "string" ||
          typeof hook?.output === "string" ||
          typeof hook?.outcome === "string"
        );
      })()),
  );
}

function WorkEntryChip(props: {
  children: ReactNode;
  tone?: "default" | "status";
  status?: string | null;
  monospace?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]",
        props.tone === "status"
          ? workEntryStatusClassName(props.status ?? null)
          : "border-border/60 bg-background/70 text-muted-foreground/75",
        props.monospace && "font-mono normal-case tracking-normal",
      )}
    >
      {props.children}
    </span>
  );
}

function StructuredValueBlock(props: { label: string; value: unknown; monospace?: boolean }) {
  const text = stringifyStructuredValue(props.value);
  if (!text || text.trim().length === 0) {
    return null;
  }
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
        {props.label}
      </p>
      <div
        className={cn(
          "whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground/78",
          props.monospace &&
            "overflow-x-auto rounded-lg border border-border/55 bg-background/70 px-2.5 py-2 font-mono",
        )}
      >
        {text}
      </div>
    </div>
  );
}

function formatWorkGroupDuration(entries: ReadonlyArray<TimelineWorkEntry>): string {
  const firstMs = Date.parse(entries[0]?.createdAt ?? "");
  const lastMs = Date.parse(entries.at(-1)?.createdAt ?? "");
  if (Number.isNaN(firstMs) || Number.isNaN(lastMs)) {
    return "a moment";
  }
  const seconds = Math.max(0, Math.round((lastMs - firstMs) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function thinkingEntryText(workEntry: TimelineWorkEntry): string | null {
  const body = workEntryBody(workEntry);
  const text = body?.text ?? workEntry.detail ?? "";
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const ThinkingWorkGroup = memo(function ThinkingWorkGroup(props: {
  entries: ReadonlyArray<TimelineWorkEntry>;
  groupId: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const thinkingText = props.entries.map(thinkingEntryText).filter(Boolean).join("\n\n");
  const hasDetails = thinkingText.length > 0;

  return (
    <div className="px-1 py-0.5 text-muted-foreground/70">
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.isExpanded}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground",
          props.isExpanded && "border-border text-foreground",
        )}
      >
        <ChevronRightIcon
          className={cn("size-3 transition-transform", props.isExpanded && "rotate-90")}
        />
        <span>Thought for {formatWorkGroupDuration(props.entries)}</span>
      </button>
      {hasDetails && props.isExpanded ? (
        <div className="mt-2 rounded-r border-l-2 border-primary/40 bg-muted/10 px-3 py-2 text-sm text-muted-foreground leading-relaxed">
          {thinkingText}
        </div>
      ) : null}
    </div>
  );
});

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
}) {
  const { workEntry } = props;
  const iconConfig = workToneIcon(workEntry.tone);
  const EntryIcon = workEntryIcon(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const preview = workEntryPreview(workEntry);
  const rawCommand = workEntryRawCommand(workEntry);
  const body = workEntryBody(workEntry);
  const status = workEntryStatus(workEntry);
  const statusLabel = workEntryStatusLabel(status);
  const kindLabel = workEntryKindLabel(workEntry);
  const previewText = body ? preview : preview;
  const displayText = previewText ? `${heading} - ${previewText}` : heading;
  const agentStates = workEntryAgentStates(workEntry);
  const toolInput = workEntryToolInput(workEntry);
  const toolResult = workEntryToolResult(workEntry);
  const hook = workEntryHookRecord(workEntry);
  const hookName = typeof hook?.hookName === "string" ? hook.hookName : null;
  const hookEvent = typeof hook?.hookEvent === "string" ? hook.hookEvent : null;
  const hookOutput = typeof hook?.output === "string" ? hook.output : null;
  const hookStdout = typeof hook?.stdout === "string" ? hook.stdout : null;
  const hookStderr = typeof hook?.stderr === "string" ? hook.stderr : null;
  const hookOutcome = typeof hook?.outcome === "string" ? hook.outcome : null;
  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const hasStructuredDetails = hasStructuredWorkEntryDetails(workEntry);
  const defaultExpanded =
    workEntry.tone === "thinking" ||
    workEntry.itemType === "collab_agent_tool_call" ||
    workEntry.activityKind.startsWith("hook.");
  const summaryDescription =
    workEntry.activityKind.startsWith("thinking.") && body
      ? body.text
      : previewText && previewText !== displayText
        ? previewText
        : previewText;
  const cardClassName = cn(
    "rounded-xl border px-3 py-2",
    workEntry.tone === "thinking"
      ? "border-border/60 bg-card/40"
      : workEntry.activityKind.startsWith("hook.")
        ? "border-border/60 bg-card/55"
        : "border-border/55 bg-card/35",
  );

  const summary = (
    <div className="flex items-start gap-2.5">
      {hasStructuredDetails ? (
        <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/55 transition-transform duration-150 group-open:rotate-90" />
      ) : (
        <span className="mt-1 inline-flex w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          iconConfig.className,
        )}
      >
        <EntryIcon className="size-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p
            className={cn(
              "min-w-0 truncate text-sm leading-5 text-foreground/85",
              workToneClass(workEntry.tone),
            )}
            title={rawCommand ? undefined : displayText}
          >
            {heading}
          </p>
          {statusLabel ? (
            <WorkEntryChip tone="status" status={status}>
              {statusLabel}
            </WorkEntryChip>
          ) : null}
          {kindLabel ? <WorkEntryChip>{kindLabel}</WorkEntryChip> : null}
        </div>
        {summaryDescription ? (
          rawCommand ? (
            <Tooltip>
              <TooltipTrigger
                closeDelay={0}
                delay={75}
                render={
                  <p className="mt-0.5 line-clamp-2 cursor-default text-[11px] leading-4 text-muted-foreground/70 transition-colors hover:text-muted-foreground/85 focus-visible:text-muted-foreground/85">
                    {summaryDescription}
                  </p>
                }
              />
              <TooltipPopup
                align="start"
                className="max-w-[min(56rem,calc(100vw-2rem))] px-0 py-0"
                side="top"
              >
                <div className="max-w-[min(56rem,calc(100vw-2rem))] overflow-x-auto px-1.5 py-1 font-mono text-[11px] leading-4 whitespace-nowrap">
                  {rawCommand}
                </div>
              </TooltipPopup>
            </Tooltip>
          ) : (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground/70">
              {summaryDescription}
            </p>
          )
        ) : null}
      </div>
    </div>
  );

  const detailsContent = hasStructuredDetails ? (
    <div className="space-y-3 border-border/55 border-t px-3 py-3">
      {workEntry.activityKind.startsWith("thinking.") ? (
        <StructuredValueBlock label="Thinking" value={body?.text ?? workEntry.detail ?? ""} />
      ) : null}
      {workEntry.activityKind.startsWith("hook.") ? (
        <>
          {hookName ? <StructuredValueBlock label="Hook" value={hookName} /> : null}
          {hookEvent ? <StructuredValueBlock label="Event" value={hookEvent} /> : null}
          {hookOutcome ? <StructuredValueBlock label="Outcome" value={hookOutcome} /> : null}
          {hookOutput ? (
            <StructuredValueBlock label="Hook output" value={hookOutput} monospace />
          ) : null}
          {hookStdout ? <StructuredValueBlock label="Stdout" value={hookStdout} monospace /> : null}
          {hookStderr ? <StructuredValueBlock label="Stderr" value={hookStderr} monospace /> : null}
        </>
      ) : null}
      {!workEntry.activityKind.startsWith("thinking.") &&
      !workEntry.activityKind.startsWith("hook.") &&
      body ? (
        <StructuredValueBlock
          label={workEntry.itemType === "collab_agent_tool_call" ? "Summary" : "Details"}
          value={body.text}
          monospace={body.monospace}
        />
      ) : null}
      {workEntry.command ? (
        <StructuredValueBlock label="Command" value={workEntry.command} monospace />
      ) : null}
      {rawCommand ? (
        <StructuredValueBlock label="Raw command" value={rawCommand} monospace />
      ) : null}
      {toolInput !== undefined ? (
        <StructuredValueBlock label="Input" value={toolInput} monospace />
      ) : null}
      {toolResult !== undefined ? (
        <StructuredValueBlock label="Output" value={toolResult} monospace />
      ) : null}
      {agentStates.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
            Agent team
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {agentStates.map((agentState) => (
              <div
                key={`${workEntry.id}:${agentState.threadId}`}
                className="rounded-lg border border-border/60 bg-background/70 px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <WorkEntryChip monospace>{agentState.threadId.slice(0, 8)}</WorkEntryChip>
                  <WorkEntryChip tone="status" status={agentState.status}>
                    {workEntryStatusLabel(agentState.status) ?? agentState.status}
                  </WorkEntryChip>
                </div>
                {agentState.message ? (
                  <p className="pt-1 text-[11px] leading-4 text-muted-foreground/78">
                    {agentState.message}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
      {hasChangedFiles && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
            Changed files
          </p>
          <div className="flex flex-wrap gap-1.5">
            {workEntry.changedFiles?.map((filePath) => (
              <WorkEntryChip key={`${workEntry.id}:${filePath}`} monospace>
                {filePath}
              </WorkEntryChip>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : null;

  if (!detailsContent) {
    return <div className={cardClassName}>{summary}</div>;
  }

  return (
    <details open={defaultExpanded} className={cn(cardClassName, "group")}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      {detailsContent}
    </details>
  );
});
