"use client";

import { useRouter } from "next/navigation";
import { useUsers } from "@/components/user/UserProvider";

export default function FoyersPage() {
  const router = useRouter();
  const { foyers, activeFoyerId, setActiveFoyer, addFoyer, removeFoyer } = useUsers();

  return (
    <div style={{ padding: 14, display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Choisir un foyer</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Sélectionne un foyer existant pour consulter son budget.
            </div>
          </div>
          <button
            className="btnPrimary"
            onClick={() => {
              addFoyer();
              // On reste sur la page pour permettre de compléter via l'assistant si besoin.
            }}
          >
            + Nouveau
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 6 }}>
        {foyers.map((f) => (
          <div
            key={f.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: 10,
              borderRadius: 12,
              background: f.id === activeFoyerId ? "rgba(0,0,0,0.04)" : "transparent",
            }}
          >
            <button
              className="btnGhost"
              style={{ flex: 1, textAlign: "left", padding: 10 }}
              onClick={() => {
                setActiveFoyer(f.id);
                router.push("/dashboard/postes");
              }}
            >
              <div style={{ fontWeight: 900 }}>{f.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {f.people?.map((p) => p.name).join(" · ") || "Aucun utilisateur"}
              </div>
            </button>

            <button
              className="btnGhost"
              aria-label="Supprimer"
              title="Supprimer"
              onClick={() => removeFoyer(f.id)}
              style={{ paddingInline: 10 }}
            >
              🗑
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
