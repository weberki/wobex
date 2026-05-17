# Wobex Complete Implementation Roadmap Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for parallel execution, or `superpowers:executing-plans` for a single-worker pass. Steps use checkbox (`- [ ]`) syntax for tracking. Keep this file updated as work is completed.

**Goal:** Build the next complete Wobex product layer: Windows-first desktop reliability, stronger workspace UX, durable server runtime behavior, provider-neutral visibility, relay hardening, and release-grade verification.

**Architecture:** Keep Wobex local-first and provider-neutral. Implement the roadmap as small vertical slices across `apps/desktop`, `apps/web`, `apps/server`, `apps/relay`, `packages/contracts`, and `packages/shared`. Contracts move first when a slice crosses package boundaries. Server and desktop own host behavior. Web owns interaction and projection. Relay stays metadata-only and must never execute agents or persist prompts, diffs, files, provider chunks, terminal output, provider secrets, or host SQLite data.

**Tech Stack:** Bun monorepo, TypeScript, React 19, Vite 8, TanStack Router/Query, Zustand, Electron, Effect services, SQLite-backed local persistence, Vitest through `bun run test`, repo gates `bun fmt`, `bun lint`, and `bun typecheck`.

---

## Operating Rules

- [ ] Work on a branch or worktree dedicated to this roadmap. Use the `codex/` branch prefix unless the user specifies another prefix.
- [ ] Preserve existing dirty user changes. At plan creation time the worktree already had changes in `bun.lock`, `docs/superpowers/plans/2026-05-10-dpcode-ui-port.md`, and `output/`.
- [ ] Do not add an active `upstream` remote.
- [ ] Do not push, deploy, test production, or create public infrastructure unless the user explicitly asks.
- [ ] Do not run `bun test`. Always use `bun run test`.
- [ ] After code changes, run the relevant targeted tests plus the repo completion gate: `bun fmt`, `bun lint`, `bun typecheck`.
- [ ] If the relevant checks pass, create focused commits. Keep one commit per completed epic or per independently useful vertical slice.
- [ ] Keep `packages/contracts` schema-only. Put runtime helpers in `packages/shared` or package-local modules.
- [ ] Prefer explicit subpath exports in `packages/shared`; do not add broad barrel files.
- [ ] Keep provider-specific code behind provider adapters and normalized runtime events.
- [ ] Keep relay data metadata-only. Add tests before widening any relay payload shape.

## Team Plan

Use parallel workers only after the contracts and file ownership for each slice are clear. Workers are not alone in the codebase; each worker must avoid reverting edits from other workers and must adapt to concurrent changes.

- [ ] **Worker A, Desktop Windows reliability:** owns `apps/desktop/src/main.ts`, new desktop reliability modules, desktop smoke scripts, and desktop docs.
- [ ] **Worker B, Web workspace UX:** owns `apps/web/src/components/WorkspaceWindow.tsx`, workspace panel logic files, workspace tests, and client query wiring.
- [ ] **Worker C, Server runtime and contracts:** owns orchestration contracts, bounded snapshot/query APIs, queue durability, image job persistence, and server tests.
- [ ] **Worker D, Provider and terminal hardening:** owns provider capability/usage services, terminal privacy/retention settings, and provider health surfaces.
- [ ] **Worker E, Relay hardening:** owns `apps/relay`, relay contracts, relay tests, and relay operator docs.
- [ ] **Integrator:** owns cross-package merge order, final gates, release notes, and commit boundaries.

Recommended dependency order:

1. Contracts for a vertical slice.
2. Server or desktop implementation.
3. Web UI projection.
4. Targeted tests for the slice.
5. Integration pass.
6. Root gates.
7. Focused commit.

## Baseline Inventory

Current high-value code anchors:

- `apps/desktop/src/main.ts` already owns backend startup, restart scheduling, exposure IPC, safe storage checks, GPU fallback flagging, and backend readiness waiting.
- `apps/desktop/scripts/smoke-test.mjs` exists but should become a stricter packaged-app readiness check.
- `apps/web/src/environmentApi.ts` already exposes `git`, `imageGeneration`, and `devServers` client APIs.
- `apps/web/src/components/WorkspaceWindow.tsx` already owns workspace tabs for preview, terminal/browser/git/graph/image generation style panels.
- `apps/web/src/lib/gitReactQuery.ts` already has working-tree diff and summarize-diff query options.
- `apps/server/src/devServers/Layers/DevServerManager.ts` already has `start` and `stop`; Windows external inventory is currently unsupported.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` already has bounded snapshot/query behavior and counts.
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts` already tracks command states including `queued`, `in-flight`, and `abandoned`.
- `packages/contracts/src/orchestration.ts` currently lists provider kinds `codex`, `claudeAgent`, `opencode`, and `droid`.
- `packages/contracts/src/providerRuntime.ts` already contains usage snapshot event shapes.
- `apps/server/src/terminal/Layers/Manager.ts` already persists terminal history and has delete history behavior.
- `apps/relay/src/config.ts`, `apps/relay/src/runtime.ts`, `apps/relay/src/metadataStore.ts`, and `apps/relay/src/repository.ts` own relay config, runtime state, metadata enforcement, and persistence.

