"use client";

/**
 * Small, shared persistence helpers.
 *
 * Why this file exists:
 * - Many stores in this app persist state in localStorage.
 * - Having one implementation avoids subtle drift (different fallbacks, parsing, etc.).
 * - Keeping helpers tiny + typed makes it easier for another AI (or human) to refactor safely.
 */

/**
 * Generate a reasonably-unique id.
 *
 * We keep the previous behavior (Math.random + Date.now) to avoid any risk of changing
 * ordering / key shapes that could be relied upon by existing data.
 */
export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

/**
 * True only in the browser.
 *
 * Next.js can execute "use client" components during SSR to produce the initial HTML.
 * Any direct access to `window` / `localStorage` must be guarded to avoid server crashes.
 */
const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

export function readJSON<T>(key: string, fallback: T): T {
  try {
    if (!isBrowser()) return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON<T>(key: string, value: T) {
  try {
    if (!isBrowser()) return;
    localStorage.setItem(key, JSON.stringify(value));

    // Notify other hook instances in the SAME tab.
    // (The native `storage` event does not fire in the same document.)
    window.dispatchEvent(
      new CustomEvent("app:storage", {
        detail: { key, ts: Date.now() },
      })
    );
  } catch {
    // Ignore quota / privacy mode errors.
  }
}

/**
 * Sum amounts defensively.
 * Any NaN / non-finite value is treated as 0.
 */
export function sumAmounts(lines: Array<{ amount: number }> | undefined) {
  return (lines ?? []).reduce((s, x) => s + (Number.isFinite(x.amount) ? x.amount : 0), 0);
}

/**
 * Normalize a `{ variables, fixes }` object shape.
 * Used by Expenses store + Menu totals.
 */
export function normalizeExpensesBuckets<T extends { variables?: unknown; fixes?: unknown }>(
  x: T | unknown
): { variables: any[]; fixes: any[] } {
  const base = { variables: [], fixes: [] };
  if (!x || typeof x !== "object") return base;
  const obj = x as any;
  return {
    variables: Array.isArray(obj.variables) ? obj.variables : [],
    fixes: Array.isArray(obj.fixes) ? obj.fixes : [],
  };
}
