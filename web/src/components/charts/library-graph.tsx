"use client";

// The library, drawn: every paper read or kept, and the terms that join them.
//
// The model is `lib/library/graph.ts` — read its header for what an edge is
// allowed to mean (a term the paper's own words carry, never a similarity
// guess). This file is the instrument that draws it, in Latent's register:
// square marks, mono caption chips, dotted connectors, a readout of the real
// counts in the plate's corner, and one registration marker on the thing the
// reader is pointing at.
//
// Motion, and what it is for:
//   - The layout ASSEMBLES once — your topics first, then the terms, then the
//     papers settling onto them — and stops. It is a force simulation that
//     cools; it is not a loop, so the product's one repeating animation (the
//     claim's dot) keeps its meaning.
//   - Hover or focus lifts one neighbourhood and lets the rest recede.
//   - A node can be dragged; the graph re-settles around it and stops again.
//   - Reduced motion: the layout is computed before first paint and drawn
//     still. Dragging still works; nothing drifts.
//
// Rendered as SVG, updated by direct attribute writes during the settle — at
// a hundred and fifty nodes a React render per tick is the slow way to move
// dots.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphNode, LibraryGraph as Graph } from "@/lib/library/graph";
import { shortVenue } from "@/components/cards/paper-plate";
import Link from "next/link";
import type { TermLean } from "@/lib/preferences/ledger";

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode>;

/** Chips are set at the product's one label size — `eyebrow`, 11.5px mono
 *  with +0.06em tracking. Roboto Mono is 0.6em per glyph. */
const LABEL_PX = 11.5;
const CHAR_W = LABEL_PX * 0.6 + LABEL_PX * 0.06;
const CHIP_H = 18;
const CHIP_PAD = 6;
const CHIP_MAX = 26;
const PAPER = 9;
/** Paper titles are drawn only while the library is small enough to carry
 *  them; past this the readout is the only place a title appears. */
const PAPER_LABELS_UP_TO = 24;
const PAPER_LABEL_MAX = 24;
/** Below this plate width: no paper titles, shorter chips, a tighter layout. */
const NARROW = 520;
const EDGE_PAD = 16;

/** A command in the readout: the product's mono label, outlined like a
 *  term chip, taking the accent only when it is the state that is set. */
const ACTION =
  "eyebrow px-2 py-1 text-text-muted shadow-[inset_0_0_0_1px_var(--color-border-strong)] " +
  "hover:text-heading transition-colors " +
  "aria-pressed:text-accent aria-pressed:shadow-[inset_0_0_0_1px_var(--color-accent)]";

/**
 * The chip's words. A term drawn under one of the reader's topics names only
 * what differs from it: "Machine Learning and Data Classification" hangs off
 * MACHINE LEARNING by a solid line, so its chip says DATA CLASSIFICATION —
 * cut at a fixed length, two corners of one field both read "MACHINE LEARNING
 * AND …" and could not be told apart. The full label is in the readout.
 */
function chipText(node: GraphNode, parents: Map<string, string>, max = CHIP_MAX): string {
  let label = node.label;
  const parent = parents.get(node.id);
  if (parent) {
    const rest = label.replace(
      new RegExp(`^${parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:and|in|for|of|&)\\s+`, "i"),
      "",
    );
    if (rest !== label && rest.length >= 4) label = rest;
  }
  const upper = label.toUpperCase();
  return upper.length > max ? `${upper.slice(0, max - 1)}…` : upper;
}

/** A paper's label — its own title, in its own face, cut short. */
function paperText(label: string): string {
  return label.length > PAPER_LABEL_MAX ? `${label.slice(0, PAPER_LABEL_MAX - 1).trimEnd()}…` : label;
}

/** A lean, drawn after the chip's words — the sign is the state. */
function leanMark(lean: TermLean | null): string {
  return lean === "more" ? " +" : lean === "less" ? " −" : "";
}

function chipWidth(text: string): number {
  return text.length * CHAR_W + CHIP_PAD * 2;
}

function halfWidth(node: GraphNode, parents: Map<string, string>, max = CHIP_MAX): number {
  if (node.kind === "paper") return PAPER / 2;
  return chipWidth(chipText(node, parents, max)) / 2;
}

