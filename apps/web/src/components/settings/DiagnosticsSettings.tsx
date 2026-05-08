import {
  type ObservabilityLogLevel,
  type ObservabilityLogRecord,
  type ObservabilityLogSource,
  type ObservabilityOverview,
  type ObservabilityProviderStat,
  type ObservabilitySpanRecord,
  type ThreadId,
} from "@wobex/contracts";
import { ActivityIcon, DatabaseIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { useServerObservability } from "../../rpc/serverState";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const EMPTY_OVERVIEW: ObservabilityOverview = {
  totalLogs: 0,
  errorLogs: 0,
  warningLogs: 0,
  totalSpans: 0,
  slowRpcSpans: 0,
  providerTurns: 0,
  failedProviderTurns: 0,
  terminalRestarts: 0,
  gitFailures: 0,
  dbSizeBytes: 0,
  rawLogSizeBytes: 0,
};

const SOURCE_FILTERS: ReadonlyArray<"all" | ObservabilityLogSource> = [
  "all",
  "provider",
  "rpc",
  "orchestration",
  "git",
  "terminal",
  "browser",
];

const LEVEL_FILTERS: ReadonlyArray<"all" | ObservabilityLogLevel> = [
  "all",
  "error",
  "warning",
  "info",
];

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function levelVariant(level: ObservabilityLogLevel) {
  switch (level) {
    case "error":
      return "error" as const;
    case "warning":
      return "warning" as const;
    case "debug":
      return "outline" as const;
    case "info":
    default:
      return "secondary" as const;
  }
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 border-t border-border/60 px-4 py-4 first:border-t-0 sm:px-5">
      <div className="text-[11px] font-medium uppercase text-muted-foreground/70">{label}</div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground/80">{detail}</div> : null}
    </div>
  );
}

function LogRow({ record }: { record: ObservabilityLogRecord }) {
  return (
    <div className="grid gap-2 border-t border-border/60 px-4 py-3 first:border-t-0 sm:grid-cols-[9rem_7rem_1fr] sm:px-5">
      <div className="min-w-0 text-xs text-muted-foreground">
        {formatTimestamp(record.recordedAt)}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant={levelVariant(record.level)}>{record.level}</Badge>
        <span className="truncate text-xs text-muted-foreground">{record.source}</span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm text-foreground">{record.message}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground/80">
          {record.provider ? <span>{record.provider}</span> : null}
          {record.eventType ? <span>{record.eventType}</span> : null}
          {record.threadId ? <span className="truncate">thread {record.threadId}</span> : null}
        </div>
      </div>
    </div>
  );
}

function SpanRow({ record }: { record: ObservabilitySpanRecord }) {
  return (
    <div className="grid gap-2 border-t border-border/60 px-4 py-3 first:border-t-0 sm:grid-cols-[1fr_6rem_7rem] sm:px-5">
      <div className="min-w-0">
        <div className="truncate text-sm text-foreground">{record.rpcMethod ?? record.name}</div>
        <div className="mt-1 truncate text-[11px] text-muted-foreground/80">
          {formatTimestamp(record.recordedAt)}
        </div>
      </div>
      <div className="text-sm text-foreground">{Math.round(record.durationMs)} ms</div>
      <Badge variant={record.outcome === "failure" ? "error" : "secondary"}>
        {record.outcome ?? "unknown"}
      </Badge>
    </div>
  );
}

function ProviderStatRow({ stat }: { stat: ObservabilityProviderStat }) {
  return (
    <div className="grid gap-2 border-t border-border/60 px-4 py-3 first:border-t-0 sm:grid-cols-[1fr_5rem_5rem_8rem] sm:px-5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{stat.provider}</div>
        <div className="truncate text-xs text-muted-foreground/80">
          {stat.model ?? "All models"}
        </div>
      </div>
      <div className="text-sm text-foreground">{formatCount(stat.turns)} turns</div>
      <div className="text-sm text-foreground">{formatCount(stat.failures)} fails</div>
      <div className="truncate text-xs text-muted-foreground/80">
        {formatTimestamp(stat.latestEventAt)}
      </div>
    </div>
  );
}

