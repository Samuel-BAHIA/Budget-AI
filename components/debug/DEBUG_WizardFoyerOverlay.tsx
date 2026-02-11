"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DEBUG_Box = {
  DEBUG_id: string;
  DEBUG_label: string;
  DEBUG_selector: string;
  DEBUG_color: string;
  DEBUG_rect: { left: number; top: number; width: number; height: number };
};

type DEBUG_Props = {
  DEBUG_enabled?: boolean;
  DEBUG_showLabels?: boolean;
};

function DEBUG_hashToHsl(DEBUG_input: string) {
  // Simple deterministic hash -> hue (0..359)
  let DEBUG_h = 0;
  for (let DEBUG_i = 0; DEBUG_i < DEBUG_input.length; DEBUG_i++) {
    DEBUG_h = (DEBUG_h * 31 + DEBUG_input.charCodeAt(DEBUG_i)) >>> 0;
  }
  const DEBUG_hue = DEBUG_h % 360;
  return {
    DEBUG_fill: `hsla(${DEBUG_hue}, 85%, 60%, 0.12)`,
    DEBUG_stroke: `hsla(${DEBUG_hue}, 85%, 55%, 0.85)`,
  };
}

function DEBUG_getBreakpoint(DEBUG_w: number) {
  // Keep names simple + web-oriented.
  if (DEBUG_w < 480) return "xs";
  if (DEBUG_w < 768) return "sm";
  if (DEBUG_w < 1024) return "md";
  if (DEBUG_w < 1280) return "lg";
  if (DEBUG_w < 1536) return "xl";
  return "2xl";
}

