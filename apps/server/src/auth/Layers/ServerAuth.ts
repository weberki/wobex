import {
  type AuthBearerBootstrapResult,
  type AuthClientSession,
  type AuthBootstrapResult,
  type AuthPairingCredentialResult,
  type RelayRemoteSessionBootstrapResult,
  type AuthSessionState,
  type AuthWebSocketTokenResult,
} from "@wobex/contracts";
import { DateTime, Effect, Layer, Option } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { ServerConfig } from "../../config.ts";
import { readRelayHostConnection } from "../../relayHostConfig.ts";
import { AuthControlPlane } from "../Services/AuthControlPlane.ts";
import { ServerAuthPolicyLive } from "./ServerAuthPolicy.ts";
import { BootstrapCredentialService } from "../Services/BootstrapCredentialService.ts";
import { BootstrapCredentialError } from "../Services/BootstrapCredentialService.ts";
import {
  hasDisallowedRelayCapabilities,
  verifyRelayRemoteSessionSignature,
} from "../relayRemoteSession.ts";
import { ServerAuthPolicy } from "../Services/ServerAuthPolicy.ts";
import {
  ServerAuth,
  type AuthenticatedSession,
  AuthError,
  type ServerAuthShape,
} from "../Services/ServerAuth.ts";
import { SessionCredentialService } from "../Services/SessionCredentialService.ts";
import { AuthControlPlaneLive, AuthCoreLive } from "./AuthControlPlane.ts";

type BootstrapExchangeResult = {
  readonly response: AuthBootstrapResult;
  readonly sessionToken: string;
};

const AUTHORIZATION_PREFIX = "Bearer ";
const WEBSOCKET_TOKEN_QUERY_PARAM = "wsToken";

export function toBootstrapExchangeAuthError(cause: BootstrapCredentialError): AuthError {
  if (cause.status === 500) {
    return new AuthError({
      message: "Failed to validate bootstrap credential.",
      status: 500,
      cause,
    });
  }

  return new AuthError({
    message: "Invalid bootstrap credential.",
    status: 401,
    cause,
  });
}

function parseBearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith(AUTHORIZATION_PREFIX)) {
    return null;
  }
  const token = header.slice(AUTHORIZATION_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export const makeServerAuth = Effect.gen(function* () {
  const policy = yield* ServerAuthPolicy;
  const bootstrapCredentials = yield* BootstrapCredentialService;
  const authControlPlane = yield* AuthControlPlane;
  const sessions = yield* SessionCredentialService;
  const serverConfig = yield* ServerConfig;
  const descriptor = yield* policy.getDescriptor();

  const authenticateToken = (token: string): Effect.Effect<AuthenticatedSession, AuthError> =>
    sessions.verify(token).pipe(
      Effect.map((session) => ({
        sessionId: session.sessionId,
        subject: session.subject,
        method: session.method,
        role: session.role,
        capabilities: session.capabilities,
        ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
      })),
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Unauthorized request.",
            status: 401,
            cause,
          }),
      ),
    );

  const authenticateRequest = (request: HttpServerRequest.HttpServerRequest) => {
    const cookieToken = request.cookies[sessions.cookieName];
    const bearerToken = parseBearerToken(request);
    const credential = cookieToken ?? bearerToken;
    if (!credential) {
      return Effect.fail(
        new AuthError({
          message: "Authentication required.",
          status: 401,
        }),
      );
    }
    return authenticateToken(credential);
  };

  const getSessionState: ServerAuthShape["getSessionState"] = (request) =>
    authenticateRequest(request).pipe(
      Effect.map(
        (session) =>
          ({
            authenticated: true,
            auth: descriptor,
            role: session.role,
            sessionMethod: session.method,
            capabilities: [...session.capabilities],
            ...(session.expiresAt ? { expiresAt: DateTime.toUtc(session.expiresAt) } : {}),
          }) satisfies AuthSessionState,
      ),
      Effect.catchTag("AuthError", () =>
        Effect.succeed({
          authenticated: false,
          auth: descriptor,
        } satisfies AuthSessionState),
      ),
    );

  const exchangeBootstrapCredential: ServerAuthShape["exchangeBootstrapCredential"] = (
    credential,
    requestMetadata,
  ) =>
    bootstrapCredentials.consume(credential).pipe(
      Effect.mapError(toBootstrapExchangeAuthError),
      Effect.flatMap((grant) =>
        sessions
          .issue({
            method: "browser-session-cookie",
            subject: grant.subject,
            role: grant.role,
            client: {
              ...requestMetadata,
              ...(grant.label ? { label: grant.label } : {}),
            },
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({
                  message: "Failed to issue authenticated session.",
                  cause,
                }),
            ),
          ),
      ),
      Effect.map(
        (session) =>
          ({
            response: {
              authenticated: true,
              role: session.role,
              capabilities: [...session.capabilities],
              sessionMethod: session.method,
              expiresAt: DateTime.toUtc(session.expiresAt),
            } satisfies AuthBootstrapResult,
            sessionToken: session.token,
          }) satisfies BootstrapExchangeResult,
      ),
    );

  const exchangeBootstrapCredentialForBearerSession: ServerAuthShape["exchangeBootstrapCredentialForBearerSession"] =
    (credential, requestMetadata) =>
      bootstrapCredentials.consume(credential).pipe(
        Effect.mapError(toBootstrapExchangeAuthError),
        Effect.flatMap((grant) =>
          sessions
            .issue({
              method: "bearer-session-token",
              subject: grant.subject,
              role: grant.role,
              client: {
                ...requestMetadata,
                ...(grant.label ? { label: grant.label } : {}),
              },
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new AuthError({
                    message: "Failed to issue authenticated session.",
                    cause,
                  }),
              ),
            ),
        ),
        Effect.map(
          (session) =>
            ({
              authenticated: true,
              role: session.role,
              sessionMethod: "bearer-session-token",
              capabilities: [...session.capabilities],
              expiresAt: DateTime.toUtc(session.expiresAt),
              sessionToken: session.token,
            }) satisfies AuthBearerBootstrapResult,
        ),
      );

  const exchangeRelayRemoteSessionClaim: ServerAuthShape["exchangeRelayRemoteSessionClaim"] = (
    signedClaim,
    requestMetadata,
  ) =>
    Effect.gen(function* () {
      const relayConnection = yield* Effect.tryPromise({
        try: () => readRelayHostConnection(serverConfig.secretsDir),
        catch: (cause) =>
          new AuthError({
            message: "Failed to load relay trust configuration.",
            status: 500,
            cause,
          }),
      });

      if (!relayConnection?.trustedRelaySigningKeyId || !relayConnection.trustedRelaySigningKey) {
        return yield* new AuthError({
          message: "Relay bootstrap is not configured on this host.",
          status: 403,
        });
      }

      if (signedClaim.claim.hostId !== relayConnection.hostId) {
        return yield* new AuthError({
          message: "Relay claim is for a different host.",
          status: 403,
        });
      }

      if (
        !verifyRelayRemoteSessionSignature({
          signedClaim,
          expectedKeyId: relayConnection.trustedRelaySigningKeyId,
          secret: relayConnection.trustedRelaySigningKey,
        })
      ) {
        return yield* new AuthError({
          message: "Relay claim signature is invalid.",
          status: 401,
        });
      }

      if (signedClaim.claim.role !== "client") {
        return yield* new AuthError({
          message: "Relay can only open client sessions.",
          status: 403,
        });
      }

      if (hasDisallowedRelayCapabilities(signedClaim.claim.capabilities)) {
        return yield* new AuthError({
          message: "Relay claim requested an admin capability.",
          status: 403,
        });
      }

      const now = Date.now();
      const issuedAt = Date.parse(signedClaim.claim.issuedAt);
      const expiresAt = Date.parse(signedClaim.claim.expiresAt);
      if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000) {
        return yield* new AuthError({
          message: "Relay claim issuedAt is invalid.",
          status: 401,
        });
      }
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        return yield* new AuthError({
          message: "Relay claim is expired.",
          status: 401,
        });
      }

      const session = yield* sessions
        .issue({
          method: "bearer-session-token",
          subject: signedClaim.claim.subject,
          role: "client",
          capabilities: signedClaim.claim.capabilities,
          client: {
            ...requestMetadata,
            label: `Relay ${signedClaim.claim.deviceId}`,
            deviceType:
              requestMetadata.deviceType === "unknown" ? "mobile" : requestMetadata.deviceType,
          },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new AuthError({
                message: "Failed to issue relay-backed client session.",
                cause,
              }),
          ),
        );

      return {
        authenticated: true,
        sessionToken: session.token,
        session: {
          sessionId: session.sessionId,
          subject: signedClaim.claim.subject,
          hostId: signedClaim.claim.hostId,
          userId: signedClaim.claim.userId,
          deviceId: signedClaim.claim.deviceId,
          grantId: signedClaim.claim.grantId,
          role: "client",
          capabilities: [...signedClaim.claim.capabilities],
          issuedAt: signedClaim.claim.issuedAt,
          expiresAt: signedClaim.claim.expiresAt,
        },
      } satisfies RelayRemoteSessionBootstrapResult;
    });

  const issuePairingCredential: ServerAuthShape["issuePairingCredential"] = (input) =>
    authControlPlane
      .createPairingLink({
        role: input?.role ?? "client",
        subject:
          input?.subject ?? (input?.role === "owner" ? "owner-pairing-token" : "one-time-token"),
        ...(input?.label ? { label: input.label } : {}),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Failed to issue pairing credential.",
              cause,
            }),
        ),
        Effect.map(
          (issued) =>
            ({
              id: issued.id,
              credential: issued.credential,
              role: issued.role,
              ...(issued.label ? { label: issued.label } : {}),
              expiresAt: issued.expiresAt,
            }) satisfies AuthPairingCredentialResult,
        ),
      );

  const listPairingLinks: ServerAuthShape["listPairingLinks"] = () =>
    authControlPlane
      .listPairingLinks({
        excludeSubjects: ["owner-bootstrap"],
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Failed to load pairing links.",
              cause,
            }),
        ),
      );

  const revokePairingLink: ServerAuthShape["revokePairingLink"] = (id) =>
    authControlPlane.revokePairingLink(id).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Failed to revoke pairing link.",
            cause,
          }),
      ),
    );

  const listClientSessions: ServerAuthShape["listClientSessions"] = (currentSessionId) =>
    authControlPlane.listSessions().pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Failed to load paired clients.",
            cause,
          }),
      ),
      Effect.map((clientSessions) =>
        clientSessions.map(
          (clientSession): AuthClientSession => ({
            ...clientSession,
            current: clientSession.sessionId === currentSessionId,
          }),
        ),
      ),
    );

  const revokeClientSession: ServerAuthShape["revokeClientSession"] = (
    currentSessionId,
    targetSessionId,
  ) =>
    Effect.gen(function* () {
      if (currentSessionId === targetSessionId) {
        return yield* new AuthError({
          message: "Use revoke other clients to keep the current owner session active.",
          status: 403,
        });
      }
      return yield* authControlPlane.revokeSession(targetSessionId).pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Failed to revoke client session.",
              cause,
            }),
        ),
      );
    });

  const revokeOtherClientSessions: ServerAuthShape["revokeOtherClientSessions"] = (
    currentSessionId,
  ) =>
    authControlPlane.revokeOtherSessionsExcept(currentSessionId).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Failed to revoke other client sessions.",
            cause,
          }),
      ),
    );

  const issueStartupPairingUrl: ServerAuthShape["issueStartupPairingUrl"] = (baseUrl) =>
    issuePairingCredential({ role: "owner", subject: "owner-bootstrap" }).pipe(
      Effect.map((issued) => {
        const url = new URL(baseUrl);
        url.pathname = "/pair";
        url.searchParams.delete("token");
        url.hash = new URLSearchParams([["token", issued.credential]]).toString();
        return url.toString();
      }),
    );

  const issueWebSocketToken: ServerAuthShape["issueWebSocketToken"] = (session) =>
    sessions.issueWebSocketToken(session.sessionId).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Failed to issue websocket token.",
            cause,
          }),
      ),
      Effect.map(
        (issued) =>
          ({
            token: issued.token,
            expiresAt: DateTime.toUtc(issued.expiresAt),
          }) satisfies AuthWebSocketTokenResult,
      ),
    );

  const authenticateWebSocketUpgrade: ServerAuthShape["authenticateWebSocketUpgrade"] = (request) =>
    Effect.gen(function* () {
      const requestUrl = HttpServerRequest.toURL(request);
      if (Option.isSome(requestUrl)) {
        const websocketToken = requestUrl.value.searchParams.get(WEBSOCKET_TOKEN_QUERY_PARAM);
        if (websocketToken && websocketToken.trim().length > 0) {
          return yield* sessions.verifyWebSocketToken(websocketToken).pipe(
            Effect.map((session) => ({
              sessionId: session.sessionId,
              subject: session.subject,
              method: session.method,
              role: session.role,
              capabilities: session.capabilities,
              ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
            })),
            Effect.mapError(
              (cause) =>
                new AuthError({
                  message: "Unauthorized request.",
                  status: 401,
                  cause,
                }),
            ),
          );
        }
      }

      return yield* authenticateRequest(request);
    });

  return {
    getDescriptor: () => Effect.succeed(descriptor),
    getSessionState,
    exchangeBootstrapCredential,
    exchangeBootstrapCredentialForBearerSession,
    exchangeRelayRemoteSessionClaim,
    issuePairingCredential,
    listPairingLinks,
    revokePairingLink,
    listClientSessions,
    revokeClientSession,
    revokeOtherClientSessions,
    authenticateHttpRequest: authenticateRequest,
    authenticateWebSocketUpgrade,
    issueWebSocketToken,
    issueStartupPairingUrl,
  } satisfies ServerAuthShape;
});

export const ServerAuthLive = Layer.effect(ServerAuth, makeServerAuth).pipe(
  Layer.provideMerge(AuthControlPlaneLive),
  Layer.provideMerge(AuthCoreLive),
  Layer.provideMerge(ServerAuthPolicyLive),
);