## Epic 1: Windows Desktop Reliability Pack

### 1.1 Process Tree Shutdown

**Purpose:** Ensure Wobex can stop backend and child provider processes cleanly on Windows, app close, restart, update, and smoke-test cleanup.

Files:

- `apps/desktop/src/main.ts`
- `apps/desktop/src/processTree.ts`
- `apps/desktop/src/processTree.test.ts`
- `apps/desktop/scripts/smoke-test.mjs`

Steps:

- [ ] Extract process-tree termination into `apps/desktop/src/processTree.ts`.
- [ ] On Windows, terminate by PID using a safe argument array for `taskkill /pid <pid> /t /f`.
- [ ] On non-Windows, terminate the process group when available and fall back to direct process kill.
- [ ] Return a structured result: attempted PID, platform path, exit code, stderr summary, and whether the process was already gone.
- [ ] Replace ad hoc backend child termination in `main.ts` with the new module.
- [ ] Extend desktop smoke cleanup to use the same module.
- [ ] Add tests for Windows command construction, already-exited processes, non-Windows fallback, and failure reporting.

Acceptance:

- [ ] Closing Wobex does not leave backend child processes alive in the normal path.
- [ ] Restarting the backend uses one termination path.
- [ ] Errors are logged with PID and platform path without leaking environment values.

Verification:

```powershell
bun run test apps/desktop/src/processTree.test.ts
bun run --cwd apps/desktop smoke-test
```

### 1.2 Backend Crash Loop Circuit Breaker

**Purpose:** Prevent endless restart loops and surface actionable recovery controls.

Files:

- `apps/desktop/src/main.ts`
- `apps/desktop/src/backendCrashLoop.ts`
- `apps/desktop/src/backendCrashLoop.test.ts`
- `packages/contracts/src/ipc.ts`
- `apps/web/src/components/DesktopBackendStatus.tsx`

Steps:

- [ ] Add a small policy module that records backend exits in a rolling time window.
- [ ] Stop automatic restarts after the configured crash threshold is reached.
- [ ] Add IPC state for `starting`, `ready`, `crashed`, `restart-paused`, and `manual-retry`.
- [ ] Show a compact recovery state in the web shell when desktop reports `restart-paused`.
- [ ] Add manual retry and diagnostics actions.
- [ ] Keep normal backend startup unchanged when there is no crash loop.

Acceptance:

- [ ] Three quick backend exits pause automatic restart.
- [ ] Manual retry resets the pause only for the next attempt.
- [ ] The UI can show recovery state without polling logs.

Verification:

```powershell
bun run test apps/desktop/src/backendCrashLoop.test.ts
bun run test apps/web/src/components/DesktopBackendStatus.test.tsx
```

### 1.3 Diagnostics Bundle

**Purpose:** Give users a local, redacted evidence bundle for Windows support without exposing secrets.

Files:

- `apps/desktop/src/diagnosticsBundle.ts`
- `apps/desktop/src/diagnosticsBundle.test.ts`
- `apps/desktop/src/main.ts`
- `packages/contracts/src/ipc.ts`
- `apps/web/src/components/settings/DiagnosticsPanel.tsx`
- `docs/release.md`

Steps:

- [ ] Collect app version, Electron version, OS version, architecture, backend port, backend readiness timeline, backend restart count, GPU acceleration mode, safeStorage availability, and provider discovery summaries.
- [ ] Include recent desktop/backend logs if they are already local files.
- [ ] Redact environment values, tokens, paths containing obvious secret names, prompt text, terminal output, provider chunks, and raw relay tokens.
- [ ] Write the bundle under the desktop app data directory with a timestamped folder name.
- [ ] Add a settings action to create and reveal the bundle.
- [ ] Add tests for redaction and stable manifest shape.

Acceptance:

- [ ] Bundle creation works without network access.
- [ ] The manifest is readable JSON.
- [ ] Tests prove common secret names are redacted.

Verification:

```powershell
bun run test apps/desktop/src/diagnosticsBundle.test.ts
```

### 1.4 Single Instance, Tray, and Autostart Controls

