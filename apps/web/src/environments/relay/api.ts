import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

import type { AuthSessionRole, EnvironmentId } from "@wobex/contracts";

export type RelayHostConnectionStatus =
  | "offline"
  | "online"
  | "reconnecting"
  | "recovered"
  | "replaying";

export interface RelaySessionUser {
  readonly userId: string;
  readonly email: string;
  readonly label?: string | null;
}

export interface RelaySessionSnapshot {
  readonly authenticated: boolean;
  readonly user: RelaySessionUser | null;
  readonly expiresAt: string | null;
  readonly role?: AuthSessionRole | null;
  readonly authMethod?: "email-recovery" | "passkey" | null;
  readonly deviceTrustState?: "trusted" | "recovery" | "revoked" | null;
  readonly stepUpExpiresAt?: string | null;
}

export interface RelayLoginStartResult {
  readonly challengeId: string;
  readonly expiresAt: string;
  readonly deliveryHint: string | null;
}

export interface RelayLoginVerifyResult extends RelaySessionSnapshot {}

export interface RelayHostBootstrapResult {
  readonly authenticated: true;
  readonly sessionToken: string;
  readonly session: {
    readonly sessionId: string;
    readonly subject: string;
    readonly role: AuthSessionRole;
    readonly capabilities: ReadonlyArray<string>;
    readonly expiresAt: string;
  };
}

export interface RelayHostListItem {
  readonly hostId: string;
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: RelayHostConnectionStatus;
  readonly statusReason: string | null;
  readonly lastSeenAt: string | null;
  readonly hostStatusUpdatedAt: string | null;
}

export interface RelayDeviceListItem {
  readonly deviceId: string;
  readonly label: string | null;
  readonly status: "active" | "revoked";
  readonly trustState: "trusted" | "recovery" | "revoked";
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly trustedAt: string | null;
  readonly isCurrent: boolean;
}

export interface RelayRevokeDeviceResult {
  readonly deviceId: string;
  readonly currentSessionRevoked: boolean;
}

interface RelayRequestInput {
  readonly relayBaseUrl: string | undefined;
  readonly pathname: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
}

interface RelayRawSessionEnvelope {
  readonly user?: {
    readonly id?: string;
    readonly email?: string;
  } | null;
  readonly device?: {
    readonly id?: string;
    readonly label?: string | null;
    readonly trustState?: RelaySessionSnapshot["deviceTrustState"];
  } | null;
  readonly session?: {
    readonly id?: string;
    readonly authMethod?: RelaySessionSnapshot["authMethod"];
    readonly expiresAt?: string | null;
    readonly stepUpExpiresAt?: string | null;
  } | null;
  readonly csrfToken?: string | null;
}

interface RelayRawHostListEnvelope {
  readonly hosts?: ReadonlyArray<{
    readonly id?: string;
    readonly environmentId?: string;
    readonly label?: string;
    readonly status?: RelayHostConnectionStatus;
    readonly statusReason?: string | null;
    readonly lastSeenAt?: string | null;
    readonly hostStatusUpdatedAt?: string | null;
  }>;
}

interface RelayRawDeviceListEnvelope {
  readonly currentDeviceId?: string;
  readonly devices?: ReadonlyArray<{
    readonly id?: string;
    readonly label?: string | null;
    readonly status?: "active" | "revoked";
    readonly trustState?: "trusted" | "recovery" | "revoked";
    readonly createdAt?: string;
    readonly lastSeenAt?: string;
    readonly trustedAt?: string | null;
  }>;
}

interface RelayPasskeyStartResult {
  readonly challengeId: string;
  readonly purpose?: "login" | "step-up";
  readonly options: unknown;
}

const relayCsrfByOrigin = new Map<string, string>();
type BrowserRegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type BrowserAuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

function resolveRelayBaseUrl(relayBaseUrl: string | undefined): URL {
  const defaultOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(relayBaseUrl?.trim() || defaultOrigin, defaultOrigin);
  url.search = "";
  url.hash = "";
  return url;
}

function relayEndpointUrl(relayBaseUrl: string | undefined, pathname: string): string {
  const baseUrl = resolveRelayBaseUrl(relayBaseUrl);
  return new URL(pathname, baseUrl).toString();
}

function relayOrigin(relayBaseUrl: string | undefined): string {
  return resolveRelayBaseUrl(relayBaseUrl).origin;
}

async function readRelayErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  if (!text) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(text) as { readonly error?: string };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    // Fall through to raw text.
  }

  return text;
}

function cacheRelayCsrf(
  relayBaseUrl: string | undefined,
  csrfToken: string | null | undefined,
): void {
  if (!csrfToken) {
    return;
  }
  relayCsrfByOrigin.set(relayOrigin(relayBaseUrl), csrfToken);
}

