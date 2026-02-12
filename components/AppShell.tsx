"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Breadcrumbs, { useBreadcrumbCrumbs } from "@/components/ui/Breadcrumbs";
import DashboardViewSelector from "@/components/nav/DashboardViewSelector";
import SidebarDrawer from "@/components/nav/SidebarDrawer";
// Sidebar removed in web mode; keep layout simple.

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Track navigation direction for page transitions.
  const lastPathRef = useRef<string>(pathname ?? "/");
  const pendingDirRef = useRef<"forward" | "back">("forward");
  const [navDir, setNavDir] = useState<"forward" | "back">("forward");

  // Browser back/forward should animate as a back transition.
  useEffect(() => {
    const onPop = () => {
      pendingDirRef.current = "back";
      (window as any).__NAV_DIR__ = "back";
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Mobile swipe-back gesture (from left edge).
  useEffect(() => {
    const el = document.querySelector(".main") as HTMLElement | null;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      // Only start gesture near the left edge.
      tracking = startX <= 24;
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // Basic threshold to avoid accidental triggers.
      if (dx > 90 && Math.abs(dy) < 60) {
        pendingDirRef.current = "back";
        (window as any).__NAV_DIR__ = "back";
        router.back();
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [router]);

  // Apply nav direction on route change.
  useEffect(() => {
    const next = pathname ?? "/";
    const last = lastPathRef.current;
    const hinted = (typeof window !== "undefined" && (window as any).__NAV_DIR__) as
      | "forward"
      | "back"
      | undefined;
    const dir = hinted ?? pendingDirRef.current ?? "forward";
    // Reset hint for next navigation.
    if (typeof window !== "undefined") (window as any).__NAV_DIR__ = undefined;
    pendingDirRef.current = "forward";
    lastPathRef.current = next;
    if (next !== last) setNavDir(dir);
    // Expose the effective direction so page-level or component-level animations can reuse it.
    if (typeof document !== "undefined") document.documentElement.dataset.navDir = dir;
  }, [pathname]);

  // Sidebar shows primary navigation + auth.

  const crumbs = useBreadcrumbCrumbs();
  const mobileTitle = useMemo(() => {
    // Override some titles for clarity on mobile
    if (pathname?.startsWith("/depenses/variables")) return "Dépenses variables";
    if (pathname?.startsWith("/depenses/fixes")) return "Dépenses fixes";
    if (pathname?.startsWith("/revenus")) return "Revenus";
    if (pathname?.startsWith("/depenses")) return "Dépenses";
    // Dashboard title is handled by the "Vue" selector in the topbar.
    if (pathname?.startsWith("/dashboard")) return "";
    return crumbs.length ? crumbs[crumbs.length - 1].label : "Foyers";
  }, [pathname, crumbs]);

  return (
    <div className="appShell">
      <SidebarDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <header className="topbar">
        <div className="topbarInner topbarInnerSingleMenu">
          <button
            type="button"
            className="btnGhost topbarMenuBtn"
            aria-label="Ouvrir le menu"
            title="Menu"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>

          <div className="topbarTitleCenter" aria-label="Titre">
            {pathname?.startsWith("/dashboard") ? (
              <DashboardViewSelector />
            ) : (
              <div className="topbarTitle">{mobileTitle}</div>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        {/* Breadcrumbs shown on desktop for every page */}
        <div className="breadcrumbsDesktopOnly">
          <Breadcrumbs />
        </div>
        <div
          key={pathname ?? "__root"}
          className={`pageTransition pageTransition-${navDir} ${pathname?.startsWith("/dashboard") ? "pageTransition-noAnim" : ""}`}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
