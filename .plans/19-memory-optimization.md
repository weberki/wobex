# Plan: End-to-End Idle Memory Optimization

## Summary

Reduce idle memory across the desktop app by removing large retained state from both the server and renderer.

The current memory profile is likely dominated by four behaviors:

1. The server keeps a full in-memory orchestration read model for all non-deleted threads.
2. The renderer eagerly hydrates the same snapshot and stores it in multiple parallel structures.
3. Hidden terminal drawers keep `xterm` instances, scrollback, and server-side terminal history alive.
4. Composer draft images are persisted as full `dataUrl` payloads and rehydrated into `File` objects on startup.

This plan treats memory reduction as a product feature, not a cleanup task.

## Goals

- Bring idle memory to a predictable, bounded level after real usage.
- Prevent memory from scaling linearly with old threads, disconnected environments, or stale terminal state.
- Preserve correctness under reconnects, replay recovery, and session restarts.

## Non-Goals

- Do not change provider behavior or orchestration semantics just to save memory.
- Do not trade away correctness for short-term memory wins.
- Do not optimize with blind caps before measuring the user-visible impact.

## Memory Budget Targets

These numbers should be validated on a representative project and with several previously active threads.

- Renderer idle target after boot and thread selection:
  - Steady-state heap materially below current baseline.
  - No large growth from disconnected environments or hidden terminals.
- Server idle target after startup:
  - Read-model memory should no longer scale with full thread history across the entire workspace.
- Recovery target:
  - Snapshot/replay flows must not permanently inflate retained heap after reconnect.

## Main Suspects

### 1. Full snapshot retention on server and client

- Server snapshot assembly:
  - `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- Long-lived in-memory read model:
  - `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- Renderer full snapshot hydration:
  - `apps/web/src/store.ts`
- Client-side duplicated indexing of messages, activities, plans, and checkpoints:
  - `apps/web/src/store.ts`

Problem:

- The same thread data is retained in the database, in the server read model, in the serialized snapshot, and again in the renderer store.
- The renderer additionally duplicates thread content into per-thread normalized maps and id arrays.

### 2. Terminal retention

- Hidden terminal retention policy:
  - `apps/web/src/components/ChatView.logic.ts`
  - `apps/web/src/components/ChatView.tsx`
- Mounted `xterm` instances with scrollback:
  - `apps/web/src/components/ThreadTerminalDrawer.tsx`
- Client terminal event buffering:
  - `apps/web/src/terminalStateStore.ts`
- Server terminal history/session retention:
  - `apps/server/src/terminal/Layers/Manager.ts`

Problem:

- Hidden drawers keep terminal instances mounted instead of tearing them down.
- Each mounted terminal has client scrollback and server-side session history.
- Inactive server sessions remain retained far longer than necessary.

### 3. Composer draft image retention

- Persisted draft attachments:
  - `apps/web/src/composerDraftStore.ts`

Problem:

- Draft images are stored as full `dataUrl` payloads and then rehydrated into `File` objects.
- This duplicates large image payloads in multiple forms during idle startup and normal use.

### 4. Environment lifecycle retention

- Environment service and connection lifecycle:
  - `apps/web/src/environments/runtime/service.ts`
- Main app store:
  - `apps/web/src/store.ts`

Problem:

- Disconnected or previously connected environments can leave full orchestration state behind in memory.

## Workstreams

## Workstream A: Add Memory Visibility First

### Objective

Make memory regressions measurable before changing architecture.

### Changes

1. Add a lightweight memory instrumentation path for:
   - Renderer heap usage
   - Server process RSS / heap used
   - Per-environment thread counts
   - Per-thread message/activity/checkpoint counts
   - Retained terminal counts
   - Retained draft attachment counts and total bytes
2. Add a dev-only manual action or log snapshot command to emit current memory state.
3. Add a repeatable profiling scenario document:
   - Open app
   - Visit several threads
   - Open several terminals
   - Add image drafts
   - Disconnect/reconnect an environment
   - Measure idle after settling

### Acceptance

- We can answer “what is using memory right now?” from app output, not guesswork.
- We can compare before/after heap snapshots and counts by workstream.

## Workstream B: Stop Bootstrapping Full Thread Histories Globally

### Objective

Load full message history only for the active thread, not for every thread in the workspace.

### Changes

1. Split orchestration snapshot shapes:
   - Workspace/sidebar snapshot:
     - projects
     - thread shells
     - latest turn
     - session summary
     - unread/updated metadata if needed
   - Full thread snapshot:
     - messages
     - activities
     - proposed plans
     - checkpoints
