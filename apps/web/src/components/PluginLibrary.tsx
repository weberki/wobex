import {
  type EnvironmentId,
  type ProviderKind,
  PROVIDER_DISPLAY_NAMES,
  type ProviderPluginDescriptor,
  type ProviderSkillDescriptor,
} from "@wobex/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  BlocksIcon,
  BoxIcon,
  CommandIcon,
  LoaderIcon,
  PuzzleIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "../environmentApi";
import { useServerConfig } from "../rpc/serverState";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

const FALLBACK_PROVIDERS = ["codex", "claudeAgent", "opencode", "droid"] as const;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Discovery is unavailable for this provider.";
}

function providerDiscoveryQueryKey(
  environmentId: EnvironmentId | null,
  provider: ProviderKind,
  kind: string,
) {
  return ["provider-discovery", environmentId, provider, kind] as const;
}

function matchesQuery(value: string | null | undefined, query: string): boolean {
  if (query.length === 0) return true;
  return (value ?? "").toLowerCase().includes(query);
}

function providerPluginLabel(plugin: ProviderPluginDescriptor): string {
  return plugin.interface?.displayName ?? plugin.name;
}

function providerSkillLabel(skill: ProviderSkillDescriptor): string {
  return skill.interface?.displayName ?? skill.name;
}

