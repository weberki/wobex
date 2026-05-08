import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { WS_METHODS } from "./rpc";
import {
  DevServerSnapshot,
  DevServerStartInput,
  DevServerStopInput,
  DevServerStreamEvent,
  ServerRefreshProviderUsageInput,
  ServerRefreshProviderUsageResult,
} from "./server";

const decodeDevServerSnapshot = Schema.decodeUnknownSync(DevServerSnapshot);
const decodeDevServerStartInput = Schema.decodeUnknownSync(DevServerStartInput);
const decodeDevServerStopInput = Schema.decodeUnknownSync(DevServerStopInput);
const decodeDevServerStreamEvent = Schema.decodeUnknownSync(DevServerStreamEvent);
const decodeServerRefreshProviderUsageInput = Schema.decodeUnknownSync(
  ServerRefreshProviderUsageInput,
);
const decodeServerRefreshProviderUsageResult = Schema.decodeUnknownSync(
  ServerRefreshProviderUsageResult,
);

describe("dev server contracts", () => {
  it("decodes dev server snapshots with managed and external rows", () => {
    const snapshot = decodeDevServerSnapshot({
      recordedAt: "2026-01-01T00:00:00.000Z",
      supported: true,
      listeners: [
        {
          pid: 123,
          protocol: "tcp",
          address: "*",
          port: 5173,
          processName: "node",
        },
      ],
      externalDevServers: [
        {
          id: "external-123-5173",
          pid: 123,
          label: "vite",
          command: "node vite",
          port: 5173,
          workspacePath: "/repo",
          status: "running",
        },
      ],
      managedDevServers: [
        {
          id: "dev-server-1",
          projectId: "project-1",
          projectTitle: "Project",
          scriptId: "dev",
          scriptName: "Dev",
          command: "bun dev",
          cwd: "/repo",
          worktreePath: null,
          pid: 234,
          port: 3000,
          status: "running",
          startedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          exitCode: null,
          exitSignal: null,
        },
      ],
    });

    expect(snapshot.listeners[0]?.port).toBe(5173);
    expect(snapshot.externalDevServers[0]?.status).toBe("running");
    expect(snapshot.managedDevServers[0]?.scriptId).toBe("dev");
  });

  it("decodes dev server RPC inputs and stream events", () => {
    const start = decodeDevServerStartInput({
      projectId: "project-1",
      scriptId: "dev",
      cwd: "/repo",
      env: {
        PORT: "5173",
      },
    });
    const stop = decodeDevServerStopInput({ id: "dev-server-1" });
    const event = decodeDevServerStreamEvent({
      version: 1,
      type: "snapshot",
      snapshot: {
        recordedAt: "2026-01-01T00:00:00.000Z",
        supported: false,
        unsupportedReason: "unsupported",
        listeners: [],
        externalDevServers: [],
        managedDevServers: [],
      },
    });

    expect(start.env?.PORT).toBe("5173");
    expect(stop.id).toBe("dev-server-1");
    expect(event.type).toBe("snapshot");
    expect(WS_METHODS.devServersGetSnapshot).toBe("devServers.getSnapshot");
    expect(WS_METHODS.devServersStart).toBe("devServers.start");
    expect(WS_METHODS.devServersStop).toBe("devServers.stop");
    expect(WS_METHODS.subscribeDevServers).toBe("subscribeDevServers");
  });

  it("decodes provider usage refresh contracts", () => {
    const input = decodeServerRefreshProviderUsageInput({
      provider: "claudeAgent",
      cwd: "/repo",
      force: true,
    });
    const result = decodeServerRefreshProviderUsageResult({
      provider: "claudeAgent",
      refreshedAt: "2026-04-17T20:00:00.000Z",
      cached: false,
      available: true,
      rateLimits: {
        windows: [
          {
            label: "Claude 5h",
            usedPercent: 30,
            remainingPercent: 70,
            resetsAt: null,
            resetLabel: "10pm (Europe/Berlin)",
            source: "tmux",
          },
        ],
      },
    });

    expect(input.provider).toBe("claudeAgent");
    expect(result.rateLimits.windows[0]?.remainingPercent).toBe(70);
    expect(WS_METHODS.serverRefreshProviderUsage).toBe("server.refreshProviderUsage");
  });
});
