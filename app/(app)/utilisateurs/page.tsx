"use client";

import { useMemo, useState } from "react";
import { useUsers } from "@/components/user/UserProvider";

export default function UtilisateursPage() {
  const {
    foyers,
    activeFoyerId,
    activeFoyer,
    setActiveFoyer,
    addFoyer,
    removeFoyer,
    addPerson,
    renamePerson,
    removePerson,
  } = useUsers();

  const [newPersonName, setNewPersonName] = useState("");
  const people = useMemo(() => activeFoyer?.people ?? [], [activeFoyer]);

  return (
    <div style={{ padding: 14, display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 14 }} id="foyers">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Foyers</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Sélectionne un foyer actif, ou ajoute/supprime un foyer.
            </div>
          </div>
          <button className="btnPrimary" onClick={() => addFoyer()}>
            + Ajouter
          </button>
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {foyers.map((f) => (
            <div key={f.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                className={f.id === activeFoyerId ? "btnPrimary" : "btnGhost"}
                style={{ flex: 1, textAlign: "left" }}
                onClick={() => setActiveFoyer(f.id)}
              >
                <div style={{ fontWeight: 900 }}>{f.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {f.people?.map((p) => p.name).join(" · ")}
                </div>
              </button>
              <button className="btnGhost" onClick={() => removeFoyer(f.id)} title="Supprimer">
                🗑
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 14 }} id="utilisateurs">
        <div style={{ fontWeight: 900, fontSize: 16 }}>Utilisateurs</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          Gère les personnes du foyer actif.
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {people.map((p) => (
            <div key={p.id} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 40px" }}>
              <input
                className="input"
                value={p.name}
                onChange={(e) => renamePerson(activeFoyerId, p.id, e.target.value)}
              />
              <button className="btnGhost" onClick={() => removePerson(activeFoyerId, p.id)} title="Supprimer">
                🗑
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <input
            className="input"
            value={newPersonName}
            onChange={(e) => setNewPersonName(e.target.value)}
            placeholder="Ajouter un utilisateur"
            style={{ flex: 1 }}
          />
          <button
            className="btnPrimary"
            onClick={() => {
              addPerson(activeFoyerId, newPersonName);
              setNewPersonName("");
            }}
            disabled={!newPersonName.trim()}
          >
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}
