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
  // Mobile: compact context menu state
  // collapsed  -> shows only "…"
  // main       -> shows return + (+) + (grid)
  // add        -> shows return + (+) + add-type buttons (no grid)
  const [mobileMode, setMobileMode] = useState<"collapsed" | "main" | "add">("collapsed");
  // Optional: nested speed-dial for flow types (opened by the + button).
  const [speedOpen, setSpeedOpen] = useState(false);

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
    const mobileOpen = mobileMode !== "collapsed";
    if (!mobileOpen && !speedOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSpeedOpen(false);
        setMobileMode("collapsed");
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Close if click isn't inside the stack
      if (!t.closest?.(".fabStack")) {
        setSpeedOpen(false);
        setMobileMode("collapsed");
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [mobileMode, speedOpen]);

  useLayoutEffect(() => {
    if (!mounted) return;
    // No top/bottom bars anymore: keep a stable FAB layout.
    setFab({ size: 52, top: 0, bottom: 16, gap: 8, right: 16 });
  }, [mounted]);

  const items = useMemo<FlowType[]>(
    () => ["income", "unitExpense", "rental", "property", "car"],
    []
  );

  const speedDial = mounted && !!onSelectType;
  const mobile = mounted && isMobile();

  // Heuristic: show the "columns filter" shortcut on dashboard pages (Sankey/lines).
  const showColumnsFilter =
    mounted && mobile && typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard");

  const handlePlus = () => {
    if (disabled) return;

    // Mobile: clicking + from "main" goes to "add" (show add-only actions).
    if (mobile) {
      if (mobileMode === "main") {
        setMobileMode("add");
        // In add mode, show type buttons immediately when available.
        if (speedDial) setSpeedOpen(true);
        // If no speed dial, behave like a normal add then collapse.
        if (!speedDial) {
          onClick();
          setMobileMode("collapsed");
        }
        return;
      }
    }

    if (!speedDial) {
      onClick();
      return;
    }
    setSpeedOpen((v) => !v);
  };

  const handleSelect = (t: FlowType) => {
    if (disabled) return;
    onSelectType?.(t);
    setSpeedOpen(false);
    setMobileMode("collapsed");
  };

  const handleMore = () => {
    if (disabled) return;
    // "…" opens the main menu.
    setMobileMode("main");
    setSpeedOpen(false);
  };

  const handleReturn = () => {
    if (disabled) return;
    if (mobileMode === "add") {
      // Back to the main menu (+ + grid)
      setMobileMode("main");
      setSpeedOpen(false);
    } else {
      // Back to collapsed (…)
      setMobileMode("collapsed");
      setSpeedOpen(false);
    }
  };

  const handleColumns = () => {
    if (disabled) return;
    // Let interested pages open their own column picker.
    window.dispatchEvent(new CustomEvent("budget:columns:toggle"));
    // Keep it snappy on mobile.
    setMobileMode("collapsed");
  };


  const showMain = mobile && mobileMode === "main";
  const showAdd = mobile && mobileMode === "add";

  const showTypeActions = speedDial && ((mobile && showAdd) || (!mobile && speedOpen));
  const showGridButton = showColumnsFilter && showMain;
  const showPlusButton = !mobile || showMain;

  const stack = (
    <div
      className={`fabStack ${mobileMode !== "collapsed" || speedOpen ? "fabStackOpen" : ""}`}
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
      {/* Add-type actions (only rendered when visible) */}
      {showTypeActions
        ? items.map((t) => (
            <button
              key={t}
              type="button"
              className="fabAction fabActionShow"
              onClick={() => handleSelect(t)}
              aria-label={`Ajouter : ${typeLabel(t)}`}
              title={`Ajouter : ${typeLabel(t)}`}
              disabled={disabled}
              tabIndex={!disabled ? 0 : -1}
            >
              {typeIcon(t)}
            </button>
          ))
        : null}

      {/* Grid / columns filter (mobile: just above +) */}
      {showGridButton ? (
        <button
          type="button"
          className="fabAction fabActionShow"
          onClick={handleColumns}
          aria-label="Filtrer les colonnes"
          title="Filtrer les colonnes"
          disabled={disabled}
          tabIndex={!disabled ? 0 : -1}
        >
          ▦
        </button>
      ) : null}

      {/* Plus (desktop always, mobile only in main menu) */}
      {showPlusButton ? (
        <button
          type="button"
          className={`fabAdd ${speedDial && speedOpen && !mobile ? "fabAddOpen" : ""} ${mobile ? "fabAddMobile" : ""}`}
          onClick={handlePlus}
          aria-label={ariaLabel}
          title={title}
          disabled={disabled}
        >
          +
        </button>
      ) : null}

      {/* Mobile trigger / return (bottom-right) */}
      {mobile ? (
        mobileMode === "collapsed" ? (
          <button
            type="button"
            className="fabMore"
            onClick={handleMore}
            aria-label="Actions"
            title="Autres actions"
            disabled={disabled}
          >
            …
          </button>
        ) : (
          <button
            type="button"
            className="fabReturn"
            onClick={handleReturn}
            aria-label="Retour"
            title="Retour"
            disabled={disabled}
          >
            <span className="fabReturnGlyph">↩</span>
          </button>
        )
      ) : null}
    </div>
  );


  if (!mounted) return null;
  return createPortal(stack, document.body);
}
