"use client";

import { useMemo } from "react";
import { normalizeExpensesBuckets, readJSON, writeJSON } from "@/components/data/storage";
import {
  keyExpensesFoyer,
  keyExpensesPerson,
  keyRevenusFoyer,
  keyRevenusPerson,
} from "@/components/data/storageKeys";

import {
  CommonCtx,
  MoneyLine,
  OwnerKind,
  UseMoneyLinesParams,
  sumLines,
  useMoneyLines,
} from "@/components/data/moneyLinesEngine";

import { ownersForFlows } from "@/components/data/owners";

export type { OwnerKind, MoneyLine } from "@/components/data/moneyLinesEngine";

export type ExpenseCategory = "variables" | "fixes";

type StoredLine = { id: string; label: string; amount: number };
type StoredExpenses = { variables: StoredLine[]; fixes: StoredLine[] };

export { sumLines };

/**
 * flowsStore (expenses + revenus)
 *
 * WHY
 * - Expenses and Revenues share the same UI: a list of "money lines".
 * - The only difference is which storage key we read/write and how the payload is shaped.
 *
 * WHAT
 * - Adapters for the generic engine `useMoneyLines()`.
 *
 * HOW
 * - Global mode: the UI shows "foyer" + ALL persons of the active foyer.
 * - Person mode: the UI shows ONLY the active person (no cross-person editing).
 *
 * DANGER
 * - Persist functions MUST iterate over the same owners as the UI shows.
 *   If not, you could silently overwrite data for owners that are currently hidden.
 */

// -----------------------------
// Small local helpers (storage agnostic)
// -----------------------------

function toStoredLines(lines: MoneyLine[]) {
  return lines.map((l) => ({ id: l.id, label: l.label, amount: l.amount }));
}

function pickLines(lines: MoneyLine[], ownerKind: OwnerKind, ownerId: string) {
  return lines.filter((l) => l.ownerKind === ownerKind && String(l.ownerId) === String(ownerId));
}

function ownersCtx(ctx: CommonCtx) {
  return {
    isGlobal: ctx.isGlobal,
    activeUserId: ctx.activeUserId,
    activeFoyerId: ctx.activeFoyerId,
    activeFoyerName: ctx.activeFoyerName,
    personIdsInActiveFoyer: ctx.personIdsInActiveFoyer,
    nameByPersonId: ctx.nameByPersonId,
  };
}

function toMoneyLines(owner: { kind: OwnerKind; id: string; name: string }, stored: StoredLine[]): MoneyLine[] {
  return (stored ?? []).map((x) => ({
    id: String(x.id),
    label: x.label,
    amount: x.amount,
    ownerKind: owner.kind,
    ownerId: owner.id,
    ownerName: owner.name,
  }));
}

function loadExpenses(category: ExpenseCategory, ctx: CommonCtx): MoneyLine[] {
  const owners = ownersForFlows(ownersCtx(ctx));

  const out: MoneyLine[] = [];
  for (const o of owners) {
    if (o.kind === "foyer") {
      const foyerStored = normalizeExpensesBuckets(
        readJSON<StoredExpenses>(keyExpensesFoyer(ctx.activeFoyerId), { variables: [], fixes: [] })
      ) as StoredExpenses;
      out.push(...toMoneyLines({ kind: "foyer", id: o.id, name: o.name }, foyerStored[category] ?? []));
    } else {
      const stored = normalizeExpensesBuckets(
        readJSON<StoredExpenses>(keyExpensesPerson(o.id), { variables: [], fixes: [] })
      ) as StoredExpenses;
      out.push(...toMoneyLines({ kind: "person", id: o.id, name: o.name }, stored[category] ?? []));
    }
  }

  return out;
}

function persistExpenseBucket(key: string, category: ExpenseCategory, nextBucket: StoredLine[]) {
  const current = normalizeExpensesBuckets(readJSON<StoredExpenses>(key, { variables: [], fixes: [] })) as StoredExpenses;
  writeJSON(key, { ...current, [category]: nextBucket });
}

function persistExpenses(category: ExpenseCategory, ctx: CommonCtx, lines: MoneyLine[]) {
  // Persist the same owners as the UI is showing.
  // (Global => foyer + all persons; non-global => only active person)
  const owners = ownersForFlows(ownersCtx(ctx));

  for (const o of owners) {
    if (o.kind === "foyer") {
      const foyerNextBucket = toStoredLines(pickLines(lines, "foyer", o.id));
      persistExpenseBucket(keyExpensesFoyer(o.id), category, foyerNextBucket);
    } else {
      const personNextBucket = toStoredLines(pickLines(lines, "person", o.id));
      persistExpenseBucket(keyExpensesPerson(o.id), category, personNextBucket);
    }
  }
}

function loadRevenus(ctx: CommonCtx): MoneyLine[] {
  const owners = ownersForFlows(ownersCtx(ctx));

  const out: MoneyLine[] = [];
  for (const o of owners) {
    if (o.kind === "foyer") {
      const foyerStored = readJSON<StoredLine[]>(keyRevenusFoyer(o.id), []);
      out.push(...toMoneyLines({ kind: "foyer", id: o.id, name: o.name }, foyerStored ?? []));
    } else {
      const stored = readJSON<StoredLine[]>(keyRevenusPerson(o.id), []);
      out.push(...toMoneyLines({ kind: "person", id: o.id, name: o.name }, stored ?? []));
    }
  }
  return out;
}

function persistRevenus(ctx: CommonCtx, lines: MoneyLine[]) {
  const owners = ownersForFlows(ownersCtx(ctx));

  for (const o of owners) {
    if (o.kind === "foyer") {
      const foyerNextBucket = toStoredLines(pickLines(lines, "foyer", o.id));
      writeJSON(keyRevenusFoyer(o.id), foyerNextBucket);
    } else {
      const personNextBucket = toStoredLines(pickLines(lines, "person", o.id));
      writeJSON(keyRevenusPerson(o.id), personNextBucket);
    }
  }
}

export function useExpenses(category: ExpenseCategory) {
  const config = useMemo<UseMoneyLinesParams>(
    () => ({
      uidPrefix: "ex",
      defaultTargetKindInGlobal: "foyer",
      load: (ctx) => loadExpenses(category, ctx),
      persist: (ctx, lines) => persistExpenses(category, ctx, lines),
    }),
    [category]
  );
  return useMoneyLines(config);
}

export function useRevenus() {
  const config = useMemo<UseMoneyLinesParams>(
    () => ({
      uidPrefix: "rv",
      defaultTargetKindInGlobal: "foyer",
      load: loadRevenus,
      persist: persistRevenus,
    }),
    []
  );
  return useMoneyLines(config);
}