**Purpose:** Make the packaged desktop app predictable for daily Windows use.

Files:

- `apps/desktop/src/main.ts`
- `apps/desktop/src/singleInstance.ts`
- `apps/desktop/src/tray.ts`
- `apps/desktop/src/autostart.ts`
- `apps/desktop/src/*.test.ts`
- `apps/web/src/components/settings/DesktopIntegrationPanel.tsx`

Steps:

- [ ] Use Electron single-instance locking so a second launch focuses the existing window.
- [ ] Add tray actions for show/hide, restart backend, create diagnostics bundle, and quit.
- [ ] Add a user-controlled autostart setting stored locally.
- [ ] Ensure autostart never enables itself during dev or tests.
- [ ] Add tests for second-instance routing and autostart setting persistence.

Acceptance:

- [ ] A second launch does not start a second backend.
- [ ] Tray quit performs the same backend shutdown path as window quit.
- [ ] Autostart is opt-in.

Verification:

```powershell
bun run test apps/desktop/src/singleInstance.test.ts apps/desktop/src/autostart.test.ts
```

## Epic 2: Workspace Daily UX

### 2.1 Workspace Command Palette

**Purpose:** Make workspace actions discoverable without adding new top-level navigation.

Files:

- `apps/web/src/components/WorkspaceWindow.tsx`
- `apps/web/src/components/WorkspaceCommandPalette.tsx`
- `apps/web/src/components/WorkspaceCommandPalette.logic.ts`
- `apps/web/src/components/WorkspaceCommandPalette.test.ts`

Steps:

- [ ] Add a workspace-local command palette opened from a toolbar icon and keyboard shortcut.
- [ ] Include actions for switching tabs, opening browser, opening git review, opening terminal, creating image generation, copying current workspace context, and focusing dev server controls.
- [ ] Resolve actions from existing workspace state instead of duplicating route state.
- [ ] Use icons and tooltips for compact controls.
- [ ] Do not add explanatory marketing text inside the app surface.

Acceptance:

- [ ] Palette actions select the existing workspace tabs.
- [ ] Disabled actions explain missing state through tooltips or disabled labels.
- [ ] Keyboard shortcut does not conflict with composer send behavior.

Verification:

```powershell
bun run test apps/web/src/components/WorkspaceCommandPalette.test.ts
```

### 2.2 Dev Server Launcher and Preview Binding

**Purpose:** Turn detected or configured dev servers into one-click start, stop, and preview actions.

Files:

- `packages/contracts/src/server.ts`
- `apps/server/src/devServers/Services/DevServerManager.ts`
- `apps/server/src/devServers/Layers/DevServerManager.ts`
- `apps/web/src/environmentApi.ts`
- `apps/web/src/components/WorkspaceWindow.tsx`
- `apps/web/src/components/workspaceDevServerActions.ts`
- `apps/web/src/components/workspaceDevServerActions.test.ts`

Steps:

- [ ] Confirm existing dev server contract includes every field the UI needs: command, cwd, URL, status, source, and managed/external marker.
- [ ] Add missing contract fields only if the current shape cannot express the UI safely.
- [ ] Add server-side start/stop error categories: missing command, cwd missing, port in use, process exited, unsupported inventory, and timeout.
- [ ] Add web logic to choose the best preview URL for a selected project.
- [ ] Add workspace buttons for start, stop, restart, and open in browser/preview.
- [ ] Show Windows unsupported external-inventory state as an operational status, not as a crash.

Acceptance:

- [ ] Starting a managed dev server updates the workspace state without reload.
- [ ] Stopping a managed dev server clears active preview binding only when that server owns the binding.
- [ ] Windows unsupported external inventory is visible and non-fatal.

Verification:

```powershell
bun run test apps/web/src/components/workspaceDevServerActions.test.ts
bun run test apps/server/src/devServers/Layers/DevServerManager.test.ts
```

### 2.3 Browser Capture to Composer

**Purpose:** Let users bring browser evidence into the active chat without manual file hunting.

Files:

