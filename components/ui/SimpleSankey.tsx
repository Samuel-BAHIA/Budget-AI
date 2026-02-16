"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type SankeyStage = number;

export type SankeyNodeInput = {
  id: string;
  label: string;
  stage: SankeyStage;
};

export type SankeyLinkInput = {
  source: string;
  target: string;
  value: number;
};

type NodeLayout = {
  id: string;
  label: string;
  stage: SankeyStage;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

type LinkLayout = {
  source: string;
  target: string;
  value: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sw: number;
  colorHint: string;
};

// NOTE: Creating Intl.NumberFormat is relatively expensive.
// Keep a single instance at module scope so re-renders stay snappy.
const EUR_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function formatValue(v: number) {
  return EUR_FORMATTER.format(v);
}

const PALETTES = {
  revenue: [
    "rgba(22, 163, 74, 0.95)",   // green-600-ish
    "rgba(34, 197, 94, 0.95)",   // green-500-ish
    "rgba(74, 222, 128, 0.95)",  // green-400-ish
    "rgba(134, 239, 172, 0.95)", // green-300-ish
  ],
  expense: [
    "rgba(220, 38, 38, 0.95)",   // red-600-ish
    "rgba(239, 68, 68, 0.95)",   // red-500-ish
    "rgba(248, 113, 113, 0.95)", // red-400-ish
    "rgba(252, 165, 165, 0.95)", // red-300-ish
  ],
  saving: [
    "rgba(37, 99, 235, 0.95)",   // blue-600-ish
    "rgba(59, 130, 246, 0.95)",  // blue-500-ish
    "rgba(96, 165, 250, 0.95)",  // blue-400-ish
  ],
} as const;

const PALETTE_LINK = {
  revenue: "rgba(34, 197, 94, 0.45)",
  expense: "rgba(239, 68, 68, 0.40)",
  saving: "rgba(59, 130, 246, 0.40)",
} as const;

function hashIndex(id: string, mod: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return mod <= 0 ? 0 : h % mod;
}

function nodeKind(id: string, label: string, stage: number): "revenue" | "expense" | "saving" {
  const t = (label ?? "").toLowerCase();

  // Explicit balance nodes
  if (id === "bal:saving") return "saving";
  if (id === "bal:overdraft") return "saving";

  // Legacy / fallback
  if (id === "dep:detail:reste") return "saving";

  if (t.includes("épargne") || t.includes("epargne") || t.includes("reste") || t.includes("découvert") || t.includes("decouvert")) return "saving";

  // Revenus are always prefixed with rev:
  if (id.startsWith("rev:")) return "revenue";

  // Everything "dep:" is expense (including dep:total / detail / type / owner / obj)
  if (id.startsWith("dep:")) return "expense";

  // Fallback by stage
  if (stage <= 2) return "revenue";
  return "expense";
}

function nodeColor(id: string, label: string, stage: number) {
  const kind = nodeKind(id, label, stage);
  const palette = PALETTES[kind];
  // total nodes slightly darker
  const isTotal = id.endsWith(":total") || id === "rev:total" || (label ?? "").toLowerCase().includes("(total)");
  const idx = isTotal ? 0 : hashIndex(id, palette.length);
  return { kind, fill: palette[Math.min(idx, palette.length - 1)] };
}

function linkColor(source: string, target: string, sourceLabel: string, targetLabel: string, sourceStage: number, targetStage: number) {
  // color links primarily by the TARGET meaning (looks better as it "flows into" the destination bucket)
  const kind = nodeKind(target, targetLabel, targetStage);
  return PALETTE_LINK[kind];
}

function useResizeObserver<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [rect, setRect] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const cr = e.contentRect;
      setRect({ width: cr.width, height: cr.height });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, rect };
}

