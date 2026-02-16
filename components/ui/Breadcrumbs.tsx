"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useAssets, useRentals } from "@/components/data/estateStore";
import { useExpenses, useRevenus } from "@/components/data/flowsStore";

type Crumb = { href: string; label: string };

const LABELS: Record<string, string> = {
  foyers: "Foyers",
  onboarding: "Création",
  utilisateurs: "Gestion",
  depenses: "Dépenses",
  revenus: "Revenus",
  patrimoine: "Patrimoine",
  locations: "Locations",
  bilan: "Bilan",
  variables: "Variables",
  fixes: "Fixes",
  charges: "Charges",
  loyer: "Loyer",
  autres: "Autres",
};

function normalizeLabel(seg: string) {
  return LABELS[seg] ?? seg;
}

function safeDecode(seg: string) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function isLikelyId(seg: string) {
  const s = safeDecode(seg);
  // IDs in the app are often like:
  // ex-<hex>-<hex>, rv-..., std:rental:eau, std:asset:credit, etc.
  // We'll treat segments with ":" or many hex/digits as ids.
  if (s.includes(":")) return true;
  if (/[-0-9a-f]{6,}/i.test(s)) return true;
  return false;
}

function cleanLineLabel(label: string) {
  if (label.startsWith("Charge - ")) return label.slice("Charge - ".length);
  if (label.startsWith("Charge: ")) return label.slice("Charge: ".length);
  if (label.startsWith("Loyer - ")) return label.slice("Loyer - ".length);
  if (label.startsWith("Loyer: ")) return label.slice("Loyer: ".length);
  return label;
}


export function useBreadcrumbCrumbs(): Crumb[] {
  const pathname = usePathname() ?? "/";
  const { assets } = useAssets();
  const { rentals } = useRentals();

  // for /depenses/<category>/<id> and /revenus/<id>
  const { lines: varLines } = useExpenses("variables");
  const { lines: fixLines } = useExpenses("fixes");
  const { lines: revLines } = useRevenus();

  const crumbs = useMemo<Crumb[]>(() => {
    // Special-case dashboards: keep breadcrumb names in sync with the dashboard tabs.
    if (pathname.startsWith("/dashboard")) {
      const seg = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean)[1] ?? "postes";
      const label =
        seg === "personne"
          ? "Utilisateurs"
          : seg === "globale"
            ? "Personnalisée"
            : /* postes | type (variant) */ "Simplifiée";
      const href = seg === "personne" ? "/dashboard/personne" : seg === "globale" ? "/dashboard/globale" : "/dashboard/postes";
      return [
        { href: "/", label: "Accueil" },
        { href, label },
      ];
    }

    const segments = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
    const out: Crumb[] = [{ href: "/", label: "Accueil" }];

    const hrefFor = (i: number) => "/" + segments.slice(0, i + 1).join("/");

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.startsWith("(") && seg.endsWith(")")) continue;

      const prev = segments[i - 1];
      const prev2 = segments[i - 2];
      const prev3 = segments[i - 3];

      const decoded = safeDecode(seg);
      let label = normalizeLabel(decoded);

      // Patrimoine & Locations ids -> names
      if (prev === "patrimoine") {
        const asset = assets?.find((x) => String(x.id) === String(decoded));
        label = asset?.name ?? "Bien";
      }
      if (prev === "locations") {
        const rental = rentals?.find((x) => String(x.id) === String(decoded));
        label = rental?.name ?? "Location";
      }

      // Line IDs -> use line label (instead of raw id)
      // 1) Patrimoine/<assetId>/depenses/<lineId>
      if (prev === "depenses" && prev2 && prev3 === "patrimoine" && isLikelyId(decoded)) {
        const assetId = safeDecode(prev2);
        const asset = assets?.find((x) => String(x.id) === String(assetId));
        const line = asset?.expenses?.find((l) => String(l.id) === String(decoded));
        label = line ? cleanLineLabel(line.label) : "Dépense";
      }

      // 2) Patrimoine/<assetId>/revenus/<lineId>
      if (prev === "revenus" && prev2 && prev3 === "patrimoine" && isLikelyId(decoded)) {
        const assetId = safeDecode(prev2);
        const asset = assets?.find((x) => String(x.id) === String(assetId));
        const line = asset?.incomes?.find((l) => String(l.id) === String(decoded));
        label = line ? line.label : "Revenu";
      }

      // 3) Locations/<rentalId>/depenses/<lineId>
      if (prev === "depenses" && prev2 && prev3 === "locations" && isLikelyId(decoded)) {
        const rentalId = safeDecode(prev2);
        const rental = rentals?.find((x) => String(x.id) === String(rentalId));
        const line = rental?.expenses?.find((l) => String(l.id) === String(decoded));
        label = line ? cleanLineLabel(line.label) : "Dépense";
      }

      // 4) Dépenses/<category>/<lineId>
      if ((prev === "variables" || prev === "fixes") && isLikelyId(decoded)) {
        const list = prev === "variables" ? varLines : fixLines;
        const line = list?.find((l) => String(l.id) === String(decoded));
        label = line?.label ?? "Dépense";
      }

      // 5) Revenus/<lineId>
      if (prev === "revenus" && prev2 !== "patrimoine" && isLikelyId(decoded)) {
        const line = revLines?.find((l) => String(l.id) === String(decoded));
        label = line?.label ?? "Revenu";
      }

      out.push({ href: hrefFor(i), label });
    }

    if (segments.length === 0) return out.slice(0, 1);
    return out;
  }, [pathname, assets, rentals, varLines, fixLines, revLines]);

  return crumbs;
}


export default function Breadcrumbs() {
  const crumbs = useBreadcrumbCrumbs();

  if (!crumbs.length) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        flexWrap: "wrap",
        fontSize: 12,
      }}
      className="muted"
      aria-label="Breadcrumb"
    >
      {crumbs.map((c, idx) => {
        const isLast = idx === crumbs.length - 1;
        return (
          <span key={c.href} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {isLast ? (
              <span style={{ fontWeight: 800, color: "inherit" }}>{c.label}</span>
            ) : (
              <Link
                href={c.href}
                className="muted"
                style={{ textDecoration: "none" }}
                onClick={() => {
                  // Breadcrumb navigation is perceived as "back".
                  if (typeof window !== "undefined") (window as any).__NAV_DIR__ = "back";
                }}
              >
                {c.label}
              </Link>
            )}
            {!isLast ? <span style={{ opacity: 0.4 }}>›</span> : null}
          </span>
        );
      })}
    </div>
  );
}
