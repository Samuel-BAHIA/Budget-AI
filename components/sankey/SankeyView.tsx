"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { PageShell } from "@/components/patterns/PageShell";
import DashboardTabs from "@/components/nav/DashboardTabs";
import FloatingPlusButton from "@/components/ui/FloatingPlusButton";
import AddFlowWizard from "@/components/ui/AddFlowWizard";
import type { SankeyLinkInput, SankeyNodeInput } from "@/components/ui/SimpleSankey";
import { useExpenses, useRevenus, sumLines } from "@/components/data/flowsStore";
import { useUsers } from "@/components/user/UserProvider";
import { formatEUR } from "@/components/utils/format";

// Sankey is a layout-dependent visualization (ResizeObserver, measured container sizes, etc.).
// Rendering it client-only avoids SSR hydration mismatches.
const SimpleSankey = dynamic(() => import("@/components/ui/SimpleSankey"), { ssr: false });

/**
 * Sankey (données réelles)
 * Gauche → Droite : Revenus détaillés → Revenus (total) → Dépenses
 */

export type SankeyViewMode = "global" | "person" | "type" | "posts";

type FlowType = "rental" | "property" | "car" | "unitExpense" | "income";

export function SankeyView({
  mode = "global",
  pageTitle = "Vue globale — Budget",
  showExpenseColumnReorder = true,
  forceRevenueOwnersColumn,
  fixedExpenseCols,
  postsPrimaryColumn,
  showDashboardTabs = false,
}: {
  mode?: SankeyViewMode;
  pageTitle?: string;
  showExpenseColumnReorder?: boolean;
  forceRevenueOwnersColumn?: boolean;
  fixedExpenseCols?: ("type" | "person" | "objects")[];
  postsPrimaryColumn?: "objects" | "type";
  showDashboardTabs?: boolean;
}) {
  // Navigation direction (set by AppShell) used to animate only the diagram frame when switching dashboard tabs.
  const diagramNavDir: "forward" | "back" =
    typeof document !== "undefined" && document.documentElement.dataset.navDir === "back" ? "back" : "forward";

  const { isGlobal, activeFoyerId } = useUsers();
  const revenus = useRevenus();
  const depFixes = useExpenses("fixes");
  const depVars = useExpenses("variables");

  const fixesById = useMemo(() => new Map(depFixes.lines.map((l) => [String(l.id), l])), [depFixes.lines]);
  const varsById = useMemo(() => new Map(depVars.lines.map((l) => [String(l.id), l])), [depVars.lines]);
  const revById = useMemo(() => new Map(revenus.lines.map((l) => [String(l.id), l])), [revenus.lines]);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitialType, setWizardInitialType] = useState<FlowType | undefined>(undefined);

  type AssetType = "rental" | "property" | "car" | "unknown";
type AssetLineDraft = {
  id: string; // local ui id
  label: string;
  amount: string;
  cat: "fixes" | "variables";
  readonly?: boolean;
  sourceLineId?: string; // existing MoneyLine id (if any)
};

