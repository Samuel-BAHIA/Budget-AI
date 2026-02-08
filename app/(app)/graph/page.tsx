"use client";

import { PageShell } from "@/components/patterns/PageShell";
import GraphWizard from "@/components/ui/GraphWizard";

export default function GraphPage() {
  return (
    <PageShell title="Générer un graph">
      <div style={{ padding: 16 }}>
        <GraphWizard />
      </div>
    </PageShell>
  );
}
