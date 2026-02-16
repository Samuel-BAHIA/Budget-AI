"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { PageShell } from "@/components/patterns/PageShell";
import { useExpenses, useRevenus } from "@/components/data/flowsStore";
import { useUsers } from "@/components/user/UserProvider";
import { useGraphConfig } from "@/components/data/graphConfigStore";
import { buildBudgetSankey } from "@/components/data/sankey/budgetSankeyBuilder";

// Client-only to avoid SSR hydration mismatches (layout measurements, ResizeObserver, etc.).
const SimpleSankey = dynamic(() => import("@/components/ui/SimpleSankey"), { ssr: false });

export default function GeneratedGraphViewPage() {
  const { activeFoyerId, isGlobal } = useUsers();
  const { config } = useGraphConfig(activeFoyerId);

  const revenus = useRevenus();
  const depFixes = useExpenses("fixes");
  const depVars = useExpenses("variables");

  const built = useMemo(() => {
    return buildBudgetSankey({
      revenus: revenus.lines,
      depFixes: depFixes.lines,
      depVars: depVars.lines,
      isGlobal,
      graph: config,
      view: "typeThenPerson",
    });
  }, [revenus.lines, depFixes.lines, depVars.lines, isGlobal, config]);

  const { stageLabels, groupLabels } = useMemo(() => {
    // Match the global view: one global title "Revenus" and one global title "Dépenses",
    // with centered subtitles above each column.
    const hasRevOwners = built.hasRevenueOwnersColumn && config.revenueDetailMode !== "none";
    const wantsRevDetail = config.revenueDetailMode !== "none" && config.revenueDetailMode !== "global_per_person";

    const revCols: string[] = [];
    if (wantsRevDetail) revCols.push("détail");
    if (hasRevOwners) revCols.push("/pers");
    revCols.push("TOTAL");

    // Summary column (contains Dépenses total + Épargne/Découvert)
    const expCols: string[] = ["TOTAL"]; // dépenses total
    if (config.showExpenseTypeSplit) expCols.push("/type");
    if (config.showExpenseOwnerSplit) expCols.push("/pers");
    if (config.showObjectsColumn && built.hasObjectsColumn) expCols.push("/objet");
    expCols.push("détail");

    const labels = [...revCols, ...expCols];

    const revStages = revCols.length;
    const totalStages = labels.length;

    return {
      stageLabels: labels,
      groupLabels: [
        { label: "Revenus", fromStage: 0, toStage: Math.max(0, revStages - 1) },
        { label: "Dépenses", fromStage: revStages, toStage: Math.max(revStages, totalStages - 1) },
      ],
    };
  }, [built.hasObjectsColumn, built.hasRevenueOwnersColumn, config.revenueDetailMode, config.showExpenseOwnerSplit, config.showExpenseTypeSplit, config.showObjectsColumn]);

  return (
    <PageShell
      title="Graph généré"
      // Mobile: make this view behave like the main Sankey pages (edge-to-edge + edge-to-edge).
      className="sankeyPage"
    >
      {/*
        Important: this view can generate fewer columns but a much "denser" last column.
        We want the diagram to be vertically scrollable inside the grey area, like the global view.
      */}

      <div
        className="diagramFrameClip"
        style={{
          width: "100%",
          height: "calc(100dvh - 220px)",
          minHeight: 420,
          overflow: "hidden",
          borderRadius: 18,
          position: "relative",
        }}
      >
        <SimpleSankey
          nodes={built.nodes}
          links={built.links}
          stageLabels={stageLabels}
          groupLabels={groupLabels}
          // Constrain the viewport height and let SimpleSankey expand + scroll internally if needed.
          height={560}
          scrollY
          nodeWidth={18}
          nodePadding={18}
          vPadding={76}
        />
      </div>
    </PageShell>
  );
}
