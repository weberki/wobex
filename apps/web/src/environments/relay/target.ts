export interface RelayEnvironmentTarget {
  readonly relayBaseUrl: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly hostId: string;
}

function normalizeRelayBaseUrl(relayBaseUrl: string | undefined): URL {
  const defaultOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const baseUrl = relayBaseUrl?.trim() || defaultOrigin;
  const url = new URL(baseUrl, defaultOrigin);
  url.search = "";
  url.hash = "";
  return url;
}

export function resolveRelayEnvironmentTarget(input: {
  readonly hostId: string;
  readonly relayBaseUrl: string | undefined;
}): RelayEnvironmentTarget {
  const hostId = input.hostId.trim();
  if (!hostId) {
    throw new Error("Enter a host id.");
  }

  const relayUrl = normalizeRelayBaseUrl(input.relayBaseUrl);
  relayUrl.pathname = `/h/${hostId}/`;

  const wsUrl = new URL(relayUrl.toString());
  if (wsUrl.protocol === "https:") {
    wsUrl.protocol = "wss:";
  } else if (wsUrl.protocol === "http:") {
    wsUrl.protocol = "ws:";
  }
  wsUrl.pathname = `/h/${hostId}/ws`;

  return {
    hostId,
    relayBaseUrl: normalizeRelayBaseUrl(input.relayBaseUrl).toString(),
    httpBaseUrl: relayUrl.toString(),
    wsBaseUrl: wsUrl.toString(),
  };
}

export function isRelayEnvironmentTarget(input: {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}): boolean {
  try {
    const httpUrl = new URL(input.httpBaseUrl);
    const wsUrl = new URL(input.wsBaseUrl);
    const protocolMatches =
      (httpUrl.protocol === "https:" && wsUrl.protocol === "wss:") ||
      (httpUrl.protocol === "http:" && wsUrl.protocol === "ws:");
    return (
      /^\/h\/[^/]+\/$/.test(httpUrl.pathname) &&
      /^\/h\/[^/]+\/ws$/.test(wsUrl.pathname) &&
      protocolMatches &&
      httpUrl.host === wsUrl.host
    );
  } catch {
    return false;
  }
}
