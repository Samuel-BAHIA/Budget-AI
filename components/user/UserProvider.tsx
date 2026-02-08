"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Person = {
  id: string;
  name: string;
  isPrimary?: boolean;
  birthDate?: string; // YYYY-MM-DD
  lastName?: string;
};
export type Foyer = { id: string; name: string; people: Person[] };

export type ActiveSelection =
  | { kind: "global" }
  | { kind: "person"; personId: string };

type UsersContextValue = {
  // state
  foyers: Foyer[];
  activeFoyerId: string;
  activeFoyer?: Foyer;
  activePeople: Person[];
  activeSelection: ActiveSelection;

  // derived
  isGlobal: boolean;
  activeUserId: string; // current person id (when global, defaults to first person)
  personIdsInActiveFoyer: string[];

  // actions
  setActiveFoyer: (foyerId: string) => void;
  setActiveSelection: (sel: ActiveSelection) => void;

  addFoyer: () => void;
  removeFoyer: (foyerId: string) => void;
  addPerson: (foyerId: string, name: string) => void;
  renamePerson: (foyerId: string, personId: string, name: string) => void;
  updatePersonDetails: (foyerId: string, personId: string, patch: Partial<Person>) => void;
  removePerson: (foyerId: string, personId: string) => void;

  createFoyerWithPeople: (people: Array<Pick<Person, "name" | "birthDate" | "lastName">>) => string;
};

const UserContext = createContext<UsersContextValue | null>(null);

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

const LS_FOYERS = "test.foyers.v1";
const LS_ACTIVE_FOYER = "test.activeFoyerId.v1";
const LS_ACTIVE_SEL = "test.activeSelection.v1";

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

function normalizeFoyerNames(list: Foyer[]): Foyer[] {
  // Les foyers ne sont plus renommables.
  // On force des noms mécaniques: Foyer 1, Foyer 2, ... dans l'ordre de la liste.
  return (list ?? []).map((f, i) => ({ ...f, name: `Foyer ${i + 1}` }));
}

// --- Default seeded data (foyer-level) ---
// Used only when there is no user data yet.
// The goal is to provide a ready-to-use baseline (communes) without any setup.
type StoredLine = { id: string; label: string; amount: number };
type StoredExpenses = { variables: StoredLine[]; fixes: StoredLine[] };
type StoredRentalLine = { id: string; label: string; amount: number; locked?: boolean };
type StoredRental = { id: string; name: string; expenses: StoredRentalLine[] };

function keyExpensesFoyer(foyerId: string) {
  return `test.expenses.foyer.${foyerId}`;
}
function keyRevenusFoyer(foyerId: string) {
  return `test.revenus.foyer.${foyerId}`;
}
function keyRentalsFoyer(foyerId: string) {
  return `test.rentals.foyer.${foyerId}`;
}

