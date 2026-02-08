import type { MoneyLine } from "@/components/data/flowsStore";
import type { SankeyLinkInput, SankeyNodeInput } from "@/components/ui/SimpleSankey";
import { sumLines } from "@/components/data/flowsStore";
import type { GraphConfig } from "@/components/data/graphConfigStore";

type ExpenseCat = "fixes" | "variables";

export type BuildBudgetSankeyInput = {
  revenus: MoneyLine[];
  depFixes: MoneyLine[];
  depVars: MoneyLine[];
  isGlobal: boolean;
  graph: GraphConfig;
  // NOTE: the UI has a view switch, even if the builder currently ignores it.
  view: "typeThenPerson" | "personThenType";
};

export type BudgetSankeyBuildResult = {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
  totals: { totalRev: number; totalExp: number; diff: number };
  hasObjectsColumn: boolean;
  hasRevenueOwnersColumn: boolean;
};

const SEP = " — ";

const safe = (v: number) => (Number.isFinite(v) ? v : 0);
const nonNeg = (v: number) => Math.max(0, safe(v));

const slug = (s: string) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "obj";

const assetNameOf = (label: string) => {
  const i = String(label ?? "").indexOf(SEP);
  if (i > 0) return String(label).slice(0, i).trim();
  return "Autres dépenses";
};

const detailLabelOf = (label: string) => {
  const i = String(label ?? "").indexOf(SEP);
  if (i > 0) return String(label).slice(i + SEP.length).trim();
  return String(label ?? "");
};

function computeOwnerLabeler(revenus: MoneyLine[], expenses: Array<MoneyLine & { cat?: ExpenseCat }>) {
  // Prefer the real person name instead of "Personne 1/2".
  // We still keep a stable fallback when the name is missing.
  const ownerLines: MoneyLine[] = [...expenses, ...revenus];

  const nameByOwner = new Map<string, string>();
  for (const l of ownerLines) {
    if (!l) continue;
    if (l.ownerKind === "foyer") continue;
    const k = `${l.ownerKind}:${l.ownerId}`;
    const name = String(l.ownerName ?? "").trim();
    if (name && !nameByOwner.has(k)) nameByOwner.set(k, name);
  }

  return (ownerKind: string, ownerId: string) => {
    if (ownerKind === "foyer") return "Commun";
    const k = `${ownerKind}:${ownerId}`;
    return nameByOwner.get(k) || "Personne";
  };
}

