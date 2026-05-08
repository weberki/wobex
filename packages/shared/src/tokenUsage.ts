/**
 * Generic value-coercion primitives shared by provider adapters when
 * normalizing provider-specific token-usage payloads into the canonical
 * `ThreadTokenUsageSnapshot` shape.
 *
 * Each provider keeps its own field mapping and context-window handling — this
 * module only supplies the defensive `unknown -> T` coercions so adapters do
 * not re-implement the same finite-number / plain-object guards inline.
 *
 * @module tokenUsage
 */

/**
 * Narrows `value` to an object treated as a `Record<string, unknown>`. Rejects
 * `null` / `undefined` / primitives. Arrays pass through (they are JS objects)
 * — callers that need to exclude arrays should guard with `Array.isArray`
 * first, or use `asArray`.
 */
export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Narrows `value` to a finite `number`. Returns `undefined` for non-numbers,
 * `NaN`, `Infinity`, and `-Infinity`.
 */
export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Narrows `value` to a `string`. Does not trim or filter empties — callers
 * decide whether blank strings are meaningful.
 */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Narrows `value` to a `boolean`. Returns `undefined` for truthy/falsy
 * non-booleans so adapters can distinguish "not provided" from `false`.
 */
export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Narrows `value` to an `unknown[]`. Arrays only — plain objects with numeric
 * keys are not treated as arrays.
 */
export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/**
 * Narrows `value` to a positive finite `number` (`> 0`). Useful for fields
 * like `contextWindow` / `maxTokens` where `0` is semantically absent.
 */
export function asPositiveNumber(value: unknown): number | undefined {
  const n = asNumber(value);
  return n !== undefined && n > 0 ? n : undefined;
}
