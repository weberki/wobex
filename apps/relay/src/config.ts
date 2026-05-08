export interface RelayServiceConfig {
  publicUrl: URL;
  host: string;
  port: number;
  databaseUrl?: string;
  sessionCookieSecret: string;
  signingKeyId: string;
  signingKey: string;
  allowedOrigins: readonly string[];
  emailFrom?: string;
  emailReplyTo?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  webStaticDir?: string;
  debugAuthCodes: boolean;
  requestBodyLimitBytes: number;
  proxyTimeoutMs: number;
  stepUpTtlMs: number;
}

export type RelayServiceConfigInput = Partial<
  Omit<RelayServiceConfig, "publicUrl" | "allowedOrigins"> & {
    publicUrl: URL | string;
    allowedOrigins: readonly string[];
  }
>;

export function loadRelayServiceConfig(env: NodeJS.ProcessEnv = process.env): RelayServiceConfig {
  const host = env.RELAY_HOST?.trim() || env.HOST?.trim() || "0.0.0.0";
  const port = parseNumber(env.RELAY_PORT ?? env.PORT ?? "8787", 8787);
  const publicUrl =
    env.RELAY_PUBLIC_URL?.trim() && env.RELAY_PUBLIC_URL.trim().length > 0
      ? new URL(env.RELAY_PUBLIC_URL.trim())
      : new URL(`http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`);

  const allowedOrigins = parseAllowedOrigins(env.RELAY_ALLOWED_ORIGINS, publicUrl);
  const sessionCookieSecret = env.RELAY_SESSION_COOKIE_SECRET?.trim() || "relay-dev-secret";

  const config: RelayServiceConfig = {
    publicUrl,
    host,
    port,
    sessionCookieSecret,
    signingKeyId: env.RELAY_SIGNING_KEY_ID?.trim() || "relay-signing-key",
    signingKey: env.RELAY_SIGNING_KEY?.trim() || sessionCookieSecret,
    allowedOrigins,
    debugAuthCodes: env.RELAY_DEBUG_AUTH_CODES !== "false",
    requestBodyLimitBytes: parseNumber(env.RELAY_MAX_BODY_BYTES ?? "1048576", 1_048_576),
    proxyTimeoutMs: parseNumber(env.RELAY_PROXY_TIMEOUT_MS ?? "15000", 15_000),
    stepUpTtlMs: parseNumber(env.RELAY_STEP_UP_TTL_MS ?? "300000", 300_000),
  };

  const databaseUrl = env.RELAY_DATABASE_URL?.trim();
  if (databaseUrl) {
    config.databaseUrl = databaseUrl;
  }
  const emailFrom = env.RELAY_EMAIL_FROM?.trim();
  if (emailFrom) {
    config.emailFrom = emailFrom;
  }
  const emailReplyTo = env.RELAY_EMAIL_REPLY_TO?.trim();
  if (emailReplyTo) {
    config.emailReplyTo = emailReplyTo;
  }
  const smtpHost = env.RELAY_SMTP_HOST?.trim();
  if (smtpHost) {
    config.smtpHost = smtpHost;
  }
  const smtpPort = env.RELAY_SMTP_PORT?.trim();
  if (smtpPort) {
    config.smtpPort = parseNumber(smtpPort, 587);
  }
  const smtpSecure = env.RELAY_SMTP_SECURE?.trim();
  if (smtpSecure) {
    config.smtpSecure = smtpSecure === "true";
  }
  const smtpUser = env.RELAY_SMTP_USER?.trim();
  if (smtpUser) {
    config.smtpUser = smtpUser;
  }
  const smtpPassword = env.RELAY_SMTP_PASSWORD?.trim();
  if (smtpPassword) {
    config.smtpPassword = smtpPassword;
  }
  const webStaticDir = env.RELAY_WEB_STATIC_DIR?.trim();
  if (webStaticDir) {
    config.webStaticDir = webStaticDir;
  }
  return config;
}

export function makeRelayServiceConfig(
  input: RelayServiceConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): RelayServiceConfig {
  const base = loadRelayServiceConfig(env);
  const config: RelayServiceConfig = {
    publicUrl:
      typeof input.publicUrl === "string"
        ? new URL(input.publicUrl)
        : (input.publicUrl ?? base.publicUrl),
    host: input.host ?? base.host,
    port: input.port ?? base.port,
    sessionCookieSecret: input.sessionCookieSecret ?? base.sessionCookieSecret,
    signingKeyId: input.signingKeyId ?? base.signingKeyId,
    signingKey: input.signingKey ?? base.signingKey,
    allowedOrigins: input.allowedOrigins ?? base.allowedOrigins,
    debugAuthCodes: input.debugAuthCodes ?? base.debugAuthCodes,
    requestBodyLimitBytes: input.requestBodyLimitBytes ?? base.requestBodyLimitBytes,
    proxyTimeoutMs: input.proxyTimeoutMs ?? base.proxyTimeoutMs,
    stepUpTtlMs: input.stepUpTtlMs ?? base.stepUpTtlMs,
  };
  if (input.databaseUrl !== undefined) {
    config.databaseUrl = input.databaseUrl;
  } else if (base.databaseUrl !== undefined) {
    config.databaseUrl = base.databaseUrl;
  }
  if (input.emailFrom !== undefined) {
    config.emailFrom = input.emailFrom;
  } else if (base.emailFrom !== undefined) {
    config.emailFrom = base.emailFrom;
  }
  if (input.emailReplyTo !== undefined) {
    config.emailReplyTo = input.emailReplyTo;
  } else if (base.emailReplyTo !== undefined) {
    config.emailReplyTo = base.emailReplyTo;
  }
  if (input.smtpHost !== undefined) {
    config.smtpHost = input.smtpHost;
  } else if (base.smtpHost !== undefined) {
    config.smtpHost = base.smtpHost;
  }
  if (input.smtpPort !== undefined) {
    config.smtpPort = input.smtpPort;
  } else if (base.smtpPort !== undefined) {
    config.smtpPort = base.smtpPort;
  }
  if (input.smtpSecure !== undefined) {
    config.smtpSecure = input.smtpSecure;
  } else if (base.smtpSecure !== undefined) {
    config.smtpSecure = base.smtpSecure;
  }
  if (input.smtpUser !== undefined) {
    config.smtpUser = input.smtpUser;
  } else if (base.smtpUser !== undefined) {
    config.smtpUser = base.smtpUser;
  }
  if (input.smtpPassword !== undefined) {
    config.smtpPassword = input.smtpPassword;
  } else if (base.smtpPassword !== undefined) {
    config.smtpPassword = base.smtpPassword;
  }
  if (input.webStaticDir !== undefined) {
    config.webStaticDir = input.webStaticDir;
  } else if (base.webStaticDir !== undefined) {
    config.webStaticDir = base.webStaticDir;
  }
  return config;
}

function parseNumber(value: string, fallback: number): number {
  const next = Number.parseInt(value, 10);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function parseAllowedOrigins(value: string | undefined, publicUrl: URL): readonly string[] {
  const list = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (list.length > 0) {
    return list;
  }

  const defaults = [publicUrl.origin];
  if (publicUrl.hostname === "localhost" || publicUrl.hostname === "127.0.0.1") {
    defaults.push(`http://${publicUrl.hostname}`);
  }
  return defaults;
}
