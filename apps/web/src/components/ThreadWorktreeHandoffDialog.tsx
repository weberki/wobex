import type { EnvironmentId, ThreadId } from "@wobex/contracts";
import { scopeThreadRef } from "@wobex/client-runtime";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "../environmentApi";
import { gitCreateWorktreeMutationOptions } from "../lib/gitReactQuery";
import { newCommandId } from "../lib/utils";
import { useStore } from "../store";
import type { Thread } from "../types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

function defaultHandoffBranchName(thread: Pick<Thread, "id" | "title">): string {
  const titleSlug = thread.title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._/-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 42);
  return `handoff/${titleSlug || thread.id.slice(0, 8)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Unable to create and attach the worktree.";
}

export function ThreadWorktreeHandoffDialog({
  open,
  environmentId,
  thread,
  projectCwd,
  currentGitBranch,
  onOpenChange,
}: {
  open: boolean;
  environmentId: EnvironmentId;
  thread: Thread;
  projectCwd: string | null;
  currentGitBranch: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const setThreadBranch = useStore((state) => state.setThreadBranch);
  const [baseBranch, setBaseBranch] = useState(currentGitBranch ?? thread.branch ?? "");
  const [newBranch, setNewBranch] = useState(defaultHandoffBranchName(thread));
  const [worktreePath, setWorktreePath] = useState("");
  const createWorktreeMutation = useMutation(
    gitCreateWorktreeMutationOptions({ environmentId, queryClient }),
  );
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, thread.id),
    [environmentId, thread.id],
  );

  useEffect(() => {
    if (!open) return;
    setBaseBranch(currentGitBranch ?? thread.branch ?? "");
    setNewBranch(defaultHandoffBranchName(thread));
    setWorktreePath("");
  }, [currentGitBranch, open, thread]);

  const trimmedBaseBranch = baseBranch.trim();
  const trimmedNewBranch = newBranch.trim();
  const trimmedWorktreePath = worktreePath.trim();
  const canSubmit =
    projectCwd !== null &&
    trimmedBaseBranch.length > 0 &&
    trimmedNewBranch.length > 0 &&
    !createWorktreeMutation.isPending;

  const attachWorktree = async () => {
    if (!canSubmit || !projectCwd) {
      return;
    }

    const result = await createWorktreeMutation.mutateAsync({
      cwd: projectCwd,
      branch: trimmedBaseBranch,
      newBranch: trimmedNewBranch,
      path: trimmedWorktreePath.length > 0 ? trimmedWorktreePath : null,
    });
    const nextBranch = result.worktree.branch;
    const nextWorktreePath = result.worktree.path;
    const api = readEnvironmentApi(environmentId);
    if (api && thread.session && thread.worktreePath !== nextWorktreePath) {
      void api.orchestration
        .dispatchCommand({
          type: "thread.session.stop",
          commandId: newCommandId(),
          threadId: thread.id as ThreadId,
          createdAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }
    if (api) {
      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: thread.id,
        branch: nextBranch,
        worktreePath: nextWorktreePath,
      });
    }
    setThreadBranch(threadRef, nextBranch, nextWorktreePath);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!createWorktreeMutation.isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Worktree Handoff</DialogTitle>
          <DialogDescription>
            Create a dedicated worktree and attach this thread to it. Existing chat, diff, and
            cleanup flows stay untouched.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Base branch</span>
            <Input
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.currentTarget.value)}
              placeholder="main"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">New branch</span>
            <Input
              value={newBranch}
              onChange={(event) => setNewBranch(event.currentTarget.value)}
              placeholder="handoff/thread-name"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Worktree path</span>
            <Input
              value={worktreePath}
              onChange={(event) => setWorktreePath(event.currentTarget.value)}
              placeholder="Leave empty for the repository default"
            />
          </label>
          {projectCwd ? (
            <div className="rounded-xl border border-border/70 bg-muted/25 p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 text-foreground">
                <GitBranchIcon className="size-3.5" />
                {projectCwd}
              </div>
              {thread.worktreePath ? (
                <p className="mt-2">Current worktree: {thread.worktreePath}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-destructive">
              This thread has no project cwd, so a worktree cannot be created.
            </p>
          )}
          {createWorktreeMutation.error ? (
            <p className="text-xs text-destructive">{errorMessage(createWorktreeMutation.error)}</p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={createWorktreeMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void attachWorktree();
            }}
            disabled={!canSubmit}
          >
            {createWorktreeMutation.isPending ? "Creating..." : "Create and attach"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
