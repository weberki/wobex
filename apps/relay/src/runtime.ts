import { randomBytes, randomUUID, verify as verifySignature } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";

import {
  RelayHostTunnelAuthInput,
  RelayHostTunnelAuthResult,
  RelayRemoteSessionClaim,
} from "@wobex/contracts";
import { buildRelayHostTunnelChallengeMessage } from "@wobex/shared/relayHostAuth";
import { Schema } from "effect";
import { WebSocketServer, WebSocket, type RawData } from "ws";

import { loadRelayServiceConfig, type RelayServiceConfig } from "./config";
import {
  methodNotAllowed,
  parseCookieHeader,
  readJsonBody,
  readRequestBodyBuffer,
  sendJson,
  serializeCookie,
} from "./http";
import { RelayMetadataStore } from "./metadataStore";
import { createRelayPasskeyProvider, type RelayPasskeyProvider } from "./passkeys";
import { createRelayEmailSender, type RelayEmailSender } from "./email";
import {
  RELAY_READ_CAPABILITIES,
  RELAY_WRITE_CAPABILITIES,
  signRelayRemoteSessionClaim,
} from "./relayRemoteSession";
import { createRelayRepository, type RelayRepository } from "./repository";
import {
  createSessionCookieValue,
  createCsrfToken,
  FixedWindowRateLimiter,
  isAllowedWebSocketOrigin,
  parseSessionCookieValue,
} from "./security";
import { RelayTunnelRegistry } from "./tunnelRegistry";
import type { RelayHost } from "./types";
import { validateTunnelFrame, type TunnelFrame } from "./tunnelFrames";

interface RelayAuthContext {
  userId: string;
  deviceId: string;
  sessionId: string;
  sessionToken: string;
}

interface PendingHttpRequest {
  requestId: string;
  resolve: (value: HostHttpResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  hostId: string;
}

interface HostHttpResponse {
  statusCode: number;
  headers: Record<string, string> | undefined;
  body: Buffer<ArrayBufferLike> | undefined;
}

interface BrowserWsProxy {
  hostId: string;
  streamId: string;
  socket: WebSocket;
}

interface HostConnectionState {
  connectionId: string;
  socket: WebSocket;
}

interface PendingHostTunnelChallenge {
  challengeId: string;
  hostId: string;
  hostKeyId: string;
  nonce: string;
  expiresAt: number;
}

const decodeHostTunnelAuthInput = Schema.decodeUnknownSync(RelayHostTunnelAuthInput);

export interface RelayRuntimeOptions {
  config?: RelayServiceConfig;
  repository?: RelayRepository;
  passkeyProvider?: RelayPasskeyProvider;
  emailSender?: RelayEmailSender | null;
}

export class RelayRuntime {
  readonly config: RelayServiceConfig;
  readonly repository: RelayRepository;
  readonly store: RelayMetadataStore;
  readonly tunnelRegistry: RelayTunnelRegistry;
  readonly wsServer: WebSocketServer;
  readonly passkeyProvider: RelayPasskeyProvider;
  readonly emailSender: RelayEmailSender | null;

  #browserWsByStreamId = new Map<string, BrowserWsProxy>();
  #hostConnectionByHostId = new Map<string, HostConnectionState>();
  #pendingHttpByRequestId = new Map<string, PendingHttpRequest>();
  #pendingHostTunnelChallengesById = new Map<string, PendingHostTunnelChallenge>();
  #csrfBySessionId = new Map<string, string>();
  #rateLimiters = {
    loginStart: new FixedWindowRateLimiter(5, 60_000),
    loginVerify: new FixedWindowRateLimiter(10, 60_000),
    pairing: new FixedWindowRateLimiter(5, 60_000),
    tunnelReconnect: new FixedWindowRateLimiter(10, 60_000),
    failedAuth: new FixedWindowRateLimiter(20, 60_000),
  };

  constructor(options: RelayRuntimeOptions = {}) {
    this.config = options.config ?? loadRelayServiceConfig();
    this.repository = options.repository ?? createRelayRepository(this.config.databaseUrl);
    this.repository.assertReady();
    this.store = this.repository.store;
    this.passkeyProvider = options.passkeyProvider ?? createRelayPasskeyProvider();
    this.emailSender = options.emailSender ?? createRelayEmailSender(this.config);
    this.tunnelRegistry = new RelayTunnelRegistry();
    this.wsServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    this.isLocalUrl =
      this.config.publicUrl.hostname === "localhost" ||
      this.config.publicUrl.hostname === "127.0.0.1";
  }

  async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = this.requestUrl(request);
    if (!url) {
      sendJson(response, 400, { error: "Invalid request URL" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true, service: "relay" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      await this.serveRoot(url, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/csrf") {
      this.issueCsrfResponse(request, response);
      return;
    }

    if (url.pathname === "/api/auth/login/start" && request.method === "POST") {
      await this.handleLoginStart(request, response);
      return;
    }

    if (url.pathname === "/api/auth/login/verify" && request.method === "POST") {
      await this.handleLoginVerify(request, response);
      return;
    }

    if (url.pathname === "/api/auth/passkeys/register/start" && request.method === "POST") {
      await this.handlePasskeyRegistrationStart(request, response);
      return;
    }

    if (url.pathname === "/api/auth/passkeys/register/finish" && request.method === "POST") {
      await this.handlePasskeyRegistrationFinish(request, response);
      return;
    }

    if (url.pathname === "/api/auth/passkeys/auth/start" && request.method === "POST") {
      await this.handlePasskeyAuthenticationStart(request, response);
      return;
    }

    if (url.pathname === "/api/auth/passkeys/auth/finish" && request.method === "POST") {
      await this.handlePasskeyAuthenticationFinish(request, response);
      return;
    }

    if (url.pathname === "/api/auth/passkeys/step-up/start" && request.method === "POST") {
      await this.handlePasskeyStepUpStart(request, response);
      return;
    }

    if (url.pathname === "/api/auth/passkeys/step-up/finish" && request.method === "POST") {
      await this.handlePasskeyStepUpFinish(request, response);
      return;
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      await this.handleLogout(request, response);
      return;
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      await this.handleMe(request, response);
      return;
    }

    if (url.pathname === "/api/devices" && request.method === "GET") {
      await this.handleListDevices(request, response);
      return;
    }

    if (url.pathname.startsWith("/api/devices/")) {
      await this.handleDeviceApi(request, response, url);
      return;
    }

    if (url.pathname === "/api/hosts/pairing-intents" && request.method === "POST") {
      await this.handleCreatePairingIntent(request, response);
      return;
    }

    if (url.pathname.startsWith("/api/hosts/pairing-intents/")) {
      await this.handlePairingIntentApi(request, response, url);
      return;
    }

    if (url.pathname === "/api/hosts" && request.method === "GET") {
      await this.handleListHosts(request, response);
      return;
    }

    if (url.pathname.startsWith("/api/hosts/")) {
      await this.handleHostApi(request, response, url);
      return;
    }

    if (url.pathname.startsWith("/h/")) {
      await this.handleProxyHttp(request, response, url);
      return;
    }

    await this.serveStaticOrNotFound(url, response);
  }

  async handleUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
    wsServer = this.wsServer,
  ): Promise<void> {
    const url = this.requestUrl(request);
    if (!url) {
      socket.destroy();
      return;
    }

    if (url.pathname === "/api/host-tunnel") {
      if (!this.authorizeHostTunnelUpgrade(request, socket)) {
        return;
      }
      wsServer.handleUpgrade(request, socket, head, (ws) => {
        this.attachHostTunnel(request, ws, url);
      });
      return;
    }

    if (url.pathname.startsWith("/h/") && url.pathname.endsWith("/ws")) {
      if (!isAllowedWebSocketOrigin(this.originHeader(request), this.config.allowedOrigins)) {
        socket.destroy();
        return;
      }
      const auth = this.requireBrowserSession(request);
      if (!auth) {
        socket.destroy();
        return;
      }
      const hostId = this.extractHostId(url.pathname);
      if (!hostId) {
        socket.destroy();
        return;
      }
      if (!this.#hasHostAccess(auth, hostId)) {
        socket.destroy();
        return;
      }
      wsServer.handleUpgrade(request, socket, head, (ws) => {
        this.attachBrowserProxyWs(request, ws, url, hostId, auth);
      });
      return;
    }

    socket.destroy();
  }

  getCsrfTokenForSession(sessionId: string): string | undefined {
    return this.#csrfBySessionId.get(sessionId);
  }

  close(): void {
    for (const pending of this.#pendingHttpByRequestId.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("relay is shutting down"));
    }
    this.#pendingHttpByRequestId.clear();
    for (const proxy of this.#browserWsByStreamId.values()) {
      proxy.socket.close(1012, "relay shutting down");
    }
    this.#browserWsByStreamId.clear();
    for (const connection of this.#hostConnectionByHostId.values()) {
      connection.socket.close(1001, "relay shutting down");
    }
    this.#hostConnectionByHostId.clear();
    this.wsServer.close();
  }

  #requestContext(request: IncomingMessage): RelayAuthContext | null {
    const session = this.requireBrowserSession(request);
    if (!session) {
      return null;
    }
    return session;
  }