function seedFoyerDefaultsIfMissing(foyerId: string) {
  try {
    // Revenus (communs)
    const kRev = keyRevenusFoyer(foyerId);
    if (!localStorage.getItem(kRev)) {
      const revenus: StoredLine[] = [
        { id: "seed-rv-chomage-laurence", label: "Chomage Laurence", amount: 1200 },
        { id: "seed-rv-salaire-julien", label: "Salaire Julien", amount: 1200 },
        { id: "seed-rv-salaire-laurence-coachings", label: "Salaire Laurence Coachings", amount: 1900 },
      ];
      writeJSON(kRev, revenus);
    }

    // Dépenses (communes)
    const kExp = keyExpensesFoyer(foyerId);
    if (!localStorage.getItem(kExp)) {
      const expenses: StoredExpenses = {
        fixes: [
          { id: "seed-ex-fixes-telephone", label: "Téléphone", amount: 80 },
          { id: "seed-ex-fixes-netflix", label: "Netflix", amount: 20 },
          { id: "seed-ex-fixes-credit-voiture-laurence", label: "Credit voiture Laurence", amount: 300 },
          { id: "seed-ex-fixes-assurances-voiture", label: "Assurances voiture", amount: 170 },
        ],
        variables: [
          { id: "seed-ex-var-courses", label: "Courses", amount: 450 },
          { id: "seed-ex-var-carburant", label: "Carburant", amount: 120 },
          { id: "seed-ex-var-entretien-voiture", label: "Entretien voiture", amount: 70 },
          { id: "seed-ex-var-sante", label: "Santé", amount: 150 },
          { id: "seed-ex-var-autres", label: "Autres", amount: 100 },
        ],
      };
      writeJSON(kExp, expenses);
    }

    // Locations (communes)
    const kRent = keyRentalsFoyer(foyerId);
    if (!localStorage.getItem(kRent)) {
      const rentals: StoredRental[] = [
        {
          id: "seed-rental-tampon",
          name: "Tampon",
          expenses: [
            { id: "std:rental:loyer", label: "Loyer", amount: 980, locked: true },
            { id: "std:rental:eau", label: "Eau", amount: 35, locked: true },
            { id: "std:rental:elec", label: "Électricité", amount: 110, locked: true },
            { id: "std:rental:internet", label: "Internet", amount: 40, locked: true },
            { id: "std:rental:assurance", label: "Assurance habitation", amount: 30, locked: true },
          ],
        },
        {
          id: "seed-rental-st-denis",
          name: "Location st denis",
          expenses: [
            { id: "std:rental:loyer", label: "Loyer", amount: 760, locked: true },
            { id: "std:rental:eau", label: "Eau", amount: 20, locked: true },
            { id: "std:rental:internet", label: "Internet", amount: 30, locked: true },
            { id: "std:rental:assurance", label: "Assurance habitation", amount: 20, locked: true },
            { id: "std:rental:elec", label: "Électricité", amount: 35, locked: true },
          ],
        },
      ];
      writeJSON(kRent, rentals);
    }
  } catch {
    // ignore any storage exceptions
  }
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    if (!isBrowser()) return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function writeJSON<T>(key: string, value: T) {
  try {
    if (!isBrowser()) return;
    localStorage.setItem(key, JSON.stringify(value));

    // Notify same-tab listeners (OnlineBudgetSync, etc.).
    window.dispatchEvent(
      new CustomEvent("app:storage", {
        detail: { key, ts: Date.now() },
      })
    );
  } catch {
    // ignore
  }
}

function cleanupPersonAssets(personId: string) {
  try {
    localStorage.removeItem(`test.assets.${personId}`);
    localStorage.removeItem(`test.rentals.${personId}`);
    localStorage.removeItem(`test.totals.${personId}`);
  } catch {
    // ignore
  }
}

function ensureDefaultDataBrowser(): { foyers: Foyer[]; activeFoyerId: string; activeSelection: ActiveSelection } {
  const stored = readJSON<Foyer[]>(LS_FOYERS, []);
  if (stored && stored.length > 0) {
    // Normalise les noms des foyers (Foyer 1, Foyer 2, ...)
    const normalizedFoyers = normalizeFoyerNames(stored);
    const activeFoyerIdStored = readJSON<string>(LS_ACTIVE_FOYER, normalizedFoyers[0].id);
    const activeFoyerId = normalizedFoyers.some((f) => f.id === activeFoyerIdStored) ? activeFoyerIdStored : normalizedFoyers[0].id;

    const defaultPersonId = normalizedFoyers.find((f) => f.id === activeFoyerId)?.people?.[0]?.id ?? "";
    const selStored = readJSON<ActiveSelection>(LS_ACTIVE_SEL, { kind: "person", personId: defaultPersonId });
    const foyerForSel = normalizedFoyers.find((f) => f.id === activeFoyerId) ?? normalizedFoyers[0];
    const sel = normalizeSelection(foyerForSel, selStored);

    // Persist normalisation si nécessaire
    if (JSON.stringify(normalizedFoyers) !== JSON.stringify(stored)) {
      writeJSON(LS_FOYERS, normalizedFoyers);
    }
    writeJSON(LS_ACTIVE_FOYER, activeFoyerId);
    writeJSON(LS_ACTIVE_SEL, sel);

    return { foyers: normalizedFoyers, activeFoyerId, activeSelection: sel };
  }

  // Default: 1 foyer "Foyer 1" avec 2 personnes, pour que la vue Global soit disponible.
  const p1: Person = { id: uid("p"), name: "Personne 1", isPrimary: true };
  const p2: Person = { id: uid("p"), name: "Personne 2", isPrimary: false };
  const f1: Foyer = { id: uid("f"), name: "Foyer 1", people: [p1, p2] };
  const data = { foyers: [f1], activeFoyerId: f1.id, activeSelection: { kind: "global" } as ActiveSelection };
  writeJSON(LS_FOYERS, data.foyers);
  writeJSON(LS_ACTIVE_FOYER, data.activeFoyerId);
  writeJSON(LS_ACTIVE_SEL, data.activeSelection);

  // Seed flows + locations (communes) once.
  seedFoyerDefaultsIfMissing(f1.id);
  return data;
}

function normalizeSelection(foyer: Foyer, sel: ActiveSelection): ActiveSelection {
  const people = foyer.people ?? [];
  if (people.length === 0) return { kind: "global" };

  // If only one person -> force person
  if (people.length === 1) return { kind: "person", personId: people[0].id };

  // If selection is person but missing -> fall back to global
  if (sel.kind === "person") {
    const exists = people.some((p) => p.id === sel.personId);
    if (!exists) return { kind: "global" };
  }

  return sel;
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  // IMPORTANT:
  // Next.js may render "use client" components on the server to produce the initial HTML.
  // Accessing localStorage during that server render can crash in surprising ways.
  // We therefore start with deterministic SSR-safe defaults, then hydrate from localStorage
  // once mounted in the browser.
  const ssrDefault = useMemo(() => {
    const p1: Person = { id: "p-ssr-1", name: "Personne 1", isPrimary: true };
    const p2: Person = { id: "p-ssr-2", name: "Personne 2", isPrimary: false };
    const f1: Foyer = { id: "f-ssr-1", name: "Foyer 1", people: [p1, p2] };
    return { foyers: [f1], activeFoyerId: f1.id, activeSelection: { kind: "global" } as ActiveSelection };
  }, []);

  const [foyers, setFoyers] = useState<Foyer[]>(ssrDefault.foyers);
  const [activeFoyerId, setActiveFoyerId] = useState<string>(ssrDefault.activeFoyerId);
  const [activeSelection, setActiveSelectionState] = useState<ActiveSelection>(ssrDefault.activeSelection);

  // Hydrate from storage on mount (browser only)
  useEffect(() => {
    if (!isBrowser()) return;
    const initial = ensureDefaultDataBrowser();
    setFoyers(initial.foyers);
    setActiveFoyerId(initial.activeFoyerId);
    setActiveSelectionState(initial.activeSelection);
  }, []);

  const activeFoyer = useMemo(() => foyers.find((f) => f.id === activeFoyerId) ?? foyers[0], [foyers, activeFoyerId]);
  const activePeople = useMemo(() => activeFoyer?.people ?? [], [activeFoyer]);

  // Keep selection valid when switching foyer or deleting people
  useEffect(() => {
    if (!activeFoyer) return;
    const normalized = normalizeSelection(activeFoyer, activeSelection);
    if (JSON.stringify(normalized) !== JSON.stringify(activeSelection)) {
      setActiveSelectionState(normalized);
      writeJSON(LS_ACTIVE_SEL, normalized);
    }
  }, [activeFoyerId, foyers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist changes
  useEffect(() => {
    writeJSON(LS_FOYERS, foyers);
  }, [foyers]);

  useEffect(() => {
    writeJSON(LS_ACTIVE_FOYER, activeFoyerId);
  }, [activeFoyerId]);

  useEffect(() => {
    writeJSON(LS_ACTIVE_SEL, activeSelection);
  }, [activeSelection]);

  const personIdsInActiveFoyer = useMemo(() => (activePeople ?? []).map((p) => p.id), [activePeople]);
  const isGlobal = activeSelection.kind === "global";

  const activeUserId = useMemo(() => {
    if (activeSelection.kind === "person") return activeSelection.personId;
    // global -> fallback to first person
    return activePeople?.[0]?.id ?? "";
  }, [activeSelection, activePeople]);

  const setActiveFoyer = (foyerId: string) => {
    const target = foyers.find((f) => f.id === foyerId);
    if (!target) return;
    setActiveFoyerId(foyerId);

    // Normalize selection for the new foyer
    const normalized = normalizeSelection(target, { kind: "global" });
    setActiveSelectionState(normalized);
  };

  const setActiveSelection = (sel: ActiveSelection) => {
    if (!activeFoyer) return;
    const normalized = normalizeSelection(activeFoyer, sel);
    setActiveSelectionState(normalized);
  };

  const addFoyer = () => {
    const p1: Person = { id: uid("p"), name: "Personne 1", isPrimary: true };
    const f: Foyer = { id: uid("f"), name: "", people: [p1] };
    setFoyers((prev) => normalizeFoyerNames([...(prev ?? []), f]));
    setActiveFoyerId(f.id);
    setActiveSelectionState({ kind: "person", personId: p1.id });

    // Données par défaut au niveau foyer (si nécessaires)
    seedFoyerDefaultsIfMissing(f.id);
  };

  const removeFoyer = (foyerId: string) => {
    setFoyers((prev) => {
      if ((prev?.length ?? 0) <= 1) return prev;
      const nextRaw = (prev ?? []).filter((f) => f.id !== foyerId);
      if (nextRaw.length === (prev?.length ?? 0)) return prev;
      const removed = prev.find((f) => f.id === foyerId);
      removed?.people?.forEach((p) => cleanupPersonAssets(p.id));
      const next = normalizeFoyerNames(nextRaw);
      if (activeFoyerId === foyerId && next.length > 0) {
        setActiveFoyerId(next[0].id);
        setActiveSelectionState({ kind: "global" });
      }
      return next;
    });
  };

  const addPerson = (foyerId: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setFoyers((prev) =>
      prev.map((f) => {
        if (f.id !== foyerId) return f;
        const nextNum = (f.people?.length ?? 0) + 1;
        const p: Person = { id: uid("p"), name: n || `Personne ${nextNum}`, isPrimary: false };
        return { ...f, people: [...(f.people ?? []), p] };
      })
    );
  };
 
  const renamePerson = (foyerId: string, personId: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setFoyers((prev) =>
      prev.map((f) => {
        if (f.id !== foyerId) return f;
        const people = f.people ?? [];
        return {
          ...f,
          people: people.map((p) => (p.id === personId ? { ...p, name: n } : p)),
        };
      })
    );
  };

  const updatePersonDetails = (foyerId: string, personId: string, patch: Partial<Person>) => {
    setFoyers((prev) =>
      prev.map((f) => {
        if (f.id !== foyerId) return f;
        const people = f.people ?? [];
        return {
          ...f,
          people: people.map((p) => (p.id === personId ? { ...p, ...patch } : p)),
        };
      })
    );
  };

  const removePerson = (foyerId: string, personId: string) => {
    setFoyers((prev) =>
      prev.map((f) => {
        if (f.id !== foyerId) return f;
        const people = f.people ?? [];
        if (people.length <= 1) return f; // can't delete last person in foyer
        const nextPeople = people.filter((p) => p.id !== personId);
        if (nextPeople.length === people.length) return f;
        cleanupPersonAssets(personId);
        return { ...f, people: nextPeople };
      })
    );

    // If we deleted currently selected person, normalize selection
    setActiveSelectionState((sel) => {
      if (sel.kind === "person" && sel.personId === personId) {
        const foyer = foyers.find((x) => x.id === foyerId);
        const remaining = (foyer?.people ?? []).filter((p) => p.id !== personId);
        if (remaining.length <= 1) return { kind: "person", personId: remaining[0]?.id ?? "" };
        return { kind: "global" };
      }
      return sel;
    });
  };

  const createFoyerWithPeople = (peopleInput: Array<Pick<Person, "name" | "birthDate" | "lastName">>) => {
    const clean = (peopleInput ?? []).map((p) => ({
      name: (p.name ?? "").trim(),
      birthDate: p.birthDate,
      lastName: p.lastName,
    })).filter((p) => p.name.length > 0);
    // If nothing valid was provided, create a minimal placeholder person.
    // Some call sites only provide a name; keep optional fields truly optional.
    const safe: Array<{ name: string; birthDate?: string; lastName?: string }> = clean.length
      ? clean
      : [{ name: "Personne 1" }];

    const people: Person[] = safe.map((p, idx) => ({
      id: uid("p"),
      name: p.name,
      birthDate: "birthDate" in p ? p.birthDate : undefined,
      lastName: "lastName" in p ? p.lastName : undefined,
      isPrimary: idx === 0,
    }));

    const foyer: Foyer = { id: uid("f"), name: "", people };
    setFoyers((prev) => normalizeFoyerNames([...(prev ?? []), foyer]));
    setActiveFoyerId(foyer.id);
    setActiveSelectionState(people.length > 1 ? { kind: "global" } : { kind: "person", personId: people[0].id });
    seedFoyerDefaultsIfMissing(foyer.id);
    return foyer.id;
  };

  const value: UsersContextValue = {
    foyers,
    activeFoyerId,
    activeFoyer,
    activePeople,
    activeSelection,
    isGlobal,
    activeUserId,
    personIdsInActiveFoyer,
    setActiveFoyer,
    setActiveSelection,
    addFoyer,
    removeFoyer,
    addPerson,
    renamePerson,
    updatePersonDetails,
    removePerson,
    createFoyerWithPeople,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUsers() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUsers must be used within <UserProvider />");
  return ctx;
}
