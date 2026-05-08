import type {
  AuthClientMetadata,
  AuthClientSession,
  AuthSessionCapability,
  AuthSessionCapabilities,
  AuthSessionId,
  ServerAuthSessionMethod,
} from "@wobex/contracts";
import { Data, DateTime, Duration, Context } from "effect";
import type { Effect, Stream } from "effect";

export type SessionRole = "owner" | "client";

export const OWNER_SESSION_CAPABILITIES: AuthSessionCapabilities = [
  "chat:read",
  "chat:write",
  "approvals:respond",
  "files:read",
  "files:write",
  "terminal:read",
  "terminal:write",
  "git:read",
  "git:write",
  "settings:admin",
  "auth:admin",
];

export const AGENT_CONTROL_SESSION_CAPABILITIES: AuthSessionCapabilities = [
  "chat:read",
  "chat:write",
  "approvals:respond",
  "files:read",
  "terminal:read",
  "git:read",
];

export function defaultCapabilitiesForRole(role: SessionRole): AuthSessionCapabilities {
  return role === "owner" ? OWNER_SESSION_CAPABILITIES : AGENT_CONTROL_SESSION_CAPABILITIES;
}

export interface IssuedSession {
  readonly sessionId: AuthSessionId;
  readonly token: string;
  readonly method: ServerAuthSessionMethod;
  readonly client: AuthClientMetadata;
  readonly expiresAt: DateTime.DateTime;
  readonly role: SessionRole;
  readonly capabilities: ReadonlyArray<AuthSessionCapability>;
}

export interface VerifiedSession {
  readonly sessionId: AuthSessionId;
  readonly token: string;
  readonly method: ServerAuthSessionMethod;
  readonly client: AuthClientMetadata;
  readonly expiresAt?: DateTime.DateTime;
  readonly subject: string;
  readonly role: SessionRole;
  readonly capabilities: ReadonlyArray<AuthSessionCapability>;
}

export type SessionCredentialChange =
  | {
      readonly type: "clientUpserted";
      readonly clientSession: AuthClientSession;
    }
  | {
      readonly type: "clientRemoved";
      readonly sessionId: AuthSessionId;
    };

export class SessionCredentialError extends Data.TaggedError("SessionCredentialError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SessionCredentialServiceShape {
  readonly cookieName: string;
  readonly issue: (input?: {
    readonly ttl?: Duration.Duration;
    readonly subject?: string;
    readonly method?: ServerAuthSessionMethod;
    readonly role?: SessionRole;
    readonly capabilities?: ReadonlyArray<AuthSessionCapability>;
    readonly client?: AuthClientMetadata;
  }) => Effect.Effect<IssuedSession, SessionCredentialError>;
  readonly verify: (token: string) => Effect.Effect<VerifiedSession, SessionCredentialError>;
  readonly issueWebSocketToken: (
    sessionId: AuthSessionId,
    input?: {
      readonly ttl?: Duration.Duration;
    },
  ) => Effect.Effect<
    {
      readonly token: string;
      readonly expiresAt: DateTime.DateTime;
    },
    SessionCredentialError
  >;
  readonly verifyWebSocketToken: (
    token: string,
  ) => Effect.Effect<VerifiedSession, SessionCredentialError>;
  readonly listActive: () => Effect.Effect<
    ReadonlyArray<AuthClientSession>,
    SessionCredentialError
  >;
  readonly streamChanges: Stream.Stream<SessionCredentialChange>;
  readonly revoke: (sessionId: AuthSessionId) => Effect.Effect<boolean, SessionCredentialError>;
  readonly revokeAllExcept: (
    sessionId: AuthSessionId,
  ) => Effect.Effect<number, SessionCredentialError>;
  readonly markConnected: (sessionId: AuthSessionId) => Effect.Effect<void, never>;
  readonly markDisconnected: (sessionId: AuthSessionId) => Effect.Effect<void, never>;
}

export class SessionCredentialService extends Context.Service<
  SessionCredentialService,
  SessionCredentialServiceShape
>()("wobex/auth/Services/SessionCredentialService") {}
