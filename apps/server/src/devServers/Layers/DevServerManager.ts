import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as FS from "node:fs";
import * as Path from "node:path";

import {
  DevServerError,
  type DevServerListener,
  type DevServerSnapshot,
  type DevServerStartInput,
  type ExternalDevServer,
  type ManagedDevServer,
  type ProjectScript,
} from "@wobex/contracts";
import { projectScriptRuntimeEnv } from "@wobex/shared/projectScripts";
import { Effect, Layer, Schedule, Stream } from "effect";

import { ServerConfig } from "../../config";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { runProcess } from "../../processRunner";
import { DevServerManager, type DevServerManagerShape } from "../Services/DevServerManager";

interface ProcessSnapshot {
  readonly pid: number;
  readonly parentPid: number | null;
  readonly command: string;
  readonly args: string;
  readonly cpuPercent: number;
  readonly memoryPercent: number;
}

interface ManagedDevServerRecord extends ManagedDevServer {
  readonly rootPid: number | null;
}

interface ManagedRuntime {
  record: ManagedDevServerRecord;
  readonly process: ChildProcess | null;
}

interface DockerPortInfo {
  readonly name: string;
  readonly image: string;
  readonly framework: string;
}

const SNAPSHOT_POLL_INTERVAL_MS = 2_000;
const KILL_GRACE_MS = 1_000;

async function runShell(command: string) {
  const result = await runProcess("sh", ["-lc", command], {
    timeoutMs: 2_000,
    allowNonZeroExit: true,
    maxBufferBytes: 4 * 1024 * 1024,
    outputMode: "truncate",
  });
  return result.stdout;
}

export function parseDevServerProcesses(stdout: string): ProcessSnapshot[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pidRaw, parentPidRaw, _state, cpuRaw, memoryRaw, command, ...argsParts] =
        line.split(/\s+/u);
      return {
        pid: Number(pidRaw),
        parentPid: Number.isFinite(Number(parentPidRaw)) ? Number(parentPidRaw) : null,
        command: command ?? "unknown",
        args: argsParts.join(" "),
        cpuPercent: Number(cpuRaw ?? 0),
        memoryPercent: Number(memoryRaw ?? 0),
      };
    })
    .filter((process) => Number.isFinite(process.pid));
}

export function parseDevServerListeners(stdout: string): DevServerListener[] {
  const seen = new Set<string>();
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      if (line.startsWith("COMMAND")) return [];
      const parts = line.split(/\s+/u);
      const command = parts[0] ?? "";
      const pid = Number(parts[1]);
      const nameField = parts[8] ?? "";
      const portMatch = nameField.match(/^(.*):(\d+)$/u);
      if (!portMatch) return [];
      const port = Number(portMatch[2]);
      if (!Number.isFinite(port)) return [];
      const pidValue = Number.isFinite(pid) && pid > 0 ? pid : null;
      const dedupeKey = `${pidValue ?? "none"}:${port}`;
      if (seen.has(dedupeKey)) return [];
      seen.add(dedupeKey);
      return [
        {
          pid: pidValue,
          protocol: "tcp",
          address: (portMatch[1] ?? "*").replace(/^\[(.*)\]$/u, "$1") || "*",
          port,
          processName: command || null,
        },
      ];
    })
    .toSorted((left, right) => left.port - right.port);
}

function processText(processSnapshot: ProcessSnapshot) {
  return `${processSnapshot.command} ${processSnapshot.args}`.trim();
}

function parseCwdByPid(stdout: string) {
  const map = new Map<number, string>();
  for (const line of stdout.split(/\r?\n/u).slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/u);
    if (parts.length < 9) continue;
    const pid = Number(parts[1]);
    const cwd = parts.slice(8).join(" ");
    if (Number.isFinite(pid) && cwd.startsWith("/")) {
      map.set(pid, cwd);
    }
  }
  return map;
}

