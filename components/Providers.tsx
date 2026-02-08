"use client";

import { SessionProvider } from "next-auth/react";
import { UserProvider } from "@/components/user/UserProvider";
import OnlineBudgetSync from "@/components/data/OnlineBudgetSync";

export default function Providers({ children }: { children: React.ReactNode }) {
  // SessionProvider makes the NextAuth session available to client components.
  return (
    <SessionProvider>
      <UserProvider>
        {/*
          - Not authenticated: app stays 100% local (localStorage only)
          - Authenticated: sync localStorage snapshot to Neon via /api/budget-state
        */}
        <OnlineBudgetSync />
        {children}
      </UserProvider>
    </SessionProvider>
  );
}
