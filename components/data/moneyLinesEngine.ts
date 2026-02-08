"use client";

import { useEffect, useMemo, useState } from "react";
import { useUsers } from "@/components/user/UserProvider";
import { sumAmounts, uid } from "@/components/data/storage";

/**
 * moneyLinesEngine
 *
 * WHY
 * - Expenses and Revenues share the same UI + editing rules.
 * - Only the persistence layer changes.
 *
 * WHAT
 * - A generic engine that handles:
 *   - in-memory state
 *   - edit permissions (Global vs Person mode)
 *   - add/update/remove helpers
 *   - totals computation
 *
 * HOW
 * - You provide two tiny adapters:
 *   - load(ctx)    -> returns MoneyLine[]
 *   - persist(ctx, lines)
 *
 * DANGER / GOTCHAS
 * - In Global mode, the engine must allow editing both:
 *   - foyer lines (shared)
 *   - all persons lines that belong to the active foyer
 */

export type OwnerKind = "person" | "foyer";

export type MoneyLine = {
  id: string;
  label: string;
  amount: number;
  ownerKind: OwnerKind;
  ownerId: string;
  ownerName: string;
};

export type MoneyLinesTotals = {
  totalAll: number;
  totalEditable: number;
  totalReadonly: number;
};

export type MoneyLinesApi = {
  lines: MoneyLine[];
  loaded: boolean;
  add: (label: string, amount: number, owner?: { kind: OwnerKind; ownerId?: string }) => void;
  update: (id: string, patch: Partial<Pick<MoneyLine, "label" | "amount">>) => void;
  remove: (id: string) => void;
  canEdit: (l: MoneyLine) => boolean;
  totals: MoneyLinesTotals;
};

export type CommonCtx = {
  isGlobal: boolean;
  activeUserId: string;
  activeFoyerId: string;
  activeFoyerName: string;
  personIdsInActiveFoyer: string[];
  nameByPersonId: Map<string, string>;
};

export type LoadFn = (ctx: CommonCtx) => MoneyLine[];
export type PersistFn = (ctx: CommonCtx, lines: MoneyLine[]) => void;

export type UseMoneyLinesParams = {
  /** Used to create stable ids for a specific domain (ex: "ex" or "rv"). */
  uidPrefix: string;
  load: LoadFn;
  persist: PersistFn;
  /** Default owner kind when adding in Global mode (UI usually wants foyer first). */
  defaultTargetKindInGlobal: OwnerKind;
};

function buildNameByPersonId(activePeople: { id: string; name: string }[] | undefined) {
  const m = new Map<string, string>();
  for (const p of activePeople ?? []) m.set(p.id, p.name);
  return m;
}

function getOwnerName(ctx: CommonCtx, kind: OwnerKind, ownerId: string) {
  if (kind === "foyer") return ctx.activeFoyerName;
  return ctx.nameByPersonId.get(ownerId) ?? "Personne";
}

function canEditLine(
  ctx: Pick<CommonCtx, "isGlobal" | "activeUserId" | "activeFoyerId" | "personIdsInActiveFoyer">,
  l: MoneyLine
) {
  if (ctx.isGlobal) {
    // Global mode: we can edit the whole active foyer perimeter.
    // DANGER: keep this perimeter strictly limited to the active foyer.
    // If you accidentally allow editing for people outside `personIdsInActiveFoyer`,
    // you can end up mixing data across foyers.
    if (l.ownerKind === "foyer") return String(l.ownerId) === String(ctx.activeFoyerId);
    return ctx.personIdsInActiveFoyer.some((pid) => String(pid) === String(l.ownerId));
  }

  // Person mode: only edit your own personal lines.
  return l.ownerKind === "person" && l.ownerId === ctx.activeUserId;
}

export function sumLines(lines: { amount: number }[]) {
  return sumAmounts(lines);
}