function detectFrameworkFromImage(image: string) {
  const normalized = image.toLowerCase();
  if (normalized.includes("postgres")) return "PostgreSQL";
  if (normalized.includes("redis")) return "Redis";
  if (normalized.includes("mysql") || normalized.includes("mariadb")) return "MySQL";
  if (normalized.includes("mongo")) return "MongoDB";
  if (normalized.includes("localstack")) return "LocalStack";
  if (normalized.includes("nginx")) return "nginx";
  return "Docker";
}

function parseDockerPortMap(stdout: string) {
  const map = new Map<number, DockerPortInfo>();
  for (const line of stdout.split(/\r?\n/u).map((value) => value.trim())) {
    if (!line) continue;
    const [portsRaw = "", name = "docker", image = "docker"] = line.split("\t");
    for (const match of portsRaw.matchAll(/:(\d+)->/gu)) {
      const port = Number(match[1]);
      if (Number.isFinite(port) && !map.has(port)) {
        map.set(port, { name, image, framework: detectFrameworkFromImage(image) });
      }
    }
  }
  return map;
}

function detectFrameworkFromCommand(command: string, processName: string) {
  const normalizedCommand = command.toLowerCase();
  const normalizedName = processName.toLowerCase();
  if (normalizedCommand.includes("next")) return "Next.js";
  if (normalizedCommand.includes("vite")) return "Vite";
  if (normalizedCommand.includes("nuxt")) return "Nuxt";
  if (normalizedCommand.includes("remix")) return "Remix";
  if (normalizedCommand.includes("astro")) return "Astro";
  if (normalizedCommand.includes("webpack")) return "Webpack";
  if (normalizedCommand.includes("uvicorn")) return "FastAPI";
  if (normalizedCommand.includes("django") || normalizedCommand.includes("manage.py")) {
    return "Django";
  }
  if (normalizedCommand.includes("rails")) return "Rails";
  if (normalizedCommand.includes("flask")) return "Flask";
  if (normalizedName === "node") return "Node.js";
  if (normalizedName === "python" || normalizedName === "python3") return "Python";
  if (normalizedName === "ruby") return "Ruby";
  if (normalizedName === "java") return "Java";
  if (normalizedName === "go") return "Go";
  return null;
}

function isLikelyDevProcess(processName: string, command: string) {
  const normalizedName = processName.toLowerCase();
  const normalizedCommand = command.toLowerCase();
  const devBinaryNames = new Set([
    "node",
    "python",
    "python3",
    "ruby",
    "java",
    "go",
    "cargo",
    "deno",
    "bun",
    "php",
    "uvicorn",
    "gunicorn",
    "flask",
    "rails",
    "npm",
    "npx",
    "yarn",
    "pnpm",
    "vite",
    "next",
    "webpack",
  ]);
  if (devBinaryNames.has(normalizedName)) return true;
  if (/docker|com\.docke/iu.test(normalizedName)) return true;
  return [
    /\bnode\b/u,
    /\bnext[\s-]/u,
    /\bvite\b/u,
    /\bnuxt\b/u,
    /\bwebpack\b/u,
    /\bremix\b/u,
    /\bastro\b/u,
    /\bflask\b/u,
    /\bdjango\b|manage\.py/u,
    /\buvicorn\b/u,
    /\brails\b/u,
    /\bcargo\b/u,
  ].some((pattern) => pattern.test(normalizedCommand));
}

function childPidSet(rootPid: number, processes: readonly ProcessSnapshot[]) {
  const childrenByParent = new Map<number, ProcessSnapshot[]>();
  for (const processSnapshot of processes) {
    if (processSnapshot.parentPid === null) continue;
    const children = childrenByParent.get(processSnapshot.parentPid) ?? [];
    children.push(processSnapshot);
    childrenByParent.set(processSnapshot.parentPid, children);
  }

  const pids = new Set<number>([rootPid]);
  const stack = [rootPid];
  while (stack.length > 0) {
    const parentPid = stack.pop();
    if (parentPid === undefined) continue;
    for (const child of childrenByParent.get(parentPid) ?? []) {
      if (pids.has(child.pid)) continue;
      pids.add(child.pid);
      stack.push(child.pid);
    }
  }
  return pids;
}

