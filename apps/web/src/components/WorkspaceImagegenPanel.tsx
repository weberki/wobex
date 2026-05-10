import type {
  EnvironmentId,
  ServerGeneratedImage,
  ServerImageGenerationFit,
  ServerImageGenerationFormat,
  ServerImageGenerationInput,
  ServerImageGenerationResult,
} from "@wobex/contracts";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  LoaderIcon,
  PlayIcon,
  RotateCcwIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";

import { readEnvironmentApi } from "../environmentApi";
import { cn } from "../lib/utils";
import {
  buildImagegenRequests,
  clampImagegenCount,
  DEFAULT_IMAGEGEN_DRAFT,
  IMAGEGEN_ASPECT_PRESETS,
  IMAGEGEN_OUTPUT_PRESETS,
  IMAGEGEN_QUALITY_OPTIONS,
  type ImagegenAspectPreset,
  type ImagegenDraft,
  type ImagegenOutputPreset,
  type ImagegenQuality,
} from "./WorkspaceImagegenPanel.logic";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Textarea } from "./ui/textarea";

const IMAGEGEN_FORMAT_OPTIONS = [
  "png",
  "webp",
  "jpg",
  "jpeg",
] as const satisfies ReadonlyArray<ServerImageGenerationFormat>;
const IMAGEGEN_FIT_OPTIONS = [
  "cover",
  "contain",
  "fill",
] as const satisfies ReadonlyArray<ServerImageGenerationFit>;

type ImagegenJobStatus = "queued" | "running" | "succeeded" | "failed";

interface ImagegenJob {
  readonly id: string;
  readonly request: ServerImageGenerationInput;
  readonly status: ImagegenJobStatus;
  readonly result: ServerImageGenerationResult | null;
  readonly error: string | null;
  readonly durationMs: number | null;
}

