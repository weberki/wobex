import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { RelayRemoteSessionClaim } from "@wobex/contracts";
import type { ServerConfigShape } from "../../config";
import { ServerConfig } from "../../config";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { saveRelayHostConnection } from "../../relayHostConfig";
import { signRelayRemoteSessionClaim } from "../relayRemoteSession";
import { ServerAuth } from "../Services/ServerAuth";
import { ServerAuthLive } from "./ServerAuth";
import { ServerSecretStoreLive } from "./ServerSecretStore";

const makeServerConfigLayer = (overrides?: Partial<ServerConfigShape>) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      return {
        ...config,
        ...overrides,
      } satisfies ServerConfigShape;
    }),
  ).pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "wobex-auth-relay-test-" })),
  );

const makeServerAuthLayer = (overrides?: Partial<ServerConfigShape>) => {
  const configLayer = makeServerConfigLayer(overrides);
  return Layer.mergeAll(
    ServerAuthLive.pipe(
      Layer.provide(SqlitePersistenceMemory),
      Layer.provide(ServerSecretStoreLive),
      Layer.provide(configLayer),
    ),
    configLayer,
  );
};

it.layer(NodeServices.layer)("ServerAuthLive relay bootstrap", (it) => {
  it.effect("issues a bearer client session from a relay-signed claim", () =>
    Effect.gen(function* () {
      const serverAuth = yield* ServerAuth;
      const serverConfig = yield* ServerConfig;

      yield* Effect.tryPromise(() =>
        saveRelayHostConnection({
          secretsDir: serverConfig.secretsDir,
          relayUrl: "https://relay.example.com",
          hostId: "host-1",
          registrationToken: "relay-registration-token",
          trustedRelaySigningKeyId: "relay-key-1",
          trustedRelaySigningKey: "relay-signing-secret",
        }),
      );

      const bootstrap = yield* serverAuth.exchangeRelayRemoteSessionClaim(
        signRelayRemoteSessionClaim({
          keyId: "relay-key-1",
          secret: "relay-signing-secret",
          claim: {
            version: 1,
            hostId: "host-1" as RelayRemoteSessionClaim["hostId"],
            userId: "user-1" as RelayRemoteSessionClaim["userId"],
            deviceId: "device-1" as RelayRemoteSessionClaim["deviceId"],
            grantId: "grant-1" as RelayRemoteSessionClaim["grantId"],
            subject: "relay:user-1:device-1",
            role: "client",
            capabilities: ["chat:read", "chat:write"],
            issuedAt: new Date(Date.now() - 1_000).toISOString(),
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          },
        }),
        {
          deviceType: "mobile",
          userAgent: "Mozilla/5.0 (iPhone)",
        },
      );

      expect(bootstrap.authenticated).toBe(true);
      expect(bootstrap.session.subject).toBe("relay:user-1:device-1");
      expect(bootstrap.session.role).toBe("client");
      expect(bootstrap.session.sessionId).toSatisfy((value: string) => value.length > 0);
      expect(bootstrap.sessionToken.length).toBeGreaterThan(0);
    }).pipe(
      Effect.provide(
        makeServerAuthLayer({
          desktopBootstrapToken: "desktop-bootstrap-token",
        }),
      ),
    ),
  );
});