export function PluginLibrary({ environmentId }: { environmentId: EnvironmentId | null }) {
  const serverConfig = useServerConfig();
  const providerOptions = useMemo<ProviderKind[]>(() => {
    const providers = serverConfig?.providers ?? [];
    const configured = providers.map((provider) => provider.provider);
    return configured.length > 0 ? configured : [...FALLBACK_PROVIDERS];
  }, [serverConfig?.providers]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>(
    providerOptions[0] ?? "codex",
  );
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    if (providerOptions.includes(selectedProvider)) {
      return;
    }
    setSelectedProvider(providerOptions[0] ?? "codex");
  }, [providerOptions, selectedProvider]);

  const enabled = environmentId !== null;
  const capabilitiesQuery = useQuery({
    queryKey: providerDiscoveryQueryKey(environmentId, selectedProvider, "capabilities"),
    queryFn: async () => {
      if (!environmentId) throw new Error("Provider discovery is unavailable.");
      const api = readEnvironmentApi(environmentId);
      if (!api) throw new Error("Environment API is unavailable.");
      return api.providerDiscovery.getComposerCapabilities({ provider: selectedProvider });
    },
    enabled,
    retry: false,
  });
  const pluginsQuery = useQuery({
    queryKey: providerDiscoveryQueryKey(environmentId, selectedProvider, "plugins"),
    queryFn: async () => {
      if (!environmentId) throw new Error("Provider discovery is unavailable.");
      const api = readEnvironmentApi(environmentId);
      if (!api) throw new Error("Environment API is unavailable.");
      return api.providerDiscovery.listPlugins({ provider: selectedProvider });
    },
    enabled,
    retry: false,
  });
  const skillsQuery = useQuery({
    queryKey: providerDiscoveryQueryKey(environmentId, selectedProvider, "skills"),
    queryFn: async () => {
      if (!environmentId) throw new Error("Provider discovery is unavailable.");
      const api = readEnvironmentApi(environmentId);
      if (!api) throw new Error("Environment API is unavailable.");
      return api.providerDiscovery.listSkills({ provider: selectedProvider });
    },
    enabled,
    retry: false,
  });
  const commandsQuery = useQuery({
    queryKey: providerDiscoveryQueryKey(environmentId, selectedProvider, "commands"),
    queryFn: async () => {
      if (!environmentId) throw new Error("Provider discovery is unavailable.");
      const api = readEnvironmentApi(environmentId);
      if (!api) throw new Error("Environment API is unavailable.");
      return api.providerDiscovery.listCommands({ provider: selectedProvider });
    },
    enabled,
    retry: false,
  });
  const modelsQuery = useQuery({
    queryKey: providerDiscoveryQueryKey(environmentId, selectedProvider, "models"),
    queryFn: async () => {
      if (!environmentId) throw new Error("Provider discovery is unavailable.");
      const api = readEnvironmentApi(environmentId);
      if (!api) throw new Error("Environment API is unavailable.");
      return api.providerDiscovery.listModels({ provider: selectedProvider });
    },
    enabled,
    retry: false,
  });

  const plugins = useMemo(
    () =>
      (pluginsQuery.data?.plugins ?? []).filter((plugin) => {
        if (normalizedQuery.length === 0) return true;
        return (
          matchesQuery(providerPluginLabel(plugin), normalizedQuery) ||
          matchesQuery(plugin.description, normalizedQuery) ||
          matchesQuery(plugin.interface?.shortDescription, normalizedQuery) ||
          matchesQuery(plugin.interface?.developerName, normalizedQuery) ||
          matchesQuery(plugin.interface?.category, normalizedQuery)
        );
      }),
    [normalizedQuery, pluginsQuery.data?.plugins],
  );
  const skills = useMemo(
    () =>
      (skillsQuery.data?.skills ?? []).filter((skill) => {
        if (normalizedQuery.length === 0) return true;
        return (
          matchesQuery(providerSkillLabel(skill), normalizedQuery) ||
          matchesQuery(skill.description, normalizedQuery) ||
          matchesQuery(skill.interface?.shortDescription, normalizedQuery) ||
          matchesQuery(skill.path, normalizedQuery)
        );
      }),
    [normalizedQuery, skillsQuery.data?.skills],
  );
  const commands = useMemo(
    () =>
      (commandsQuery.data?.commands ?? []).filter((command) => {
        if (normalizedQuery.length === 0) return true;
        return (
          matchesQuery(command.name, normalizedQuery) ||
          matchesQuery(command.description, normalizedQuery)
        );
      }),
    [commandsQuery.data?.commands, normalizedQuery],
  );
  const models = useMemo(
    () =>
      (modelsQuery.data?.models ?? []).filter((model) => {
        if (normalizedQuery.length === 0) return true;
        return (
          matchesQuery(model.name, normalizedQuery) || matchesQuery(model.slug, normalizedQuery)
        );
      }),
    [modelsQuery.data?.models, normalizedQuery],
  );
  const activeProviderStatus = serverConfig?.providers.find(
    (provider) => provider.provider === selectedProvider,
  );
  const loading =
    capabilitiesQuery.isPending ||
    pluginsQuery.isPending ||
    skillsQuery.isPending ||
    commandsQuery.isPending ||
    modelsQuery.isPending;
  const unsupportedMessage =
    capabilitiesQuery.error ??
    (pluginsQuery.error && skillsQuery.error && commandsQuery.error && modelsQuery.error
      ? pluginsQuery.error
      : null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b border-border/70 px-5 py-5 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <BlocksIcon className="size-3.5" />
              Provider Library
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              Plugins, skills, commands, and models
            </h1>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">
              Read-only provider discovery. Unsupported providers stay visible with an explicit
              empty state instead of hiding the library.
            </p>
          </div>
          {loading ? (
            <Badge variant="outline" className="gap-1.5">
              <LoaderIcon className="size-3 animate-spin" />
              Syncing
            </Badge>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {providerOptions.map((provider) => {
            const status = serverConfig?.providers.find((entry) => entry.provider === provider);
            const selected = selectedProvider === provider;
            return (
              <Button
                key={provider}
                type="button"
                size="sm"
                variant={selected ? "default" : "outline"}
                className="gap-2"
                onClick={() => setSelectedProvider(provider)}
              >
                {PROVIDER_DISPLAY_NAMES[provider] ?? provider}
                {status?.enabled === false ? (
                  <span className="rounded-full bg-background/20 px-1.5 py-0.5 text-[10px]">
                    disabled
                  </span>
                ) : null}
              </Button>
            );
          })}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border/60 px-5 py-3 sm:px-8 lg:px-10">
          <div className="relative w-full">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground/65" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              className="pl-8"
              placeholder="Search discovered plugins, skills, commands, and models"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-5 py-5 sm:px-8 lg:px-10">
            {unsupportedMessage ? (
              <section className="rounded-2xl border border-amber-500/35 bg-amber-500/8 p-4">
                <div className="flex items-start gap-3">
                  <SparklesIcon className="mt-0.5 size-4 text-amber-700 dark:text-amber-300" />
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Discovery is not fully supported for{" "}
                      {PROVIDER_DISPLAY_NAMES[selectedProvider] ?? selectedProvider}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {errorMessage(unsupportedMessage)}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <LibraryStat label="Plugins" value={String(pluginsQuery.data?.plugins.length ?? 0)} />
              <LibraryStat label="Skills" value={String(skillsQuery.data?.skills.length ?? 0)} />
              <LibraryStat
                label="Commands"
                value={String(commandsQuery.data?.commands.length ?? 0)}
              />
              <LibraryStat label="Models" value={String(modelsQuery.data?.models.length ?? 0)} />
            </section>

            {activeProviderStatus ? (
              <section className="rounded-2xl border border-border/70 bg-card/55 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {PROVIDER_DISPLAY_NAMES[selectedProvider] ?? selectedProvider}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {activeProviderStatus.version
                        ? `Version ${activeProviderStatus.version}`
                        : "Version not reported"}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {activeProviderStatus.status}
                  </Badge>
                </div>
                {activeProviderStatus.message ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {activeProviderStatus.message}
                  </p>
                ) : null}
              </section>
            ) : null}

            <LibrarySection
              title="Plugins"
              icon={<PuzzleIcon className="size-4" />}
              emptyTitle="No plugins"
              emptyDescription="This provider did not return plugin descriptors."
              loading={pluginsQuery.isPending}
              error={pluginsQuery.error}
            >
              {plugins.map((plugin) => (
                <LibraryCard
                  key={plugin.id}
                  title={providerPluginLabel(plugin)}
                  description={
                    plugin.interface?.shortDescription ?? plugin.description ?? plugin.path ?? null
                  }
                  meta={[
                    plugin.installed ? "installed" : "not installed",
                    plugin.enabled ? "enabled" : "disabled",
                    plugin.interface?.category,
                  ]}
                />
              ))}
            </LibrarySection>

            <LibrarySection
              title="Skills"
              icon={<SparklesIcon className="size-4" />}
              emptyTitle="No skills"
              emptyDescription="This provider did not return skill descriptors."
              loading={skillsQuery.isPending}
              error={skillsQuery.error}
            >
              {skills.map((skill) => (
                <LibraryCard
                  key={`${skill.name}:${skill.path}`}
                  title={providerSkillLabel(skill)}
                  description={skill.interface?.shortDescription ?? skill.description ?? skill.path}
                  meta={[skill.enabled ? "enabled" : "disabled", skill.scope, skill.path]}
                />
              ))}
            </LibrarySection>

            <LibrarySection
              title="Commands"
              icon={<CommandIcon className="size-4" />}
              emptyTitle="No commands"
              emptyDescription="This provider did not return native slash commands."
              loading={commandsQuery.isPending}
              error={commandsQuery.error}
            >
              {commands.map((command) => (
                <LibraryCard
                  key={command.name}
                  title={command.name}
                  description={command.description ?? "No description reported."}
                  meta={["native command"]}
                />
              ))}
            </LibrarySection>

            <LibrarySection
              title="Models"
              icon={<BoxIcon className="size-4" />}
              emptyTitle="No runtime models"
              emptyDescription="This provider did not return a runtime model list."
              loading={modelsQuery.isPending}
              error={modelsQuery.error}
            >
              {models.map((model) => (
                <LibraryCard
                  key={model.slug}
                  title={model.name}
                  description={model.slug}
                  meta={[
                    model.capabilities?.supportsFastMode ? "fast mode" : "standard",
                    model.capabilities?.supportsThinkingToggle ? "thinking toggle" : null,
                    `${model.capabilities?.contextWindowOptions.length ?? 0} context windows`,
                  ]}
                />
              ))}
            </LibrarySection>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function LibraryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/55 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function LibrarySection({
  title,
  icon,
  emptyTitle,
  emptyDescription,
  loading,
  error,
  children,
}: {
  title: string;
  icon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  loading: boolean;
  error: unknown;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="rounded-2xl border border-border/70 bg-card/45">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </div>
        {loading ? <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" /> : null}
      </div>
      <div className="p-3">
        {error ? (
          <Empty className="min-h-44 py-6">
            <EmptyHeader>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              <EmptyDescription>{errorMessage(error)}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : hasChildren ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{children}</div>
        ) : (
          <Empty className="min-h-44 py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">{icon}</EmptyMedia>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              <EmptyDescription>{emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </section>
  );
}

function LibraryCard({
  title,
  description,
  meta,
}: {
  title: string;
  description: string | null | undefined;
  meta: readonly (string | null | undefined)[];
}) {
  const metaValues = meta.filter((value): value is string => Boolean(value));
  return (
    <article className="rounded-xl border border-border/70 bg-background/70 p-3">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description ? (
        <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{description}</p>
      ) : null}
      {metaValues.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {metaValues.slice(0, 4).map((value) => (
            <span
              key={value}
              className={cn(
                "max-w-full truncate rounded-full border border-border/70 bg-muted/50 px-2 py-0.5",
                "text-[10px] uppercase tracking-[0.08em] text-muted-foreground",
              )}
            >
              {value}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
