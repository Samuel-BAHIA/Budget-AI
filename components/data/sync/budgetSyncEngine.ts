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

import { keyLocalSyncState, keySyncMeta } from "@/components/data/storageKeys";

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

// A synced key that records deletions (tombstones) so deletes do not resurrect across devices.
const TOMBSTONES_KEY = `${STORAGE_PREFIX}__tombstones.v1`;

// When a JSON value contains an array of objects with an `id`, we also need deletion semantics
// at the item level (ex: deleting a foyer inside `test.foyers.v1`).
//
// We encode those deletions as tombstones with a composite key:
//   "<storageKey>::id::<id>" -> deletedAt
const ID_TOMBSTONE_SEP = "::id::";

// Local-only ring buffer of sync events (NOT synced, helps debugging across builds).
const SYNC_LOG_KEY = "__budget.syncLog.v1";

export type SyncLogEntry = {
  ts: number;
  level: "info" | "warn" | "error";
  code: string;
  message?: string;
  details?: any;
};

export function appendSyncLog(entry: Omit<SyncLogEntry, "ts"> & { ts?: number }) {
  if (!isBrowser()) return;
  try {
    const raw = localStorage.getItem(SYNC_LOG_KEY);
    const prev = raw ? (JSON.parse(raw) as any[]) : [];
    const next = Array.isArray(prev) ? prev.slice(-199) : [];
    next.push({ ts: entry.ts ?? Date.now(), ...entry });
    localStorage.setItem(SYNC_LOG_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function readSyncLog(): SyncLogEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(SYNC_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SyncLogEntry[]) : [];
  } catch {
    return [];
  }
}

// Local-only state used to detect deletions on this device.
// - lastKeys: detect deleted localStorage KEYS
// - lastIdsByKey: detect deleted ITEMS inside JSON arrays that have objects with an `id` field
type LocalSyncState = {
  v: 1;
  lastKeys: string[];
  lastIdsByKey?: Record<string, string[]>;
};

/** Runtime guard: localStorage is only available in the browser. */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Export every localStorage entry starting with STORAGE_PREFIX. */
export function exportSnapshot(): Snapshot {
  const storage: Record<string, string> = {};
  if (!isBrowser()) return { v: 1, storage };

  // Ensure deletions are captured as tombstones before taking a snapshot.
  reconcileTombstonesWithLocalKeys();
  reconcileItemTombstonesWithLocalState();

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
    if (k === TOMBSTONES_KEY) continue;
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
    .filter((k) => k.startsWith(STORAGE_PREFIX) && k !== keySyncMeta && k !== TOMBSTONES_KEY)
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

export 
function safeReadLocalSyncState(): LocalSyncState | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(keyLocalSyncState);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 1 && Array.isArray(parsed.lastKeys)) return parsed as LocalSyncState;
  } catch {}
  return null;
}

function writeLocalSyncState(state: LocalSyncState) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(keyLocalSyncState, JSON.stringify(state));
  } catch {}
}

type Tombstones = Record<string, number>; // key -> deletedAt (ms since epoch)

function readTombstonesFromStorage(): Tombstones {
  if (!isBrowser()) return {};
  try {
    const raw = localStorage.getItem(TOMBSTONES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Tombstones;
  } catch {}
  return {};
}

function writeTombstonesToStorage(tombstones: Tombstones) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones));
  } catch {}
}

function readTombstonesFromSnapshot(snapshot: Snapshot | null): Tombstones {
  if (!snapshot) return {};
  const raw = snapshot.storage?.[TOMBSTONES_KEY];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Tombstones;
  } catch {}
  return {};
}

/**
 * Detect deletions on this device by comparing current keys with lastKeys,
 * and record them as tombstones (synced). Also clears tombstones when a key exists again.
 */
function reconcileTombstonesWithLocalKeys(now = Date.now()) {
  if (!isBrowser()) return;

  const prev = safeReadLocalSyncState();
  const prevKeys = new Set(prev?.lastKeys ?? []);

  const currentKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
    if (k === TOMBSTONES_KEY) continue;
    currentKeys.push(k);
  }
  const currentSet = new Set(currentKeys);

  // Missing keys are treated as deletions since last export.
  const tombstones = readTombstonesFromStorage();
  let changed = false;

  for (const k of prevKeys) {
    if (!k.startsWith(STORAGE_PREFIX)) continue;
    if (k === TOMBSTONES_KEY) continue;
    if (!currentSet.has(k)) {
      // Record deletion time if not present (or keep the newest).
      const existing = tombstones[k] ?? 0;
      if (now > existing) {
        tombstones[k] = now;
        changed = true;
      }
    }
  }

  // If a key exists again, remove any tombstone for it (user recreated it).
  for (const k of currentSet) {
    if (tombstones[k] != null) {
      delete tombstones[k];
      changed = true;
    }
  }

  if (changed) writeTombstonesToStorage(tombstones);
  // Preserve any item-level tracking already stored.
  writeLocalSyncState({ v: 1, lastKeys: currentKeys, lastIdsByKey: prev?.lastIdsByKey ?? {} });
}