function clearRelayCsrf(relayBaseUrl: string | undefined): void {
  relayCsrfByOrigin.delete(relayOrigin(relayBaseUrl));
}

function cacheRelayCsrfFromBody(relayBaseUrl: string | undefined, body: unknown): void {
  if (!body || typeof body !== "object" || !("csrfToken" in body)) {
    return;
  }
  const csrfToken = (body as { readonly csrfToken?: string | null }).csrfToken;
  cacheRelayCsrf(relayBaseUrl, csrfToken);
}

async function fetchRelayCsrf(input?: {
  readonly relayBaseUrl?: string;
  readonly force?: boolean;
}): Promise<string> {
  const origin = relayOrigin(input?.relayBaseUrl);
  if (!input?.force) {
    const cached = relayCsrfByOrigin.get(origin);
    if (cached) {
      return cached;
    }
  }

  const requestUrl = relayEndpointUrl(input?.relayBaseUrl, "/api/auth/csrf");
  const response = await fetch(requestUrl, {
    method: "GET",
    headers: {},
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(
      await readRelayErrorMessage(response, `Relay request failed (${response.status}).`),
    );
  }

  const body = (await response.json()) as { readonly csrfToken?: string };
  if (!body.csrfToken) {
    throw new Error("Relay did not return a CSRF token.");
  }
  cacheRelayCsrf(input?.relayBaseUrl, body.csrfToken);
  return body.csrfToken;
}

function normalizeRelaySessionEnvelope(
  envelope: RelayRawSessionEnvelope | RelaySessionSnapshot,
): RelaySessionSnapshot {
  if ("authenticated" in envelope) {
    return envelope;
  }
  const userId = envelope.user?.id?.trim();
  const email = envelope.user?.email?.trim();
  const expiresAt = envelope.session?.expiresAt?.trim() || null;
  if (!userId || !email || !expiresAt) {
    return {
      authenticated: false,
      user: null,
      expiresAt: null,
      role: null,
      authMethod: null,
      deviceTrustState: null,
      stepUpExpiresAt: null,
    };
  }
  return {
    authenticated: true,
    user: {
      userId,
      email,
      label: envelope.device?.label?.trim() || null,
    },
    expiresAt,
    role: "client",
    authMethod: envelope.session?.authMethod ?? null,
    deviceTrustState: envelope.device?.trustState ?? null,
    stepUpExpiresAt: envelope.session?.stepUpExpiresAt ?? null,
  };
}

async function fetchRelayJson<T>(input: RelayRequestInput): Promise<T> {
  const requestUrl = relayEndpointUrl(input.relayBaseUrl, input.pathname);
  const method = input.method ?? "GET";
  const requestOnce = async (csrfToken?: string): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (input.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (method !== "GET" && csrfToken) {
      headers["x-relay-csrf"] = csrfToken;
    }
    return fetch(requestUrl, {
      method,
      headers,
      credentials: "include",
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
  };

  let response: Response;
  try {
    const csrfToken =
      method !== "GET"
        ? await fetchRelayCsrf(
            input.relayBaseUrl ? { relayBaseUrl: input.relayBaseUrl } : undefined,
          )
        : undefined;
    response = await requestOnce(csrfToken);
    if (response.status === 403 && method !== "GET") {
      clearRelayCsrf(input.relayBaseUrl);
      response = await requestOnce(
        await fetchRelayCsrf(
          input.relayBaseUrl ? { relayBaseUrl: input.relayBaseUrl, force: true } : { force: true },
        ),
      );
    }
  } catch (error) {
    throw new Error(`Failed to fetch relay endpoint ${requestUrl} (${(error as Error).message}).`, {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new Error(
      await readRelayErrorMessage(response, `Relay request failed (${response.status}).`),
    );
  }

  const body = (await response.json()) as T;
  cacheRelayCsrfFromBody(input.relayBaseUrl, body);
  return body;
}

async function fetchRelayVoid(input: RelayRequestInput): Promise<void> {
  const requestUrl = relayEndpointUrl(input.relayBaseUrl, input.pathname);
  const method = input.method ?? "GET";
  const requestOnce = async (csrfToken?: string): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (input.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (method !== "GET" && csrfToken) {
      headers["x-relay-csrf"] = csrfToken;
    }
    return fetch(requestUrl, {
      method,
      headers,
      credentials: "include",
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
  };

  let response: Response;
  try {
    const csrfToken =
      method !== "GET"
        ? await fetchRelayCsrf(
            input.relayBaseUrl ? { relayBaseUrl: input.relayBaseUrl } : undefined,
          )
        : undefined;
    response = await requestOnce(csrfToken);
    if (response.status === 403 && method !== "GET") {
      clearRelayCsrf(input.relayBaseUrl);
      response = await requestOnce(
        await fetchRelayCsrf(
          input.relayBaseUrl ? { relayBaseUrl: input.relayBaseUrl, force: true } : { force: true },
        ),
      );
    }
  } catch (error) {
    throw new Error(`Failed to fetch relay endpoint ${requestUrl} (${(error as Error).message}).`, {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new Error(
      await readRelayErrorMessage(response, `Relay request failed (${response.status}).`),
    );
  }
}

export async function startRelayLogin(input: {
  readonly email: string;
  readonly relayBaseUrl?: string;
}): Promise<RelayLoginStartResult> {
  return fetchRelayJson<RelayLoginStartResult>({
    relayBaseUrl: input.relayBaseUrl,
    pathname: "/api/auth/login/start",
    method: "POST",
    body: { email: input.email },
  });
}

export async function verifyRelayLogin(input: {
  readonly email: string;
  readonly code: string;
  readonly challengeId?: string | null;
  readonly relayBaseUrl?: string;
}): Promise<RelayLoginVerifyResult> {
  const envelope = await fetchRelayJson<RelayRawSessionEnvelope>({
    relayBaseUrl: input.relayBaseUrl,
    pathname: "/api/auth/login/verify",
    method: "POST",
    body: {
      email: input.email,
      code: input.code,
      ...(input.challengeId ? { challengeId: input.challengeId } : {}),
    },
  });
  return normalizeRelaySessionEnvelope(envelope);
}

export async function restoreRelaySession(input?: {
  readonly relayBaseUrl?: string;
}): Promise<RelaySessionSnapshot> {
  const requestUrl = relayEndpointUrl(input?.relayBaseUrl, "/api/me");
  const response = await fetch(requestUrl, {
    method: "GET",
    headers: {},
    credentials: "include",
  });
  if (response.status === 401) {
    clearRelayCsrf(input?.relayBaseUrl);
    return {
      authenticated: false,
      user: null,
      expiresAt: null,
      role: null,
      authMethod: null,
      deviceTrustState: null,
      stepUpExpiresAt: null,
    };
  }
  if (!response.ok) {
    throw new Error(
      await readRelayErrorMessage(response, `Relay request failed (${response.status}).`),
    );
  }
  const envelope = (await response.json()) as RelayRawSessionEnvelope;
  cacheRelayCsrfFromBody(input?.relayBaseUrl, envelope);
  return normalizeRelaySessionEnvelope(envelope);
}

export const fetchRelaySessionSnapshot = restoreRelaySession;

export async function logoutRelaySession(input?: {
  readonly relayBaseUrl?: string;
}): Promise<void> {
  await fetchRelayVoid({
    relayBaseUrl: input?.relayBaseUrl,
    pathname: "/api/auth/logout",
    method: "POST",
  });
  clearRelayCsrf(input?.relayBaseUrl);
}

export async function registerRelayPasskey(input?: {
  readonly relayBaseUrl?: string;
}): Promise<void> {
  const started = await fetchRelayJson<RelayPasskeyStartResult>({
    relayBaseUrl: input?.relayBaseUrl,
    pathname: "/api/auth/passkeys/register/start",
    method: "POST",
  });
  const response = await startRegistration({
    optionsJSON: started.options as BrowserRegistrationOptions,
  });
  await fetchRelayVoid({
    relayBaseUrl: input?.relayBaseUrl,
    pathname: "/api/auth/passkeys/register/finish",
    method: "POST",
    body: {
      challengeId: started.challengeId,
      response,
    },
  });
}

export async function signInRelayWithPasskey(input: {
  readonly email: string;
  readonly relayBaseUrl?: string;
}): Promise<RelaySessionSnapshot> {
  const started = await fetchRelayJson<RelayPasskeyStartResult>({
    relayBaseUrl: input.relayBaseUrl,
    pathname: "/api/auth/passkeys/auth/start",
    method: "POST",
    body: {
      email: input.email,
    },
  });
  const response = await startAuthentication({
    optionsJSON: started.options as BrowserAuthenticationOptions,
  });
  const envelope = await fetchRelayJson<RelayRawSessionEnvelope>({
    relayBaseUrl: input.relayBaseUrl,
    pathname: "/api/auth/passkeys/auth/finish",
    method: "POST",
    body: {
      challengeId: started.challengeId,
      response,
    },
  });
  return normalizeRelaySessionEnvelope(envelope);
}

export async function stepUpRelayPasskey(input?: {
  readonly relayBaseUrl?: string;
}): Promise<RelaySessionSnapshot> {
  const started = await fetchRelayJson<RelayPasskeyStartResult>({
    relayBaseUrl: input?.relayBaseUrl,
    pathname: "/api/auth/passkeys/step-up/start",
    method: "POST",
  });
  const response = await startAuthentication({
    optionsJSON: started.options as BrowserAuthenticationOptions,
  });
  const envelope = await fetchRelayJson<RelayRawSessionEnvelope>({
    relayBaseUrl: input?.relayBaseUrl,
    pathname: "/api/auth/passkeys/step-up/finish",
    method: "POST",
    body: {
      challengeId: started.challengeId,
      response,
    },
  });
  return normalizeRelaySessionEnvelope(envelope);
}

export async function listRelayHosts(input?: {
  readonly relayBaseUrl?: string;
}): Promise<ReadonlyArray<RelayHostListItem>> {
  const envelope = await fetchRelayJson<RelayRawHostListEnvelope>({
    relayBaseUrl: input?.relayBaseUrl,
    pathname: "/api/hosts",
  });
  return (envelope.hosts ?? []).flatMap((host) => {
    const hostId = host.id?.trim();
    const environmentId = host.environmentId?.trim() as EnvironmentId | undefined;
    const label = host.label?.trim();
    if (!hostId || !environmentId || !label) {
      return [];
    }
    return [
      {
        hostId,
        environmentId,
        label,
        status: host.status ?? "offline",
        statusReason: host.statusReason ?? null,
        lastSeenAt: host.lastSeenAt ?? null,
        hostStatusUpdatedAt: host.hostStatusUpdatedAt ?? null,
      } satisfies RelayHostListItem,
    ];
  });
}

export async function fetchRelayHostStatus(input: {
  readonly hostId: string;
  readonly relayBaseUrl?: string;
}): Promise<RelayHostListItem> {
  const hostId = input.hostId.trim();
  if (!hostId) {
    throw new Error("Enter a host id.");
  }

  return fetchRelayJson<RelayHostListItem>({
    relayBaseUrl: input.relayBaseUrl,
    pathname: `/api/hosts/${encodeURIComponent(hostId)}/status`,
  });
}

export async function listRelayDevices(input?: {
  readonly relayBaseUrl?: string;
}): Promise<ReadonlyArray<RelayDeviceListItem>> {
  const envelope = await fetchRelayJson<RelayRawDeviceListEnvelope>({
    relayBaseUrl: input?.relayBaseUrl,
    pathname: "/api/devices",
  });
  const currentDeviceId = envelope.currentDeviceId?.trim() ?? "";
  return (envelope.devices ?? []).flatMap((device) => {
    const deviceId = device.id?.trim();
    const createdAt = device.createdAt?.trim();
    const lastSeenAt = device.lastSeenAt?.trim();
    if (!deviceId || !createdAt || !lastSeenAt || !device.status || !device.trustState) {
      return [];
    }
    return [
      {
        deviceId,
        label: device.label?.trim() || null,
        status: device.status,
        trustState: device.trustState,
        createdAt,
        lastSeenAt,
        trustedAt: device.trustedAt?.trim() || null,
        isCurrent: deviceId === currentDeviceId,
      } satisfies RelayDeviceListItem,
    ];
  });
}

export async function revokeRelayDevice(input: {
  readonly deviceId: string;
  readonly relayBaseUrl?: string;
}): Promise<RelayRevokeDeviceResult> {
  const deviceId = input.deviceId.trim();
  if (!deviceId) {
    throw new Error("Enter a device id.");
  }
  const response = await fetchRelayJson<{
    readonly device?: { readonly id?: string };
    readonly currentSessionRevoked?: boolean;
  }>({
    relayBaseUrl: input.relayBaseUrl,
    pathname: `/api/devices/${encodeURIComponent(deviceId)}/revoke`,
    method: "POST",
  });
  return {
    deviceId: response.device?.id?.trim() || deviceId,
    currentSessionRevoked: response.currentSessionRevoked === true,
  };
}

export async function revokeRelayHost(input: {
  readonly hostId: string;
  readonly relayBaseUrl?: string;
}): Promise<void> {
  const hostId = input.hostId.trim();
  if (!hostId) {
    throw new Error("Enter a host id.");
  }
  await fetchRelayVoid({
    relayBaseUrl: input.relayBaseUrl,
    pathname: `/api/hosts/${encodeURIComponent(hostId)}/revoke`,
    method: "POST",
  });
}

export async function bootstrapRelayHostSession(input: {
  readonly hostId: string;
  readonly relayBaseUrl?: string;
  readonly scope?: "read" | "write";
}): Promise<RelayHostBootstrapResult> {
  const hostId = input.hostId.trim();
  if (!hostId) {
    throw new Error("Enter a host id.");
  }

  return fetchRelayJson<RelayHostBootstrapResult>({
    relayBaseUrl: input.relayBaseUrl,
    pathname: `/api/hosts/${encodeURIComponent(hostId)}/bootstrap`,
    method: "POST",
    body: {
      scope: input.scope ?? "read",
    },
  });
}
