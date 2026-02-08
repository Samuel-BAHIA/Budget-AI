"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUsers } from "@/components/user/UserProvider";
import { readJSON, uid, writeJSON } from "@/components/data/storage";
import { assetNet as assetNetMath, rentalNet as rentalNetMath } from "@/components/data/estateMath";
import {
  applyLockedDefaults,
  ASSET_DEFAULT_EXPENSES,
  ASSET_DEFAULT_INCOMES,
  RENTAL_DEFAULT_EXPENSES,
} from "@/components/data/estateDefaults";
import {
  keyAssetsFoyer,
  keyAssetsPerson,
  keyRentalsFoyer,
  keyRentalsPerson,
} from "@/components/data/storageKeys";
import { ownersForEstate } from "@/components/data/owners";

export type MoneyLine = { id: string; label: string; amount: number; locked?: boolean };
export type OwnerKind = "person" | "foyer";

export type Asset = {
  id: string;
  name: string;
  incomes: MoneyLine[];
  expenses: MoneyLine[];
  ownerKind: OwnerKind;
  ownerId: string;   // personId or foyerId
  ownerName: string; // person name or foyer name
};

export type Rental = {
  id: string;
  name: string;
  expenses: MoneyLine[];
  ownerKind: OwnerKind;
  ownerId: string;
  ownerName: string;
};

type StoredAsset = Omit<Asset, "ownerKind" | "ownerId" | "ownerName">;
type StoredRental = Omit<Rental, "ownerKind" | "ownerId" | "ownerName">;

export type AttachTarget = { ownerKind: "foyer" } | { ownerKind: "person"; personId: string };

// (uid/readJSON/writeJSON + storage key helpers are shared in components/data/*)

// Re-exported helpers (keeps existing API stable for any current imports)
export function assetNet(a: Pick<Asset, "incomes" | "expenses">) {
  return assetNetMath(a);
}

export function rentalNet(r: Pick<Rental, "expenses">) {
  return rentalNetMath(r);
}

function stripAsset(a: Asset): StoredAsset {
  const { ownerKind, ownerId, ownerName, ...rest } = a;
  return rest;
}
function stripRental(r: Rental): StoredRental {
  const { ownerKind, ownerId, ownerName, ...rest } = r;
  return rest;
}

function ensureAssetDefaults(a: StoredAsset) {
  const inc = applyLockedDefaults(a.incomes ?? [], ASSET_DEFAULT_INCOMES);
  const exp = applyLockedDefaults(a.expenses ?? [], ASSET_DEFAULT_EXPENSES);
  const changed = inc.changed || exp.changed;
  return { asset: { ...a, incomes: inc.lines, expenses: exp.lines }, changed };
}
function ensureRentalDefaults(r: StoredRental) {
  const exp = applyLockedDefaults(r.expenses ?? [], RENTAL_DEFAULT_EXPENSES);
  return { rental: { ...r, expenses: exp.lines }, changed: exp.changed };
}