- `packages/contracts/src/ipc.ts`
- `apps/desktop/src/browserManager.ts`
- `apps/desktop/src/browserBridge.ts`
- `apps/web/src/components/WorkspaceWindow.tsx`
- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/browserCapture.logic.ts`
- `apps/web/src/components/browserCapture.logic.test.ts`

Steps:

- [ ] Add a browser capture result contract with local file path, MIME type, dimensions when known, URL, title, and timestamp.
- [ ] Store captures under a local temp or workspace attachment directory.
- [ ] Add a browser panel action that captures the current viewport and returns a composer attachment.
- [ ] Attach the capture to the active thread composer through existing attachment paths.
- [ ] Avoid storing captures in relay metadata.

Acceptance:

- [ ] Capture action produces an attachment in the active composer.
- [ ] Missing browser session reports a user-facing disabled state.
- [ ] Capture metadata does not include prompt text or terminal output.

Verification:

```powershell
bun run test apps/web/src/components/browserCapture.logic.test.ts
```

### 2.4 Git Review Panel

**Purpose:** Turn current git diff and AI summary primitives into a compact review workflow.

Files:

- `apps/web/src/lib/gitReactQuery.ts`
- `apps/web/src/components/WorkspaceWindow.tsx`
- `apps/web/src/components/WorkspaceGitReviewPanel.tsx`
- `apps/web/src/components/WorkspaceGitReviewPanel.logic.ts`
- `apps/web/src/components/WorkspaceGitReviewPanel.test.tsx`

Steps:

- [ ] Reuse `gitWorkingTreeDiffQueryOptions` and `gitSummarizeDiffQueryOptions`.
- [ ] Add grouped file changes, selected-file diff preview, summary refresh, copy summary, and open file actions.
- [ ] Add stage-state display only if an existing safe API is available; otherwise keep this panel read-only.
- [ ] Add empty states for clean worktree, missing git repo, and diff too large.
- [ ] Keep commit/push actions out of this panel unless the user explicitly asks later.

Acceptance:

- [ ] Panel displays diff status without mutating git state.
- [ ] Summary refresh errors are recoverable.
- [ ] Large diffs do not freeze the UI.

Verification:

```powershell
bun run test apps/web/src/components/WorkspaceGitReviewPanel.test.tsx
```

### 2.5 Image Generation Result Actions

**Purpose:** Make generated raster assets useful inside Wobex workflows.

Files:

- `apps/web/src/components/WorkspaceImagegenPanel.tsx`
- `apps/web/src/components/WorkspaceImagegenPanel.logic.ts`
- `apps/web/src/components/WorkspaceImagegenPanel.test.tsx`
- `apps/web/src/components/chat/ChatComposer.tsx`

Steps:

- [ ] Add result actions for attach to current thread, copy local path, reveal file, and reuse prompt.
- [ ] Preserve existing `EnvironmentApi.imageGeneration.generate` flow.
- [ ] Keep generated raster output as local attachment data.
- [ ] Add tests for successful result action mapping and empty path handling.

Acceptance:

- [ ] Existing image generation still works.
- [ ] Results can be attached to the composer without regenerating.
- [ ] Empty result paths show a recoverable state.

Verification:

```powershell
bun run test apps/web/src/components/WorkspaceImagegenPanel.test.tsx
```

### 2.6 Plan Execution Panel

**Purpose:** Let users turn large plan files into visible execution progress without changing provider behavior.

Files:

- `apps/web/src/components/PlanExecutionPanel.tsx`
- `apps/web/src/components/PlanExecutionPanel.logic.ts`
- `apps/web/src/components/PlanExecutionPanel.test.ts`
- `apps/web/src/components/WorkspaceWindow.tsx`

Steps:

- [ ] Parse markdown checkbox lists from selected plan files.
- [ ] Show task groups, current status, and links to files referenced in the plan.
- [ ] Allow copying the next unchecked task text into the composer.
- [ ] Allow marking local UI progress only when backed by a file write or an explicit user action.
- [ ] Keep the provider turn queue unchanged in this slice.

Acceptance:

- [ ] Panel can load this roadmap file and show sections.
- [ ] Copy-next-task preserves exact task text.
- [ ] No provider sessions are started by opening the panel.

Verification:

```powershell
bun run test apps/web/src/components/PlanExecutionPanel.test.ts
```

## Epic 3: Server Runtime Durability

### 3.1 Cursor History APIs

**Purpose:** Load older thread history without oversized snapshots.

Files:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/server.ts`
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts`
- `apps/web/src/lib/serverReactQuery.ts`
- `apps/web/src/components/chat/MessagesTimeline.tsx`

Steps:

- [ ] Add schema for cursor-based event/message history queries.
- [ ] Use stable cursors derived from persisted sequence or timestamp fields already present in the projection store.
- [ ] Keep `getBoundedSnapshot` as the fast initial path.
- [ ] Add older-history loading to the chat timeline.
- [ ] Preserve the current bounded snapshot truncation behavior for first render.

Acceptance:

- [ ] Initial thread load stays bounded.
- [ ] User can load older messages in deterministic order.
- [ ] Cursor requests are scoped to environment and thread references.

Verification:

```powershell
bun run test apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts
bun run test apps/web/src/components/chat/MessagesTimeline.test.tsx
```

### 3.2 Durable Turn and Message Queue

**Purpose:** Make queued user turns survive provider failures, restarts, reconnects, and partial streams.

Files:

- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/orchestration/Layers/*.test.ts`
- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/PendingTurnList.tsx`

Steps:

- [ ] Audit current `queued`, `in-flight`, and `abandoned` command states.
- [ ] Persist enough queue state to replay or mark queued turns after server restart.
- [ ] Add idempotency keys for user-submitted turns.
- [ ] Add deterministic transitions for provider unavailable, provider restart, user interrupt, and provider partial stream failure.
- [ ] Project queue state to the web UI.
- [ ] Add composer state for queued turns and cancellation where the server supports it.

Acceptance:

- [ ] A queued turn is not lost when the provider process exits before starting it.
- [ ] Duplicate submit retries do not create duplicate provider turns.
- [ ] Abandoned state is visible and actionable.

Verification:

```powershell
bun run test apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts
bun run test apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts
bun run test apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
```

### 3.3 Archive, Recency, and Sorting Audit

**Purpose:** Make project/thread lists reflect current state instead of stale historical assumptions.

Files:

- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts`
- `apps/web/src/components/Sidebar.logic.ts`
- `apps/web/src/components/Sidebar.logic.test.ts`
- `TODO.md`

