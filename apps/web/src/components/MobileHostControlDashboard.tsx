import { scopeThreadRef } from "@wobex/client-runtime";
import type { EnvironmentId, ProjectId } from "@wobex/contracts";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CircleDotIcon,
  ClockIcon,
  PlusIcon,
  ServerIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { isElectron } from "../env";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useEnvironmentHostConnectionStatusStore } from "../environments/runtime";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { getWsConnectionUiState, useWsConnectionStatus } from "../rpc/wsConnectionState";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { buildThreadRouteParams } from "../threadRoutes";
import type { SidebarThreadSummary } from "../types";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { resolveMobileHostStatus } from "./MobileHostControlDashboard.logic";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";

const MAX_ACTIVE_SESSIONS = 6;
const MAX_NEEDS_ACTION = 6;
const MAX_RECENT_THREADS = 8;

function threadSortTime(thread: SidebarThreadSummary): string {
  return (
    thread.updatedAt ??
    thread.latestTurn?.completedAt ??
    thread.latestTurn?.startedAt ??
    thread.latestUserMessageAt ??
    thread.createdAt
  );
}

function sortThreadsByActivity(
  threads: ReadonlyArray<SidebarThreadSummary>,
): SidebarThreadSummary[] {
  return [...threads].toSorted((left, right) =>
    threadSortTime(right).localeCompare(threadSortTime(left)),
  );
}

function isActiveSession(thread: SidebarThreadSummary): boolean {
  return (
    thread.session?.orchestrationStatus === "starting" ||
    thread.session?.orchestrationStatus === "running"
  );
}

function needsAction(thread: SidebarThreadSummary): boolean {
  return (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.hasStalePendingRequest ||
    thread.hasActionableProposedPlan
  );
}

function actionLabel(thread: SidebarThreadSummary): string {
  if (thread.hasPendingApprovals) return "Approval";
  if (thread.hasPendingUserInput) return "Input";
  if (thread.hasStalePendingRequest) return "Restart";
  if (thread.hasActionableProposedPlan) return "Plan";
  return "Open";
}

function projectKey(environmentId: EnvironmentId, projectId: ProjectId): string {
  return `${environmentId}:${projectId}`;
}

function DashboardThreadLink({
  projectName,
  thread,
  variant,
}: {
  readonly projectName: string;
  readonly thread: SidebarThreadSummary;
  readonly variant: "active" | "action" | "recent";
}) {
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const timestamp = threadSortTime(thread);

  return (
    <Link
      className={cn(
        "group flex min-h-16 items-center justify-between gap-3 border-b border-border/55 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/55",
        variant === "action" && "bg-warning/6 hover:bg-warning/10",
      )}
      params={buildThreadRouteParams(threadRef)}
      to="/$environmentId/$threadId"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{thread.title}</span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{projectName}</span>
          <span aria-hidden="true">/</span>
          <span className="shrink-0">{formatRelativeTimeLabel(timestamp)}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {variant === "active" && <Badge variant="success">Live</Badge>}
        {variant === "action" && <Badge variant="warning">{actionLabel(thread)}</Badge>}
        {variant === "recent" && thread.session?.orchestrationStatus === "stopped" ? (
          <Badge variant="outline">Stopped</Badge>
        ) : null}
      </span>
    </Link>
  );
}

