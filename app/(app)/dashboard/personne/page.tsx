"use client";

import { SankeyView } from "@/components/sankey/SankeyView";

export default function DashboardPersonPage() {
  return (
    <SankeyView
      mode="person"
      pageTitle="Utilisateur — Budget"
      showExpenseColumnReorder={false}
      forceRevenueOwnersColumn
      showDashboardTabs
    />
  );
}
