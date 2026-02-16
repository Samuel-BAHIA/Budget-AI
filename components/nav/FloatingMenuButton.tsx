"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  mode: "menu" | "quit";
  onClick: () => void;
};

/**
 * Bottom-left floating button.
 * - Default: "☰" opens the sidebar menu
 * - Wizard: "×" triggers a quit flow (handled by the wizard)
 */
export default function FloatingMenuButton({ mode, onClick }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const label = mode === "quit" ? "Quitter l’assistant" : "Ouvrir le menu";
  const icon = mode === "quit" ? "×" : "☰";

  const btn = (
    <button
      type="button"
      className={`menuFab ${mode === "quit" ? "menuFabQuit" : "menuFabMenu"}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ bottom: 16 }}
    >
      <span className="menuFabIcon" aria-hidden="true">
        {icon}
      </span>
    </button>
  );

  return createPortal(btn, document.body);
}