Steps:

- [ ] Verify whether thread archiving, last-updated sorting, project recency sorting, and last-10 thread display are already implemented.
- [ ] Add missing server-side fields or query options only for verified gaps.
- [ ] Update sidebar logic to rely on server-projected recency where available.
- [ ] Replace stale entries in `TODO.md` with current status or remove entries only after implementation evidence exists.

Acceptance:

- [ ] Archived threads do not appear in default active lists.
- [ ] Projects sort by latest relevant thread update.
- [ ] Sidebar tests cover pinned, archived, and recent thread interactions.

Verification:

```powershell
bun run test apps/web/src/components/Sidebar.logic.test.ts
bun run test apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts
```

### 3.4 Image Generation Job Durability

**Purpose:** Make image generation resilient to reloads and visible as jobs rather than one-off UI calls.

Files:

- `packages/contracts/src/server.ts`
- `apps/server/src/imageGeneration/*`
- `apps/server/src/imageGeneration/*.test.ts`
- `apps/web/src/environmentApi.ts`
- `apps/web/src/components/WorkspaceImagegenPanel.tsx`

Steps:

- [ ] Introduce image generation job records with status, prompt metadata, output paths, error category, and timestamps.
- [ ] Persist local job state under server-owned storage.
- [ ] Keep prompt and output paths local-only.
- [ ] Add retry for failed jobs when the failure category is retryable.
- [ ] Expose job list/query APIs to the panel.
- [ ] Preserve the existing direct generate action until the job-backed UI replaces it fully.

Acceptance:

- [ ] Reloading the web UI shows recent local image jobs.
- [ ] Failed jobs keep error category and can be retried.
- [ ] No image job payload is sent to relay.

Verification:

```powershell
bun run test apps/server/src/imageGeneration
bun run test apps/web/src/components/WorkspaceImagegenPanel.test.tsx
```

## Epic 4: Provider and Terminal Hardening

### 4.1 Provider Capability Matrix

**Purpose:** Give users and internal code a single source of truth for provider capabilities.