export function useAssets() {
  const { isGlobal, activeUserId, activeFoyerId, activeFoyer, activePeople, personIdsInActiveFoyer } = useUsers();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Prevent cross-foyer overwrites when switching the active foyer.
  // Same root cause as in moneyLinesEngine: one render can occur with the new
  // foyerId but the previous state. Without a guard, persistence would write the
  // previous state's data into the new foyer's storage keys.
  const scopeKey = useMemo(
    () => `${activeFoyerId}::${isGlobal ? "G" : "P"}::${activeUserId}`,
    [activeFoyerId, isGlobal, activeUserId]
  );
  const [loadedScopeKey, setLoadedScopeKey] = useState<string>(scopeKey);

  // Used to notify other components (ex: Sidebar) to reload from storage after a mutation.
  const assetsEmitRef = useRef(false);
  const assetsSourceRef = useRef<string>(uid("assets-src"));

  const foyerId = activeFoyerId;
  const activePersonId = activeUserId;

  const nameByPersonId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of activePeople ?? []) m.set(p.id, p.name);
    return m;
  }, [activePeople]);

  useEffect(() => {
    const loadNow = () => {
      setLoaded(false);
      const foyerName = activeFoyer?.name ?? "Foyer";

      // Show the same conceptual owners in both views:
      // - Global => foyer + all persons
      // - Non-global => foyer + active person
      const owners = ownersForEstate({
        isGlobal,
        activeUserId: activePersonId,
        activeFoyerId: foyerId,
        activeFoyerName: foyerName,
        personIdsInActiveFoyer,
        nameByPersonId,
      });

      const merged: Asset[] = [];
      for (const o of owners) {
        const key = o.kind === "foyer" ? keyAssetsFoyer(o.id) : keyAssetsPerson(o.id);
        let stored = readJSON<StoredAsset[]>(key, []);
        let changed = false;
        stored = (stored ?? []).map((a) => {
          const x = ensureAssetDefaults(a);
          changed = changed || x.changed;
          return x.asset;
        });
        if (changed) writeJSON(key, stored);

        for (const a of stored ?? []) {
          merged.push({ ...a, ownerKind: o.kind, ownerId: o.id, ownerName: o.name });
        }
      }

      setAssets(merged);
      setLoadedScopeKey(scopeKey);
      setLoaded(true);
    };

    loadNow();

    if (typeof window === "undefined") return;
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<any>;
      if (ce?.detail?.source && ce.detail.source === assetsSourceRef.current) return;
      loadNow();
    };
    window.addEventListener("estate:changed", handler as any);
    return () => window.removeEventListener("estate:changed", handler as any);
  }, [
    isGlobal,
    activePersonId,
    foyerId,
    personIdsInActiveFoyer.join("|"),
    nameByPersonId,
    activeFoyer?.name,
    scopeKey,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loaded) return;
    if (loadedScopeKey !== scopeKey) return;

    /**
     * PERSISTENCE INVARIANTS
     *
     * WHY
     * - This effect overwrites localStorage for the owners represented in `assets`.
     *
     * DANGER
     * - We ONLY write for owners present in state. This is intentional:
     *   - In Global mode, state includes foyer + all persons of the active foyer.
     *   - In non-global mode, state includes foyer + ONLY the active person.
     * - Do NOT "optimize" by writing for all known persons here; you'd risk wiping
     *   data for people not currently in the active foyer or not loaded.
     */

    const foyerItems = assets
      .filter((a) => a.ownerKind === "foyer" && a.ownerId === foyerId)
      .map(stripAsset);
    writeJSON(keyAssetsFoyer(foyerId), foyerItems);

    // Persist person assets (only those currently in state)
    const byPerson = new Map<string, StoredAsset[]>();
    for (const a of assets) {
      if (a.ownerKind !== "person") continue;
      const arr = byPerson.get(a.ownerId) ?? [];
      arr.push(stripAsset(a));
      byPerson.set(a.ownerId, arr);
    }
    for (const [pid, items] of byPerson.entries()) {
      writeJSON(keyAssetsPerson(pid), items);
    }

    // Notify other components to refresh (ex: sidebar sub-lists) after persistence.
    if (assetsEmitRef.current && typeof window !== "undefined") {
      assetsEmitRef.current = false;
      window.dispatchEvent(new CustomEvent("estate:changed", { detail: { source: assetsSourceRef.current, kind: "assets" } }));
    }
  }, [assets, loaded, foyerId, loadedScopeKey, scopeKey]);

  const canEdit = (a: Asset) => {
    // Global view is an "admin" view: allow editing for everyone.
    if (isGlobal) return true;
    if (a.ownerKind === "foyer") return true;     // foyer always editable
    return a.ownerId === activePersonId;          // personne => seulement la personne active
  };

  const addAsset = (name: string, target?: AttachTarget) => {
    const n = name.trim();
    if (!n) return;

    assetsEmitRef.current = true;

    const t: AttachTarget =
      target ?? (isGlobal ? { ownerKind: "foyer" } : { ownerKind: "person", personId: activePersonId });

    const aBase: StoredAsset = {
      id: uid("a"),
      name: n,
      incomes: [...ASSET_DEFAULT_INCOMES],
      expenses: [...ASSET_DEFAULT_EXPENSES],
    };

    if (t.ownerKind === "foyer") {
      const foyerName = activeFoyer?.name ?? "Foyer";
      const existing = readJSON<StoredAsset[]>(keyAssetsFoyer(foyerId), []);
      writeJSON(keyAssetsFoyer(foyerId), [aBase, ...(existing ?? [])]);
      setAssets((prev) => [{ ...aBase, ownerKind: "foyer", ownerId: foyerId, ownerName: foyerName }, ...prev]);
      return aBase.id;
    }

    const pid = t.personId;
    const personName = nameByPersonId.get(pid) ?? "Personne";
    const existing = readJSON<StoredAsset[]>(keyAssetsPerson(pid), []);
    writeJSON(keyAssetsPerson(pid), [aBase, ...(existing ?? [])]);
    setAssets((prev) => [{ ...aBase, ownerKind: "person", ownerId: pid, ownerName: personName }, ...prev]);
    return aBase.id;
  };

  const updateAsset = (id: string, patch: Partial<Pick<Asset, "name">>) => {
    assetsEmitRef.current = true;
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        if (!canEdit(a)) return a;
        return { ...a, ...patch };
      })
    );
  };

  const removeAsset = (id: string) => {
    assetsEmitRef.current = true;
    setAssets((prev) => prev.filter((a) => !(a.id === id && canEdit(a))));
  };

  const addAssetLine = (assetId: string, type: "income" | "expense", label: string, amount: number) => {
    const l = label.trim();
    if (!l || !Number.isFinite(amount)) return;

    assetsEmitRef.current = true;

    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        if (!canEdit(a)) return a;
        const line: MoneyLine = { id: uid(type === "income" ? "i" : "e"), label: l, amount, locked: false };
        if (type === "income") return { ...a, incomes: [line, ...(a.incomes ?? [])] };
        return { ...a, expenses: [line, ...(a.expenses ?? [])] };
      })
    );
  };

  const updateAssetLine = (assetId: string, type: "income" | "expense", lineId: string, patch: Partial<Pick<MoneyLine, "amount" | "label">>) => {
    assetsEmitRef.current = true;
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        if (!canEdit(a)) return a;

        const update = (arr: MoneyLine[]) =>
          (arr ?? []).map((x) => {
            if (x.id !== lineId) return x;
            const next = { ...x, ...patch };
            // Do not allow renaming of locked standard lines
            if (x.locked) next.label = x.label;
            return next;
          });

        if (type === "income") return { ...a, incomes: update(a.incomes ?? []) };
        return { ...a, expenses: update(a.expenses ?? []) };
      })
    );
  };

  const removeAssetLine = (assetId: string, type: "income" | "expense", lineId: string) => {
    assetsEmitRef.current = true;
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        if (!canEdit(a)) return a;

        const keep = (x: MoneyLine) => x.id !== lineId || x.locked;
        if (type === "income") return { ...a, incomes: (a.incomes ?? []).filter(keep) };
        return { ...a, expenses: (a.expenses ?? []).filter(keep) };
      })
    );
  };

  return { assets, loaded, isGlobal, addAsset, updateAsset, removeAsset, addAssetLine, updateAssetLine, removeAssetLine, canEdit };
}

