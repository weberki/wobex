export interface AssociatedWorktreeMetadata {
  associatedWorktreePath: string | null;
  associatedWorktreeBranch: string | null;
  associatedWorktreeRef: string | null;
}

export interface AssociatedWorktreeMetadataPatch {
  associatedWorktreePath?: string | null;
  associatedWorktreeBranch?: string | null;
  associatedWorktreeRef?: string | null;
}

export interface NormalizeWorkspaceRootForComparisonOptions {
  readonly platform?: string;
}

function isLikelyWindowsWorkspaceRoot(value: string, platform?: string): boolean {
  if (platform === "win32") {
    return true;
  }
  if (platform && platform !== "win32") {
    return false;
  }
  return /^[a-z]:([\\/]|$)/i.test(value) || value.startsWith("\\\\") || value.startsWith("//");
}

export function normalizeWorkspaceRootForComparison(
  value: string,
  options?: NormalizeWorkspaceRootForComparisonOptions,
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const withForwardSlashes = trimmed.replace(/\\/g, "/");
  const hasUncPrefix = withForwardSlashes.startsWith("//");
  const prefix = hasUncPrefix ? "//" : withForwardSlashes.startsWith("/") ? "/" : "";
  const body = withForwardSlashes.slice(prefix.length).replace(/\/+/g, "/");
  const normalized =
    prefix.length > 0 ? `${prefix}${body.replace(/\/+$/g, "")}` : body.replace(/\/+$/g, "");
  const finalValue = normalized.length > 0 ? normalized : prefix;

  if (isLikelyWindowsWorkspaceRoot(trimmed, options?.platform)) {
    return finalValue.toLowerCase();
  }
  return finalValue;
}

export function workspaceRootsEqual(
  left: string,
  right: string,
  options?: NormalizeWorkspaceRootForComparisonOptions,
): boolean {
  return (
    normalizeWorkspaceRootForComparison(left, options) ===
    normalizeWorkspaceRootForComparison(right, options)
  );
}
