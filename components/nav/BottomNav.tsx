"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMenuTotals } from "@/components/data/useMenuTotals";
import { formatEUR } from "@/components/utils/format";
import { bottomNavTabs } from "@/components/nav/menu";
import { useMounted, useMediaQuery } from "@/components/utils/hooks";

export default function BottomNav() {
  const pathname = usePathname();
  const totals = useMenuTotals();
  const mounted = useMounted();
  const isMobile = useMediaQuery("(max-width: 720px)");
  const showSankeyColsAction = isMobile && pathname.startsWith("/dashboard");

  const renderEUR = (n: number) => (
    <span suppressHydrationWarning>{mounted ? formatEUR(n) : formatEUR(0)}</span>
  );

  return (
    <div className="bottomNavInner" role="navigation" aria-label="Navigation principale">
      {bottomNavTabs.map((t) => {
        const seg = t.href.split("/").filter(Boolean)[0] ?? "";
        const active = pathname.startsWith(`/${seg}`);
        const value = t.key ? totals[t.key] : 0;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`bottomTab ${active ? "bottomTabActive" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <div className="bottomIcon" aria-hidden>
              {t.icon}
            </div>
            <div className="bottomLabel">{t.label}</div>
            <div className="bottomValue">{renderEUR(value)}</div>
          </Link>
        );
      })}

      {showSankeyColsAction ? (
        <button
          type="button"
          className="bottomTab bottomTabAction"
          onClick={() => {
            if (typeof window === "undefined") return;
            window.dispatchEvent(new CustomEvent("budget:sankey:openColumnsMenu"));
          }}
          aria-label="Colonnes"
          title="Colonnes"
        >
          <div className="bottomIcon" aria-hidden>
            ▦
          </div>
          <div className="bottomLabel">Colonnes</div>
          <div className="bottomValue" />
        </button>
      ) : null}
    </div>
  );
}