export function buildBudgetSankey(input: BuildBudgetSankeyInput): BudgetSankeyBuildResult {
  const { revenus, depFixes, depVars, isGlobal, graph } = input;

  const nodes: SankeyNodeInput[] = [];
  const links: SankeyLinkInput[] = [];

  const nodeIds = new Set<string>();
  const addNode = (n: SankeyNodeInput) => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };

  // ---- Revenus ----
  const totalNodeId = "rev:total";

  const revenueOwners = new Set<string>();
  for (const l of revenus) {
    const value = nonNeg(l.amount);
    if (value <= 0) continue;
    revenueOwners.add(`${l.ownerKind}:${l.ownerId}`);
  }
  const hasRevenueOwnersColumn = revenueOwners.size > 1;

  // Graph configuration
  const wantsRevOwner = graph.revenueDetailMode !== "none";
  const wantsRevDetail = graph.revenueDetailMode !== "none" && graph.revenueDetailMode !== "global_per_person";
  const showRevOwnerCol = hasRevenueOwnersColumn && wantsRevOwner;
  const showRevDetailCol = wantsRevDetail;

  // Stage layout (left -> right). We build stages sequentially to avoid gaps.
  let stageCursor = 0;
  const STAGE_REV_DETAIL = showRevDetailCol ? stageCursor++ : -1;
  const STAGE_REV_OWNER = showRevOwnerCol ? stageCursor++ : -1;
  const STAGE_REV_TOTAL = stageCursor++; // mandatory
  const STAGE_EXP_SUMMARY = stageCursor++; // mandatory (Dépenses total + épargne/découvert)
  const EXP_STAGE_START = stageCursor;

  const sumByOwner = new Map<string, number>();

  for (const l of revenus) {
    const value = nonNeg(l.amount);
    if (value <= 0) continue;

    const ownerKey = `${l.ownerKind}:${l.ownerId}`;
    sumByOwner.set(ownerKey, (sumByOwner.get(ownerKey) ?? 0) + value);

    if (!showRevDetailCol) continue;

    const id = `rev:${l.id}`;
    const ownerSuffix = isGlobal ? ` — ${l.ownerName}` : "";
    addNode({ id, label: `${l.label}${ownerSuffix}`, stage: STAGE_REV_DETAIL });

    if (showRevOwnerCol) {
      const ownerNodeId = `rev:owner:${l.ownerKind}:${l.ownerId}`;
      links.push({ source: id, target: ownerNodeId, value });
    } else {
      links.push({ source: id, target: totalNodeId, value });
    }
  }

  if (showRevOwnerCol) {
    for (const [ownerKey, value] of sumByOwner.entries()) {
      if (value <= 0) continue;
      const [ownerKind, ownerId] = ownerKey.split(":");
      const ownerNodeId = `rev:owner:${ownerKind}:${ownerId}`;
      addNode({ id: ownerNodeId, label: ownerNodeId, stage: STAGE_REV_OWNER });
      links.push({ source: ownerNodeId, target: totalNodeId, value });
    }
  }

  addNode({ id: totalNodeId, label: "Revenus (total)", stage: STAGE_REV_TOTAL });

  // ---- Totaux & solde ----
  const totalRev = nonNeg(sumLines(revenus));
  const totalExp = nonNeg(sumLines(depFixes) + sumLines(depVars));
  const diff = Math.round((totalRev - totalExp) * 100) / 100;

  const expTotalNodeId = "dep:total";
  addNode({ id: expTotalNodeId, label: "Dépenses (total)", stage: STAGE_EXP_SUMMARY });

  const fromRevToExp = Math.min(totalRev, totalExp);
  if (fromRevToExp > 0) links.push({ source: totalNodeId, target: expTotalNodeId, value: fromRevToExp });

  if (diff > 0.01) {
    const savingId = "bal:saving";
    addNode({ id: savingId, label: "Épargne", stage: STAGE_EXP_SUMMARY });
    links.push({ source: totalNodeId, target: savingId, value: diff });
  } else if (diff < -0.01) {
    const overdraftId = "bal:overdraft";
    addNode({ id: overdraftId, label: "Découvert", stage: STAGE_EXP_SUMMARY });
    links.push({ source: overdraftId, target: expTotalNodeId, value: Math.abs(diff) });
  }

  // ---- Dépenses ----
  const TYPE = {
    fixes: { id: "dep:type:fixes", label: "Fixes" },
    variables: { id: "dep:type:variables", label: "Variables" },
  } as const;

  const expenseLines: Array<MoneyLine & { cat: ExpenseCat }> = [
    ...depFixes.map((l) => ({ ...l, cat: "fixes" as const })),
    ...depVars.map((l) => ({ ...l, cat: "variables" as const })),
  ];

  const hasObjectsColumn = expenseLines.some((l) => String(l.label ?? "").includes(SEP));

  const ownerLabel = computeOwnerLabeler(revenus, expenseLines);

  // Update revenue owner labels now that Personne X is stable
  for (const n of nodes) {
    if (!n.id.startsWith("rev:owner:")) continue;
    const parts = n.id.split(":");
    const ownerKind = parts[2] ?? "";
    const ownerId = parts[3] ?? "";
    n.label = ownerLabel(ownerKind, ownerId);
    if (STAGE_REV_OWNER >= 0) n.stage = STAGE_REV_OWNER;
  }

  // Expense stages based on config
  let expStageCursor = EXP_STAGE_START;
  const STAGE_EXP_TYPE = graph.showExpenseTypeSplit ? expStageCursor++ : -1;
  const STAGE_EXP_OWNER = graph.showExpenseOwnerSplit ? expStageCursor++ : -1;
  const SHOW_OBJECTS = graph.showObjectsColumn && hasObjectsColumn;
  const STAGE_EXP_OBJECTS = SHOW_OBJECTS ? expStageCursor++ : -1;
  const STAGE_EXP_DETAIL = expStageCursor++;

  // 1) expTotal -> type
  if (graph.showExpenseTypeSplit) {
    addNode({ id: TYPE.fixes.id, label: TYPE.fixes.label, stage: STAGE_EXP_TYPE });
    addNode({ id: TYPE.variables.id, label: TYPE.variables.label, stage: STAGE_EXP_TYPE });

    const sumByType = { fixes: 0, variables: 0 };
    for (const l of expenseLines) {
      const v = nonNeg(l.amount);
      if (v <= 0) continue;
      sumByType[l.cat] += v;
    }
    if (sumByType.fixes > 0) links.push({ source: expTotalNodeId, target: TYPE.fixes.id, value: sumByType.fixes });
    if (sumByType.variables > 0)
      links.push({ source: expTotalNodeId, target: TYPE.variables.id, value: sumByType.variables });
  }

  // 2) type -> owner OR expTotal -> owner
  if (graph.showExpenseOwnerSplit) {
    const sumToOwner = new Map<string, number>();

    for (const l of expenseLines) {
      const v = nonNeg(l.amount);
      if (v <= 0) continue;

      const ownerKey = `${l.ownerKind}:${l.ownerId}`;
      if (graph.showExpenseTypeSplit) {
        const from = l.cat === "fixes" ? TYPE.fixes.id : TYPE.variables.id;
        sumToOwner.set(`${from}|${ownerKey}`, (sumToOwner.get(`${from}|${ownerKey}`) ?? 0) + v);
      } else {
        sumToOwner.set(ownerKey, (sumToOwner.get(ownerKey) ?? 0) + v);
      }
    }

    const created = new Set<string>();
    for (const [k, v] of sumToOwner.entries()) {
      if (v <= 0) continue;

      let from = expTotalNodeId;
      let ownerKey = k;
      if (graph.showExpenseTypeSplit) {
        const parts = k.split("|");
        from = parts[0];
        ownerKey = parts[1];
      }

      const [ownerKind, ownerId] = ownerKey.split(":");
      const ownerNodeId = `dep:owner:${ownerKind}:${ownerId}`;
      if (!created.has(ownerNodeId)) {
        created.add(ownerNodeId);
        addNode({ id: ownerNodeId, label: ownerLabel(ownerKind, ownerId), stage: STAGE_EXP_OWNER });
      }

      links.push({ source: from, target: ownerNodeId, value: v });
    }
  }

  // 3) (optional) owner/type/total -> objects