export const WorkspaceImagegenPanel = memo(function WorkspaceImagegenPanel(props: {
  environmentId: EnvironmentId;
  workspaceRoot: string | undefined;
}) {
  const [draft, setDraft] = useState<ImagegenDraft>(DEFAULT_IMAGEGEN_DRAFT);
  const [jobs, setJobs] = useState<ImagegenJob[]>([]);
  const [running, setRunning] = useState(false);
  const [copiedSkill, setCopiedSkill] = useState(false);
  const runIdRef = useRef(0);

  const requests = useMemo(
    () => buildImagegenRequests(draft, { cwd: props.workspaceRoot ?? null }),
    [draft, props.workspaceRoot],
  );
  const totalImages = jobs.reduce(
    (total, job) => total + (job.result?.images.length ?? job.request.count ?? 1),
    0,
  );
  const successfulJobs = jobs.filter((job) => job.status === "succeeded").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;

  const updateDraft = useCallback(
    <K extends keyof ImagegenDraft>(key: K, value: ImagegenDraft[K]) => {
      setDraft((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const runGeneration = useCallback(async () => {
    const api = readEnvironmentApi(props.environmentId);
    const nextRequests = buildImagegenRequests(draft, { cwd: props.workspaceRoot ?? null });
    if (!api || nextRequests.length === 0) {
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const nextJobs = nextRequests.map(
      (request, index): ImagegenJob => ({
        id: `imagegen-${Date.now()}-${index}`,
        request,
        status: "queued",
        result: null,
        error: null,
        durationMs: null,
      }),
    );
    setJobs(nextJobs);
    setRunning(true);

    try {
      for (const job of nextJobs) {
        if (runIdRef.current !== runId) {
          break;
        }
        const startedAt = Date.now();
        setJobs((current) =>
          current.map((candidate) =>
            candidate.id === job.id ? { ...candidate, status: "running" } : candidate,
          ),
        );
        try {
          const result = await api.imageGeneration.generate(job.request);
          const durationMs = Date.now() - startedAt;
          setJobs((current) =>
            current.map((candidate) =>
              candidate.id === job.id
                ? { ...candidate, status: "succeeded", result, durationMs }
                : candidate,
            ),
          );
        } catch (error) {
          const durationMs = Date.now() - startedAt;
          setJobs((current) =>
            current.map((candidate) =>
              candidate.id === job.id
                ? {
                    ...candidate,
                    status: "failed",
                    error: errorMessage(error),
                    durationMs,
                  }
                : candidate,
            ),
          );
        }
      }
    } finally {
      if (runIdRef.current === runId) {
        setRunning(false);
      }
    }
  }, [draft, props.environmentId, props.workspaceRoot]);

  const stopAfterCurrentJob = useCallback(() => {
    runIdRef.current += 1;
    setRunning(false);
    setJobs((current) =>
      current.map((job) =>
        job.status === "queued" ? { ...job, status: "failed", error: "Skipped" } : job,
      ),
    );
  }, []);

  const resetDraft = useCallback(() => {
    setDraft(DEFAULT_IMAGEGEN_DRAFT);
  }, []);

  const copySkillPrompt = useCallback(async () => {
    const prompt = draft.prompt.trim();
    const text = prompt ? `@imagegen ${prompt}` : "@imagegen ";
    await navigator.clipboard?.writeText(text);
    setCopiedSkill(true);
    window.setTimeout(() => setCopiedSkill(false), 1200);
  }, [draft.prompt]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[color:var(--color-border-light,var(--border))] px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/70">
              <ImageIcon className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">Imagegen</h2>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                <Badge variant="outline" className="h-5 max-w-28 truncate px-1.5 text-[10px]">
                  $imagegen
                </Badge>
                <Badge variant="outline" className="h-5 max-w-28 truncate px-1.5 text-[10px]">
                  {props.workspaceRoot ? "workspace" : "server"}
                </Badge>
              </div>
            </div>
          </div>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Copy imagegen skill prompt"
            title="Copy imagegen skill prompt"
            onClick={copySkillPrompt}
          >
            {copiedSkill ? (
              <CheckCircle2Icon className="size-3.5" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <section className="space-y-3">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/60 bg-background/50 p-1">
              <ModeButton
                active={draft.mode === "single"}
                onClick={() => updateDraft("mode", "single")}
              >
                Single
              </ModeButton>
              <ModeButton
                active={draft.mode === "batch"}
                onClick={() => updateDraft("mode", "batch")}
              >
                Batch
              </ModeButton>
            </div>

            {draft.mode === "single" ? (
              <Field label="Prompt">
                <Textarea
                  value={draft.prompt}
                  onChange={(event) => updateDraft("prompt", event.currentTarget.value)}
                  placeholder="Describe the image to generate"
                  className="bg-background/70"
                />
              </Field>
            ) : (
              <Field label="Batch prompts">
                <Textarea
                  value={draft.batchPrompts}
                  onChange={(event) => updateDraft("batchPrompts", event.currentTarget.value)}
                  placeholder="Separate prompts with a blank line or ---"
                  className="bg-background/70"
                />
              </Field>
            )}
          </section>

          <section className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Aspect"
                value={draft.aspectPreset}
                onChange={(value) => updateDraft("aspectPreset", value as ImagegenAspectPreset)}
                options={IMAGEGEN_ASPECT_PRESETS}
              />
              <SelectField
                label="Output"
                value={draft.outputPreset}
                onChange={(value) => updateDraft("outputPreset", value as ImagegenOutputPreset)}
                options={IMAGEGEN_OUTPUT_PRESETS}
              />
            </div>

            {draft.outputPreset === "custom" ? (
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Width"
                  value={draft.customWidth}
                  onChange={(value) => updateDraft("customWidth", value)}
                />
                <NumberField
                  label="Height"
                  value={draft.customHeight}
                  onChange={(value) => updateDraft("customHeight", value)}
                />
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Quality"
                value={draft.quality}
                onChange={(value) => updateDraft("quality", value as ImagegenQuality)}
                options={IMAGEGEN_QUALITY_OPTIONS}
              />
              <SelectField
                label="Format"
                value={draft.format}
                onChange={(value) => updateDraft("format", value as ServerImageGenerationFormat)}
                options={IMAGEGEN_FORMAT_OPTIONS}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Fit"
                value={draft.fit}
                onChange={(value) => updateDraft("fit", value as ServerImageGenerationFit)}
                options={IMAGEGEN_FIT_OPTIONS}
              />
              <NumberField
                label="Variants"
                value={draft.count}
                onChange={(value) => updateDraft("count", clampImagegenCount(value))}
                min={1}
                max={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Name">
                <Input
                  value={draft.outputBasename}
                  onChange={(event) => updateDraft("outputBasename", event.currentTarget.value)}
                  placeholder="imagegen"
                />
              </Field>
              <Field label="Background">
                <Input
                  value={draft.background}
                  onChange={(event) => updateDraft("background", event.currentTarget.value)}
                  placeholder="#101418"
                />
              </Field>
            </div>
          </section>

          <section className="grid gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                className="flex-1"
                disabled={running || requests.length === 0}
                onClick={runGeneration}
              >
                {running ? (
                  <LoaderIcon className="size-4 animate-spin" />
                ) : (
                  <PlayIcon className="size-4" />
                )}
                Generate
              </Button>
              {running ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={stopAfterCurrentJob}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              ) : (
                <Button type="button" variant="outline" size="icon-sm" onClick={resetDraft}>
                  <RotateCcwIcon className="size-4" />
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground/75">
              <span>
                {requests.length} job{requests.length === 1 ? "" : "s"} ready
              </span>
              {jobs.length > 0 ? (
                <span>
                  {successfulJobs} done
                  {failedJobs > 0 ? `, ${failedJobs} failed` : ""}
                </span>
              ) : null}
            </div>
          </section>

          <ImagegenResults jobs={jobs} totalImages={totalImages} />
        </div>
      </ScrollArea>
    </div>
  );
});

function ModeButton(props: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      className={cn(
        "h-7 rounded-md px-2 text-xs transition",
        props.active
          ? "bg-[var(--color-background-button-secondary)] text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground",
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function Field(props: { children: React.ReactNode; label: string }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground/80">{props.label}</span>
      {props.children}
    </label>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Field label={props.label}>
      <Input
        type="number"
        nativeInput
        min={props.min ?? 1}
        max={props.max ?? 8192}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
      />
    </Field>
  );
}

function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={props.label}>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value as T)}
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ImagegenResults(props: { jobs: ReadonlyArray<ImagegenJob>; totalImages: number }) {
  if (props.jobs.length === 0) {
    return (
      <Empty className="min-h-64 rounded-lg border border-dashed border-border/60 bg-background/30">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SparklesIcon className="size-5" />
          </EmptyMedia>
          <EmptyTitle>No images yet</EmptyTitle>
          <EmptyDescription>Generated files will appear in this workspace panel.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Results</h3>
        <Badge variant="outline" className="text-[10px]">
          {props.totalImages} image{props.totalImages === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="space-y-3">
        {props.jobs.map((job, index) => (
          <div key={job.id} className="rounded-lg border border-border/60 bg-background/45 p-2.5">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">Job {index + 1}</p>
                <p className="truncate text-[11px] text-muted-foreground/75">
                  {job.request.prompt}
                </p>
              </div>
              <JobStatusBadge job={job} />
            </div>
            {job.status === "failed" ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive text-xs">
                <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{job.error ?? "Generation failed"}</span>
              </div>
            ) : null}
            {job.result ? <ImageGallery images={job.result.images} /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function JobStatusBadge(props: { job: ImagegenJob }) {
  const { job } = props;
  const label =
    job.status === "running"
      ? "Running"
      : job.status === "succeeded"
        ? job.durationMs
          ? formatDuration(job.durationMs)
          : "Done"
        : job.status === "failed"
          ? "Failed"
          : "Queued";
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 shrink-0 gap-1 px-1.5 text-[10px]",
        job.status === "succeeded" && "border-emerald-500/35 text-emerald-500",
        job.status === "failed" && "border-destructive/35 text-destructive",
      )}
    >
      {job.status === "running" ? <LoaderIcon className="size-3 animate-spin" /> : null}
      {label}
    </Badge>
  );
}

function ImageGallery(props: { images: ReadonlyArray<ServerGeneratedImage> }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {props.images.map((image) => (
        <figure
          key={image.url}
          className="overflow-hidden rounded-md border border-border/60 bg-muted/20"
        >
          <img
            src={image.url}
            alt="Generated"
            className="aspect-video w-full bg-background object-cover"
            loading="lazy"
          />
          <figcaption className="flex items-center justify-between gap-1 px-2 py-1.5 text-[10px] text-muted-foreground/75">
            <span className="truncate">{formatBytes(image.sizeBytes)}</span>
            <a
              href={image.url}
              download
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Download generated image"
            >
              <DownloadIcon className="size-3" />
            </a>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Image generation failed.";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