function halfHeight(node: GraphNode): number {
  return node.kind === "paper" ? PAPER / 2 : CHIP_H / 2;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * When it was read, relative where that is the honest reading. The day is
 * stored as a UTC date (the reading calendar buckets by it), so an evening
 * read west of Greenwich is already "tomorrow" by the date — "read today"
 * compares like with like and says what the reader means.
 */
function formatDay(iso?: string): string {
  if (!iso) return "";
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (iso === today) return "today";
  if (iso === yesterday) return "yesterday";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Steering the briefing from the graph. Two levers, each an existing
 * mechanism rather than a new one:
 *   lean    a deliberate "more / less of this" on a term, written to the
 *           preference ledger the scorer already reads — today's papers
 *           re-rank at once (the board re-reads the day's pool with it)
 *   follow  the term joins the explore topics the briefing searches alongside
 *           the reader's own — from tomorrow's briefing (topics are promoted
 *           once a day)
 */
export interface GraphSteer {
  leanOf: (label: string) => TermLean | null;
  followed: (label: string) => boolean;
  lean: (label: string, lean: TermLean | null) => void;
  follow: (label: string, follow: boolean) => void;
}

export function LibraryGraph({ graph, steer }: { graph: Graph; steer?: GraphSteer }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const labelEls = useRef(new Map<string, SVGTextElement>());
  const linkEls = useRef<(SVGLineElement | null)[]>([]);
  const markerRef = useRef<SVGGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  /** The camera: the whole library, centred and scaled to the plate. */
  const viewRef = useRef<SVGGElement>(null);
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);
  const [pinned, setPinned] = useState<string | null>(null);
  /** What the last action did — shown only while its node is still pinned. */
  const [status, setStatus] = useState<{ id: string; text: string } | null>(null);
  const active = hover ?? pinned;
  /** The node the readout describes and the marker registers — the pinned
   *  one when there is one. The tick loop reads it through a ref. */
  const panelId = pinned ?? hover;
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    activeRef.current = panelId;
  }, [panelId]);
  const drawRef = useRef<() => void>(() => {});
  /** Frame and place the titles — what the simulation does when it rests. */
  const endRef = useRef<() => void>(() => {});
  /** Where each node last was, so a graph that gains a paper keeps its shape
   *  and only the new node travels in. */
  const lastPos = useRef(new Map<string, { x: number; y: number }>());
  /** The plate size the last layout ran at — a new size re-deals the layout;
   *  the same size keeps it. */
  const lastSize = useRef<{ w: number; h: number } | null>(null);

  // Stable simulation objects for this graph. Rebuilt when the graph changes.
  const { nodes, links, byId } = useMemo(() => {
    const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: (SimLink & { kind: "carries" | "contains" })[] = graph.links.map((l) => ({
      source: l.source,
      target: l.target,
      kind: l.kind,
    }));
    return { nodes, links, byId };
  }, [graph]);

  /** A term's parent topic label, where it hangs under one. */
  const parents = useMemo(() => {
    const out = new Map<string, string>();
    for (const l of graph.links) {
      if (l.kind !== "contains") continue;
      const parent = graph.nodes.find((n) => n.id === l.target);
      if (parent) out.set(l.source, parent.label);
    }
    return out;
  }, [graph]);
  const paperCount = graph.nodes.filter((n) => n.kind === "paper").length;
  const narrow = size ? size.w < NARROW : false;
  const labelPapers = paperCount <= PAPER_LABELS_UP_TO && !narrow;
  const chipMax = narrow ? 16 : CHIP_MAX;
  /** The readout's own height, measured — the camera keeps the graph below it. */
  const readoutRef = useRef<HTMLDivElement>(null);
  /** The key's height, measured — it sits in the plate's bottom-left corner,
   *  and the camera keeps the graph above it. */
  const keyRef = useRef<HTMLDivElement>(null);
  /** The readout's height AT REST — its one line of counts. The camera frames
   *  the library below that, never below whatever the readout says this
   *  moment: pointing at a node must not move the plate. */
  const restTop = useRef(24);
  useEffect(() => {
    if (!panelId && readoutRef.current) restTop.current = readoutRef.current.offsetHeight;
  });
  /** The picked-up node, for the camera: it is never left under the readout
   *  that describes it. */
  const pinnedRef = useRef<string | null>(null);
  /** Ease the camera to where it should be now — set by the simulation. */
  const glideRef = useRef<() => void>(() => {});
  // Picking a node up opens the readout over the plate's top-left, and
  // putting it down closes it: the camera moves then, and only then — on a
  // click, never on a hover. The readout also grows while a node is held (a
  // status line after an action, a longer label on a phone).
  useEffect(() => {
    pinnedRef.current = pinned;
    glideRef.current();
  }, [pinned]);
  useEffect(() => {
    const el = readoutRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) glideRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const neighbours = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const l of graph.links) {
      if (!out.has(l.source)) out.set(l.source, new Set());
      if (!out.has(l.target)) out.set(l.target, new Set());
      out.get(l.source)!.add(l.target);
      out.get(l.target)!.add(l.source);
    }
    return out;
  }, [graph]);

  // The plate's size follows its column; the height follows the width, within
  // a floor that keeps a phone's graph legible and a ceiling that keeps a wide
  // screen's from becoming a field.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      // Wide screens get a wide band; a phone gets a plate taller than it is
      // wide, because the chips cannot shrink below their words.
      const h = Math.round(
        w < NARROW ? Math.min(560, Math.max(380, w * 1.35)) : Math.min(440, Math.max(300, w * 0.42)),
      );
      setSize((prev) => (prev && Math.abs(prev.w - w) < 24 && prev.h === h ? prev : { w, h }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The simulation.
  useEffect(() => {
    if (!size) return;
    const { w, h } = size;
    const aspect = w / h;
    /** Distances shrink with the plate — a phone's graph is drawn smaller at
     *  full type size rather than drawn full size and scaled until illegible. */
    const scale = Math.max(0.6, Math.min(1, w / 900));
    /** The library's extent, labels included — a paper's title hangs below
     *  its square, a chip is as wide as its words. */
    const extent = () => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of nodes) {
        const hw =
          n.kind === "paper"
            ? labelPapers
              ? (Math.min(n.label.length, PAPER_LABEL_MAX) * 6.2) / 2
              : PAPER / 2
            : halfWidth(n, parents, chipMax);
        const top = n.kind === "paper" ? PAPER / 2 : CHIP_H / 2;
        const bottom = n.kind === "paper" && labelPapers ? PAPER / 2 + 18 : top;
        x0 = Math.min(x0, n.x! - hw);
        x1 = Math.max(x1, n.x! + hw);
        y0 = Math.min(y0, n.y! - top);
        y1 = Math.max(y1, n.y! + bottom);
      }
      return { x0, y0, x1, y1 };
    };

    /** Frame it: centre the library in the plate, below the readout, and
     *  scale it down if it has grown past the plate — never up, so the type
     *  stays at the size it was set. */
    /**
     * The titles, placed the way a map places town names: most-linked paper
     * first, and a title that would land on one already placed — or on a
     * term's chip, or on another paper's square — is simply not drawn. The
     * readout carries every title in full on hover, so nothing is lost, and
     * the plate never reads as a pile of overprinted words.
     */
    const placeLabels = () => {
      if (!labelPapers) return;
      type Box = { x0: number; y0: number; x1: number; y1: number };
      const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      const placed: Box[] = [];
      for (const n of nodes) {
        if (n.kind === "paper") {
          placed.push({ x0: n.x! - PAPER / 2 - 2, y0: n.y! - PAPER / 2 - 2, x1: n.x! + PAPER / 2 + 2, y1: n.y! + PAPER / 2 + 2 });
        } else {
          const hw = halfWidth(n, parents, chipMax);
          placed.push({ x0: n.x! - hw - 3, y0: n.y! - CHIP_H / 2 - 3, x1: n.x! + hw + 3, y1: n.y! + CHIP_H / 2 + 3 });
        }
      }
      const papersFirst = nodes
        .filter((n): n is Extract<SimNode, { kind: "paper" }> => n.kind === "paper")
        .sort((a, b) => b.degree - a.degree || (a.state === "today" ? 1 : 0) - (b.state === "today" ? 1 : 0));
      for (const n of papersFirst) {
        const hw = (Math.min(n.label.length, PAPER_LABEL_MAX) * 6.2) / 2;
        const box = { x0: n.x! - hw, y0: n.y! + PAPER / 2 + 2, x1: n.x! + hw, y1: n.y! + PAPER / 2 + 17 };
        const free = !placed.some((b) => hit(b, box));
        if (free) placed.push(box);
        const label = labelEls.current.get(n.id);
        if (label) label.style.opacity = free ? "1" : "0";
      }
    };

    /** Where the camera should be for the library as it stands. */
    const target = () => {
      const { x0, y0, x1, y1 } = extent();
      if (!Number.isFinite(x0)) return null;
      /** Centre the library between a top and a bottom margin; scale down if
       *  it has grown past them — never up. */
      const fit = (top: number, bottom: number) => {
        const k = Math.min(
          1,
          (w - EDGE_PAD * 2) / Math.max(1, x1 - x0),
          (h - top - bottom) / Math.max(1, y1 - y0),
        );
        return {
          k,
          tx: w / 2 - ((x0 + x1) / 2) * k,
          ty: top + (h - top - bottom) / 2 - ((y0 + y1) / 2) * k,
        };
      };
      // Between the readout at rest at the top and the key at the bottom,
      // however many lines either is running to.
      const rest = fit(restTop.current + 14, Math.max(EDGE_PAD, (keyRef.current?.offsetHeight ?? 0) + 12));

      // A node that is picked up opens the readout over the plate's corner —
      // its label, its actions, what they do. If the node itself is under
      // there, the plate slides down just far enough to show it, the way a
      // map pans a pin out from under the card that opened on it. The key has
      // stepped aside, so the plate's foot is free to slide into; if even that
      // is not room enough, the library is fitted between the readout and the
      // foot instead — a little smaller, but all of it there. The node's
      // marker, and room for a lean's sign, count as part of it.
      const held = pinnedRef.current ? byId.get(pinnedRef.current) : undefined;
      const panel = readoutRef.current;
      if (!held || held.x === undefined || !panel) return rest;
      const { k, tx, ty } = rest;
      const clear = panel.offsetTop + panel.offsetHeight + 8;
      const left = held.x * k + tx - (halfWidth(held, parents, chipMax) + CHAR_W + 5) * k;
      const top0 = held.y! * k + ty - (halfHeight(held) + 5) * k;
      if (left >= panel.offsetLeft + panel.offsetWidth || top0 >= clear) return rest;
      const slide = clear - top0;
      if (y1 * k + ty + slide <= h - EDGE_PAD) return { k, tx, ty: ty + slide };
      return fit(clear, EDGE_PAD);
    };

    const applyView = () => {
      const { k, tx, ty } = view.current;
      viewRef.current?.style.setProperty("transform", `translate(${tx}px, ${ty}px) scale(${k})`);
    };

    /** Frame it outright — before first paint, and whenever a drag ends. */
    const frame = () => {
      const next = target();
      if (!next) return;
      view.current = next;
      applyView();
    };

    /** Follow it — a fraction of the way each tick, so the camera eases after
     *  the settling library and nothing ever leaves the plate on the way. */
    const follow = () => {
      const next = target();
      if (!next) return;
      const v = view.current;
      const f = 0.15;
      view.current = {
        k: v.k + (next.k - v.k) * f,
        tx: v.tx + (next.tx - v.tx) * f,
        ty: v.ty + (next.ty - v.ty) * f,
      };
      applyView();
    };

    /** Follow it with the layout at rest — when a node is picked up or put
     *  down, nothing is ticking to move the camera. Same easing as the
     *  settle; a jump where motion is reduced or nobody is watching. */
    let glideFrame = 0;
    const glide = () => {
      cancelAnimationFrame(glideFrame);
      if (reducedMotion() || document.visibilityState === "hidden") {
        frame();
        return;
      }
      let left = 90;
      const step = () => {
        const next = target();
        if (!next) return;
        const v = view.current;
        const close =
          Math.abs(next.tx - v.tx) < 0.5 && Math.abs(next.ty - v.ty) < 0.5 && Math.abs(next.k - v.k) < 0.001;
        if (close || --left <= 0) {
          view.current = next;
          applyView();
          return;
        }
        follow();
        glideFrame = requestAnimationFrame(step);
      };
      glideFrame = requestAnimationFrame(step);
    };

    const draw = () => {
      for (const n of nodes) {
        lastPos.current.set(n.id, { x: n.x!, y: n.y! });
        nodeEls.current.get(n.id)?.setAttribute("transform", `translate(${n.x!.toFixed(1)},${n.y!.toFixed(1)})`);
      }
      links.forEach((l, i) => {
        const el = linkEls.current[i];
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (!el || typeof s !== "object" || typeof t !== "object") return;
        el.setAttribute("x1", s.x!.toFixed(1));
        el.setAttribute("y1", s.y!.toFixed(1));
        el.setAttribute("x2", t.x!.toFixed(1));
        el.setAttribute("y2", t.y!.toFixed(1));
      });
      const a = activeRef.current ? byId.get(activeRef.current) : null;
      if (a && markerRef.current) {
        markerRef.current.setAttribute("transform", `translate(${a.x!.toFixed(1)},${a.y!.toFixed(1)})`);
      }
    };

    // A library already on this plate, most of it placed, is a REBUILD: a
    // lean moved a paper into today's ten or out of it, or one was just read.
    // It keeps its shape. Restarted at full heat with the newcomers dropped on
    // the outer ring, the whole plate reshuffled — the term in the reader's
    // hand jumped across it the moment they pressed + More. Restarted merely
    // cool, it still drifted 75px on average with not one paper changed: a
    // force layout stops when it has cooled, not where its forces balance, so
    // any heat walks it on. So every node already on the plate is HELD where
    // it is, a newcomer starts beside the nodes it links to and is the only
    // thing that moves, and the hold is let go once it rests — a drag still
    // pushes the neighbours about as it always did.
    const sameSize = lastSize.current?.w === w && lastSize.current?.h === h;
    lastSize.current = { w, h };
    const known = nodes.filter((n) => n.x !== undefined || lastPos.current.has(n.id)).length;
    const rebuild = sameSize && known >= nodes.length / 2;
    const holding: SimNode[] = [];
    /** Let go of the nodes held for a rebuild — not one the reader has since
     *  picked up and is dragging. */
    const letGo = () => {
      for (const n of holding) {
        if (drag.current?.id === n.id) continue;
        n.fx = null;
        n.fy = null;
      }
      holding.length = 0;
    };

    // Seed: topics near the middle, everything else on a wide ring, so the
    // assembly reads as terms gathering the papers rather than a tangle
    // unknotting. Deterministic — the same library lays out the same way.
    const topics = nodes.filter((n) => n.kind === "topic");
    nodes.forEach((n, i) => {
      // A node the reader has already seen keeps its place.
      const prev = lastPos.current.get(n.id);
      if (prev && n.x === undefined) {
        n.x = prev.x;
        n.y = prev.y;
      }
      if (n.x !== undefined) {
        if (rebuild) {
          n.fx = n.x;
          n.fy = n.y;
          holding.push(n);
        }
        return;
      }
      if (rebuild) {
        const near = [...(neighbours.get(n.id) ?? [])]
          .map((id) => lastPos.current.get(id))
          .filter((p): p is { x: number; y: number } => p !== undefined);
        if (near.length > 0) {
          // The golden angle, so two newcomers to one term fan out instead of
          // landing on each other.
          const angle = i * 2.39996;
          n.x = near.reduce((s, p) => s + p.x, 0) / near.length + Math.cos(angle) * 30 * scale;
          n.y = near.reduce((s, p) => s + p.y, 0) / near.length + Math.sin(angle) * 30 * scale;
          return;
        }
      }
      if (n.kind === "topic") {
        const k = topics.indexOf(n);
        const angle = (k / Math.max(1, topics.length)) * Math.PI * 2;
        n.x = w / 2 + Math.cos(angle) * Math.min(w, h) * 0.12;
        n.y = h / 2 + Math.sin(angle) * Math.min(w, h) * 0.12;
      } else {
        const angle = (i / nodes.length) * Math.PI * 2 * 3.1;
        n.x = w / 2 + Math.cos(angle) * w * 0.34;
        n.y = h / 2 + Math.sin(angle) * h * 0.36;
      }
    });

    const sim = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => {
            const target = l.target as SimNode;
            if ((l as { kind?: string }).kind === "contains") return 110 * scale;
            return (target.kind === "topic" ? 104 : 74) * scale;
          })
          .strength(0.5),
      )
      .force(
        "charge",
        forceManyBody<SimNode>().strength((d) =>
          (d.kind === "topic" ? -460 : d.kind === "concept" ? -240 : -80) * scale * scale,
        ),
      )
      .force(
        "collide",
        forceCollide<SimNode>((d) =>
          d.kind === "paper"
            ? labelPapers
              ? 44
              : 12
            : Math.min(halfWidth(d, parents, chipMax), 96) + 10,
        ).strength(0.85),
      )
      // The plate is wide and short (about 2.5:1), and a force layout left to
      // itself comes out round — which the camera would then have to shrink
      // until the type was unreadable. So it pulls several times harder
      // toward the middle row than toward the middle column, and the library
      // spreads to the plate's own shape.
      .force("center", forceCenter<SimNode>(w / 2, h / 2))
      .force("x", forceX<SimNode>(w / 2).strength(aspect >= 1 ? 0.012 : Math.min(0.22, 0.09 / aspect)))
      .force("y", forceY<SimNode>(h / 2).strength(aspect >= 1 ? Math.min(0.22, 0.09 * aspect) : 0.012))
      // ~2s to rest at 60fps: long enough to watch it gather, short enough to
      // be over before the eye has moved on.
      .alphaDecay(0.045)
      .velocityDecay(0.36)
      .on("tick", () => {
        draw();
        follow();
      })
      // At rest: the camera lands, then the titles go where there is room.
      .on("end", () => {
        letGo();
        frame();
        placeLabels();
      });
    if (rebuild) sim.alpha(0.3);

    simRef.current = sim;
    drawRef.current = draw;
    glideRef.current = glide;
    endRef.current = () => {
      frame();
      placeLabels();
    };

    // Settled before first paint when nobody is going to watch it settle:
    // reduced motion, or a briefing opened in a background tab — an assembly
    // played to an empty room is the mistake the reading page's reveal was
    // written to stop making.
    if (reducedMotion() || document.visibilityState === "hidden") {
      sim.stop();
      for (let i = 0; i < 260; i++) sim.tick();
      letGo();
      draw();
      frame();
      placeLabels();
    } else {
      // Most of the layout is found before the first paint, so the first
      // frame is already the library's shape rather than a ring of dots
      // unknotting — that tangle is the part of a force layout nobody wants
      // to watch. What is left, from alpha 0.12 down to rest, is played:
      // about a second and a half of the terms drawing their papers in, under
      // the staged fade (topics, then terms, then papers, then the lines).
      sim.stop();
      while (sim.alpha() > 0.12) sim.tick();
      draw();
      // A rebuild's camera eases from where it was, with the settle.
      if (!rebuild) frame();
      sim.restart();
    }

    return () => {
      sim.stop();
      letGo();
      cancelAnimationFrame(glideFrame);
      simRef.current = null;
      glideRef.current = () => {};
    };
  }, [size, nodes, links, byId, parents, neighbours, labelPapers, chipMax]);

  // ── Pointing ──────────────────────────────────────────────────────────
  // The whole plate dims around what is pointed at, so pointing must not
  // flicker. Setting it on every enter and clearing it on every leave did:
  // moving from one node to its neighbour passed through "nothing", and the
  // entire graph flashed back to full and down again; a sweep across the plate
  // strobed it. So:
  //   - from nothing, the pointer has to REST on a node (70ms) before the rest
  //     recedes — passing over one on the way somewhere else does nothing;
  //   - from one node to another, it moves straight across, no flash between;
  //   - leaving, it waits 140ms, long enough to reach the next node.
  const pointAt = (id: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (hover) {
      setHover(id);
      return;
    }
    hoverTimer.current = setTimeout(() => setHover(id), 70);
  };
  const pointAway = (id: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover((h) => (h === id ? null : h)), 140);
  };

  // ── Dragging ──────────────────────────────────────────────────────────
  const drag = useRef<{ id: string; x0: number; y0: number; moved: boolean; pointer: string } | null>(null);

  const toSvg = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const box = svg.getBoundingClientRect();
    const { k, tx, ty } = view.current;
    return { x: (e.clientX - box.left - tx) / k, y: (e.clientY - box.top - ty) / k };
  };

  const onNodeDown = (e: React.PointerEvent, id: string) => {
    const n = byId.get(id);
    if (!n) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toSvg(e);
    drag.current = { id, x0: p.x, y0: p.y, moved: false, pointer: e.pointerType };
    n.fx = n.x;
    n.fy = n.y;
  };

  const onNodeMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const n = byId.get(d.id);
    if (!n) return;
    const p = toSvg(e);
    if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) < 4) return;
    if (!d.moved) {
      d.moved = true;
      if (!reducedMotion()) simRef.current?.alphaTarget(0.25).restart();
    }
    n.fx = p.x;
    n.fy = p.y;
    if (reducedMotion()) {
      n.x = p.x;
      n.y = p.y;
      drawRef.current();
    }
  };

  const onNodeUp = (e: React.PointerEvent, node: GraphNode) => {
    const d = drag.current;
    drag.current = null;
    const n = byId.get(node.id);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
    simRef.current?.alphaTarget(0);
    if (d?.moved && reducedMotion()) {
      // No settle will run to call these; do it now.
      endRef.current();
    }
    if (!d || d.moved) return;
    // A click, not a drag: it selects. The graph is where the briefing is
    // steered, so a node is picked up first and acted on from the readout —
    // a paper opens from there, and Enter still opens it straight away.
    e.preventDefault();
    setPinned((prev) => (prev === node.id ? null : node.id));
  };

  // ── What is lit ───────────────────────────────────────────────────────
  const lit = useMemo(() => {
    if (!active) return null;
    const set = new Set<string>([active]);
    neighbours.get(active)?.forEach((id) => set.add(id));
    return set;
  }, [active, neighbours]);

  // Two different questions. What is LIT follows the pointer, so moving
  // across the plate still previews each neighbourhood. What the readout
  // describes, and what the marker registers, is the PINNED node when there is
  // one — the readout is where its actions are, and reaching them means
  // crossing other nodes on the way.
  const activeNode = panelId ? graph.nodes.find((n) => n.id === panelId) ?? null : null;
  const isPinned = Boolean(pinned && activeNode && activeNode.id === pinned);

  const lean = (label: string, next: TermLean) => {
    if (!steer || !activeNode) return;
    const current = steer.leanOf(label);
    const value = current === next ? null : next;
    steer.lean(label, value);
    setStatus({
      id: activeNode.id,
      text:
        value === "more"
          ? "Leaning toward it — the papers below re-rank."
          : value === "less"
            ? "Leaning away from it — the papers below re-rank."
            : "No lean — ranked by your reading again.",
    });
  };
  const follow = (label: string) => {
    if (!steer || !activeNode) return;
    const next = !steer.followed(label);
    steer.follow(label, next);
    setStatus({
      id: activeNode.id,
      text: next
        ? "Following — tomorrow's briefing searches for it too."
        : "Not following — from tomorrow's briefing.",
    });
  };
  const { counts } = graph;
  const terms = counts.topics + counts.concepts;

  return (
    <div
      ref={wrapRef}
      className="relative cropmarks grain bg-surface shadow-card overflow-hidden"
      onKeyDown={(e) => {
        if (e.key === "Escape") setPinned(null);
      }}
    >
      {/* The readout — the instrument's own numbers, in the plate's corner.
          At rest it counts; pointed at something, it says what that is. */}
      <div
        ref={readoutRef}
        className="pointer-events-none absolute left-2 top-2 z-[2] max-w-[min(26rem,calc(100%-1rem))] bg-surface/85 px-2 py-1"
      >
        {!activeNode ? (
          <p className="eyebrow text-text-faint tabular-nums">
            {[
              `${counts.read} read`,
              counts.saved > 0 && `${counts.saved} kept`,
              counts.today > 0 && `${counts.today} today`,
              `${terms} terms`,
              !narrow && `${counts.links} links`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : activeNode.kind === "paper" ? (
          <div>
            <p className="eyebrow text-text-faint tabular-nums">
              {activeNode.state === "today"
                ? "Today · unread"
                : activeNode.state === "saved"
                  ? `Kept${activeNode.readAt ? ` · read ${formatDay(activeNode.readAt)}` : ""}`
                  : `Read ${formatDay(activeNode.readAt)}`}
              {shortVenue(activeNode.venue) ? ` · ${shortVenue(activeNode.venue)}` : ""}
            </p>
            <p className="paper-line text-title text-heading leading-[1.3] mt-1 line-clamp-2">
              {activeNode.label}
            </p>
            {isPinned ? (
              <div className="pointer-events-auto mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={ACTION}
                  onClick={() => router.push(`/papers/${activeNode.paperId}`)}
                >
                  Open →
                </button>
              </div>
            ) : (
              <p className="annotation text-text-faint mt-1 tabular-nums">
                {activeNode.degree} {activeNode.degree === 1 ? "link" : "links"} — click to pick it up
              </p>
            )}
          </div>
        ) : activeNode.kind === "topic" ? (
          <div>
            <p className="eyebrow text-text-faint tabular-nums">
              Your topic · {activeNode.papers} {activeNode.papers === 1 ? "paper" : "papers"}
            </p>
            <p className="text-title text-heading mt-1">{activeNode.label}</p>
            {isPinned ? (
              <div className="pointer-events-auto mt-2 flex flex-wrap gap-2">
                <Link href="/profile" className={ACTION}>
                  Edit your topics →
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            <p className="eyebrow text-text-faint tabular-nums">
              {activeNode.sources.includes("filed") && activeNode.sources.includes("text")
                ? "Filed by OpenAlex · in their own words"
                : activeNode.sources.includes("filed")
                  ? "Filed by OpenAlex"
                  : "In their own words"}{" "}
              · {activeNode.papers} {activeNode.papers === 1 ? "paper" : "papers"}
            </p>
            <p className="text-title text-heading mt-1">{activeNode.label}</p>
            {isPinned && steer ? (
              <>
                {/* The two levers. Pressed shows what is set now; pressing it
                    again takes it off, so nothing here is a one-way door. */}
                <div className="pointer-events-auto mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={steer.leanOf(activeNode.label) === "more"}
                    className={ACTION}
                    onClick={() => lean(activeNode.label, "more")}
                  >
                    + More
                  </button>
                  <button
                    type="button"
                    aria-pressed={steer.leanOf(activeNode.label) === "less"}
                    className={ACTION}
                    onClick={() => lean(activeNode.label, "less")}
                  >
                    − Less
                  </button>
                  <button
                    type="button"
                    aria-pressed={steer.followed(activeNode.label)}
                    className={ACTION}
                    onClick={() => follow(activeNode.label)}
                  >
                    {steer.followed(activeNode.label) ? "Following" : "Follow"}
                  </button>
                </div>
                {/* What the levers do, from the moment the term is picked
                    up; after one is pressed, what it did — in the same line,
                    so the readout keeps its height and the plate moves once. */}
                <p className="annotation text-text-faint mt-2" role="status">
                  {status?.id === activeNode.id
                    ? status.text
                    : "More or Less re-ranks today · Follow searches tomorrow"}
                </p>
              </>
            ) : (
              <p className="annotation text-text-faint mt-1">
                Click to steer your briefing toward it or away from it.
              </p>
            )}
          </div>
        )}
      </div>

      {/* The key, in the plate's bottom-left corner — the instrument carries
          its own key, the way the readout sits in its top-left. It used to be
          a separate row under the plate, where it lined up with nothing. */}
      {/* While a node is held the key steps aside: the readout is saying
          what the node is, and the plate may have slid down into this corner
          to show it. */}
      <div
        ref={keyRef}
        className={
          "pointer-events-none absolute left-2 bottom-2 z-[2] max-w-[calc(100%-1rem)] bg-surface/85 px-2 py-1 " +
          "transition-opacity duration-200 " +
          (pinned ? "opacity-0" : "")
        }
      >
        <LibraryLegend
          followed={Boolean(
            steer && graph.nodes.some((n) => n.kind === "concept" && steer.followed(n.label)),
          )}
        />
      </div>

      {size && (
        <svg
          ref={svgRef}
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          className="block touch-none select-none"
          role="img"
          aria-label={`Your library: ${counts.read + counts.saved} papers joined through ${terms} terms.`}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setPinned(null);
          }}
        >
          <g ref={viewRef} style={{ transformOrigin: "0 0" }}>
          {/* Two layers of opacity on purpose: an entrance animation with
              `both` fill holds opacity at 1 forever after, and an animation
              beats an inline style — so the entrance lives on a wrapper and
              the dimming on the element, and the two multiply. */}
          <g style={{ animation: "fade-in var(--dur-base) var(--ease-expo) 320ms both" }}>
            {links.map((l, i) => {
              const s = typeof l.source === "object" ? (l.source as SimNode).id : (l.source as string);
              const t = typeof l.target === "object" ? (l.target as SimNode).id : (l.target as string);
              const on = lit ? lit.has(s) && lit.has(t) : false;
              return (
                <line
                  key={`${s}>${t}`}
                  ref={(el) => {
                    linkEls.current[i] = el;
                  }}
                  className="transition-opacity"
                  stroke={on ? "var(--color-text-muted)" : "var(--color-border-strong)"}
                  strokeWidth={1}
                  // Dotted: this paper carries this term. Solid: this term sits
                  // under your topic. Lit, both go solid — the neighbourhood
                  // is being read, not the kind of edge.
                  strokeDasharray={on || l.kind === "contains" ? undefined : "1 3"}
                  style={{ opacity: lit && !on ? 0.2 : 1 }}
                />
              );
            })}
          </g>

          <g>
            {graph.nodes.map((node, i) => {
              const dim = lit ? !lit.has(node.id) : false;
              // Topics arrive first, then the terms, then the papers — the
              // order the eye should read the graph in.
              const delay =
                node.kind === "topic" ? 0 : node.kind === "concept" ? 120 : 220 + Math.min(i, 30) * 8;
              const common = {
                ref: (el: SVGGElement | null) => {
                  if (el) nodeEls.current.set(node.id, el);
                  else nodeEls.current.delete(node.id);
                },
                className: "cursor-pointer transition-opacity outline-none",
                style: { opacity: dim ? 0.28 : 1 } as React.CSSProperties,
                onPointerEnter: (e: React.PointerEvent) => {
                  if (e.pointerType !== "touch") pointAt(node.id);
                },
                onPointerLeave: (e: React.PointerEvent) => {
                  if (e.pointerType !== "touch") pointAway(node.id);
                },
                onPointerDown: (e: React.PointerEvent) => onNodeDown(e, node.id),
                onPointerMove: onNodeMove,
                onPointerUp: (e: React.PointerEvent) => onNodeUp(e, node),
              };

              const arrive = {
                animation: `fade-in var(--dur-base) var(--ease-expo) ${delay}ms both`,
              };

              if (node.kind === "paper") {
                return (
                  <g key={node.id} {...common}>
                    <g style={arrive}>
                    {/* A link in the document, so the keyboard reaches every
                        paper and Enter opens it; the pointer handlers above
                        take the mouse and the finger. */}
                    <a
                      href={`/papers/${node.paperId}`}
                      aria-label={`${node.label}${node.state === "today" ? " — today, unread" : ""}`}
                      onClick={(e) => e.preventDefault()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") router.push(`/papers/${node.paperId}`);
                        else if (e.key === " ") {
                          e.preventDefault();
                          setPinned((prev) => (prev === node.id ? null : node.id));
                        }
                      }}
                      onFocus={() => setHover(node.id)}
                      onBlur={() => setHover((h) => (h === node.id ? null : h))}
                    >
                      {/* The hit target is larger than the mark. */}
                      <rect x={-11} y={-11} width={22} height={22} fill="transparent" />
                      <rect
                        x={-PAPER / 2}
                        y={-PAPER / 2}
                        width={PAPER}
                        height={PAPER}
                        fill={
                          node.state === "today"
                            ? "transparent"
                            : node.state === "saved"
                              ? "var(--color-heading)"
                              : "var(--color-text-muted)"
                        }
                        stroke={node.state === "today" ? "var(--color-text-faint)" : "none"}
                        strokeWidth={1}
                      />
                      {labelPapers && (
                        <text
                          ref={(el) => {
                            if (el) labelEls.current.set(node.id, el);
                            else labelEls.current.delete(node.id);
                          }}
                          x={0}
                          y={PAPER / 2 + 13}
                          textAnchor="middle"
                          fill="var(--color-text-faint)"
                          // Hidden until the layout is still and there is room
                          // for it — the last layer to arrive.
                          style={{
                            fontFamily: "var(--font-reading)",
                            fontSize: 12,
                            opacity: 0,
                            transition: "opacity var(--dur-base) var(--ease-expo)",
                            // A label, not a target. A title dropped for
                            // overprinting is transparent but still
                            // hit-testable, and papers paint over the chips —
                            // so a chip under an invisible title kept losing
                            // the pointer to the paper, back and forth.
                            pointerEvents: "none",
                          }}
                        >
                          {paperText(node.label)}
                        </text>
                      )}
                    </a>
                    </g>
                  </g>
                );
              }

              // The state the reader set, drawn on the chip itself: a lean
              // is a sign after the words, and a followed term is filled —
              // filled means "in your search", which is what a topic is too,
              // a step dimmer so the two stay distinct.
              const topic = node.kind === "topic";
              const leanNow = !topic && steer ? steer.leanOf(node.label) : null;
              const followed = !topic && steer ? steer.followed(node.label) : false;
              const text = chipText(node, parents, chipMax) + leanMark(leanNow);
              const w = chipWidth(text);
              const filled = topic || followed;
              return (
                <g
                  key={node.id}
                  {...common}
                  // Reachable from the keyboard, so the levers are too: Enter
                  // or Space picks the term up, Escape puts it down.
                  tabIndex={0}
                  role="button"
                  aria-pressed={pinned === node.id}
                  aria-label={`${node.label}${topic ? " — your topic" : followed ? " — followed" : ""}${leanNow ? ` — leaning ${leanNow === "more" ? "toward" : "away"}` : ""}`}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPinned((prev) => (prev === node.id ? null : node.id));
                    } else if (e.key === "Escape") {
                      setPinned(null);
                    }
                  }}
                  onFocus={() => setHover(node.id)}
                  onBlur={() => pointAway(node.id)}
                >
                  <g style={arrive}>
                  <rect
                    x={-w / 2}
                    y={-CHIP_H / 2}
                    width={w}
                    height={CHIP_H}
                    fill={
                      topic
                        ? "var(--color-heading)"
                        : followed
                          ? "var(--color-text-muted)"
                          : "var(--color-surface)"
                    }
                    stroke={filled ? "none" : "var(--color-border-strong)"}
                    strokeWidth={1}
                  />
                  <text
                    x={0}
                    y={0.5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={filled ? "var(--color-bg)" : "var(--color-text-muted)"}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: LABEL_PX,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {text}
                  </text>
                  </g>
                </g>
              );
            })}
          </g>

          {/* The registration marker — four corners in the accent around the
              one thing being pointed at. Latent draws a dashed hexagon here;
              Peer draws the corner it already uses for a registered plate. It
              exists only while something is pointed at, so it does not spend
              the accent at rest. */}
          {activeNode && (
            <g
              ref={markerRef}
              className="pointer-events-none"
              // Placed on the render that creates it. Positioned from an
              // effect instead, it was painted once at the camera's origin —
              // a flash in the plate's top-left — and then jumped. The tick
              // loop keeps it on the node while the layout moves.
              transform={(() => {
                const at = byId.get(activeNode.id);
                return at?.x !== undefined ? `translate(${at.x.toFixed(1)},${at.y!.toFixed(1)})` : undefined;
              })()}
              style={{ animation: "fade-in 180ms var(--ease-expo) both" }}
            >
              {(() => {
                // Around the chip as drawn — a lean's sign makes it wider.
                const hw =
                  (activeNode.kind === "paper"
                    ? PAPER / 2
                    : chipWidth(
                        chipText(activeNode, parents, chipMax) +
                          leanMark(activeNode.kind === "concept" && steer ? steer.leanOf(activeNode.label) : null),
                      ) / 2) + 5;
                const hh = halfHeight(activeNode) + 5;
                const leg = 5;
                const c = "var(--color-accent)";
                return (
                  <path
                    d={[
                      `M${-hw},${-hh + leg}V${-hh}H${-hw + leg}`,
                      `M${hw - leg},${-hh}H${hw}V${-hh + leg}`,
                      `M${hw},${hh - leg}V${hh}H${hw - leg}`,
                      `M${-hw + leg},${hh}H${-hw}V${hh - leg}`,
                    ].join("")}
                    fill="none"
                    stroke={c}
                    strokeWidth={1.25}
                  />
                );
              })()}
            </g>
          )}
          </g>
        </svg>
      )}
      {!size && <div style={{ height: 320 }} aria-hidden />}

      {/* The table view — the same library as a list, for a screen reader and
          for anyone who would rather read it than point at it. */}
      <ul className="sr-only">
        {graph.nodes
          .filter((n): n is Extract<GraphNode, { kind: "paper" }> => n.kind === "paper")
          .map((n) => {
            const joined = [...(neighbours.get(n.id) ?? [])]
              .map((id) => graph.nodes.find((m) => m.id === id)?.label)
              .filter(Boolean)
              .join(", ");
            return (
              <li key={n.id}>
                {n.label} — {n.state === "today" ? "today, unread" : n.state === "saved" ? "kept" : `read ${formatDay(n.readAt)}`}
                {joined ? `; joined through ${joined}` : ""}
              </li>
            );
          })}
      </ul>
    </div>
  );
}

/** The key, drawn with the graph's own marks. */
export function LibraryLegend({ followed = false }: { followed?: boolean }) {
  const item = "inline-flex items-center gap-2";
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 annotation text-text-faint">
      <li className={item}>
        <span aria-hidden className="block w-[9px] h-[9px] bg-text-muted" />
        read
      </li>
      <li className={item}>
        <span aria-hidden className="block w-[9px] h-[9px] bg-heading" />
        kept
      </li>
      <li className={item}>
        <span aria-hidden className="block w-[9px] h-[9px] shadow-[inset_0_0_0_1px_var(--color-text-faint)]" />
        today, unread
      </li>
      <li className={item}>
        <span aria-hidden className="eyebrow bg-heading text-bg px-1.5">
          Topic
        </span>
        yours
      </li>
      <li className={item}>
        <span
          aria-hidden
          className="eyebrow text-text-muted px-1.5 shadow-[inset_0_0_0_1px_var(--color-border-strong)]"
        >
          Term
        </span>
        shared by two or more
      </li>
      {followed && (
        <li className={item}>
          <span aria-hidden className="eyebrow bg-text-muted text-bg px-1.5">
            Term
          </span>
          followed
        </li>
      )}
    </ul>
  );
}
