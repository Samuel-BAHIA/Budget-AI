"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUsers } from "@/components/user/UserProvider";
import { useExpenses, useRevenus } from "@/components/data/flowsStore";
import { useAssets, useRentals } from "@/components/data/estateStore";

type Step = 1 | 2 | 3 | 4;
type FlowType = "rental" | "property" | "car" | "unitExpense" | "income";
type ExpenseCategory = "fixes" | "variables";

type AssetDraft = {
  flowType: Exclude<FlowType, "unitExpense" | "income">;
  city?: string;
  surfaceM2?: string;
  name: string; // computed
};

type LineDraft = {
  id: string;
  label: string;
  amount: string;
  cat: ExpenseCategory;
  /** expense = goes to dépenses, income = goes to revenus (useful for assets like rentals) */
  kind?: "expense" | "income";
  readonly?: boolean;
};

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function parseAmount(v: string) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}


function norm(s: string) {
  return (s ?? "").trim().toLowerCase();
}

// Map wizard labels to estate default labels so we can update locked default lines correctly.
function mapWizardLabelToEstate(flowType: FlowType, label: string) {
  const l = norm(label);

  if (flowType === "property") {
    if (l === norm("Crédit immobilier")) return "Crédit";
    if (l === norm("Charges copropriété")) return "Charges (copropriété)";
    if (l === norm("Assurance habitation")) return "Assurance";
    if (l === norm("Travaux / Entretien")) return "Entretien / Travaux";
  }

  if (flowType === "rental") {
    // In estate defaults it's "Charges" (not "Charges copropriété")
    if (l === norm("Charges copropriété")) return "Charges";
  }

  return label.trim();
}
function prettyIcon(type: FlowType) {
  switch (type) {
    case "rental":
      return "🏠";
    case "property":
      return "🏡";
    case "car":
      return "🚗";
    case "unitExpense":
      return "💸";
    case "income":
      return "💰";
  }
}

function typeLabel(type: FlowType) {
  switch (type) {
    case "rental":
      return "Location";
    case "property":
      return "Propriété";
    case "car":
      return "Voiture";
    case "unitExpense":
      return "Dépense unitaire";
    case "income":
      return "Revenu";
  }
}

function defaultLinesForAsset(type: AssetDraft["flowType"]): LineDraft[] {
  const mkExpense = (label: string, cat: ExpenseCategory = "fixes"): LineDraft => ({
    id: uid("l"),
    label,
    amount: "",
    cat,
    kind: "expense",
    readonly: true,
  });

  const mkIncome = (label: string): LineDraft => ({
    id: uid("l"),
    label,
    amount: "",
    cat: "fixes",
    kind: "income",
    readonly: true,
  });

  if (type === "rental") {
    return [
      // Income first so it's visually clear this is a revenue.
      mkIncome("Loyer perçu"),
      mkExpense("Loyer", "fixes"),
      mkExpense("Eau", "fixes"),
      mkExpense("Électricité", "fixes"),
      mkExpense("Gaz", "fixes"),
      mkExpense("Internet", "fixes"),
      mkExpense("Assurance habitation", "fixes"),
    ];
  }
  if (type === "property") {
    return [
      mkIncome("Loyer perçu"),
      mkExpense("Crédit immobilier", "fixes"),
      mkExpense("Charges copropriété", "fixes"),
      mkExpense("Taxe foncière", "fixes"),
      mkExpense("Assurance habitation", "fixes"),
      mkExpense("Travaux / Entretien", "variables"),
    ];
  }
  // car
  return [
    mkExpense("Crédit voiture", "fixes"),
    mkExpense("Assurance voiture", "fixes"),
    mkExpense("Carburant", "variables"),
    mkExpense("Entretien", "variables"),
    mkExpense("Parking", "fixes"),
  ];
}

