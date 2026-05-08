import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";

import {
  makeRelayServiceConfig,
  type RelayServiceConfig,
  type RelayServiceConfigInput,
} from "./config";
import { sendJson } from "./http";
import { createRelayPasskeyProvider, type RelayPasskeyProvider } from "./passkeys";
import type { RelayEmailSender } from "./email";
import { createRelayRepository, type RelayRepository } from "./repository";
import { RelayRuntime } from "./runtime";
import type { Clock } from "./time";

export interface RelayServerOptions {
  config?: RelayServiceConfigInput;
  repository?: RelayRepository;
  clock?: Clock;
  passkeyProvider?: RelayPasskeyProvider;
  emailSender?: RelayEmailSender | null;
}

export interface RelayServerHandle {
  readonly server: Server;
  readonly config: RelayServiceConfig;
  readonly repository: RelayRepository;
  readonly runtime: RelayRuntime;
  listen(port?: number, host?: string): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

export function createRelayServer(options: RelayServerOptions = {}): RelayServerHandle {
  const config = makeRelayServiceConfig(options.config);
  const repository = options.repository ?? createRelayRepository(config.databaseUrl, options.clock);
  const runtime = new RelayRuntime({
    config,
    repository,
    passkeyProvider: options.passkeyProvider ?? createRelayPasskeyProvider(),
    ...(options.emailSender !== undefined ? { emailSender: options.emailSender } : {}),
  });

  const server = createServer((request, response) => {
    void runtime.handleHttpRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Relay internal error",
        });
        return;
      }
      response.destroy(error instanceof Error ? error : new Error("Relay internal error"));
    });
  });

  server.on("upgrade", (request, socket, head) => {
    void runtime.handleUpgrade(request, socket as Socket, head).catch(() => {
      socket.destroy();
    });
  });

  return {
    server,
    config: runtime.config,
    repository,
    runtime,
    async listen(port = runtime.config.port, host = runtime.config.host) {
      await repository.initialize();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (address && typeof address !== "string") {
        return { host: address.address, port: address.port };
      }
      return { host, port };
    },
    async close() {
      runtime.close();
      await repository.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
