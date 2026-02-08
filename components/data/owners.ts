"use client";

/**
 * Owner iteration helpers.
 *
 * WHY:
 * - Multiple stores iterate over the same conceptual owners (foyer + persons)
 *   with small variations depending on Global mode.
 * - Centralizing this logic avoids drift and makes future refactors faster for another AI.
 *
 * WHAT:
 * - `listOwners()` returns a stable list of owner descriptors (kind/id/name)
 *   for the current context.
 *
 * HOW:
 * - `includeFoyer` controls whether the foyer owner is included.
 * - `includePersons` controls whether we include only the active person or all persons.
 *
 * DANGER:
 * - This does NOT read/write storage. It only standardizes iteration.
 * - ORDER MATTERS: we intentionally return [foyer?, persons...] in that order.
 *   The UI (and some reducers) prepend new lines and expect a stable grouping.
 * - In non-global mode, asking for "all" persons collapses to ONLY the active person.
 *   This prevents accidental read/write of someone else's storage from a person-only view.
 */

export type OwnerKind = "foyer" | "person";

export type OwnerDescriptor = {
  kind: OwnerKind;
  id: string;
  name: string;
};

export type OwnersCtx = {
  isGlobal: boolean;
  activeUserId: string;
  activeFoyerId: string;
  activeFoyerName: string;
  personIdsInActiveFoyer: string[];
  nameByPersonId: Map<string, string>;
};

export type OwnersOptions = {
  /** Include the foyer owner in the returned list. */
  includeFoyer: "never" | "globalOnly" | "always";
  /** Which persons to include. */
  includePersons: "active" | "all";
};

/**
 * Canonical owner perimeters.
 *
 * WHY
 * - Keeps the UI and persistence layers in sync.
 * - Prevents "totals mismatch" bugs when one store changes its perimeter.
 */
export function ownersForFlows(ctx: OwnersCtx): OwnerDescriptor[] {
  // Flows: foyer only in Global mode.
  return listOwners(ctx, { includeFoyer: "globalOnly", includePersons: "all" });
}

export function ownersForEstate(ctx: OwnersCtx): OwnerDescriptor[] {
  // Estate: foyer always.
  return listOwners(ctx, { includeFoyer: "always", includePersons: "all" });
}

export function listOwners(ctx: OwnersCtx, opts: OwnersOptions): OwnerDescriptor[] {
  const owners: OwnerDescriptor[] = [];

  const shouldIncludeFoyer =
    opts.includeFoyer === "always" || (opts.includeFoyer === "globalOnly" && ctx.isGlobal);

  if (shouldIncludeFoyer) {
    owners.push({ kind: "foyer", id: ctx.activeFoyerId, name: ctx.activeFoyerName || "Foyer" });
  }

  // Persons: in non-global mode, "all" collapses to the active person on purpose.
  const personIds =
    ctx.isGlobal && opts.includePersons === "all" ? ctx.personIdsInActiveFoyer : [ctx.activeUserId];

  for (const pid of personIds) {
    owners.push({ kind: "person", id: pid, name: ctx.nameByPersonId.get(pid) ?? "Personne" });
  }

  return owners;
}
