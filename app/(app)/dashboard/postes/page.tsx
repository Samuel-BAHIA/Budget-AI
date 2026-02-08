"use client";

import { SankeyView } from "@/components/sankey/SankeyView";

export default function DashboardPostsPage() {
  return (
    <SankeyView
      mode="posts"
      pageTitle="Simplifiée — Budget"
      showExpenseColumnReorder={false}
    />
  );
}