function makeItemTombstoneKey(storageKey: string, id: string): string {
  return `${storageKey}${ID_TOMBSTONE_SEP}${id}`;
}

function splitItemTombstoneKey(tombstoneKey: string): { storageKey: string; id: string } | null {
  const idx = tombstoneKey.indexOf(ID_TOMBSTONE_SEP);
  if (idx <= 0) return null;
  return {
    storageKey: tombstoneKey.slice(0, idx),
    id: tombstoneKey.slice(idx + ID_TOMBSTONE_SEP.length),
  };
}

/**
 * Detect deletions of items INSIDE JSON arrays with an `id` field.
 *
 * Example: `test.foyers.v1` is a JSON array of `{ id, ... }`.
 * Deleting one foyer does NOT remove the localStorage key, so key-level tombstones are not enough.
 *
 * We track the last seen ids per storage key (local-only), and create tombstones like:
 *   "test.foyers.v1::id::f-123" -> deletedAt
 */
function reconcileItemTombstonesWithLocalState(now = Date.now()) {
  if (!isBrowser()) return;

  const prev = safeReadLocalSyncState();
  const prevIdsByKey: Record<string, string[]> = prev?.lastIdsByKey ?? {};
  const nextIdsByKey: Record<string, string[]> = { ...prevIdsByKey };

  const tombstones = readTombstonesFromStorage();
  let changed = false;

  // Scan current snapshot keys and detect arrays of objects with `id`.
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    if (key === TOMBSTONES_KEY) continue;

    const raw = localStorage.getItem(key);
    if (raw == null) continue;

    const parsed = safeParseJSON(raw);
    if (!parsed.ok) continue;

    const value = parsed.value;
    if (!Array.isArray(value)) continue;
    const isObjWithId = value.every((x) => x && typeof x === "object" && !Array.isArray(x) && "id" in x);
    if (!isObjWithId) continue;

    const currentIds = value.map((x: any) => String(x.id));
    nextIdsByKey[key] = currentIds;

    const prevIds = new Set(prevIdsByKey[key] ?? []);
    const currentSet = new Set(currentIds);

    // Missing ids since last export are deletions.
    for (const id of prevIds) {
      if (!currentSet.has(id)) {
        const tk = makeItemTombstoneKey(key, id);
        const existing = tombstones[tk] ?? 0;
        if (now > existing) {
          tombstones[tk] = now;
          changed = true;
        }
      }
    }

    // If an id exists again, remove tombstone (user recreated/restored it).
    for (const id of currentSet) {
      const tk = makeItemTombstoneKey(key, id);
      if (tombstones[tk] != null) {
        delete tombstones[tk];
        changed = true;
      }
    }
  }

  if (changed) writeTombstonesToStorage(tombstones);

  // Persist local-only tracking.
  const prevKeys = prev?.lastKeys ?? [];
  writeLocalSyncState({ v: 1, lastKeys: prevKeys, lastIdsByKey: nextIdsByKey });
}

/**
 * Remove ALL localStorage keys that belong to the budget app (STORAGE_PREFIX).
 *
 * Used on logout to avoid re-importing stale guest data after a new sign-in.
 */
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

function collectTombstonedIds(storageKey: string, tombstones: Tombstones): Set<string> {
  const out = new Set<string>();
  const prefix = `${storageKey}${ID_TOMBSTONE_SEP}`;
  for (const k of Object.keys(tombstones)) {
    if (!k.startsWith(prefix)) continue;
    const info = splitItemTombstoneKey(k);
    if (info?.id) out.add(info.id);
  }
  return out;
}

