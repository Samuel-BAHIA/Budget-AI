"use client";

/**
 * ============================================================================
 * ONBOARDING WIZARD (single-file implementation) — AI-friendly guide
 * ============================================================================
 *
 * Goal:
 * - Provide a step-by-step onboarding wizard that collects household data.
 * - Keep UI and data model in sync (so charts & DB mapping remain stable).
 *
 * IMPORTANT (no functionality changes):
 * - This file is intentionally verbose and heavily commented to help an AI
 *   navigate and modify it safely.
 *
 * HOW TO READ (high-level):
 *  1) Types & constants  .................. search:  "=== TYPES & CONSTANTS ==="
 *  2) Pure helpers (input -> output) ...... search:  "=== PURE HELPERS ==="
 *  3) Small UI atoms ...................... search:  "=== UI ATOMS ==="
 *  4) Big UI blocks (assets/sections) ..... search:  "=== WIZARD BLOCKS ==="
 *  5) Main page component (state machine) . search:  "=== MAIN WIZARD ==="
 *
 * DATA FLOW (input -> output):
 * - INPUT: user interactions (forms, add/remove rows, step navigation)
 * - STATE: React state (draftPeople, incomes, rentals, owners, cars, etc.)
 * - DERIVED: computed values (visibleSteps, totals, validation flags)
 * - OUTPUT: rendered UI + navigation + (eventually) persisted payload
 *
 * SAFE EDITING RULES (for AI):
 * - If you only need UI layout/styling: prefer editing CSS classes or small
 *   presentational components in "UI ATOMS".
 * - If you need to change which steps appear: edit "visibleSteps" logic in
 *   "MAIN WIZARD" (search: "visibleSteps = useMemo").
 * - If you need DB/chart mapping: keep the keys/ids stable (assetId, ownerId,
 *   section keys). Search "key:" in structures before changing names.
 *
 * QUICK ENTRY POINTS:
 * - Breadcrumb bar (mobile): MobileWizardBreadcrumbPortal
 * - Sidebar steps list: rendering inside wizardLayout (uses visibleSteps)
 * - Assets: rentals / owners / cars: search "ASSET WIZARD"
 *
 * ============================================================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useUsers } from "@/components/user/UserProvider";
import {
  CoupleStatus,
  DailyLife,
  IncomeSource,
  OwnerRow,
  RentalRow,
  uid,
  writeFoyerProfile,
} from "@/components/user/foyerProfileStore";
import { formatEUR } from "@/components/utils/format";
import { readJSON, writeJSON } from "@/components/data/storage";
import {
  keyExpensesFoyer,
  keyExpensesPerson,
  keyRevenusFoyer,
  keyRevenusPerson,
  keyRentalsFoyer,
} from "@/components/data/storageKeys";


// === TYPES & CONSTANTS =====================================================
type Step =
  | "people"
  | "coupleStatus"
  | "incomes"
  | "situation"
  | "rentals"
  | "owner"
  | "owners"
  | "cars"
  | "daily"
  | "summary";


// Rental custom budget keys (used for dynamic user-defined lines in the "Locations" step)
type RentalCustomKey = "customCharges" | "customImpots" | "customAbonnements" | "customAutres";
type RentalBudgetPeriod = "month" | "year";

type DraftPerson = { name: string; birthDate?: string; lastName?: string };

function num(v: string) {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function toMonthly(amount: number, period?: "month" | "year") {
  const a = Number(amount ?? 0);
  if (!a) return 0;
  return period === "year" ? a / 12 : a;
}



// === PURE HELPERS (input -> output) =====================================
/**
 * fmtMoney(value) -> string
 * INPUT : numeric value (can be NaN/undefined-like, caller should sanitize)
 * OUTPUT: formatted euro string "1 234 €"
 * SIDE EFFECTS: none (pure)
 */
function fmtMoney(n: number) {
  return formatEUR(Number(n) || 0);
}

function stepTitle(step: Step) {
  switch (step) {
    case "people":
      return "1/ Membres";
    case "coupleStatus":
      return "2/ Situation du couple";
    case "incomes":
      return "3/ Revenus";
    case "situation":
      return "4/ Logement";
    case "rentals":
      return "5/ Location";
    case "owner":
      return "6/ Propriété";
    case "owners":
      return "7/ Biens";
    case "daily":
      return "8/ Quotidien";
    case "summary":
      return "Résumé";
  }
}

const WIZ_STEPS: Array<{ step: Step; label: string }> = [
  { step: "people", label: "Membres" },
  { step: "coupleStatus", label: "Situation du couple" },
  { step: "incomes", label: "Revenus" },
  { step: "situation", label: "Situation" },
  { step: "rentals", label: "Location" },
    { step: "owners", label: "Biens" },
  { step: "cars", label: "Voiture" },
  { step: "daily", label: "Quotidien" },
  { step: "summary", label: "Résumé" },
];

function stepIndex(step: Step) {
  return Math.max(0, WIZ_STEPS.findIndex((s) => s.step === step));
}


// ---------------- Shared UI blocks (kept OUTSIDE render to preserve input focus) ----------------
type Period = "month" | "year";


// === UI ATOMS (small presentational building blocks) =====================
/**
 * <Section title="...">...</Section>
 * INPUT : title + children
 * OUTPUT: framed section block
 * SIDE EFFECTS: none
 */
function Section(props: { title: string; children: any }) {
  return (
    <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 900 }}>{props.title}</div>
      {props.children}
    </div>
  );
}

function MoneyRow(props: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div className="muted" style={{ fontSize: 12 }}>
        {props.label}
      </div>

      <input
        className="input moneyInputCompact"
        inputMode="decimal"
        maxLength={7}
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        style={{ opacity: props.disabled ? 0.55 : 1 }}
        placeholder="0"
      />

      {props.hint ? (
        <div className="muted" style={{ fontSize: 11 }}>
          {props.hint}
        </div>
      ) : null}
    </div>
  );
}

function CustomList(props: {
  items: Array<{ id: string; name?: string; amount?: any; period?: Period; stage?: "name" | "full" }>;
  defaultPeriod: Period;
  onAdd: (defaultPeriod: Period) => void;
  onUpdate: (id: string, patch: any) => void;
  onRemove: (id: string) => void;
  hideAdd?: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, max-content))",
          gap: 12,
          alignItems: "end",
          justifyContent: "start",
        }}
      >
        {props.items.map((l) => {
          const isNaming = (l as any).stage === "name" || !(l.name && String(l.name).trim().length);

          const validateName = () => {
            const name = String(l.name ?? "").trim();
            if (!name) return;
            // lock the name once validated, and ensure the item uses the section period
            props.onUpdate(l.id, {
              name,
              stage: "full",
              period: props.defaultPeriod,
              ...(l.amount === undefined ? { amount: 0 } : {}),
            });
          };

          return (
            <div key={l.id} style={{ position: "relative", display: "grid", gap: 4 }}>
              {/* "Title" area: normally a fixed label for standard blocks; here it's an input until validated */}
              <div className="muted" style={{ fontSize: 12 }}>
                {isNaming ? (
                  <input
                    className="input"
                    value={l.name ?? ""}
                    maxLength={12}
                    autoFocus
                    onChange={(e) => props.onUpdate(l.id, { name: e.target.value, stage: "name" })}
                    onBlur={validateName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        validateName();
                      }
                    }}
                    placeholder="Nom (ex: Garage)"
                    style={{ padding: "8px 10px" }}
                  />
                ) : (
                  <span style={{ fontWeight: 600 }}>{l.name}</span>
                )}
              </div>

              {/* Value area: same size as standard money blocks; disabled until name validated */}
              <input
                className="input moneyInputCompact"
                inputMode="decimal"
                maxLength={7}
                value={l.amount ?? ""}
                onChange={(e) => props.onUpdate(l.id, { amount: e.target.value })}
                placeholder="0"
                disabled={isNaming}
                style={{ opacity: isNaming ? 0.55 : 1 }}
              />

              {/* Remove (only appears on hover/click is already handled for biens, but here keep always visible) */}
              <button
                className="btnGhost"
                onClick={() => props.onRemove(l.id)}
                aria-label="Supprimer"
                style={{ position: "absolute", top: -2, right: -2 }}
              >
                🗑️
              </button>
            </div>
          );
        })}
      </div>

      {!props.hideAdd ? (
        <button className="btnSecondary miniAddBtn inputLikeBtn" onClick={() => props.onAdd(props.defaultPeriod)}>
          + Ajouter
        </button>
      ) : null}
    </div>
  );
}

function BudgetSection(props: {
  title: string;
  titleSuffix?: string;
  hidden?: boolean; // optional (type-only)

  // Preferred API (used throughout the wizard)
  base?: Array<{ key: string; label: string; hint?: string; disabled?: boolean }>;
  values?: any;
  onValue?: (key: string, val: string) => void;

  // Legacy API (kept for compatibility)
  fields?: Array<{
    key: string;
    label: string;
    value: any;
    onChange: (v: string) => void;
    hint?: string;
    disabled?: boolean;
  }>;

  // Optional add button for fixed fields
  onAdd?: (arg?: any) => void;

  // Custom lines (monthly/annual already implied by section title)
  custom?: {
    // new shape
    lines?: Array<{ id: string; name?: string; amount?: any; stage?: "name" | "full" }>;
    onAdd?: (arg?: any) => void;
    onUpdate?: (id: string, patch: any) => void;
    onRemove?: (id: string) => void;

    // legacy shape
    items?: Array<{ id: string; name?: string; amount?: any; stage?: "name" | "full" }>;
    defaultPeriod?: Period;
    onAddLegacy?: (defaultPeriod: Period) => void;
  };
  hint?: string;
}) {
  const titleSuffix = props.titleSuffix ?? "";
  const gridCols = "repeat(auto-fit, minmax(160px, 1fr))";

  const computedFields =
    props.fields ??
    (props.base ?? []).map((b) => ({
      key: b.key,
      label: b.label,
      value: props.values?.[b.key] ?? "",
      onChange: (v: string) => props.onValue?.(b.key, v),
      hint: b.hint,
      disabled: b.disabled,
    }));

  const customLines = (props.custom?.items ?? props.custom?.lines ?? []) as Array<any>;

  const addCustom = () => {
    if (props.custom?.onAdd) return props.custom.onAdd();
    if (props.custom?.onAddLegacy) return props.custom.onAddLegacy(props.custom.defaultPeriod ?? "month");
  };

  const updateCustom = (id: string, patch: any) => {
    if (props.custom?.onUpdate) return props.custom.onUpdate(id, patch);
  };

  const removeCustom = (id: string) => {
    if (props.custom?.onRemove) return props.custom.onRemove(id);
  };

  const renderCustomItem = (l: any) => {
    const isNaming = l.stage === "name";
    return (
      <div key={l.id} style={{ display: "grid", gridTemplateRows: "18px auto", gap: 6, position: "relative" }}>
        <div style={{ height: 18, display: "flex", alignItems: "center" }}>
          {isNaming ? (
            <input
              className="customNameInput"
              value={l.name ?? ""}
              maxLength={12}
              placeholder="Nom"
              autoFocus
              onChange={(e) => updateCustom(l.id, { name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const name = String(l.name ?? "").trim();
                  if (name) updateCustom(l.id, { name, stage: "full" });
                }
                if (e.key === "Escape") removeCustom(l.id);
              }}
              style={{ width: "100%" }}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{l.name}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="customIconBtn" onClick={() => updateCustom(l.id, { stage: "name" })} aria-label="Renommer" title="Renommer">
                  ✏️
                </button>
                <button className="customIconBtn danger" onClick={() => removeCustom(l.id)} aria-label="Supprimer" title="Supprimer">
                  ×
                </button>
              </div>
            </div>
          )}
        </div>

        <input
          className="moneyInput"
          type="decimal"
          maxLength={7}
          value={l.amount ?? ""}
          onChange={(e) => updateCustom(l.id, { amount: e.target.value })}
          placeholder="0"
          disabled={isNaming}
          style={{ opacity: isNaming ? 0.55 : 1 }}
        />
      </div>
    );
  };

  return (
    <Section title={props.title + (titleSuffix ? " " + titleSuffix : "")}>
      <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 12, alignItems: "end", justifyContent: "start" }}>
        {computedFields.map((f) => (
          <MoneyRow key={f.key} label={f.label} value={f.value} onChange={f.onChange} disabled={f.disabled} hint={f.hint} />
        ))}

        {customLines.map(renderCustomItem)}

        {props.onAdd || addCustom ? (
          <div style={{ display: "grid", gridTemplateRows: "18px auto", gap: 6, alignItems: "end" }}>
            <div style={{ height: 18 }} />
            <button className="btnAddSmall" onClick={() => (props.onAdd ? props.onAdd() : addCustom())}>
              + Ajouter
            </button>
          </div>
        ) : null}
      </div>
    </Section>
  );
}



