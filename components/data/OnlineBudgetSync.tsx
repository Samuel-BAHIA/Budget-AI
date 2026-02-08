"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { keySyncMeta } from "@/components/data/storageKeys";

/**
 * OnlineBudgetSync
 *
 * Goal:
 * - If NOT authenticated => do nothing (100% local mode)
 * - If authenticated => keep a snapshot of ALL localStorage keys starting with "test." in Neon.
 *
 * Why snapshot localStorage instead of refactoring all stores?
 * - The app already persists many independent slices (foyers, flows, profile, graph config...).
 * - Syncing a raw snapshot keeps the existing architecture untouched.
 */

type Snapshot = {
  v: 1;
  /** Map of localStorage key -> raw string value */
  storage: Record<string, string>;
};

type SyncMeta = {
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

const PREFIX = "test.";

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function exportSnapshot(): Snapshot {
  const storage: Record<string, string> = {};
  if (!isBrowser()) return { v: 1, storage };

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const val = localStorage.getItem(key);
    if (val == null) continue;
    storage[key] = val; // keep raw string (JSON or plain)
  }
  return { v: 1, storage };
}

function safeReadMetaFromSnapshot(snapshot: Snapshot | null): SyncMeta | null {
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

function bumpLocalMeta(reason: "write" | "sync", extras?: Partial<SyncMeta>) {
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

function hasAnyBudgetData(snapshot: Snapshot | null): boolean {
  if (!snapshot) return false;
  for (const k of Object.keys(snapshot.storage ?? {})) {
    if (!k.startsWith(PREFIX)) continue;
    if (k === keySyncMeta) continue;
    return true;
  }
  return false;
}

function stableHash(snapshot: Snapshot): string {
  // Fast-enough fingerprint for conflict detection (not cryptographic).
  // Excludes sync meta to avoid false diffs.
  const keys = Object.keys(snapshot.storage)
    .filter((k) => k.startsWith(PREFIX) && k !== keySyncMeta)
    .sort();
  let acc = "";
  for (const k of keys) {
    acc += k;
    acc += "\u0000";
    acc += snapshot.storage[k] ?? "";
    acc += "\u0001";
  }
  // Simple DJB2-like hash
  let h = 5381;
  for (let i = 0; i < acc.length; i++) {
    h = (h * 33) ^ acc.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

function clearLocalPrefix() {
  if (!isBrowser()) return;
  const toDelete: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
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

function parseMaybeDateMs(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const t = Date.parse(x);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function getUpdatedAtMs(obj: any): number | null {
  if (!obj || typeof obj !== "object") return null;
  // Common timestamp fields used across apps/stores
  const candidates = [
    (obj as any).updatedAt,
    (obj as any).updated_at,
    (obj as any).lastModifiedAt,
    (obj as any).lastModified,
    (obj as any).modifiedAt,
    (obj as any).modified_at,
    (obj as any).lastUpdatedAt,
    (obj as any).last_updated_at,
  ];
  for (const c of candidates) {
    const ms = parseMaybeDateMs(c);
    if (ms != null) return ms;
  }
  return null;
}

function deepMergePreferNewer(a: any, b: any): any {
  // Merge strategy:
  // - Objects: recursive
  // - Arrays:
  //    * If items are objects with `id`, union by id and prefer the most recently updated item
  //      when both sides contain the same id.
  //    * Otherwise, union unique values (stable-ish).
  // - Primitives: prefer b (the right side).
  if (Array.isArray(a) && Array.isArray(b)) {
    const aObjs = a.every((x) => x && typeof x === "object" && "id" in x);
    const bObjs = b.every((x) => x && typeof x === "object" && "id" in x);

    if (aObjs && bObjs) {
      const map = new Map<string, any>();
      for (const item of a) map.set(String((item as any).id), item);

      for (const item of b) {
        const id = String((item as any).id);
        const prev = map.get(id);
        if (!prev) {
          map.set(id, item);
          continue;
        }

        // Prefer the newest version (by updatedAt-ish field) for conflicts on the same object id.
        const prevTs = getUpdatedAtMs(prev);
        const nextTs = getUpdatedAtMs(item);

        if (prevTs != null && nextTs != null) {
          const older = prevTs <= nextTs ? prev : item;
          const newer = prevTs <= nextTs ? item : prev;
          map.set(id, deepMergePreferNewer(older, newer));
        } else {
          // Fallback: right side wins but still deep-merge.
          map.set(id, deepMergePreferNewer(prev, item));
        }
      }

      return Array.from(map.values());
    }

    // primitive arrays (or mixed): union by JSON stringified value
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
      out[k] = k in out ? deepMergePreferNewer((out as any)[k], v) : v;
    }
    return out;
  }

  return b;
}

function mergeSnapshots(server: Snapshot | null, local: Snapshot): Snapshot {
  const merged: Snapshot = { v: 1, storage: { ...(server?.storage ?? {}) } };

  for (const [k, localRaw] of Object.entries(local.storage)) {
    if (!k.startsWith(PREFIX)) continue;
    const serverRaw = merged.storage[k];
    if (serverRaw == null) {
      merged.storage[k] = localRaw;
      continue;
    }

    // Try to merge JSON payloads; fallback to local overwrite.
    const a = safeParseJSON(serverRaw);
    const b = safeParseJSON(localRaw);
    if (a.ok && b.ok) {
      merged.storage[k] = JSON.stringify(deepMergePreferNewer(a.value, b.value));
    } else {
      merged.storage[k] = localRaw;
    }
  }

  return merged;
}

function applySnapshot(snapshot: Snapshot) {
  if (!isBrowser()) return;

  const entries = Object.entries(snapshot?.storage ?? {});
  for (const [k, v] of entries) {
    if (!k.startsWith(PREFIX)) continue;
    try {
      localStorage.setItem(k, v);
    } catch {
      // ignore quota/privacy errors
    }
  }

  // Let the app react to the restored data in the same tab.
  window.dispatchEvent(new CustomEvent("app:storage", { detail: { key: "*", ts: Date.now() } }));
}

async function fetchServerSnapshot(): Promise<Snapshot | null> {
  const res = await fetch("/api/budget-state", { method: "GET" });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: unknown };
  const data = json?.data as any;
  if (!data || typeof data !== "object") return null;
  if (data.v !== 1 || typeof data.storage !== "object") return null;
  return data as Snapshot;
}

async function pushServerSnapshot(snapshot: Snapshot) {
  await fetch("/api/budget-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: snapshot }),
  });
}

export default function OnlineBudgetSync() {
  const { data: session, status } = useSession();

  // Only run in authenticated mode.
  const userId = (session as any)?.user?.id as string | undefined;
  const isAuthed = status === "authenticated" && !!userId;

  // Avoid re-importing on every rerender.
  const importedForUserRef = useRef<string | null>(null);

  // Track auth transitions (used to clear local cache on logout).
  const wasAuthedRef = useRef(false);

  // Small debounced saver.
  const saveTimer = useRef<any>(null);
  const [isHydrating, setIsHydrating] = useState(false);

  const [conflict, setConflict] = useState<null | { server: Snapshot; local: Snapshot }>(null);
  const resolveRef = useRef<null | ((choice: "merge" | "local" | "cloud") => void)>(null);

  const canSync = useMemo(() => isAuthed && isBrowser(), [isAuthed]);

  // Keep a "last local write" timestamp even in guest mode.
  useEffect(() => {
    if (!isBrowser()) return;

    const onAnyChange = () => bumpLocalMeta("write");
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith(PREFIX)) return;
      onAnyChange();
    };

    window.addEventListener("app:storage", onAnyChange as any);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("app:storage", onAnyChange as any);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function withSyncedMeta(snapshot: Snapshot, userId: string): Snapshot {
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

  useEffect(() => {
    if (!canSync) return;

    // Import server snapshot ONCE per user per page load.
    if (importedForUserRef.current === userId) return;
    importedForUserRef.current = userId ?? null;

    let cancelled = false;

    const resolve = async (choice: "merge" | "local" | "cloud", server: Snapshot, local: Snapshot) => {
      // Common UX rules:
      // - If the user chooses "cloud" => local is replaced (data loss on this browser)
      // - If the user chooses "local" => cloud is replaced (data loss in cloud)
      // - "merge" tries to combine both (recommended)
      const finalBase =
        choice === "cloud" ? server : choice === "local" ? local : mergeSnapshots(server, local);
      const final = withSyncedMeta(finalBase, userId!);
      applySnapshot(final);
      // Always write back, even when choosing cloud, so we store a consistent snapshot (incl. meta)
      // and avoid repeated prompts on the next reload.
      await pushServerSnapshot(final);
      bumpLocalMeta("sync", {
        lastSyncedUserId: userId!,
        lastSyncedHash: stableHash(final),
      });
    };

    (async () => {
      try {
        setIsHydrating(true);
        setConflict(null);
        const [serverRaw, local] = await Promise.all([fetchServerSnapshot(), Promise.resolve(exportSnapshot())]);
        if (cancelled) return;

        const server = serverRaw ?? { v: 1, storage: {} };
        const localHas = hasAnyBudgetData(local);
        const serverHas = hasAnyBudgetData(server);

        // 1) Cloud empty => upload local silently.
        if (!serverHas && localHas) {
          const final = withSyncedMeta(local, userId!);
          applySnapshot(final);
          await pushServerSnapshot(final);
          return;
        }

        // 2) Local empty => pull cloud silently.
        if (serverHas && !localHas) {
          const final = withSyncedMeta(server, userId!);
          applySnapshot(final);
          return;
        }

        // 3) Both empty => nothing to do.
        if (!serverHas && !localHas) {
          return;
        }

        // 4) Both have data.
        const serverHash = stableHash(server);
        const localHash = stableHash(local);
        if (serverHash === localHash) {
          // Already identical => just ensure meta is set.
          const final = withSyncedMeta(server, userId!);
          applySnapshot(final);
          return;
        }

        const mServer = safeReadMetaFromSnapshot(server);
        const mLocal = safeReadMetaFromSnapshot(local);

        // Common & efficient strategy:
        // - If we can reliably detect which side is newer (>= 30 min), we auto-pick the newest.
        // - Otherwise we ask the user (prevents silent data loss).
        const THRESHOLD_MS = 30 * 60 * 1000;
        if (mServer && mLocal && Math.abs(mServer.updatedAt - mLocal.updatedAt) >= THRESHOLD_MS) {
          const takeLocal = mLocal.updatedAt > mServer.updatedAt;
          await resolve(takeLocal ? "local" : "cloud", server, local);
          return;
        }

        // Default behavior: always merge automatically (no prompt).
        await resolve("merge", server, local);
        return;
      } finally {
        if (!cancelled) setIsHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
      resolveRef.current = null;
    };
  }, [canSync, userId]);

  useEffect(() => {
    // Clear local guest cache on logout to avoid infinite re-merges.
    const isNowAuthed = isAuthed;
    const wasAuthed = wasAuthedRef.current;
    wasAuthedRef.current = isNowAuthed;

    if (wasAuthed && !isNowAuthed) {
      importedForUserRef.current = null;
      clearLocalPrefix();
    }
  }, [isAuthed]);

  useEffect(() => {
    if (!canSync) return;

    const scheduleSave = () => {
      if (isHydrating) return; // don't save while importing
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const snap = exportSnapshot();
        const final = withSyncedMeta(snap, userId!);
        pushServerSnapshot(final).catch(() => {
          // ignore network errors (offline, etc.)
        });
      }, 800);
    };

    // Our app emits `app:storage` for same-tab writes.
    const onAppStorage = () => scheduleSave();
    // Native event for other tabs.
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith(PREFIX)) return;
      scheduleSave();
    };

    window.addEventListener("app:storage", onAppStorage as any);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("app:storage", onAppStorage as any);
      window.removeEventListener("storage", onStorage);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [canSync, isHydrating, userId]);

  if (!conflict) return null;

  // Minimal, dependency-free conflict dialog.
  // This triggers only when both local AND cloud have data and we can't confidently
  // auto-pick which one is newer.
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(680px, 100%)",
          background: "white",
          borderRadius: 16,
          padding: 20,
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Synchronisation des données</div>
        <div style={{ fontSize: 14, lineHeight: 1.45, marginBottom: 14 }}>
          On a trouvé des données <b>sur ce navigateur</b> et aussi <b>sur ton compte</b>.
          <br />
          Choisis quoi faire. (Recommandé : <b>Fusionner</b>.)
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => resolveRef.current?.("merge")}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #ddd",
              background: "#111",
              color: "white",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Fusionner (recommandé)
          </button>

          <button
            type="button"
            onClick={() => resolveRef.current?.("local")}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #ddd",
              background: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Garder les données de ce navigateur (remplace le cloud)
          </button>

          <button
            type="button"
            onClick={() => resolveRef.current?.("cloud")}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #ddd",
              background: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Utiliser les données du compte (remplace ce navigateur)
          </button>
        </div>

        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 12 }}>
          Astuce : si tu choisis "Utiliser les données du compte", les données locales de ce navigateur seront
          écrasées.
        </div>
      </div>
    </div>
  );
}
