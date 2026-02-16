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

// Small UX constant: delay before auto-advancing after a choice (lets the user see feedback)
const AUTO_ADVANCE_MS = 180;


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
      return "1/ Foyer";
    case "coupleStatus":
      return "2/ Couple";
    case "incomes":
      return "3/ Revenus";
    case "situation":
      return "4/ Immobilier";
    case "rentals":
      return "5/ Résidence";
    case "owner":
      return "6/ Propriété";
    case "owners":
      return "Mes biens";
    case "cars":
      return "6/ Mobilité";
    case "daily":
      return "7/ Dépenses";
    case "summary":
      return "Résumé";
  }
}

const WIZ_STEPS: Array<{ step: Step; label: string }> = [
  { step: "people", label: "Foyer" },
  { step: "coupleStatus", label: "Couple" },
  { step: "incomes", label: "Revenus" },
  { step: "situation", label: "Immobilier" },
  { step: "owners", label: "Mes biens" }, // visible only if "Oui" à l'étape Immobilier
  { step: "rentals", label: "Résidence" },
  { step: "cars", label: "Mobilité" },
  { step: "daily", label: "Dépenses" },
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

function WizardTopProgress(props: { current: number; total: number; label?: string }) {
  const pct = props.total <= 0 ? 0 : Math.round((props.current / props.total) * 100);
  return (
    <div className="wizTopProgress" aria-label="Progression">
      <div className="wizTopProgressRow">
        <div className="wizTopProgressLabel">
          Étape {Math.min(props.current, props.total)}/{props.total}
          {props.label ? <span className="wizTopProgressSep">·</span> : null}
          {props.label ? <span className="wizTopProgressTxt">{props.label}</span> : null}
        </div>
        <div className="wizTopProgressPct" aria-hidden="true">
          {pct}%
        </div>
      </div>
      <div className="wizTopProgressBar" role="progressbar" aria-valuenow={props.current} aria-valuemin={1} aria-valuemax={props.total}>
        <div className="wizTopProgressFill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ChoiceCard(props: {
  title: string;
  subtitle?: string;
  icon?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`wizChoiceCard ${props.selected ? "isSelected" : ""}`}
      onClick={props.onClick}
      aria-pressed={props.selected}
    >
      <div className="wizChoiceIcon" aria-hidden="true">{props.icon ?? ""}</div>
      <div className="min0" style={{ textAlign: "left" }}>
        <div className="wizChoiceTitle">{props.title}</div>
        {props.subtitle ? <div className="wizChoiceSubtitle">{props.subtitle}</div> : null}
      </div>
      <div className="wizChoiceCheck" aria-hidden="true">{props.selected ? "✓" : ""}</div>
    </button>
  );
}


function StepIcon(props: { step: Step }) {
  // Minimal inline icons (no dependency).
  // Keep shapes simple so they render nicely at small sizes.
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
  } as const;

  switch (props.step) {
    case "people":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M16 11c1.66 0 3-1.57 3-3.5S17.66 4 16 4s-3 1.57-3 3.5S14.34 11 16 11Z" stroke="currentColor" strokeWidth="2" />
          <path d="M8 12c1.66 0 3-1.79 3-4S9.66 4 8 4 5 5.79 5 8s1.34 4 3 4Z" stroke="currentColor" strokeWidth="2" />
          <path d="M2 20c0-3 3-5 6-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M14 15c4 0 8 2 8 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "coupleStatus":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" />
          <path d="M17 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" />
          <path d="M2 20c0-3 2-5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M22 20c0-3-2-5-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M9 20c0-3 1.5-6 3-6s3 3 3 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "incomes":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 3v18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M17 7c0-1.66-2.24-3-5-3S7 5.34 7 7s2.24 3 5 3 5 1.34 5 3-2.24 3-5 3-5-1.34-5-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "situation":
    case "owner":
    case "owners":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      );
    case "rentals":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 21V8l8-5 8 5v13" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M9 21v-6h6v6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M8 10h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "cars":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M5 16l1.5-6A2 2 0 0 1 8.44 8h7.12a2 2 0 0 1 1.94 2L19 16" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M7 16h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M7.5 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" fill="currentColor" />
          <path d="M16.5 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" fill="currentColor" />
        </svg>
      );
    case "daily":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 19h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M6 16V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 16V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M18 16v-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "summary":
    default:
      return (
        <svg {...common} aria-hidden="true">
          <path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M9 8h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M9 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

/**
 * CurrencyField
 * A pragmatic (safe) money input: user types numbers, we store number,
 * and we show a formatted preview under the field.
 * This avoids fragile "format inside the input" logic.
 */
function CurrencyField(props: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  onChange: (v: number) => void;
  hint?: string;
  onEnter?: () => void;
}) {
  const v = Number(props.value ?? 0);
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="muted" style={{ fontSize: 12 }}>{props.label}</span>
      <input
        className="input"
        inputMode="numeric"
        value={Number.isFinite(v) ? (v === 0 ? "" : String(v)) : ""}
        onKeyDown={(e) => {
          if (e.key === "Enter" && props.onEnter) {
            e.preventDefault();
            props.onEnter();
          }
        }}
        onChange={(e) => props.onChange(num(e.target.value))}
        placeholder={props.placeholder ?? "0"}
      />
      <span className="muted" style={{ fontSize: 12 }}>
        {props.hint ? `${props.hint} · ` : ""}{fmtMoney(v)}/mois
      </span>
    </label>
  );
}


function YesNoToggle(props: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="wizYesNo" role="group" aria-label="Choix Oui / Non">
      <button
        type="button"
        className={`wizYesNoBtn ${props.value === true ? "isActive" : ""}`}
        onClick={() => props.onChange(true)}
        aria-pressed={props.value === true}
      >
        Oui
      </button>
      <button
        type="button"
        className={`wizYesNoBtn ${props.value === false ? "isActive" : ""}`}
        onClick={() => props.onChange(false)}
        aria-pressed={props.value === false}
      >
        Non
      </button>
    </div>
  );
}