function DashboardSection({
  children,
  empty,
  icon,
  title,
}: {
  readonly children: ReactNode;
  readonly empty: string;
  readonly icon: ReactNode;
  readonly title: string;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card/30">
      <div className="flex items-center gap-2 border-b border-border/55 px-4 py-3">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {hasChildren ? (
        <div className="divide-y-0">{children}</div>
      ) : (
        <p className="px-4 py-5 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

export function MobileHostControlDashboard() {
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const wsStatus = useWsConnectionStatus();
  const uiState = getWsConnectionUiState(wsStatus);
  const hostConnectionState = useEnvironmentHostConnectionStatusStore((state) =>
    primaryEnvironmentId ? (state.byId[primaryEnvironmentId] ?? null) : null,
  );
  const hostStatus = resolveMobileHostStatus({
    environmentId: primaryEnvironmentId,
    hostConnectionState,
    wsUiState: uiState,
  });
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();

  const projectNameByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      map.set(projectKey(project.environmentId, project.id), project.name);
    }
    return map;
  }, [projects]);

  const visibleThreads = useMemo(
    () => sortThreadsByActivity(threads.filter((thread) => thread.archivedAt === null)),
    [threads],
  );
  const activeThreads = useMemo(
    () => visibleThreads.filter(isActiveSession).slice(0, MAX_ACTIVE_SESSIONS),
    [visibleThreads],
  );
  const actionThreads = useMemo(
    () => visibleThreads.filter(needsAction).slice(0, MAX_NEEDS_ACTION),
    [visibleThreads],
  );
  const recentThreads = useMemo(
    () => visibleThreads.slice(0, MAX_RECENT_THREADS),
    [visibleThreads],
  );

  const getProjectName = (thread: SidebarThreadSummary) =>
    projectNameByKey.get(projectKey(thread.environmentId, thread.projectId)) ?? "Unknown project";

  const startThread = () => {
    if (!defaultProjectRef) return;
    void handleNewThread(defaultProjectRef);
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "border-b border-border px-3 sm:px-5",
            isElectron ? "drag-region flex h-[52px] items-center" : "py-2 sm:py-3",
          )}
        >
          {isElectron ? (
            <span className="text-xs text-muted-foreground/50">Host control</span>
          ) : (
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
                Host control
              </span>
            </div>
          )}
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 lg:px-10">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-8">
            <section className="rounded-lg border border-border bg-card/35 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                    Mobile host control
                  </p>
                  <h1 className="mt-1 text-xl font-semibold text-foreground">
                    Submit from phone. Run on host.
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sessions, approvals, streaming and reconnect all stay anchored to this host.
                  </p>
                </div>
                <Button disabled={!defaultProjectRef} onClick={startThread} size="lg">
                  <PlusIcon className="size-4" />
                  New thread
                </Button>
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-card/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {hostStatus.isReachable ? (
                    <WifiIcon className="size-4 text-success-foreground" />
                  ) : (
                    <WifiOffIcon className="size-4 text-warning-foreground" />
                  )}
                  Host status
                </div>
                <p className="mt-2 text-2xl font-semibold text-foreground">{hostStatus.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{hostStatus.detail}</p>
              </div>
              <div className="rounded-lg border border-border bg-card/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ServerIcon className="size-4 text-muted-foreground" />
                  Host queue
                </div>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {activeThreads.length} active
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {actionThreads.length} waiting for you
                </p>
              </div>
            </section>

            <DashboardSection
              empty="No approvals or user input waiting."
              icon={<AlertTriangleIcon className="size-4" />}
              title="Needs Action"
            >
              {actionThreads.map((thread) => (
                <DashboardThreadLink
                  key={`${thread.environmentId}:${thread.id}`}
                  projectName={getProjectName(thread)}
                  thread={thread}
                  variant="action"
                />
              ))}
            </DashboardSection>

            <DashboardSection
              empty="No live sessions right now."
              icon={<CircleDotIcon className="size-4" />}
              title="Active Sessions"
            >
              {activeThreads.map((thread) => (
                <DashboardThreadLink
                  key={`${thread.environmentId}:${thread.id}`}
                  projectName={getProjectName(thread)}
                  thread={thread}
                  variant="active"
                />
              ))}
            </DashboardSection>

            <DashboardSection
              empty="No recent threads yet."
              icon={<ClockIcon className="size-4" />}
              title="Recent Threads"
            >
              {recentThreads.map((thread) => (
                <DashboardThreadLink
                  key={`${thread.environmentId}:${thread.id}`}
                  projectName={getProjectName(thread)}
                  thread={thread}
                  variant="recent"
                />
              ))}
            </DashboardSection>
          </div>
        </main>
      </div>
    </SidebarInset>
  );
}