function applyItemTombstonesToJsonValue(storageKey: string, value: any, tombstones: Tombstones): any {
  if (!Array.isArray(value)) return value;
  const isObjWithId = value.every((x) => x && typeof x === "object" && !Array.isArray(x) && "id" in x);
  if (!isObjWithId) return value;
  const deletedIds = collectTombstonedIds(storageKey, tombstones);
  if (deletedIds.size === 0) return value;
  return value.filter((x: any) => !deletedIds.has(String(x.id)));
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
      for (const item of a) map.set(String((item as any).id), item);

      for (const item of b) {
        const id = String((item as any).id);
        const prev = map.get(id);

        // Timestamp-aware merge:
        // If both sides carry an `updatedAt` (or `_updatedAt`) number, keep the newest whole object
        // to avoid losing more recent edits across devices.
        const prevTs = prev && typeof prev === "object" ? ((prev as any).updatedAt ?? (prev as any)._updatedAt) : undefined;
        const itemTs =
          item && typeof item === "object" ? ((item as any).updatedAt ?? (item as any)._updatedAt) : undefined;

        if (typeof prevTs === "number" && typeof itemTs === "number" && prevTs !== itemTs) {
          map.set(id, itemTs > prevTs ? item : prev);
        } else {
          map.set(id, prev ? deepMerge(prev, item) : item);
        }
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
  const base: Snapshot = { v: 1, storage: { ...(server?.storage ?? {}) } };

  // 1) Merge tombstones (deletions) first.
  const serverT = readTombstonesFromSnapshot(server);
  const localT = readTombstonesFromSnapshot(local);
  const mergedT: Tombstones = { ...serverT };
  for (const [k, ts] of Object.entries(localT)) {
    mergedT[k] = Math.max(mergedT[k] ?? 0, ts ?? 0);
  }

  // Always persist merged tombstones in the resulting snapshot.
  base.storage[TOMBSTONES_KEY] = JSON.stringify(mergedT);

  // 2) Merge normal keys (local takes precedence via JSON deep merge, otherwise overwrite).
  for (const [k, localRaw] of Object.entries(local.storage)) {
    if (!k.startsWith(STORAGE_PREFIX)) continue;
    if (k === TOMBSTONES_KEY) continue;

    // If the key is tombstoned anywhere, deletion wins.
    if (mergedT[k] != null) continue;

    const serverRaw = base.storage[k];
    if (serverRaw == null) {
      base.storage[k] = localRaw;
      continue;
    }

    const a = safeParseJSON(serverRaw);
    const b = safeParseJSON(localRaw);
    if (a.ok && b.ok) {
      // Apply item-level tombstones before AND after merge to avoid resurrecting deletions
      // inside JSON arrays (ex: deleting one foyer inside `test.foyers.v1`).
      const serverValue = applyItemTombstonesToJsonValue(k, a.value, mergedT);
      const localValue = applyItemTombstonesToJsonValue(k, b.value, mergedT);
      const mergedValue = deepMerge(serverValue, localValue);
      base.storage[k] = JSON.stringify(applyItemTombstonesToJsonValue(k, mergedValue, mergedT));
    } else {
      base.storage[k] = localRaw;
    }
  }

  // 3) Enforce deletions: remove any tombstoned keys from the snapshot.
  for (const k of Object.keys(mergedT)) {
    delete base.storage[k];
  }

  return base;
}

/** Apply a snapshot into localStorage and notify the app. */
export function applySnapshot(snapshot: Snapshot) {
  if (!isBrowser()) return;

  const desired = new Set<string>();
  for (const k of Object.keys(snapshot?.storage ?? {})) {
    if (!k.startsWith(STORAGE_PREFIX)) continue;
    desired.add(k);
  }

  const tombstones = readTombstonesFromSnapshot(snapshot);

  // Apply incoming values.
  for (const [k, v] of Object.entries(snapshot?.storage ?? {})) {
    if (!k.startsWith(STORAGE_PREFIX)) continue;
    try {
      localStorage.setItem(k, v);
    } catch {
      // ignore quota/privacy errors
    }
  }

  // Item-level deletions: if some items inside an array were deleted on another device,
  // we must remove them locally (otherwise deepMerge would resurrect them).
  for (const k of desired) {
    if (k === TOMBSTONES_KEY) continue;
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    const parsed = safeParseJSON(raw);
    if (!parsed.ok) continue;
    const cleaned = applyItemTombstonesToJsonValue(k, parsed.value, tombstones);
    if (cleaned !== parsed.value) {
      try {
        localStorage.setItem(k, JSON.stringify(cleaned));
      } catch {}
    }
  }

  // Enforce deletions:
  // - remove any local keys that are not present in the snapshot
  // - and remove any keys listed in the synced tombstones
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
    if (k === TOMBSTONES_KEY) continue;

    const shouldDelete = tombstones[k] != null || !desired.has(k);
    if (shouldDelete) {
      try {
        localStorage.removeItem(k);
      } catch {}
    }
  }

  // Keep local-only deletion detector aligned after apply.
  reconcileTombstonesWithLocalKeys();
  reconcileItemTombstonesWithLocalState();

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
