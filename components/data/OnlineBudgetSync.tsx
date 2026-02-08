"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

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

  // Small debounced saver.
  const saveTimer = useRef<any>(null);
  const [isHydrating, setIsHydrating] = useState(false);

  const canSync = useMemo(() => isAuthed && isBrowser(), [isAuthed]);

  useEffect(() => {
    if (!canSync) return;

    // Import server snapshot ONCE per user per page load.
    if (importedForUserRef.current === userId) return;
    importedForUserRef.current = userId ?? null;

    let cancelled = false;
    (async () => {
      try {
        setIsHydrating(true);
        const server = await fetchServerSnapshot();
        if (cancelled) return;

        if (server) {
          applySnapshot(server);
        } else {
          // No server data yet => keep local as-is.
          // (Optional later: first-login import could POST local snapshot.)
        }
      } finally {
        if (!cancelled) setIsHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canSync, userId]);

  useEffect(() => {
    if (!canSync) return;

    const scheduleSave = () => {
      if (isHydrating) return; // don't save while importing
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const snap = exportSnapshot();
        pushServerSnapshot(snap).catch(() => {
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
  }, [canSync, isHydrating]);

  return null;
}