const [assetEdit, setAssetEdit] = useState<null | {
  ownerKind: string;
  ownerId: string;
  assetName: string;
  assetType: AssetType;
  deletable: boolean;
  lines: AssetLineDraft[];
  confirmDelete: boolean;
}>(null);

  const onNodeClick = (node: { id: string; stage: number; label: string }) => {
  // Actions are allowed on:
  // - expense *detail* nodes (slider/rename/delete)
  // - expense *object* nodes (open the "step 4" editor for an asset)
  // - revenue detail nodes (slider/delete)
  if (node.id.startsWith("rev:") && node.id !== "rev:total") {
    const lineId = node.id.slice("rev:".length);
    const line = revById.get(String(lineId));
    if (!line) return;
    const editable = revenus.canEdit(line);
    setRevenueEdit({
      id: String(line.id),
      label: line.label,
      amount: line.amount,
      editable,
    });
    return;
  }

  if (!node.id.startsWith("dep:")) return;

  const SEP = " — ";

  const defaultLinesForAsset = (type: AssetType): AssetLineDraft[] => {
    const mk = (label: string, cat: "fixes" | "variables" = "fixes"): AssetLineDraft => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label,
      amount: "",
      cat,
      readonly: true,
    });

    if (type === "rental") {
      return [
        mk("Loyer", "fixes"),
        mk("Eau", "fixes"),
        mk("Électricité", "fixes"),
        mk("Gaz", "fixes"),
        mk("Internet", "fixes"),
        mk("Assurance habitation", "fixes"),
      ];
    }
    if (type === "property") {
      return [
        mk("Crédit immobilier", "fixes"),
        mk("Charges copropriété", "fixes"),
        mk("Taxe foncière", "fixes"),
        mk("Assurance habitation", "fixes"),
        mk("Travaux / Entretien", "variables"),
      ];
    }
    if (type === "car") {
      return [
        mk("Crédit voiture", "fixes"),
        mk("Assurance voiture", "fixes"),
        mk("Carburant", "variables"),
        mk("Entretien", "variables"),
        mk("Parking", "fixes"),
      ];
    }
    return [];
  };

  const loadAssetType = (assetName: string): AssetType => {
    // Best effort: read the asset registry saved by the wizard.
    try {
      const key = `test.assets.foyer.${activeFoyerId}.v1`;
      const raw = localStorage.getItem(key);
      const list = raw ? (JSON.parse(raw) as any[]) : [];
      const found = list.find((x) => String(x?.name ?? "") === String(assetName));
      const t = String(found?.type ?? "");
      if (t === "rental" || t === "property" || t === "car") return t;
    } catch {
      // ignore
    }

    // Fallback heuristics
    const n = assetName.toLowerCase();
    if (n.startsWith("voiture")) return "car";
    if (n.startsWith("app")) return "rental";
    return "unknown";
  };

  // --- Object node click: open the asset editor (wizard step 4 equivalent) ---
  // Object node id format: dep:obj:{ownerKind}:{ownerId}:{slug}
  if (node.id.startsWith("dep:obj:")) {
    const parts = node.id.split(":");
    const ownerKind = parts[2] ?? "";
    const ownerId = parts[3] ?? "";
    const assetName = (node.label ?? "").trim();

    const t = assetName.toLowerCase();
    const deletable = t !== "autres dépenses" && t !== "autres depenses";

    if (!deletable) {
      // Virtual bucket: nothing to edit, but keep it clear.
      setAssetEdit({
        ownerKind,
        ownerId,
        assetName,
        assetType: "unknown",
        deletable: false,
        lines: [],
        confirmDelete: false,
      });
      return;
    }

    const assetType = loadAssetType(assetName);

    const matches = (l: any) =>
      l &&
      String(l.ownerKind) === String(ownerKind) &&
      String(l.ownerId) === String(ownerId) &&
      String(l.label ?? "").startsWith(assetName + SEP);

    const existingFixes = depFixes.lines.filter(matches);
    const existingVars = depVars.lines.filter(matches);

    const existingByDetail = new Map<string, { cat: "fixes" | "variables"; amount: number; id: string }>();
    for (const l of existingFixes) {
      const detail = String(l.label ?? "").slice((assetName + SEP).length).trim();
      existingByDetail.set(detail, { cat: "fixes", amount: l.amount, id: String(l.id) });
    }
    for (const l of existingVars) {
      const detail = String(l.label ?? "").slice((assetName + SEP).length).trim();
      existingByDetail.set(detail, { cat: "variables", amount: l.amount, id: String(l.id) });
    }

    const drafts: AssetLineDraft[] = [];
    const defaults = defaultLinesForAsset(assetType);
    const defaultLabels = new Set(defaults.map((d) => d.label));

    // Defaults first
    for (const d of defaults) {
      const ex = existingByDetail.get(d.label);
      drafts.push({
        ...d,
        amount: ex ? String(ex.amount) : "",
        cat: ex ? ex.cat : d.cat,
        sourceLineId: ex?.id,
        readonly: true,
      });
    }

    // Extra lines (non-default)
    for (const [detail, ex] of existingByDetail.entries()) {
      if (defaultLabels.has(detail)) continue;
      drafts.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        label: detail,
        amount: String(ex.amount),
        cat: ex.cat,
        sourceLineId: ex.id,
        readonly: false,
      });
    }

    // Always allow adding a custom line
    drafts.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label: "",
      amount: "",
      cat: "fixes",
      readonly: false,
    });

    setAssetEdit({
      ownerKind,
      ownerId,
      assetName,
      assetType,
      deletable,
      lines: drafts,
      confirmDelete: false,
    });
    return;
  }

  // --- Expense detail node click (slider/rename/delete) ---
  if (!node.id.includes(":detail:")) return;

  // id format: dep:{cat}:detail:{ownerKind}:{ownerId}:{lineId}
  const parts = node.id.split(":");
  const cat = parts[1] === "fixes" ? "fixes" : parts[1] === "variables" ? "variables" : null;
  if (!cat) return;
  const lineId = parts[parts.length - 1];
  const line = cat === "fixes" ? fixesById.get(String(lineId)) : varsById.get(String(lineId));
  if (!line) return;

  const editable = cat === "fixes" ? depFixes.canEdit(line) : depVars.canEdit(line);
  setExpenseEdit({
    cat,
    id: String(line.id),
    label: line.label,
    amount: line.amount,
    editable,
  });
};

  // ---- Expense columns order (Vue globale) ----
  // Fixed columns: Revenus*, "Dépenses (total) / Solde" and the LAST expense column "Dépenses (détail)".
  // Reorderable columns are the intermediate expense columns (Type, Personne, Objets).
  type ExpColKey = "type" | "person" | "objects";
  type ExpHiddenKey = ExpColKey | "detail";
  const STORAGE_KEY = "budget:sankey:expenseCols:v2";
  const DEFAULT_EXPENSE_COLS: ExpColKey[] = fixedExpenseCols ?? ["type", "person", "objects"];

  const [expenseColsState, setExpenseColsState] = useState<ExpColKey[]>(DEFAULT_EXPENSE_COLS);
  const expenseCols: ExpColKey[] = fixedExpenseCols ?? expenseColsState;
  const [draggingCol, setDraggingCol] = useState<ExpColKey | null>(null);

  // UI: global columns dropdown (Vue personnalisée)
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const [colsMenuPlacement, setColsMenuPlacement] = useState<"header" | "bottom">("header");
  const colsMenuRef = useRef<HTMLDivElement | null>(null);

  // Close the columns popover when clicking outside.
  useEffect(() => {
    if (!colsMenuOpen || colsMenuPlacement !== "header") return;
    const onDown = (e: MouseEvent) => {
      const el = colsMenuRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setColsMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [colsMenuOpen, colsMenuPlacement]);

  // Mobile bottom bar action → open the columns menu as a bottom sheet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => {
      setColsMenuPlacement("bottom");
      setColsMenuOpen(true);
    };
    window.addEventListener("budget:sankey:openColumnsMenu", onOpen as EventListener);
    return () => window.removeEventListener("budget:sankey:openColumnsMenu", onOpen as EventListener);
  }, []);


  // ---- Expense columns visibility (Vue globale) ----
  // Allows hiding any intermediate expense columns (Type/Personne/Objets), while keeping fixed columns.
  const HIDDEN_COLS_KEY = "budget:sankey:hiddenExpenseCols:v2";
  const [hiddenExpenseCols, setHiddenExpenseCols] = useState<ExpHiddenKey[]>([]);

  // ---- Revenue columns visibility (Vue globale) ----
  // Allows hiding optional revenue columns (the revenue total column stays fixed).
  type RevColKey = "detail" | "person";
  const HIDDEN_REV_COLS_KEY = "budget:sankey:hiddenRevenueCols:v1";
  const [hiddenRevenueCols, setHiddenRevenueCols] = useState<RevColKey[]>([]);

  useEffect(() => {
    if (mode !== "global") return;
    try {
      const raw = localStorage.getItem(HIDDEN_REV_COLS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const cleaned = Array.from(new Set(parsed)).filter((k): k is RevColKey => k === "detail" || k === "person");
      setHiddenRevenueCols(cleaned);
    } catch {
      // ignore
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "global") return;
    try {
      localStorage.setItem(HIDDEN_REV_COLS_KEY, JSON.stringify(hiddenRevenueCols));
    } catch {
      // ignore
    }
  }, [hiddenRevenueCols, mode]);

  useEffect(() => {
    // Only the global view exposes toggles; other views have fixed layouts.
    if (mode !== "global") return;
    try {
      const raw = localStorage.getItem(HIDDEN_COLS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const cleaned = Array.from(new Set(parsed)).filter((k): k is ExpHiddenKey =>
        k === "type" || k === "person" || k === "objects" || k === "detail"
      );
      setHiddenExpenseCols(cleaned);
    } catch {
      // ignore
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "global") return;
    try {
      localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(hiddenExpenseCols));
    } catch {
      // ignore
    }
  }, [hiddenExpenseCols, mode]);

  // Load persisted order (client-only)
  useEffect(() => {
    if (fixedExpenseCols) return;
    try {
      // v2 format: ["type","person","objects"]
      const rawV2 = localStorage.getItem(STORAGE_KEY);

      // v1 format (legacy): { typeThenPerson?: [...], personThenType?: [...] }
      const rawV1 = localStorage.getItem("budget:sankey:expenseCols:v1");

      const parsed: any = rawV2 ? JSON.parse(rawV2) : rawV1 ? JSON.parse(rawV1) : null;
      if (!parsed) return;

      const order: ExpColKey[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.typeThenPerson)
          ? parsed.typeThenPerson
          : DEFAULT_EXPENSE_COLS;

      // sanitize
      const unique = Array.from(new Set(order)).filter((k): k is ExpColKey =>
        k === "type" || k === "person" || k === "objects"
      );
      const completed = [...unique, ...DEFAULT_EXPENSE_COLS.filter((k) => !unique.includes(k))];
      setExpenseColsState(completed);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist order
  useEffect(() => {
    if (fixedExpenseCols) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expenseCols));
    } catch {
      // ignore
    }
  }, [expenseCols, fixedExpenseCols]);

  const moveExpenseCol = (from: number, to: number) => {
    if (fixedExpenseCols) return;
    setExpenseColsState((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

    const [revenueEdit, setRevenueEdit] = useState<null | {
    id: string;
    label: string;
    amount: number;
    editable: boolean;
  }>(null);

const [expenseEdit, setExpenseEdit] = useState<null | {
    cat: "fixes" | "variables";
    id: string;
    label: string;
    amount: number;
    editable: boolean;
  }>(null);


  // ---- Posts view: allow switching the single expense column between "Objets" and "Type".
  // If the caller provides `postsPrimaryColumn`, it overrides the internal switch state.
  const [postsPrimaryColState, setPostsPrimaryColState] = useState<"objects" | "type">("objects");

  const { nodes, links, totals, hasObjectsColumn, hasRevenueOwnersColumn } = useMemo(() => {
    const nodes: SankeyNodeInput[] = [];
    const links: SankeyLinkInput[] = [];

    const nodeIds = new Set<string>();
    const addNode = (n: SankeyNodeInput) => {
      if (nodeIds.has(n.id)) return;
      nodeIds.add(n.id);
      nodes.push(n);
    };

    // ---- Helpers ----
    const safe = (v: number) => (Number.isFinite(v) ? v : 0);
    const nonNeg = (v: number) => Math.max(0, safe(v));

    // ---- Build nodes ----
    const totalNodeId = "rev:total";

    // In "type" and "posts" views, we don't need the detailed revenue column.
    // In global view, the user can also hide revenue columns via checkboxes.
    const hideRevDetail = mode === "global" && hiddenRevenueCols.includes("detail");
    const hideRevPerson = mode === "global" && hiddenRevenueCols.includes("person");
    const showRevenueDetail = (mode === "global" || mode === "person") && !hideRevDetail;

    // Should we show an intermediate column "Revenus (personne)"?
    // Only show it when there are revenues from multiple owners.
    const revenueOwners = new Set<string>();
    for (const l of revenus.lines) {
      const value = nonNeg(l.amount);
      if (value <= 0) continue;
      revenueOwners.add(`${l.ownerKind}:${l.ownerId}`);
    }
    const hasRevenueOwnersColumn = (Boolean(forceRevenueOwnersColumn) || revenueOwners.size > 1) && !hideRevPerson;

    const STAGE_REV_DETAIL = showRevenueDetail ? 0 : null;
    const STAGE_REV_OWNER = hasRevenueOwnersColumn ? (showRevenueDetail ? 1 : 0) : null;
    const STAGE_REV_TOTAL = hasRevenueOwnersColumn ? (showRevenueDetail ? 2 : 1) : showRevenueDetail ? 1 : 0;
    const STAGE_EXP_SUMMARY = STAGE_REV_TOTAL + 1; // Dépenses (total) + épargne/découvert
    const EXP_BASE = STAGE_EXP_SUMMARY + 1; // first detailed expense column stage

    // Revenus (détail optionnel)
    if (hasRevenueOwnersColumn) {
      // (detail?) -> owner -> total
      const sumByOwner = new Map<string, number>();

      for (const l of revenus.lines) {
        const value = nonNeg(l.amount);
        if (value <= 0) continue;
        const ownerKey = `${l.ownerKind}:${l.ownerId}`;
        const ownerNodeId = `rev:owner:${l.ownerKind}:${l.ownerId}`;
        sumByOwner.set(ownerKey, (sumByOwner.get(ownerKey) ?? 0) + value);

        if (showRevenueDetail) {
          const id = `rev:${l.id}`;
          // Keep the detailed column readable: show the owner suffix only in global view.
          const ownerSuffix = isGlobal ? ` — ${l.ownerName}` : "";
          addNode({ id, label: `${l.label}${ownerSuffix}`, stage: STAGE_REV_DETAIL! });
          links.push({ source: id, target: ownerNodeId, value });
        }
      }

      // owner totals (stage 1)
      for (const [ownerKey, value] of sumByOwner.entries()) {
        if (value <= 0) continue;
        const [ownerKind, ownerId] = ownerKey.split(":");
        const ownerNodeId = `rev:owner:${ownerKind}:${ownerId}`;
        // label will be resolved later (we reuse the same Personne X / Commun logic)
        addNode({ id: ownerNodeId, label: ownerNodeId, stage: STAGE_REV_OWNER! });
        links.push({ source: ownerNodeId, target: totalNodeId, value });
      }
    } else {
      // (detail?) -> total
      for (const l of revenus.lines) {
        const value = nonNeg(l.amount);
        if (value <= 0) continue;

        if (showRevenueDetail) {
          const id = `rev:${l.id}`;
          const ownerSuffix = isGlobal ? ` — ${l.ownerName}` : "";
          addNode({ id, label: `${l.label}${ownerSuffix}`, stage: STAGE_REV_DETAIL! });
          links.push({ source: id, target: totalNodeId, value });
        }
      }
    }

    // Total revenus
    addNode({ id: totalNodeId, label: "Revenus (total)", stage: STAGE_REV_TOTAL });

    // ---- Totaux & solde (colonne intermédiaire avant Dépenses (type)) ----
    const totalRev = nonNeg(sumLines(revenus.lines));
    const totalExp = nonNeg(sumLines(depFixes.lines) + sumLines(depVars.lines));
    const diff = Math.round((totalRev - totalExp) * 100) / 100;

    const expTotalNodeId = "dep:total";
    addNode({ id: expTotalNodeId, label: "Dépenses (total)", stage: STAGE_EXP_SUMMARY });

    // Le total des dépenses est alimenté par les revenus, et éventuellement par le découvert.
    const fromRevToExp = Math.min(totalRev, totalExp);
    if (fromRevToExp > 0) links.push({ source: totalNodeId, target: expTotalNodeId, value: fromRevToExp });

    if (diff > 0.01) {
      const savingId = "bal:saving";
      addNode({ id: savingId, label: "Épargne", stage: STAGE_EXP_SUMMARY });
      links.push({ source: totalNodeId, target: savingId, value: diff });
    } else if (diff < -0.01) {
      const overdraftId = "bal:overdraft";
      addNode({ id: overdraftId, label: "Découvert", stage: STAGE_EXP_SUMMARY });
      // Le découvert complète pour atteindre le total des dépenses.
      links.push({ source: overdraftId, target: expTotalNodeId, value: Math.abs(diff) });
    }


    // Dépenses
    // View A (default):  Stage 2 = type (Fixes / Variables)  -> Stage 3 = personne -> Stage 4 = détail
    // View B (inverted): Stage 2 = personne                 -> Stage 3 = type      -> Stage 4 = détail

    const TYPE = {
      fixes: { id: "dep:type:fixes", label: "Fixes" },
      variables: { id: "dep:type:variables", label: "Variables" },
    } as const;

    const expenseLines = [
      ...depFixes.lines.map((l) => ({ ...l, cat: "fixes" as const })),
      ...depVars.lines.map((l) => ({ ...l, cat: "variables" as const })),
    ];

    // If we have assets (appartements / biens / voitures created by the wizard),
    // we insert an extra column "Objets" before the expense details.
    // Asset lines are stored as "<assetName> — <lineLabel>".
    const SEP = " — ";
    const hasObjectsColumn = expenseLines.some((l) => String(l.label ?? "").includes(SEP));

    // ---- Dynamic expense column stages (reorderable) ----
    // Intermediate expense columns are reorderable; the very last column (detail) is fixed.
    const uniq = (arr: ExpColKey[]) => arr.filter((k, idx) => arr.indexOf(k) === idx);
    const baseRaw = uniq(expenseCols.filter((k) => k !== "objects" || hasObjectsColumn));
    // In global view only, allow hiding intermediate expense columns.
    const base = mode === "global" ? baseRaw.filter((k) => !hiddenExpenseCols.includes(k)) : baseRaw;

    // Column order rules per view.
    //
    // Vue globale   : ordre utilisateur (réordonner /type /pers /objet)
    // Vue personne  : on met en avant UNIQUEMENT /pers
    // Vue type      : on met en avant UNIQUEMENT /type (fixes/variables)
    // Vue postes    : on met en avant UNIQUEMENT /objet (si présent), sinon /type
    const sanitize = (wanted: ExpColKey[]) => {
      const next: ExpColKey[] = [];
      for (const k of wanted) {
        if (k === "objects" && !hasObjectsColumn) continue;
        if (!next.includes(k)) next.push(k);
      }
      return next;
    };

    // Global: keep user order, but guarantee required columns exist (and avoid duplicates).
    const ensureGlobal = (wanted: ExpColKey[]) => {
      const next = sanitize(wanted);
      for (const k of base) {
        if (!next.includes(k)) next.push(k);
      }
      return next;
    };

    let effectiveExpenseCols: ExpColKey[] = base;
    if (mode === "person") effectiveExpenseCols = sanitize(["person"]);
    else if (mode === "type") effectiveExpenseCols = sanitize(["type"]);
    else if (mode === "posts") {
      // "Posts" view can switch between "Objets" and "Type".
      const preferredRaw = postsPrimaryColumn ?? postsPrimaryColState;
      const preferred: ExpColKey = preferredRaw === "objects" && !hasObjectsColumn ? "type" : preferredRaw;
      effectiveExpenseCols = sanitize([preferred]);
    }
    else {
      // global (default): keep the current user order (and hidden columns).
      effectiveExpenseCols = base;
    }



    const stageOf = (dim: ExpColKey) => {
      const idx = effectiveExpenseCols.indexOf(dim);
      return idx >= 0 ? EXP_BASE + idx : -1;
    };

    const hideExpDetail = mode === "global" && hiddenExpenseCols.includes("detail");
    // Guard: if the user hides every intermediate expense column, we keep "détail" visible
    // otherwise the expenses would disappear entirely.
    const showExpDetail = !hideExpDetail || effectiveExpenseCols.length === 0;

    const expStage = {
      type: stageOf("type"),
      person: stageOf("person"),
      objects: stageOf("objects"),
      detail: showExpDetail ? EXP_BASE + effectiveExpenseCols.length : -1,
    } as const;
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
    const slug = (s: string) =>
      String(s)
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || "obj";

    // --- Labels "Nom de la personne / Commun" ---
    // We prefer the actual person name instead of "Personne 1/2".
    const ownerLines: Array<any> = [...expenseLines, ...revenus.lines];
    const nameByOwner = new Map<string, string>();
    for (const l of ownerLines) {
      if (!l) continue;
      if (String(l.ownerKind) === "foyer") continue;
      const k = `${l.ownerKind}:${l.ownerId}`;
      const n = String(l.ownerName ?? "").trim();
      if (n && !nameByOwner.has(k)) nameByOwner.set(k, n);
    }

    const ownerLabel = (ownerKind: string, ownerId: any) => {
      if (ownerKind === "foyer") return "Commun";
      const k = `${ownerKind}:${ownerId}`;
      return nameByOwner.get(k) || "Personne";
    };

    // Replace placeholder labels for the revenue owner nodes, now that we have stable Personne X indexing.
    for (const n of nodes) {
      if (!n.id.startsWith("rev:owner:")) continue;
      const parts = n.id.split(":");
      const ownerKind = parts[2] ?? "";
      const ownerId = parts[3] ?? "";
      n.label = ownerLabel(ownerKind, ownerId);
      n.stage = STAGE_REV_OWNER ?? n.stage;
    }


// ---- Build expense flows according to the current (reorderable) column order ----
// We connect only adjacent columns; when the order changes, flows are recalculated accordingly.
//
// Columns (keys): "type" (Fixes/Variables), "person" (Commun/Personne X), "objects" (Biens/Voiture/Autres dépenses)
// Last column (detail) is always fixed.
const cols = effectiveExpenseCols;

// Type nodes must NOT be duplicated: we always keep a single "Fixes" and a single "Variables".
const typeNodeIdOf = (_ownerKind: string, _ownerId: any, cat: "fixes" | "variables") =>
  cat === "fixes" ? TYPE.fixes.id : TYPE.variables.id;

const ensureNodeForDim = (dim: ExpColKey, l: any) => {
  const ownerKind = String(l.ownerKind ?? "");
  const ownerId = String(l.ownerId ?? "");
  if (dim === "type") {
    const id = typeNodeIdOf(ownerKind, ownerId, l.cat);
    if (expStage.type >= 0)
      addNode({ id, label: l.cat === "fixes" ? "Fixes" : "Variables", stage: expStage.type });
    return id;
  }
  if (dim === "person") {
    const id = `dep:owner:${ownerKind}:${ownerId}`;
    if (expStage.person >= 0) addNode({ id, label: ownerLabel(ownerKind, ownerId), stage: expStage.person });
    return id;
  }
  // objects
  const assetName = assetNameOf(l.label);
  const id = `dep:obj:${ownerKind}:${ownerId}:${slug(assetName)}`;
  if (expStage.objects >= 0) addNode({ id, label: assetName, stage: expStage.objects });
  return id;
};

// Pre-create the type nodes (so the column doesn't feel empty).
if (expStage.type >= 0) {
  addNode({ id: TYPE.fixes.id, label: "Fixes", stage: expStage.type });
  addNode({ id: TYPE.variables.id, label: "Variables", stage: expStage.type });
}

// Aggregate links to keep the diagram clean (avoid 1 link per line when possible)
const addAggLink = (m: Map<string, number>, s: string, t: string, v: number) => {
  if (v <= 0) return;
  const k = `${s}→${t}`;
  m.set(k, (m.get(k) ?? 0) + v);
};

const agg = new Map<string, number>();

for (const l of expenseLines) {
  const value = nonNeg(l.amount);
  if (value <= 0) continue;

  // When "détail" is hidden (Vue personnalisée), we stop at the last intermediate column.
  const wantDetail = expStage.detail >= 0;
  const detailId = wantDetail ? `dep:${l.cat}:detail:${l.ownerKind}:${l.ownerId}:${l.id}` : null;
  if (wantDetail && detailId) {
    addNode({
      id: detailId,
      label: hasObjectsColumn ? detailLabelOf(l.label) : l.label,
      stage: expStage.detail,
    });
  }

  // If there is no intermediate column:
  // - with détail: connect total -> détail
  // - without détail: nothing to draw beyond the "Dépenses (total)" column.
  if (cols.length === 0) {
    if (wantDetail && detailId) addAggLink(agg, expTotalNodeId, detailId, value);
    continue;
  }

  // total -> first dim
  const firstId = ensureNodeForDim(cols[0], l);
  addAggLink(agg, expTotalNodeId, firstId, value);

  // dim[i] -> dim[i+1]
  for (let i = 0; i < cols.length - 1; i++) {
    const a = ensureNodeForDim(cols[i], l);
    const b = ensureNodeForDim(cols[i + 1], l);
    addAggLink(agg, a, b, value);
  }

  // last dim -> detail (optional)
  const lastId = ensureNodeForDim(cols[cols.length - 1], l);
  if (wantDetail && detailId) addAggLink(agg, lastId, detailId, value);
}

// Materialize aggregated links
for (const [k, v] of agg.entries()) {
  if (v <= 0) continue;
  const [source, target] = k.split("→");
  links.push({ source, target, value: v });
}

    // (Optionnel) dédoublonnage de nodes par id (sécurité)
    const byId = new Map<string, SankeyNodeInput>();
    for (const n of nodes) byId.set(n.id, n);

    return {
      nodes: Array.from(byId.values()),
      links,
      totals: { totalRev, totalExp, diff },
      hasObjectsColumn,
      hasRevenueOwnersColumn,
    };
  }, [
    depFixes.lines,
    depVars.lines,
    revenus.lines,
    expenseCols,
    mode,
    hiddenExpenseCols,
    hiddenRevenueCols,
    forceRevenueOwnersColumn,
    postsPrimaryColumn,
    postsPrimaryColState,
    isGlobal,
  ]);

  useEffect(() => {
    // If there are no object-based expense labels, force "Type".
    if (!hasObjectsColumn) setPostsPrimaryColState("type");
  }, [hasObjectsColumn]);
  const effectivePostsPrimaryCol: "objects" | "type" = (postsPrimaryColumn ?? postsPrimaryColState) === "objects" && !hasObjectsColumn ? "type" : (postsPrimaryColumn ?? postsPrimaryColState);

  const stageLabels = useMemo(() => {
    // Global group titles are rendered separately (see `groupLabels`).
    const hideRevDetail = mode === "global" && hiddenRevenueCols.includes("detail");
    const hideRevPerson = mode === "global" && hiddenRevenueCols.includes("person");
    const showRevenueDetail = (mode === "global" || mode === "person") && !hideRevDetail;
    const showRevPerson = hasRevenueOwnersColumn && !hideRevPerson;
    const revCols = (() => {
      if (!showRevenueDetail) return showRevPerson ? ["/pers", "TOTAL"] : ["TOTAL"];
      return showRevPerson ? ["détail", "/pers", "TOTAL"] : ["détail", "TOTAL"];
    })();

    const labelOf = (k: ExpColKey) => (k === "type" ? "/type" : k === "person" ? "/pers" : "/objet");

    const sanitize = (wanted: ExpColKey[]) => {
      const next: ExpColKey[] = [];
      for (const k of wanted) {
        if (k === "objects" && !hasObjectsColumn) continue;
        if (!next.includes(k)) next.push(k);
      }
      return next;
    };

    const baseRaw = sanitize(expenseCols.filter((k) => k !== "objects" || hasObjectsColumn));
    const base = mode === "global" ? baseRaw.filter((k) => !hiddenExpenseCols.includes(k)) : baseRaw;

    let expenseColsEff: ExpColKey[] = base;
    if (mode === "person") expenseColsEff = sanitize(["person"]);
    else if (mode === "type") expenseColsEff = sanitize(["type"]);
    else if (mode === "posts") {
      // "Posts" view can switch between "Objets" and "Type".
      const preferred = effectivePostsPrimaryCol ?? (hasObjectsColumn ? "objects" : "type");
      expenseColsEff = sanitize([preferred]);
    } else expenseColsEff = base;

    const hideExpDetail = mode === "global" && hiddenExpenseCols.includes("detail");
    const showExpDetail = !hideExpDetail || expenseColsEff.length === 0;
    const expCols = [...expenseColsEff.map(labelOf), ...(showExpDetail ? ["détail"] : [])];
    return [...revCols, "TOTAL", ...expCols];
  }, [
    expenseCols,
    hasObjectsColumn,
    hasRevenueOwnersColumn,
    hiddenExpenseCols,
    hiddenRevenueCols,
    mode,
    effectivePostsPrimaryCol,
  ]);

  const groupLabels = useMemo(() => {
    const hideRevDetail = mode === "global" && hiddenRevenueCols.includes("detail");
    const hideRevPerson = mode === "global" && hiddenRevenueCols.includes("person");
    const showRevenueDetail = (mode === "global" || mode === "person") && !hideRevDetail;
    const showRevPerson = hasRevenueOwnersColumn && !hideRevPerson;
    const revStages = showRevenueDetail ? (showRevPerson ? 3 : 2) : showRevPerson ? 2 : 1;

    const sanitize = (wanted: ExpColKey[]) => {
      const next: ExpColKey[] = [];
      for (const k of wanted) {
        if (k === "objects" && !hasObjectsColumn) continue;
        if (!next.includes(k)) next.push(k);
      }
      return next;
    };

    const baseRaw = sanitize(expenseCols.filter((k) => k !== "objects" || hasObjectsColumn));
    const base = mode === "global" ? baseRaw.filter((k) => !hiddenExpenseCols.includes(k)) : baseRaw;

    let expenseColsEff: ExpColKey[] = base;
    if (mode === "person") expenseColsEff = sanitize(["person"]);
    else if (mode === "type") expenseColsEff = sanitize(["type"]);
    else if (mode === "posts") {
      const preferred = effectivePostsPrimaryCol ?? (hasObjectsColumn ? "objects" : "type");
      expenseColsEff = sanitize([preferred]);
    } else expenseColsEff = base;

    const hideExpDetail = mode === "global" && hiddenExpenseCols.includes("detail");
    const showExpDetail = !hideExpDetail || expenseColsEff.length === 0;
    const expDimCount = expenseColsEff.length;
    const totalStages = revStages + 1 /* TOTAL (dépenses) */ + expDimCount + (showExpDetail ? 1 : 0);

    return [
      { label: "Revenus", fromStage: 0, toStage: revStages - 1 },
      { label: "Dépenses", fromStage: revStages, toStage: totalStages - 1 },
    ];
  }, [expenseCols, hasObjectsColumn, hasRevenueOwnersColumn, hiddenExpenseCols, hiddenRevenueCols, mode, effectivePostsPrimaryCol]);

  // Key used ONLY to trigger the diagram-frame animation. We intentionally keep it stable
  // across column reorders in the global view (no animation requested when moving columns).
  const diagramKey = useMemo(() => {
    return [mode, activeFoyerId].join("::");
  }, [mode, activeFoyerId]);

  const currentSankeyProps = useMemo(
    () => ({
      fit: true,
      scrollY: true,
      minRowHeight: 28,
      stageLabels,
      groupLabels,
      nodes,
      links,
      onNodeClick,
    }),
    [stageLabels, groupLabels, nodes, links]
  );

  const [prevDiagram, setPrevDiagram] = useState<null | { key: string; props: typeof currentSankeyProps }>(null);
  const lastDiagramRef = useMemo(() => ({ current: null as null | { key: string; props: typeof currentSankeyProps } }), []);

  useLayoutEffect(() => {
    const last = lastDiagramRef.current;
    if (last && last.key !== diagramKey) {
      setPrevDiagram(last);
      const t = window.setTimeout(() => setPrevDiagram(null), 820);
      return () => window.clearTimeout(t);
    }
    return;
  }, [diagramKey, lastDiagramRef]);

  useEffect(() => {
    // Update the last snapshot after render.
    lastDiagramRef.current = { key: diagramKey, props: currentSankeyProps };
  }, [diagramKey, currentSankeyProps, lastDiagramRef]);

  return (
    <PageShell
      title={pageTitle}
      headerRight={
        <span>
          Revenus : <b>{formatEUR(totals.totalRev)}</b> · Dépenses : <b>{formatEUR(totals.totalExp)}</b>
        </span>
      }
      className="sankeyPage"
    >
      {showDashboardTabs ? <DashboardTabs /> : null}

      {/*
        Mobile: the bottom bar now hosts the column menu.
        To keep the UI ultra-focused, we hide all controls on mobile and only
        keep the diagram (CSS in app-shell.css).
      */}
      <div className="sankeyControls">
        <div className="muted" style={{ fontSize: 13 }}>
          Flux en <b>temps réel</b> à partir de tes pages <b>Revenus</b> et <b>Dépenses</b>.
          <br />
          Survole un nœud (ou un flux) pour mettre en évidence les connexions.
        </div>

        {/* Posts view: tiny switch to swap the "/objet" column with "/type" */}
        {mode === "posts" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 10 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 800 }}>
            Colonne :
          </span>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 14,
              overflow: "hidden",
              background: "white",
              boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
            }}
          >
            <button
              type="button"
              className="btn"
              disabled={!hasObjectsColumn}
              onClick={() => setPostsPrimaryColState("objects")}
              style={{
                borderRadius: 0,
                padding: "8px 12px",
                fontWeight: 900,
                fontSize: 13,
                opacity: !hasObjectsColumn ? 0.5 : 1,
                background: effectivePostsPrimaryCol === "objects" ? "rgba(0,0,0,0.06)" : "transparent",
              }}
              title={!hasObjectsColumn ? "Aucune dépense n'est structurée par objet" : "Afficher /objet"}
            >
              /objet
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setPostsPrimaryColState("type")}
              style={{
                borderRadius: 0,
                padding: "8px 12px",
                fontWeight: 900,
                fontSize: 13,
                background: effectivePostsPrimaryCol === "type" ? "rgba(0,0,0,0.06)" : "transparent",
              }}
              title="Afficher /type"
            >
              /type
            </button>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            (remplace la colonne)
          </span>
        </div>
        ) : null}

        {showExpenseColumnReorder && !fixedExpenseCols && mode === "global" ? (
        /* Reorder expense columns (only intermediate expense columns; last "détail" stays fixed) */
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 6,
            marginBottom: 10,
          }}
        >
          <span className="muted" style={{ fontSize: 13, fontWeight: 800 }}>
            Colonnes de dépenses :
          </span>

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              padding: 6,
              borderRadius: 14,
              border: "1px dashed rgba(0,0,0,0.18)",
              background: "rgba(0,0,0,0.02)",
            }}
          >
            {expenseCols
              .filter((k) => k !== "objects" || hasObjectsColumn)
              .map((k) => {
                const label = k === "type" ? "Type" : k === "person" ? "Personne" : "Objets";
                return (
                  <div
                    key={k}
                    draggable
                    onDragStart={(e) => {
                      setDraggingCol(k);
                      try {
                        e.dataTransfer.setData("text/plain", k);
                        e.dataTransfer.effectAllowed = "move";
                      } catch {
                        // ignore
                      }
                    }}
                    onDragEnd={() => setDraggingCol(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromKey = (draggingCol ?? e.dataTransfer.getData("text/plain")) as ExpColKey;
                      const from = expenseCols.indexOf(fromKey);
                      if (from === -1) return;
                      moveExpenseCol(from, expenseCols.indexOf(k));
                      setDraggingCol(null);
                    }}
                    title="Glisse pour réordonner"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 12,
                      border: "1px solid rgba(0,0,0,0.12)",
                      background: draggingCol === k ? "rgba(0,0,0,0.06)" : "white",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
                      cursor: "grab",
                      userSelect: "none",
                    }}
                  >
                    <span aria-hidden style={{ fontWeight: 900, opacity: 0.7 }}>
                      ⠿
                    </span>
                    <span style={{ fontWeight: 900 }}>{label}</span>
                  </div>
                );
              })}
          </div>

          {/* Column visibility popover (Vue personnalisée). Totals never move and are never hidden. */}
          <div style={{ position: "relative", marginLeft: "auto" }} ref={colsMenuRef}>
            <button
              type="button"
              onClick={() => {
                setColsMenuPlacement("header");
                setColsMenuOpen((v) => !v);
              }}
              className="btnGhost"
              style={{
                padding: "8px 10px",
                borderRadius: 14,
                fontWeight: 900,
                fontSize: 13,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                whiteSpace: "nowrap",
              }}
              aria-haspopup="menu"
              aria-expanded={colsMenuOpen}
              title="Afficher / masquer des colonnes"
            >
              <span aria-hidden style={{ opacity: 0.8 }}>
                ▦
              </span>
              Colonnes
              <span aria-hidden style={{ opacity: 0.6, marginLeft: 2 }}>
                {colsMenuOpen ? "▴" : "▾"}
              </span>
            </button>

            {colsMenuOpen && colsMenuPlacement === "header" ? (
              <div
                role="menu"
                aria-label="Colonnes"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 10px)",
                  zIndex: 30,
                  width: 300,
                  maxWidth: "min(86vw, 320px)",
                  background: "white",
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRadius: 16,
                  boxShadow: "0 18px 42px rgba(0,0,0,0.14)",
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 950, fontSize: 13 }}>Colonnes visibles</div>
                  <button
                    type="button"
                    className="btnGhost"
                    onClick={() => setColsMenuOpen(false)}
                    aria-label="Fermer"
                    style={{ padding: "6px 10px", borderRadius: 12 }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ height: 10 }} />

                <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7, marginBottom: 6 }}>Dépenses</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {([
                    { k: "type" as const, label: "Type" },
                    { k: "person" as const, label: "Personne" },
                    { k: "objects" as const, label: "Objets" },
                  ] as const)
                    .filter((x) => x.k !== "objects" || hasObjectsColumn)
                    .map((x) => {
                      const checked = !hiddenExpenseCols.includes(x.k);
                      return (
                        <label
                          key={x.k}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "8px 10px",
                            borderRadius: 14,
                            border: "1px solid rgba(0,0,0,0.08)",
                            background: "rgba(0,0,0,0.02)",
                            cursor: "pointer",
                            userSelect: "none",
                          }}
                        >
                          <span style={{ fontWeight: 900 }}>{x.label}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const want = e.target.checked;
                              setHiddenExpenseCols((prev) => {
                                const next = new Set(prev);
                                if (want) next.delete(x.k);
                                else next.add(x.k);
                                return Array.from(next);
                              });
                            }}
                          />
                        </label>
                      );
                    })}

                  {/* Expense detail column (can be hidden in Personnalisée) */}
                  {(() => {
                    const checked = !hiddenExpenseCols.includes("detail");
                    // Guard: we don't allow hiding detail if no intermediate expense column is visible.
                    const anyIntermediateVisible = (["type", "person", "objects"] as const)
                      .filter((k) => k !== "objects" || hasObjectsColumn)
                      .some((k) => !hiddenExpenseCols.includes(k));
                    const disabled = !anyIntermediateVisible;

                    return (
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "8px 10px",
                          borderRadius: 14,
                          border: "1px solid rgba(0,0,0,0.08)",
                          background: "rgba(0,0,0,0.02)",
                          cursor: disabled ? "not-allowed" : "pointer",
                          userSelect: "none",
                          opacity: disabled ? 0.55 : 1,
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 900 }}>Détail</span>
                          <span className="muted" style={{ fontSize: 11 }}>
                            Dernière colonne des dépenses
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={(e) => {
                            const want = e.target.checked;
                            setHiddenExpenseCols((prev) => {
                              const next = new Set(prev);
                              if (want) next.delete("detail");
                              else next.add("detail");
                              return Array.from(next);
                            });
                          }}
                        />
                      </label>
                    );
                  })()}
                </div>

                <div style={{ height: 12 }} />

                <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7, marginBottom: 6 }}>Revenus</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {(() => {
                    const checked = !hiddenRevenueCols.includes("detail");
                    return (
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "8px 10px",
                          borderRadius: 14,
                          border: "1px solid rgba(0,0,0,0.08)",
                          background: "rgba(0,0,0,0.02)",
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        <span style={{ fontWeight: 900 }}>Détail</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const want = e.target.checked;
                            setHiddenRevenueCols((prev) => {
                              const next = new Set(prev);
                              if (want) next.delete("detail");
                              else next.add("detail");
                              return Array.from(next);
                            });
                          }}
                        />
                      </label>
                    );
                  })()}

                  {(() => {
                    // We only offer the "/pers" revenue column when it makes sense.
                    const owners = new Set<string>();
                    for (const l of revenus.lines) {
                      if (!l) continue;
                      const v = Number(l.amount ?? 0);
                      if (!Number.isFinite(v) || v <= 0) continue;
                      owners.add(`${l.ownerKind}:${l.ownerId}`);
                    }
                    const canShow = Boolean(forceRevenueOwnersColumn) || owners.size > 1;
                    const checked = !hiddenRevenueCols.includes("person");
                    return (
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "8px 10px",
                          borderRadius: 14,
                          border: "1px solid rgba(0,0,0,0.08)",
                          background: "rgba(0,0,0,0.02)",
                          cursor: canShow ? "pointer" : "not-allowed",
                          userSelect: "none",
                          opacity: canShow ? 1 : 0.55,
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 900 }}>Par utilisateur</span>
                          <span className="muted" style={{ fontSize: 11 }}>
                            Colonne /pers (si plusieurs)
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canShow}
                          onChange={(e) => {
                            const want = e.target.checked;
                            setHiddenRevenueCols((prev) => {
                              const next = new Set(prev);
                              if (want) next.delete("person");
                              else next.add("person");
                              return Array.from(next);
                            });
                          }}
                        />
                      </label>
                    );
                  })()}
                </div>

                <div style={{ height: 12 }} />

                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <button
                    type="button"
                    className="btnGhost"
                    onClick={() => {
                      setHiddenExpenseCols([]);
                      setHiddenRevenueCols([]);
                    }}
                    style={{ padding: "8px 10px", borderRadius: 14, fontWeight: 900, fontSize: 13 }}
                  >
                    Tout afficher
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setColsMenuOpen(false)}
                    style={{ padding: "8px 12px", borderRadius: 14, fontWeight: 900, fontSize: 13 }}
                  >
                    OK
                  </button>
                </div>
              </div>
            ) : null}

          {colsMenuOpen && colsMenuPlacement === "bottom"
            ? createPortal(
                <>
                  <div
                    onClick={() => setColsMenuOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.35)" }}
                  />
                  <div
                                  role="menu"
                                  aria-label="Colonnes"
                                  style={{
                                    position: "fixed",
                                    left: "50%",
                                    bottom: "calc(var(--bottomnav-h, 72px) + 14px + env(safe-area-inset-bottom))",
                                    transform: "translateX(-50%)",
                                    zIndex: 90,
                                    width: "min(520px, calc(100vw - 24px))",
                                    maxHeight: "min(70vh, 720px)",
                                    overflow: "auto",
                                    background: "white",
                                    border: "1px solid rgba(0,0,0,0.12)",
                                    borderRadius: 18,
                                    boxShadow: "0 18px 42px rgba(0,0,0,0.18)",
                                    padding: 12,
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                    <div style={{ fontWeight: 950, fontSize: 13 }}>Colonnes visibles</div>
                                    <button
                                      type="button"
                                      className="btnGhost"
                                      onClick={() => setColsMenuOpen(false)}
                                      aria-label="Fermer"
                                      style={{ padding: "6px 10px", borderRadius: 12 }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                  
                                  <div style={{ height: 10 }} />
                  
                                  <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7, marginBottom: 6 }}>Dépenses</div>
                                  <div style={{ display: "grid", gap: 6 }}>
                                    {([
                                      { k: "type" as const, label: "Type" },
                                      { k: "person" as const, label: "Personne" },
                                      { k: "objects" as const, label: "Objets" },
                                    ] as const)
                                      .filter((x) => x.k !== "objects" || hasObjectsColumn)
                                      .map((x) => {
                                        const checked = !hiddenExpenseCols.includes(x.k);
                                        return (
                                          <label
                                            key={x.k}
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "space-between",
                                              gap: 10,
                                              padding: "8px 10px",
                                              borderRadius: 14,
                                              border: "1px solid rgba(0,0,0,0.08)",
                                              background: "rgba(0,0,0,0.02)",
                                              cursor: "pointer",
                                              userSelect: "none",
                                            }}
                                          >
                                            <span style={{ fontWeight: 900 }}>{x.label}</span>
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={(e) => {
                                                const want = e.target.checked;
                                                setHiddenExpenseCols((prev) => {
                                                  const next = new Set(prev);
                                                  if (want) next.delete(x.k);
                                                  else next.add(x.k);
                                                  return Array.from(next);
                                                });
                                              }}
                                            />
                                          </label>
                                        );
                                      })}
                  
                                    {/* Expense detail column (can be hidden in Personnalisée) */}
                                    {(() => {
                                      const checked = !hiddenExpenseCols.includes("detail");
                                      // Guard: we don't allow hiding detail if no intermediate expense column is visible.
                                      const anyIntermediateVisible = (["type", "person", "objects"] as const)
                                        .filter((k) => k !== "objects" || hasObjectsColumn)
                                        .some((k) => !hiddenExpenseCols.includes(k));
                                      const disabled = !anyIntermediateVisible;
                  
                                      return (
                                        <label
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 10,
                                            padding: "8px 10px",
                                            borderRadius: 14,
                                            border: "1px solid rgba(0,0,0,0.08)",
                                            background: "rgba(0,0,0,0.02)",
                                            cursor: disabled ? "not-allowed" : "pointer",
                                            userSelect: "none",
                                            opacity: disabled ? 0.55 : 1,
                                          }}
                                        >
                                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                            <span style={{ fontWeight: 900 }}>Détail</span>
                                            <span className="muted" style={{ fontSize: 11 }}>
                                              Dernière colonne des dépenses
                                            </span>
                                          </div>
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={disabled}
                                            onChange={(e) => {
                                              const want = e.target.checked;
                                              setHiddenExpenseCols((prev) => {
                                                const next = new Set(prev);
                                                if (want) next.delete("detail");
                                                else next.add("detail");
                                                return Array.from(next);
                                              });
                                            }}
                                          />
                                        </label>
                                      );
                                    })()}
                                  </div>
                  
                                  <div style={{ height: 12 }} />
                  
                                  <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7, marginBottom: 6 }}>Revenus</div>
                                  <div style={{ display: "grid", gap: 6 }}>
                                    {(() => {
                                      const checked = !hiddenRevenueCols.includes("detail");
                                      return (
                                        <label
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 10,
                                            padding: "8px 10px",
                                            borderRadius: 14,
                                            border: "1px solid rgba(0,0,0,0.08)",
                                            background: "rgba(0,0,0,0.02)",
                                            cursor: "pointer",
                                            userSelect: "none",
                                          }}
                                        >
                                          <span style={{ fontWeight: 900 }}>Détail</span>
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => {
                                              const want = e.target.checked;
                                              setHiddenRevenueCols((prev) => {
                                                const next = new Set(prev);
                                                if (want) next.delete("detail");
                                                else next.add("detail");
                                                return Array.from(next);
                                              });
                                            }}
                                          />
                                        </label>
                                      );
                                    })()}
                  
                                    {(() => {
                                      // We only offer the "/pers" revenue column when it makes sense.
                                      const owners = new Set<string>();
                                      for (const l of revenus.lines) {
                                        if (!l) continue;
                                        const v = Number(l.amount ?? 0);
                                        if (!Number.isFinite(v) || v <= 0) continue;
                                        owners.add(`${l.ownerKind}:${l.ownerId}`);
                                      }
                                      const canShow = Boolean(forceRevenueOwnersColumn) || owners.size > 1;
                                      const checked = !hiddenRevenueCols.includes("person");
                                      return (
                                        <label
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 10,
                                            padding: "8px 10px",
                                            borderRadius: 14,
                                            border: "1px solid rgba(0,0,0,0.08)",
                                            background: "rgba(0,0,0,0.02)",
                                            cursor: canShow ? "pointer" : "not-allowed",
                                            userSelect: "none",
                                            opacity: canShow ? 1 : 0.55,
                                          }}
                                        >
                                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                            <span style={{ fontWeight: 900 }}>Par utilisateur</span>
                                            <span className="muted" style={{ fontSize: 11 }}>
                                              Colonne /pers (si plusieurs)
                                            </span>
                                          </div>
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={!canShow}
                                            onChange={(e) => {
                                              const want = e.target.checked;
                                              setHiddenRevenueCols((prev) => {
                                                const next = new Set(prev);
                                                if (want) next.delete("person");
                                                else next.add("person");
                                                return Array.from(next);
                                              });
                                            }}
                                          />
                                        </label>
                                      );
                                    })()}
                                  </div>
                  
                                  <div style={{ height: 12 }} />
                  
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                    <button
                                      type="button"
                                      className="btnGhost"
                                      onClick={() => {
                                        setHiddenExpenseCols([]);
                                        setHiddenRevenueCols([]);
                                      }}
                                      style={{ padding: "8px 10px", borderRadius: 14, fontWeight: 900, fontSize: 13 }}
                                    >
                                      Tout afficher
                                    </button>
                                    <button
                                      type="button"
                                      className="btn"
                                      onClick={() => setColsMenuOpen(false)}
                                      style={{ padding: "8px 12px", borderRadius: 14, fontWeight: 900, fontSize: 13 }}
                                    >
                                      OK
                                    </button>
                                  </div>
                                </div>
                </>,
                document.body
              )
            : null}
          </div>
        </div>
        ) : null}

        {/* NOTE: the rest of the header controls (menus, toggles, etc.) stays inside this wrapper. */}
      </div>

      <div
        className="diagramFrameClip"
        style={{
          width: "100%",
          height: "calc(100dvh - 260px)",
          minHeight: 520,
          overflow: "hidden",
          borderRadius: 18,
          position: "relative",
        }}
      >
        {prevDiagram ? (
          <div
            key={`prev-${prevDiagram.key}`}
            className={`diagramFrameLayer diagramFrameExit diagramFrameExit-${diagramNavDir}`}
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            <SimpleSankey {...prevDiagram.props} />
          </div>
        ) : null}

        <div
          key={diagramKey}
          className={`diagramFrameLayer diagramFrameEnter diagramFrameEnter-${diagramNavDir}`}
          style={{ position: "absolute", inset: 0 }}
        >
          <SimpleSankey {...currentSankeyProps} />
        </div>
      </div>
      <FloatingPlusButton
        onClick={() => {
          setWizardInitialType(undefined);
          setWizardOpen(true);
        }}
        onSelectType={(t) => {
          setWizardInitialType(t);
          setWizardOpen(true);
        }}
        ariaLabel="Ajouter un flux"
        title="Ajouter un flux"
      />
      <AddFlowWizard open={wizardOpen} onClose={() => setWizardOpen(false)} initialFlowType={wizardInitialType} />

      
      {revenueEdit
        ? createPortal(
            <>
              <div
                onClick={() => setRevenueEdit(null)}
                style={{ position: "fixed", inset: 0, zIndex: 78, background: "rgba(0,0,0,0.35)" }}
              />
              <div
                role="dialog"
                aria-modal="true"
                className="card"
                style={{
                  position: "fixed",
                  zIndex: 88,
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "min(520px, calc(100vw - 24px))",
                  padding: 18,
                  borderRadius: 18,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 950, fontSize: 16, flex: 1 }}>{revenueEdit.label}</div>
                  <button
                    className="btnGhost"
                    onClick={() => setRevenueEdit(null)}
                    aria-label="Fermer"
                    style={{ padding: "6px 10px", borderRadius: 12 }}
                  >
                    ✕
                  </button>
                </div>

                <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                  Ajuste le montant ou supprime ce revenu.
                </div>

                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <div style={{ fontWeight: 800 }}>Montant</div>
                    <div style={{ fontWeight: 900 }}>{formatEUR(revenueEdit.amount)}</div>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={Math.max(5000, Math.ceil(revenueEdit.amount / 50) * 50 + 500)}
                    step={10}
                    value={revenueEdit.amount}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRevenueEdit((s) => (s ? { ...s, amount: v } : s));
                      revenus.update(revenueEdit.id, { amount: v });
                    }}
                    disabled={!revenueEdit.editable}
                    style={{ width: "100%", marginTop: 10 }}
                  />

                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <input
                      type="number"
                      value={revenueEdit.amount}
                      onChange={(e) => {
                        const v = Number(e.target.value || 0);
                        setRevenueEdit((s) => (s ? { ...s, amount: v } : s));
                        revenus.update(revenueEdit.id, { amount: v });
                      }}
                      disabled={!revenueEdit.editable}
                      className="input"
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btnDanger"
                      disabled={!revenueEdit.editable}
                      onClick={() => {
                        revenus.remove(revenueEdit.id);
                        setRevenueEdit(null);
                      }}
                    >
                      Supprimer
                    </button>
                  </div>

                  {!revenueEdit.editable ? (
                    <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                      Ce revenu n’est pas modifiable dans ce mode.
                    </div>
                  ) : null}
                </div>
              </div>
            </>,
            document.body
          )
        : null}


