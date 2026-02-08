"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";

// Order requested:
// 1) Simplifiée
// 2) Utilisateurs
// 3) Personnalisée
const views = [
  { value: "simple", href: "/dashboard/postes", label: "Simplifiée" },
  { value: "users", href: "/dashboard/personne", label: "Utilisateurs" },
  { value: "custom", href: "/dashboard/globale", label: "Personnalisée" },
];

function getCurrentValue(pathname: string) {
  // Treat /dashboard/type as the "Simplifiée" view.
  if (pathname === "/dashboard/type" || pathname.startsWith("/dashboard/type/")) return "simple";
  if (pathname === "/dashboard/personne" || pathname.startsWith("/dashboard/personne/")) return "users";
  if (pathname === "/dashboard/globale" || pathname.startsWith("/dashboard/globale/")) return "custom";
  return "simple";
}

export default function DashboardViewSelector() {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const current = useMemo(() => getCurrentValue(pathname), [pathname]);
  const currentIndex = useMemo(() => views.findIndex((v) => v.value === current), [current]);

  return (
    <div className="topbarTitleGroup" aria-label="Sélecteur de vue">
      <span className="topbarTitlePrefix">Vue</span>
      <span className="topbarViewSelectWrap">
        <select
          className="topbarViewSelect"
          value={current}
          aria-label="Choisir la vue"
          onChange={(e) => {
            const next = e.target.value;
            const idx = views.findIndex((v) => v.value === next);
            const href = views[idx]?.href ?? "/dashboard/postes";

            // Hint the global page transition with a direction based on view order.
            const dir = idx > currentIndex ? "forward" : idx < currentIndex ? "back" : undefined;
            if (typeof window !== "undefined" && dir) (window as any).__NAV_DIR__ = dir;

            router.push(href);
          }}
        >
          {views.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
