"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type FlowType = "rental" | "property" | "car" | "unitExpense" | "income";

type Props = {
  /** Desktop / fallback action (ex: open the full wizard) */
  onClick: () => void;
  /** When provided, used by the mobile speed-dial buttons */
  onSelectType?: (type: FlowType) => void;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
};

function isMobile() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 720px)").matches;
}

function typeIcon(t: FlowType) {
  switch (t) {
    case "income":
      return "💰";
    case "unitExpense":
      return "💸";
    case "rental":
      return "🏠";
    case "property":
      return "🏡";
    case "car":
      return "🚗";
  }
}

function typeLabel(t: FlowType) {
  switch (t) {
    case "income":
      return "Revenu";
    case "unitExpense":
      return "Dépense unitaire";
    case "rental":
      return "Location";
    case "property":
      return "Propriété";
    case "car":
      return "Voiture";
  }
}

/**
 * Bouton "+" flottant (FAB)
 * - Par défaut : déclenche `onClick`
 * - Quand `onSelectType` est fourni : "speed dial" ( + → 5 types de flux )
 *
 * IMPORTANT (mobile):
 * - Le stack (6 boutons) tient verticalement entre topbar et bottomNav.
 * - On calcule dynamiquement la taille des boutons en fonction de la hauteur dispo.
 */
export default function FloatingPlusButton({
  onClick,
  onSelectType,
  ariaLabel = "Ajouter",
  title = "Ajouter",
  disabled,
}: Props) {
  // In iOS/PWA "standalone" mode, `position: fixed` elements rendered inside
  // an overflow scrolling container may scroll with the content.
  // Rendering the FAB through a portal (to `document.body`) makes it truly fixed.
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  const [fab, setFab] = useState(() => ({
    size: 52,
    top: 72,
    bottom: 88,
    gap: 8,
    right: 16,
  }));

  useEffect(() => setMounted(true), []);

  // Close on route changes / escape / outside click
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Close if click isn't inside the stack
      if (!t.closest?.(".fabStack")) setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!mounted) return;

    const recalc = () => {
      const topbar = document.querySelector<HTMLElement>(".topbar");
      const bottomNav = document.querySelector<HTMLElement>(".bottomNav");

      const topbarH = topbar?.getBoundingClientRect().height ?? 64;
      const bottomH = bottomNav?.getBoundingClientRect().height ?? 0;

      const marginTop = 10;
      const marginBottom = bottomH > 0 ? 10 : 16;
      const gap = 8;
      const nButtons = 6; // + + 5 actions
      const available = Math.max(220, window.innerHeight - (topbarH + bottomH + marginTop + marginBottom));

      // Diameter that fits all buttons + gaps within the available height.
      const raw = Math.floor((available - gap * (nButtons - 1)) / nButtons);

      // Keep it within a nice range (still computed from constraints).
      const size = Math.max(40, Math.min(56, raw));

      setFab({
        size,
        top: Math.round(topbarH + marginTop),
        bottom: Math.round(bottomH + marginBottom),
        gap,
        right: 16,
      });
    };

    recalc();

    window.addEventListener("resize", recalc);
    window.addEventListener("orientationchange", recalc);
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("orientationchange", recalc);
    };
  }, [mounted]);

  const items = useMemo<FlowType[]>(
    () => ["income", "unitExpense", "rental", "property", "car"],
    []
  );

  const speedDial = mounted && !!onSelectType;

  const handlePlus = () => {
    if (disabled) return;
    if (!speedDial) {
      onClick();
      return;
    }
    setOpen((v) => !v);
  };

  const handleSelect = (t: FlowType) => {
    if (disabled) return;
    onSelectType?.(t);
    setOpen(false);
  };

  const stack = (
    <div
      className={`fabStack ${open ? "fabStackOpen" : ""}`}
      style={
        {
          top: fab.top,
          bottom: fab.bottom,
          right: fab.right,
          ["--fabSize" as any]: `${fab.size}px`,
          ["--fabGap" as any]: `${fab.gap}px`,
        } as any
      }
      aria-hidden={disabled ? "true" : undefined}
    >
      {/* actions */}
      {speedDial
        ? items.map((t) => (
            <button
              key={t}
              type="button"
              className={`fabAction ${open ? "fabActionShow" : "fabActionHide"}`}
              onClick={() => handleSelect(t)}
              aria-label={`Ajouter : ${typeLabel(t)}`}
              title={`Ajouter : ${typeLabel(t)}`}
              // When hidden, the buttons must not be clickable nor focusable.
              disabled={disabled || !open}
              tabIndex={open && !disabled ? 0 : -1}
            >
              {typeIcon(t)}
            </button>
          ))
        : null}

      {/* plus */}
      <button
        type="button"
        className={`fabAdd ${speedDial && open ? "fabAddOpen" : ""}`}
        onClick={handlePlus}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
      >
        +
      </button>
    </div>
  );

  if (!mounted) return null;
  return createPortal(stack, document.body);
}
