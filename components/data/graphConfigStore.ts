"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readJSON, writeJSON } from "@/components/data/storage";
import { keyGraphConfigFoyer } from "@/components/data/storageKeys";

export type RevenueDetailMode = "none" | "global_per_person" | "detail_per_person" | "auto";

export type GraphConfig = {
  revenueDetailMode: RevenueDetailMode;
  showExpenseTypeSplit: boolean;
  showExpenseOwnerSplit: boolean;
  showObjectsColumn: boolean;
  showBalanceColumn: boolean; // Dépenses(total) + Épargne/Découvert
};

const DEFAULT_CONFIG: GraphConfig = {
  revenueDetailMode: "auto",
  showExpenseTypeSplit: true,
  showExpenseOwnerSplit: true,
  showObjectsColumn: true,
  showBalanceColumn: true,
};

function normalizeConfig(x: Partial<GraphConfig> | null | undefined): GraphConfig {
  const base: GraphConfig = { ...DEFAULT_CONFIG };
  if (!x) return base;

  const mode = x.revenueDetailMode;
  if (mode === "none" || mode === "global_per_person" || mode === "detail_per_person" || mode === "auto") {
    base.revenueDetailMode = mode;
  }
  base.showExpenseTypeSplit = x.showExpenseTypeSplit ?? base.showExpenseTypeSplit;
  base.showExpenseOwnerSplit = x.showExpenseOwnerSplit ?? base.showExpenseOwnerSplit;
  base.showObjectsColumn = x.showObjectsColumn ?? base.showObjectsColumn;
  base.showBalanceColumn = x.showBalanceColumn ?? base.showBalanceColumn;
  return base;
}

export function useGraphConfig(foyerId: string) {
  const key = useMemo(() => keyGraphConfigFoyer(foyerId), [foyerId]);
  const [config, setConfig] = useState<GraphConfig>(() => normalizeConfig(readJSON(key, DEFAULT_CONFIG)));

  // Sync between components in same tab
  useEffect(() => {
    const onAnyStorage = (e: any) => {
      const k = e?.detail?.key;
      if (k !== key) return;
      setConfig(normalizeConfig(readJSON(key, DEFAULT_CONFIG)));
    };
    window.addEventListener("app:storage", onAnyStorage);
    return () => window.removeEventListener("app:storage", onAnyStorage);
  }, [key]);

  // If foyer changes, reload.
  useEffect(() => {
    setConfig(normalizeConfig(readJSON(key, DEFAULT_CONFIG)));
  }, [key]);

  const save = useCallback(
    (next: Partial<GraphConfig>) => {
      const merged = normalizeConfig({ ...config, ...next });
      setConfig(merged);
      writeJSON(key, merged);
    },
    [config, key]
  );

  const reset = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
    writeJSON(key, DEFAULT_CONFIG);
  }, [key]);

  return { config, save, reset };
}