export default function DEBUG_WizardFoyerOverlay({ DEBUG_enabled = true, DEBUG_showLabels = true }: DEBUG_Props) {
  const [DEBUG_boxes, setDEBUG_boxes] = useState<DEBUG_Box[]>([]);
  const [DEBUG_show, setDEBUG_show] = useState(DEBUG_enabled);
  const [DEBUG_labels, setDEBUG_labels] = useState(DEBUG_showLabels);
  const DEBUG_tickRef = useRef<number | null>(null);

  const DEBUG_targets = useMemo(
    () =>
      [
        { DEBUG_id: "topbar", DEBUG_label: "Topbar", DEBUG_selector: ".topbar" },
        { DEBUG_id: "breadcrumbs", DEBUG_label: "Breadcrumbs (desktop)", DEBUG_selector: ".breadcrumbsDesktopOnly" },
        { DEBUG_id: "main", DEBUG_label: "Main", DEBUG_selector: ".main" },
        { DEBUG_id: "bottomNav", DEBUG_label: "Bottom nav", DEBUG_selector: ".bottomNav" },
        { DEBUG_id: "wizardWrap", DEBUG_label: "Wizard • wrap", DEBUG_selector: ".wizardWrap" },
        { DEBUG_id: "wizardLayout", DEBUG_label: "Wizard • layout", DEBUG_selector: ".wizardLayout" },
        { DEBUG_id: "wizardSidebar", DEBUG_label: "Wizard • sidebar card", DEBUG_selector: ".wizardLayout > .card:first-child" },
        { DEBUG_id: "wizardContent", DEBUG_label: "Wizard • content card", DEBUG_selector: ".wizardContentCard" },
        { DEBUG_id: "wizardViewport", DEBUG_label: "Wizard • viewport", DEBUG_selector: ".wizardViewport" },
        { DEBUG_id: "wizardStepAnim", DEBUG_label: "Wizard • step anim", DEBUG_selector: ".wizardStepAnim" },
        { DEBUG_id: "wizardPanel", DEBUG_label: "Wizard • panel", DEBUG_selector: ".wizardPanel" },
        { DEBUG_id: "wizardNav", DEBUG_label: "Wizard • nav", DEBUG_selector: ".wizardNav" },
      ] as const,
    []
  );

  const DEBUG_recalc = () => {
    if (!DEBUG_show) {
      setDEBUG_boxes([]);
      return;
    }

    const DEBUG_next: DEBUG_Box[] = [];
    for (const DEBUG_t of DEBUG_targets) {
      const DEBUG_el = document.querySelector(DEBUG_t.DEBUG_selector) as HTMLElement | null;
      if (!DEBUG_el) continue;

      const DEBUG_r = DEBUG_el.getBoundingClientRect();
      const DEBUG_pageLeft = DEBUG_r.left + window.scrollX;
      const DEBUG_pageTop = DEBUG_r.top + window.scrollY;
      const DEBUG_colors = DEBUG_hashToHsl(DEBUG_t.DEBUG_id);

      DEBUG_next.push({
        DEBUG_id: DEBUG_t.DEBUG_id,
        DEBUG_label: DEBUG_t.DEBUG_label,
        DEBUG_selector: DEBUG_t.DEBUG_selector,
        DEBUG_color: DEBUG_colors.DEBUG_stroke,
        DEBUG_rect: {
          left: Math.round(DEBUG_pageLeft),
          top: Math.round(DEBUG_pageTop),
          width: Math.round(DEBUG_r.width),
          height: Math.round(DEBUG_r.height),
        },
      });
    }

    setDEBUG_boxes(DEBUG_next);
  };

  const DEBUG_schedule = () => {
    if (DEBUG_tickRef.current != null) return;
    DEBUG_tickRef.current = window.requestAnimationFrame(() => {
      DEBUG_tickRef.current = null;
      DEBUG_recalc();
    });
  };

  useEffect(() => {
    DEBUG_recalc();
    const DEBUG_onResize = () => DEBUG_schedule();
    const DEBUG_onScroll = () => DEBUG_schedule();

    window.addEventListener("resize", DEBUG_onResize);
    window.addEventListener("scroll", DEBUG_onScroll, { passive: true });
    return () => {
      window.removeEventListener("resize", DEBUG_onResize);
      window.removeEventListener("scroll", DEBUG_onScroll);
      if (DEBUG_tickRef.current != null) window.cancelAnimationFrame(DEBUG_tickRef.current);
      DEBUG_tickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DEBUG_show]);

  useEffect(() => {
    // Recalc after toggles to avoid 1-frame mismatch.
    DEBUG_schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DEBUG_labels]);

  const DEBUG_viewW = typeof window !== "undefined" ? window.innerWidth : 0;
  const DEBUG_viewH = typeof window !== "undefined" ? window.innerHeight : 0;
  const DEBUG_bp = DEBUG_getBreakpoint(DEBUG_viewW);

  return (
    <>
      {/* Floating controls (web debug) */}
      <div
        style={{
          position: "fixed",
          right: 12,
          top: 64,
          zIndex: 99999,
          display: "grid",
          gap: 8,
          pointerEvents: "auto",
        }}
      >
        <div
          style={{
            background: "rgba(0,0,0,0.75)",
            color: "white",
            borderRadius: 12,
            padding: 10,
            width: 220,
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: 0.4, opacity: 0.95 }}>
            DEBUG • Overlays
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 12, opacity: 0.9 }}>Afficher rectangles</span>
              <input
                type="checkbox"
                checked={DEBUG_show}
                onChange={(e) => setDEBUG_show(e.target.checked)}
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 12, opacity: 0.9 }}>Labels</span>
              <input
                type="checkbox"
                checked={DEBUG_labels}
                onChange={(e) => setDEBUG_labels(e.target.checked)}
              />
            </label>

            <button
              type="button"
              onClick={() => DEBUG_recalc()}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.25)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Re-scan DOM
            </button>
          </div>
        </div>
      </div>

      {/* Overlay layer */}
      {DEBUG_show ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 99998,
          }}
        >
          {DEBUG_boxes.map((DEBUG_b) => {
            const DEBUG_colors = DEBUG_hashToHsl(DEBUG_b.DEBUG_id);
            return (
              <div
                key={DEBUG_b.DEBUG_id}
                style={{
                  position: "absolute",
                  left: DEBUG_b.DEBUG_rect.left,
                  top: DEBUG_b.DEBUG_rect.top,
                  width: DEBUG_b.DEBUG_rect.width,
                  height: DEBUG_b.DEBUG_rect.height,
                  border: `2px solid ${DEBUG_colors.DEBUG_stroke}`,
                  background: DEBUG_colors.DEBUG_fill,
                  borderRadius: 10,
                  boxSizing: "border-box",
                }}
              >
                {DEBUG_labels ? (
                  <div
                    style={{
                      position: "absolute",
                      left: 6,
                      bottom: 6,
                      fontSize: 11,
                      fontWeight: 800,
                      color: "rgba(0,0,0,0.75)",
                      background: "rgba(255,255,255,0.75)",
                      padding: "3px 6px",
                      borderRadius: 8,
                      maxWidth: "calc(100% - 12px)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={DEBUG_b.DEBUG_selector}
                  >
                    {DEBUG_b.DEBUG_label}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Breakpoints bar */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 99999,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            margin: 8,
            borderRadius: 12,
            padding: "8px 10px",
            background: "rgba(0,0,0,0.75)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 900, letterSpacing: 0.4 }}>Breakpoint:</span>
            <span style={{ fontWeight: 900 }}>{DEBUG_bp}</span>
          </div>
          <div style={{ opacity: 0.95 }}>
            {DEBUG_viewW}×{DEBUG_viewH}
          </div>
        </div>
      </div>
    </>
  );
}