function SliderCard(props: {
  title: string;
  subtitle?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const min = props.min ?? 0;
  const max = props.max ?? 1500;
  const step = props.step ?? 10;
  return (
    <div className="wizSliderCard">
      <div className="wizSliderHead">
        <div className="min0">
          <div className="wizSliderTitle">{props.title}</div>
          {props.subtitle ? <div className="wizSliderSub">{props.subtitle}</div> : null}
        </div>
        <div className="wizSliderValue">{fmtMoney(props.value)}</div>
      </div>
      <input
        className="wizSlider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value) || 0)}
        aria-label={props.title}
      />
      <div className="wizSliderTicks" aria-hidden="true">
        <span>{fmtMoney(min)}</span>
        <span>{fmtMoney(max)}</span>
      </div>
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

  const bar = (
    <div className="wizardCrumbBar" role="navigation" aria-label="Étapes">
      <div className="wizardCrumbInner">
        {props.visibleSteps.map((s, idx) => {
          const isActive = s.step === props.currentStep;
          return (
            <button
              key={s.step}
              className={"wizardCrumbItem" + (isActive ? " active" : "")}
              onClick={() => props.onGo(s.step)}
              type="button"
            >
              <span className="wizardCrumbNum">{idx + 1}</span>
              <span className="wizardCrumbTxt">{s.label}</span>
              <span className="wizardCrumbSep">›</span>
            </button>
          );
        })}
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

  // "people" step is now a 2-screen micro-flow (1) household type, (2) identity.
  const [peopleSubStep, setPeopleSubStep] = useState<1 | 2>(1);
  const name1Ref = useRef<HTMLInputElement | null>(null);
  const name2Ref = useRef<HTMLInputElement | null>(null);


// Sub-steps to keep "one question per screen" while reusing existing step keys.
const [rentalsSubStep, setRentalsSubStep] = useState<1 | 2>(1); // 1: question, 2: list/form
const [carsSubStep, setCarsSubStep] = useState<1 | 2>(1); // 1: question, 2: costs form

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
      const order: Step[] = ["people","coupleStatus","incomes","situation","owners","rentals","cars","daily","summary"];
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

  // When entering a step that contains an internal sub-flow, sync the sub-step with existing answers.
  // NOTE: Must be declared after isTenant/hasCar initializations to avoid TDZ runtime errors.
  useEffect(() => {
    if (step === "rentals") setRentalsSubStep(isTenant === true ? 2 : 1);
    if (step === "cars") setCarsSubStep(hasCar === true ? 2 : 1);
  }, [step, isTenant, hasCar]);
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

  // Daily step UX: presets + show explicit confirmation only after manual adjustment.
  const [dailyInteracted, setDailyInteracted] = useState(false);
  const [dailyPresetUsed, setDailyPresetUsed] = useState<null | "small" | "medium" | "large">(null);

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
    const needed = householdType === "couple" ? 2 : 1;
    const trimmed = draftPeople.slice(0, needed).map((p) => (p.name ?? "").trim());
    // Prénom/alias must be at least 3 characters.
    return trimmed.every((n) => n.length >= 3);
  }, [draftPeople, householdType]);
  
  const visibleSteps = useMemo(() => {
  // Steps shown in the sidebar and used for Next/Back navigation.
  // - coupleStatus only matters when the household is a couple
  // - owners (Mes biens) only matters when isOwner === true
  const showCoupleStatus = householdType === "couple";
  const showOwners = isOwner === true;

  return WIZ_STEPS.filter((s) => {
    if (s.step === "coupleStatus") return showCoupleStatus;
    if (s.step === "owners") return showOwners;
    return true;
  });
}, [householdType, isOwner]);

const currentVisibleIdx = useMemo(() => visibleSteps.findIndex((s) => s.step === step), [visibleSteps, step]);

const goToStep = (next: Step) => {
  if (next === step) return;
  setStep(next);
  // UX: always scroll to top when changing step
  if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
};

const getNextVisibleStep = (): Step | null => {
  const idx = currentVisibleIdx;
  if (idx < 0) return null;
  return idx + 1 < visibleSteps.length ? visibleSteps[idx + 1].step : null;
};

const getPrevVisibleStep = (): Step | null => {
  const idx = currentVisibleIdx;
  if (idx < 0) return null;
  return idx - 1 >= 0 ? visibleSteps[idx - 1].step : null;
};

const resetStepData = (s: Step) => {
  // Reset only the local wizard state (doesn't touch DB stores).
  if (s === "situation") {
    setIsOwner(false);
    setOwners([]);
    setActiveAssetId(null);
    setOwnerModalStep(0);
    setOwnerEditingId(null);
    setOwnerDraft({ kind: "appartement", usage: "primary", ownerOccupant: true, loyerPercu: 0 });
    // also skip "owners" step implicitly
    markSkipped("owners");
  }
  if (s === "rentals") {
    setIsTenant(false);
    setRentals([]);
    setRentalsSubStep(1);
    setRentalModalStep(0);
    setRentalEditingId(null);
    setRentalDraft({ kind: "appartement", loyer: 0, charges: 0, eau: 0, elec: 0, gaz: 0, internet: 0, assurance: 0 });
  }
  if (s === "cars") {
    setHasCar(false);
    setCars([]);
    setCarsSubStep(1);
    setActiveCarId(null);
    setCarModalStep(0);
    setCarEditingId(null);
    setCarDraft({
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
  }
  if (s === "daily") {
    setDaily({});
  }
};

const goPrev = () => {
  // Handle internal sub-steps first
  if (step === "people" && peopleSubStep === 2) return setPeopleSubStep(1);
  if (step === "rentals" && rentalsSubStep === 2) return setRentalsSubStep(1);
  if (step === "cars" && carsSubStep === 2) return setCarsSubStep(1);

  const prev = getPrevVisibleStep();
  if (prev) goToStep(prev);
};

const goNext = () => {
  // Handle internal sub-steps first
  if (step === "people" && peopleSubStep === 1) return setPeopleSubStep(2);
  if (step === "rentals" && rentalsSubStep === 1 && isTenant === true) return setRentalsSubStep(2);
  if (step === "cars" && carsSubStep === 1 && hasCar === true) return setCarsSubStep(2);

  const next = getNextVisibleStep();
  if (next) goToStep(next);
};

// Convenience: apply a state update, then automatically move forward.
// Used for choice-only questions (Yes/No, single selection) to avoid extra taps.
const autoAdvanceToNextStep = (afterStateUpdate?: () => void) => {
  afterStateUpdate?.();
  // Give React a beat to render the selected state before navigating.
  window.setTimeout(() => {
    markCompleted(step);
    persistProfile();
    goNext();
  }, AUTO_ADVANCE_MS);
};

const autoAdvanceToSubStep = (setSubStep: (v: number) => void, v: number, afterStateUpdate?: () => void) => {
  afterStateUpdate?.();
  window.setTimeout(() => setSubStep(v), AUTO_ADVANCE_MS);
};

const skipStep = () => {
  resetStepData(step);
  markSkipped(step);
  persistProfile();
  goNext();
};
  // Centralized step renderer to avoid long chains of ternaries (more maintainable, fewer JSX syntax pitfalls).
  const renderStep = () => {
    switch (step) {
      
case "people": {
  const name1 = (draftPeople?.[0]?.name ?? "").trim();
  const name2 = (draftPeople?.[1]?.name ?? "").trim();
  const canContinueIdentity = householdType === "single"
    ? name1.length > 0
    : name1.length > 0 && name2.length > 0;

  const finishPeople = () => {
    const id = createFoyerWithPeople(
      (householdType === "couple" ? [name1, name2] : [name1]).map((n) => ({ name: n }))
    );
    setFoyerId(id);
    markCompleted("people");
    persistProfile();
    goNext();
  };

  return (
    <div className="wizardPanel" style={{ display: "grid", gap: 14 }}>
      {peopleSubStep === 1 ? (
        <>
          <div className="wizQuestion">Pour combien de personnes établissons-nous ce budget ?</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Une seule question par écran, pour aller vite.
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <ChoiceCard
              icon="👤"
              title="Une personne"
              subtitle="Budget individuel"
              selected={householdType === "single"}
              onClick={() => {
                autoAdvanceToSubStep(setPeopleSubStep, 2, () => {
                  setHouseholdType("single");
                  setDraftPeople((prev) => [{ ...(prev[0] ?? { name: "" }) }]);
                });
              }}
            />
            <ChoiceCard
              icon="👥"
              title="Deux personnes"
              subtitle="Budget de foyer"
              selected={householdType === "couple"}
              onClick={() => {
                autoAdvanceToSubStep(setPeopleSubStep, 2, () => {
                  setHouseholdType("couple");
                  setDraftPeople((prev) => {
                    const p1 = prev?.[0] ?? { name: "" };
                    const p2 = prev?.[1] ?? { name: "" };
                    return [p1, p2].slice(0, 2);
                  });
                });
              }}
            />
          </div>

          <div className="wizardNav wizBottomBar">
            <button className="btnSecondary" style={{ width: 140 }} onClick={() => router.push("/")}>
              Annuler
            </button>
            <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
              Touchez une carte pour continuer
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="wizQuestion">Enchanté ! Comment devons-nous vous appeler ?</div>
          <div className="muted" style={{ fontSize: 13 }}>Un prénom suffit.</div>

          <div style={{ display: "grid", gap: 12 }}>
            <label className="min0" style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Votre prénom</span>
              <input
                ref={name1Ref}
                className={`input ${name1.length > 0 && name1.length < 2 ? "inputInvalid" : ""}`}
                value={draftPeople?.[0]?.name ?? ""}
                maxLength={20}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  // Couple: Enter on first field moves to the second field.
                  if (householdType === "couple") {
                    name2Ref.current?.focus();
                    return;
                  }
                  if (canContinueIdentity) finishPeople();
                }}
                onChange={(e) =>
                  setDraftPeople((prev) => {
                    const next = [...prev];
                    next[0] = { ...(next[0] ?? { name: "" }), name: e.target.value };
                    return next;
                  })
                }
                placeholder="Votre prénom"
              />
            </label>

            {householdType === "couple" ? (
              <label className="min0" style={{ display: "grid", gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Prénom du conjoint</span>
                <input
                  ref={name2Ref}
                  className={`input ${name2.length > 0 && name2.length < 2 ? "inputInvalid" : ""}`}
                  value={draftPeople?.[1]?.name ?? ""}
                  maxLength={20}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (canContinueIdentity) finishPeople();
                    }
                  }}
                  onChange={(e) =>
                    setDraftPeople((prev) => {
                      const next = [...prev];
                      next[1] = { ...(next[1] ?? { name: "" }), name: e.target.value };
                      return next;
                    })
                  }
                  placeholder="Prénom du conjoint"
                />
              </label>
            ) : null}
          </div>

          <div className="wizardNav wizBottomBar">
            <button
              className="btnSecondary"
              style={{ width: 140 }}
              onClick={() => setPeopleSubStep(1)}
            >
              {"< Retour"}
            </button>

            <button
              className="btnPrimary"
              style={{ width: 140 }}
              disabled={!canContinueIdentity}
              onClick={finishPeople}
            >
              Continuer ›
            </button>
          </div>
        </>
      )}
    </div>
  );
}
case "coupleStatus":
        return (
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
                        goNext();
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
                      goPrev();
                    }}
                  >
                    {"< Retour"}
                  </button>
                  <div />
                </div>
              </div>
        );
      case "incomes":
        return (
              <div className="wizardPanel" style={{ display: "grid", gap: 12 }}>
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
                  <button className="btnSecondary" style={{ width: 140 }} onClick={() => goPrev()}>{"< Retour"}</button>
                  <button
                    className="btnPrimary"
                    style={{ width: 140 }}
                    onClick={() => {
                      markCompleted("incomes");
                      persistProfile();
                      goNext();
                    }}
                  >
                    Suivant ›
                  </button>
                </div>
              </div>
        );
      case "situation":
        return (
        <div className="wizardPanel" style={{ display: "grid", gap: 14 }}>
          <div className="wizQuestion">Possédez-vous des biens immobiliers ?</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Appartement, maison, studio… (vous pourrez en ajouter plusieurs)
          </div>

          <YesNoToggle
            value={isOwner}
            onChange={(v) => {
              // Auto-advance on choice to avoid extra "Continuer" taps.
              if (v === true) {
                autoAdvanceToNextStep(() => {
                  setIsOwner(true);
                });
              } else {
                autoAdvanceToNextStep(() => {
                  setIsOwner(false);
                  setOwners([]);
                  markSkipped("owners");
                });
              }
            }}
          />

          <div className="wizardNav wizBottomBar">
            <button className="btnSecondary" style={{ width: 140 }} onClick={() => goPrev()}>
              {"< Retour"}
            </button>
            <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
              Choisissez une option pour continuer
              <div>
                <button
                  type="button"
                  className="wizSkipLink"
                  onClick={() => {
                    setIsOwner(false);
                    skipStep();
                  }}
                >
                  Passer cette étape
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      
case "owners": {
  return (
    <div className="wizardPanel" style={{ display: "grid", gap: 14 }}>
      <div className="wizQuestion">Mes biens</div>
      <div className="muted" style={{ fontSize: 13 }}>
        Ajoutez vos logements pour estimer vos revenus/charges. Vous pouvez en ajouter plusieurs.
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {owners.length === 0 ? (
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 800 }}>Aucun bien ajouté</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Si vous n’avez pas de bien, vous pouvez passer cette étape.
            </div>
          </div>
        ) : (
          owners.map((o: any) => (
            <div key={o.id} className="card" style={{ padding: 12, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>
                  {(o.kind ?? "Bien").toString()} · {(o.ville ?? "Ville").toString()}
                </div>
                <div className="muted">{o.superficie ? `${o.superficie} m²` : ""}</div>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Loyer perçu : <span style={{ fontWeight: 800 }}>{fmtMoney(Number(o.loyerPercu ?? 0))}</span>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button
                  className="btnSecondary"
                  onClick={() => {
                    setOwnerEditingId(o.id);
                    setOwnerDraft({ ...(o as any) });
                    setOwnerModalStep(1);
                  }}
                >
                  Modifier
                </button>
                <button className="btnSecondary" onClick={() => setOwners((prev) => prev.filter((x) => x.id !== o.id))}>
                  Supprimer
                </button>
              </div>
            </div>
          ))
        )}

        <button
          className="btnSecondary"
          onClick={() => {
            setOwnerEditingId(null);
            setOwnerDraft({
              kind: "appartement",
              ville: "",
              superficie: undefined,
              occupant: activePeople.length > 1 ? "commun" : (activePeople[0]?.id ?? "commun"),
              loyerPercu: 0,
            } as any);
            setOwnerModalStep(1);
          }}
        >
          + Ajouter un appartement/maison
        </button>
      </div>

      {ownerModalStep === 1 ? (
        <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>{ownerEditingId ? "Modifier un bien" : "Ajouter un bien"}</div>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Type</span>
              <select
                className="input"
                value={(ownerDraft as any)?.kind ?? "appartement"}
                onChange={(e) => setOwnerDraft((p) => ({ ...(p as any), kind: e.target.value }))}
              >
                <option value="appartement">Appartement</option>
                <option value="maison">Maison</option>
                <option value="studio">Studio</option>
                <option value="autre">Autre</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Ville</span>
              <input
                className="input"
                value={(ownerDraft as any)?.ville ?? ""}
                onChange={(e) => setOwnerDraft((p) => ({ ...(p as any), ville: e.target.value }))}
                placeholder="Ex: Saint-Denis"
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Surface (m²)</span>
              <input
                className="input"
                inputMode="numeric"
                value={(ownerDraft as any)?.superficie ?? ""}
                onChange={(e) => setOwnerDraft((p) => ({ ...(p as any), superficie: num(e.target.value) }))}
                placeholder="Ex: 25"
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Propriétaire</span>
              <select
                className="input"
                value={(ownerDraft as any)?.occupant ?? (activePeople.length > 1 ? "commun" : (activePeople[0]?.id ?? "commun"))}
                onChange={(e) => setOwnerDraft((p) => ({ ...(p as any), occupant: e.target.value }))}
              >
                {activePeople.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                {activePeople.length > 1 ? <option value="commun">Commun</option> : null}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Loyer perçu (€/mois)</span>
              <input
                className="input"
                inputMode="numeric"
                value={(ownerDraft as any)?.loyerPercu ?? 0}
                onChange={(e) => setOwnerDraft((p) => ({ ...(p as any), loyerPercu: num(e.target.value) }))}
                placeholder="0"
              />
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <button className="btnSecondary" style={{ width: 140 }} onClick={() => { setOwnerModalStep(0); setOwnerEditingId(null); }}>
              Annuler
            </button>
            <button
              className="btnPrimary"
              style={{ width: 160 }}
              onClick={() => {
                const d: any = ownerDraft ?? {};
                if (ownerEditingId) {
                  setOwners((prev) => prev.map((x: any) => (x.id === ownerEditingId ? ({ ...x, ...d } as any) : x)));
                } else {
                  const id = uid("o");
                  const row: any = {
                    id,
                    kind: d.kind ?? "appartement",
                    ville: String(d.ville ?? ""),
                    superficie: d.superficie,
                    occupant: d.occupant ?? (activePeople.length > 1 ? "commun" : (activePeople[0]?.id ?? "commun")),
                    ownerOccupant: false,
                    loyerPercu: Number(d.loyerPercu ?? 0),
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
                }
                setOwnerModalStep(0);
                setOwnerEditingId(null);
              }}
            >
              Enregistrer
            </button>
          </div>
        </div>
      ) : null}

      <div className="wizardNav wizBottomBar">
        <button className="btnSecondary" style={{ width: 140 }} onClick={() => goPrev()}>
          {"< Retour"}
        </button>
        <button
          className="btnPrimary"
          style={{ width: 140 }}
          onClick={() => {
            markCompleted("owners");
            persistProfile();
            goNext();
          }}
        >
          Continuer ›
        </button>
      </div>

      <button type="button" className="wizSkipLink" onClick={() => skipStep()}>
        Passer cette étape
      </button>
    </div>
  );
}

case "rentals": {
  // One-question-per-screen subflow:
  //  - substep 1: yes/no
  //  - substep 2: list + add/edit items (multi-locations)
  const openNewRental = () => {
    setRentalEditingId(null);
    setRentalDraft({
      kind: "appartement",
      ville: "",
      superficie: undefined,
      occupant: activePeople.length > 1 ? "commun" : (activePeople[0]?.id ?? "commun"),
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
    });
    setRentalModalStep(1);
  };

  const openEditRental = (id: string) => {
    const row = rentals.find((r) => r.id === id);
    if (!row) return;
    setRentalEditingId(id);
    setRentalDraft({ ...row });
    setRentalModalStep(1);
  };

  const saveRental = () => {
    const d: any = rentalDraft ?? {};
    const base: RentalRow = {
      id: rentalEditingId ?? uid("r"),
      kind: (d.kind ?? "appartement") as any,
      ville: String(d.ville ?? ""),
      superficie: d.superficie,
      occupant: (d.occupant ?? (activePeople.length > 1 ? "commun" : (activePeople[0]?.id ?? "commun"))) as any,
      loyer: Number(d.loyer ?? 0),
      charges: Number(d.charges ?? 0),
      eau: Number(d.eau ?? 0),
      elec: Number(d.elec ?? 0),
      gaz: Number(d.gaz ?? 0),
      internet: Number(d.internet ?? 0),
      assurance: Number(d.assurance ?? 0),
      customCharges: Array.isArray(d.customCharges) ? d.customCharges : [],
      customAbonnements: Array.isArray(d.customAbonnements) ? d.customAbonnements : [],
      customAutres: Array.isArray(d.customAutres) ? d.customAutres : [],
    };

    setRentals((prev) => {
      const exists = prev.some((x) => x.id === base.id);
      return exists ? prev.map((x) => (x.id === base.id ? base : x)) : [...prev, base];
    });
    setRentalModalStep(0);
    setRentalEditingId(null);
  };

  const removeRental = (id: string) => setRentals((prev) => prev.filter((r) => r.id !== id));

  const duplicateRental = (id: string) => {
    const row = rentals.find((r) => r.id === id);
    if (!row) return;
    const newId = uid("r");
    const copy: RentalRow = {
      ...row,
      id: newId,
      ville: row.ville ? `${row.ville} (copie)` : "",
    };
    // Add the copy and immediately open it for editing (common UX intent).
    setRentals((prev) => [...prev, copy]);
    setRentalEditingId(newId);
    setRentalDraft({ ...copy });
    setRentalModalStep(1);
  };

  const totalRentals = rentals.reduce(
    (acc, r) => acc + (r.loyer ?? 0) + (r.charges ?? 0) + (r.eau ?? 0) + (r.elec ?? 0) + (r.gaz ?? 0) + (r.internet ?? 0) + (r.assurance ?? 0),
    0
  );

  if (rentalsSubStep === 1) {
    return (
      <div className="wizardPanel" style={{ display: "grid", gap: 14 }}>
        <div className="wizQuestion">Êtes-vous actuellement locataire ?</div>
        <div className="muted" style={{ fontSize: 13 }}>
          Si oui, vous pouvez ajouter un ou plusieurs logements (ex: résidence principale + studio temporaire).
        </div>

        <YesNoToggle
          value={isTenant}
          onChange={(v) => {
            // Auto-advance: yes -> open list, no -> next step.
            if (v === true) {
              autoAdvanceToSubStep(setRentalsSubStep, 2, () => {
                setIsTenant(true);
              });
            } else {
              autoAdvanceToNextStep(() => {
                setIsTenant(false);
                setRentals([]);
                setRentalsSubStep(1);
              });
            }
          }}
        />

        <div className="wizardNav wizBottomBar">
          <button className="btnSecondary" style={{ width: 140 }} onClick={() => goPrev()}>
            {"< Retour"}
          </button>
          <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
            Choisissez une option pour continuer
            <div>
              <button
                type="button"
                className="wizSkipLink"
                onClick={() => {
                  setIsTenant(false);
                  setRentals([]);
                  skipStep();
                }}
              >
                Passer cette étape
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // rentalsSubStep === 2
  return (
    <div className="wizardPanel" style={{ display: "grid", gap: 14 }}>
      <div className="wizQuestion">Votre / vos logements</div>
      <div className="muted" style={{ fontSize: 13 }}>
        Total estimé (loyer + charges + utilités) : <b>{fmtMoney(totalRentals)}</b>/mois
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>Mes locations</div>
        <button className="btnSecondary" onClick={openNewRental}>+ Ajouter</button>
      </div>

      {rentals.length === 0 ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Aucun logement ajouté</div>
          <div className="muted" style={{ fontSize: 13 }}>Ajoute au moins ton logement principal, ou passe.</div>
          <div style={{ height: 10 }} />
          <button className="btnPrimary" onClick={openNewRental}>+ Ajouter un logement</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rentals.map((r) => (
            <div key={r.id} className="card" style={{ padding: 12, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <div style={{ fontWeight: 900 }}>{r.ville || "(Ville)"} · {r.kind}</div>
                <div className="muted" style={{ fontSize: 12 }}>{fmtMoney((r.loyer ?? 0) + (r.charges ?? 0))}/mois</div>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Loyer {fmtMoney(r.loyer ?? 0)} · Charges {fmtMoney(r.charges ?? 0)}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btnSecondary" onClick={() => duplicateRental(r.id)}>Dupliquer</button>
                <button className="btnSecondary" onClick={() => openEditRental(r.id)}>Modifier</button>
                <button className="btnSecondary" onClick={() => removeRental(r.id)}>Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rentalModalStep === 1 ? (
        <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>{rentalEditingId ? "Modifier un logement" : "Ajouter un logement"}</div>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Type</span>
              <select className="input" value={(rentalDraft as any)?.kind ?? "appartement"} onChange={(e) => setRentalDraft((p) => ({ ...(p as any), kind: e.target.value }))}>
                <option value="appartement">Appartement</option>
                <option value="maison">Maison</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Ville</span>
              <input className="input" value={(rentalDraft as any)?.ville ?? ""} onChange={(e) => setRentalDraft((p) => ({ ...(p as any), ville: e.target.value }))} placeholder="Ex: Saint-Denis" />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Surface (m²)</span>
              <input className="input" inputMode="numeric" value={(rentalDraft as any)?.superficie ?? ""} onChange={(e) => setRentalDraft((p) => ({ ...(p as any), superficie: num(e.target.value) }))} placeholder="Ex: 25" />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Titulaire</span>
              <select className="input" value={(rentalDraft as any)?.occupant ?? (activePeople.length > 1 ? "commun" : (activePeople[0]?.id ?? "commun"))} onChange={(e) => setRentalDraft((p) => ({ ...(p as any), occupant: e.target.value }))}>
                {activePeople.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                {activePeople.length > 1 ? <option value="commun">Commun</option> : null}
              </select>
            </label>

            <CurrencyField label="Loyer payé" value={(rentalDraft as any)?.loyer ?? 0} onChange={(v) => setRentalDraft((p) => ({ ...(p as any), loyer: v }))} />
            <CurrencyField label="Charges" value={(rentalDraft as any)?.charges ?? 0} onChange={(v) => setRentalDraft((p) => ({ ...(p as any), charges: v }))} />
            <CurrencyField label="Eau" value={(rentalDraft as any)?.eau ?? 0} onChange={(v) => setRentalDraft((p) => ({ ...(p as any), eau: v }))} />
            <CurrencyField label="Électricité" value={(rentalDraft as any)?.elec ?? 0} onChange={(v) => setRentalDraft((p) => ({ ...(p as any), elec: v }))} />
            <CurrencyField label="Gaz" value={(rentalDraft as any)?.gaz ?? 0} onChange={(v) => setRentalDraft((p) => ({ ...(p as any), gaz: v }))} />
            <CurrencyField label="Internet" value={(rentalDraft as any)?.internet ?? 0} onChange={(v) => setRentalDraft((p) => ({ ...(p as any), internet: v }))} />
            <CurrencyField
              label="Assurance habitation"
              value={(rentalDraft as any)?.assurance ?? 0}
              onChange={(v) => setRentalDraft((p) => ({ ...(p as any), assurance: v }))}
              onEnter={saveRental}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <button className="btnSecondary" style={{ width: 140 }} onClick={() => { setRentalModalStep(0); setRentalEditingId(null); }}>
              Annuler
            </button>
            <button className="btnPrimary" style={{ width: 160 }} onClick={saveRental}>
              Enregistrer
            </button>
          </div>
        </div>
      ) : null}

      <div className="wizardNav wizBottomBar">
        <button className="btnSecondary" style={{ width: 140 }} onClick={() => goPrev()}>
          {"< Retour"}
        </button>
        <button
          className="btnPrimary"
          style={{ width: 140 }}
          onClick={() => {
            markCompleted("rentals");
            persistProfile();
            goNext();
          }}
        >
          Continuer ›
        </button>
      </div>

      <button type="button" className="wizSkipLink" onClick={() => { setIsTenant(false); setRentals([]); skipStep(); }}>
        Passer cette étape
      </button>
    </div>
  );
}

case "cars": {
  const openNewCar = () => {
    setCarEditingId(null);
    setCarDraft({
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
    setCarModalStep(1);
  };

  const openEditCar = (id: string) => {
    const row = cars.find((c) => c.id === id);
    if (!row) return;
    setCarEditingId(id);
    setCarDraft({ ...row });
    setCarModalStep(1);
  };

  const saveCar = () => {
    const d: any = carDraft ?? {};
    const base: CarRow = {
      id: carEditingId ?? uid("car"),
      label: String(d.label ?? "Voiture"),
      ownerKey: String(d.ownerKey ?? "both"),
      assurance: Number(d.assurance ?? 0),
      carburant: Number(d.carburant ?? 0),
      entretien: Number(d.entretien ?? 0),
      credit: Number(d.credit ?? 0),
      parking: Number(d.parking ?? 0),
      peage: Number(d.peage ?? 0),
      customMonthly: Array.isArray(d.customMonthly) ? d.customMonthly : [],
    };
    setCars((prev) => {
      const exists = prev.some((x) => x.id === base.id);
      return exists ? prev.map((x) => (x.id === base.id ? base : x)) : [...prev, base];
    });
    setCarModalStep(0);
    setCarEditingId(null);
  };

  const removeCar = (id: string) => setCars((prev) => prev.filter((c) => c.id !== id));

  const duplicateCar = (id: string) => {
    const row = cars.find((c) => c.id === id);
    if (!row) return;
    const newId = uid("car");
    const copy: CarRow = {
      ...row,
      id: newId,
      label: row.label ? `${row.label} (copie)` : "Voiture (copie)",
    };
    setCars((prev) => [...prev, copy]);
    // Open the duplicated vehicle for quick tweaks.
    setCarEditingId(newId);
    setCarDraft({ ...copy });
    setCarModalStep(1);
  };

  const totalCars = cars.reduce((acc, c) => acc + c.assurance + c.carburant + c.entretien + c.credit + c.parking + c.peage, 0);

  if (carsSubStep === 1) {
    return (
      <div className="wizardPanel" style={{ display: "grid", gap: 14 }}>
        <div className="wizQuestion">Possédez-vous des voitures ?</div>
        <div className="muted" style={{ fontSize: 13 }}>Si oui, vous pourrez en ajouter une ou plusieurs.</div>

        <YesNoToggle
          value={hasCar}
          onChange={(v) => {
            // Auto-advance: yes -> open list, no -> next step.
            if (v === true) {
              autoAdvanceToSubStep(setCarsSubStep, 2, () => {
                setHasCar(true);
              });
            } else {
              autoAdvanceToNextStep(() => {
                setHasCar(false);
                setCars([]);
                setCarsSubStep(1);
              });
            }
          }}
        />

        <div className="wizardNav wizBottomBar">
          <button className="btnSecondary" style={{ width: 140 }} onClick={() => goPrev()}>
            {"< Retour"}
          </button>
          <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
            Choisissez une option pour continuer
            <div>
              <button type="button" className="wizSkipLink" onClick={() => { setHasCar(false); setCars([]); skipStep(); }}>
                Passer cette étape
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // carsSubStep === 2
  return (
    <div className="wizardPanel" style={{ display: "grid", gap: 14 }}>
      <div className="wizQuestion">Vos véhicules</div>
      <div className="muted" style={{ fontSize: 13 }}>
        Total estimé : <b>{fmtMoney(totalCars)}</b>/mois
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>Mes voitures</div>
        <button className="btnSecondary" onClick={openNewCar}>+ Ajouter</button>
      </div>

      {cars.length === 0 ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Aucune voiture ajoutée</div>
          <div className="muted" style={{ fontSize: 13 }}>Ajoute ta voiture principale, ou passe.</div>
          <div style={{ height: 10 }} />
          <button className="btnPrimary" onClick={openNewCar}>+ Ajouter une voiture</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {cars.map((c) => (
            <div key={c.id} className="card" style={{ padding: 12, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontWeight: 900 }}>{c.label || "Voiture"}</div>
                <div className="muted" style={{ fontSize: 12 }}>{fmtMoney(c.assurance + c.carburant + c.entretien + c.credit + c.parking + c.peage)}/mois</div>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Assurance {fmtMoney(c.assurance)} · Carburant {fmtMoney(c.carburant)} · Entretien {fmtMoney(c.entretien)} · Crédit {fmtMoney(c.credit)}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btnSecondary" onClick={() => duplicateCar(c.id)}>Dupliquer</button>
                <button className="btnSecondary" onClick={() => openEditCar(c.id)}>Modifier</button>
                <button className="btnSecondary" onClick={() => removeCar(c.id)}>Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {carModalStep === 1 ? (
        <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>{carEditingId ? "Modifier un véhicule" : "Ajouter un véhicule"}</div>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Nom</span>
              <input className="input" value={(carDraft as any)?.label ?? ""} onChange={(e) => setCarDraft((p) => ({ ...(p as any), label: e.target.value }))} placeholder="Ex: Clio 5" />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Titulaire</span>
              <select className="input" value={(carDraft as any)?.ownerKey ?? "both"} onChange={(e) => setCarDraft((p) => ({ ...(p as any), ownerKey: e.target.value }))}>
                <option value="both">Commun</option>
                {activePeople.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </label>

            <CurrencyField label="Assurance" value={(carDraft as any)?.assurance ?? 0} onChange={(v) => setCarDraft((p) => ({ ...(p as any), assurance: v }))} />
            <CurrencyField label="Essence" value={(carDraft as any)?.carburant ?? 0} onChange={(v) => setCarDraft((p) => ({ ...(p as any), carburant: v }))} />
            <CurrencyField label="Entretien" value={(carDraft as any)?.entretien ?? 0} onChange={(v) => setCarDraft((p) => ({ ...(p as any), entretien: v }))} />
            <CurrencyField
              label="Crédit auto"
              value={(carDraft as any)?.credit ?? 0}
              onChange={(v) => setCarDraft((p) => ({ ...(p as any), credit: v }))}
              onEnter={saveCar}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <button className="btnSecondary" style={{ width: 140 }} onClick={() => { setCarModalStep(0); setCarEditingId(null); }}>
              Annuler
            </button>
            <button className="btnPrimary" style={{ width: 160 }} onClick={saveCar}>
              Enregistrer
            </button>
          </div>
        </div>
      ) : null}

      <div className="wizardNav wizBottomBar">
        <button className="btnSecondary" style={{ width: 140 }} onClick={() => goPrev()}>
          {"< Retour"}
        </button>
        <button
          className="btnPrimary"
          style={{ width: 140 }}
          onClick={() => {
            markCompleted("cars");
            persistProfile();
            goNext();
          }}
        >
          Continuer ›
        </button>
      </div>

      <button type="button" className="wizSkipLink" onClick={() => { setHasCar(false); setCars([]); skipStep(); }}>
        Passer cette étape
      </button>
    </div>
  );
}

case "daily": {
  const courses = Number((daily as any)?.courses ?? 0);
  const loisirs = Number((daily as any)?.loisirs ?? 0);
  const sante = Number((daily as any)?.sante ?? 0);
  const total = courses + loisirs + sante;

  const setDailyField = (k: string, v: number) => setDaily((prev: any) => ({ ...(prev ?? {}), [k]: v }));

  const DAILY_PRESETS: Array<{ key: "small" | "medium" | "large"; label: string; hint: string; v: { courses: number; loisirs: number; sante: number } }> = [
    { key: "small", label: "Petit", hint: "Serré", v: { courses: 350, loisirs: 150, sante: 80 } },
    { key: "medium", label: "Moyen", hint: "Équilibré", v: { courses: 600, loisirs: 300, sante: 120 } },
    { key: "large", label: "Large", hint: "Confort", v: { courses: 900, loisirs: 500, sante: 200 } },
  ];

  const applyPresetAndContinue = (key: "small" | "medium" | "large") => {
    const p = DAILY_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setDaily(p.v);
    setDailyPresetUsed(key);
    setDailyInteracted(false);
    // UX: let selection be visible briefly before navigating.
    setTimeout(() => {
      markCompleted("daily");
      persistProfile();
      goNext();
    }, 180);
  };

  return (
    <div className="wizardPanel" style={{ display: "grid", gap: 14 }}>
      <div className="wizQuestion">Estimons vos dépenses courantes par mois.</div>
      <div className="muted" style={{ fontSize: 13 }}>Ajustez rapidement, vous affinerez ensuite.</div>

      {/* Quick presets (tap = auto-next). */}
      <div className="wizChips" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {DAILY_PRESETS.map((p) => {
          const active = dailyPresetUsed === p.key;
          return (
            <button
              key={p.key}
              type="button"
              className={`wizChip ${active ? "isActive" : ""}`}
              onClick={() => applyPresetAndContinue(p.key)}
              title={`${p.label} — ${p.hint}`}
            >
              <span style={{ fontWeight: 900 }}>{p.label}</span>
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{p.hint}</span>
            </button>
          );
        })}

        <button
          type="button"
          className={`wizChip ${dailyInteracted ? "isActive" : ""}`}
          onClick={() => setDailyInteracted(true)}
          title="Ajuster manuellement"
        >
          <span style={{ fontWeight: 900 }}>Personnalisé</span>
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>Ajuster</span>
        </button>
      </div>

      {[
        { k: "courses", label: "Courses", sub: "Alimentation, hygiène", max: 1500, val: courses },
        { k: "loisirs", label: "Loisirs", sub: "Sorties, abonnements, sport", max: 1500, val: loisirs },
        { k: "sante", label: "Santé", sub: "Mutuelle, pharmacie", max: 800, val: sante },
      ].map((s) => (
        <div key={s.k} className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 900 }}>{s.label}</div>
              <div className="muted" style={{ fontSize: 13 }}>{s.sub}</div>
            </div>
            <div style={{ fontWeight: 900 }}>{fmtMoney(s.val)}</div>
          </div>

          <input
            type="range"
            min={0}
            max={s.max}
            step={10}
            value={s.val}
            onChange={(e) => {
              setDailyInteracted(true);
              setDailyPresetUsed(null);
              setDailyField(s.k, num(e.target.value));
            }}
          />
        </div>
      ))}

      <div className="card" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="muted">Total estimé</div>
        <div style={{ fontWeight: 900, fontSize: 18 }}>{fmtMoney(total)}</div>
      </div>

      <div className="wizardNav wizBottomBar">
        <button className="btnSecondary" style={{ width: 140 }} onClick={() => goPrev()}>
          {"< Retour"}
        </button>
        {dailyInteracted ? (
          <button
            className="btnPrimary"
            style={{ width: 140 }}
            onClick={() => {
              markCompleted("daily");
              persistProfile();
              goNext();
            }}
          >
            OK ›
          </button>
        ) : total > 0 ? (
          <button
            className="btnPrimary"
            style={{ width: 140 }}
            onClick={() => {
              markCompleted("daily");
              persistProfile();
              goNext();
            }}
          >
            Continuer ›
          </button>
        ) : (
          <div className="muted" style={{ fontSize: 12, alignSelf: "center", textAlign: "right" }}>
            Choisissez un preset ou passez l’étape.
          </div>
        )}
      </div>

      <button type="button" className="wizSkipLink" onClick={() => skipStep()}>
        Passer cette étape
      </button>
    </div>
  );
}

case "summary": {
  return (
    <div className="wizardPanel" style={{ display: "grid", gap: 14 }}>
      <div className="wizQuestion">Parfait, on a tout !</div>
      <div className="muted" style={{ fontSize: 13 }}>
        Vous pourrez modifier ces informations à tout moment dans votre budget.
      </div>

      <div className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <div><b>Foyer</b> : {activePeople.map((p) => p.name).join(" & ") || "—"}</div>
        <div><b>Biens</b> : {owners.length}</div>
        <div><b>Locataire</b> : {isTenant ? "Oui" : "Non"}</div>
        <div><b>Voiture</b> : {hasCar ? "Oui" : "Non"}</div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btnSecondary" onClick={() => goPrev()}>{"< Retour"}</button>
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
      </div>

      <button className="btnSecondary" onClick={() => router.push("/")}>Retour à l’accueil</button>
    </div>
  );
}
default:
        return null;
    }
  };
  return (
    <>
      <div className="wizardWrap">
        <div className="wizardCrumbSpacer" />
        <div className="wizardLayout">
          {/* Sidebar */}
          <div className="card wizardSidebarCard" style={{ padding: 14 }}>
            <div className="wizardSidebarTitle">Création d’un foyer</div>
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
                    <span className="wizStepIdx" aria-hidden="true">{idx + 1}</span>
                    <span className={`wizStepIcon ${current ? "isActive" : ""}`} aria-hidden="true"><StepIcon step={s.step} /></span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.label}
                    </span>
                    <span className="wizStepMeta" aria-hidden="true">
                      {done ? "✓" : skipped ? "—" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className="card wizardContentCard" style={{ padding: 14, display: "grid", gap: 12 }}>
            <WizardTopProgress
              current={Math.max(1, visibleSteps.findIndex((s) => s.step === step) + 1)}
              total={Math.max(1, visibleSteps.length)}
              label={stepTitle(step)}
            />
            <div key={step} className={`wizardStepAnim ${stepAnimDir === "next" ? "animNext" : "animPrev"}`}>

                    {renderStep()}

            </div>
          </div>
        </div>
      </div>
    </>
  );
}