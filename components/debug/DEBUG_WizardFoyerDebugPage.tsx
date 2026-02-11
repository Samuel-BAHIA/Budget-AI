"use client";

import { useEffect, useState } from "react";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import DEBUG_WizardFoyerOverlay from "@/components/debug/DEBUG_WizardFoyerOverlay";

export default function DEBUG_WizardFoyerDebugPage() {
  // All local state is DEBUG-prefixed so you can delete it quickly later.
  const [DEBUG_mounted, setDEBUG_mounted] = useState(false);

  useEffect(() => {
    setDEBUG_mounted(true);
  }, []);

  return (
    <div style={{ position: "relative" }}>
      {/* Small inline helper (kept minimal, the overlay has controls) */}
      <div
        style={{
          marginBottom: 12,
          padding: 12,
          borderRadius: 14,
          border: "1px dashed rgba(0,0,0,0.25)",
          background: "rgba(255,255,255,0.7)",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 6 }}>
          Debug • Conteneurs du wizard “Création de foyer”
        </div>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          Utilise les flèches du wizard (ou le swipe sur mobile) pour passer d’une étape à l’autre.
          Les rectangles se recalculent automatiquement (resize/scroll) et tu peux forcer un “Re-scan DOM”.
        </div>
      </div>

      <OnboardingWizard />

      {/* Overlay after the wizard so it can scan the DOM. */}
      {DEBUG_mounted ? <DEBUG_WizardFoyerOverlay /> : null}
    </div>
  );
}