  #hasHostAccess(auth: RelayAuthContext, hostId: string): boolean {
    const host = this.store.getHostById(hostId);
    if (host?.userId === auth.userId) {
      return true;
    }
    return this.store
      .listHostGrantsForDevice(auth.deviceId)
      .some((grant) => grant.hostId === hostId);
  }

  #requireCsrf(request: IncomingMessage, sessionId: string): boolean {
    const cookies = parseCookieHeader(request.headers.cookie);
    const csrfCookie = cookies.relay_csrf;
    const csrfHeader =
      typeof request.headers["x-relay-csrf"] === "string"
        ? request.headers["x-relay-csrf"]
        : undefined;
    if (!csrfCookie || !csrfHeader) {
      return false;
    }
    const expected = this.#csrfBySessionId.get(sessionId);
    return Boolean(expected && csrfCookie === expected && csrfHeader === expected);
  }

  #requireAnonymousCsrf(request: IncomingMessage): boolean {
    const cookies = parseCookieHeader(request.headers.cookie);
    const csrfCookie = cookies.relay_csrf;
    const csrfHeader =
      typeof request.headers["x-relay-csrf"] === "string"
        ? request.headers["x-relay-csrf"]
        : undefined;
    return Boolean(csrfCookie && csrfHeader && csrfCookie === csrfHeader);
  }

  #requireMutatingBrowserCsrf(request: IncomingMessage, sessionId: string): boolean {
    return this.#requireCsrf(request, sessionId);
  }

  #requireRelayWriteSession(
    auth: RelayAuthContext,
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    if (!this.#requireMutatingBrowserCsrf(request, auth.sessionId)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return null;
    }
    const session = this.store.getSessionById(auth.sessionId);
    if (!session || session.revokedAt) {
      sendJson(response, 401, { error: "Unauthorized" });
      return null;
    }
    if (!hasActiveStepUp(session)) {
      sendJson(response, 403, { error: "Fresh step-up required for write access" });
      return null;
    }
    return session;
  }

  #issueCookies(sessionId: string, sessionToken: string): string[] {
    const cookies = [
      serializeCookie(
        "relay_session",
        createSessionCookieValue(sessionId, sessionToken, this.config.sessionCookieSecret),
        {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          secure: !this.isLocalUrl,
        },
      ),
    ];
    const csrfToken = this.#issueCsrfForSession(sessionId);
    cookies.push(
      serializeCookie("relay_csrf", csrfToken, {
        path: "/",
        sameSite: "lax",
        secure: !this.isLocalUrl,
      }),
    );
    return cookies;
  }

  #clearCookies(): string[] {
    return [
      serializeCookie("relay_session", "", {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: !this.isLocalUrl,
        maxAgeSeconds: 0,
      }),
      serializeCookie("relay_csrf", "", {
        path: "/",
        sameSite: "lax",
        secure: !this.isLocalUrl,
        maxAgeSeconds: 0,
      }),
    ];
  }

  #issueCsrfForSession(sessionId: string): string {
    const token = createCsrfToken();
    this.#csrfBySessionId.set(sessionId, token);
    return token;
  }

  async handleLoginStart(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.#requireAnonymousCsrf(request)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const rateKey = this.rateLimitKey(request, "login-start");
    if (!this.#rateLimiters.loginStart.consume(rateKey).allowed) {
      sendJson(response, 429, { error: "Too many login attempts" });
      return;
    }
    const body = await this.parseJson(request);
    const email = readString(body?.email);
    if (!email) {
      sendJson(response, 400, { error: "Missing email" });
      return;
    }
    const deviceLabel = readOptionalString(body?.deviceLabel) ?? "Remote device";
    const challenge = this.store.startLogin(email, deviceLabel);
    let deliveryHint: string | null = null;
    if (!this.config.debugAuthCodes) {
      if (!this.emailSender) {
        sendJson(response, 503, { error: "Relay email delivery is not configured" });
        return;
      }
      try {
        const delivery = await this.emailSender.sendLoginCode({
          email,
          code: challenge.code,
          deviceLabel,
          expiresAt: challenge.challenge.expiresAt,
        });
        deliveryHint = delivery.deliveryHint;
      } catch (error) {
        sendJson(response, 502, { error: stringifyError(error) });
        return;
      }
    }
    await this.repository.flush();
    const payload: Record<string, unknown> = {
      challengeId: challenge.challenge.id,
      expiresAt: challenge.challenge.expiresAt,
      deliveryHint,
    };
    if (this.config.debugAuthCodes) {
      payload.verificationCode = challenge.code;
    }
    sendJson(response, 200, payload);
  }

  async handleLoginVerify(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.#requireAnonymousCsrf(request)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const body = await this.parseJson(request);
    const challengeId = readString(body?.challengeId);
    const code = readString(body?.code);
    if (!challengeId || !code) {
      sendJson(response, 400, { error: "Missing challengeId or code" });
      return;
    }
    const rateKey = this.rateLimitKey(request, `login-verify:${challengeId}`);
    if (!this.#rateLimiters.loginVerify.consume(rateKey).allowed) {
      sendJson(response, 429, { error: "Too many verification attempts" });
      return;
    }

    try {
      const verified = this.store.verifyLogin(
        challengeId,
        code,
        readOptionalString(body?.deviceLabel),
      );
      await this.repository.flush();
      response.setHeader(
        "set-cookie",
        this.#issueCookies(verified.session.id, verified.sessionToken),
      );
      sendJson(response, 200, {
        user: verified.user,
        session: verified.session,
        device: verified.device,
        csrfToken: this.getCsrfTokenForSession(verified.session.id),
      });
    } catch (error) {
      this.#rateLimiters.failedAuth.consume(this.rateLimitKey(request, "failed-auth"));
      sendJson(response, 401, { error: stringifyError(error) });
    }
  }

  async handlePasskeyRegistrationStart(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (!this.#requireMutatingBrowserCsrf(request, auth.sessionId)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const user = this.store.getUserById(auth.userId);
    const device = this.store.getDeviceById(auth.deviceId);
    if (!user || !device) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const started = await this.passkeyProvider.beginRegistration({
      rpId: this.relayRpId(),
      rpName: "Wobex Relay",
      userId: user.id,
      email: user.email,
      displayName: device.label,
      excludeCredentialIds: this.store
        .listPasskeyCredentialsForDevice(device.id)
        .map((credential) => credential.credentialId),
    });
    const challenge = this.store.createPasskeyChallenge({
      userId: user.id,
      sessionId: auth.sessionId,
      deviceId: device.id,
      purpose: "register",
      challenge: started.challenge,
    });
    await this.repository.flush();
    sendJson(response, 200, {
      challengeId: challenge.id,
      options: started.options,
    });
  }

  async handlePasskeyRegistrationFinish(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (!this.#requireMutatingBrowserCsrf(request, auth.sessionId)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const body = await this.parseJson(request);
    const challengeId = readString(body?.challengeId);
    if (!challengeId || body?.response === undefined) {
      sendJson(response, 400, { error: "Missing challengeId or response" });
      return;
    }
    try {
      const challenge = this.store.consumePasskeyChallenge(challengeId, "register");
      if (challenge.sessionId !== auth.sessionId || challenge.deviceId !== auth.deviceId) {
        sendJson(response, 403, { error: "Passkey challenge does not match this session" });
        return;
      }
      const verified = await this.passkeyProvider.verifyRegistration({
        rpId: this.relayRpId(),
        expectedOrigin: this.relayExpectedOrigins(),
        expectedChallenge: challenge.challenge,
        response: body.response as Record<string, unknown>,
      });
      const credential = this.store.addPasskeyCredential({
        userId: auth.userId,
        deviceId: auth.deviceId,
        webauthnUserId: auth.userId,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: verified.transports,
        backedUp: verified.backedUp,
      });
      const device = this.store.trustDevice(auth.deviceId);
      await this.repository.flush();
      sendJson(response, 200, {
        credential,
        device,
      });
    } catch (error) {
      sendJson(response, 400, { error: stringifyError(error) });
    }
  }

  async handlePasskeyAuthenticationStart(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.#requireAnonymousCsrf(request)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const body = await this.parseJson(request);
    const email = readString(body?.email);
    if (!email) {
      sendJson(response, 400, { error: "Missing email" });
      return;
    }
    const user = this.store.getUserByEmail(email);
    if (!user) {
      sendJson(response, 404, { error: "User not found" });
      return;
    }
    const credentials = this.store.listPasskeyCredentialsForUser(user.id);
    if (credentials.length === 0) {
      sendJson(response, 404, { error: "No passkeys registered for this account" });
      return;
    }
    const started = await this.passkeyProvider.beginAuthentication({
      rpId: this.relayRpId(),
      allowCredentialIds: credentials.map((credential) => credential.credentialId),
    });
    const challenge = this.store.createPasskeyChallenge({
      userId: user.id,
      purpose: "login",
      challenge: started.challenge,
    });
    await this.repository.flush();
    sendJson(response, 200, {
      challengeId: challenge.id,
      purpose: "login",
      options: started.options,
    });
  }

  async handlePasskeyAuthenticationFinish(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.#requireAnonymousCsrf(request)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const body = await this.parseJson(request);
    const challengeId = readString(body?.challengeId);
    if (!challengeId || body?.response === undefined) {
      sendJson(response, 400, { error: "Missing challengeId or response" });
      return;
    }
    try {
      const challenge = this.store.consumePasskeyChallenge(challengeId, "login");
      const credentialId = readString((body.response as Record<string, unknown>)?.id);
      if (!credentialId) {
        sendJson(response, 400, { error: "Missing credential id" });
        return;
      }
      const credential = this.store.getPasskeyCredentialByCredentialId(credentialId);
      if (!credential || credential.userId !== challenge.userId) {
        sendJson(response, 401, { error: "Unknown passkey credential" });
        return;
      }
      const verified = await this.passkeyProvider.verifyAuthentication({
        rpId: this.relayRpId(),
        expectedOrigin: this.relayExpectedOrigins(),
        expectedChallenge: challenge.challenge,
        response: body.response as Record<string, unknown>,
        credential,
      });
      const updatedCredential = this.store.updatePasskeyCredentialAssertion(credentialId, {
        counter: verified.newCounter,
        backedUp: verified.backedUp,
      });
      const session = this.store.createUserSession(credential.userId, credential.deviceId, {
        authMethod: "passkey",
      });
      const user = this.store.getUserById(credential.userId);
      const device = this.store.trustDevice(credential.deviceId);
      await this.repository.flush();
      response.setHeader("set-cookie", this.#issueCookies(session.session.id, session.token));
      sendJson(response, 200, {
        user,
        session: session.session,
        device,
        credential: updatedCredential,
        csrfToken: this.getCsrfTokenForSession(session.session.id),
      });
    } catch (error) {
      sendJson(response, 400, { error: stringifyError(error) });
    }
  }

  async handlePasskeyStepUpStart(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (!this.#requireMutatingBrowserCsrf(request, auth.sessionId)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const credentials = this.store.listPasskeyCredentialsForDevice(auth.deviceId);
    if (credentials.length === 0) {
      sendJson(response, 404, { error: "No passkey registered for this device" });
      return;
    }
    const started = await this.passkeyProvider.beginAuthentication({
      rpId: this.relayRpId(),
      allowCredentialIds: credentials.map((credential) => credential.credentialId),
    });
    const challenge = this.store.createPasskeyChallenge({
      userId: auth.userId,
      sessionId: auth.sessionId,
      deviceId: auth.deviceId,
      purpose: "step-up",
      challenge: started.challenge,
    });
    await this.repository.flush();
    sendJson(response, 200, {
      challengeId: challenge.id,
      purpose: "step-up",
      options: started.options,
    });
  }

  async handlePasskeyStepUpFinish(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (!this.#requireMutatingBrowserCsrf(request, auth.sessionId)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const body = await this.parseJson(request);
    const challengeId = readString(body?.challengeId);
    if (!challengeId || body?.response === undefined) {
      sendJson(response, 400, { error: "Missing challengeId or response" });
      return;
    }
    try {
      const challenge = this.store.consumePasskeyChallenge(challengeId, "step-up");
      if (challenge.sessionId !== auth.sessionId || challenge.deviceId !== auth.deviceId) {
        sendJson(response, 403, { error: "Passkey challenge does not match this session" });
        return;
      }
      const credentialId = readString((body.response as Record<string, unknown>)?.id);
      if (!credentialId) {
        sendJson(response, 400, { error: "Missing credential id" });
        return;
      }
      const credential = this.store.getPasskeyCredentialByCredentialId(credentialId);
      if (!credential || credential.deviceId !== auth.deviceId) {
        sendJson(response, 401, { error: "Unknown passkey credential" });
        return;
      }
      const verified = await this.passkeyProvider.verifyAuthentication({
        rpId: this.relayRpId(),
        expectedOrigin: this.relayExpectedOrigins(),
        expectedChallenge: challenge.challenge,
        response: body.response as Record<string, unknown>,
        credential,
      });
      this.store.updatePasskeyCredentialAssertion(credentialId, {
        counter: verified.newCounter,
        backedUp: verified.backedUp,
      });
      const session = this.store.elevateUserSession(auth.sessionId, this.config.stepUpTtlMs);
      const user = this.store.getUserById(auth.userId);
      const device = this.store.getDeviceById(auth.deviceId);
      await this.repository.flush();
      sendJson(response, 200, {
        user,
        session,
        device,
        csrfToken: this.getCsrfTokenForSession(auth.sessionId),
      });
    } catch (error) {
      sendJson(response, 400, { error: stringifyError(error) });
    }
  }

  async handleLogout(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (!this.#requireMutatingBrowserCsrf(request, auth.sessionId)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    this.store.revokeUserSession(auth.sessionId);
    await this.repository.flush();
    response.setHeader("set-cookie", this.#clearCookies());
    sendJson(response, 200, { success: true });
  }

  async handleMe(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const user = this.store.getUserById(auth.userId);
    const device = this.store.getDeviceById(auth.deviceId);
    const session = this.store.verifyUserSession(auth.sessionId, auth.sessionToken);
    if (!user || !device || !session) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    response.setHeader("set-cookie", this.#issueCookies(session.id, auth.sessionToken));
    sendJson(response, 200, {
      user,
      device,
      session,
      csrfToken: this.getCsrfTokenForSession(session.id),
    });
  }

  async handleListHosts(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const ownedHosts = this.store.listHostsForUser(auth.userId);
    const grantedHosts: RelayHost[] = [];
    for (const grant of this.store.listHostGrantsForDevice(auth.deviceId)) {
      const host = this.store.getHostById(grant.hostId);
      if (host && !host.revokedAt) {
        grantedHosts.push(host);
      }
    }
    const hosts = [
      ...new Map([...ownedHosts, ...grantedHosts].map((host) => [host.id, host])).values(),
    ];
    sendJson(response, 200, {
      hosts: hosts.map((host) => this.toHostListItem(host.id)),
    });
  }

  async handleListDevices(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    sendJson(response, 200, {
      currentDeviceId: auth.deviceId,
      devices: this.store
        .listDevicesForUser(auth.userId)
        .toSorted((left, right) => {
          if (left.id === auth.deviceId) {
            return -1;
          }
          if (right.id === auth.deviceId) {
            return 1;
          }
          return Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
        })
        .map((device) => this.toRelayDevice(device.id)),
    });
  }

  async handleDeviceApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const deviceIdMatch = /^\/api\/devices\/([^/]+)(\/revoke)?$/.exec(url.pathname);
    if (!deviceIdMatch) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const deviceId = decodeURIComponent(deviceIdMatch[1]!);
    if (request.method === "POST" && deviceIdMatch[2] === "/revoke") {
      await this.handleRevokeDevice(request, response, deviceId);
      return;
    }
    methodNotAllowed(response, ["POST"]);
  }

  async handleHostApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const hostIdMatch =
      /^\/api\/hosts\/([^/]+)(\/status|\/revoke|\/bootstrap|\/public-key|\/tunnel-challenge)?$/.exec(
        url.pathname,
      );
    if (!hostIdMatch) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const hostId = decodeURIComponent(hostIdMatch[1]!);
    const suffix = hostIdMatch[2] ?? "";
    if (request.method === "GET" && suffix === "/status") {
      await this.handleGetHostStatus(request, response, hostId);
      return;
    }
    if (request.method === "POST" && suffix === "/revoke") {
      await this.handleRevokeHost(request, response, hostId);
      return;
    }
    if (request.method === "POST" && suffix === "/bootstrap") {
      await this.handleHostBootstrap(request, response, hostId);
      return;
    }
    if (request.method === "POST" && suffix === "/public-key") {
      await this.handleRegisterHostPublicKey(request, response, hostId);
      return;
    }
    if (request.method === "POST" && suffix === "/tunnel-challenge") {
      await this.handleCreateHostTunnelChallenge(request, response, hostId);
      return;
    }
    methodNotAllowed(response, ["GET", "POST"]);
  }

  async handlePairingIntentApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const createMatch = /^\/api\/hosts\/pairing-intents\/?$/.test(url.pathname);
    if (createMatch && request.method === "POST") {
      await this.handleCreatePairingIntent(request, response);
      return;
    }

    const intentMatch = /^\/api\/hosts\/pairing-intents\/([^/]+)(\/approve)?$/.exec(url.pathname);
    if (!intentMatch) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    const intentId = decodeURIComponent(intentMatch[1]!);
    if (request.method === "GET") {
      await this.handlePollPairingIntent(request, response, intentId);
      return;
    }
    if (request.method === "POST" && intentMatch[2] === "/approve") {
      await this.handleApprovePairingIntent(request, response, intentId);
      return;
    }
    methodNotAllowed(response, ["GET", "POST"]);
  }

  async handleGetHostStatus(
    request: IncomingMessage,
    response: ServerResponse,
    hostId: string,
  ): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const host = this.store.getHostById(hostId);
    if (!host || !this.#hasHostAccess(auth, hostId)) {
      sendJson(response, 404, { error: "Host not found" });
      return;
    }
    sendJson(response, 200, this.toHostStatus(hostId));
  }

  async handleRevokeHost(
    request: IncomingMessage,
    response: ServerResponse,
    hostId: string,
  ): Promise<void> {
    const registrationToken = this.readBearerToken(request);
    if (registrationToken) {
      const token = this.store.verifyHostRegistrationToken(hostId, registrationToken);
      if (!token) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }
      this.store.revokeHost(hostId);
      this.forceDisconnectHost(hostId);
      await this.repository.flush();
      sendJson(response, 200, {
        hostId,
        revoked: true,
        revokedAt: this.store.getHostStatus(hostId)?.disconnectedAt ?? new Date().toISOString(),
      });
      return;
    }

    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (!this.#requireRelayWriteSession(auth, request, response)) {
      return;
    }
    const host = this.store.getHostById(hostId);
    if (!host || !this.#hasHostAccess(auth, hostId)) {
      sendJson(response, 404, { error: "Host not found" });
      return;
    }
    this.store.revokeHost(hostId);
    this.forceDisconnectHost(hostId);
    await this.repository.flush();
    sendJson(response, 200, {
      hostId,
      revoked: true,
      revokedAt: this.store.getHostStatus(hostId)?.disconnectedAt ?? new Date().toISOString(),
    });
  }

  async handleRevokeDevice(
    request: IncomingMessage,
    response: ServerResponse,
    deviceId: string,
  ): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const session = this.#requireRelayWriteSession(auth, request, response);
    if (!session) {
      return;
    }
    const device = this.store.getDeviceById(deviceId);
    if (!device || device.userId !== auth.userId) {
      sendJson(response, 404, { error: "Device not found" });
      return;
    }
    const revoked = this.store.revokeDevice(deviceId);
    if (!revoked) {
      sendJson(response, 404, { error: "Device not found" });
      return;
    }
    await this.repository.flush();
    if (deviceId === auth.deviceId) {
      response.setHeader("set-cookie", this.#clearCookies());
    } else if (session.id === auth.sessionId) {
      response.setHeader("set-cookie", this.#issueCookies(session.id, auth.sessionToken));
    }
    sendJson(response, 200, {
      device: this.toRelayDevice(revoked.id),
      currentSessionRevoked: deviceId === auth.deviceId,
    });
  }

  async handleRegisterHostPublicKey(
    request: IncomingMessage,
    response: ServerResponse,
    hostId: string,
  ): Promise<void> {
    const registrationToken = this.readBearerToken(request);
    if (!registrationToken) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await this.parseJson(request);
    const hostKeyId = readString(body?.hostKeyId);
    const publicKeyPem = readString(body?.publicKeyPem);
    const algorithm = body?.algorithm === "ed25519" ? "ed25519" : null;
    if (!hostKeyId || !publicKeyPem || !algorithm) {
      sendJson(response, 400, { error: "Missing host key registration fields" });
      return;
    }
    try {
      const host = this.store.registerHostPublicKey(hostId, registrationToken, {
        hostKeyId,
        publicKeyPem,
        algorithm,
      });
      await this.repository.flush();
      sendJson(response, 200, {
        hostId: host.id,
        hostKeyId,
        trustedRelaySigningKeyId: this.config.signingKeyId,
        trustedRelaySigningKey: this.config.signingKey,
      });
    } catch (error) {
      sendJson(response, 401, { error: stringifyError(error) });
    }
  }

  async handleCreateHostTunnelChallenge(
    request: IncomingMessage,
    response: ServerResponse,
    hostId: string,
  ): Promise<void> {
    const registrationToken = this.readBearerToken(request);
    if (!registrationToken || !this.store.verifyHostRegistrationToken(hostId, registrationToken)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const body = await this.parseJson(request);
    const hostKeyId = readString(body?.hostKeyId);
    const host = this.store.getHostById(hostId);
    if (!hostKeyId || !host || host.hostKeyId !== hostKeyId || !host.hostPublicKeyPem) {
      sendJson(response, 400, { error: "Host key is not registered" });
      return;
    }
    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 60_000;
    this.#pendingHostTunnelChallengesById.set(challengeId, {
      challengeId,
      hostId,
      hostKeyId,
      nonce,
      expiresAt,
    });
    sendJson(response, 200, {
      challengeId,
      nonce,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }

  async handleHostBootstrap(
    request: IncomingMessage,
    response: ServerResponse,
    hostId: string,
  ): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (!this.#requireMutatingBrowserCsrf(request, auth.sessionId)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }

    const host = this.store.getHostById(hostId);
    if (!host || !this.#hasHostAccess(auth, hostId)) {
      sendJson(response, 404, { error: "Host not found" });
      return;
    }

    const session = this.store.getSessionById(auth.sessionId);
    if (!session || session.revokedAt) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const grant = this.store
      .listHostGrantsForDevice(auth.deviceId)
      .find((candidate) => candidate.hostId === hostId);
    if (!grant) {
      sendJson(response, 403, { error: "Host grant missing" });
      return;
    }

    const body = await this.parseJson(request);
    const scope = body?.scope === "write" ? "write" : "read";
    if (scope === "write" && !hasActiveStepUp(session)) {
      this.store.recordAudit({
        action: "capability.denied",
        actorUserId: auth.userId,
        deviceId: auth.deviceId,
        hostId,
        metadata: {
          requestedScope: scope,
        },
      });
      await this.repository.flush();
      sendJson(response, 403, { error: "Fresh step-up required for write access" });
      return;
    }

    const capabilities = scope === "write" ? RELAY_WRITE_CAPABILITIES : RELAY_READ_CAPABILITIES;
    const now = new Date();
    const signedClaim = signRelayRemoteSessionClaim({
      keyId: this.config.signingKeyId,
      secret: this.config.signingKey,
      claim: {
        version: 1,
        hostId: hostId as RelayRemoteSessionClaim["hostId"],
        userId: auth.userId as RelayRemoteSessionClaim["userId"],
        deviceId: auth.deviceId as RelayRemoteSessionClaim["deviceId"],
        grantId: grant.id as RelayRemoteSessionClaim["grantId"],
        subject: `relay:${auth.userId}:${auth.deviceId}`,
        role: "client",
        capabilities,
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      },
    });

    const proxyResult = await this.proxyHttpRequest({
      hostId,
      requestId: randomUUID(),
      deviceId: auth.deviceId,
      method: "POST",
      path: "/api/auth/relay/bootstrap",
      headers: {
        "content-type": "application/json",
      },
      body: Buffer.from(JSON.stringify({ signedClaim }), "utf8"),
      timeoutMs: this.config.proxyTimeoutMs,
    });

    if (!proxyResult) {
      sendJson(response, 503, { error: "Host offline" });
      return;
    }

    this.store.recordAudit({
      action: "remote.session.opened",
      actorUserId: auth.userId,
      deviceId: auth.deviceId,
      hostId,
      metadata: {
        statusCode: proxyResult.statusCode,
        byteCount: proxyResult.body?.byteLength ?? 0,
      },
    });
    await this.repository.flush();

    response.statusCode = proxyResult.statusCode;
    for (const [key, value] of Object.entries(proxyResult.headers ?? {})) {
      response.setHeader(key, value);
    }
    response.end(proxyResult.body);
  }

  async handleCreatePairingIntent(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const auth = this.#requestContext(request);
    if (auth && !this.#requireMutatingBrowserCsrf(request, auth.sessionId)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const rateKey = this.rateLimitKey(request, `pairing:${auth?.userId ?? "host"}`);
    if (!this.#rateLimiters.pairing.consume(rateKey).allowed) {
      sendJson(response, 429, { error: "Too many pairing intents" });
      return;
    }
    const body = await this.parseJson(request);
    const hostLabel = readString(body?.hostLabel);
    if (!hostLabel) {
      sendJson(response, 400, { error: "Missing hostLabel" });
      return;
    }
    const created = this.store.createHostPairingIntent(auth?.userId ?? null, hostLabel);
    await this.repository.flush();
    sendJson(response, 200, {
      intent: this.toPairingIntentResult(created.intent, created.deviceCode),
    });
  }

  async handleApprovePairingIntent(
    request: IncomingMessage,
    response: ServerResponse,
    intentId: string,
  ): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (!this.#requireMutatingBrowserCsrf(request, auth.sessionId)) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const body = await this.parseJson(request);
    const deviceCode = readString(body?.deviceCode);
    if (!deviceCode) {
      sendJson(response, 400, { error: "Missing deviceCode" });
      return;
    }
    try {
      const approved = this.store.approveHostPairingIntent(intentId, deviceCode, auth.userId);
      const hostGrant = this.store.createHostGrant(approved.host.id, auth.deviceId);
      await this.repository.flush();
      sendJson(response, 200, {
        host: this.toRelayHost(approved.host.id),
        registrationToken: {
          tokenId: approved.registrationToken.id,
          token: approved.token,
          expiresAt: approved.registrationToken.expiresAt ?? oneYearFromNow(),
        },
        trustedRelaySigningKeyId: this.config.signingKeyId,
        trustedRelaySigningKey: this.config.signingKey,
        grant: hostGrant,
      });
    } catch (error) {
      sendJson(response, 400, { error: stringifyError(error) });
    }
  }

  async handlePollPairingIntent(
    request: IncomingMessage,
    response: ServerResponse,
    intentId: string,
  ): Promise<void> {
    const status = this.store.getHostPairingIntent(intentId);
    if (status) {
      const host = status.hostId ? this.store.getHostById(status.hostId) : undefined;
      sendJson(response, 200, {
        intent: this.toPairingIntentResult(status),
        ...(host ? { host: this.toHostListItem(host.id) } : {}),
        ...(status.registrationTokenId && status.registrationToken
          ? {
              registrationToken: {
                tokenId: status.registrationTokenId,
                token: status.registrationToken,
                expiresAt: status.registrationTokenExpiresAt ?? oneYearFromNow(),
              },
            }
          : {}),
        ...(status.status === "approved"
          ? {
              trustedRelaySigningKeyId: this.config.signingKeyId,
              trustedRelaySigningKey: this.config.signingKey,
            }
          : {}),
      });
      return;
    }
    sendJson(response, 404, { error: "Pairing intent not found" });
  }

  async handleProxyHttp(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const auth = this.#requestContext(request);
    if (!auth) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const hostId = this.extractHostId(url.pathname);
    if (!hostId) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const host = this.store.getHostById(hostId);
    if (!host || !this.#hasHostAccess(auth, hostId)) {
      sendJson(response, 404, { error: "Host not found" });
      return;
    }
    const method = (request.method ?? "GET").toUpperCase();
    if (
      method !== "GET" &&
      method !== "HEAD" &&
      method !== "OPTIONS" &&
      !this.#requireMutatingBrowserCsrf(request, auth.sessionId)
    ) {
      sendJson(response, 403, { error: "CSRF token missing or invalid" });
      return;
    }
    const proxiedPath = this.stripRelayPrefix(url.pathname) + url.search;
    let body: Buffer = Buffer.alloc(0) as Buffer;
    try {
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        body = (await readRequestBodyBuffer(request, this.config.requestBodyLimitBytes)) as Buffer;
      }
    } catch {
      sendJson(response, 413, { error: "Request body too large" });
      return;
    }
    const result = await this.proxyHttpRequest({
      hostId,
      requestId: randomUUID(),
      deviceId: auth.deviceId,
      method,
      path: proxiedPath,
      headers: this.serializeHeaders(request.headers),
      body,
      timeoutMs: this.config.proxyTimeoutMs,
    });
    if (!result) {
      sendJson(response, 503, { error: "Host offline" });
      return;
    }
    response.statusCode = result.statusCode;
    for (const [key, value] of Object.entries(result.headers ?? {})) {
      response.setHeader(key, value);
    }
    if (result.body && result.body.byteLength > 0) {
      response.setHeader("content-length", result.body.byteLength);
      response.end(result.body);
      return;
    }
    response.end();
  }

  async proxyHttpRequest(input: {
    hostId: string;
    requestId: string;
    deviceId: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body: Buffer;
    timeoutMs: number;
  }): Promise<HostHttpResponse | null> {
    const connection = this.#hostConnectionByHostId.get(input.hostId);
    if (!connection) {
      return null;
    }
    const requestFrame = {
      version: 1,
      type: "http.request",
      hostId: input.hostId,
      deviceId: input.deviceId,
      requestId: input.requestId,
      timestamp: new Date().toISOString(),
      payload: {
        method: input.method as never,
        path: input.path,
        headers: input.headers,
        ...(input.body.byteLength > 0
          ? { bodyBase64: input.body.toString("base64"), byteCount: input.body.byteLength }
          : {}),
        timeoutMs: input.timeoutMs,
      },
    } as unknown as TunnelFrame;

    return await new Promise<HostHttpResponse | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingHttpByRequestId.delete(input.requestId);
        reject(new Error("Host request timed out"));
      }, input.timeoutMs);
      this.#pendingHttpByRequestId.set(input.requestId, {
        requestId: input.requestId,
        hostId: input.hostId,
        timeout,
        resolve: (value) => resolve(value),
        reject,
      });
      try {
        this.tunnelRegistry.recordFrame(requestFrame);
        connection.socket.send(JSON.stringify(requestFrame));
      } catch (error) {
        clearTimeout(timeout);
        this.#pendingHttpByRequestId.delete(input.requestId);
        reject(error instanceof Error ? error : new Error("failed to send proxy request"));
      }
    }).catch(() => null);
  }

  attachHostTunnel(request: IncomingMessage, socket: WebSocket, _url: URL): void {
    const connectionId = randomUUID();
    let authenticatedHostId: string | null = null;
    const authenticationTimeout = setTimeout(() => {
      if (!authenticatedHostId) {
        socket.close(4401, "Authentication timeout");
      }
    }, 5_000);

    socket.on("message", (raw) => {
      if (!authenticatedHostId) {
        const authenticated = this.authenticateHostTunnel(raw, connectionId, socket);
        if (!authenticated) {
          clearTimeout(authenticationTimeout);
          socket.close(4401, "Unauthorized");
          return;
        }
        authenticatedHostId = authenticated;
        clearTimeout(authenticationTimeout);
        const host = this.store.getHostById(authenticated);
        const authResult = {
          authenticated: true,
          host: this.toHostListItem(authenticated) as typeof RelayHostTunnelAuthResult.Type.host,
          connectedAt: host?.createdAt ?? new Date().toISOString(),
        } satisfies typeof RelayHostTunnelAuthResult.Type;
        socket.send(JSON.stringify(authResult));
        return;
      }
      this.handleHostFrameMessage(authenticatedHostId, raw);
    });
    socket.on("close", () => {
      clearTimeout(authenticationTimeout);
      if (authenticatedHostId) {
        this.handleHostDisconnect(authenticatedHostId, connectionId);
      }
    });
    socket.on("error", () => {
      clearTimeout(authenticationTimeout);
      if (authenticatedHostId) {
        this.handleHostDisconnect(authenticatedHostId, connectionId);
      }
    });
  }

  forceDisconnectHost(hostId: string): void {
    const connection = this.#hostConnectionByHostId.get(hostId);
    if (!connection) {
      return;
    }
    connection.socket.close(1000, "host revoked");
    this.handleHostDisconnect(hostId, connection.connectionId);
  }

  #attachHostConnection(
    hostId: string,
    socket: WebSocket,
    connectionId: string,
  ): HostConnectionState {
    this.tunnelRegistry.connect({
      connectionId,
      hostId,
      send: (frame) => socket.send(JSON.stringify(frame)),
    });
    this.#hostConnectionByHostId.set(hostId, { connectionId, socket });
    this.store.setHostStatus(hostId, "online", connectionId);
    this.flushMetadataInBackground();
    return { connectionId, socket };
  }

  handleHostFrameMessage(hostId: string, raw: RawData): void {
    const text = rawDataToUtf8(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const frameResult = validateTunnelFrame(parsed);
    if (!frameResult.ok) {
      return;
    }
    const frame = frameResult.frame;
    this.tunnelRegistry.recordFrame(frame);
    if (frame.type === "host.status") {
      this.store.setHostStatus(
        frame.hostId,
        frame.payload.status,
        this.#hostConnectionByHostId.get(hostId)?.connectionId,
      );
      this.flushMetadataInBackground();
      return;
    }
    if (frame.type === "host.error") {
      const requestId = frame.requestId;
      const pending = requestId ? this.#pendingHttpByRequestId.get(requestId) : undefined;
      if (pending && requestId) {
        clearTimeout(pending.timeout);
        this.#pendingHttpByRequestId.delete(requestId);
        pending.reject(new Error(frame.payload.message));
      }
      return;
    }
    if (frame.type === "http.response") {
      const requestId = frame.requestId;
      if (!requestId) {
        return;
      }
      const pending = this.#pendingHttpByRequestId.get(requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.#pendingHttpByRequestId.delete(requestId);
      const responseFrame: HostHttpResponse = {
        statusCode: frame.payload.statusCode,
        headers: frame.payload.headers ?? undefined,
        body: undefined,
      };
      if (frame.payload.bodyBase64) {
        responseFrame.body = Buffer.from(frame.payload.bodyBase64, "base64");
      }
      pending.resolve(responseFrame);
      return;
    }
    if (frame.type === "ws.message") {
      const proxy = frame.streamId ? this.#browserWsByStreamId.get(frame.streamId) : undefined;
      if (!proxy) {
        return;
      }
      try {
        if (frame.payload.isBinary) {
          proxy.socket.send(Buffer.from(frame.payload.data, "base64"));
        } else {
          proxy.socket.send(frame.payload.data);
        }
      } catch {
        this.#browserWsByStreamId.delete(frame.streamId);
      }
      return;
    }
    if (frame.type === "ws.close") {
      const proxy = frame.streamId ? this.#browserWsByStreamId.get(frame.streamId) : undefined;
      if (proxy) {
        try {
          proxy.socket.close(frame.payload.code, frame.payload.reason);
        } catch {
          // ignore
        }
        this.#browserWsByStreamId.delete(frame.streamId);
      }
    }
  }

  handleHostDisconnect(hostId: string, connectionId: string): void {
    const current = this.#hostConnectionByHostId.get(hostId);
    if (!current || current.connectionId !== connectionId) {
      return;
    }
    this.#hostConnectionByHostId.delete(hostId);
    this.tunnelRegistry.disconnect(hostId, connectionId);
    this.store.setHostStatus(hostId, "offline", connectionId);
    this.flushMetadataInBackground();
    for (const [requestId, pending] of this.#pendingHttpByRequestId.entries()) {
      if (pending.hostId === hostId) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Host offline"));
        this.#pendingHttpByRequestId.delete(requestId);
      }
    }
    for (const [streamId, proxy] of this.#browserWsByStreamId.entries()) {
      if (proxy.hostId === hostId) {
        proxy.socket.close(1013, "Host offline");
        this.#browserWsByStreamId.delete(streamId);
      }
    }
  }

  attachBrowserProxyWs(
    request: IncomingMessage,
    socket: WebSocket,
    url: URL,
    hostId: string,
    auth: RelayAuthContext,
  ): void {
    const connection = this.#hostConnectionByHostId.get(hostId);
    if (!connection) {
      socket.close(1013, "Host offline");
      return;
    }
    const streamId = randomUUID();
    const proxy: BrowserWsProxy = { hostId, streamId, socket };
    this.#browserWsByStreamId.set(streamId, proxy);
    const openFrame = {
      version: 1,
      type: "ws.open",
      hostId,
      deviceId: auth.deviceId,
      streamId,
      timestamp: new Date().toISOString(),
      payload: {
        path: this.stripRelayPrefix(url.pathname) + url.search,
        headers: this.serializeHeaders(request.headers),
        subprotocol: readOptionalHeader(request.headers["sec-websocket-protocol"]),
      },
    } as unknown as TunnelFrame;
    this.tunnelRegistry.recordFrame(openFrame);
    try {
      const current = this.#hostConnectionByHostId.get(hostId);
      if (current && current.connectionId === connection.connectionId) {
        current.socket.send(JSON.stringify(openFrame));
      }
    } catch {
      // ignore transient send failure
    }
    socket.on("message", (data, isBinary) => {
      const dataBuffer = rawDataToBuffer(data);
      const payload = {
        version: 1,
        type: "ws.message" as const,
        hostId,
        deviceId: auth.deviceId,
        streamId,
        timestamp: new Date().toISOString(),
        payload: {
          direction: "client-to-host" as const,
          isBinary,
          data: isBinary ? dataBuffer.toString("base64") : dataBuffer.toString("utf8"),
          byteCount: dataBuffer.byteLength,
        },
      } as unknown as TunnelFrame;
      this.tunnelRegistry.recordFrame(payload);
      try {
        const current = this.#hostConnectionByHostId.get(hostId);
        if (current && current.connectionId === connection.connectionId) {
          current.socket.send(JSON.stringify(payload));
        }
      } catch {
        // ignore transient send failure
      }
    });
    socket.on("close", (code, reason) => {
      const closeFrame = {
        version: 1,
        type: "ws.close",
        hostId,
        deviceId: auth.deviceId,
        streamId,
        timestamp: new Date().toISOString(),
        payload: {
          code,
          ...(reason.length > 0 ? { reason: reason.toString() } : {}),
          initiatedBy: "client" as const,
        },
      } as unknown as TunnelFrame;
      this.tunnelRegistry.recordFrame(closeFrame);
      try {
        const current = this.#hostConnectionByHostId.get(hostId);
        if (current && current.connectionId === connection.connectionId) {
          current.socket.send(JSON.stringify(closeFrame));
        }
      } catch {
        // ignore transient send failure
      }
      this.#browserWsByStreamId.delete(streamId);
    });
  }

  issueCsrfResponse(request: IncomingMessage, response: ServerResponse): void {
    const auth = this.#requestContext(request);
    if (!auth) {
      const token = createCsrfToken();
      response.setHeader(
        "set-cookie",
        serializeCookie("relay_csrf", token, {
          path: "/",
          sameSite: "lax",
          secure: !this.isLocalUrl,
        }),
      );
      sendJson(response, 200, { csrfToken: token });
      return;
    }
    const csrfToken = this.#issueCsrfForSession(auth.sessionId);
    response.setHeader(
      "set-cookie",
      serializeCookie("relay_csrf", csrfToken, {
        path: "/",
        sameSite: "lax",
        secure: !this.isLocalUrl,
      }),
    );
    sendJson(response, 200, { csrfToken });
  }

  relayRpId(): string {
    return this.config.publicUrl.hostname;
  }

  relayExpectedOrigins(): readonly string[] {
    return [...new Set([this.config.publicUrl.origin, ...this.config.allowedOrigins])];
  }

  requestUrl(request: IncomingMessage): URL | null {
    try {
      return new URL(request.url ?? "/", this.config.publicUrl);
    } catch {
      return null;
    }
  }

  #requestCookieAuth(request: IncomingMessage): RelayAuthContext | null {
    const cookies = parseCookieHeader(request.headers.cookie);
    const raw = cookies.relay_session;
    if (!raw) {
      return null;
    }
    const parsed = parseSessionCookieValue(raw, this.config.sessionCookieSecret);
    if (!parsed) {
      return null;
    }
    const session = this.store.verifyUserSession(parsed.sessionId, parsed.sessionToken);
    if (!session) {
      return null;
    }
    const device = this.store.getDeviceById(session.deviceId);
    if (!device || device.revokedAt) {
      return null;
    }
    return {
      userId: session.userId,
      deviceId: session.deviceId,
      sessionId: session.id,
      sessionToken: parsed.sessionToken,
    };
  }

  requireBrowserSession(request: IncomingMessage): RelayAuthContext | null {
    return this.#requestCookieAuth(request);
  }

  rateLimitKey(request: IncomingMessage, scope: string): string {
    const remoteAddress =
      request.socket.remoteAddress ??
      readOptionalHeader(request.headers["x-forwarded-for"]) ??
      "unknown";
    return `${scope}:${remoteAddress}`;
  }

  originHeader(request: IncomingMessage): string | undefined {
    return readOptionalHeader(request.headers.origin);
  }

  readonly isLocalUrl: boolean;

  readBearerToken(request: IncomingMessage): string | null {
    const authorization = readOptionalHeader(request.headers.authorization);
    if (!authorization) {
      return null;
    }
    const match = /^Bearer\s+(.+)$/.exec(authorization);
    return match?.[1]?.trim() || null;
  }

  serializeHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== "string") {
        continue;
      }
      const normalized = key.toLowerCase();
      if (
        normalized === "connection" ||
        normalized === "content-length" ||
        normalized === "host" ||
        normalized === "upgrade" ||
        normalized.startsWith("sec-websocket") ||
        normalized.startsWith("proxy-")
      ) {
        continue;
      }
      output[normalized] = value;
    }
    return output;
  }

  extractHostId(pathname: string): string | null {
    const match = /^\/h\/([^/]+)/.exec(pathname);
    return match ? decodeURIComponent(match[1]!) : null;
  }

  stripRelayPrefix(pathname: string): string {
    const match = /^\/h\/[^/]+(.*)$/.exec(pathname);
    const remainder = match?.[1] ?? "/";
    return remainder.length > 0 ? remainder : "/";
  }

  toHostStatus(hostId: string): Record<string, unknown> {
    const hostStatus = this.store.getHostStatus(hostId);
    if (!hostStatus) {
      return {
        hostId,
        status: "offline",
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      hostId,
      status: hostStatus.state,
      updatedAt: hostStatus.disconnectedAt ?? hostStatus.connectedAt ?? new Date().toISOString(),
    };
  }

  toHostListItem(hostId: string): Record<string, unknown> {
    const host = this.store.getHostById(hostId);
    const status = this.store.getHostStatus(hostId);
    const activeGrantCount = this.store.listHostGrantsForHost(hostId).length;
    return {
      id: host?.id ?? hostId,
      ownerUserId: host?.userId ?? "unknown",
      label: host?.label ?? "Unknown host",
      status: status?.state ?? "offline",
      lastSeenAt: status?.connectedAt ?? status?.disconnectedAt ?? null,
      createdAt: host?.createdAt ?? new Date().toISOString(),
      updatedAt: host?.revokedAt ?? host?.createdAt ?? new Date().toISOString(),
      activeGrantCount,
    };
  }

  toRelayHost(hostId: string): Record<string, unknown> {
    const host = this.store.getHostById(hostId);
    const status = this.store.getHostStatus(hostId);
    return {
      id: host?.id ?? hostId,
      ownerUserId: host?.userId ?? "unknown",
      label: host?.label ?? "Unknown host",
      status: status?.state ?? "offline",
      lastSeenAt: status?.connectedAt ?? status?.disconnectedAt ?? null,
      createdAt: host?.createdAt ?? new Date().toISOString(),
      updatedAt: host?.revokedAt ?? host?.createdAt ?? new Date().toISOString(),
    };
  }

  toRelayDevice(deviceId: string): Record<string, unknown> {
    const device = this.store.getDeviceById(deviceId);
    return {
      id: device?.id ?? deviceId,
      userId: device?.userId ?? "unknown",
      label: device?.label ?? "Unknown device",
      status: device?.revokedAt ? "revoked" : "active",
      trustState: device?.trustState ?? "recovery",
      createdAt: device?.createdAt ?? new Date().toISOString(),
      lastSeenAt: device?.lastSeenAt ?? new Date().toISOString(),
      trustedAt: device?.trustedAt ?? null,
    };
  }

  toPairingIntentResult(
    intent: {
      id: string;
      userId: string;
      deviceCode?: string;
      status: string;
      createdAt: string;
      expiresAt: string;
      approvedAt?: string;
      hostId?: string;
    },
    deviceCode?: string,
  ): Record<string, unknown> {
    return {
      id: intent.id,
      requestedByUserId: intent.userId,
      ...(intent.hostId ? { hostId: intent.hostId } : {}),
      deviceCode: deviceCode ?? intent.deviceCode ?? "pending",
      qrCodeUrl: `${this.config.publicUrl.toString().replace(/\/$/, "")}/pair/${encodeURIComponent(deviceCode ?? intent.deviceCode ?? intent.id)}`,
      status: intent.status,
      createdAt: intent.createdAt,
      expiresAt: intent.expiresAt,
      approvedAt: intent.approvedAt ?? null,
      ...(intent.approvedAt && intent.userId !== "pending"
        ? { approvedByUserId: intent.userId }
        : {}),
    };
  }

  async serveRoot(url: URL, response: ServerResponse): Promise<void> {
    if (!this.config.webStaticDir) {
      sendJson(response, 200, {
        service: "relay",
        online: true,
      });
      return;
    }
    await this.serveStaticOrNotFound(url, response);
  }

  async serveStaticOrNotFound(url: URL, response: ServerResponse): Promise<void> {
    const webStaticDir = this.config.webStaticDir;
    if (!webStaticDir) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const baseDir = path.resolve(webStaticDir);
    const routePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const candidatePath = path.resolve(baseDir, `.${routePath}`);
    if (!candidatePath.startsWith(baseDir)) {
      sendJson(response, 403, { error: "Forbidden" });
      return;
    }
    const filePath = await this.resolveStaticFile(candidatePath);
    if (!filePath) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const contentType = contentTypeForPath(filePath);
    response.statusCode = 200;
    response.setHeader("content-type", contentType);
    createReadStream(filePath).pipe(response);
  }

  async resolveStaticFile(candidatePath: string): Promise<string | null> {
    try {
      const fileStat = await stat(candidatePath);
      if (fileStat.isFile()) {
        return candidatePath;
      }
    } catch {
      // ignore
    }
    const webStaticDir = this.config.webStaticDir;
    if (!webStaticDir) {
      return null;
    }
    const indexPath = path.join(webStaticDir, "index.html");
    try {
      const fileStat = await stat(indexPath);
      if (fileStat.isFile()) {
        return indexPath;
      }
    } catch {
      return null;
    }
    return null;
  }

  async parseJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
    try {
      const body = await readJsonBody(request, this.config.requestBodyLimitBytes);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return null;
      }
      return body as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  authorizeHostTunnelUpgrade(request: IncomingMessage, socket: Socket): boolean {
    const url = this.requestUrl(request);
    if (!url) {
      socket.destroy();
      return false;
    }
    if (url.pathname !== "/api/host-tunnel") {
      socket.destroy();
      return false;
    }
    const rateKey = this.rateLimitKey(request, "tunnel-reconnect");
    if (!this.#rateLimiters.tunnelReconnect.consume(rateKey).allowed) {
      socket.destroy();
      return false;
    }
    return true;
  }

  authenticateHostTunnel(raw: RawData, connectionId: string, socket: WebSocket): string | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDataToUtf8(raw));
    } catch {
      this.#rateLimiters.failedAuth.consume("host-tunnel:json");
      return null;
    }
    let authInput: typeof RelayHostTunnelAuthInput.Type;
    try {
      authInput = decodeHostTunnelAuthInput(parsed);
    } catch {
      this.#rateLimiters.failedAuth.consume("host-tunnel:schema");
      return null;
    }
    const challenge = this.#pendingHostTunnelChallengesById.get(authInput.challengeId);
    if (
      !challenge ||
      challenge.hostId !== authInput.hostId ||
      challenge.hostKeyId !== authInput.hostKeyId ||
      challenge.expiresAt <= Date.now()
    ) {
      this.#pendingHostTunnelChallengesById.delete(authInput.challengeId);
      this.#rateLimiters.failedAuth.consume(`host-tunnel:${authInput.hostId}`);
      return null;
    }

    const host = this.store.getHostById(authInput.hostId);
    if (
      !host ||
      host.revokedAt ||
      host.hostKeyId !== authInput.hostKeyId ||
      host.hostKeyAlgorithm !== "ed25519" ||
      !host.hostPublicKeyPem
    ) {
      this.#pendingHostTunnelChallengesById.delete(authInput.challengeId);
      this.#rateLimiters.failedAuth.consume(`host-tunnel:${authInput.hostId}`);
      return null;
    }

    const verified = verifySignature(
      null,
      Buffer.from(
        buildRelayHostTunnelChallengeMessage({
          relayUrl: authInput.relayUrl ?? this.config.publicUrl.origin,
          hostId: authInput.hostId,
          hostKeyId: authInput.hostKeyId,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
        }),
        "utf8",
      ),
      host.hostPublicKeyPem,
      Buffer.from(authInput.challengeSignature, "base64url"),
    );
    this.#pendingHostTunnelChallengesById.delete(authInput.challengeId);
    if (!verified) {
      this.#rateLimiters.failedAuth.consume(`host-tunnel:${authInput.hostId}`);
      return null;
    }

    this.#attachHostConnection(authInput.hostId, socket, connectionId);
    return authInput.hostId;
  }

  flushMetadataInBackground(): void {
    void this.repository.flush().catch(() => {
      // The next critical mutation or server shutdown will surface persistence failures.
    });
  }
}

export function createRelayRuntime(options: RelayRuntimeOptions = {}): RelayRuntime {
  return new RelayRuntime(options);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

function hasActiveStepUp(session: { readonly stepUpExpiresAt?: string }): boolean {
  if (!session.stepUpExpiresAt) {
    return false;
  }
  return Date.parse(session.stepUpExpiresAt) > Date.now();
}

function oneYearFromNow(): string {
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data as Buffer;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data) as Buffer;
  }
  return Buffer.from(data) as Buffer;
}

function rawDataToUtf8(data: RawData): string {
  return rawDataToBuffer(data).toString("utf8");
}
