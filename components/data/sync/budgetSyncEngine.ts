/**
 * budgetSyncEngine.ts
 *
 * A small, dependency-free engine used by <OnlineBudgetSync /> to keep the user's
 * local budget state (localStorage) in sync with the server snapshot.
 *
 * Design goals (for humans + other AIs):
 * - Single responsibility: only snapshot/export/apply/merge + meta.
 * - Explicit inputs/outputs: functions are pure where possible.
 * - No React inside this file.
 *
 * Key idea:
 * - We sync a *raw snapshot* of localStorage keys (PREFIX="test.") instead of coupling
 *   to each store's internal structure.
 */

import { keySyncMeta } from "@/components/data/storageKeys";

export type Snapshot = {
  v: 1;
  /** Map of localStorage key -> raw string value */
  storage: Record<string, string>;
};

export type SyncMeta = {
  v: 1;
  /** Last local write (ms since epoch). */
  updatedAt: number;
  /** Last successful sync to cloud (ms since epoch). */
  lastSyncedAt?: number;
  /** Which user the last sync was for. */
  lastSyncedUserId?: string;
  /** Fingerprint of the snapshot that was last synced (helps avoid re-sync loops). */
  lastSyncedHash?: string;
};

export const STORAGE_PREFIX = "test.";

/** Runtime guard: localStorage is only available in the browser. */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Export every localStorage entry starting with STORAGE_PREFIX. */
export function exportSnapshot(): Snapshot {
  const storage: Record<string, string> = {};
  if (!isBrowser()) return { v: 1, storage };

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const val = localStorage.getItem(key);
    if (val == null) continue;
    storage[key] = val; // keep raw string (JSON or plain)
  }
  return { v: 1, storage };
}

export function safeReadMetaFromSnapshot(snapshot: Snapshot | null): SyncMeta | null {
  if (!snapshot) return null;
  const raw = snapshot.storage?.[keySyncMeta];
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as SyncMeta;
    if (!m || typeof m !== "object" || m.v !== 1) return null;
    if (typeof (m as any).updatedAt !== "number") return null;
    return m;
  } catch {
    return null;
  }
}

/**
 * Update the local sync meta.
 * - reason="write": bump updatedAt
 * - reason="sync": bump lastSyncedAt
 */
