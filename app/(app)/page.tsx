"use client";

import Link from "next/link";
import { useUsers } from "@/components/user/UserProvider";

export default function HomePage() {
  const { foyers } = useUsers();

  return (
    <div style={{ padding: 14, display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>Budget du foyer</div>
        <div className="muted" style={{ lineHeight: 1.35 }}>
          Cette application t’aide à organiser un budget <b>par foyer</b> : revenus, dépenses et répartition entre
          utilisateurs. Tu peux consulter un foyer existant ou en créer un nouveau via un assistant.
        </div>
      </div>

      <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>Menu</div>

        <Link href="/foyers" className="btnPrimary" style={{ textDecoration: "none", textAlign: "center" }}>
          Consulter le budget d’un foyer existant
        </Link>

        <Link href="/onboarding" className="btnSecondary" style={{ textDecoration: "none", textAlign: "center" }}>
          Création d’un nouveau foyer
        </Link>

        <div className="muted" style={{ fontSize: 12 }}>
          {foyers.length} foyer{foyers.length > 1 ? "s" : ""} enregistré{foyers.length > 1 ? "s" : ""}.
        </div>
      </div>
    </div>
  );
}