{expenseEdit
        ? createPortal(
            <>
              <div
                onClick={() => setExpenseEdit(null)}
                style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.35)" }}
              />
              <div
                role="dialog"
                aria-modal="true"
                className="card"
                style={{
                  position: "fixed",
                  zIndex: 90,
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "min(520px, calc(100vw - 24px))",
                  padding: 18,
                  borderRadius: 18,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 950, fontSize: 16, flex: 1 }}>{expenseEdit.label}</div>
                  <button
                    className="btnGhost"
                    onClick={() => setExpenseEdit(null)}
                    aria-label="Fermer"
                    style={{ padding: "6px 10px", borderRadius: 12 }}
                  >
                    ✕
                  </button>
                </div>

                <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                  Ajuste le montant avec la jauge (ou saisis une valeur).
                </div>

                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {(() => {
                    const current = Math.max(0, Number(expenseEdit.amount) || 0);
                    const max = Math.max(200, Math.ceil(current * 2), 5000);
                    const commit = (next: number) => {
                      setExpenseEdit((prev) => (prev ? { ...prev, amount: next } : prev));
                      if (!expenseEdit.editable) return;
                      if (expenseEdit.cat === "fixes") depFixes.update(expenseEdit.id, { amount: next });
                      else depVars.update(expenseEdit.id, { amount: next });
                    };
                    return (
                      <>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <input
                            type="range"
                            min={0}
                            max={max}
                            step={1}
                            value={current}
                            onChange={(e) => commit(Number(e.target.value))}
                            style={{ flex: 1 }}
                            disabled={!expenseEdit.editable}
                          />
                          <input
                            type="number"
                            value={current}
                            onChange={(e) => commit(Math.max(0, Number(e.target.value) || 0))}
                            disabled={!expenseEdit.editable}
                            style={{
                              width: 120,
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(0,0,0,0.12)",
                              background: expenseEdit.editable ? "white" : "rgba(0,0,0,0.03)",
                              fontWeight: 800,
                            }}
                          />
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          Max jauge : {max} €
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "space-between", alignItems: "center" }}>
                  <button
                    className="btnGhost"
                    disabled={!expenseEdit.editable}
                    onClick={() => {
                      if (!expenseEdit.editable) return;
                      const next = prompt("Renommer", expenseEdit.label);
                      if (next === null) return;
                      const n = next.trim();
                      if (!n) return;
                      if (expenseEdit.cat === "fixes") depFixes.update(expenseEdit.id, { label: n });
                      else depVars.update(expenseEdit.id, { label: n });
                      setExpenseEdit((prev) => (prev ? { ...prev, label: n } : prev));
                    }}
                  >
                    Renommer
                  </button>

                  <div style={{ flex: 1 }} />

                  <button
                    className="btnDanger"
                    disabled={!expenseEdit.editable}
                    onClick={() => {
                      if (!expenseEdit.editable) return;
                      if (!confirm("Supprimer cette dépense ?")) return;
                      if (expenseEdit.cat === "fixes") depFixes.remove(expenseEdit.id);
                      else depVars.remove(expenseEdit.id);
                      setExpenseEdit(null);
                    }}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            </>,
            document.body
          )
        : null}

      {assetEdit
  ? createPortal(
      <>
        <div
          onClick={() => setAssetEdit(null)}
          style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.25)" }}
        />
        <div
          role="dialog"
          aria-modal="true"
          className="card"
          style={{
            position: "fixed",
            zIndex: 75,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(760px, calc(100vw - 24px))",
            padding: 18,
            borderRadius: 18,
            maxHeight: "min(78dvh, 780px)",
            overflow: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 950, fontSize: 16, flex: 1 }}>
              {assetEdit.deletable ? `Flux financiers de ${assetEdit.assetName}` : assetEdit.assetName}
            </div>
            <button
              className="btnGhost"
              onClick={() => setAssetEdit(null)}
              aria-label="Fermer"
              style={{ padding: "6px 10px", borderRadius: 12 }}
            >
              ✕
            </button>
          </div>

          {!assetEdit.deletable ? (
            <div className="muted" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.35 }}>
              Cet objet est un regroupement visuel (<b>Autres dépenses</b>). Il n&apos;est pas supprimable.
            </div>
          ) : assetEdit.confirmDelete ? (
            <>
              <div className="muted" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.35 }}>
                Confirme la suppression de <b>{assetEdit.assetName}</b>. Les flux suivants seront supprimés :
              </div>

              <div style={{ marginTop: 10, border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, padding: 12 }}>
                {(() => {
                  const SEP = " — ";
                  const matches = (l: any) =>
                    l &&
                    String(l.ownerKind) === String(assetEdit.ownerKind) &&
                    String(l.ownerId) === String(assetEdit.ownerId) &&
                    String(l.label ?? "").startsWith(assetEdit.assetName + SEP);

                  const rows = [
                    ...depFixes.lines.filter(matches).map((l) => ({ cat: "Fixe", label: l.label, amount: l.amount, id: String(l.id) })),
                    ...depVars.lines.filter(matches).map((l) => ({ cat: "Variable", label: l.label, amount: l.amount, id: String(l.id) })),
                  ];

                  if (rows.length === 0) return <div className="muted">Aucun flux trouvé.</div>;

                  return (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {rows.map((r) => (
                        <li key={r.id} style={{ margin: "6px 0" }}>
                          <span className="muted" style={{ fontWeight: 800 }}>{r.cat}</span>{" "}
                          — {String(r.label).split(SEP).slice(1).join(SEP).trim()} : <b>{formatEUR(r.amount)}</b>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
                <button className="btnGhost" onClick={() => setAssetEdit((p) => (p ? { ...p, confirmDelete: false } : p))}>
                  Annuler
                </button>
                <button
                  className="btnDanger"
                  onClick={() => {
                    const SEP = " — ";
                    const matches = (l: any) =>
                      l &&
                      String(l.ownerKind) === String(assetEdit.ownerKind) &&
                      String(l.ownerId) === String(assetEdit.ownerId) &&
                      String(l.label ?? "").startsWith(assetEdit.assetName + SEP);

                    for (const l of depFixes.lines.filter(matches)) depFixes.remove(String(l.id));
                    for (const l of depVars.lines.filter(matches)) depVars.remove(String(l.id));

                    // Remove the asset record (best effort)
                    try {
                      const key = `test.assets.foyer.${activeFoyerId}.v1`;
                      const raw = localStorage.getItem(key);
                      const list = raw ? (JSON.parse(raw) as any[]) : [];
                      const next = list.filter((x) => String(x?.name ?? "") !== String(assetEdit.assetName));
                      localStorage.setItem(key, JSON.stringify(next));
                    } catch {
                      // ignore
                    }

                    setAssetEdit(null);
                  }}
                >
                  Oui, supprimer
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="afwBigTitle" style={{ marginTop: 10 }}>
                {assetEdit.assetType === "car" ? "Voiture" : "Appartement / Bien"}
              </div>

              <div className="afwTable" style={{ marginTop: 10 }}>
                <div className="afwTableHead">
                  <div>Dépense / Revenu</div>
                  <div className="right">Montant</div>
                </div>

                {assetEdit.lines.map((ln) => (
                  <div key={ln.id} className="afwTableRow">
                    <div className="afwCellLeft">
                      <input
                        className="afwMiniInput"
                        value={ln.label}
                        disabled={!!ln.readonly}
                        onChange={(e) =>
                          setAssetEdit((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lines: prev.lines.map((x) => (x.id === ln.id ? { ...x, label: e.target.value } : x)),
                                }
                              : prev
                          )
                        }
                        placeholder={ln.readonly ? "" : "Nom (ex: Ménage)"}
                      />
                      <select
                        className="afwSelect"
                        value={ln.cat}
                        disabled={!!ln.readonly}
                        onChange={(e) =>
                          setAssetEdit((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lines: prev.lines.map((x) => (x.id === ln.id ? { ...x, cat: e.target.value as any } : x)),
                                }
                              : prev
                          )
                        }
                      >
                        <option value="fixes">Fixe</option>
                        <option value="variables">Variable</option>
                      </select>
                    </div>
                    <div className="afwCellRight">
                      <input
                        className="afwMiniInput right"
                        value={ln.amount}
                        onChange={(e) =>
                          setAssetEdit((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lines: prev.lines.map((x) => (x.id === ln.id ? { ...x, amount: e.target.value } : x)),
                                }
                              : prev
                          )
                        }
                        placeholder="0"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="afwHintBlock" style={{ marginTop: 10 }}>
                Laisse un montant vide (ou 0) pour supprimer la ligne.
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "space-between" }}>
                <button
                  className="btnDanger"
                  onClick={() => setAssetEdit((p) => (p ? { ...p, confirmDelete: true } : p))}
                >
                  Supprimer l&apos;objet entier
                </button>

                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btnGhost" onClick={() => setAssetEdit(null)}>
                    Fermer
                  </button>
                  <button
                    className="btnPrimary"
                    onClick={() => {
                      const SEP = " — ";
                      const prefix = assetEdit.assetName + SEP;

                      const parseAmt = (v: string) => {
                        const n = Number(String(v ?? "").replace(",", "."));
                        return Number.isFinite(n) ? n : NaN;
                      };

                      // Map existing ids to their current store category, so we can move if needed
                      const catById = new Map<string, "fixes" | "variables">();
                      for (const l of depFixes.lines) catById.set(String(l.id), "fixes");
                      for (const l of depVars.lines) catById.set(String(l.id), "variables");

                      for (const ln of assetEdit.lines) {
                        const lbl = String(ln.label ?? "").trim();
                        if (!lbl) continue;

                        const amt = parseAmt(ln.amount);
                        const shouldKeep = Number.isFinite(amt) && Math.abs(amt) > 0.0001;

                        const fullLabel = prefix + lbl;

                        // Existing line
                        if (ln.sourceLineId) {
                          const prevCat = catById.get(String(ln.sourceLineId));

                          if (!shouldKeep) {
                            if (prevCat === "fixes") depFixes.remove(String(ln.sourceLineId));
                            else if (prevCat === "variables") depVars.remove(String(ln.sourceLineId));
                            continue;
                          }

                          // Move between categories if needed
                          if (prevCat && prevCat !== ln.cat) {
                            if (prevCat === "fixes") depFixes.remove(String(ln.sourceLineId));
                            else depVars.remove(String(ln.sourceLineId));

                            const targetStore = ln.cat === "fixes" ? depFixes : depVars;
                            if (String(assetEdit.ownerKind) === "foyer") targetStore.add(fullLabel, amt, { kind: "foyer" });
                            else targetStore.add(fullLabel, amt, { kind: "person", ownerId: assetEdit.ownerId });
                            continue;
                          }

                          const targetStore = (prevCat ?? ln.cat) === "fixes" ? depFixes : depVars;
                          targetStore.update(String(ln.sourceLineId), { label: fullLabel, amount: amt });
                          continue;
                        }

                        // New line
                        if (!shouldKeep) continue;
                        const targetStore = ln.cat === "fixes" ? depFixes : depVars;
                        if (String(assetEdit.ownerKind) === "foyer") targetStore.add(fullLabel, amt, { kind: "foyer" });
                        else targetStore.add(fullLabel, amt, { kind: "person", ownerId: assetEdit.ownerId });
                      }

                      setAssetEdit(null);
                    }}
                  >
                    Valider
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </>,
      document.body
    )
  : null}


    </PageShell>
  );
}

