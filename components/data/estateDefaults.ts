"use client";

export type LockedLine = { id: string; label: string; amount: number; locked?: boolean };

const normLabel = (s: string) => (s ?? "").trim().toLowerCase();

export function applyLockedDefaults(lines: LockedLine[] | undefined, defaults: LockedLine[]) {
  /**
   * WHY
   * - We want a few "standard" lines always present, and always locked (not renameable / not removable).
   *
   * HOW
   * - We match defaults by BOTH id and label (case/space-insensitive) so older storage payloads still upgrade.
   *
   * DANGER
   * - We `unshift()` missing defaults to the start to preserve historical UI ordering.
   *   Changing this may make the UI feel "random" as defaults jump around.
   */

  const src = Array.isArray(lines) ? lines : [];
  let changed = false;

  const out: LockedLine[] = src.map((x) => {
    const isDefaultLabel = defaults.some((d) => normLabel(d.label) === normLabel(x.label));
    if (isDefaultLabel && !x.locked) {
      changed = true;
      return { ...x, locked: true };
    }
    return x;
  });

  for (const d of defaults) {
    const byId = out.some((x) => x.id === d.id);
    const byLabel = out.some((x) => normLabel(x.label) === normLabel(d.label));
    if (!byId && !byLabel) {
      out.unshift({ ...d });
      changed = true;
    }
  }

  return { lines: out, changed };
}

export const ASSET_DEFAULT_INCOMES: LockedLine[] = [
  { id: "std:asset:loyer", label: "Loyer perçu", amount: 0, locked: true },
];

export const ASSET_DEFAULT_EXPENSES: LockedLine[] = [
  { id: "std:asset:credit", label: "Crédit", amount: 0, locked: true },
  { id: "std:asset:taxe_fonciere", label: "Taxe foncière", amount: 0, locked: true },
  { id: "std:asset:assurance", label: "Assurance", amount: 0, locked: true },
  { id: "std:asset:charges", label: "Charges (copropriété)", amount: 0, locked: true },
  { id: "std:asset:eau", label: "Eau", amount: 0, locked: true },
  { id: "std:asset:gaz", label: "Gaz", amount: 0, locked: true },
  { id: "std:asset:elec", label: "Électricité", amount: 0, locked: true },
  { id: "std:asset:entretien", label: "Entretien / Travaux", amount: 0, locked: true },
];

export const RENTAL_DEFAULT_EXPENSES: LockedLine[] = [
  { id: "std:rental:loyer", label: "Loyer", amount: 0, locked: true },
  { id: "std:rental:charges", label: "Charges", amount: 0, locked: true },
  { id: "std:rental:eau", label: "Eau", amount: 0, locked: true },
  { id: "std:rental:elec", label: "Électricité", amount: 0, locked: true },
  { id: "std:rental:chauffage", label: "Chauffage", amount: 0, locked: true },
  { id: "std:rental:gaz", label: "Gaz", amount: 0, locked: true },
  { id: "std:rental:internet", label: "Internet", amount: 0, locked: true },
  { id: "std:rental:assurance", label: "Assurance habitation", amount: 0, locked: true },
];
