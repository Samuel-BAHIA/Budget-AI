import type { MenuTotalsKey } from "@/components/data/useMenuTotals";

export type MenuNavItem = {
  id?: string;
  href: string;
  label: string;
  key?: MenuTotalsKey;
  value?: number;
  meta?: string;
  icon?: string;
  children?: MenuNavItem[];
};

export type MenuGroup = {
  title: string;
  headerKey?: MenuTotalsKey;
  sections?: { title: string; items: MenuNavItem[] }[];
  items?: MenuNavItem[];
};

/**
 * Version "Sankey-only"
 * - On garde les stores / données, mais on retire toutes les pages et sous-menus.
 * - Le menu "Dashboard" ouvre l'accès à Sankey.
 */

export const bottomNavTabs: MenuNavItem[] = [
  // Le menu "Foyers" remplace l'ancien "Accueil".
  { href: "/", label: "Foyers", icon: "🏠" },
  // Le menu "Budget" est conservé mais renommé.
  { href: "/dashboard", label: "Suivi Budget", icon: "📊" },
];

export const sidebarNavGroups: MenuGroup[] = [
  {
    // Keep title empty: we don't want a visible "Dashboard" header in the sidebar.
    title: "",
    items: [
      // Le wizard "Création d’un foyer" est accessible via : Foyers → + Nouveau.
      { href: "/onboarding", label: "+ Nouveau", icon: "➕" },
      { href: "/dashboard", label: "Suivi Budget", icon: "📊" },
    ],
  },
];
