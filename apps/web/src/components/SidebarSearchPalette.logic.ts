import type { ProviderKind, ScopedThreadRef } from "@wobex/contracts";
import { type ScopedProjectRef } from "@wobex/contracts";

export interface SidebarSearchAction {
  id: string;
  label: string;
  description: string;
  keywords?: readonly string[];
  shortcutLabel?: string | null;
}

export interface SidebarSearchProject {
  id: string;
  ref: ScopedProjectRef;
  name: string;
  cwd: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

export interface SidebarSearchProjectMatch {
  id: string;
  project: SidebarSearchProject;
}

export interface SidebarSearchThread {
  id: string;
  ref: ScopedThreadRef;
  title: string;
  projectId: string;
  projectName: string;
  provider: ProviderKind;
  createdAt: string;
  updatedAt?: string | undefined;
  messages: readonly {
    text: string;
  }[];
}

export interface SidebarSearchThreadMatch {
  id: string;
  thread: SidebarSearchThread;
  matchKind: "message" | "project" | "title";
  snippet: string | null;
  messageMatchCount: number;
}

function normalizeText(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function normalizeDisplayText(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}

function tokenizeQuery(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

function basenameOfPath(value: string): string {
  const segments = value.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? value;
}

function truncateSnippet(value: string, startIndex: number, queryLength: number): string {
  const maxLength = 88;
  const safeStartIndex = Math.max(0, startIndex);
  if (value.length <= maxLength) {
    return value;
  }

  const contextBefore = Math.min(28, safeStartIndex);
  const queryCenter = safeStartIndex + Math.max(queryLength, 1) / 2;
  const desiredStart = Math.max(0, Math.round(queryCenter - maxLength / 2) - contextBefore);
  const boundedStart = Math.min(desiredStart, Math.max(0, value.length - maxLength));
  const boundedEnd = Math.min(value.length, boundedStart + maxLength);
  const prefix = boundedStart > 0 ? "..." : "";
  const suffix = boundedEnd < value.length ? "..." : "";
  return `${prefix}${value.slice(boundedStart, boundedEnd).trim()}${suffix}`;
}

function buildMessageSnippet(
  messageText: string,
  query: string,
  queryTokens: readonly string[],
): string {
  const displayMessage = normalizeDisplayText(messageText);
  if (!displayMessage) {
    return "";
  }
  const normalizedMessage = displayMessage.toLowerCase();

  const phraseIndex = normalizedMessage.indexOf(query);
  if (phraseIndex >= 0) {
    return truncateSnippet(displayMessage, phraseIndex, query.length);
  }

  let earliestTokenIndex = Number.POSITIVE_INFINITY;
  let matchedToken = "";
  for (const token of queryTokens) {
    const tokenIndex = normalizedMessage.indexOf(token);
    if (tokenIndex >= 0 && tokenIndex < earliestTokenIndex) {
      earliestTokenIndex = tokenIndex;
      matchedToken = token;
    }
  }

  if (!Number.isFinite(earliestTokenIndex)) {
    return truncateSnippet(displayMessage, 0, 0);
  }

  return truncateSnippet(displayMessage, earliestTokenIndex, matchedToken.length);
}

function scoreMessage(
  messages: SidebarSearchThread["messages"],
  query: string,
  queryTokens: readonly string[],
): {
  messageMatchCount: number;
  score: number | null;
  snippet: string | null;
} {
  let bestScore: number | null = null;
  let bestSnippet: string | null = null;
  let matchCount = 0;

  for (const message of messages) {
    const normalizedMessage = normalizeText(message.text);
    if (!normalizedMessage) continue;

    let score: number | null = null;
    if (normalizedMessage === query) {
      score = 165;
    } else if (normalizedMessage.startsWith(query)) {
      score = 155;
    } else if (normalizedMessage.includes(query)) {
      score = 145;
    } else if (
      queryTokens.length > 1 &&
      queryTokens.every((token) => normalizedMessage.includes(token))
    ) {
      score = 132;
    }

    if (score === null) continue;

    matchCount += 1;
    if (bestScore === null || score > bestScore) {
      bestScore = score;
      bestSnippet = buildMessageSnippet(message.text, query, queryTokens);
    }
  }

  return {
    messageMatchCount: matchCount,
    score: bestScore,
    snippet: bestSnippet,
  };
}

function scoreAction(action: SidebarSearchAction, query: string): number | null {
  if (!query) return 0;

  const label = normalizeText(action.label);
  const description = normalizeText(action.description);
  const keywords = (action.keywords ?? []).map(normalizeText);

  if (label === query) return 140;
  if (label.startsWith(query)) return 120;
  if (keywords.some((keyword) => keyword === query)) return 110;
  if (label.includes(query)) return 100;
  if (keywords.some((keyword) => keyword.includes(query))) return 90;
  if (description.includes(query)) return 70;
  return null;
}

function scoreProject(project: SidebarSearchProject, query: string): number | null {
  if (!query) return null;

  const name = normalizeText(project.name);
  const cwd = normalizeText(project.cwd);
  const folder = normalizeText(basenameOfPath(project.cwd));

  if (name === query) return 150;
  if (folder === query) return 145;
  if (name.startsWith(query)) return 130;
  if (folder.startsWith(query)) return 120;
  if (name.includes(query)) return 105;
  if (folder.includes(query)) return 95;
  if (cwd.includes(query)) return 70;
  return null;
}

export function matchSidebarSearchActions(
  actions: readonly SidebarSearchAction[],
  query: string,
): SidebarSearchAction[] {
  const normalizedQuery = normalizeText(query);

  return actions
    .map((action, index) => ({
      action,
      index,
      score: scoreAction(action, normalizedQuery),
    }))
    .filter((candidate) => candidate.score !== null)
    .toSorted((left, right) => {
      if (left.score !== right.score) return (right.score ?? 0) - (left.score ?? 0);
      return left.index - right.index;
    })
    .map((candidate) => candidate.action);
}

export function matchSidebarSearchProjects(
  projects: readonly SidebarSearchProject[],
  query: string,
  limit = 6,
): SidebarSearchProjectMatch[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  return projects
    .map((project) => ({
      id: `project:${project.id}`,
      project,
      score: scoreProject(project, normalizedQuery),
      recency: Date.parse(project.updatedAt ?? project.createdAt ?? "") || 0,
    }))
    .filter((candidate) => candidate.score !== null)
    .toSorted((left, right) => {
      if (left.score !== right.score) return (right.score ?? 0) - (left.score ?? 0);
      if (left.recency !== right.recency) return right.recency - left.recency;
      return left.project.name.localeCompare(right.project.name);
    })
    .slice(0, limit)
    .map(({ id, project }) => ({ id, project }));
}

export function matchSidebarSearchThreads(
  threads: readonly SidebarSearchThread[],
  query: string,
  limit = 8,
): SidebarSearchThreadMatch[] {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenizeQuery(query);

  if (!normalizedQuery) {
    return threads
      .map((thread) => ({
        id: `thread:${thread.id}`,
        thread,
        matchKind: "title" as const,
        snippet: null,
        messageMatchCount: 0,
        recency: Date.parse(thread.updatedAt ?? thread.createdAt) || 0,
      }))
      .toSorted((left, right) => right.recency - left.recency)
      .slice(0, 5)
      .map(({ id, matchKind, messageMatchCount, snippet, thread }) => ({
        id,
        matchKind,
        messageMatchCount,
        snippet,
        thread,
      }));
  }

  return threads
    .map((thread) => {
      const title = normalizeText(thread.title);
      const projectName = normalizeText(thread.projectName);

      let titleScore: number | null = null;
      if (title === normalizedQuery) {
        titleScore = 220;
      } else if (title.startsWith(normalizedQuery)) {
        titleScore = 200;
      } else if (title.includes(normalizedQuery)) {
        titleScore = 180;
      }

      let projectScore: number | null = null;
      if (projectName === normalizedQuery) {
        projectScore = 130;
      } else if (projectName.startsWith(normalizedQuery)) {
        projectScore = 115;
      } else if (projectName.includes(normalizedQuery)) {
        projectScore = 100;
      }

      const messageMatch = scoreMessage(thread.messages, normalizedQuery, queryTokens);
      const bestScore = Math.max(
        titleScore ?? -Infinity,
        projectScore ?? -Infinity,
        messageMatch.score ?? -Infinity,
      );
      if (!Number.isFinite(bestScore)) {
        return null;
      }

      const matchKind =
        bestScore === (titleScore ?? -Infinity)
          ? ("title" as const)
          : bestScore === (projectScore ?? -Infinity)
            ? ("project" as const)
            : ("message" as const);

      return {
        id: `thread:${thread.id}`,
        thread,
        matchKind,
        snippet: matchKind === "message" ? messageMatch.snippet : null,
        messageMatchCount: messageMatch.messageMatchCount,
        score: bestScore,
        recency: Date.parse(thread.updatedAt ?? thread.createdAt) || 0,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .toSorted((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      if (left.recency !== right.recency) return right.recency - left.recency;
      return left.thread.title.localeCompare(right.thread.title);
    })
    .slice(0, limit)
    .map(({ id, matchKind, messageMatchCount, snippet, thread }) => ({
      id,
      matchKind,
      messageMatchCount,
      snippet,
      thread,
    }));
}

export function hasSidebarSearchResults(input: {
  actions: readonly SidebarSearchAction[];
  projects: readonly SidebarSearchProjectMatch[];
  threads: readonly SidebarSearchThreadMatch[];
}): boolean {
  return input.actions.length > 0 || input.projects.length > 0 || input.threads.length > 0;
}
