"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useUsers } from "@/components/user/UserProvider";

type Props = {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
};

type NavItem = { href: string; label: string; icon: string; indent?: number };

const navItems: NavItem[] = [
  // Le menu "Budget" est conservé mais renommé.
  { href: "/dashboard", label: "Suivi Budget", icon: "📊" },
];

export default function SidebarDrawer({ open, onClose, children }: Props) {
  // `usePathname()` can be null during router boot/hydration in some edge cases.
  const pathname = usePathname() ?? "";
  const { data: session, status } = useSession();
  const { activeFoyer, activePeople, foyers, activeFoyerId } = useUsers();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const isAuthed = Boolean(session?.user);

  const foyerTitle = useMemo(() => {
    if (!isAuthed) return "Utilisateur non connecté";
    // Names are normalized in UserProvider: Foyer 1, Foyer 2, ...
    return activeFoyer?.name || (() => {
      const idx = (foyers ?? []).findIndex((f) => f.id === activeFoyerId);
      return `Foyer ${idx >= 0 ? idx + 1 : "X"}`;
    })();
  }, [isAuthed, activeFoyer?.name, foyers, activeFoyerId]);

  const foyerSubtitle = useMemo(() => {
    if (!isAuthed) return "";
    const names = (activePeople ?? []).map((p) => p.name).filter(Boolean);
    if (!names.length) return "";
    const a = names[0] ?? "";
    const b = names[1] ?? "";
    return b ? `${a} + ${b}` : a;
  }, [isAuthed, activePeople]);

  const avatarFallback = useMemo(() => {
    if (status === "loading") return "…";
    return isAuthed ? "👤" : "🔒";
  }, [isAuthed, status]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  if (!open) return null;

  return (
    <div className="mobileSidebarOverlay" role="dialog" aria-modal="true" aria-label="Menu">
      <button className="mobileSidebarBackdrop" aria-label="Fermer le menu" onClick={onClose} />

      <aside className="mobileSidebarPanel">
        <div className="mobileSidebarHeader">
          <div className="mobileSidebarHeaderLeft" ref={menuRef}>
            <button
              type="button"
              className="mobileSidebarUserBtn"
              aria-label={isAuthed ? "Menu utilisateur" : "Menu connexion"}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="mobileSidebarBrandIcon" aria-hidden="true">
                {isAuthed && session?.user?.image ? (
                  // Google profile picture (NextAuth session.user.image)
                  <img
                    className="mobileSidebarAvatarImg"
                    src={session.user.image}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  avatarFallback
                )}
              </span>
            </button>

            <div className="mobileSidebarHeaderText">
              <div className="mobileSidebarHeaderTitle">{foyerTitle}</div>
              {foyerSubtitle ? <div className="mobileSidebarHeaderSubtitle">{foyerSubtitle}</div> : null}
            </div>

            {menuOpen ? (
              <div className="mobileSidebarUserMenu" role="menu" aria-label="Actions">
                {isAuthed ? (
                  <>
                    <Link
                      href="/"
                      role="menuitem"
                      className="mobileSidebarUserMenuItem"
                      onClick={() => {
                        setMenuOpen(false);
                        onClose();
                      }}
                    >
                      Gérer les foyers
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      className="mobileSidebarUserMenuItem"
                      onClick={() => {
                        setMenuOpen(false);
                        onClose();
                        signOut();
                      }}
                    >
                      Se déconnecter
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="mobileSidebarUserMenuItem"
                    onClick={() => {
                      setMenuOpen(false);
                      onClose();
                      signIn("google");
                    }}
                  >
                    Se connecter
                  </button>
                )}
              </div>
            ) : null}
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
                style={it.indent ? { paddingLeft: 14 + it.indent * 18 } : undefined}
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
