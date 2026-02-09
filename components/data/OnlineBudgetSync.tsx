"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

/**
 * OnlineBudgetSync (React wrapper)
 *
 * What it does (high level):
 * - If NOT authenticated => do nothing (100% local mode)
 * - If authenticated => keep a snapshot of ALL localStorage keys starting with STORAGE_PREFIX in Neon
 *
 * Important behavioral rule (requested):
 * - If local and cloud both have data but differ => AUTO-MERGE (no popup).
 *
 * Implementation detail:
 * - All non-React logic lives in /components/data/sync/budgetSyncEngine.ts
 */
import {
  STORAGE_PREFIX,
  applySnapshot,
  bumpLocalMeta,
  clearLocalPrefix,
  exportSnapshot,
  fetchServerSnapshot,
  hasAnyBudgetData,
  isBrowser,
  mergeSnapshots,
  pushServerSnapshot,
  stableHash,
  withSyncedMeta,
  appendSyncLog,
} from "@/components/data/sync/budgetSyncEngine";

export default function OnlineBudgetSync() {
  const { data: session, status } = useSession();

  // Only run in authenticated mode.
  const userId = (session as any)?.user?.id as string | undefined;
  const isAuthed = status === "authenticated" && !!userId;
  const canSync = useMemo(() => isAuthed && isBrowser(), [isAuthed]);

  // Avoid re-importing on every rerender.
  const importedForUserRef = useRef<string | null>(null);

  // Track auth transitions (used to clear local cache on logout).
  const wasAuthedRef = useRef(false);

  // Small debounced saver (push local changes to the server).
  const saveTimer = useRef<any>(null);
  const [isHydrating, setIsHydrating] = useState(false);

  // Keep a "last local write" timestamp even in guest mode.
  useEffect(() => {
    if (!isBrowser()) return;

    const onAnyChange = () => bumpLocalMeta("write");
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith(STORAGE_PREFIX)) return;
      onAnyChange();
    };

    window.addEventListener("app:storage", onAnyChange as any);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("app:storage", onAnyChange as any);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!canSync) return;

    // Import server snapshot ONCE per user per page load.
    if (importedForUserRef.current === userId) return;
    importedForUserRef.current = userId ?? null;

    let cancelled = false;

    (async () => {
      try {
        appendSyncLog({ level: "info", code: "hydrate.start", message: "Starting initial sync import" });
        setIsHydrating(true);

        const [serverRaw, local] = await Promise.all([
          fetchServerSnapshot(),
          Promise.resolve(exportSnapshot()),
        ]);
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

        // DIFFERENT data => auto-merge (no user prompt).
        const mergedBase = mergeSnapshots(server, local);
        const final = withSyncedMeta(mergedBase, userId!);

        applySnapshot(final);
        await pushServerSnapshot(final);

        bumpLocalMeta("sync", {
          lastSyncedUserId: userId!,
          lastSyncedHash: stableHash(final),
        });
      } catch (err: any) {
        appendSyncLog({
          level: "error",
          code: "hydrate.fail",
          message: err?.message ?? String(err),
          details: { name: err?.name, stack: err?.stack },
        });
      } finally {
        if (!cancelled) setIsHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
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

        // Best-effort push (offline is OK).
        pushServerSnapshot(final).catch((err) => {
          appendSyncLog({ level: "warn", code: "push.fail", message: (err as any)?.message ?? String(err) });
        });
      }, 800);
    };

    // Our app emits `app:storage` for same-tab writes.
    const onAppStorage = () => scheduleSave();
    // Native event for other tabs.
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith(STORAGE_PREFIX)) return;
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

  // Component has no UI.
  return null;
}
