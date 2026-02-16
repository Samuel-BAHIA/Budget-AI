"use client";

import { SankeyView } from "@/components/sankey/SankeyView";

export default function DashboardGlobalPage() {
  return (
    <SankeyView
      mode="global"
      pageTitle="Personnalisée — Budget"
      showExpenseColumnReorder
      showDashboardTabs
    />
  );
}