export function useMoneyLines(params: UseMoneyLinesParams): MoneyLinesApi {
  const { isGlobal, activeUserId, activeFoyerId, activeFoyer, activePeople, personIdsInActiveFoyer } = useUsers();

  const [lines, setLines] = useState<MoneyLine[]>([]);
  const [loaded, setLoaded] = useState(false);

  /**
   * Guard against data loss when switching foyer / mode.
   *
   * Problem (seen by user):
   * - When the active foyer changes, this hook re-renders with the NEW ctx,
   *   but still holds the OLD `lines` for one render.
   * - The persist effect would then write OLD lines into the NEW foyer keys,
   *   wiping the target foyer.
   *
   * Fix:
   * - Track the "loaded scope" key.
   * - Only persist when the current render scope matches the last loaded scope.
   */
  const scopeKey = useMemo(
    () => `${activeFoyerId}::${isGlobal ? "G" : "P"}::${activeUserId}`,
    [activeFoyerId, isGlobal, activeUserId]
  );
  const [loadedScopeKey, setLoadedScopeKey] = useState<string>(scopeKey);

  const nameByPersonId = useMemo(() => buildNameByPersonId(activePeople), [activePeople]);

  const ctx: CommonCtx = useMemo(
    () => ({
      isGlobal,
      activeUserId,
      activeFoyerId,
      activeFoyerName: activeFoyer?.name ?? "Foyer",
      personIdsInActiveFoyer,
      nameByPersonId,
    }),
    [isGlobal, activeUserId, activeFoyerId, activeFoyer?.name, personIdsInActiveFoyer, nameByPersonId]
  );

  useEffect(() => {
    setLoaded(false);
    setLines(params.load(ctx));
    setLoadedScopeKey(scopeKey);
    setLoaded(true);
  }, [params, ctx, scopeKey]);

  // Keep multiple hook instances in sync.
  // Example: the Sankey page and the AddFlowWizard both call `useRevenus()`.
  // When the wizard persists to localStorage, the page must reload too.
  useEffect(() => {
    if (!loaded) return;

    const sameLines = (a: MoneyLine[], b: MoneyLine[]) => {
      if (a === b) return true;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        if (
          x.id !== y.id ||
          x.label !== y.label ||
          x.amount !== y.amount ||
          x.ownerKind !== y.ownerKind ||
          x.ownerId !== y.ownerId
        ) {
          return false;
        }
      }
      return true;
    };

    const reloadIfNeeded = () => {
      const next = params.load(ctx);
      setLines((prev) => (sameLines(prev, next) ? prev : next));
    };

    const onAppStorage = () => reloadIfNeeded();
    const onStorage = () => reloadIfNeeded();

    window.addEventListener("app:storage", onAppStorage as any);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("app:storage", onAppStorage as any);
      window.removeEventListener("storage", onStorage);
    };
  }, [loaded, params, ctx]);

  useEffect(() => {
    if (!loaded) return;
    // Do NOT persist when we haven't loaded the current scope yet.
    if (loadedScopeKey !== scopeKey) return;
    params.persist(ctx, lines);
  }, [loaded, lines, params, ctx, loadedScopeKey, scopeKey]);

  const canEdit = (l: MoneyLine) => canEditLine(ctx, l);

  const add = (label: string, amount: number, owner?: { kind: OwnerKind; ownerId?: string }) => {
    const lab = label.trim();
    if (!lab || !Number.isFinite(amount)) return;

    const targetKind = owner?.kind ?? (ctx.isGlobal ? params.defaultTargetKindInGlobal : "person");
    let targetId = owner?.ownerId;

    // Choose a sane default ownerId based on targetKind
    if (targetKind === "foyer") {
      targetId = targetId ?? ctx.activeFoyerId;
    } else {
      targetId = targetId ?? ctx.activeUserId;
    }

    // Non-global mode: force everything to active user.
    if (!ctx.isGlobal && targetKind === "person") {
      targetId = ctx.activeUserId;
    }

    const line: MoneyLine = {
      id: uid(params.uidPrefix),
      label: lab,
      amount,
      ownerKind: targetKind,
      ownerId: targetId ?? "",
      ownerName: getOwnerName(ctx, targetKind, targetId ?? ctx.activeUserId),
    };

    setLines((prev) => [line, ...prev]);
  };

  const update = (id: string, patch: Partial<Pick<MoneyLine, "label" | "amount">>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (String(l.id) !== String(id)) return l;
        if (!canEdit(l)) return l;
        return { ...l, ...patch };
      })
    );
  };

  const remove = (id: string) => {
    setLines((prev) => prev.filter((l) => !(String(l.id) === String(id) && canEdit(l))));
  };

  const totals = useMemo(() => {
    const editable = lines.filter(canEdit);
    const readonly = lines.filter((l) => !canEdit(l));
    return {
      totalAll: sumLines(lines),
      totalEditable: sumLines(editable),
      totalReadonly: sumLines(readonly),
    };
  }, [lines, ctx.isGlobal, ctx.activeUserId]); // keep dependencies stable and cheap

  return { lines, loaded, add, update, remove, canEdit, totals };
}
