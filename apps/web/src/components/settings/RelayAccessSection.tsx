import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRoundIcon, LogOutIcon, PlusIcon, RotateCcwIcon, ShieldCheckIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import {
  listRelayDevices,
  registerRelayPasskey,
  listRelayHosts,
  logoutRelaySession,
  revokeRelayDevice,
  revokeRelayHost,
  restoreRelaySession,
  signInRelayWithPasskey,
  startRelayLogin,
  stepUpRelayPasskey,
  verifyRelayLogin,
  type RelayDeviceListItem,
  type RelayHostListItem,
  type RelaySessionSnapshot,
} from "../../environments/relay/api";
import {
  addRelaySavedEnvironment,
  removeSavedEnvironment,
  useSavedEnvironmentRegistryStore,
} from "../../environments/runtime";
import { useEnvironmentHostConnectionStatusStore } from "../../environments/runtime";
import { toastManager } from "../ui/toast";
import { resolveRelayHostPickerEntry } from "../../environments/relay/dashboard.logic";

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function getRelayBaseUrl(): string {
  return window.location.origin;
}

function relaySessionLabel(session: RelaySessionSnapshot | null): string {
  if (!session?.authenticated) {
    return "Not signed in";
  }
  return session.user?.email ?? "Signed in";
}

function hasActiveStepUp(session: RelaySessionSnapshot | null): boolean {
  if (!session?.stepUpExpiresAt) {
    return false;
  }
  return Date.parse(session.stepUpExpiresAt) > Date.now();
}

function passkeyStatusLabel(session: RelaySessionSnapshot | null): string {
  if (!session?.authenticated) {
    return "Email code or passkey";
  }
  if (session.deviceTrustState !== "trusted") {
    return "This device is not trusted yet";
  }
  if (!hasActiveStepUp(session)) {
    return "Read-first access active";
  }
  return "Write step-up active";
}