export default function SimpleSankey(props: {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
  stageLabels?: string[];
  /** If true, the chart expands to fill its container (recommended). */
  fit?: boolean;
  /** Used when fit=false, or as a fallback when container size is not known yet. */
  width?: number;
  /** Used when fit=false, or as a fallback when container size is not known yet. */
  height?: number;
  nodeWidth?: number;
  nodePadding?: number;
  /** Optional node click handler (receives the input node + computed value). */
  onNodeClick?: (node: SankeyNodeInput & { value: number }) => void;
  /** Extra vertical padding inside the drawing area (top + bottom). */
  vPadding?: number;
  /** Better UX on mobile: keeps the diagram readable with horizontal scroll (default: true). */
  mobileFriendly?: boolean;
  /**
   * If true, the diagram can grow taller than its container and becomes vertically scrollable.
   * Useful when there are many nodes (prevents label overlaps).
   */
  scrollY?: boolean;
  /** Minimum visual row height used when scrollY is enabled (px). */
  minRowHeight?: number;
  /** Optional group titles spanning multiple stages (e.g. "Revenus", "Dépenses"). */
  groupLabels?: { label: string; fromStage: number; toStage: number }[];
}) {
  const nodeWidth = props.nodeWidth ?? 18;
  const nodePadding = props.nodePadding ?? 18;
  // Space reserved at top/bottom for headers and breathing room.
  // Increased to avoid the stage subtitles being visually glued to the first row of nodes.
  const vPadding = props.vPadding ?? 76;
  const scrollY = props.scrollY ?? false;
  const minRowHeight = props.minRowHeight ?? 26;

  const { ref, rect } = useResizeObserver<HTMLDivElement>();

  const mobileFriendly = props.mobileFriendly ?? true;
  const isNarrow = mobileFriendly ? (rect?.width ?? 9999) < 640 : false;

  // Mobile: allow vertical page scrolling even when the finger is on the Sankey.
  // We only capture the gesture when the intent is clearly horizontal.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isNarrow) return;
    const el = scrollRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let locked: "x" | "y" | null = null;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = lastX = t.clientX;
      startY = t.clientY;
      locked = null;
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;

      const dxTotal = t.clientX - startX;
      const dyTotal = t.clientY - startY;

      if (!locked) {
        const ax = Math.abs(dxTotal);
        const ay = Math.abs(dyTotal);
        // Small threshold to avoid jitter locking.
        if (ax < 6 && ay < 6) return;
        locked = ax > ay ? "x" : "y";
      }

      if (locked === "x") {
        // Take over the gesture: prevent the page from scrolling vertically.
        e.preventDefault();
        const dx = t.clientX - lastX;
        el.scrollLeft -= dx;
      }

      lastX = t.clientX;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, [isNarrow]);

  // Extra space on the right so the last stage (whose labels are rendered to the right)
  // never gets clipped by rounded containers / viewport edges.
  const rightGutter = isNarrow ? 0 : 140;

  // Base (natural) diagram size. On mobile, we keep a stable base size so the SVG is not squished.
  const baseWidth = props.width ?? 980;
  const baseHeight = props.height ?? 560;

  // When scrollY is enabled (desktop/tablet), compute a data-driven height so columns have enough space.
  // We use the max node count in a stage as the constraint. This is intentionally simple and predictable.
  const autoHeight = useMemo(() => {
    if (!scrollY) return null;
    const maxStage = Math.max(0, ...props.nodes.map((n) => n.stage));
    const byStage: number[] = Array.from({ length: maxStage + 1 }, () => 0);
    for (const n of props.nodes) byStage[n.stage]++;
    const maxCount = Math.max(1, ...byStage);
    const pads = Math.max(0, maxCount - 1) * nodePadding;
    const rows = maxCount * minRowHeight;
    return Math.max(baseHeight, vPadding * 2 + pads + rows);
  }, [scrollY, props.nodes, nodePadding, minRowHeight, vPadding, baseHeight]);

  // Layout width (where nodes are actually placed). We keep this bound to the
  // visible container width so stage spacing remains predictable.
  const layoutWidth = props.fit ? (isNarrow ? baseWidth : (rect?.width ?? baseWidth)) : baseWidth;

  // SVG width may be larger than the layout width so the last stage labels have
  // room (and can be horizontally scrolled if needed).
  const svgWidth = isNarrow ? baseWidth : layoutWidth + rightGutter;

  // Height rules:
  // - Mobile: always use baseHeight so the user can scroll/zoom inside.
  // - Desktop without scrollY: fill container height.
  // - Desktop with scrollY: use autoHeight (can exceed container) so we can scroll vertically.
  const height = props.fit
    ? isNarrow
      ? baseHeight
      : scrollY
        ? (autoHeight ?? (rect?.height ?? baseHeight))
        : (rect?.height ?? baseHeight)
    : (props.height ?? baseHeight);

  // Zoom is disabled (mobile uses horizontal scroll only).
  const zoom = 1;

  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hoverLinkKey, setHoverLinkKey] = useState<string | null>(null);

  const { nodeLayouts, linkLayouts, maxStage, stageLabels, stageBounds, requiredHeight, splitPct } = useMemo(() => {
    const inSum = new Map<string, number>();
    const outSum = new Map<string, number>();

    for (const l of props.links) {
      outSum.set(l.source, (outSum.get(l.source) ?? 0) + l.value);
      inSum.set(l.target, (inSum.get(l.target) ?? 0) + l.value);
    }

    const maxStage = Math.max(...props.nodes.map((n) => n.stage));
    const stages: SankeyNodeInput[][] = Array.from({ length: maxStage + 1 }, () => []);
    for (const n of props.nodes) stages[n.stage].push(n);

    const valueOf = (id: string) => Math.max(inSum.get(id) ?? 0, outSum.get(id) ?? 0);

    // Nodes that should always stay at the bottom of their column, even if they are large.
    // (e.g. "Reste / Épargne" at the very end)
    const pinToBottom = (n: SankeyNodeInput) => {
      if (n.id === "dep:detail:reste") return true;
      const t = (n.label ?? "").toLowerCase();
      return t.includes("reste") || t.includes("épargne") || t.includes("epargne");
    };

    // Scale vertically so the most-loaded stage fits in the available height.
    // Important: we must account for `nodePadding` too, otherwise the column can overflow when
    // there are many nodes.
    const stageTotals = stages.map((arr) => arr.reduce((acc, n) => acc + valueOf(n.id), 0));
    const usableH = Math.max(120, height - vPadding * 2);

    // Compute ky per stage (remove vertical paddings between nodes from the available height),
    // then take the minimum ky so EVERY column fits the container height.
    const kyByStage = stages.map((arr, idx) => {
      const total = Math.max(stageTotals[idx] ?? 0, 1);
      const count = arr.length;
      const pad = Math.max(0, count - 1) * nodePadding;
      const avail = Math.max(60, usableH - pad);
      return avail / total;
    });
    const ky = Math.max(0.00001, Math.min(...kyByStage));
    const stageY0 = vPadding;

    // Spread stages across available width so the diagram always fills the container.
    // IMPORTANT (mobile): keep margins SYMMETRIC so the left and right "détail" columns
    // sit at the same distance from the screen edge. Clipping issues should be handled by
    // the outer scroll container padding (debug) rather than an asymmetric SVG margin.
    const marginLeft = 24;
    const marginRight = 24;
    const colStep =
      maxStage > 0 ? (Math.max(320, layoutWidth) - marginLeft - marginRight - nodeWidth) / maxStage : 0;

    const nodeLayouts: NodeLayout[] = [];
    for (let s = 0; s < stages.length; s++) {
      const col = stages[s]
        .slice()
        .sort((a, b) => {
          const ap = pinToBottom(a);
          const bp = pinToBottom(b);
          if (ap !== bp) return ap ? 1 : -1; // pinned nodes go last
          return valueOf(b.id) - valueOf(a.id); // otherwise: biggest first
        });
      let y = stageY0;

      for (let i = 0; i < col.length; i++) {
        const n = col[i];
        const v = valueOf(n.id);
        const h = Math.max(10, v * ky);
        nodeLayouts.push({
          id: n.id,
          label: n.label,
          stage: n.stage,
          value: v,
          x: marginLeft + s * colStep,
          y,
          w: nodeWidth,
          h,
        });
        // Important: only add padding BETWEEN nodes.
        // Adding padding after the last node makes the column overflow by one padding step.
        y += h;
        if (i < col.length - 1) y += nodePadding;
      }
    }

    const layoutById = new Map(nodeLayouts.map((n) => [n.id, n] as const));

    // --- Link ordering matters a lot for how "straight" ribbons look.
    // We stack link bands inside each node using running offsets.
    // If links are processed in an order unrelated to how nodes are positioned,
    // a large flow can "enter" a tall node lower/higher than its source, causing
    // unnecessary curvature.
    //
    // Strategy:
    // - For links that share the same TARGET, sort by the SOURCE y (top → bottom)
    //   so they enter the target in the same vertical order as their sources.
    // - For links that share the same SOURCE, sort by the TARGET y (top → bottom)
    //   so they leave the source in the same vertical order as their destinations.
    // This keeps big/obvious flows (e.g. Revenus détaillés → Revenus total, Revenus total → Fixes/Variables)
    // visually much straighter without changing node order.
    const sortedLinks = props.links
      .slice()
      .sort((a, b) => {
        const sa = layoutById.get(a.source);
        const ta = layoutById.get(a.target);
        const sb = layoutById.get(b.source);
        const tb = layoutById.get(b.target);
        if (!sa || !ta || !sb || !tb) return 0;

        // Same target: sort by source y
        if (a.target === b.target) {
          if (sa.y !== sb.y) return sa.y - sb.y;
          // tie-breaker: bigger first (helps large flows be near the "center" of gravity)
          if (b.value !== a.value) return b.value - a.value;
          return a.source.localeCompare(b.source);
        }

        // Same source: sort by target y
        if (a.source === b.source) {
          if (ta.y !== tb.y) return ta.y - tb.y;
          if (b.value !== a.value) return b.value - a.value;
          return a.target.localeCompare(b.target);
        }

        // Otherwise: keep stages flowing left→right, then stable by y.
        if (sa.stage !== sb.stage) return sa.stage - sb.stage;
        if (ta.stage !== tb.stage) return ta.stage - tb.stage;
        if (sa.y !== sb.y) return sa.y - sb.y;
        if (ta.y !== tb.y) return ta.y - tb.y;
        return `${a.source}→${a.target}`.localeCompare(`${b.source}→${b.target}`);
      });

    // Running offsets for stacking links inside each node.
    const outOffset = new Map<string, number>();
    const inOffset = new Map<string, number>();

    const linkLayouts: LinkLayout[] = [];
    for (const l of sortedLinks) {
      const sn = layoutById.get(l.source);
      const tn = layoutById.get(l.target);
      if (!sn || !tn) continue;

      const so = outOffset.get(l.source) ?? 0;
      const to = inOffset.get(l.target) ?? 0;

      const sw = Math.max(1.5, l.value * ky);

      const sx = sn.x + sn.w;
      const sy = sn.y + so + sw / 2;

      const tx = tn.x;
      const ty = tn.y + to + sw / 2;

      outOffset.set(l.source, so + sw);
      inOffset.set(l.target, to + sw);

      const colorHint = linkColor(l.source, l.target, sn.label, tn.label, sn.stage, tn.stage);
      linkLayouts.push({ source: l.source, target: l.target, value: l.value, sx, sy, tx, ty, sw, colorHint });
    }

    const stageLabels =
      props.stageLabels && props.stageLabels.length >= maxStage + 1
        ? props.stageLabels.slice(0, maxStage + 1)
        : Array.from({ length: maxStage + 1 }, () => "");

    // Compute per-stage X bounds (useful for stage background debugging).
    const stageBounds = Array.from({ length: maxStage + 1 }, (_, s) => {
      const col = nodeLayouts.filter((n) => n.stage === s);
      const x0 = col.length ? Math.min(...col.map((n) => n.x)) : 0;
      const x1 = col.length ? Math.max(...col.map((n) => n.x + n.w)) : 0;
      return { stage: s, x0, x1 };
    });

    // Background split point (green -> red) for the Sankey frame.
    // We want the color transition to happen BETWEEN the two middle TOTAL columns.
    // Default to 50% if we can't infer it.
    const splitPx = (() => {
      // The "green -> red" switch must sit BETWEEN the two TOTAL columns.
      // In the full view there are 3 stages (detail -> TOTAL -> TOTAL -> detail),
      // but in the simplified view there are only 2 stages (TOTAL -> TOTAL).
      // So we compute the midpoint between the right edge of the left TOTAL-stage
      // and the left edge of the right TOTAL-stage.
      if (maxStage < 1) return layoutWidth / 2;

      const leftStage = maxStage >= 2 ? 1 : 0;
      const rightStage = maxStage >= 2 ? 2 : 1;

      const bL = stageBounds[leftStage];
      const bR = stageBounds[rightStage];
      if (!bL || !bR) return layoutWidth / 2;

      const mid = (bL.x1 + bR.x0) / 2;
      // Clamp inside the drawable area
      return Math.min(layoutWidth, Math.max(0, mid));
    })();
    // IMPORTANT: the scrollable background width is NOT always `layoutWidth`.
    // On desktop/tablet we often render a wider SVG (e.g. `rightGutter`) so right-side
    // labels do not get clipped. The gradient must be computed in the same coordinate
    // system as the scrollable background, otherwise the midpoint will look "off".
    const bgWidth = isNarrow ? baseWidth : svgWidth;
    const splitPct = Math.min(95, Math.max(5, (splitPx / Math.max(1, bgWidth)) * 100));

        // Height safety: if something went wrong in the ky computation (or labels/padding change),
    // ensure the SVG is always tall enough to contain the lowest node.
    const maxY = nodeLayouts.reduce((acc, n) => Math.max(acc, n.y + n.h), 0);
    const requiredHeight = Math.ceil(maxY + vPadding);

    return { nodeLayouts, linkLayouts, maxStage, stageLabels, stageBounds, requiredHeight, splitPct };
  }, [props.links, props.nodes, props.stageLabels, layoutWidth, svgWidth, baseWidth, isNarrow, height, nodePadding, nodeWidth, vPadding]);

  // Final SVG height: in scrollY mode we allow the chart to grow to its required height.
  // This prevents the last node from being clipped even if paddings/labels change.
  const finalHeight = scrollY ? Math.max(height, requiredHeight ?? height) : height;

  const layoutById = useMemo(() => new Map(nodeLayouts.map((n) => [n.id, n] as const)), [nodeLayouts]);

  const isNodeDim = (n: NodeLayout) => {
    if (!hoverNodeId && !hoverLinkKey) return false;

    if (hoverNodeId) {
      if (n.id === hoverNodeId) return false;

      // keep neighbors brighter
      const neighbor = props.links.some((l) => (l.source === hoverNodeId && l.target === n.id) || (l.target === hoverNodeId && l.source === n.id));
      return !neighbor;
    }

    if (hoverLinkKey) {
      const [s, t] = hoverLinkKey.split("→");
      return n.id !== s && n.id !== t;
    }

    return false;
  };

  const isLinkDim = (l: LinkLayout) => {
    if (!hoverNodeId && !hoverLinkKey) return false;

    if (hoverLinkKey) return `${l.source}→${l.target}` !== hoverLinkKey;
    if (!hoverNodeId) return false;
    return l.source !== hoverNodeId && l.target !== hoverNodeId;
  };

  // Draw a smooth ribbon (two Beziers) with thickness sw.
  const ribbonPath = (sx: number, sy: number, tx: number, ty: number, w: number) => {
    const dx = tx - sx;
    const c1x = sx + dx * 0.45;
    const c2x = sx + dx * 0.55;

    const y0 = sy - w / 2;
    const y1 = sy + w / 2;
    const y2 = ty - w / 2;
    const y3 = ty + w / 2;

    return [
      `M ${sx} ${y0}`,
      `C ${c1x} ${y0}, ${c2x} ${y2}, ${tx} ${y2}`,
      `L ${tx} ${y3}`,
      `C ${c2x} ${y3}, ${c1x} ${y1}, ${sx} ${y1}`,
      "Z",
    ].join(" ");
  };

  const viewBox = `0 0 ${Math.max(1, svgWidth)} ${Math.max(1, finalHeight)}`;

  const [tapInfo, setTapInfo] = useState<null | { title: string; detail: string }>(null);

  // Mobile: instead of a popup card, show a bottom sheet ("languette").
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetPx, setSheetPx] = useState<number>(64); // current sheet height (collapsed by default)
  const dragRef = useRef<{
    startY: number;
    startH: number;
    dragging: boolean;
  } | null>(null);

  // On narrow screens, hovering doesn't exist. We show the last tapped item in a small info panel.
  const showTapInfo = (title: string, detail: string) => {
    if (!isNarrow) return;
    setTapInfo({ title, detail });
    // Start collapsed so the user can pull the "languette" for more.
    setSheetOpen(false);
    setSheetPx(64);
  };

  const sheetCollapsed = 64;
  // Best-effort max height for the sheet on mobile.
  const sheetMax = Math.max(
    220,
    Math.min(420, Math.round(((typeof window !== "undefined" ? window.innerHeight : 720) * 0.46)))
  );

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const stageKindOf = (stage: number): "revenue" | "expense" | "saving" => {
    // If group labels are provided, use them to color headers consistently.
    for (const g of props.groupLabels ?? []) {
      if (stage >= g.fromStage && stage <= g.toStage) {
        const t = (g.label ?? "").toLowerCase();
        if (t.includes("revenu")) return "revenue";
        if (t.includes("dépense") || t.includes("depense")) return "expense";
        if (t.includes("épargne") || t.includes("epargne") || t.includes("solde")) return "saving";
      }
    }
    // Fallback: infer from the stage label text when available.
    const lbl = (stageLabels?.[stage] ?? "").toLowerCase();
    if (lbl.includes("reven")) return "revenue";
    if (lbl.includes("dép") || lbl.includes("dep")) return "expense";
    if (lbl.includes("épargne") || lbl.includes("epargne") || lbl.includes("solde")) return "saving";
    return stage <= 2 ? "revenue" : "expense";
  };

  const headerFill = (kind: "revenue" | "expense" | "saving", strong: boolean) => {
    if (kind === "revenue") return strong ? "rgba(22, 163, 74, 0.95)" : "rgba(22, 163, 74, 0.72)";
    if (kind === "expense") return strong ? "rgba(220, 38, 38, 0.95)" : "rgba(220, 38, 38, 0.70)";
    return strong ? "rgba(37, 99, 235, 0.95)" : "rgba(37, 99, 235, 0.70)";
  };

  // Background gradient: green (revenus) -> red (dépenses), with the switch located
  // between the two TOTAL columns. IMPORTANT: apply this background INSIDE the
  // horizontally scrollable area so it scrolls with the diagram on mobile.
  const clampPct = (v: number) => Math.max(0, Math.min(100, v));
  const bandOuter = isNarrow ? 14 : 12; // wider, more progressive transition band
  const bandInner = isNarrow ? 6 : 5;

  const scrollableBackground = `linear-gradient(90deg,
    rgba(34, 197, 94, 0.18) 0%,
    rgba(34, 197, 94, 0.18) ${clampPct(splitPct - bandOuter)}%,
    rgba(34, 197, 94, 0.12) ${clampPct(splitPct - bandInner)}%,
    rgba(245, 158, 11, 0.10) ${clampPct(splitPct)}%,
    rgba(239, 68, 68, 0.12) ${clampPct(splitPct + bandInner)}%,
    rgba(239, 68, 68, 0.18) ${clampPct(splitPct + bandOuter)}%,
    rgba(239, 68, 68, 0.18) 100%)`;

  return (
    <div
      ref={ref}
      className="card sankeyCard"
      style={{
        padding: isNarrow ? 0 : 14,
        width: "100%",
        // Mobile: we still stretch the container to fill the available viewport area.
        // The diagram itself keeps its natural height; extra space is used to center it.
        height: "100%",
        position: "relative",
        // IMPORTANT: The header (stage labels) sits above the diagram.
        // If we don't use a flex column layout, the diagram area can be clipped
        // when it needs more vertical space.
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="sankeyFrame"
        style={{
          ["--sankey-rev" as any]: "rgba(34, 197, 94, 0.45)",
          ["--sankey-exp" as any]: "rgba(239, 68, 68, 0.40)",
          ["--sankey-sav" as any]: "rgba(59, 130, 246, 0.40)",
          position: "relative",
          borderRadius: isNarrow ? 0 : 12,
          // IMPORTANT: do NOT clip here. Clipping would cut the last stage labels.
          overflow: "visible",
          background: "transparent",
          // Desktop: allow vertical scrolling inside the diagram when needed.
          // Mobile: keep natural height; only horizontal scrolling is allowed.
          flex: "1 1 auto",
          minHeight: isNarrow ? undefined : 0,
        }}
      >
        {/*
          Mobile: keep a natural diagram size (no squish) and let the user scroll horizontally.
          Desktop: fill container.
        */}
        <div
          ref={scrollRef}
          className="sankeyScroll"
          style={{
            width: "100%",
            height: "100%",
            overflowX: "auto",
            overflowY: isNarrow ? "hidden" : "auto",
            WebkitOverflowScrolling: "touch",
            // On mobile we want vertical scroll to bubble to the page; horizontal pan is handled via touch listeners.
            touchAction: isNarrow ? "pan-y" : "pan-x pan-y",
            overscrollBehaviorX: "contain",
            borderRadius: 12,
          }}
        >
          <div
            style={
              isNarrow
                ? {
                    width: baseWidth,
                    height: baseHeight,
                    background: scrollableBackground,
                    position: "relative",
                  }
                : {
                    width: svgWidth,
                    height,
                    background: scrollableBackground,
                    position: "relative",
                  }
            }
          >
            {/*
              BIG BACKGROUND LABELS (scrollable): make the green/red meaning obvious
              without relying on generic header tags.
              This overlay sits inside the scrollable content so it moves with the diagram.
            */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                gridTemplateColumns: `${Math.max(0, Math.min(100, splitPct))}% ${Math.max(
                  0,
                  100 - Math.max(0, Math.min(100, splitPct))
                )}%`,
                pointerEvents: "none",
                userSelect: "none",
                zIndex: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  paddingBottom: isNarrow ? 18 : 22,
                  fontSize: isNarrow ? 22 : 26,
                  fontWeight: 950,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: "rgba(16, 185, 129, 0.22)",
                  textShadow: "0 1px 0 rgba(0,0,0,0.15)",
                }}
              >
                REVENUS
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  paddingBottom: isNarrow ? 18 : 22,
                  fontSize: isNarrow ? 22 : 26,
                  fontWeight: 950,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: "rgba(239, 68, 68, 0.20)",
                  textShadow: "0 1px 0 rgba(0,0,0,0.15)",
                }}
              >
                DEPENSES
              </div>
            </div>

            <svg
              className="sankeySvg"
              viewBox={viewBox}
              width={isNarrow ? baseWidth : svgWidth}
              height={isNarrow ? baseHeight : finalHeight}
              style={{ display: "block", position: "relative", zIndex: 1 }}
              preserveAspectRatio="xMinYMin meet"
            >
              <defs>
                {/* Special gradients for key balance flows */}
                <linearGradient id="grad-rev-to-exp" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#1f9d55" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#d04b4b" stopOpacity={0.95} />
                </linearGradient>
                <linearGradient id="grad-rev-to-save" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#1f9d55" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.95} />
                </linearGradient>

                {/* Subtle depth for nodes (modern "card" feel) */}
                <filter id="sankeyNodeShadow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="rgba(0,0,0,0.18)" />
                </filter>
                <filter id="sankeyNodeShadowHover" x="-40%" y="-40%" width="180%" height="180%">
                  <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="rgba(0,0,0,0.22)" />
                </filter>
              </defs>

          {/* Titles (drawn inside the SVG to avoid duplicate header rows) */}
          <g>
            {/* Group titles */}
            {(props.groupLabels ?? []).map((g, idx) => {
              const from = stageBounds.find((b) => b.stage === g.fromStage);
              const to = stageBounds.find((b) => b.stage === g.toStage);
              if (!from || !to) return null;
              const mid = (from.x0 + to.x1) / 2;
              return (
                <text
                  key={`group-title-${idx}`}
                  x={mid}
                  y={26}
                  textAnchor="middle"
                  fill={headerFill(stageKindOf(g.fromStage), true)}
                  style={{ fontSize: 16, fontWeight: 950, opacity: 0.95, letterSpacing: 0.2 }}
                >
                  {g.label}
                </text>
              );
            })}

            {/* Stage titles */}
            {stageBounds.map((b) => {
              const label = stageLabels[b.stage] ?? "";
              if (!label) return null;
              // Center subtitles above their column.
              const mid = (b.x0 + b.x1) / 2;
              return (
                <text
                  key={`stage-title-${b.stage}`}
                  x={mid}
                  y={60}
                  textAnchor="middle"
                  fill={headerFill(stageKindOf(b.stage), false)}
                  style={{ fontSize: 13, fontWeight: 900, opacity: 0.95, letterSpacing: 0.2 }}
                >
                  {label}
                </text>
              );
            })}
          </g>

          {/* Links */}
          {linkLayouts.map((l) => {
            const key = `${l.source}→${l.target}`;
            const dim = isLinkDim(l);
            const d = ribbonPath(l.sx, l.sy, l.tx, l.ty, l.sw);

            const specialFill =
              l.source === "rev:total" && l.target === "dep:total"
                ? "url(#grad-rev-to-exp)"
                : l.source === "rev:total" && l.target === "bal:saving"
                  ? "url(#grad-rev-to-save)"
                  : null;

            const srcLabel = layoutById.get(l.source)?.label ?? l.source;
            const dstLabel = layoutById.get(l.target)?.label ?? l.target;
            const infoTitle = `${srcLabel} → ${dstLabel}`;
            const infoDetail = `${formatValue(l.value)}`;

            return (
              <path
                key={key}
                d={d}
                fill={specialFill ?? l.colorHint}
                opacity={dim ? 0.10 : 0.75}
                onMouseEnter={() => setHoverLinkKey(key)}
                onMouseLeave={() => setHoverLinkKey(null)}
                onClick={() => showTapInfo(infoTitle, infoDetail)}
                style={{ cursor: props.onNodeClick ? "pointer" : "default" }}
              >
                <title>
                  {srcLabel} → {dstLabel} : {formatValue(l.value)}
                </title>
              </path>
            );
          })}

          {/* Nodes */}
          {nodeLayouts.map((n) => {
            const dim = isNodeDim(n);
            const isHovered = hoverNodeId === n.id;
            const { fill } = nodeColor(n.id, n.label, n.stage);

            return (
              <g
                key={n.id}
                onMouseEnter={() => setHoverNodeId(n.id)}
                onMouseLeave={() => setHoverNodeId(null)}
                onClick={() => props.onNodeClick?.({ id: n.id, label: n.label, stage: n.stage, value: n.value })}
                style={{ cursor: props.onNodeClick ? "pointer" : "default" }}
                opacity={dim ? 0.35 : 1}
              >
                {/* Modern filled node with a crisp outline */}
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx={10}
                  fill={fill}
                  opacity={0.92}
                  filter={isHovered ? "url(#sankeyNodeShadowHover)" : "url(#sankeyNodeShadow)"}
                />
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx={10}
                  fill="none"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth={1.5}
                  opacity={0.9}
                />

                {/* Labels */}
                <text
                  x={n.stage === maxStage ? n.x - 8 : n.x + n.w + 8}
                  y={n.y + Math.min(n.h - 6, 18)}
                  fontSize={isNarrow ? 14 : 12}
                  fontWeight={850}
                  textAnchor={n.stage === maxStage ? "end" : "start"}
                  fill="rgba(0,0,0,0.78)"
                  style={{
                    paintOrder: "stroke",
                    stroke: "rgba(255,255,255,0.92)",
                    strokeWidth: 3,
                    strokeLinejoin: "round",
                    textShadow: "0 1px 0 rgba(0,0,0,0.10)",
                  }}
                >
                  {n.label}
                </text>
                <text
                  x={n.stage === maxStage ? n.x - 8 : n.x + n.w + 8}
                  y={n.y + Math.min(n.h - 6, 34)}
                  fontSize={isNarrow ? 13 : 11}
                  fontWeight={700}
                  textAnchor={n.stage === maxStage ? "end" : "start"}
                  fill="rgba(0,0,0,0.55)" style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.92)", strokeWidth: 3, strokeLinejoin: "round" }}
                >
                  {formatValue(n.value)}
                </text>

                {/* Subtle highlight when hovered */}
                {isHovered ? (
                  <rect
                    x={n.x - 2}
                    y={n.y - 2}
                    width={n.w + 4}
                    height={n.h + 4}
                    rx={12}
                    fill="none"
                    stroke="rgba(255,255,255,0.55)"
                    strokeWidth={2}
                  />
                ) : null}
              </g>
            );
          })}
            </svg>
          </div>
        </div>

        {/*
          SCROLL HINTS (mobile + desktop): subtle edge shadows to suggest horizontal scrolling.
          These overlays sit above the diagram but do not intercept touch.
        */}
        <div
          aria-hidden
          style={{
            pointerEvents: "none",
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 22,
            background: "linear-gradient(90deg, rgba(0,0,0,0.16), rgba(0,0,0,0))",
            opacity: 0.22,
            zIndex: 5,
          }}
        />
        <div
          aria-hidden
          style={{
            pointerEvents: "none",
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: 22,
            background: "linear-gradient(270deg, rgba(0,0,0,0.16), rgba(0,0,0,0))",
            opacity: 0.22,
            zIndex: 5,
          }}
        />
      </div>

      {isNarrow && tapInfo ? (
        <div
          role="dialog"
          aria-label="Détails"
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: "calc(12px + env(safe-area-inset-bottom))",
            zIndex: 120,
            height: sheetPx,
            maxHeight: sheetMax,
            borderRadius: 18,
            border: "2px solid rgba(16, 185, 129, 0.65)",
            background: "rgba(255,255,255,0.88)",
            backdropFilter: "blur(8px)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.16)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Languette / handle */}
          <div
            onPointerDown={(e) => {
              // Drag to open/close.
              dragRef.current = { startY: e.clientY, startH: sheetPx, dragging: true };
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const st = dragRef.current;
              if (!st || !st.dragging) return;
              const dy = st.startY - e.clientY; // pull up => bigger
              const next = clamp(st.startH + dy, sheetCollapsed, sheetMax);
              setSheetPx(next);
              setSheetOpen(next > sheetCollapsed + 48);
            }}
            onPointerUp={(e) => {
              const st = dragRef.current;
              if (!st) return;
              dragRef.current = null;
              const mid = (sheetCollapsed + sheetMax) / 2;
              const wantOpen = sheetPx >= mid;
              setSheetOpen(wantOpen);
              setSheetPx(wantOpen ? sheetMax : sheetCollapsed);
              (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
            }}
            onClick={() => {
              // Tap toggles.
              const wantOpen = !sheetOpen;
              setSheetOpen(wantOpen);
              setSheetPx(wantOpen ? sheetMax : sheetCollapsed);
            }}
            style={{
              height: 52,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 12px",
              cursor: "grab",
              userSelect: "none",
              borderBottom: "1px solid rgba(0,0,0,0.08)",
              background: "linear-gradient(90deg, rgba(34, 197, 94, 0.18), rgba(239, 68, 68, 0.12))",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{ width: 40, height: 4, borderRadius: 999, background: "rgba(0,0,0,0.20)" }} />
              <div style={{ fontWeight: 950, fontSize: 13, whiteSpace: "nowrap" }}>{sheetOpen ? "Détails" : "+ de détails"}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="muted" style={{ fontWeight: 900, fontSize: 12 }}>{sheetOpen ? "▼" : "▲"}</div>
              <button
                type="button"
                className="btnGhost"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setTapInfo(null);
                }}
                style={{ padding: "6px 10px", borderRadius: 12, fontWeight: 900 }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Content */}
          <div style={{ padding: 12, overflow: "auto" }}>
            <div style={{ fontWeight: 950, lineHeight: 1.15, marginBottom: 6 }}>{tapInfo.title}</div>
            <div className="muted" style={{ fontWeight: 850, marginBottom: 10 }}>{tapInfo.detail}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Tire la languette pour afficher plus de contenu.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}