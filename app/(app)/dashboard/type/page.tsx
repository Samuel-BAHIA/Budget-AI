"use client";

import { SankeyView } from "@/components/sankey/SankeyView";

export default function DashboardTypePage() {
  return (
    <SankeyView
      // Backward-compatible route: keep /dashboard/type but map it to the simplified view with /type.
      mode="posts"
      postsPrimaryColumn="type"
      pageTitle="Simplifiée — Budget"
      showExpenseColumnReorder={false}
      showDashboardTabs
    />
  );
}
