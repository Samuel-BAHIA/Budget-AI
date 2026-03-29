"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
};

const navItems: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "Accueil", icon: "⌂" },
  { href: "/dashboard", label: "Budget", icon: "📊" },
  { href: "/utilisateurs", label: "Utilisateurs", icon: "👤" },
  { href: "/foyers", label: "Foyers", icon: "🏠" },
  { href: "/graph/view", label: "Graph", icon: "📈" },
];

export default function SidebarDrawer({ open, onClose, children }: Props) {
  const pathname = usePathname();

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mobileSidebarOverlay" role="dialog" aria-modal="true" aria-label="Menu">
      <button className="mobileSidebarBackdrop" aria-label="Fermer le menu" onClick={onClose} />

      <aside className="mobileSidebarPanel">
        <div className="mobileSidebarHeader">
          <div className="mobileSidebarBrand">
            <div className="mobileSidebarBrandIcon">B</div>
            <div className="mobileSidebarBrandText">Budget</div>
          </div>

          <button className="mobileSidebarClose" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>

        <nav className="mobileSidebarBody" aria-label="Navigation">
          {navItems.map((it) => {
            const active = pathname === it.href || pathname?.startsWith(it.href + "/");
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`mobileSidebarNavItem ${active ? "isActive" : ""}`}
                onClick={onClose}
              >
                <span className="mobileSidebarNavIcon" aria-hidden="true">{it.icon}</span>
                <span className="mobileSidebarNavLabel">{it.label}</span>
              </Link>
            );
          })}
        </nav>

        {children ? <div className="mobileSidebarFooter">{children}</div> : null}
      </aside>
    </div>
  );
}