Files:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/providerRuntime.ts`
- `apps/server/src/providers/*`
- `apps/server/src/providers/providerCapabilities.ts`
- `apps/server/src/providers/providerCapabilities.test.ts`
- `apps/web/src/components/settings/ProviderCapabilitiesPanel.tsx`

Steps:

- [ ] Define normalized capability flags: start, resume, interrupt, approvals, user input, rollback, history read, usage, models, account labels, file attachments, images, and remote support.
- [ ] Implement capability discovery per existing provider adapter.
- [ ] Show installed/authenticated/version/account state separately from capability support.
- [ ] Keep provider-specific quirks out of the web UI.

Acceptance:

- [ ] Codex, Claude Agent, OpenCode, and Droid expose capability records.
- [ ] Missing capability is shown as unavailable, not as a runtime error.
- [ ] Tests cover each provider kind in the current contract.

Verification:

```powershell
bun run test apps/server/src/providers/providerCapabilities.test.ts
```

### 4.2 Unified Usage and Rate-Limit Service

**Purpose:** Normalize provider usage visibility without coupling UI to provider internals.

Files:

- `packages/contracts/src/providerRuntime.ts`
- `packages/contracts/src/server.ts`
- `apps/server/src/providers/providerUsage.ts`
- `apps/server/src/providers/providerUsage.test.ts`
- `apps/web/src/components/chat/ProviderUsageIndicator.tsx`

Steps:

- [ ] Use existing usage snapshot event shapes where possible.
- [ ] Add a server refresh endpoint only if current `ServerRefreshProviderUsageInput` and result cannot express the required flow.
- [ ] Normalize token counts, reset time, quota source, and stale/error state.
- [ ] Show stale data as stale rather than hiding it.

Acceptance:

- [ ] Usage display works when a provider supports usage.
- [ ] Providers without usage support show a stable unavailable state.
- [ ] Rate-limit refresh failures do not block chat.

Verification:

```powershell
bun run test apps/server/src/providers/providerUsage.test.ts
bun run test apps/web/src/components/chat/ProviderUsageIndicator.test.tsx
```

### 4.3 Gemini Provider Feasibility Gate

**Purpose:** Add Gemini only after the capability matrix proves the provider boundary can absorb it.

Files:

- `packages/contracts/src/orchestration.ts`
- `apps/server/src/providers/gemini/*`
- `apps/server/src/providers/providerCapabilities.ts`
- `apps/web/src/components/settings/ProviderCapabilitiesPanel.tsx`

Steps:

- [ ] Confirm local Gemini CLI or API integration target with the user before adding dependencies or secrets.
- [ ] Add `gemini` to provider kind contracts only after the runtime adapter shape is defined.
- [ ] Implement discovery without requiring authentication side effects.
- [ ] Implement start/resume/send/interrupt only to the level supported by the selected Gemini target.
- [ ] Add tests for unsupported capabilities.

Acceptance:

- [ ] Gemini cannot appear as fully supported unless the adapter implements start and send.
- [ ] Missing credentials are reported as unauthenticated, not as install failure.
- [ ] No API keys are stored in relay.

Verification:

```powershell
bun run test apps/server/src/providers/gemini
bun run test apps/server/src/providers/providerCapabilities.test.ts
```

### 4.4 Terminal History Privacy and Windows PTY Fallback

**Purpose:** Make terminal behavior explicit, configurable, and Windows-safe.

Files:

- `apps/server/src/terminal/Layers/Manager.ts`
- `apps/server/src/terminal/Layers/BunPTY.ts`
- `apps/server/src/terminal/Layers/NodePTY.ts`
- `apps/server/src/terminal/terminalRetention.ts`
- `apps/server/src/terminal/*.test.ts`
- `packages/contracts/src/server.ts`
- `apps/web/src/components/settings/TerminalSettingsPanel.tsx`

Steps:

- [ ] Add terminal retention settings: disabled, session-only, and persisted with max lines and max age.
- [ ] Apply retention before writing terminal history.
- [ ] Make Windows PTY fallback explicit when Bun PTY is unavailable.
- [ ] Add UI state showing which PTY backend is active.
- [ ] Add tests for retention trimming and delete-history behavior.

Acceptance:

- [ ] Terminal history retention defaults are local-first and conservative.
- [ ] Users can delete persisted terminal history.
- [ ] Windows fallback path is deterministic and logged.

Verification:

```powershell
bun run test apps/server/src/terminal
```

## Epic 5: Relay Hardening

### 5.1 Production Config Guardrails

**Purpose:** Prevent insecure relay defaults outside local development.

Files:

- `apps/relay/src/config.ts`
- `apps/relay/src/server.ts`
- `apps/relay/src/config.test.ts`
- `docs/relay-operator.md`

Steps:

- [ ] Require explicit public URL and secure auth configuration for production mode.
- [ ] Default debug auth codes to disabled in production.
- [ ] Fail startup when production config is ambiguous.
- [ ] Keep local development path easy with explicit dev-mode labels.

Acceptance:

- [ ] Production-like env without required config fails before accepting requests.
- [ ] Dev mode still starts locally with safe labels.
- [ ] Operator docs match current env names.

Verification:

```powershell
bun run test apps/relay/src/config.test.ts
```

### 5.2 Metadata-Only Enforcement Upgrade

**Purpose:** Make relay privacy enforceable by schema and tests, not just convention.

Files:

- `packages/contracts/src/relay.ts`
- `apps/relay/src/metadataStore.ts`
- `apps/relay/src/metadataStore.test.ts`
- `apps/relay/src/runtime.test.ts`

Steps:

- [ ] Replace broad unknown metadata where possible with scalar metadata records or narrow typed fields.
- [ ] Add deny-list tests for prompt text, diffs, terminal output, provider chunks, file contents, host SQLite data, and provider secrets.
- [ ] Keep `assertMetadataOnly` as a runtime defense even after schema narrowing.
- [ ] Add audit events for rejected non-metadata payloads.

Acceptance:

- [ ] Tests fail if relay accepts obvious prompt/diff/content fields.
- [ ] Relay audit records rejection metadata without storing rejected content.
- [ ] Existing allowed metadata still works.

Verification:

```powershell
bun run test apps/relay/src/metadataStore.test.ts apps/relay/src/runtime.test.ts
```

### 5.3 Registration Token Lifecycle

**Purpose:** Avoid long-lived raw registration tokens in relay state and responses.

Files:

- `packages/contracts/src/relay.ts`
- `apps/relay/src/metadataStore.ts`
- `apps/relay/src/runtime.ts`
- `apps/relay/src/metadataStore.test.ts`
- `apps/relay/src/runtime.test.ts`

Steps:

- [ ] Store hashed registration tokens after creation.
- [ ] Return raw token only once at creation time.
- [ ] Add token expiry and explicit revocation.
- [ ] Add rotation path that does not require re-registering unrelated device metadata.
- [ ] Ensure logs and audit events never include raw token values.

Acceptance:

- [ ] Raw registration token cannot be read back after creation.
- [ ] Expired tokens fail authentication.
- [ ] Rotation invalidates the old token.

Verification:

```powershell
bun run test apps/relay/src/metadataStore.test.ts apps/relay/src/runtime.test.ts
```

### 5.4 WebSocket and Pending Request Bounds

**Purpose:** Keep relay predictable under slow clients, disconnects, and large frames.

Files:

- `apps/relay/src/runtime.ts`
- `apps/relay/src/runtime.test.ts`
- `packages/contracts/src/relay.ts`
- `docs/mobile-host-control.md`

Steps:

- [ ] Add maximum WebSocket frame size and structured close reasons.
- [ ] Add TTL cleanup for pending HTTP, pending tunnel, and pending auth maps.
- [ ] Add per-device and per-session pending request limits.
- [ ] Surface bounded error states in mobile/remote docs.

Acceptance:

- [ ] Oversized frames close with a deterministic code.
- [ ] Pending maps drain after timeout.
- [ ] Flooded sessions cannot grow memory without bounds.

Verification:

```powershell
bun run test apps/relay/src/runtime.test.ts
```

### 5.5 Transactional Repository Writes

**Purpose:** Replace snapshot-delete persistence with smaller transactional mutations.

Files:

- `apps/relay/src/repository.ts`
- `apps/relay/src/repository.test.ts`
- `apps/relay/src/metadataStore.ts`

Steps:

- [ ] Identify each `flush` caller and decide whether it needs full snapshot persistence or a targeted mutation.
- [ ] Add repository methods for pairings, devices, sessions, audit events, and capability updates.
- [ ] Keep snapshot export/import only as an explicit maintenance path.
- [ ] Add tests for partial write failure behavior.

Acceptance:

- [ ] Normal relay runtime does not delete and rewrite all metadata for each small change.
- [ ] Audit inserts remain append-only.
- [ ] Failed partial write leaves previous durable state readable.

Verification:

```powershell
bun run test apps/relay/src/repository.test.ts
```

### 5.6 Relay Smoke Suite

**Purpose:** Prove the relay can start, pair, enforce policy, and shut down locally before any public deployment.

Files:

- `apps/relay/scripts/smoke.mjs`
- `apps/relay/package.json`
- `docs/relay-operator.md`

Steps:

- [ ] Add local smoke script that starts relay with test config.
- [ ] Exercise health, pairing token creation, host registration, client auth, metadata rejection, and graceful shutdown.
- [ ] Keep the smoke script local-only.
- [ ] Document the command and expected constraints.

Acceptance:

- [ ] Smoke script runs without production credentials.
- [ ] Smoke proves metadata rejection.
- [ ] Smoke does not bind a public URL.

Verification:

```powershell
bun run --cwd apps/relay smoke
```

## Epic 6: Observability, Release, and Documentation

### 6.1 Local Metrics Snapshots

**Purpose:** Provide operational visibility without remote telemetry.

Files:

- `apps/server/src/metrics/*`
- `packages/contracts/src/server.ts`
- `apps/web/src/components/settings/LocalMetricsPanel.tsx`
- `docs/observability.md`

Steps:

- [ ] Add local metrics snapshots for backend uptime, provider restarts, queue depth, dev server count, terminal session count, relay connection count, and recent error categories.
- [ ] Store only counters and timestamps, never prompts or output content.
- [ ] Add retention limits.
- [ ] Expose a settings view and diagnostics bundle integration.

Acceptance:

- [ ] Metrics are useful after restart within retention limits.
- [ ] Metrics export contains no prompt, diff, terminal, or provider content.
- [ ] Observability docs describe what is and is not collected.

Verification:

```powershell
bun run test apps/server/src/metrics
```

### 6.2 Release Smoke and Windows Artifact Verification

**Purpose:** Make Windows release readiness repeatable.

Files:

- `apps/desktop/scripts/smoke-test.mjs`
- `scripts/release-smoke.mjs`
- `docs/release.md`
- `.github/workflows/*`

Steps:

- [ ] Extend smoke checks to verify packaged app launch, backend readiness, web UI reachability, single-instance behavior, and clean shutdown.
- [ ] Add artifact hash and signing verification steps where the local environment has signing material.
- [ ] Keep signing secrets out of repo and diagnostics.
- [ ] Document manual verification for unsigned local builds separately from signed release builds.

Acceptance:

- [ ] Release smoke can run against a local Windows artifact.
- [ ] Unsigned local build path is documented and does not claim signed release readiness.
- [ ] CI workflow names and docs match actual scripts.

Verification:

```powershell
bun run release:smoke
```

### 6.3 Documentation Drift Pass

**Purpose:** Keep docs aligned with implemented behavior.

Files:

- `README.md`
- `MASTERPLAN.md`
- `TODO.md`
- `docs/release.md`
- `docs/mobile-host-control.md`
- `docs/relay-operator.md`
- `docs/observability.md`
- `docs/superpowers/plans/*.md`

Steps:

- [ ] Update docs only after matching implementation exists.
- [ ] Remove stale checklist items when tests or code references prove completion.
- [ ] Add status notes for intentional gaps.
- [ ] Keep user-facing docs concise and operational.

Acceptance:

- [ ] Docs do not claim production relay deployment unless it happened with explicit user approval.
- [ ] Docs do not claim signed Windows releases unless signing verification passed.
- [ ] Roadmap status matches test evidence.

Verification:

```powershell
git diff --check -- README.md MASTERPLAN.md TODO.md docs
```

## Cross-Epic Contract Checklist

Before merging a slice that changes contracts:

- [ ] Add or update schema in `packages/contracts`.
- [ ] Add server-side adapter code.
- [ ] Add web query/client code.
- [ ] Add at least one server contract test or web logic test.
- [ ] Run `bun typecheck` after schema changes.
- [ ] Verify old persisted state has a safe fallback or migration path.

## Cross-Epic Privacy Checklist

Before merging a slice that touches relay, diagnostics, metrics, browser capture, image generation, terminal history, or provider usage:

- [ ] Confirm data stays local unless the feature is explicitly relay metadata.
- [ ] Confirm no prompt text, provider chunks, terminal output, diffs, file contents, provider secrets, raw tokens, or host SQLite data are sent to relay.
- [ ] Add tests for redaction or rejection.
- [ ] Add docs only for behavior that exists.

## Full Verification Gate

Run targeted tests after each slice. At the end of a full implementation pass, run:

```powershell
bun fmt
bun lint
bun typecheck
bun run test
```

For desktop release readiness on Windows, also run the relevant smoke commands:

```powershell
bun run --cwd apps/desktop smoke-test
bun run release:smoke
```

For relay hardening after local-only relay changes:

```powershell
bun run --cwd apps/relay smoke
```

If any gate fails:

- [ ] Save the failing command and first relevant error.
- [ ] Fix the smallest responsible slice.
- [ ] Re-run the targeted failing command.
- [ ] Re-run root gates before committing.

## Commit Plan

Use small commits in this order when each slice passes its checks:

1. `desktop: harden windows backend lifecycle`
2. `web: add workspace command workflows`
3. `server: add durable history and turn queues`
4. `providers: expose capability and usage state`
5. `terminal: add retention and windows fallback state`
6. `relay: enforce metadata-only production guardrails`
7. `docs: align roadmap and release status`

Do not push unless the user explicitly asks.

## Done Definition

The roadmap is complete only when:

- [ ] Windows desktop lifecycle is single-instance, diagnosable, restart-safe, and smoke-tested.
- [ ] Workspace users can launch previews, inspect git changes, capture browser evidence, reuse image outputs, and execute plan files from the existing app shell.
- [ ] Server history and queued turns survive realistic failure and restart paths.
- [ ] Provider capabilities and usage are normalized without UI provider coupling.
- [ ] Terminal history retention is explicit and Windows PTY fallback is deterministic.
- [ ] Relay production mode has guardrails, metadata-only enforcement, bounded request state, hardened tokens, transactional persistence, and local smoke coverage.
- [ ] Docs match implementation evidence.
- [ ] `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test` pass.
- [ ] Focused commits exist for the implemented slices.