export function DiagnosticsSettings() {
  const serverObservability = useServerObservability();
  const [overview, setOverview] = useState<ObservabilityOverview>(EMPTY_OVERVIEW);
  const [logs, setLogs] = useState<ReadonlyArray<ObservabilityLogRecord>>([]);
  const [spans, setSpans] = useState<ReadonlyArray<ObservabilitySpanRecord>>([]);
  const [providerStats, setProviderStats] = useState<ReadonlyArray<ObservabilityProviderStat>>([]);
  const [sourceFilter, setSourceFilter] = useState<"all" | ObservabilityLogSource>("all");
  const [levelFilter, setLevelFilter] = useState<"all" | ObservabilityLogLevel>("all");
  const [search, setSearch] = useState("");
  const [threadId, setThreadId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const logQuery = useMemo(
    () => ({
      ...(sourceFilter !== "all" ? { source: sourceFilter } : {}),
      ...(levelFilter !== "all" ? { level: levelFilter } : {}),
      ...(search.trim().length > 0 ? { search: search.trim() } : {}),
      ...(threadId.trim().length > 0 ? { threadId: threadId.trim() as ThreadId } : {}),
      limit: 80,
    }),
    [levelFilter, search, sourceFilter, threadId],
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const client = getPrimaryEnvironmentConnection().client.observability;
      const [nextOverview, nextLogs, nextSpans, nextProviderStats] = await Promise.all([
        client.getOverview(),
        client.queryLogs(logQuery),
        client.querySpans({ limit: 12 }),
        client.getProviderStats(),
      ]);
      setOverview(nextOverview);
      setLogs(nextLogs.records);
      setSpans(nextSpans.records);
      setProviderStats(nextProviderStats.providers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load diagnostics.");
    } finally {
      setIsLoading(false);
    }
  }, [logQuery]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clearLocalData = useCallback(async () => {
    setClearDialogOpen(false);
    setError(null);
    try {
      await getPrimaryEnvironmentConnection().client.observability.clearLocalData();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to clear diagnostics.");
    }
  }, [refresh]);

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Diagnostics"
        icon={<ActivityIcon className="size-3.5" />}
        headerAction={
          <div className="flex items-center gap-2">
            <Button size="xs" variant="outline" disabled={isLoading} onClick={() => void refresh()}>
              <RefreshCwIcon className="size-3.5" />
              Refresh
            </Button>
            <Button size="xs" variant="outline" onClick={() => setClearDialogOpen(true)}>
              <Trash2Icon className="size-3.5" />
              Clear
            </Button>
          </div>
        }
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Logs" value={formatCount(overview.totalLogs)} detail="Local metadata" />
          <StatTile
            label="Errors"
            value={formatCount(overview.errorLogs)}
            detail={`${formatCount(overview.warningLogs)} warnings`}
          />
          <StatTile
            label="Provider turns"
            value={formatCount(overview.providerTurns)}
            detail={`${formatCount(overview.failedProviderTurns)} failed`}
          />
          <StatTile
            label="Slow RPCs"
            value={formatCount(overview.slowRpcSpans)}
            detail={`${formatCount(overview.totalSpans)} spans`}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Storage" icon={<DatabaseIcon className="size-3.5" />}>
        <div className="grid sm:grid-cols-3">
          <StatTile
            label="SQLite"
            value={formatBytes(overview.dbSizeBytes)}
            detail="Queryable metadata"
          />
          <StatTile
            label="Raw logs"
            value={formatBytes(overview.rawLogSizeBytes)}
            detail="Local files"
          />
          <StatTile
            label="Log folder"
            value={serverObservability?.logsDirectoryPath ? "Ready" : "Unknown"}
            detail={serverObservability?.logsDirectoryPath ?? "No path reported"}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Logs">
        <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap gap-2">
            {SOURCE_FILTERS.map((source) => (
              <Button
                key={source}
                size="xs"
                variant={sourceFilter === source ? "secondary" : "outline"}
                onClick={() => setSourceFilter(source)}
              >
                {source}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {LEVEL_FILTERS.map((level) => (
              <Button
                key={level}
                size="xs"
                variant={levelFilter === level ? "secondary" : "outline"}
                onClick={() => setLevelFilter(level)}
              >
                {level}
              </Button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={search}
              placeholder="Search log text"
              onChange={(event) => setSearch(event.target.value)}
            />
            <Input
              value={threadId}
              placeholder="Thread ID"
              onChange={(event) => setThreadId(event.target.value)}
            />
          </div>
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
        </div>
        {logs.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
            No matching diagnostics yet.
          </div>
        ) : (
          logs.map((record) => <LogRow key={record.id} record={record} />)
        )}
      </SettingsSection>

      <SettingsSection title="Provider Stats">
        {providerStats.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
            No provider activity yet.
          </div>
        ) : (
          providerStats.map((stat) => (
            <ProviderStatRow
              key={`${stat.provider}:${stat.model ?? "all"}:${stat.latestEventAt ?? "never"}`}
              stat={stat}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title="Recent RPC Spans">
        {spans.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground sm:px-5">No spans yet.</div>
        ) : (
          spans.map((record) => <SpanRow key={record.id} record={record} />)
        )}
      </SettingsSection>

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear diagnostics metadata?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears queryable local metadata. Raw log files remain in the logs folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={() => void clearLocalData()}>
              Clear metadata
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsPageContainer>
  );
}
