"use client";

import { useMemo } from "react";
import { useUsers } from "@/components/user/UserProvider";
import { normalizeExpensesBuckets, readJSON, sumAmounts } from "@/components/data/storage";
import { assetNet, rentalNet } from "@/components/data/estateMath";
import { ownersForEstate, ownersForFlows } from "@/components/data/owners";
import {
  keyAssetsFoyer,
  keyAssetsPerson,
  keyExpensesFoyer,
  keyExpensesPerson,
  keyRentalsFoyer,
  keyRentalsPerson,
  keyRevenusFoyer,
  keyRevenusPerson,
} from "@/components/data/storageKeys";

export type MenuTotals = {
  depenses: number;
  revenus: number;
  bilan: number;
  depensesVariables: number;
  depensesFixes: number;
  patrimoineNet: number;
  locationsNet: number;
};

export type MenuTotalsKey = keyof MenuTotals;

type StoredAsset = { incomes: { amount: number }[]; expenses: { amount: number }[] };
type StoredRental = { expenses: { amount: number }[] };
type StoredLine = { amount: number };
type StoredExpenses = { variables: StoredLine[]; fixes: StoredLine[] };

const sum = (lines: StoredLine[] | undefined) => sumAmounts(lines);
const normalizeExpenses = (x: unknown): StoredExpenses => normalizeExpensesBuckets(x) as StoredExpenses;

export function useMenuTotals(): MenuTotals {
  const { activeUserId, isGlobal, activeFoyerId, personIdsInActiveFoyer } = useUsers();

  return useMemo(() => {
    /**
     * Menu totals are the "single source of truth" for the top-level UI summary.
     *
     * WHY
     * - The menu totals MUST match what the user sees inside the dedicated pages.
     *   (Expenses/Revenues pages, Estate pages)
     *
     * HOW
     * - We iterate over the exact same owner perimeter as the underlying stores:
     *   - Flows: include foyer ONLY in Global mode, + persons depending on Global.
     *   - Estate: include foyer ALWAYS, + persons depending on Global.
     *
     * DANGER
     * - If you change the owner perimeter in one place, update the others too,
     *   or you'll get "totals mismatch" bugs that are hard to spot.
     */

    // ---- Revenus / Dépenses (variables + fixes) ----
    const ownersForFlowsList = ownersForFlows({
      isGlobal,
      activeUserId,
      activeFoyerId,
      // Only used for display names; totals don't depend on it.
      activeFoyerName: "Foyer",
      personIdsInActiveFoyer,
      nameByPersonId: new Map(),
    });

    let depensesVariables = 0;
    let depensesFixes = 0;
    let revenus = 0;

    for (const o of ownersForFlowsList) {
      if (o.kind === "foyer") {
        const exp = normalizeExpenses(readJSON(keyExpensesFoyer(o.id), { variables: [], fixes: [] }));
        depensesVariables += sum(exp.variables ?? []);
        depensesFixes += sum(exp.fixes ?? []);
        revenus += sum(readJSON<StoredLine[]>(keyRevenusFoyer(o.id), []) ?? []);
      } else {
        const exp = normalizeExpenses(readJSON(keyExpensesPerson(o.id), { variables: [], fixes: [] }));
        depensesVariables += sum(exp.variables ?? []);
        depensesFixes += sum(exp.fixes ?? []);
        revenus += sum(readJSON<StoredLine[]>(keyRevenusPerson(o.id), []) ?? []);
      }
    }

    const depenses = depensesVariables + depensesFixes;
    const bilan = revenus - depenses;

    // ---- Patrimoine / Locations nets (déjà existant) ----
    const ownersForEstateList = ownersForEstate({
      isGlobal,
      activeUserId,
      activeFoyerId,
      activeFoyerName: "Foyer",
      personIdsInActiveFoyer,
      nameByPersonId: new Map(),
    });

    let patrimoineNet = 0;
    let locationsNet = 0;

    for (const o of ownersForEstateList) {
      if (o.kind === "foyer") {
        const assets = readJSON<StoredAsset[]>(keyAssetsFoyer(o.id), []);
        const rentals = readJSON<StoredRental[]>(keyRentalsFoyer(o.id), []);
        patrimoineNet += (assets ?? []).reduce((s, a) => s + assetNet(a), 0);
        locationsNet += (rentals ?? []).reduce((s, r) => s + rentalNet(r), 0);
      } else {
        const assets = readJSON<StoredAsset[]>(keyAssetsPerson(o.id), []);
        const rentals = readJSON<StoredRental[]>(keyRentalsPerson(o.id), []);
        patrimoineNet += (assets ?? []).reduce((s, a) => s + assetNet(a), 0);
        locationsNet += (rentals ?? []).reduce((s, r) => s + rentalNet(r), 0);
      }
    }

    const result: MenuTotals = {
      depenses,
      revenus,
      bilan,
      depensesVariables,
      depensesFixes,
      patrimoineNet,
      locationsNet,
    };

    return result;
  }, [activeUserId, isGlobal, activeFoyerId, personIdsInActiveFoyer.join("|")]);
}