if (SHOW_OBJECTS) {
  const sumByOwnerObject = new Map<string, number>();

  for (const l of expenseLines) {
    const v = nonNeg(l.amount);
    if (v <= 0) continue;

    const ownerKey = `${l.ownerKind}:${l.ownerId}`;
    const asset = assetNameOf(l.label);
    const key = `${ownerKey}|${asset}`;
    sumByOwnerObject.set(key, (sumByOwnerObject.get(key) ?? 0) + v);
  }

  for (const [key, v] of sumByOwnerObject.entries()) {
    if (v <= 0) continue;

    const [ownerKey, assetName] = key.split("|");
    const [ownerKind, ownerId] = ownerKey.split(":");

    // Keep behavior identical to the previous implementation:
    // - If owner split is enabled: objects receive from the owner node.
    // - Else if type split is enabled: objects receive from the *first* type node (Fixes).
    // - Else: objects receive from Dépenses (total).
    const src = graph.showExpenseOwnerSplit
      ? `dep:owner:${ownerKind}:${ownerId}`
      : graph.showExpenseTypeSplit
      ? TYPE.fixes.id
      : expTotalNodeId;

    const objNodeId = `dep:obj:${ownerKind}:${ownerId}:${slug(assetName)}`;
    addNode({ id: objNodeId, label: assetName, stage: STAGE_EXP_OBJECTS });
    links.push({ source: src, target: objNodeId, value: v });
  }

  // 4) objects -> detail
  for (const l of expenseLines) {
    const v = nonNeg(l.amount);
    if (v <= 0) continue;

    const assetName = assetNameOf(l.label);
    const objNodeId = `dep:obj:${l.ownerKind}:${l.ownerId}:${slug(assetName)}`;
    const detailId = `dep:${l.cat}:detail:${l.ownerKind}:${l.ownerId}:${l.id}`;

    addNode({ id: detailId, label: detailLabelOf(l.label), stage: STAGE_EXP_DETAIL });
    links.push({ source: objNodeId, target: detailId, value: v });
  }
} else {

    // No objects column: point to detail directly from the nearest enabled stage.
    for (const l of expenseLines) {
      const v = nonNeg(l.amount);
      if (v <= 0) continue;
      const detailId = `dep:${l.cat}:detail:${l.ownerKind}:${l.ownerId}:${l.id}`;

      const src = graph.showExpenseOwnerSplit
        ? `dep:owner:${l.ownerKind}:${l.ownerId}`
        : graph.showExpenseTypeSplit
        ? l.cat === "fixes"
          ? TYPE.fixes.id
          : TYPE.variables.id
        : expTotalNodeId;

      addNode({ id: detailId, label: l.label, stage: STAGE_EXP_DETAIL });
      links.push({ source: src, target: detailId, value: v });
    }
  }

  return {
    nodes,
    links,
    totals: { totalRev, totalExp, diff },
    hasObjectsColumn,
    hasRevenueOwnersColumn: showRevOwnerCol,
  };
}
