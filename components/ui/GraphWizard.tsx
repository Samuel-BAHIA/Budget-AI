"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUsers } from "@/components/user/UserProvider";
import { useGraphConfig } from "@/components/data/graphConfigStore";
import { useExpenses } from "@/components/data/flowsStore";

type Step = 1 | 2;
type Focus = "person" | "type" | "object";

function ChoiceRow(props: { label: string; icon?: string; onClick: () => void; subtle?: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 12px",
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "white",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {props.icon ? <span style={{ fontSize: 18 }}>{props.icon}</span> : null}
        <div style={{ textAlign: "left", minWidth: 0 }}>
          <div style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.label}</div>
          {props.subtle ? (
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {props.subtle}
            </div>
          ) : null}
        </div>
      </div>
      <span style={{ opacity: 0.6 }}>›</span>
    </button>
  );
}

export default function GraphWizard() {
  const router = useRouter();
  const { activeFoyerId, activePeople } = useUsers();
  const { config, save } = useGraphConfig(activeFoyerId);

  const depFixes = useExpenses("fixes");
  const depVars = useExpenses("variables");
  const hasObjects = useMemo(() => {
    const SEP = " — ";
    return [...depFixes.lines, ...depVars.lines].some((l) => String(l.label ?? "").includes(SEP));
  }, [depFixes.lines, depVars.lines]);

  const peopleNames = useMemo(() => activePeople.map((p) => p.name).filter(Boolean), [activePeople]);
  const peopleLabel = useMemo(() => {
    if (peopleNames.length === 0) return "les personnes du foyer";
    if (peopleNames.length === 1) return peopleNames[0];
    if (peopleNames.length === 2) return `${peopleNames[0]} et ${peopleNames[1]}`;
    return `${peopleNames.slice(0, -1).join(", ")} et ${peopleNames[peopleNames.length - 1]}`;
  }, [peopleNames]);

  const [step, setStep] = useState<Step>(1);
  const [focus, setFocus] = useState<Focus | null>(null);

  // Pixel-perfect slide
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodyW, setBodyW] = useState(0);
  useEffect(() => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    const ro = new ResizeObserver(() => setBodyW(el.clientWidth));
    ro.observe(el);
    setBodyW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const trackX = -(Number(step) - 1) * bodyW;

  const summary = useMemo(() => {
    const lines: string[] = [];
    if (!focus) return lines;

    lines.push("Résumé du diagramme à générer :");
    lines.push("• Côté revenus : tu verras toujours le TOTAL (et le détail éventuel selon ton réglage actuel).");

    if (focus === "person") {
      lines.push(`• Mise en avant : la répartition des dépenses par personne ( ${peopleLabel} + Commun ).`);
      lines.push("• Ça permet de voir qui porte quoi, et où se concentrent les dépenses par personne.");
    } else if (focus === "type") {
      lines.push("• Mise en avant : la répartition Fixes vs Variables.");
      lines.push("• Ça permet d’identifier ce qui est réductible : en général, les VARIABLES sont plus faciles à optimiser.");
    } else {
      lines.push("• Mise en avant : la répartition par postes/objets (voiture, logement, etc.).");
      if (!hasObjects) {
        lines.push("• Note : je n’ai pas détecté de libellés au format “Objet — Détail” dans tes dépenses, donc la colonne /objet risque d’être vide ou masquée.");
      }
      lines.push("• Ça permet de repérer les gros postes (ex: voiture) et de comparer leur poids dans le budget.");
    }

    lines.push("• Tu pourras ensuite cliquer sur un nœud pour ajuster / supprimer un élément (comme sur la vue globale).");
    return lines;
  }, [focus, peopleLabel, hasObjects]);

  const applyAndGo = () => {
    if (!focus) return;

    const next = {
      // We keep the current revenueDetailMode (not asked in this wizard).
      showExpenseTypeSplit: focus === "type",
      showExpenseOwnerSplit: focus === "person",
      showObjectsColumn: focus === "object",
      showBalanceColumn: true,
    };

    save({
      ...next,
      // keep revenueDetailMode as-is
      revenueDetailMode: config.revenueDetailMode,
    });

    router.push("/graph/view");
  };

  return (
    <div
      style={{
        maxWidth: 860,
        margin: "0 auto",
        background: "white",
        border: "1px solid rgba(0,0,0,0.10)",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "0 12px 40px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ padding: 18, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>Générer un diagramme</div>
        <div style={{ opacity: 0.7, marginTop: 4, fontSize: 13 }}>
          Choisis ce que tu veux mettre en avant, et je génère le diagramme avec les colonnes adaptées.
        </div>
      </div>

      <div ref={bodyRef} style={{ position: "relative", height: 360, overflow: "hidden", background: "#fff" }}>
        <div
          style={{
            display: "flex",
            width: bodyW ? bodyW * 2 : "200%",
            transform: `translateX(${trackX}px)`,
            transition: "transform 260ms ease",
            willChange: "transform",
          }}
        >
          {/* Page 1 */}
          <div style={{ width: bodyW || "100%", padding: 18, boxSizing: "border-box" }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              1 — Quelle type de répartition des données souhaites-tu mettre en avant :
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <ChoiceRow
                label="La répartition par personne"
                icon="👥"
                subtle="Qui dépense quoi (et Commun)"
                onClick={() => {
                  setFocus("person");
                  setStep(2);
                }}
              />
              <ChoiceRow
                label="La répartition par type de dépenses (fixes/variables)"
                icon="🧩"
                subtle="Fixes vs Variables"
                onClick={() => {
                  setFocus("type");
                  setStep(2);
                }}
              />
              <ChoiceRow
                label="La répartition par postes de dépense (voiture, location..)"
                icon="🧱"
                subtle="/objet (si disponible)"
                onClick={() => {
                  setFocus("object");
                  setStep(2);
                }}
              />
            </div>
          </div>

          {/* Page 2 (Résumé) */}
          <div style={{ width: bodyW || "100%", padding: 18, boxSizing: "border-box" }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>2 — Résumé</div>
            <div
              className="card"
              style={{
                padding: 14,
                borderRadius: 16,
                border: "1px solid rgba(0,0,0,0.10)",
                background: "rgba(0,0,0,0.02)",
              }}
            >
              <div style={{ display: "grid", gap: 6, fontSize: 13, lineHeight: 1.35 }}>
                {summary.map((l, i) => (
                  <div key={i} style={{ opacity: i === 0 ? 0.95 : 0.85, fontWeight: i === 0 ? 900 : 600 }}>
                    {l}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  borderRadius: 14,
                  padding: "10px 12px",
                  border: "1px solid rgba(0,0,0,0.15)",
                  background: "white",
                  fontWeight: 800,
                }}
              >
                ← Retour
              </button>

              <button
                type="button"
                onClick={applyAndGo}
                disabled={!focus}
                className="btn"
                style={{ borderRadius: 14, padding: "10px 14px", fontWeight: 900 }}
              >
                Générer le diagramme
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