// === WIZARD BLOCKS (bigger UI chunks) ====================================
/**
 * MobileWizardBreadcrumbPortal
 * Renders the breadcrumb bar OUTSIDE the scroll container (portal to <body>)
 * so it's always visible in mobile.
 *
 * INPUT :
 *  - visibleSteps: ordered list of steps to display
 *  - currentStep : active step
 *  - onGo        : navigation callback
 * OUTPUT: a fixed breadcrumb bar (mobile only via CSS)
 */
function MobileWizardBreadcrumbPortal(props: {
  visibleSteps: Array<{ step: Step; label: string }>;
  currentStep: Step;
  onGo: (s: Step) => void;
  enabled: boolean;
}) {
  if (!props.enabled) return null;

  // Keep the active crumb centered (horizontal scroll) when the step changes.
  const innerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const btn = activeRef.current;
    if (!btn) return;
    // Center the active step in the scroll area.
    btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [props.currentStep]);

  const bar = (
    <div className="wizardCrumbBar" role="navigation" aria-label="Étapes">
      <div className="wizardCrumbPanel">
        <div ref={innerRef} className="wizardCrumbInner" aria-label="Fil d’étapes">
          {/*
            NOTE: Navigation arrows are now displayed on the wizard page itself
            (left/right of the content). The breadcrumb bar stays focused on
            the "carousel" effect only.
          */}
          {(() => {
            const currentIdx = Math.max(0, props.visibleSteps.findIndex((s) => s.step === props.currentStep));
            return props.visibleSteps.map((s, idx) => {
              const isActive = s.step === props.currentStep;
              const dist = idx - currentIdx;
              const distClass = `dist${Math.min(3, Math.abs(dist))}`;
              return (
                <button
                  key={s.step}
                  ref={isActive ? (el) => {
                    activeRef.current = el;
                  } : undefined}
                  className={"wizardCrumbItem " + distClass + (isActive ? " active" : "")}
                  onClick={() => props.onGo(s.step)}
                  type="button"
                >
                  <span className="wizardCrumbNum">{idx + 1}</span>
                  <span className="wizardCrumbTxt">{s.label}</span>
                  <span className="wizardCrumbSep">›</span>
                </button>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );

  return createPortal(bar, document.body);
}


// === MAIN WIZARD (state + handlers + rendering) ==========================
/**
 * Onboarding Page (Wizard)
 * INPUT : none (reads hooks / local UI state)
 * OUTPUT: wizard layout + step content
 *
 * State machine:
 * - step: current step key
 * - visibleSteps: derived list of steps (based on "Situation" checkboxes)
 *
 * NOTE FOR AI:
 * - Prefer adding new derived values with useMemo
 * - Prefer keeping state updates localized in small handlers
 */
export default function OnboardingWizard() {
  const router = useRouter();
  const { createFoyerWithPeople, foyers, setActiveFoyer } = useUsers();

  const foyerDraftLabel = useMemo(() => `Foyer ${Math.max(1, (foyers?.length ?? 0) + 1)}` , [foyers]);

  const [step, setStep] = useState<Step>("people");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const prevStepRef = useRef<Step>("people");
  const [stepAnimDir, setStepAnimDir] = useState<"next" | "prev">("next");

  const [householdType, setHouseholdType] = useState<"single" | "couple" | undefined>(undefined);
  const [coupleStatus, setCoupleStatus] = useState<CoupleStatus | undefined>(undefined);
  const [draftPeople, setDraftPeople] = useState<DraftPerson[]>([{ name: "" }]);
  // People details are always visible (no toggle) to keep a stable layout on web.

  // Progress helpers (used to gray out skipped / not-yet-passed steps in the summary).
  const [completedSteps, setCompletedSteps] = useState<Step[]>([]);
  const [skippedSteps, setSkippedSteps] = useState<Step[]>([]);

  const markCompleted = (s: Step) =>
    setCompletedSteps((prev) => (prev.includes(s) ? prev : [...prev, s]));
  const markSkipped = (s: Step) =>
    setSkippedSteps((prev) => (prev.includes(s) ? prev : [...prev, s]));


  // Slide transitions between steps (right when advancing, left when going back)
  useEffect(() => {
    const prev = prevStepRef.current;
    if (prev !== step) {
      const order: Step[] = ["people","coupleStatus","incomes","situation","rentals","owners","cars","daily","summary"];
      const prevIdx = order.indexOf(prev);
      const nextIdx = order.indexOf(step);
      setStepAnimDir(nextIdx >= prevIdx ? "next" : "prev");
      prevStepRef.current = step;
    }
  }, [step]);


  // Household type is derived from the number of people (foyer = max 2 people).
  useEffect(() => {
    const next = draftPeople.length >= 2 ? "couple" : "single";
    setHouseholdType(next);
    if (next === "single") {
      setCoupleStatus(undefined);
      markSkipped("coupleStatus");
    }
  }, [draftPeople.length]);

  const [foyerId, setFoyerId] = useState<string | null>(null);
  const activePeople = useMemo(() => {
    if (!foyerId) return [];
    return foyers.find((f) => f.id === foyerId)?.people ?? [];
  }, [foyerId, foyers]);

  const [incomes, setIncomes] = useState<IncomeSource[]>([]);
  const [isTenant, setIsTenant] = useState<boolean | undefined>(undefined);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [rentalModalStep, setRentalModalStep] = useState<0 | 1 | 2>(0);
  const [rentalEditingId, setRentalEditingId] = useState<string | null>(null);
  const [rentalDraft, setRentalDraft] = useState<Partial<RentalRow>>({ kind: "appartement", loyer: 0, charges: 0, eau: 0, elec: 0, gaz: 0, internet: 0, assurance: 0 });
  const [isOwner, setIsOwner] = useState<boolean | undefined>(undefined);
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [ownerModalStep, setOwnerModalStep] = useState<0 | 1 | 2>(0);
  const [ownerEditingId, setOwnerEditingId] = useState<string | null>(null);
  const [ownerDraft, setOwnerDraft] = useState<Partial<OwnerRow>>({ kind: "appartement", usage: "primary", ownerOccupant: true, loyerPercu: 0 });

  // Cars (wizard)
  type BudgetLine = {
    id: string;
    label: string;
    amount: number;
  };

  type CarRow = {
    id: string;
    label: string; // ex: "Clio 5"
    ownerKey: string; // personId or "both"
    assurance: number;
    carburant: number;
    entretien: number;
    credit: number;
    parking: number;
    peage: number;
    customMonthly: BudgetLine[];
  };

  const [hasCar, setHasCar] = useState<boolean | undefined>(undefined);
  const [cars, setCars] = useState<CarRow[]>([]);
  const [activeCarId, setActiveCarId] = useState<string | null>(null);
  const [carModalStep, setCarModalStep] = useState<0 | 1 | 2>(0);
  const [carEditingId, setCarEditingId] = useState<string | null>(null);
  const [carDraft, setCarDraft] = useState<Partial<CarRow>>({
    label: "",
    ownerKey: "both",
    assurance: 0,
    carburant: 0,
    entretien: 0,
    credit: 0,
    parking: 0,
    peage: 0,
    customMonthly: [],
  });


  const [daily, setDaily] = useState<DailyLife>({});

  // Ensure a default income line exists for each person when entering the income step.
  useEffect(() => {
    if (step !== "incomes") return;
    if (!foyerId) return;
    if (!activePeople.length) return;
    if (incomes.length) return;
    setIncomes(activePeople.map((p) => ({ id: uid("inc"), personId: p.id, label: "Salaire", amount: 0 })));
  }, [step, foyerId, activePeople, incomes.length]);

  const totalsByPerson = useMemo(() => {
    const by: Record<string, number> = {};
    for (const p of activePeople) by[p.id] = 0;
    for (const inc of incomes) by[inc.personId] = (by[inc.personId] ?? 0) + (inc.amount ?? 0);
    return by;
  }, [activePeople, incomes]);

  const totalGlobal = useMemo(() => Object.values(totalsByPerson).reduce((a, b) => a + b, 0), [totalsByPerson]);

  const persistProfile = (extra?: Partial<Parameters<typeof writeFoyerProfile>[0]>) => {
    if (!foyerId) return;
    writeFoyerProfile({
      foyerId,
      householdType,
      coupleStatus,
      incomes,
      isTenant,
      rentals,
      isOwner,
      owners,
      daily,
      ...(extra ?? {}),
    });
  };

  // Persist wizard data into the stores used by the Sankey / dashboards.
  const persistBudgetStores = () => {
    if (!foyerId) return;
    // Revenus per person
    for (const p of activePeople) {
      const lines = (incomes
        .filter((x) => x.personId === p.id)
        .filter((x) => String(x.label ?? "").trim().length > 0 && (x.amount ?? 0) !== 0)
        .map((x) => ({ id: x.id, label: x.label, amount: x.amount }))
      ) as Array<{ id: string; label: string; amount: number }>;
      writeJSON(keyRevenusPerson(p.id), lines);
    }

    // Foyer-level revenus (ex: loyers perçus en commun)
    const foyerRevenus: Array<{ id: string; label: string; amount: number }> = [];

    // Rentals: stored as a list of rentals with their expense lines.
    const rentalsStored = (rentals ?? []).map((r, idx) => {
      const name = `${r.kind === "maison" ? "Maison" : "Appart"}${r.superficie ? ` ${r.superficie}m²` : ""}${r.ville ? ` • ${r.ville}` : ""}`.trim();
      const exp = ([
        { k: "loyer", label: "Loyer", amount: r.loyer },
        { k: "eau", label: "Eau", amount: r.eau },
        { k: "elec", label: "Électricité", amount: r.elec },
        { k: "gaz", label: "Gaz", amount: r.gaz },
        { k: "internet", label: "Internet", amount: r.internet },
        { k: "assurance", label: "Assurance habitation", amount: r.assurance },
      ] as const)
        .filter((x) => (x.amount ?? 0) !== 0)
        .map((x) => ({ id: `std:rental:${x.k}`, label: x.label, amount: Number(x.amount ?? 0), locked: true }));
      return {
        id: r.id || `r-${idx}`,
        name: name || `Location ${idx + 1}`,
        expenses: exp,
      };
    });
    writeJSON(keyRentalsFoyer(foyerId), rentalsStored);

    // IMPORTANT: Sankey "objects" are detected by the label format "<objectName> — <lineLabel>".
    // The onboarding wizard therefore also materializes rental expenses into the main expense buckets
    // using that prefix so rentals show up as objects (same behavior as the floating wizard button).
    const SEP = " — ";

    // Expenses buckets
    // - foyer => commun
    // - person => private (attribué à une personne)
    const fixes: Array<{ id: string; label: string; amount: number }> = [];
    const variables: Array<{ id: string; label: string; amount: number }> = [];

    const personFixes: Record<string, Array<{ id: string; label: string; amount: number }>> = {};
    const personVariables: Record<string, Array<{ id: string; label: string; amount: number }>> = {};
    for (const p of activePeople) {
      personFixes[p.id] = [];
      personVariables[p.id] = [];
    }

    const pushExpense = (target: "commun" | string, category: "fixes" | "variables", line: { id: string; label: string; amount: number }) => {
      if (target !== "commun" && activePeople.some((p) => p.id === target)) {
        if (category === "fixes") personFixes[target].push(line);
        else personVariables[target].push(line);
        return;
      }
      if (category === "fixes") fixes.push(line);
      else variables.push(line);
    };

    // Rentals => expenses (commun ou attribuées à une personne selon "Titulaire")
    for (let i = 0; i < (rentalsStored ?? []).length; i++) {
      const rr = rentalsStored[i];
      const base = rr.name;

      const src = (rentals ?? []).find((x) => String(x.id || "") === String(rr.id)) ?? (rentals ?? [])[i];
      const target = (src as any)?.occupant ?? "commun";

      const pushFix = (k: string, label: string, amount?: number) => {
        const a = Number(amount ?? 0);
        if (!a) return;
        pushExpense(target, "fixes", { id: `wiz:rental:${rr.id}:${k}`, label: `${base}${SEP}${label}`, amount: a });
      };
      const pushVar = (k: string, label: string, amount?: number) => {
        const a = Number(amount ?? 0);
        if (!a) return;
        pushExpense(target, "variables", { id: `wiz:rental:${rr.id}:${k}`, label: `${base}${SEP}${label}`, amount: a });
      };

      if (!src) continue;
      pushFix("loyer", "Loyer", (src as any).loyer);
      pushVar("eau", "Eau", (src as any).eau);
      pushVar("elec", "Électricité", (src as any).elec);
      pushVar("gaz", "Gaz", (src as any).gaz);
      pushFix("internet", "Internet", (src as any).internet);
      pushFix("assurance", "Assurance habitation", (src as any).assurance);
    }

    // Daily life => variables
    const dailyMap: Array<[keyof DailyLife, string]> = [
      ["courses", "Courses"],
      ["transport", "Transport"],
      ["loisirs", "Loisirs"],
      ["sante", "Santé"],
      ["autres", "Autres"],
    ];
    for (const [k, label] of dailyMap) {
      const amount = Number((daily as any)?.[k] ?? 0);
      if (amount) variables.push({ id: `wiz:daily:${k}`, label, amount });
    }

    // Owners => expenses + potential revenus
    for (let i = 0; i < (owners ?? []).length; i++) {
      const o = owners[i];
      const base = `Bien ${i + 1}${o.ville ? ` • ${o.ville}` : ""}`;

      const target = (o as any)?.occupant ?? "commun";

      const pushFix = (k: string, label: string, amount?: number) => {
        const a = Number(amount ?? 0);
        // Prefix so it becomes an "object" in the Sankey view
        if (!a) return;
        pushExpense(target, "fixes", { id: `wiz:own:${o.id}:${k}`, label: `${base}${SEP}${label}`, amount: a });
      };
      const pushVar = (k: string, label: string, amount?: number) => {
        const a = Number(amount ?? 0);
        // Prefix so it becomes an "object" in the Sankey view
        if (!a) return;
        pushExpense(target, "variables", { id: `wiz:own:${o.id}:${k}`, label: `${base}${SEP}${label}`, amount: a });
      };

      pushFix("taxeFonciere", "Taxe foncière", toMonthly(o.taxeFonciere ?? 0, "year"));
      pushFix("impotRevenu", "Impôt revenu", toMonthly(o.impotRevenu ?? 0, "year"));
      pushFix("chargesCopro", "Charges copro", (o.chargesCopro ?? o.charges));
      pushFix("internet", "Internet", o.internet);
      pushFix("assurance", "Assurance", o.assurance);

      pushVar("eau", "Eau", o.eau);
      pushVar("elec", "Électricité", o.elec);
      pushVar("gaz", "Gaz", o.gaz);

      // Custom lines (optional)
      const pushCustom = (arr: any[] | undefined, prefix: string, labelPrefix: string, cat: "fixes" | "variables") => {
        for (const line of arr ?? []) {
          const amount = toMonthly(Number(line?.amount ?? 0), (line?.period as any) ?? "month");
          if (!amount) continue;
          const id = `wiz:own:${o.id}:${prefix}:${line.id ?? "x"}`;
          const label = `${base}${SEP}${labelPrefix}${SEP}${String(line?.name ?? "").trim() || "Autre"}`;
          if (cat === "fixes") pushExpense(target, "fixes", { id, label, amount });
          else pushExpense(target, "variables", { id, label, amount });
        }
      };

      pushCustom((o as any).customCharges, "c", "Charges", "fixes");
      pushCustom((o as any).customImpots, "i", "Impôts", "fixes");
      pushCustom((o as any).customAbonnements, "a", "Abonnements", "fixes");
      pushCustom((o as any).customAutres, "o", "Autres", "variables");

      const loyerPercu = Number(o.loyerPercu ?? 0);
      if (loyerPercu && !o.ownerOccupant) {
        // Prefix so it becomes an "object" in the Sankey view
        const revLine = { id: `wiz:own:${o.id}:loyerPercu`, label: `${base}${SEP}Loyer perçu`, amount: loyerPercu };
        if (o.occupant && o.occupant !== "commun" && activePeople.some((p) => p.id === o.occupant)) {
          // attach to person
          const pid = o.occupant;
          const current = (incomes
            .filter((x) => x.personId === pid)
            .map((x) => ({ id: x.id, label: x.label, amount: x.amount }))
          ) as Array<{ id: string; label: string; amount: number }>;
          writeJSON(keyRevenusPerson(pid), [...current, revLine]);
        } else {
          foyerRevenus.push(revLine);
        }
      }
    }

    // Persist an asset registry so the Sankey can reliably infer the type (rental/property) on click.
    // (It falls back to heuristics otherwise.)
    try {
      const key = `test.assets.foyer.${foyerId}.v1`;
      const existing = readJSON<any[]>(key, []);
      const next: any[] = Array.isArray(existing) ? [...existing] : [];
      const upsert = (name: string, type: "rental" | "property") => {
        if (!name) return;
        const i = next.findIndex((x) => String(x?.name ?? "") === String(name));
        const entry = { name, type };
        if (i >= 0) next[i] = entry;
        else next.push(entry);
      };

      for (const r of rentalsStored ?? []) upsert(r.name, "rental");
      for (let i = 0; i < (owners ?? []).length; i++) {
        const o = owners[i];
        const base = `Bien ${i + 1}${o.ville ? ` • ${o.ville}` : ""}`;
        upsert(base, "property");
      }

      writeJSON(key, next);
    } catch {
      // ignore
    }

    writeJSON(keyRevenusFoyer(foyerId), foyerRevenus);
    writeJSON(keyExpensesFoyer(foyerId), { variables, fixes });

    // Persist person buckets (private expenses)
    for (const p of activePeople) {
      writeJSON(keyExpensesPerson(p.id), {
        variables: personVariables[p.id] ?? [],
        fixes: personFixes[p.id] ?? [],
      });
    }
  };

  const canContinuePeople = useMemo(() => {
    const needed = Math.min(2, draftPeople.length || 1);
    const trimmed = draftPeople.slice(0, needed).map((p) => (p.name ?? "").trim());
    // Prénom/alias must be at least 3 characters.
    return trimmed.every((n) => n.length >= 3);
  }, [draftPeople]);
  
  const visibleSteps = useMemo(() => {
    // Only show relevant steps in the sidebar, based on the "Situation" choices.
    // Before choosing, we show steps up to Situation + the final steps.
    const showRentals = isTenant === true;
    const showOwners = isOwner === true;
    const showCars = hasCar === true;

    return WIZ_STEPS.filter((s) => {
      if (s.step === "rentals") return showRentals;
      if (s.step === "owners") return showOwners;
      if (s.step === "cars") return showCars;
      // Keep everything else always visible (people, coupleStatus, incomes, situation, daily, summary)
      return true;
    });
  }, [isTenant, isOwner, hasCar]);

  // Swipe navigation (mobile): allow sliding between wizard steps.
  const currentVisibleIdx = useMemo(
    () => Math.max(0, visibleSteps.findIndex((s) => s.step === step)),
    [visibleSteps, step]
  );
  const prevVisibleStep = currentVisibleIdx > 0 ? visibleSteps[currentVisibleIdx - 1]?.step : undefined;
  const nextVisibleStep = currentVisibleIdx < visibleSteps.length - 1 ? visibleSteps[currentVisibleIdx + 1]?.step : undefined;

  const swipeRef = useRef<{ x: number; y: number; active: boolean; blocked: boolean }>({
    x: 0,
    y: 0,
    active: false,
    blocked: false,
  });

  const onWizardTouchStart = (e: any) => {
    if (!e?.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    const target = e.target as HTMLElement | null;
    const blocked = !!target?.closest?.("input, textarea, select") || !!target?.closest?.("[data-disable-swipe]");
    swipeRef.current = { x: t.clientX, y: t.clientY, active: true, blocked };
  };

  const onWizardTouchEnd = (e: any) => {
    if (!swipeRef.current.active) return;
    const { x, y, blocked } = swipeRef.current;
    swipeRef.current.active = false;
    if (blocked || !e?.changedTouches || e.changedTouches.length !== 1) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - x;
    const dy = t.clientY - y;

    // Horizontal swipe threshold.
    if (Math.abs(dx) < 80 || Math.abs(dy) > 70) return;
    // Swipe navigation uses the same handlers as the arrow buttons so we keep
    // the exact same side effects (markCompleted/persist) as the old buttons.
    if (dx < 0) goNext();
    if (dx > 0) goPrev();
  };

  // ---------------------------------------------------------------------
  // Navigation helpers (arrows + swipe)
  // Goal: remove the old "Suivant/Retour" buttons while preserving behavior.
  // ---------------------------------------------------------------------
  const canGoNext = useMemo(() => {
    if (step === "people") return canContinuePeople;
    if (step === "coupleStatus" && householdType === "couple") return !!coupleStatus;
    return true;
  }, [step, canContinuePeople, householdType, coupleStatus]);

  const goPrev = () => {
    if (step === "people") {
      router.push("/");
      return;
    }
    if (prevVisibleStep) setStep(prevVisibleStep);
  };

  const goNext = () => {
    if (!canGoNext) return;

    // Special case: first step creates the foyer and establishes the household type.
    if (step === "people") {
      markCompleted("people");

      const needed = Math.min(2, draftPeople.length || 1);
      const type = needed === 2 ? "couple" : "single";
      setHouseholdType(type);

      if (type === "single") {
        markSkipped("coupleStatus");
        setCoupleStatus(undefined);
      }

      const foyer = createFoyerWithPeople(draftPeople.slice(0, needed));
      setActiveFoyer(foyer);
      setFoyerId(foyer);
      writeFoyerProfile({ foyerId: foyer, householdType: type, coupleStatus });

      setStep(type === "couple" ? "coupleStatus" : "incomes");
      return;
    }

    // Default: mark completed + persist, then move to next visible step.
    // (Some steps also auto-advance via selection buttons, which still works.)
    markCompleted(step);
    persistProfile();
    if (nextVisibleStep) setStep(nextVisibleStep);
  };

return (
    <>
      {mounted && (
        <MobileWizardBreadcrumbPortal visibleSteps={visibleSteps} currentStep={step} onGo={(s) => setStep(s)} enabled={true} />
      )}
      <div className="wizardWrap">
      <div className="wizardLayout">
      <div className="card" style={{ padding: 14 }}>
        <div className="wizardSidebarTitle">Création d'un foyer</div>
        <div className="wizardSteps">
          {visibleSteps.map((s, idx) => {
            const current = s.step === step;
            const done = completedSteps.includes(s.step);
            const skipped = skippedSteps.includes(s.step);
            const muted = !current && !done;
            return (
              <div
                key={s.step}
                className={`wizardStep ${current ? "wizardStepActive" : ""} ${done ? "wizardStepDone" : ""} ${muted ? "wizardStepMuted" : ""} ${skipped ? "wizardStepSkipped" : ""}`}
              >
                <span className="muted" style={{ width: 18, textAlign: "right" }}>{idx + 1}</span>
                <span className="chev">›</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card wizardContentCard">
        <button
          type="button"
          className="wizardSideArrow"
          onClick={goPrev}
          disabled={!prevVisibleStep && step !== "people"}
          aria-label="Étape précédente"
        >
          ‹
        </button>

        <div
          className="wizardViewport"
          onTouchStart={onWizardTouchStart}
          onTouchEnd={onWizardTouchEnd}
        >
          <div
            key={step}
            className={`wizardStepAnim ${stepAnimDir === "next" ? "animNext" : "animPrev"}`}
          >


      {step === "coupleStatus" ? (
        <div className="wizardPanel" style={{ display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>
            {draftPeople?.[0]?.name?.trim() || "Personne 1"} et {draftPeople?.[1]?.name?.trim() || "Personne 2"} êtes :
      </div>

          <div style={{ display: "grid", gap: 12 }}>
            {([
              { v: "pacs" as const, label: "Pacsés" },
              { v: "marie" as const, label: "Mariés" },
              { v: "concubinage" as const, label: "En concubinage" },
            ] as const).map((o) => (
              <button
                key={o.v}
                className={coupleStatus === o.v ? "btnPrimary" : "btnSecondary"}
                onClick={() => {
                  setCoupleStatus(o.v);
                  markCompleted("coupleStatus");
                  persistProfile();
                  setStep("incomes");
                }}
                style={{ justifyContent: "space-between" }}
              >
                <span>{o.label}</span>
                <span aria-hidden className="muted" style={{ fontSize: 18, lineHeight: 1 }}>
                  ›
                </span>
              </button>
            ))}
          </div>

          <div className="wizardNav" style={{ marginTop: 6 }}>
            <button
              className="btnSecondary"
              style={{ width: 140 }}
              onClick={() => {
                setStep("people");
              }}
            >
              {"< Retour"}
            </button>
            <div />
          </div>
        </div>
      ) : null}

      {step === "people" ? (
        <div className="wizardPanel" style={{ display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>
            1/ Membres du "{foyerDraftLabel}" :
          </div>

          {draftPeople.slice(0, 2).map((p, i) => {
            const nameTrimmed = (p?.name ?? "").trim();
            const isInvalidName = nameTrimmed.length > 0 && nameTrimmed.length < 3;
            const isEmptyName = nameTrimmed.length === 0;
            const canRemovePerson = draftPeople.length >= 2;
            return (
              <div key={i} className="wizardMemberCard">
                <button
                    type="button"
                    className="btnGhost wizardMemberTrash"
                    title={canRemovePerson ? "Supprimer" : "Impossible de supprimer le dernier utilisateur"}
                    aria-label={canRemovePerson ? `Supprimer l'utilisateur ${i + 1}` : "Suppression désactivée"}
                    disabled={!canRemovePerson}
                    style={!canRemovePerson ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
                    onClick={() => {
                      if (!canRemovePerson) return;
                      setDraftPeople((prev) => {
                        if (prev.length < 2) return prev;
                        // Remove the selected person while always keeping at least 1.
                        if (i === 0) return prev.slice(1, 2);
                        return prev.slice(0, 1);
                      });
                    }}
                  >
                    🗑️
                  </button>

                <div className="wizardMemberGrid">
                  <label className="min0" style={{ display: "grid", gap: 4 }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Prénom / alias <b>(obligatoire)</b>
                    </span>
                    <div className="wizardFieldWrap">
                      <input
                        className={`input ${(isEmptyName || isInvalidName) ? "inputInvalid" : ""}`}
                        value={p?.name ?? ""}
                        maxLength={12}
                        onChange={(e) =>
                          setDraftPeople((prev) => {
                            const next = [...prev];
                            next[i] = { ...(next[i] ?? { name: "" }), name: e.target.value };
                            return next;
                          })
                        }
                        placeholder={i === 0 ? "Ex: Sam" : "Ex: Julie"}
                      />
                      {isInvalidName ? (
                        <div className="wizardPopup" role="status" aria-live="polite">
                          Minimum 3 caractères.
                        </div>
                      ) : null}
                    </div>
                  </label>

                  <label className="min0" style={{ display: "grid", gap: 4 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Nom de famille (facultatif)</span>
                    <input
                      className="input"
                      value={draftPeople[i]?.lastName ?? ""}
                      maxLength={12}
                      onChange={(e) =>
                        setDraftPeople((prev) => {
                          const next = [...prev];
                          next[i] = { ...(next[i] ?? { name: "" }), lastName: e.target.value };
                          return next;
                        })
                      }
                      placeholder="Ex: Dupont"
                    />
                  </label>

                  <label className="min0" style={{ display: "grid", gap: 4 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Date de naissance (facultatif)</span>
                    <input
                      className="input"
                      type="date"
                      value={draftPeople[i]?.birthDate ?? ""}
                      onChange={(e) =>
                        setDraftPeople((prev) => {
                          const next = [...prev];
                          next[i] = { ...(next[i] ?? { name: "" }), birthDate: e.target.value };
                          return next;
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            );
          })}

          {draftPeople.length < 2 ? (
            <button
              type="button"
              className="btnAdd btnAddFull"
              onClick={() => setDraftPeople((prev) => (prev.length >= 2 ? prev : [...prev, { name: "" }]))}
            >
              + Ajouter une autre personne
            </button>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              Un foyer peut contenir au maximum 2 personnes.
            </div>
          )}

          {canContinuePeople ? (
            <div className="wizardHint isOk">
              Prenom(s) valide(s) - bouton Suivant active. <span className="muted">Nom et date de naissance sont facultatifs.</span>
            </div>
          ) : (
            <div className="wizardHint isBad">
              Prenom/alias obligatoire (min 3 caracteres) pour continuer. <span className="muted">Les autres champs sont facultatifs.</span>
            </div>
          )}

          <div className="wizardNav">
            <button
              className="btnSecondary"
              style={{ width: 140 }}
              onClick={() => router.push("/" )}
            >
              Annuler
            </button>
            <button
              className="btnPrimary"
              style={{ width: 140 }}
              disabled={!canContinuePeople}
              onClick={() => {
                markCompleted("people");

                const needed = Math.min(2, draftPeople.length || 1);
                const type = needed === 2 ? "couple" : "single";
                setHouseholdType(type);

                if (type === "single") {
                  markSkipped("coupleStatus");
                  setCoupleStatus(undefined);
                }

                const foyer = createFoyerWithPeople(draftPeople.slice(0, needed));
                setActiveFoyer(foyer);
                setFoyerId(foyer);
                writeFoyerProfile({ foyerId: foyer, householdType: type, coupleStatus });

                setStep(type === "couple" ? "coupleStatus" : "incomes");
              }}
            >
              Suivant ›
            </button>
          </div>
        </div>
      ) : null}

      {step === "incomes" ? (
        <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
          {activePeople.map((p) => (
            <div key={p.id} style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 900 }}>{p.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Total: <b>{formatEUR(totalsByPerson[p.id] ?? 0)}</b>
                </div>
              </div>

              {(incomes.filter((x) => x.personId === p.id) ?? []).map((inc) => (
                <div key={inc.id} className="incomeRow">
                  <input
                    className="input"
                    value={inc.label}
                    onChange={(e) =>
                      setIncomes((prev) => prev.map((x) => (x.id === inc.id ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="Source de revenu"
                  />
                  <input
                    className="input"
                    inputMode="decimal"
                    value={String(inc.amount ?? 0)}
                    onChange={(e) =>
                      setIncomes((prev) => prev.map((x) => (x.id === inc.id ? { ...x, amount: num(e.target.value) } : x)))
                    }
                    placeholder="0"
                  />
                  <button className="btnGhost" onClick={() => setIncomes((prev) => prev.filter((x) => x.id !== inc.id))}>
                    ✕
                  </button>
                </div>
              ))}

              <button
                className="btnSecondary"
                onClick={() =>
                  setIncomes((prev) => [
                    ...prev,
                    { id: uid("inc"), personId: p.id, label: "Salaire", amount: 0 },
                  ])
                }
              >
                + Ajouter une source
              </button>
            </div>
          ))}

          <div className="card" style={{ padding: 12, background: "rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Total global</span>
              <b>{formatEUR(totalGlobal)}</b>
            </div>
          </div>

          <div className="wizardNav">
            <button className="btnSecondary" style={{ width: 140 }} onClick={() => setStep("people")}>{"< Retour"}</button>
            <button
              className="btnPrimary"
              style={{ width: 140 }}
              onClick={() => {
                markCompleted("incomes");
                persistProfile();
                setStep("situation");
              }}
            >
              Suivant ›
            </button>
          </div>
        </div>
      ) : null}

      {step === "situation" ? (
        <div className="wizardPanel" style={{ display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>Situation</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Au moins l&apos;un d&apos;entre vous :
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <label className="checkRow">
              <input
                type="checkbox"
                checked={isTenant === true}
                onChange={(e) => setIsTenant(e.target.checked)}
              />
              <span>Est locataire</span>
            </label>

            <label className="checkRow">
              <input
                type="checkbox"
                checked={isOwner === true}
                onChange={(e) => setIsOwner(e.target.checked)}
              />
              <span>Est propriétaire</span>
            </label>

            <label className="checkRow">
              <input
                type="checkbox"
                checked={hasCar === true}
                onChange={(e) => setHasCar(e.target.checked)}
              />
              <span>Possède une voiture</span>
            </label>
          </div>

          <div className="wizardNav">
            <button className="btnSecondary" onClick={() => setStep("incomes")}>
              &lt; Retour
            </button>
            <button
              className="btnPrimary"
              onClick={() => {
                // Mark completion for the menu itself
                markCompleted("situation");

                // Skip downstream steps depending on choices
                if (!isTenant) markSkipped("rentals");
                if (!isOwner) markSkipped("owners");
                if (!hasCar) markSkipped("cars");

                if (isTenant) return setStep("rentals");
                if (isOwner) return setStep("owners");
                if (hasCar) return setStep("cars");
                return setStep("daily");
              }}
            >
              Continuer ›
            </button>
          </div>
        </div>
      ) : step === "rentals" ? (
        <div style={{ padding: 14, display: "grid", gap: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Renseigne tes locations (si tu en as). Aucun champ n’est obligatoire.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            {/* Add card */}
            <button
              className="assetCard"
              style={{ textAlign: "left", padding: 14, borderStyle: "dashed", background: "transparent" }}
              onClick={() => {
                setRentalEditingId(null);
                setRentalDraft({
                  kind: "appartement",
                  ville: "",
                  superficie: undefined,
                  occupant: activePeople.length > 1 ? "commun" : activePeople[0]?.id ?? "commun",
                  loyer: 0,
                  charges: 0,
                  eau: 0,
                  elec: 0,
                  gaz: 0,
                  internet: 0,
                  assurance: 0,
                  customCharges: [],
                  customAbonnements: [],
                  customAutres: [],
                } as any);
                setRentalModalStep(1);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22 }}>🏠</span>
                  <span>Ajouter une location</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>＋</div>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Type, ville, superficie, titulaire… puis loyers & dépenses.
              </div>
            </button>

            {/* Existing rentals */}
            {rentals.map((r) => {
              const communLabel =
                activePeople.length > 1
                  ? `${activePeople[0]?.name ?? "Personne 1"} et ${activePeople[1]?.name ?? "Personne 2"}`
                  : "Moi";

              const occupantLabel =
                r.occupant === "commun"
                  ? communLabel
                  : activePeople.find((p) => p.id === r.occupant)?.name ?? "Moi";

              const sumCustom = (arr: any[] | undefined) => (arr ?? []).reduce((acc, x) => acc + (Number(x?.amount) || 0), 0);

              const monthlyExpenses =
                (Number(r.charges) || 0) +
                (Number(r.eau) || 0) +
                (Number(r.elec) || 0) +
                (Number(r.gaz) || 0) +
                (Number(r.internet) || 0) +
                (Number(r.assurance) || 0) +
                sumCustom((r as any).customCharges) +
                sumCustom((r as any).customAbonnements) +
                sumCustom((r as any).customAutres);

              return (
                <div key={r.id} className="assetCard" style={{ padding: 14, position: "relative", display: "grid", gap: 8 }} data-active={activeAssetId === r.id ? "1" : "0"}>
                  <div className="assetActions" style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                    <button
                      className="btnGhost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRentalEditingId(r.id);
                        setRentalDraft({ ...r } as any);
                        setRentalModalStep(2);
                      }}
                      aria-label="Modifier"
                      title="Modifier"
                    >
                      ✏️
                    </button>

                    <button
                      className="btnGhost"
                      style={{ opacity: rentals.length > 0 ? 1 : 0.35 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRentals((prev) => prev.filter((x) => x.id !== r.id));
                      }}
                      aria-label="Supprimer"
                      title="Supprimer"
                    >
                      🗑️
                    </button>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 22 }}>🏠</span>
                    <div style={{ display: "grid", gap: 2 }}>
                      <div style={{ fontWeight: 900 }}>{r.kind === "maison" ? "Maison" : "Appartement"}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        Loué par <b>{occupantLabel}</b>{r.ville ? ` à ${r.ville}` : ""}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Total mensuel (dépenses) : <b>{fmtMoney(monthlyExpenses)}</b>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Loyer : <b>{fmtMoney(Number(r.loyer) || 0)}</b>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* MODAL */}
          {rentalModalStep ? (
            <div
              className="afwOverlay"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setRentalModalStep(0);
              }}
            >
              <div className="afwModal" role="dialog" aria-modal="true" style={{ height: "auto", maxHeight: "min(720px, calc(100vh - 24px))" }}>
                <div className="afwTop">
                  <div className="afwTitle">{rentalModalStep === 1 ? "Nouvelle location — 1/2" : "Location — 2/2"}</div>
                  <button className="afwClose" onClick={() => setRentalModalStep(0)} aria-label="Fermer">
                    ✕
                  </button>
                </div>

                <div className="afwBody" style={{ overflow: "auto" }}>
                  {(() => {
                    const communLabel =
                      activePeople.length > 1
                        ? `${activePeople[0]?.name ?? "Personne 1"} et ${activePeople[1]?.name ?? "Personne 2"}`
                        : "Moi";

                    const current: any =
                      rentalEditingId ? rentals.find((x) => x.id === rentalEditingId) ?? (rentalDraft as any) : (rentalDraft as any);

                    const getEdit = () => (rentalEditingId ? rentalDraft : rentalDraft);

                    const updateCurrent = (patch: any) => {
                      setRentalDraft((prev) => ({ ...(prev as any), ...(patch as any) }));
                    };

                    const addCustom = (key: RentalCustomKey, period: RentalBudgetPeriod) => {
                      const draft = getEdit();
                      const next = [...((((draft as any)?.[key]) ?? []) as any[])];
                      next.push({ id: uid("c"), name: "", amount: 0, period, stage: "name" });
                      updateCurrent({ [key]: next });
                    };

                    const updateCustom = (key: RentalCustomKey, lineId: string, patch: any) => {
                      const draft = getEdit();
                      const next = ((((draft as any)?.[key]) ?? []) as any[]).map((l: any) => (l.id === lineId ? { ...l, ...patch } : l));
                      updateCurrent({ [key]: next });
                    };

                    const removeCustom = (key: RentalCustomKey, lineId: string) => {
                      const draft = getEdit();
                      const next = ((((draft as any)?.[key]) ?? []) as any[]).filter((l: any) => l.id !== lineId);
                      updateCurrent({ [key]: next });
                    };

                    // STEP 1
                    if (rentalModalStep === 1) {
                      return (
                        <div style={{ display: "grid", gap: 12, padding: 14 }}>
                          <div className="muted" style={{ fontSize: 12 }}>
                            On commence par l’essentiel : type, ville, superficie et titulaire.
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "start" }}>
                            <div style={{ display: "grid", gap: 4 }}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                Type
                              </div>
                              <select className="input" value={(current?.kind as any) ?? "appartement"} onChange={(e) => updateCurrent({ kind: e.target.value })}>
                                <option value="appartement">Appartement</option>
                                <option value="maison">Maison</option>
                              </select>
                            </div>

                            <div style={{ display: "grid", gap: 4 }}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                Ville
                              </div>
                              <input className="input" value={current?.ville ?? ""} onChange={(e) => updateCurrent({ ville: e.target.value })} placeholder="Ville" />
                            </div>

                            <div style={{ display: "grid", gap: 4 }}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                Superficie (m²)
                              </div>
                              <input
                                className="input"
                                inputMode="decimal"
                                value={current?.superficie ? String(current.superficie) : ""}
                                onChange={(e) => updateCurrent({ superficie: num(e.target.value) || undefined })}
                                placeholder="0"
                              />
                            </div>

                            <div style={{ display: "grid", gap: 4 }}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                Loué par
                              </div>
                              <select
                                className="input"
                                value={(current?.occupant as any) ?? (activePeople.length > 1 ? "commun" : activePeople[0]?.id ?? "commun")}
                                onChange={(e) => updateCurrent({ occupant: e.target.value })}
                              >
                                {activePeople.length > 1 ? (
                                  <>
                                    <option value="commun">{communLabel}</option>
                                    {activePeople.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name}
                                      </option>
                                    ))}
                                  </>
                                ) : (
                                  <option value={activePeople[0]?.id ?? "commun"}>{activePeople[0]?.name ?? "Moi"}</option>
                                )}
                              </select>
                            </div>
                          </div>

                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
                            <button className="btnSecondary" onClick={() => setRentalModalStep(0)} style={{ width: 140 }}>
                              Annuler
                            </button>

                            <button className="btnPrimary" onClick={() => setRentalModalStep(2)} style={{ width: 170 }}>
                              Continuer (1/2)
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // STEP 2
                    const r = current as RentalRow;

                    return (
                      <div style={{ padding: 14, display: "grid", gap: 12 }}>
                        <div style={{ display: "grid", gap: 2 }}>
                          <div style={{ fontWeight: 900 }}>{r.kind === "maison" ? "Maison" : "Appartement"}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Loué par{" "}
                            <b>
                              {r.occupant === "commun" ? communLabel : activePeople.find((p) => p.id === r.occupant)?.name ?? "Moi"}
                            </b>
                            {r.ville ? ` à ${r.ville}` : ""}
                          </div>

                          <button
                            className="btnLink"
                            onClick={() => setRentalModalStep(1)}
                            style={{ justifySelf: "start", padding: 0, height: "auto" }}
                          >
                            Modifier la location
                          </button>
                        </div>

                        <BudgetSection
                          title="Loyer"
                          titleSuffix="mensuel"
                          fields={[
                            { key: "loyer", label: "Loyer", value: r.loyer ?? "", onChange: (v) => updateCurrent({ loyer: num(v) }) },
                          ]}
                        />

                        <BudgetSection
                          title="Charges"
                          titleSuffix="mensuelles"
                          fields={[
                            { key: "charges", label: "Charges", value: r.charges ?? "", onChange: (v) => updateCurrent({ charges: num(v) }) },
                            { key: "eau", label: "Eau", value: r.eau ?? "", onChange: (v) => updateCurrent({ eau: num(v) }) },
                            { key: "elec", label: "Élec", value: r.elec ?? "", onChange: (v) => updateCurrent({ elec: num(v) }) },
                            { key: "gaz", label: "Gaz", value: r.gaz ?? "", onChange: (v) => updateCurrent({ gaz: num(v) }) },
                          ]}
                          onAdd={() => addCustom("customCharges", "month")}
                          custom={{
                            items: ((getEdit() as any)?.customCharges ?? []) as any,
                            defaultPeriod: "month",
                            onAdd: (p) => addCustom("customCharges", p),
                            onUpdate: (id, patch) => updateCustom("customCharges", id, patch),
                            onRemove: (id) => removeCustom("customCharges", id),
                          }}
                        />

                        <BudgetSection
                          title="Abonnements"
                          titleSuffix="mensuels"
                          fields={[
                            { key: "internet", label: "Internet", value: r.internet ?? "", onChange: (v) => updateCurrent({ internet: num(v) }) },
                            { key: "assurance", label: "Assurance", value: r.assurance ?? "", onChange: (v) => updateCurrent({ assurance: num(v) }) },
                          ]}
                          onAdd={() => addCustom("customAbonnements", "month")}
                          custom={{
                            items: ((getEdit() as any)?.customAbonnements ?? []) as any,
                            defaultPeriod: "month",
                            onAdd: (p) => addCustom("customAbonnements", p),
                            onUpdate: (id, patch) => updateCustom("customAbonnements", id, patch),
                            onRemove: (id) => removeCustom("customAbonnements", id),
                          }}
                        />

                        <BudgetSection
                          title="Autres"
                          titleSuffix="mensuels"
                          fields={[]}
                          onAdd={() => addCustom("customAutres", "month")}
                          custom={{
                            items: ((getEdit() as any)?.customAutres ?? []) as any,
                            defaultPeriod: "month",
                            onAdd: (p) => addCustom("customAutres", p),
                            onUpdate: (id, patch) => updateCustom("customAutres", id, patch),
                            onRemove: (id) => removeCustom("customAutres", id),
                          }}
                        />

                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
                          <button className="btnSecondary" onClick={() => setRentalModalStep(0)} style={{ width: 140 }}>
                            Fermer
                          </button>

                          <button
                            className="btnPrimary"
                            style={{ width: 170 }}
                            onClick={() => {
                              const draft = rentalDraft as any;

                              if (rentalEditingId) {
                                setRentals((prev) => prev.map((x) => (x.id === rentalEditingId ? ({ ...x, ...(draft as any) } as any) : x)));
                              } else {
                                setRentals((prev) => [...prev, { id: uid("r"), ...(draft as any) }]);
                              }

                              setRentalEditingId(null);
                              setRentalModalStep(0);
                            }}
                          >
                            Enregistrer
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ) : null}

          <div className="wizardNav">
            <button className="btnSecondary" style={{ width: 140 }} onClick={() => setStep("situation")}>
              {"< Retour"}
            </button>
            <button
              className="btnPrimary"
              style={{ width: 140 }}
              onClick={() => {
                markCompleted("rentals");
                persistProfile();
                setStep("owners");
              }}
            >
              Suivant &gt;
            </button>
          </div>
        </div>
      ) : null}

                  {step === "owners" ? (

        <div style={{ padding: 14, display: "grid", gap: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Ajoute tes biens (si tu en as). Aucun champ n’est obligatoire.
          </div>

          {/* Grid of biens */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
            {/* Add tile */}
            <button
              className="assetCard"
              style={{ textAlign: "left", padding: 14, borderStyle: "dashed", background: "transparent", gridColumn: "1 / -1", cursor: "pointer", display: "grid", gap: 10 }}
              onClick={() => {
                const communLabel =
                  activePeople.length > 1
                    ? `${activePeople[0]?.name ?? "Personne 1"} et ${activePeople[1]?.name ?? "Personne 2"}`
                    : "Moi";
                setOwnerEditingId(null);
                setOwnerDraft({
                  kind: "appartement",
                  ville: "",
                  superficie: undefined,
                  occupant: activePeople.length > 1 ? "commun" : activePeople[0]?.id ?? "commun",
                  usage: "primary",
                  ownerOccupant: true,
                  loyerPercu: 0,
                  taxeFoncierePeriod: "year",
                  impotRevenuPeriod: "year",
                  customCharges: [],
                  customImpots: [],
                  customAbonnements: [],
                  customAutres: [],
                } as any);
                setOwnerModalStep(1);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22 }}>🏠</span>
                  <span>Ajouter un bien</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>＋</div>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Ville, superficie, propriétaires… puis revenus & dépenses.
              </div>
            </button>

            {/* Existing biens */}
            {owners.map((o, idx) => {
              const communLabel =
                activePeople.length > 1
                  ? `${activePeople[0]?.name ?? "Personne 1"} et ${activePeople[1]?.name ?? "Personne 2"}`
                  : "Moi";
              const ownerLabel =
                activePeople.length > 1
                  ? o.occupant === "commun"
                    ? communLabel
                    : activePeople.find((p) => p.id === o.occupant)?.name ?? "—"
                  : activePeople[0]?.name ?? "Moi";

              const baseTitle = `${o.kind === "maison" ? "Maison" : "Appartement"}${o.superficie ? ` • ${o.superficie} m²` : ""}${
                o.ville ? ` • ${o.ville}` : ""
              }`;

              const monthlyTotal =
                toMonthly(o.taxeFonciere ?? 0, "year") +
                toMonthly(o.impotRevenu ?? 0, "year") +
                Number((o.chargesCopro ?? (o as any).charges) ?? 0) +
                Number(o.eau ?? 0) +
                Number(o.elec ?? 0) +
                Number(o.gaz ?? 0) +
                Number(o.internet ?? 0) +
                Number(o.assurance ?? 0) +
                ((o as any).customCharges ?? []).reduce((s: number, l: any) => s + toMonthly(l?.amount ?? 0, l?.period ?? "month"), 0) +
                ((o as any).customImpots ?? []).reduce((s: number, l: any) => s + toMonthly(l?.amount ?? 0, l?.period ?? "month"), 0) +
                ((o as any).customAbonnements ?? []).reduce((s: number, l: any) => s + toMonthly(l?.amount ?? 0, l?.period ?? "month"), 0) +
                ((o as any).customAutres ?? []).reduce((s: number, l: any) => s + toMonthly(l?.amount ?? 0, l?.period ?? "month"), 0);

              const monthlyIncome = o.ownerOccupant ? 0 : Number(o.loyerPercu ?? 0);

              return (
                <div
                  key={o.id}
                  className="assetCard"
                  style={{ padding: 14, position: "relative", display: "grid", gap: 8, gridColumn: "1 / -1" }}
                  data-active={activeAssetId === o.id ? "1" : "0"}
                  onClick={() => setActiveAssetId((prev) => (prev === o.id ? null : o.id))}
                >
                  <div className="assetActions" style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                    <button
                      className="btnGhost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOwnerEditingId(o.id);
                        setOwnerDraft({ ...o } as any);
                        setOwnerModalStep(2);
                      }}
                      aria-label="Modifier"
                      title="Modifier"
                    >
                      ✏️
                    </button>

                    <button
                      className="btnGhost"
                      style={{ opacity: owners.length > 1 ? 1 : 0.35, pointerEvents: owners.length > 1 ? "auto" : "none" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOwners((prev) => prev.filter((x) => x.id !== o.id));
                      }}
                      aria-label="Supprimer le bien"
                      title={owners.length > 1 ? "Supprimer" : "Au moins un bien doit rester"}
                    >
                      🗑️
                    </button>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 22 }}>🏠</span>
                    <div style={{ display: "grid", gap: 2 }}>
                      <div style={{ fontWeight: 900 }}>{o.kind === "maison" ? "Maison" : "Appartement"}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        Possédé par <b>{ownerLabel}</b>{o.ville ? ` à ${o.ville}` : ""}{o.ownerOccupant ? " · Résidence principale" : ""}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Total mensuel (dépenses) : <b>{fmtMoney(monthlyTotal)}</b>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Loyer perçu : <b>{fmtMoney(monthlyIncome)}</b>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* MODALS */}
          {ownerModalStep ? (
            <div
              className="afwOverlay"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setOwnerModalStep(0);
              }}
            >
              <div className="afwModal" role="dialog" aria-modal="true" style={{ height: "auto", maxHeight: "min(720px, calc(100vh - 24px))" }}>
                <div className="afwTop">
                  <div className="afwTitle">
                    {ownerModalStep === 1 ? "Nouveau bien — 1/2" : "Bien — 2/2"}
                  </div>
                  <button className="afwClose" onClick={() => setOwnerModalStep(0)} aria-label="Fermer">
                    ✕
                  </button>
                </div>

                <div className="afwBody" style={{ overflow: "auto" }}>
                  {(() => {
                    const communLabel =
                      activePeople.length > 1
                        ? `${activePeople[0]?.name ?? "Personne 1"} et ${activePeople[1]?.name ?? "Personne 2"}`
                        : "Moi";

                    const current: any =
                      ownerEditingId ? owners.find((x) => x.id === ownerEditingId) ?? (ownerDraft as any) : (ownerDraft as any);

                    const updateCurrent = (patch: any) => {
                      if (ownerEditingId) {
                        setOwners((prev) => prev.map((x) => (x.id === ownerEditingId ? ({ ...x, ...patch } as any) : x)));
                      } else {
                        setOwnerDraft((prev) => ({ ...(prev as any), ...patch }));
                      }
                    };

                    const getEdit = () => (ownerEditingId ? (owners.find((x) => x.id === ownerEditingId) as any) : (ownerDraft as any));

                    const addCustom = (key: "customCharges" | "customImpots" | "customAbonnements" | "customAutres", defaultPeriod: "month" | "year") => {
                      const draft = getEdit();
                      const next = [...(draft?.[key] ?? []), { id: uid("cl"), name: "", amount: undefined, period: defaultPeriod, stage: "name" }];
                      updateCurrent({ [key]: next });
                    };

                    const updateCustom = (key: RentalCustomKey, lineId: string, patch: any) => {
                      const draft = getEdit();
                      const normalized = {
                        ...patch,
                        ...(patch && patch.amount !== undefined ? { amount: num(String(patch.amount)) } : {}),
                        ...(patch && patch.name !== undefined && patch.stage === "full" ? { name: String(patch.name).trim() } : {}),
                      };
                      const next = ((((draft as any)?.[key]) ?? []) as any[]).map((l: any) => (l.id === lineId ? { ...l, ...normalized } : l));
                      updateCurrent({ [key]: next });
                    };

                    const removeCustom = (key: RentalCustomKey, lineId: string) => {
                      const draft = getEdit();
                      const next = ((((draft as any)?.[key]) ?? []) as any[]).filter((l: any) => l.id !== lineId);
                      updateCurrent({ [key]: next });
                    };

// -------- STEP 1 --------
                    if (ownerModalStep === 1) {
                      return (
                        <div style={{ display: "grid", gap: 12, padding: 14 }}>
                          <div className="muted" style={{ fontSize: 12 }}>
                            On commence par l’essentiel : ville, superficie et propriétaires.
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "start" }}>
                            <div style={{ display: "grid", gap: 4 }}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                Type
                              </div>
                              <select
                                className="input"
                                value={(current?.kind as any) ?? "appartement"}
                                onChange={(e) => updateCurrent({ kind: e.target.value })}
                              >
                                <option value="appartement">Appartement</option>
                                <option value="maison">Maison</option>
                              </select>
                            </div>

                            <div style={{ display: "grid", gap: 4 }}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                Ville
                              </div>
                              <input className="input" value={current?.ville ?? ""} onChange={(e) => updateCurrent({ ville: e.target.value })} placeholder="Ville" />
                            </div>

                            <div style={{ display: "grid", gap: 4 }}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                Superficie (m²)
                              </div>
                              <input
                                className="input"
                                inputMode="decimal"
                                value={current?.superficie ? String(current.superficie) : ""}
                                onChange={(e) => updateCurrent({ superficie: num(e.target.value) || undefined })}
                                placeholder="0"
                              />
                            </div>

                            <div style={{ display: "grid", gap: 4 }}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                Possédé par
                              </div>
                              <select
                                className="input"
                                value={current?.occupant ?? (activePeople.length > 1 ? "commun" : activePeople[0]?.id ?? "commun")}
                                onChange={(e) => updateCurrent({ occupant: e.target.value })}
                              >
                                {activePeople.length > 1 ? (
                                  <>
                                    <option value="commun">{communLabel}</option>
                                    {activePeople.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name}
                                      </option>
                                    ))}
                                  </>
                                ) : (
                                  <option value={activePeople[0]?.id ?? "commun"}>{activePeople[0]?.name ?? "Moi"}</option>
                                )}
                              </select>
                            </div>
                          </div>

                          <div style={{ display: "grid", gap: 6 }}>
                            <div className="muted" style={{ fontSize: 12 }}>
  Usage du bien
</div>

<div className="segmentedSwitch">
  <button
    type="button"
    className={"segmentedSwitchBtn " + (((current?.usage ?? "primary") === "primary") ? "isActive" : "")}
    onClick={() => updateCurrent({ usage: "primary", loyerPercu: 0 })}
    aria-pressed={(current?.usage ?? "primary") === "primary"}
  >
    Résidence principale
  </button>
  <button
    type="button"
    className={"segmentedSwitchBtn " + (((current?.usage ?? "primary") === "investment") ? "isActive" : "")}
    onClick={() => updateCurrent({ usage: "investment" })}
    aria-pressed={(current?.usage ?? "primary") === "investment"}
  >
    Investissement locatif
  </button>
</div>

                            <div className="muted" style={{ fontSize: 12 }}>
                              Si le bien est loué occasionnellement, il est préférable de sélectionner <b>Investissement locatif</b> pour déclarer les loyers.
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
                            <button className="btnSecondary" onClick={() => setOwnerModalStep(0)} style={{ width: 140 }}>
                              Annuler
                            </button>

                            <button
                              className="btnPrimary"
                              style={{ width: 180 }}
                              onClick={() => {
                                if (ownerEditingId) {
                                  // editing base info => go to step 2
                                  setOwnerModalStep(2);
                                  return;
                                }

                                const id = uid("o");
                                const draft = ownerDraft as any;

                                const row: any = {
                                  id,
                                  kind: (draft?.kind as any) ?? "appartement",
                                  ville: String(draft?.ville ?? ""),
                                  superficie: draft?.superficie,
                                  occupant: draft?.occupant ?? (activePeople.length > 1 ? "commun" : activePeople[0]?.id ?? "commun"),
                                  ownerOccupant: false,
                                  loyerPercu: 0,
                                  chargesCopro: undefined,
                                  taxeFonciere: undefined,
                                  taxeFoncierePeriod: "year",
                                  impotRevenu: undefined,
                                  impotRevenuPeriod: "year",
                                  internet: undefined,
                                  assurance: undefined,
                                  eau: undefined,
                                  elec: undefined,
                                  gaz: undefined,
                                  customCharges: [],
                                  customImpots: [],
                                  customAbonnements: [],
                                  customAutres: [],
                                };

                                setOwners((prev) => [...prev, row]);
                                setOwnerEditingId(id);
                                setOwnerModalStep(2);
                              }}
                            >
                              Continuer (1/2)
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // -------- STEP 2 --------
                    const o = ownerEditingId ? (owners.find((x) => x.id === ownerEditingId) as any) : (ownerDraft as any);
                    if (!o) return null;

                    const header = `${o.kind === "maison" ? "Maison" : "Appartement"}${o.superficie ? ` • ${o.superficie} m²` : ""}${o.ville ? ` • ${o.ville}` : ""}`;
                    const ownerLabel =
                      activePeople.length > 1
                        ? o.occupant === "commun"
                          ? communLabel
                          : activePeople.find((p) => p.id === o.occupant)?.name ?? "—"
                        : activePeople[0]?.name ?? "Moi";

                    return (
                      <div style={{ display: "grid", gap: 12, padding: 14 }}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontWeight: 900 }}>{header}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Possédé par <b>{ownerLabel}</b>
                          </div>
                          <button
                            className="linkBtn"
                            style={{ justifySelf: "start" }}
                            onClick={() => {
                              setOwnerDraft({ ...o } as any);
                              setOwnerModalStep(1);
                            }}
                          >
                            Modifier le bien
                          </button>
                        </div>

                        {(o.usage ?? "primary") === "investment" ? (
                        
                        <BudgetSection
                          title="Revenus"
                          titleSuffix="mensuels"
                          hidden={getEdit()?.usageType === "primary"}
                          fields={[
                            {
                              key: "loyerPercu",
                              label: "Loyer perçu",
                              value: getEdit()?.usageType === "primary" ? 0 : o.loyerPercu ?? "",
                              onChange: (v) => updateCurrent({ loyerPercu: num(v) }),
                              hint: "Mettre 0 si le(s) propriétaire(s) occupe(nt) le logement.",
                              disabled: getEdit()?.usageType === "primary",
                            },
                          ]}
                        />

                      ) : null}

                        
                        <BudgetSection
                          title="Charges"
                          titleSuffix="mensuelles"
                          fields={[
                            { key: "charges", label: "Charges", value: (o.chargesCopro ?? o.charges) ?? "", onChange: (v) => updateCurrent({ chargesCopro: num(v), charges: undefined }) },
                            { key: "eau", label: "Eau", value: o.eau ?? "", onChange: (v) => updateCurrent({ eau: num(v) }) },
                            { key: "elec", label: "Élec", value: o.elec ?? "", onChange: (v) => updateCurrent({ elec: num(v) }) },
                            { key: "gaz", label: "Gaz", value: o.gaz ?? "", onChange: (v) => updateCurrent({ gaz: num(v) }) },
                          ]}
                          onAdd={() => addCustom("customCharges", "month")}
                          custom={{
                            items: ((getEdit() as any)?.customCharges ?? []) as any,
                            defaultPeriod: "month",
                            onAdd: (p) => addCustom("customCharges", p),
                            onUpdate: (id, patch) => updateCustom("customCharges", id, patch),
                            onRemove: (id) => removeCustom("customCharges", id),
                          }}
                        />


                        
                        <BudgetSection
                          title="Impôts"
                          titleSuffix="annuels"
                          fields={[
                            { key: "taxeFonciere", label: "Taxe foncière", value: o.taxeFonciere ?? "", onChange: (v) => updateCurrent({ taxeFonciere: num(v) }) },
                            { key: "impot", label: "Impôt", value: o.impotRevenu ?? "", onChange: (v) => updateCurrent({ impotRevenu: num(v) }) },
                          ]}
                          onAdd={() => addCustom("customImpots", "year")}
                          custom={{
                            items: ((getEdit() as any)?.customImpots ?? []) as any,
                            defaultPeriod: "year",
                            onAdd: (p) => addCustom("customImpots", p),
                            onUpdate: (id, patch) => updateCustom("customImpots", id, patch),
                            onRemove: (id) => removeCustom("customImpots", id),
                          }}
                        />


                        
                        <BudgetSection
                          title="Abonnements"
                          titleSuffix="mensuels"
                          fields={[
                            { key: "internet", label: "Internet", value: o.internet ?? "", onChange: (v) => updateCurrent({ internet: num(v) }) },
                            { key: "assurance", label: "Assurance", value: o.assurance ?? "", onChange: (v) => updateCurrent({ assurance: num(v) }) },
                          ]}
                          onAdd={() => addCustom("customAbonnements", "month")}
                          custom={{
                            items: ((getEdit() as any)?.customAbonnements ?? []) as any,
                            defaultPeriod: "month",
                            onAdd: (p) => addCustom("customAbonnements", p),
                            onUpdate: (id, patch) => updateCustom("customAbonnements", id, patch),
                            onRemove: (id) => removeCustom("customAbonnements", id),
                          }}
                        />


                        
                        <BudgetSection
                          title="Autres"
                          titleSuffix="mensuels"
                          fields={[]}
                          onAdd={() => addCustom("customAutres", "month")}
                          custom={{
                            items: ((getEdit() as any)?.customAutres ?? []) as any,
                            defaultPeriod: "month",
                            onAdd: (p) => addCustom("customAutres", p),
                            onUpdate: (id, patch) => updateCustom("customAutres", id, patch),
                            onRemove: (id) => removeCustom("customAutres", id),
                          }}
                        />


                        <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
                          <button className="btnSecondary" style={{ width: 160 }} onClick={() => setOwnerModalStep(1)}>
                            {"< Retour (1/2)"}
                          </button>

                          <button
                            className="btnPrimary"
                            style={{ width: 160 }}
                            onClick={() => {
                              setOwnerModalStep(0);
                              setOwnerEditingId(null);
                              setOwnerDraft({ kind: "appartement" });
                            }}
                          >
                            Valider
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ) : null}

          <div className="wizardNav">
            <button className="btnSecondary" style={{ width: 140 }} onClick={() => setStep("owners")}>
              {"< Retour"}
            </button>
            <button
              className="btnPrimary"
              style={{ width: 140 }}
              onClick={() => {
                markCompleted("owners");
                persistProfile();
                setStep("cars");
              }}
            >
              Suivant ›
            </button>
          </div>
        </div>
      ) : null}


      

      {step === "cars" ? (
        <div style={{ padding: 14, display: "grid", gap: 12 }}>
          {hasCar === undefined ? (
            <div style={{ display: "grid", gap: 10 }}>
              <button
                className="btnOption"
                onClick={() => {
                  setHasCar(true);
                  markCompleted("cars");
                }}
              >
                Au moins l&apos;un d&apos;entre vous possède une voiture <span className="chev">›</span>
              </button>

              <button
                className="btnOption"
                onClick={() => {
                  setHasCar(false);
                  markSkipped("cars");
                  setStep("daily");
                }}
              >
                Aucun d&apos;entre vous ne possède de voiture <span className="chev">›</span>
              </button>

              <button className="btnSecondary" onClick={() => setStep("owners")}>
                &lt; Retour
              </button>
            </div>
          ) : hasCar ? (
            <>
              <div className="muted" style={{ fontSize: 12 }}>
                Renseigne tes voitures (si tu en as). Aucun champ n’est obligatoire.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
                {/* Add card */}
                <button
                  className="assetCard"
                  style={{ textAlign: "left", padding: 14, borderStyle: "dashed", background: "transparent" }}
                  onClick={() => {
                    setCarEditingId(null);
                    setCarDraft({
                      label: "",
                      ownerKey: activePeople.length > 1 ? "both" : activePeople[0]?.id ?? "both",
                      assurance: 0,
                      carburant: 0,
                      entretien: 0,
                      credit: 0,
                      parking: 0,
                      peage: 0,
                      customMonthly: [],
                    } as any);
                    setCarModalStep(1);
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 22 }}>🚗</span>
                      <span>Ajouter une voiture</span>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>＋</div>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Modèle, propriétaire… puis dépenses mensuelles.
                  </div>
                </button>

                {/* Existing cars */}
                {cars.map((c) => {
                  const communLabel =
                    activePeople.length > 1
                      ? `${activePeople[0]?.name ?? "Personne 1"} et ${activePeople[1]?.name ?? "Personne 2"}`
                      : "Moi";

                  const ownerLabel =
                    c.ownerKey === "both" ? communLabel : activePeople.find((p) => p.id === c.ownerKey)?.name ?? "Moi";

                  const sumCustom = (arr: any[] | undefined) => (arr ?? []).reduce((acc, x) => acc + (Number(x?.amount) || 0), 0);

                  const monthlyExpenses =
                    (Number((c as any).assurance) || 0) +
                    (Number((c as any).carburant) || 0) +
                    (Number((c as any).entretien) || 0) +
                    (Number((c as any).credit) || 0) +
                    (Number((c as any).parking) || 0) +
                    (Number((c as any).peage) || 0) +
                    sumCustom((c as any).customMonthly);

                  return (
                    <div key={c.id} className="assetCard" style={{ padding: 14, position: "relative", display: "grid", gap: 8 }} data-active={activeCarId === c.id ? "1" : "0"}>
                      <div className="assetActions" style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                        <button
                          className="btnGhost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCarEditingId(c.id);
                            setCarDraft({ ...(c as any) } as any);
                            setCarModalStep(2);
                          }}
                          aria-label="Modifier"
                          title="Modifier"
                        >
                          ✏️
                        </button>

                        <button
                          className="btnGhost"
                          style={{ opacity: cars.length > 0 ? 1 : 0.35 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCars((prev) => prev.filter((x) => x.id !== c.id));
                          }}
                          aria-label="Supprimer"
                          title="Supprimer"
                        >
                          🗑️
                        </button>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 22 }}>🚗</span>
                        <div style={{ display: "grid", gap: 2 }}>
                          <div style={{ fontWeight: 900 }}>{(String(c.label ?? "").trim() || "Voiture")}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Propriétaire : <b>{ownerLabel}</b>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div className="muted" style={{ fontSize: 12 }}>
                          Total mensuel (dépenses) : <b>{fmtMoney(monthlyExpenses)}</b>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="wizardNav">
                <button className="btnSecondary" onClick={() => setStep("owners")}>
                  &lt; Retour
                </button>
                <button
                  className="btnPrimary"
                  onClick={() => {
                    markCompleted("cars");
                    setStep("daily");
                  }}
                >
                  Suivant ›
                </button>
              </div>

              {/* MODAL */}
              {carModalStep ? (
                <div
                  className="afwOverlay"
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) setCarModalStep(0);
                  }}
                >
                  <div className="afwModal" role="dialog" aria-modal="true" style={{ height: "auto", maxHeight: "min(720px, calc(100vh - 24px))" }}>
                    <div className="afwTop">
                      <div className="afwTitle">{carModalStep === 1 ? "Nouvelle voiture — 1/2" : "Voiture — 2/2"}</div>
                      <button className="afwClose" onClick={() => setCarModalStep(0)} aria-label="Fermer">
                        ✕
                      </button>
                    </div>

                    <div className="afwBody" style={{ overflow: "auto" }}>
                      {(() => {
                        const communLabel =
                          activePeople.length > 1
                            ? `${activePeople[0]?.name ?? "Personne 1"} et ${activePeople[1]?.name ?? "Personne 2"}`
                            : "Moi";

                        const updateCurrent = (patch: any) => {
                          setCarDraft((prev) => ({ ...(prev as any), ...(patch as any) }));
                        };

                        return carModalStep === 1 ? (
                          <div style={{ display: "grid", gap: 12 }}>
                            <div className="twoCols">
                              <div>
                                <div className="label">Modèle (ex: Clio 5)</div>
                                <input
                                  className="input"
                                  value={String((carDraft as any).label ?? "")}
                                  maxLength={24}
                                  onChange={(e) => updateCurrent({ label: e.target.value })}
                                  placeholder="Ex: Clio 5"
                                />
                              </div>

                              <div>
                                <div className="label">Propriétaire</div>
                                <select className="input" value={String((carDraft as any).ownerKey ?? "both")} onChange={(e) => updateCurrent({ ownerKey: e.target.value })}>
                                  {activePeople.length > 1 ? (
                                    <>
                                      <option value="both">{communLabel}</option>
                                      <option value={activePeople[0]?.id ?? "p1"}>{activePeople[0]?.name ?? "Personne 1"}</option>
                                      <option value={activePeople[1]?.id ?? "p2"}>{activePeople[1]?.name ?? "Personne 2"}</option>
                                    </>
                                  ) : (
                                    <option value={activePeople[0]?.id ?? "p1"}>{activePeople[0]?.name ?? "Moi"}</option>
                                  )}
                                </select>
                              </div>
                            </div>

                            <div className="wizardNav">
                              <button className="btnSecondary" onClick={() => setCarModalStep(0)}>
                                Annuler
                              </button>
                              <button className="btnPrimary" onClick={() => setCarModalStep(2)}>
                                Continuer (1/2)
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "grid", gap: 12 }}>
                            <BudgetSection
                              title="Dépenses voiture mensuelles"
                              base={[
                                { key: "assurance", label: "Assurance" },
                                { key: "carburant", label: "Carburant" },
                                { key: "entretien", label: "Entretien" },
                                { key: "credit", label: "Crédit/LOA" },
                                { key: "parking", label: "Parking" },
                                { key: "peage", label: "Péage" },
                              ]}
                              values={carDraft as any}
                              onValue={(key, val) => setCarDraft((p) => ({ ...(p as any), [key]: val }))}
                              custom={{
                                lines: ((carDraft as any).customMonthly as any) ?? [],
                                onAdd: () =>
                                  setCarDraft((p) => ({
                                    ...(p as any),
                                    customMonthly: [...(((p as any).customMonthly as any) ?? []), { id: uid("cm"), name: "", amount: 0, stage: "name" }],
                                  })),
                                onUpdate: (id, patch) =>
                                  setCarDraft((p) => ({
                                    ...(p as any),
                                    customMonthly: ((((p as any).customMonthly as any) ?? []) as any).map((l: any) => (l.id === id ? { ...l, ...patch } : l)),
                                  })),
                                onRemove: (id) => setCarDraft((p) => ({ ...(p as any), customMonthly: ((((p as any).customMonthly as any) ?? []) as any).filter((l: any) => l.id !== id) })),
                              }}
                            />

                            <div className="wizardNav">
                              <button className="btnSecondary" onClick={() => setCarModalStep(1)}>
                                &lt; Retour
                              </button>
                              <button
                                className="btnPrimary"
                                onClick={() => {
                                  const row: any = {
                                    id: carEditingId ?? uid("car"),
                                    label: String((carDraft as any).label ?? ""),
                                    ownerKey: String((carDraft as any).ownerKey ?? "both"),
                                    assurance: Number((carDraft as any).assurance || 0),
                                    carburant: Number((carDraft as any).carburant || 0),
                                    entretien: Number((carDraft as any).entretien || 0),
                                    credit: Number((carDraft as any).credit || 0),
                                    parking: Number((carDraft as any).parking || 0),
                                    peage: Number((carDraft as any).peage || 0),
                                    customMonthly: ((carDraft as any).customMonthly as any) ?? [],
                                  };
                                  setCars((prev) => {
                                    if (carEditingId) return prev.map((x) => (x.id === carEditingId ? row : x));
                                    return [...prev, row];
                                  });
                                  setCarModalStep(0);
                                  setCarEditingId(null);
                                }}
                              >
                                Valider (2/2)
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                OK — vous n’avez pas de voiture.
              </div>
              <div className="wizardNav">
                <button className="btnSecondary" onClick={() => setHasCar(undefined)}>
                  Modifier
                </button>
                <button className="btnPrimary" onClick={() => setStep("daily")}>
                  Suivant ›
                </button>
              </div>
            </div>
          )}
        </div>
      ) : step === "daily" ? (
        <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Quelques postes du quotidien (facultatif) — tu pourras affiner ensuite.
          </div>

          {["courses", "transport", "loisirs", "sante", "autres"].map((k) => (
            <label key={k} style={{ display: "grid", gap: 4 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                {k === "courses"
                  ? "Courses"
                  : k === "transport"
                    ? "Transport"
                    : k === "loisirs"
                      ? "Loisirs"
                      : k === "sante"
                        ? "Santé"
                        : "Autres"}
              </span>
              <input
                className="input"
                inputMode="decimal"
                value={String((daily as any)[k] ?? "")}
                onChange={(e) => setDaily((prev) => ({ ...prev, [k]: num(e.target.value) }))}
                placeholder="0"
              />
            </label>
          ))}

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btnSecondary" style={{ width: 140 }} onClick={() => setStep(isOwner ? "owners" : "owner")}>{"< Retour"}</button>
            <button
              className="btnPrimary"
              style={{ width: 140 }}
              onClick={() => {
                markCompleted("daily");
                persistProfile();
                setStep("summary");
              }}
            >
              Suivant ›
            </button>
          </div>
        </div>
      ) : null}

      {step === "summary" ? (
        <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>Résumé</div>

          <div className="wizardSummarySteps">
            {WIZ_STEPS.map((s) => {
              const done = completedSteps.includes(s.step);
              const skipped = skippedSteps.includes(s.step);
              const pending = !done && !skipped && s.step !== "summary";
              return (
                <div
                  key={s.step}
                  className={`wizardSummaryStep ${done ? "isDone" : ""} ${skipped ? "isSkipped" : ""} ${pending ? "isPending" : ""}`}
                >
                  <span style={{ fontWeight: 800 }}>{s.label}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {done ? "OK" : skipped ? "Sauté" : "À faire"}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Foyer créé : <b>{foyerId ? foyers.find((f) => f.id === foyerId)?.name : ""}</b>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Personnes
            </div>
            <div style={{ fontWeight: 800 }}>{activePeople.map((p) => p.name).join(" · ")}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Revenus
            </div>
            <div style={{ fontWeight: 800 }}>{formatEUR(totalGlobal)}</div>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Logement : {isTenant ? "Locataire" : "Non"} · Propriétaire : {isOwner ? "Oui" : "Non"}
          </div>

          <button
            className="btnPrimary"
            onClick={() => {
              markCompleted("summary");
              persistProfile();
              persistBudgetStores();
              if (foyerId) setActiveFoyer(foyerId);
              router.push("/dashboard/postes");
            }}
          >
            Consulter mon budget
          </button>

          <button className="btnSecondary" onClick={() => router.push("/")}>Retour à l’accueil</button>
        </div>
      ) : null}
          </div>
        </div>

        <button
          type="button"
          className="wizardSideArrow"
          onClick={goNext}
          disabled={!nextVisibleStep || !canGoNext}
          aria-label="Étape suivante"
        >
          ›
        </button>
      </div>
    </div>

  </div>
    </>
  );
}