export function bumpLocalMeta(reason: "write" | "sync", extras?: Partial<SyncMeta>) {
  if (!isBrowser()) return;
  try {
    const prevRaw = localStorage.getItem(keySyncMeta);
    const prev = prevRaw ? (JSON.parse(prevRaw) as SyncMeta) : null;
    const base: SyncMeta = {
      v: 1,
      updatedAt: typeof prev?.updatedAt === "number" ? prev.updatedAt : Date.now(),
      lastSyncedAt: prev?.lastSyncedAt,
      lastSyncedUserId: prev?.lastSyncedUserId,
      lastSyncedHash: prev?.lastSyncedHash,
    };

    const now = Date.now();
    const next: SyncMeta = {
      ...base,
      ...(reason === "write" ? { updatedAt: now } : null),
      ...(reason === "sync" ? { lastSyncedAt: now } : null),
      ...(extras ?? {}),
    };

    localStorage.setItem(keySyncMeta, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/** Returns true if snapshot contains any "real" budget key (excluding sync meta). */
export function hasAnyBudgetData(snapshot: Snapshot | null): boolean {
  if (!snapshot) return false;
  for (const k of Object.keys(snapshot.storage ?? {})) {
    if (!k.startsWith(STORAGE_PREFIX)) continue;
    if (k === keySyncMeta) continue;
    return true;
  }
  return false;
}

/**
 * Fast-enough fingerprint for conflict detection (not cryptographic).
 * Excludes sync meta to avoid false diffs.
 */
export function stableHash(snapshot: Snapshot): string {
  const keys = Object.keys(snapshot.storage)
    .filter((k) => k.startsWith(STORAGE_PREFIX) && k !== keySyncMeta)
    .sort();

  let acc = "";
  for (const k of keys) {
    acc += k;
    acc += "\u0000";
    acc += snapshot.storage[k] ?? "";
    acc += "\u0001";
  }

  // DJB2-like hash
  let h = 5381;
  for (let i = 0; i < acc.length; i++) {
    h = (h * 33) ^ acc.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function clearLocalPrefix() {
  if (!isBrowser()) return;
  const toDelete: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    toDelete.push(key);
  }
  for (const k of toDelete) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
  window.dispatchEvent(new CustomEvent("app:storage", { detail: { key: "*", ts: Date.now() } }));
}

function safeParseJSON(x: string) {
  try {
    return { ok: true as const, value: JSON.parse(x) };
  } catch {
    return { ok: false as const, value: null };
  }
}

/**
 * Deep merge strategy for JSON payloads.
 *
 * Conflicts:
 * - "local" (b) wins on primitive conflicts.
 * Arrays:
 * - If items are objects with an `id` property => union/merge by id.
 * - Otherwise => union by value (JSON-stringified).
 */
export function deepMerge(serverValue: any, localValue: any): any {
  const a = serverValue;
  const b = localValue;

  if (Array.isArray(a) && Array.isArray(b)) {
    const aObjs = a.every((x) => x && typeof x === "object" && "id" in x);
    const bObjs = b.every((x) => x && typeof x === "object" && "id" in x);

    if (aObjs && bObjs) {
      const map = new Map<string, any>();
      for (const item of a) map.set(String(item.id), item);
      for (const item of b) {
        const id = String(item.id);
        const prev = map.get(id);
        map.set(id, prev ? deepMerge(prev, item) : item);
      }
      return Array.from(map.values());
    }

    const seen = new Set<string>();
    const out: any[] = [];
    for (const item of [...a, ...b]) {
      const key = typeof item === "string" ? `s:${item}` : `j:${JSON.stringify(item)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  const aObj = a && typeof a === "object" && !Array.isArray(a);
  const bObj = b && typeof b === "object" && !Array.isArray(b);
  if (aObj && bObj) {
    const out: any = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] = k in out ? deepMerge((out as any)[k], v) : v;
    }
    return out;
  }

  return b;
}

/**
 * Merge two snapshots into one.
 * - The base is the server snapshot (if any)
 * - Every local key overwrites/merges into it
 */
export function mergeSnapshots(server: Snapshot | null, local: Snapshot): Snapshot {
  const merged: Snapshot = { v: 1, storage: { ...(server?.storage ?? {}) } };

  for (const [k, localRaw] of Object.entries(local.storage)) {
    if (!k.startsWith(STORAGE_PREFIX)) continue;

    const serverRaw = merged.storage[k];
    if (serverRaw == null) {
      merged.storage[k] = localRaw;
      continue;
    }

    // Merge JSON payloads; fallback to local overwrite.
    const a = safeParseJSON(serverRaw);
    const b = safeParseJSON(localRaw);
    if (a.ok && b.ok) {
      merged.storage[k] = JSON.stringify(deepMerge(a.value, b.value));
    } else {
      merged.storage[k] = localRaw;
    }
  }

  return merged;
}

/** Apply a snapshot into localStorage and notify the app. */
export function applySnapshot(snapshot: Snapshot) {
  if (!isBrowser()) return;

  for (const [k, v] of Object.entries(snapshot?.storage ?? {})) {
    if (!k.startsWith(STORAGE_PREFIX)) continue;
    try {
      localStorage.setItem(k, v);
    } catch {
      // ignore quota/privacy errors
    }
  }

  window.dispatchEvent(new CustomEvent("app:storage", { detail: { key: "*", ts: Date.now() } }));
}

/** Add/update sync meta in a snapshot before persisting to server. */
export function withSyncedMeta(snapshot: Snapshot, userId: string): Snapshot {
  const hash = stableHash(snapshot);
  const meta: SyncMeta = {
    v: 1,
    updatedAt: safeReadMetaFromSnapshot(snapshot)?.updatedAt ?? Date.now(),
    lastSyncedAt: Date.now(),
    lastSyncedUserId: userId,
    lastSyncedHash: hash,
  };
  return { v: 1, storage: { ...snapshot.storage, [keySyncMeta]: JSON.stringify(meta) } };
}

/** GET snapshot from API. Returns null on any invalid response. */
export async function fetchServerSnapshot(): Promise<Snapshot | null> {
  const res = await fetch("/api/budget-state", { method: "GET" });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: unknown };
  const data = json?.data as any;
  if (!data || typeof data !== "object") return null;
  if (data.v !== 1 || typeof data.storage !== "object") return null;
  return data as Snapshot;
}

/** POST snapshot to API (best-effort). */
export async function pushServerSnapshot(snapshot: Snapshot): Promise<void> {
  await fetch("/api/budget-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: snapshot }),
  });
}
