import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PinIcon,
  UsersRoundIcon,
} from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

import type {
  ActivitySummaryBackgroundAgent,
  ActivitySummaryModel,
  ActivitySummaryProgressItem,
  ActivitySummarySource,
} from "./activitySummary.logic";

export const ActivitySummaryPanel = memo(function ActivitySummaryPanel(props: {
  model: ActivitySummaryModel;
  className?: string;
}) {
  const { model } = props;

  return (
    <section
      className={cn(
        "mx-auto w-full max-w-[340px] rounded-2xl border border-[color:var(--color-border-light,var(--border))] bg-[color:var(--composer-surface,var(--card))] px-4 py-4 text-sm shadow-sm",
        props.className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          <span>Progress</span>
          <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
        </div>
        <PinIcon className="size-3.5 shrink-0 text-muted-foreground/55" aria-hidden="true" />
      </div>

      <div className="mt-3 space-y-2">
        {model.progress.items.length > 0 ? (
          model.progress.items.map((item) => <ProgressRow key={item.id} item={item} />)
        ) : (
          <EmptyRow label="No active progress" />
        )}
      </div>

      <Divider />

      <SummarySection title="Branch details">
        <DetailRow
          icon={<GitBranchIcon className="size-3.5" aria-hidden="true" />}
          label={model.branchDetails.branchLabel}
        />
        <DetailRow
          icon={<GitCommitHorizontalIcon className="size-3.5" aria-hidden="true" />}
          label="Changes"
          value={<ChangeStat value={model.branchDetails.changesLabel} />}
          title={model.branchDetails.changesDetail}
        />
        <DetailRow
          icon={<GitBranchIcon className="size-3.5" aria-hidden="true" />}
          label="Git actions"
          value={model.branchDetails.gitActionsLabel}
        />
        <DetailRow
          icon={<GitPullRequestIcon className="size-3.5" aria-hidden="true" />}
          label={
            model.branchDetails.pullRequestUrl ? (
              <a
                href={model.branchDetails.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-foreground hover:underline"
              >
                <span className="truncate">{model.branchDetails.pullRequestLabel}</span>
                <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              model.branchDetails.pullRequestLabel
            )
          }
          muted={!model.branchDetails.pullRequestUrl}
        />
      </SummarySection>

      <Divider />

      <SummarySection title="Background agents">
        {model.backgroundAgents.length > 0 ? (
          model.backgroundAgents.map((agent) => <AgentRow key={agent.id} agent={agent} />)
        ) : (
          <EmptyRow label="No background agents" />
        )}
      </SummarySection>

      <Divider />

      <SummarySection title="Sources">
        {model.sources.length > 0 ? (
          model.sources.map((source) => <SourceRow key={source.id} source={source} />)
        ) : (
          <EmptyRow label="No external sources" />
        )}
      </SummarySection>
    </section>
  );
});

function SummarySection(props: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-medium text-muted-foreground/70">{props.title}</h3>
      <div className="space-y-2">{props.children}</div>
    </div>
  );
}

function ProgressRow(props: { item: ActivitySummaryProgressItem }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <div className="mt-[2px] shrink-0">{progressIcon(props.item.status)}</div>
      <p
        className={cn(
          "min-w-0 text-[13px] font-medium leading-snug",
          props.item.status === "completed"
            ? "text-muted-foreground/75"
            : props.item.status === "inProgress"
              ? "text-foreground"
              : "text-muted-foreground/55",
        )}
      >
        {props.item.label}
      </p>
    </div>
  );
}

function progressIcon(status: ActivitySummaryProgressItem["status"]) {
  if (status === "completed") {
    return <CheckCircle2Icon className="size-3.5 text-muted-foreground/75" aria-hidden="true" />;
  }
  if (status === "inProgress") {
    return <LoaderCircleIcon className="size-3.5 animate-spin text-blue-500" aria-hidden="true" />;
  }
  return <CircleIcon className="size-3.5 text-muted-foreground/35" aria-hidden="true" />;
}

function DetailRow(props: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value?: React.ReactNode;
  title?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5" title={props.title}>
      <span className="shrink-0 text-muted-foreground/70">{props.icon}</span>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span
          className={cn(
            "min-w-0 truncate text-[13px] font-medium",
            props.muted ? "text-muted-foreground/65" : "text-foreground/90",
          )}
        >
          {props.label}
        </span>
        {props.value ? (
          <span className="shrink-0 text-[12px] font-medium text-muted-foreground/75">
            {props.value}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AgentRow(props: { agent: ActivitySummaryBackgroundAgent }) {
  const statusLabel = props.agent.role ? `(${props.agent.role})` : props.agent.status;
  return (
    <div
      className="flex min-w-0 items-center gap-2.5"
      title={props.agent.message ?? props.agent.id}
    >
      <UsersRoundIcon className="size-3.5 shrink-0 text-blue-500" aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-blue-500">
          {props.agent.label}{" "}
          <span className="font-medium text-muted-foreground/65">{statusLabel}</span>
        </p>
        {props.agent.message ? (
          <p className="truncate text-[11px] text-muted-foreground/55">{props.agent.message}</p>
        ) : null}
      </div>
    </div>
  );
}

function SourceRow(props: { source: ActivitySummarySource }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5" title={props.source.detail ?? undefined}>
      <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground/75" aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground/90">{props.source.label}</p>
        {props.source.detail ? (
          <p className="truncate text-[11px] text-muted-foreground/55">{props.source.detail}</p>
        ) : null}
      </div>
    </div>
  );
}

function ChangeStat(props: { value: string }) {
  const match = props.value.match(/^\+(\d+)\s+-(\d+)$/);
  if (!match) {
    return <span>{props.value}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-emerald-500">+{match[1]}</span>
      <span className="text-red-500">-{match[2]}</span>
    </span>
  );
}

function EmptyRow(props: { label: string }) {
  return <p className="text-[13px] text-muted-foreground/50">{props.label}</p>;
}

function Divider() {
  return <div className="my-4 h-px bg-[color:var(--color-border-light,var(--border))]" />;
}