2. Change renderer bootstrap to hydrate only shell state for all threads.
3. Fetch full content lazily when a thread becomes active.
4. Evict full thread content for inactive threads with a small LRU window.
5. Keep recovery/replay logic thread-aware so reconnect correctness is preserved.

### Acceptance

- Boot no longer hydrates all message arrays for all threads.
- Idle memory after startup scales primarily with visible shell state, not total historical content.

## Workstream C: Remove Duplicate Client Thread Storage

### Objective

Keep one authoritative representation of thread content in the renderer.

### Changes

1. Decide between:
   - fully normalized thread content, or
   - thread object ownership with derived selectors,
   but not both.
2. Remove duplicated storage of:
   - `messages` plus `messageIdsByThreadId` plus `messageByThreadId`
   - equivalent duplication for activities, plans, and checkpoints
3. Ensure selectors derive lightweight view data without deep copying.
4. Audit rerender-sensitive components to avoid reintroducing duplication via memo caches.

### Acceptance

- Thread content is stored once in the renderer.
- Snapshot hydration and event application do not fan out into multiple parallel copies.

## Workstream D: Unmount Hidden Terminals and Lower Retention

### Objective

Make terminals cheap when not visible.

### Changes

1. Replace “hidden but mounted” terminal drawers with explicit unmount for inactive threads.
2. Keep at most a very small hot set of live terminals, ideally only the visible one.
3. Reduce `xterm` scrollback default substantially.
4. Reduce server terminal history line limit.
5. Reduce inactive terminal session retention on the server.
6. Reopen terminals from persisted history only on demand.
7. Confirm terminal reopen behavior still works after reconnect and archive/unarchive flows.

### Acceptance

- Hidden terminals do not keep `xterm` instances alive.
- Idle memory does not grow with every terminal that was opened earlier in the session.

## Workstream E: Move Draft Images Out of LocalStorage Payload Retention

### Objective

Stop retaining large image bodies in the main renderer heap during idle startup.

### Changes

1. Stop persisting full image `dataUrl` payloads in the main draft store.
2. Replace with one of:
   - IndexedDB blob storage, or
   - file-backed temporary attachment staging, or
   - metadata-only persistence with explicit recovery rules.
3. Enforce size and count limits for retained draft attachments.
4. Avoid keeping both preview string and `File` object alive unless required.
5. Add cleanup for stale persisted attachments.

### Acceptance

- Startup heap does not spike because old draft images are rehydrated into memory.
- Draft restoration remains predictable and bounded.

## Workstream F: Purge Disconnected Environment State

### Objective

Ensure environment disconnect actually releases memory.

### Changes

1. Add explicit app-store removal for an environment’s orchestration state.
2. Define when to purge:
   - environment removed
   - long-disconnected saved environment
   - auth invalidation
3. Ensure terminal state, UI state, and draft state remain coherent when environment state is purged.

### Acceptance

- Connecting to multiple environments no longer leaves old full snapshots permanently resident.

## Execution Order

1. Workstream A: instrumentation and reproducible measurement
2. Workstream D: terminal unmounting and retention cuts
3. Workstream E: draft image storage redesign
4. Workstream F: disconnected environment purge
5. Workstream B: lazy thread content loading
6. Workstream C: client state model simplification

Rationale:

- D, E, and F should produce immediate wins with lower architectural risk.
- B and C are the largest wins, but also the most invasive changes.

## Risks

- Snapshot/lazy-loading refactors can break replay recovery if thread sequence handling is sloppy.
- Terminal teardown can regress UX if reopen/restore is not deterministic.
- Draft attachment migration can lose user data if persistence compatibility is not handled carefully.
- Store simplification can accidentally increase rerenders if selectors are not updated carefully.

## Validation

1. Capture baseline memory using the new instrumentation.
2. Apply one workstream at a time.
3. Re-run the same scenario after each workstream.
4. Compare:
   - renderer heap
   - server RSS / heap
   - terminal count
   - draft attachment bytes
   - environment count
   - active thread payload sizes
5. Add regression tests where behavior can be verified automatically:
   - environment purge
   - terminal unmount/remount
   - draft attachment cleanup
   - lazy full-thread fetch and replay recovery

## Done Criteria

- Idle memory is substantially reduced after real multi-thread usage.
- Memory no longer scales with old hidden terminals, stale draft images, or disconnected environments.
- Boot no longer hydrates full historical thread payloads globally.
- Reconnect, replay, and session restart behavior remain correct.
