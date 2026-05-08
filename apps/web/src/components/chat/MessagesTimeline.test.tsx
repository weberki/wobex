import { MessageId } from "@wobex/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../ChatMarkdown", () => ({
  default: (props: { text: string }) => props.text,
}));

vi.mock("../ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props}>{props.children}</button>,
  buttonVariants: () => "",
}));

vi.mock("./ProposedPlanCard", () => ({
  ProposedPlanCard: (props: { planMarkdown: string }) => props.planMarkdown,
}));

vi.mock("./ChangedFilesTree", () => ({
  ChangedFilesTree: (props: { files: Array<{ path: string }> }) =>
    props.files.map((file) => file.path).join("\n"),
}));

vi.mock("./MessageCopyButton", () => ({
  MessageCopyButton: () => null,
}));

vi.mock("../timelineHeight", () => ({
  estimateTimelineMessageHeight: () => 64,
}));

vi.mock("./TerminalContextInlineChip", () => ({
  TerminalContextInlineChip: (props: { label: string }) => (
    <span className="lucide-terminal">{props.label}</span>
  ),
}));

vi.mock("../ui/tooltip", () => ({
  Tooltip: (props: { children: ComponentProps<"div">["children"] }) => props.children,
  TooltipTrigger: (props: { render: ComponentProps<"span">["children"] }) => props.render,
  TooltipPopup: (props: { children: ComponentProps<"div">["children"] }) => props.children,
}));

vi.mock("~/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" "),
}));

vi.mock("~/lib/terminalContext", () => ({
  formatInlineTerminalContextLabel: (header: string) => `@${header}`,
  deriveDisplayedUserMessageState: (text: string) => {
    const match = text.match(/<terminal_context>\s*- ([^:]+):\s*([\s\S]*?)<\/terminal_context>/);
    if (!match) {
      return { visibleText: text, contexts: [], copyText: text };
    }
    return {
      visibleText: text.slice(0, match.index).trimEnd(),
      contexts: [
        {
          header: match[1] ?? "Terminal",
          body: match[2]?.trim() ?? "",
        },
      ],
      copyText: text,
    };
  },
}));

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

const ACTIVE_THREAD_ENVIRONMENT_ID = "environment-local" as never;

describe("MessagesTimeline", () => {
  it("renders inline terminal labels with the composer chip UI", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-2"),
              role: "user",
              text: [
                "yoo what's @terminal-1:1-5 mean",
                "",
                "<terminal_context>",
                "- Terminal 1 lines 1-5:",
                "  1 | developer@mac effect-http-ws-cli % bun i",
                "  2 | bun install v1.3.9 (cf6cdbbb)",
                "</terminal_context>",
              ].join("\n"),
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        completionTurnDiffSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        projectName={undefined}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("yoo what&#x27;s ");
  }, 10_000);

  it("renders context compaction entries in the normal work log", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              activityKind: "context-compaction",
              label: "Context compacted",
              tone: "info",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        completionTurnDiffSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        projectName={undefined}
      />,
    );

    expect(markup).toContain("Context compacted");
    expect(markup).toContain("Work log");
  });

  it("renders changed files at the end of the response from completion fallback summary", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const assistantId = MessageId.make("assistant-final");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: assistantId,
              role: "assistant",
              text: "Finished the parity pass.",
              createdAt: "2026-03-17T19:12:28.000Z",
              completedAt: "2026-03-17T19:12:30.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId="entry-1"
        completionSummary="Worked for 21s • 2 files changed"
        completionTurnDiffSummary={{
          turnId: "turn-1" as never,
          completedAt: "2026-03-17T19:12:30.000Z",
          files: [
            {
              path: "apps/server/src/provider/Layers/CodexAdapter.ts",
              additions: 12,
              deletions: 3,
            },
            { path: "apps/web/src/session-logic.ts", additions: 4, deletions: 1 },
          ],
        }}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        projectName={undefined}
      />,
    );

    expect(markup).toContain("Response • Worked for 21s • 2 files changed");
    expect(markup).toContain("Changed files (2)");
    expect(markup).toContain("CodexAdapter.ts");
    expect(markup).toContain("session-logic.ts");
  });

  it("renders collapsible thinking blocks by default", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "thinking-entry",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "thinking-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              activityKind: "thinking.completed",
              label: "Thinking",
              detail: "Compare orchestration events against UI render states.",
              tone: "thinking",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        completionTurnDiffSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        projectName={undefined}
      />,
    );

    expect(markup).toContain("Thought for 0s");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("<button");
  });

  it("renders thinking content when expanded", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "thinking-entry",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "thinking-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              activityKind: "thinking.completed",
              label: "Thinking",
              detail: "Compare orchestration events against UI render states.",
              tone: "thinking",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        completionTurnDiffSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{ "thinking-entry": true }}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        projectName={undefined}
      />,
    );

    expect(markup).toContain("Thought for 0s");
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Compare orchestration events against UI render states.");
  });

  it("renders tool cards with exact input and output payloads", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "tool-entry",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "tool-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              activityKind: "tool.completed",
              label: "Tool call completed",
              detail: "Read app/server/src/index.ts",
              tone: "tool",
              itemType: "dynamic_tool_call",
              toolTitle: "Tool call",
              payload: {
                status: "completed",
                data: {
                  item: {
                    input: { file_path: "apps/server/src/index.ts" },
                    result: { preview: "import { serve } from..." },
                  },
                },
              },
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        completionTurnDiffSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        projectName={undefined}
      />,
    );

    expect(markup).toContain("Tool call");
    expect(markup).toContain("Input");
    expect(markup).toContain("file_path");
    expect(markup).toContain("Output");
    expect(markup).toContain("import { serve } from...");
  });

  it("renders subagent cards with agent team states", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "subagent-entry",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "subagent-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              activityKind: "tool.updated",
              label: "Subagent task",
              detail: "Spawn Agent",
              tone: "tool",
              itemType: "collab_agent_tool_call",
              toolTitle: "Subagent task",
              payload: {
                status: "in_progress",
                data: {
                  item: {
                    agentsStates: {
                      "thread-agent-1": {
                        status: "running",
                        message: "Indexing repo",
                      },
                    },
                  },
                },
              },
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        completionTurnDiffSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        projectName={undefined}
      />,
    );

    expect(markup).toContain("Agent team");
    expect(markup).toContain("thread-a");
    expect(markup).toContain("Running");
    expect(markup).toContain("Indexing repo");
  });

  it("renders hook blocks with monospace output", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "hook-entry",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "hook-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              activityKind: "hook.completed",
              label: "Hook completed",
              detail: "Post-apply hook output",
              tone: "tool",
              payload: {
                hookName: "post-apply",
                hookEvent: "file_change",
                outcome: "success",
                stdout: "formatted 2 files",
              },
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        completionTurnDiffSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        projectName={undefined}
      />,
    );

    expect(markup).toContain("Hook");
    expect(markup).toContain("post-apply");
    expect(markup).toContain("Stdout");
    expect(markup).toContain("formatted 2 files");
  });
});