function collectExternalDevServers(input: {
  readonly processes: readonly ProcessSnapshot[];
  readonly listeners: readonly DevServerListener[];
  readonly cwdByPid: ReadonlyMap<number, string>;
  readonly dockerByPort: ReadonlyMap<number, DockerPortInfo>;
  readonly managedPorts: ReadonlySet<number>;
  readonly managedPids: ReadonlySet<number>;
  readonly fallbackWorkspacePath: string;
}) {
  const processByPid = new Map(
    input.processes.map((processSnapshot) => [processSnapshot.pid, processSnapshot]),
  );
  const seen = new Set<string>();
  const externalDevServers: ExternalDevServer[] = [];

  for (const listener of input.listeners) {
    if (input.managedPorts.has(listener.port)) continue;
    if (listener.pid !== null && input.managedPids.has(listener.pid)) continue;
    const docker = input.dockerByPort.get(listener.port);
    const processSnapshot = listener.pid === null ? undefined : processByPid.get(listener.pid);
    const processName = listener.processName ?? processSnapshot?.command ?? "unknown";
    const command = processSnapshot ? processText(processSnapshot) : processName;
    if (!docker && !isLikelyDevProcess(processName, command)) continue;

    const id = `external-${listener.pid ?? "none"}-${listener.port}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const cwd = listener.pid === null ? null : (input.cwdByPid.get(listener.pid) ?? null);
    const framework = docker?.framework ?? detectFrameworkFromCommand(command, processName);
    const labelBase = docker?.name ?? (cwd ? Path.basename(cwd) : processName);
    externalDevServers.push({
      id,
      pid: listener.pid,
      label: framework ? `${labelBase} (${framework})` : labelBase,
      command: docker ? `${docker.framework} container · ${docker.image}` : command,
      port: listener.port,
      workspacePath: cwd ?? input.fallbackWorkspacePath,
      status: "running",
    });
  }

  return externalDevServers.toSorted((left, right) => (left.port ?? 0) - (right.port ?? 0));
}

function signalProcessTree(pid: number, signal: NodeJS.Signals) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    process.kill(pid, signal);
  }
}

function isProcessAlive(pid: number | null) {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function scriptRole(script: ProjectScript) {
  return script.role ?? "task";
}

function readPersistedRecords(path: string): ManagedDevServerRecord[] {
  try {
    const raw = FS.readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) =>
      typeof entry === "object" && entry !== null ? [entry as ManagedDevServerRecord] : [],
    );
  } catch {
    return [];
  }
}

function writePersistedRecords(path: string, records: readonly ManagedDevServerRecord[]) {
  FS.mkdirSync(Path.dirname(path), { recursive: true });
  FS.writeFileSync(path, JSON.stringify(records, null, 2));
}

const toDevServerError = (message: string, cause?: unknown, id?: string) =>
  new DevServerError({
    message,
    ...(id ? { id } : {}),
    ...(cause !== undefined ? { cause } : {}),
  });

const makeDevServerManager = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const storePath = Path.join(config.stateDir, "dev-servers.json");
  const managed = new Map<string, ManagedRuntime>();
  for (const record of readPersistedRecords(storePath)) {
    managed.set(record.id, {
      record: {
        ...record,
        status: isProcessAlive(record.rootPid) ? "running" : "unknown",
        updatedAt: new Date().toISOString(),
      },
      process: null,
    });
  }

  const persist = () =>
    writePersistedRecords(
      storePath,
      Array.from(managed.values()).map((runtime) => runtime.record),
    );

  const inventory = async () => {
    const [psStdout, listenerStdout] = await Promise.all([
      runShell("ps -axo pid=,ppid=,state=,pcpu=,pmem=,comm=,args="),
      runShell("lsof -nP -iTCP -sTCP:LISTEN || true"),
    ]);
    const processes = parseDevServerProcesses(psStdout);
    const listeners = parseDevServerListeners(listenerStdout);
    const listenerPids = [
      ...new Set(
        listeners.map((listener) => listener.pid).filter((pid): pid is number => pid !== null),
      ),
    ];
    const [cwdStdout, dockerStdout] = await Promise.all([
      listenerPids.length > 0
        ? runShell(`lsof -a -d cwd -p ${listenerPids.join(",")} 2>/dev/null || true`)
        : Promise.resolve(""),
      runShell("docker ps --format '{{.Ports}}\\t{{.Names}}\\t{{.Image}}' 2>/dev/null || true"),
    ]);
    return {
      processes,
      listeners,
      cwdByPid: parseCwdByPid(cwdStdout),
      dockerByPort: parseDockerPortMap(dockerStdout),
    };
  };

  const getSnapshot: DevServerManagerShape["getSnapshot"] = () =>
    Effect.tryPromise({
      try: async () => {
        if (process.platform === "win32") {
          return {
            recordedAt: new Date().toISOString(),
            supported: false,
            unsupportedReason: "Dev server inventory is not supported on Windows yet.",
            listeners: [],
            externalDevServers: [],
            managedDevServers: Array.from(managed.values()).map((runtime) => runtime.record),
          } satisfies DevServerSnapshot;
        }

        const nextInventory = await inventory();
        const managedPorts = new Set<number>();
        const managedPids = new Set<number>();
        const managedDevServers: ManagedDevServerRecord[] = [];
        for (const runtime of managed.values()) {
          const rootPid = runtime.record.rootPid;
          const descendantPids =
            rootPid === null ? new Set<number>() : childPidSet(rootPid, nextInventory.processes);
          for (const pid of descendantPids) {
            managedPids.add(pid);
          }
          const listener =
            nextInventory.listeners.find(
              (entry) => entry.pid !== null && descendantPids.has(entry.pid),
            ) ?? null;
          if (listener?.port !== undefined) {
            managedPorts.add(listener.port);
          }
          const alive = rootPid !== null && isProcessAlive(rootPid);
          const status =
            runtime.record.status === "exited" || runtime.record.status === "stopped"
              ? runtime.record.status
              : alive
                ? "running"
                : "unknown";
          const record = {
            ...runtime.record,
            pid: listener?.pid ?? runtime.record.pid,
            port: listener?.port ?? runtime.record.port,
            status,
            updatedAt: new Date().toISOString(),
          } satisfies ManagedDevServerRecord;
          runtime.record = record;
          managedDevServers.push(record);
        }

        if (managedDevServers.length > 0) {
          persist();
        }

        return {
          recordedAt: new Date().toISOString(),
          supported: true,
          listeners: nextInventory.listeners,
          managedDevServers,
          externalDevServers: collectExternalDevServers({
            ...nextInventory,
            managedPorts,
            managedPids,
            fallbackWorkspacePath: config.cwd,
          }),
        } satisfies DevServerSnapshot;
      },
      catch: (cause) => toDevServerError("Failed to collect dev server snapshot.", cause),
    });

  const persistEffect = (message: string, id?: string) =>
    Effect.try({
      try: persist,
      catch: (cause) => toDevServerError(message, cause, id),
    });

  const start: DevServerManagerShape["start"] = (input: DevServerStartInput) =>
    Effect.gen(function* () {
      const orchestrationEngine = yield* OrchestrationEngineService;
      const readModel = yield* orchestrationEngine.getReadModel();
      const project = readModel.projects.find((entry) => entry.id === input.projectId);
      if (!project) {
        return yield* toDevServerError("Project was not found.", undefined, input.projectId);
      }
      const script = project.scripts.find((entry) => entry.id === input.scriptId);
      if (!script) {
        return yield* toDevServerError("Project script was not found.", undefined, input.scriptId);
      }
      if (scriptRole(script) !== "dev-server") {
        return yield* toDevServerError(
          "Project script is not marked as a dev server.",
          undefined,
          script.id,
        );
      }
      const existing = Array.from(managed.values()).find(
        (runtime) =>
          runtime.record.projectId === project.id &&
          runtime.record.scriptId === script.id &&
          runtime.record.status !== "stopped" &&
          runtime.record.status !== "exited" &&
          runtime.record.status !== "error",
      );
      if (existing) {
        return existing.record;
      }

      const cwd = input.cwd ?? input.worktreePath ?? project.workspaceRoot;
      const worktreePath = input.worktreePath ?? null;
      const now = new Date().toISOString();
      const child = yield* Effect.try({
        try: () => {
          const nextChild = spawn(script.command, {
            cwd,
            detached: process.platform !== "win32",
            env: {
              ...process.env,
              ...projectScriptRuntimeEnv({
                project: { cwd: project.workspaceRoot },
                worktreePath,
                ...(input.env ? { extraEnv: input.env } : {}),
              }),
            },
            shell: true,
            stdio: "ignore",
          });
          nextChild.unref();
          return nextChild;
        },
        catch: (cause) => toDevServerError("Failed to start dev server.", cause),
      });

      const id = `dev-server-${crypto.randomUUID()}`;
      const record: ManagedDevServerRecord = {
        id,
        projectId: project.id,
        projectTitle: project.title,
        scriptId: script.id,
        scriptName: script.name,
        command: script.command,
        cwd,
        worktreePath,
        pid: child.pid ?? null,
        rootPid: child.pid ?? null,
        port: null,
        status: "starting",
        startedAt: now,
        updatedAt: now,
        exitCode: null,
        exitSignal: null,
      };
      managed.set(id, { record, process: child });
      yield* persistEffect("Failed to persist managed dev server.", id);

      child.once("error", () => {
        const runtime = managed.get(id);
        if (!runtime) return;
        runtime.record = {
          ...runtime.record,
          status: "error",
          updatedAt: new Date().toISOString(),
        };
        try {
          persist();
        } catch {
          // Best effort after async process events; the live snapshot still reflects memory.
        }
      });

      child.once("exit", (exitCode, exitSignal) => {
        const runtime = managed.get(id);
        if (!runtime) return;
        runtime.record = {
          ...runtime.record,
          status: runtime.record.status === "stopped" ? "stopped" : "exited",
          exitCode: exitCode === null || exitCode < 0 ? null : exitCode,
          exitSignal: exitSignal ?? null,
          updatedAt: new Date().toISOString(),
        };
        try {
          persist();
        } catch {
          // Best effort after async process events; the live snapshot still reflects memory.
        }
      });

      return record;
    });

  const stop: DevServerManagerShape["stop"] = (input) =>
    Effect.gen(function* () {
      const runtime = managed.get(input.id);
      if (!runtime) {
        return yield* toDevServerError("Unknown managed dev server.", undefined, input.id);
      }
      const pid = runtime.record.rootPid;
      if (pid !== null && isProcessAlive(pid)) {
        yield* Effect.try({
          try: () => signalProcessTree(pid, "SIGTERM"),
          catch: (cause) => toDevServerError("Failed to stop dev server.", cause, input.id),
        });
        yield* Effect.sleep(KILL_GRACE_MS);
        if (isProcessAlive(pid)) {
          yield* Effect.try({
            try: () => signalProcessTree(pid, "SIGKILL"),
            catch: (cause) => toDevServerError("Failed to kill dev server.", cause, input.id),
          });
        }
      }
      runtime.record = {
        ...runtime.record,
        status: "stopped",
        updatedAt: new Date().toISOString(),
      };
      yield* persistEffect("Failed to persist stopped dev server.", input.id);
      return runtime.record;
    });

  return {
    getSnapshot,
    start,
    stop,
    stream: Stream.fromEffectSchedule(
      getSnapshot(),
      Schedule.spaced(`${SNAPSHOT_POLL_INTERVAL_MS} millis`),
    ).pipe(
      Stream.map((snapshot) => ({
        version: 1 as const,
        type: "snapshot" as const,
        snapshot,
      })),
    ),
  } satisfies DevServerManagerShape;
});

export const DevServerManagerLive = Layer.effect(DevServerManager, makeDevServerManager);