export function RelayAccessSection() {
  const [session, setSession] = useState<RelaySessionSnapshot | null>(null);
  const [hosts, setHosts] = useState<ReadonlyArray<RelayHostListItem>>([]);
  const [devices, setDevices] = useState<ReadonlyArray<RelayDeviceListItem>>([]);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingHosts, setIsLoadingHosts] = useState(false);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [loginHint, setLoginHint] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loadingActionKey, setLoadingActionKey] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isPasskeyAction, setIsPasskeyAction] = useState(false);

  const relayBaseUrl = useMemo(() => getRelayBaseUrl(), []);
  const shouldAutoRestore = useMemo(() => !isLoopbackHostname(window.location.hostname), []);
  const hostRegistry = useSavedEnvironmentRegistryStore((state) => state.byId);
  const hostRuntimeById = useEnvironmentHostConnectionStatusStore((state) => state.byId);

  const loadHosts = useCallback(async () => {
    setIsLoadingHosts(true);
    try {
      const nextHosts = await listRelayHosts({ relayBaseUrl });
      setHosts(nextHosts);
      return nextHosts;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load relay hosts.";
      setLoginError(message);
      return [];
    } finally {
      setIsLoadingHosts(false);
    }
  }, [relayBaseUrl]);

  const loadDevices = useCallback(async () => {
    setIsLoadingDevices(true);
    try {
      const nextDevices = await listRelayDevices({ relayBaseUrl });
      setDevices(nextDevices);
      return nextDevices;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load relay devices.";
      setLoginError(message);
      return [];
    } finally {
      setIsLoadingDevices(false);
    }
  }, [relayBaseUrl]);

  const restoreSession = useCallback(async () => {
    setIsLoadingSession(true);
    setLoginError(null);
    try {
      const nextSession = await restoreRelaySession({ relayBaseUrl });
      setSession(nextSession);
      if (nextSession.authenticated) {
        await Promise.all([loadHosts(), loadDevices()]);
      } else {
        setHosts([]);
        setDevices([]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to restore relay session.";
      setLoginError(message);
    } finally {
      setIsLoadingSession(false);
    }
  }, [loadDevices, loadHosts, relayBaseUrl]);

  useEffect(() => {
    if (!shouldAutoRestore) {
      return;
    }
    void restoreSession();
  }, [restoreSession, shouldAutoRestore]);

  const handleStartLogin = useCallback(async () => {
    setIsLoadingSession(true);
    setLoginError(null);
    try {
      const response = await startRelayLogin({
        relayBaseUrl,
        email: loginEmail,
      });
      setChallengeId(response.challengeId);
      setLoginHint(response.deliveryHint);
      setLoginError(null);
      toastManager.add({
        type: "success",
        title: "Code sent",
        description: response.deliveryHint ?? "Check your email for the verification code.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start relay login.";
      setLoginError(message);
    } finally {
      setIsLoadingSession(false);
    }
  }, [loginEmail, relayBaseUrl]);

  const handleVerifyLogin = useCallback(async () => {
    setIsLoadingSession(true);
    setLoginError(null);
    try {
      const nextSession = await verifyRelayLogin({
        relayBaseUrl,
        email: loginEmail,
        code: loginCode,
        challengeId,
      });
      setSession(nextSession);
      setChallengeId(null);
      setLoginCode("");
      await loadHosts();
      await loadDevices();
      toastManager.add({
        type: "success",
        title: "Signed in",
        description: nextSession.user?.email ?? "Relay session restored.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to verify relay login.";
      setLoginError(message);
    } finally {
      setIsLoadingSession(false);
    }
  }, [challengeId, loadDevices, loadHosts, loginCode, loginEmail, relayBaseUrl]);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    setLoginError(null);
    try {
      await logoutRelaySession({ relayBaseUrl });
      setSession({ authenticated: false, user: null, expiresAt: null });
      setHosts([]);
      setDevices([]);
      setChallengeId(null);
      setLoginCode("");
      toastManager.add({
        type: "success",
        title: "Signed out",
        description: "Relay session cleared.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to log out.";
      setLoginError(message);
    } finally {
      setIsLoggingOut(false);
    }
  }, [relayBaseUrl]);

  const handleRegisterPasskey = useCallback(async () => {
    setIsPasskeyAction(true);
    setLoginError(null);
    try {
      await registerRelayPasskey({ relayBaseUrl });
      const nextSession = await restoreRelaySession({ relayBaseUrl });
      setSession(nextSession);
      toastManager.add({
        type: "success",
        title: "Face ID ready",
        description: "This device can now use a passkey for relay access.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to register passkey.";
      setLoginError(message);
    } finally {
      setIsPasskeyAction(false);
    }
  }, [relayBaseUrl]);

  const handlePasskeyLogin = useCallback(async () => {
    setIsPasskeyAction(true);
    setLoginError(null);
    try {
      const nextSession = await signInRelayWithPasskey({
        relayBaseUrl,
        email: loginEmail,
      });
      setSession(nextSession);
      setChallengeId(null);
      setLoginCode("");
      await Promise.all([loadHosts(), loadDevices()]);
      toastManager.add({
        type: "success",
        title: "Signed in with Face ID",
        description: nextSession.user?.email ?? "Relay session restored.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sign in with passkey.";
      setLoginError(message);
    } finally {
      setIsPasskeyAction(false);
    }
  }, [loadDevices, loadHosts, loginEmail, relayBaseUrl]);

  const handleStepUp = useCallback(async () => {
    setIsPasskeyAction(true);
    setLoginError(null);
    try {
      const nextSession = await stepUpRelayPasskey({ relayBaseUrl });
      setSession(nextSession);
      toastManager.add({
        type: "success",
        title: "Write access refreshed",
        description: "Mutating relay actions are unlocked on this device for a short time.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to refresh write access.";
      setLoginError(message);
    } finally {
      setIsPasskeyAction(false);
    }
  }, [relayBaseUrl]);

  const handleConnectHost = useCallback(
    async (host: RelayHostListItem) => {
      setLoadingActionKey(`host:add:${host.hostId}`);
      setLoginError(null);
      try {
        const record = await addRelaySavedEnvironment({
          host,
          relayBaseUrl,
        });
        toastManager.add({
          type: "success",
          title: "Host added",
          description: `${record.label} is ready on this device.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to add host.";
        setLoginError(message);
      } finally {
        setLoadingActionKey(null);
      }
    },
    [relayBaseUrl],
  );

  const handleRevokeHost = useCallback(
    async (host: RelayHostListItem) => {
      setLoadingActionKey(`host:revoke:${host.hostId}`);
      setLoginError(null);
      try {
        await revokeRelayHost({
          relayBaseUrl,
          hostId: host.hostId,
        });
        const existingRecord = hostRegistry[host.environmentId] ?? null;
        if (existingRecord) {
          await removeSavedEnvironment(existingRecord.environmentId);
        }
        await loadHosts();
        toastManager.add({
          type: "success",
          title: "Host revoked",
          description: `${host.label} is no longer available through this relay account.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to revoke host.";
        setLoginError(message);
      } finally {
        setLoadingActionKey(null);
      }
    },
    [hostRegistry, loadHosts, relayBaseUrl],
  );

  const handleRevokeDevice = useCallback(
    async (device: RelayDeviceListItem) => {
      setLoadingActionKey(`device:revoke:${device.deviceId}`);
      setLoginError(null);
      try {
        const result = await revokeRelayDevice({
          relayBaseUrl,
          deviceId: device.deviceId,
        });
        if (result.currentSessionRevoked) {
          setSession({ authenticated: false, user: null, expiresAt: null });
          setHosts([]);
          setDevices([]);
          setChallengeId(null);
          setLoginCode("");
          toastManager.add({
            type: "success",
            title: "Device revoked",
            description: "This browser session has been signed out.",
          });
          return;
        }
        await loadDevices();
        toastManager.add({
          type: "success",
          title: "Device revoked",
          description: device.label ?? "The selected device no longer has relay access.",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to revoke device.";
        setLoginError(message);
      } finally {
        setLoadingActionKey(null);
      }
    },
    [loadDevices, relayBaseUrl],
  );

  const hostEntries = useMemo(
    () =>
      hosts.map((host) =>
        resolveRelayHostPickerEntry({
          host,
          hostConnectionState: hostRuntimeById[host.environmentId] ?? null,
          relayBaseUrl,
          sessionAuthenticated: session?.authenticated ?? false,
        }),
      ),
    [hostRuntimeById, hosts, relayBaseUrl, session?.authenticated],
  );

  return (
    <SettingsSection
      title="Relay access"
      headerAction={
        <Button
          size="xs"
          variant="outline"
          onClick={() => void restoreSession()}
          disabled={isLoadingSession}
        >
          <RotateCcwIcon className="size-3" />
          {isLoadingSession ? "Restoring…" : "Restore session"}
        </Button>
      }
    >
      <SettingsRow
        title="Session"
        description="Use the relay account session on this browser."
        status={session?.authenticated ? relaySessionLabel(session) : "Not signed in"}
        control={
          session?.authenticated ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleLogout()}
              disabled={isLoggingOut}
            >
              <LogOutIcon className="size-3" />
              {isLoggingOut ? "Signing out…" : "Sign out"}
            </Button>
          ) : null
        }
      >
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-foreground">Email</span>
            <Input
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="name@example.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={isLoadingSession || session?.authenticated === true}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-foreground">Code</span>
            <Input
              value={loginCode}
              onChange={(event) => setLoginCode(event.target.value)}
              placeholder="123456"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={isLoadingSession || session?.authenticated === true || challengeId === null}
            />
          </label>
        </div>
        {loginHint ? <p className="mt-2 text-xs text-muted-foreground">{loginHint}</p> : null}
        <p className="mt-2 text-xs text-muted-foreground">{passkeyStatusLabel(session)}</p>
        {session?.authenticated && !hasActiveStepUp(session) ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Unlock write access before revoking hosts or devices.
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => void handleStartLogin()}
            disabled={
              isLoadingSession ||
              isPasskeyAction ||
              session?.authenticated === true ||
              loginEmail.trim() === ""
            }
          >
            <ShieldCheckIcon className="size-3" />
            Send code
          </Button>
          {!session?.authenticated ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handlePasskeyLogin()}
              disabled={isLoadingSession || isPasskeyAction || loginEmail.trim() === ""}
            >
              <KeyRoundIcon className="size-3" />
              {isPasskeyAction ? "Waiting for Face ID…" : "Sign in with Face ID"}
            </Button>
          ) : null}
          <Button
            size="xs"
            onClick={() => void handleVerifyLogin()}
            disabled={
              isLoadingSession ||
              isPasskeyAction ||
              session?.authenticated === true ||
              challengeId === null ||
              loginCode.trim() === ""
            }
          >
            <PlusIcon className="size-3" />
            Verify code
          </Button>
          {session?.authenticated && session.deviceTrustState !== "trusted" ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleRegisterPasskey()}
              disabled={isLoadingSession || isPasskeyAction}
            >
              <KeyRoundIcon className="size-3" />
              {isPasskeyAction ? "Waiting for Face ID…" : "Set up Face ID"}
            </Button>
          ) : null}
          {session?.authenticated && session.deviceTrustState === "trusted" ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleStepUp()}
              disabled={isLoadingSession || isPasskeyAction || hasActiveStepUp(session)}
            >
              <ShieldCheckIcon className="size-3" />
              {hasActiveStepUp(session)
                ? "Write access active"
                : isPasskeyAction
                  ? "Waiting for Face ID…"
                  : "Unlock write access"}
            </Button>
          ) : null}
        </div>
      </SettingsRow>

      <SettingsRow
        title="Hosts"
        description="Pick a host from the relay and add it to this device."
        status={
          session?.authenticated
            ? isLoadingHosts
              ? "Loading…"
              : `${hostEntries.length} available`
            : "Sign in first"
        }
      >
        {loginError ? <p className="mt-2 text-xs text-destructive">{loginError}</p> : null}
        {session?.authenticated ? (
          <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
            {hostEntries.map((entry) => {
              const host = hosts.find((candidate) => candidate.hostId === entry.hostId) ?? null;
              const existingRecord = hostRegistry[entry.environmentId] ?? null;
              return (
                <div
                  key={entry.hostId}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{entry.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {existingRecord ? "Already saved here" : entry.status.detail}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {entry.status.label}
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={
                        loadingActionKey === `host:add:${entry.hostId}` || Boolean(existingRecord)
                      }
                      onClick={() => {
                        if (!host) {
                          return;
                        }
                        void handleConnectHost(host);
                      }}
                    >
                      {loadingActionKey === `host:add:${entry.hostId}`
                        ? "Adding…"
                        : existingRecord
                          ? "Saved"
                          : "Add host"}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={
                        !hasActiveStepUp(session) ||
                        loadingActionKey === `host:revoke:${entry.hostId}` ||
                        !host
                      }
                      onClick={() => {
                        if (!host) {
                          return;
                        }
                        void handleRevokeHost(host);
                      }}
                    >
                      {loadingActionKey === `host:revoke:${entry.hostId}` ? "Revoking…" : "Revoke"}
                    </Button>
                  </div>
                </div>
              );
            })}
            {!isLoadingHosts && hostEntries.length === 0 ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">No hosts available.</div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-border/60 px-4 py-3 text-xs text-muted-foreground">
            Restore a relay session to see hosts.
          </div>
        )}
      </SettingsRow>

      <SettingsRow
        title="Devices"
        description="Review which browsers and phones can reach this relay account."
        status={
          session?.authenticated
            ? isLoadingDevices
              ? "Loading…"
              : `${devices.length} known`
            : "Sign in first"
        }
      >
        {session?.authenticated ? (
          <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
            {devices.map((device) => (
              <div
                key={device.deviceId}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {device.label ?? "Unnamed device"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {device.isCurrent ? "Current browser" : "Saved relay device"} ·{" "}
                    {device.trustState}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                    {device.status}
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={
                      device.status === "revoked" ||
                      !hasActiveStepUp(session) ||
                      loadingActionKey === `device:revoke:${device.deviceId}`
                    }
                    onClick={() => void handleRevokeDevice(device)}
                  >
                    {loadingActionKey === `device:revoke:${device.deviceId}`
                      ? "Revoking…"
                      : device.isCurrent
                        ? "Revoke this browser"
                        : "Revoke"}
                  </Button>
                </div>
              </div>
            ))}
            {!isLoadingDevices && devices.length === 0 ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">No devices found.</div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-border/60 px-4 py-3 text-xs text-muted-foreground">
            Restore a relay session to review devices.
          </div>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
