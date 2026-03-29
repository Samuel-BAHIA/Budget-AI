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


export const sidebarNavGroups: MenuGroup[] = [
  {
    title: "",
    items: [
      { href: "/", label: "Accueil", icon: "⌂" },
      { href: "/dashboard", label: "Budget", icon: "📊" },
    ],
  },
];