export function useRentals() {
  const { isGlobal, activeUserId, activeFoyerId, activeFoyer, activePeople, personIdsInActiveFoyer } = useUsers();
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Same cross-foyer overwrite guard as in useAssets()
  const scopeKey = useMemo(
    () => `${activeFoyerId}::${isGlobal ? "G" : "P"}::${activeUserId}`,
    [activeFoyerId, isGlobal, activeUserId]
  );
  const [loadedScopeKey, setLoadedScopeKey] = useState<string>(scopeKey);

  // Used to notify other components (ex: Sidebar) to reload from storage after a mutation.
  const rentalsEmitRef = useRef(false);
  const rentalsSourceRef = useRef<string>(uid("rentals-src"));

  const foyerId = activeFoyerId;
  const activePersonId = activeUserId;

  const nameByPersonId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of activePeople ?? []) m.set(p.id, p.name);
    return m;
  }, [activePeople]);

  useEffect(() => {
    const loadNow = () => {
      setLoaded(false);
      const foyerName = activeFoyer?.name ?? "Foyer";

      const owners = ownersForEstate({
        isGlobal,
        activeUserId: activePersonId,
        activeFoyerId: foyerId,
        activeFoyerName: foyerName,
        personIdsInActiveFoyer,
        nameByPersonId,
      });

      const merged: Rental[] = [];
      for (const o of owners) {
        const key = o.kind === "foyer" ? keyRentalsFoyer(o.id) : keyRentalsPerson(o.id);
        let stored = readJSON<StoredRental[]>(key, []);
        let changed = false;
        stored = (stored ?? []).map((r) => {
          const x = ensureRentalDefaults(r);
          changed = changed || x.changed;
          return x.rental;
        });
        if (changed) writeJSON(key, stored);

        for (const r of stored ?? []) {
          merged.push({ ...r, ownerKind: o.kind, ownerId: o.id, ownerName: o.name });
        }
      }

      setRentals(merged);
      setLoadedScopeKey(scopeKey);
      setLoaded(true);
    };

    loadNow();

    if (typeof window === "undefined") return;
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<any>;
      if (ce?.detail?.source && ce.detail.source === rentalsSourceRef.current) return;
      loadNow();
    };
    window.addEventListener("estate:changed", handler as any);
    return () => window.removeEventListener("estate:changed", handler as any);
  }, [
    isGlobal,
    activePersonId,
    foyerId,
    personIdsInActiveFoyer.join("|"),
    nameByPersonId,
    activeFoyer?.name,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loaded) return;
    if (loadedScopeKey !== scopeKey) return;

    /**
     * PERSISTENCE INVARIANTS (rentals)
     *
     * Same rule as assets: we only write for owners present in state.
     * This avoids wiping rentals for owners that are not currently displayed
     * (ex: other foyers / other persons not in the active foyer).
     */

    const foyerItems = rentals
      .filter((r) => r.ownerKind === "foyer" && r.ownerId === foyerId)
      .map(stripRental);
    writeJSON(keyRentalsFoyer(foyerId), foyerItems);

    const byPerson = new Map<string, StoredRental[]>();
    for (const r of rentals) {
      if (r.ownerKind !== "person") continue;
      const arr = byPerson.get(r.ownerId) ?? [];
      arr.push(stripRental(r));
      byPerson.set(r.ownerId, arr);
    }
    for (const [pid, items] of byPerson.entries()) {
      writeJSON(keyRentalsPerson(pid), items);
    }

    // Notify other components to refresh (ex: sidebar sub-lists) after persistence.
    if (rentalsEmitRef.current && typeof window !== "undefined") {
      rentalsEmitRef.current = false;
      window.dispatchEvent(
        new CustomEvent("estate:changed", { detail: { source: rentalsSourceRef.current, kind: "rentals" } })
      );
    }
  }, [rentals, loaded, foyerId, loadedScopeKey, scopeKey]);

  const canEdit = (r: Rental) => {
    // Global view is an "admin" view: allow editing for everyone.
    if (isGlobal) return true;
    if (r.ownerKind === "foyer") return true;
    return r.ownerId === activePersonId;
  };

  const addRental = (name: string, target?: AttachTarget) => {
    const n = name.trim();
    if (!n) return;

    rentalsEmitRef.current = true;

    const t: AttachTarget =
      target ?? (isGlobal ? { ownerKind: "foyer" } : { ownerKind: "person", personId: activePersonId });

    const rBase: StoredRental = {
      id: uid("r"),
      name: n,
      expenses: [...RENTAL_DEFAULT_EXPENSES],
    };

    if (t.ownerKind === "foyer") {
      const foyerName = activeFoyer?.name ?? "Foyer";
      const existing = readJSON<StoredRental[]>(keyRentalsFoyer(foyerId), []);
      writeJSON(keyRentalsFoyer(foyerId), [rBase, ...(existing ?? [])]);
      setRentals((prev) => [{ ...rBase, ownerKind: "foyer", ownerId: foyerId, ownerName: foyerName }, ...prev]);
      return rBase.id;
    }

    const pid = t.personId;
    const personName = nameByPersonId.get(pid) ?? "Personne";
    const existing = readJSON<StoredRental[]>(keyRentalsPerson(pid), []);
    writeJSON(keyRentalsPerson(pid), [rBase, ...(existing ?? [])]);
    setRentals((prev) => [{ ...rBase, ownerKind: "person", ownerId: pid, ownerName: personName }, ...prev]);
    return rBase.id;
  };

  const updateRental = (id: string, patch: Partial<Pick<Rental, "name">>) => {
    rentalsEmitRef.current = true;
    setRentals((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (!canEdit(r)) return r;
        return { ...r, ...patch };
      })
    );
  };

  const removeRental = (id: string) => {
    rentalsEmitRef.current = true;
    setRentals((prev) => prev.filter((r) => !(r.id === id && canEdit(r))));
  };

  const addRentalExpense = (rentalId: string, label: string, amount: number) => {
    const l = label.trim();
    if (!l || !Number.isFinite(amount)) return;

    rentalsEmitRef.current = true;

    setRentals((prev) =>
      prev.map((r) => {
        if (r.id !== rentalId) return r;
        if (!canEdit(r)) return r;
        const line: MoneyLine = { id: uid("e"), label: l, amount, locked: false };
        return { ...r, expenses: [line, ...(r.expenses ?? [])] };
      })
    );
  };

  /**
   * Add an expense while tagging its “bucket” in the id prefix.
   * This keeps Locations > Dépenses pages stable (Charges vs Autres) without changing the data model.
   */
  const addRentalExpenseToBucket = (rentalId: string, bucket: "charges" | "autres", label: string, amount: number) => {
    const l = label.trim();
    if (!l || !Number.isFinite(amount)) return;

    rentalsEmitRef.current = true;

    const idPrefix = bucket === "charges" ? "c" : "o";

    setRentals((prev) =>
      prev.map((r) => {
        if (r.id !== rentalId) return r;
        if (!canEdit(r)) return r;
        const line: MoneyLine = { id: uid(idPrefix), label: l, amount, locked: false };
        return { ...r, expenses: [line, ...(r.expenses ?? [])] };
      })
    );
  };

  const updateRentalExpense = (rentalId: string, lineId: string, patch: Partial<Pick<MoneyLine, "amount" | "label">>) => {
    rentalsEmitRef.current = true;
    setRentals((prev) =>
      prev.map((r) => {
        if (r.id !== rentalId) return r;
        if (!canEdit(r)) return r;
        return {
          ...r,
          expenses: (r.expenses ?? []).map((x) => {
            if (x.id !== lineId) return x;
            const next = { ...x, ...patch };
            if (x.locked) next.label = x.label;
            return next;
          }),
        };
      })
    );
  };

  const removeRentalExpense = (rentalId: string, lineId: string) => {
    rentalsEmitRef.current = true;
    setRentals((prev) =>
      prev.map((r) => {
        if (r.id !== rentalId) return r;
        if (!canEdit(r)) return r;
        return { ...r, expenses: (r.expenses ?? []).filter((x) => x.id !== lineId || x.locked) };
      })
    );
  };

  return {
    rentals,
    loaded,
    isGlobal,
    addRental,
    updateRental,
    removeRental,
    addRentalExpense,
    addRentalExpenseToBucket,
    updateRentalExpense,
    removeRentalExpense,
    canEdit,
  };
}
