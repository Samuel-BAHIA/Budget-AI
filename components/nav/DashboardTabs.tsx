"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Order requested:
// 1) Posts (with an internal switch between /objet and /type)
// 2) Person
// 3) Global
const tabs = [
  { href: "/dashboard/postes", label: "Simplifiée" },
  { href: "/dashboard/personne", label: "Utilisateurs" },
  { href: "/dashboard/globale", label: "Personnalisée" },
];

function getTabIndex(pathname: string) {
  // Treat /dashboard/type as the "Simplifiée" tab (it's a variant of /dashboard/postes).
  if (pathname === "/dashboard/type" || pathname.startsWith("/dashboard/type/")) return 0;
  const i = tabs.findIndex((t) => pathname === t.href || pathname.startsWith(t.href + "/"));
  return i === -1 ? 0 : i;
}

export default function DashboardTabs() {
  const pathname = usePathname() ?? "";
  const currentIndex = getTabIndex(pathname);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div className="muted" style={{ fontWeight: 900, fontSize: 14 }}>
        Vue :
      </div>
      <div role="tablist" aria-label="Onglets du dashboard" className="dashTabs">
        {tabs.map((t, idx) => {
          const active =
            pathname === t.href ||
            pathname.startsWith(t.href + "/") ||
            (t.href === "/dashboard/postes" && (pathname === "/dashboard/type" || pathname.startsWith("/dashboard/type/")));
          return (
            <Link
              key={t.href}
              href={t.href}
              role="tab"
              aria-selected={active}
              className={`dashTab ${active ? "isActive" : ""}`}
              onClick={() => {
                // Hint the global page transition with a direction based on tab order.
                const dir = idx > currentIndex ? "forward" : idx < currentIndex ? "back" : undefined;
                if (typeof window !== "undefined" && dir) (window as any).__NAV_DIR__ = dir;
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