export default function AddFlowWizard({
  open,
  onClose,
  initialFlowType,
}: {
  open: boolean;
  onClose: () => void;
  /** If provided, skips step 1 and starts directly on the selected type */
  initialFlowType?: FlowType;
}) {
  const { activeFoyerId, activePeople } = useUsers();
  const revenus = useRevenus();
  const assetsApi = useAssets();
  const rentalsApi = useRentals();
  const depFixes = useExpenses("fixes");
  const depVars = useExpenses("variables");

  const hasMultiplePeople = (activePeople?.length ?? 0) > 1;

  const [mounted, setMounted] = useState(false);

const [pendingEstateSync, setPendingEstateSync] = useState<
  | null
  | {
      kind: "asset" | "rental";
      id: string;
      flowType: FlowType;
      lines: LineDraft[];
    }
>(null);

useEffect(() => {
  if (!pendingEstateSync) return;

  // Apply amounts to the freshly created estate object once it exists in hook state.
  if (pendingEstateSync.kind === "asset") {
    const a = assetsApi.assets.find((x) => x.id === pendingEstateSync.id);
    if (!a) return;

    for (const ln of pendingEstateSync.lines) {
      const amt = parseAmount(ln.amount);
      if (!Number.isFinite(amt)) continue;
      const targetLabel = mapWizardLabelToEstate(pendingEstateSync.flowType, ln.label);
      const lnorm = norm(targetLabel);

      if (ln.kind === "income") {
        const hit = (a.incomes ?? []).find((x) => norm(x.label) === lnorm);
        if (hit) assetsApi.updateAssetLine(a.id, "income", hit.id, { amount: amt });
      } else {
        const hit = (a.expenses ?? []).find((x) => norm(x.label) === lnorm);
        if (hit) assetsApi.updateAssetLine(a.id, "expense", hit.id, { amount: amt });
      }
    }

    setPendingEstateSync(null);
    return;
  }

  // rental
  const r = rentalsApi.rentals.find((x) => x.id === pendingEstateSync.id);
  if (!r) return;

  for (const ln of pendingEstateSync.lines) {
    if (ln.kind === "income") continue; // rentals don't hold incomes in the estate model
    const amt = parseAmount(ln.amount);
    if (!Number.isFinite(amt)) continue;

    const targetLabel = mapWizardLabelToEstate(pendingEstateSync.flowType, ln.label);
    const lnorm = norm(targetLabel);

    const hit = (r.expenses ?? []).find((x) => norm(x.label) === lnorm);
    if (hit) rentalsApi.updateRentalExpense(r.id, hit.id, { amount: amt });
  }

  setPendingEstateSync(null);
}, [pendingEstateSync, assetsApi.assets, rentalsApi.rentals]);

  useEffect(() => setMounted(true), []);

  // Robust sliding: use pixels instead of %.
  // NOTE: we intentionally measure only when opening (and on window resize)
  // to avoid triggering re-measures/re-renders while typing (which can steal focus
  // in some browsers when transforms update).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [viewportW, setViewportW] = useState<number>(0);

  useLayoutEffect(() => {
    if (!open) return;
    const el = bodyRef.current;
    if (!el) return;

    const update = () => {
      // clientWidth is stable (it ignores scrollbars in most browsers)
      const w = el.clientWidth;
      setViewportW(Math.max(0, Math.floor(w)));
    };

    // Measure after mount/layout
    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const [step, setStep] = useState<Step>(1);

  const [flowType, setFlowType] = useState<FlowType | null>(null);
  const [expenseCat, setExpenseCat] = useState<ExpenseCategory>("variables");
  const [name, setName] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [surface, setSurface] = useState<string>("");

  const [ownerKind, setOwnerKind] = useState<"foyer" | "person">("foyer");
  const [ownerPersonId, setOwnerPersonId] = useState<string>(activePeople?.[0]?.id ?? "");

  const [amountSingle, setAmountSingle] = useState<string>("");
  const [assetLines, setAssetLines] = useState<LineDraft[]>([]);

  // Reset each time we open
  useEffect(() => {
    if (!open) return;
    setExpenseCat("variables");
    setName("");
    setCity("");
    setSurface("");
    setOwnerKind("foyer");
    setOwnerPersonId(activePeople?.[0]?.id ?? "");
    setAmountSingle("");

    // Reset asset lines first, then apply defaults when needed.
    setAssetLines([]);

    if (initialFlowType) {
      // When the wizard is opened with a preselected type (ex: from the mobile FAB),
      // mimic the exact behavior of selecting that type from step 1.
      setFlowType(initialFlowType);

      if (initialFlowType === "rental" || initialFlowType === "property" || initialFlowType === "car") {
        setAssetLines(defaultLinesForAsset(initialFlowType));
      }

      // Car normally skips the "Détails" step.
      if (initialFlowType === "car") {
        setStep(hasMultiplePeople ? 3 : 4);
      } else {
        setStep(2);
      }
    } else {
      setStep(1);
      setFlowType(null);
    }
  }, [open, initialFlowType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep ownerPersonId valid
  useEffect(() => {
    const first = activePeople?.[0]?.id ?? "";
    if (!ownerPersonId) setOwnerPersonId(first);
    else if (!(activePeople ?? []).some((p) => p.id === ownerPersonId)) setOwnerPersonId(first);
  }, [activePeople]); // eslint-disable-line react-hooks/exhaustive-deps

  const computedAssetName = useMemo(() => {
    if (!flowType || flowType === "unitExpense" || flowType === "income") return "";

    // Car: no details screen, name is always auto-generated.
    if (flowType === "car") {
      return `Voiture ${Math.floor(Math.random() * 90 + 10)}`;
    }

    const m2 = String(surface ?? "").trim();
    const c = String(city ?? "").trim();
    if (c && m2) return `app ${c} ${m2}m²`;
    if (c) return `app ${c}`;
    // generic
    return `app ${Math.floor(Math.random() * 90 + 10)}`;
  }, [flowType, city, surface]);

  const goStep = (next: Step) => setStep(next);

  const canContinueStep2 = useMemo(() => {
    if (!flowType) return false;
    // unitExpense / income require a name
    if (flowType === "unitExpense" || flowType === "income") return name.trim().length > 0;
    // assets: can skip city/surface
    return true;
  }, [flowType, name]);

  const effectiveOwner = useMemo(() => {
    if (!hasMultiplePeople) return { kind: "person" as const, personId: activePeople?.[0]?.id ?? "" };
    if (ownerKind === "foyer") return { kind: "foyer" as const, personId: "" };
    return { kind: "person" as const, personId: ownerPersonId };
  }, [hasMultiplePeople, ownerKind, ownerPersonId, activePeople]);

  const saveAll = () => {
    if (!flowType) return;

    // single flow
    if (flowType === "unitExpense") {
      const amt = parseAmount(amountSingle);
      if (!Number.isFinite(amt)) return;
      const label = name.trim();
      if (!label) return;

      const targetStore = expenseCat === "fixes" ? depFixes : depVars;
      if (effectiveOwner.kind === "foyer") targetStore.add(label, amt, { kind: "foyer" });
      else targetStore.add(label, amt, { kind: "person", ownerId: effectiveOwner.personId });
      onClose();
      return;
    }

    if (flowType === "income") {
      const amt = parseAmount(amountSingle);
      if (!Number.isFinite(amt)) return;
      const label = name.trim();
      if (!label) return;
      if (effectiveOwner.kind === "foyer") revenus.add(label, amt, { kind: "foyer" });
      else revenus.add(label, amt, { kind: "person", ownerId: effectiveOwner.personId });
      onClose();
      return;
    }

    // Asset: create multiple lines (expenses + optional incomes)
    const assetName = computedAssetName || `app ${Math.floor(Math.random() * 90 + 10)}`;
    const prefix = `${assetName} — `;

    for (const ln of assetLines) {
      const lbl = ln.label.trim();
      const amt = parseAmount(ln.amount);
      if (!lbl) continue;
      if (!Number.isFinite(amt) || amt === 0) continue;
      const fullLabel = `${prefix}${lbl}`;

      // Income lines go to revenus; expense lines go to the right expense store.
      if (ln.kind === "income") {
        if (effectiveOwner.kind === "foyer") revenus.add(fullLabel, amt, { kind: "foyer" });
        else revenus.add(fullLabel, amt, { kind: "person", ownerId: effectiveOwner.personId });
      } else {
        const targetStore = ln.cat === "fixes" ? depFixes : depVars;
        if (effectiveOwner.kind === "foyer") targetStore.add(fullLabel, amt, { kind: "foyer" });
        else targetStore.add(fullLabel, amt, { kind: "person", ownerId: effectiveOwner.personId });
      }
    }

    
// Also create the matching "estate object" so Rentals/Assets pages show it as a real object.
// (Before: the wizard only created flow lines, which made the apartment invisible in the estate section.)
const attachTarget =
  effectiveOwner.kind === "foyer" ? { ownerKind: "foyer" as const } : { ownerKind: "person" as const, personId: effectiveOwner.personId };

if (flowType === "property") {
  const createdId = assetsApi.addAsset(assetName, attachTarget);
  if (createdId) setPendingEstateSync({ kind: "asset", id: createdId, flowType, lines: assetLines });
} else if (flowType === "rental") {
  const createdId = rentalsApi.addRental(assetName, attachTarget);
  if (createdId) setPendingEstateSync({ kind: "rental", id: createdId, flowType, lines: assetLines });
}

    onClose();
  };

  if (!open || !mounted) return null;

  // IMPORTANT: do NOT define a React component inline for steps.
  // Inline component definitions change identity on every render and can
  // cause inputs to unmount/remount (losing focus while typing).

  const content = (
    <div className="afwOverlay" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="afwModal" role="dialog" aria-modal="true">
        <div className="afwTop">
          <div className="afwTitle">Ajouter un flux</div>
          <button className="afwClose" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="afwBody" ref={bodyRef}>
          <div
            className="afwTrack"
            style={{ transform: `translateX(-${Math.max(0, (step - 1) * (viewportW || 0))}px)` }}
          >
            {/* STEP 1 */}
            <div className="afwStep">
              <div className="afwSectionTitle">1 — Type de flux financier</div>
              <div className="afwList">
                {(["rental", "property", "car", "unitExpense", "income"] as FlowType[]).map((t) => (
                  <button
                    key={t}
                    className="afwRow"
                    onClick={() => {
                      setFlowType(t);
                      if (t === "rental" || t === "property" || t === "car") {
                        setAssetLines(defaultLinesForAsset(t));
                      }

                      // Car does not need a "details" step: we auto-generate the car name.
                      // Jump directly to owner (step 3) or amount (step 4).
                      if (t === "car") {
                        setCity("");
                        setSurface("");
                        goStep(hasMultiplePeople ? 3 : 4);
                        return;
                      }

                      goStep(2);
                    }}
                  >
                    <span className="afwIcon">{prettyIcon(t)}</span>
                    <span className="afwRowLabel">{typeLabel(t)}</span>
                    <span className="afwChevron">›</span>
                  </button>
                ))}
              </div>
            </div>

            {/* STEP 2 */}
            <div className="afwStep">
              <div className="afwSectionTitle">2 — Détails</div>

              {flowType === "unitExpense" && (
                <>
                  <label className="afwField">
                    <div className="afwLabel">Type de dépense (nom)</div>
                    <input className="afwInput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Courses" />
                  </label>
                  <div className="afwSegment">
                    <button className={expenseCat === "variables" ? "afwSeg on" : "afwSeg"} onClick={() => setExpenseCat("variables")}>Variable</button>
                    <button className={expenseCat === "fixes" ? "afwSeg on" : "afwSeg"} onClick={() => setExpenseCat("fixes")}>Fixe</button>
                  </div>
                </>
              )}

              {flowType === "income" && (
                <label className="afwField">
                  <div className="afwLabel">Source de revenu (nom)</div>
                  <input className="afwInput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Salaire" />
                </label>
              )}

              {(flowType === "rental" || flowType === "property" || flowType === "car") && (
                <>
                  <label className="afwField">
                    <div className="afwLabel">Ville</div>
                    <input className="afwInput" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex: Saint-Denis" />
                  </label>
                  <label className="afwField">
                    <div className="afwLabel">Superficie (m²) <span className="afwHint">(optionnel)</span></div>
                    <input className="afwInput" value={surface} onChange={(e) => setSurface(e.target.value)} placeholder="Ex: 25" />
                  </label>

                  <div className="afwPreview">
                    <div className="afwPreviewLabel">Nom généré</div>
                    <div className="afwPreviewValue">{computedAssetName || "—"}</div>
                  </div>
                </>
              )}

              <div className="afwFooter">
                <button className="afwBack" onClick={() => goStep(1)}>← Retour</button>
                <div style={{ flex: 1 }} />
                {(flowType === "rental" || flowType === "property" || flowType === "car") && (
                  <button className="afwGhost" onClick={() => goStep(hasMultiplePeople ? 3 : 4)}>Ignorer</button>
                )}
                <button
                  className="afwNext"
                  disabled={!canContinueStep2}
                  onClick={() => goStep(hasMultiplePeople ? 3 : 4)}
                >
                  Continuer →
                </button>
              </div>
            </div>

            {/* STEP 3 */}
            <div className="afwStep">
              <div className="afwSectionTitle">3 — Personne concernée</div>

              <div className="afwList">
                <button
                  className={`afwRow ${ownerKind === "foyer" ? "sel" : ""}`}
                  onClick={() => {
                    setOwnerKind("foyer");
                    goStep(4);
                  }}
                >
                  <span className="afwIcon">👥</span>
                  <span className="afwRowLabel">Commun (foyer)</span>
                  <span className="afwChevron">›</span>
                </button>
                {(activePeople ?? []).map((p) => (
                  <button
                    key={p.id}
                    className={`afwRow ${ownerKind === "person" && ownerPersonId === p.id ? "sel" : ""}`}
                    onClick={() => {
                      setOwnerKind("person");
                      setOwnerPersonId(p.id);
                      goStep(4);
                    }}
                  >
                    <span className="afwIcon">🧍</span>
                    <span className="afwRowLabel">{p.name}</span>
                    <span className="afwChevron">›</span>
                  </button>
                ))}
              </div>

              <div className="afwFooter">
                <button className="afwBack" onClick={() => goStep(2)}>← Retour</button>
              </div>
            </div>

            {/* STEP 4 */}
            <div className="afwStep">
              <div className="afwSectionTitle">4 — Montant</div>

              {(flowType === "unitExpense" || flowType === "income") && (
                <>
                  <div className="afwBigTitle">
                    {flowType === "unitExpense" ? `Coût de ${name || "la dépense"}` : `Montant gagné grâce à ${name || "ce revenu"}`}
                  </div>
                  <label className="afwField">
                    <div className="afwLabel">Montant (€)</div>
                    <input className="afwInput" value={amountSingle} onChange={(e) => setAmountSingle(e.target.value)} placeholder="Ex: 120" />
                  </label>
                </>
              )}

              {(flowType === "rental" || flowType === "property" || flowType === "car") && (
                <>
                  <div className="afwBigTitle">Flux financiers de {computedAssetName || "cet objet"}</div>
                  <div className="afwTable">
                    <div className="afwTableHead">
                      <div>Dépense / Revenu</div>
                      <div className="right">Montant</div>
                    </div>
                    {assetLines.map((ln) => (
                      <div key={ln.id} className="afwTableRow">
                        <div className="afwCellLeft">
                          <input
                            className="afwMiniInput"
                            value={ln.label}
                            disabled={!!ln.readonly}
                            onChange={(e) => setAssetLines((prev) => prev.map((x) => (x.id === ln.id ? { ...x, label: e.target.value } : x)))}
                          />
                          <select
                            className="afwSelect"
                            value={ln.cat}
                            disabled={!!ln.readonly || ln.kind === "income"}
                            onChange={(e) => setAssetLines((prev) => prev.map((x) => (x.id === ln.id ? { ...x, cat: e.target.value as ExpenseCategory } : x)))}
                          >
                            {ln.kind === "income" ? (
                              <option value="fixes">Revenu</option>
                            ) : (
                              <>
                                <option value="fixes">Fixe</option>
                                <option value="variables">Variable</option>
                              </>
                            )}
                          </select>
                          {ln.kind === "income" && <span className="afwTag afwTagIncome">💰 Revenu</span>}
                        </div>
                        <div className="afwCellRight">
                          <input
                            className="afwMiniInput right"
                            value={ln.amount}
                            onChange={(e) => setAssetLines((prev) => prev.map((x) => (x.id === ln.id ? { ...x, amount: e.target.value } : x)))}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    className="afwAddLine"
                    onClick={() => setAssetLines((prev) => [...prev, { id: uid("l"), label: "", amount: "", cat: "fixes", readonly: false }])}
                  >
                    + Ajouter une ligne
                  </button>
                  <div className="afwHintBlock">Tu peux laisser des montants vides : ils ne seront pas créés.</div>
                </>
              )}

              <div className="afwFooter">
                <button
                  className="afwBack"
                  onClick={() => goStep(hasMultiplePeople ? 3 : 2)}
                >
                  ← Retour
                </button>
                <div style={{ flex: 1 }} />
                <button className="afwNext" onClick={saveAll}>Valider</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
