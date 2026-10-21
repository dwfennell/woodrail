// PROTOTYPE (claude/switch-style-proto): alternative ways to show a switch's set route, for comparing screenshots.
// Picked with localStorage "woodrail.swstyle" (or ?swstyle=… in the URL): current | burned | groove | groove-dim |
// pointer | glow. Not for landing as is.
import { BufferAttribute, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Shape } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createSample, GROOVE_SPACING, GROOVE_WIDTH, pathLength, samplePath, TRACK_THICKNESS, type PathDef, type PieceDef } from "../track";
import { GROOVE_DEPTH } from "./track-geometry";
import { nonIndexed } from "./non-indexed";

export type SwitchStyle = "current" | "burned" | "groove" | "groove-dim" | "pointer" | "glow";

function readStyle(): SwitchStyle {
  const ok = ["current", "burned", "groove", "groove-dim", "pointer", "glow"];
  try {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("swstyle") : null;
    if (q && ok.includes(q)) return q as SwitchStyle;
    const s = typeof localStorage !== "undefined" ? localStorage.getItem("woodrail.swstyle") : null;
    if (s && ok.includes(s)) return s as SwitchStyle;
  } catch {
    // (No storage: the current style.)
  }
  return "current";
}

export const SWITCH_STYLE: SwitchStyle = readStyle();

/** Burned-in chevrons: a scorched brown, a deeper red-brown stain on a pinned switch (instance colours over wood grain). */
export const BURN = "#6b3a17";
export const BURN_PINNED = "#a3260a";
/** Painted grooves: a soft toy blue for the set route; red-orange when pinned. */
export const GROOVE_PAINT = "#4f8fd0";
export const GROOVE_PAINT_PINNED = "#ff5f14";
/** Dimmed grooves (the route not set): near-black brown; a dark red when pinned. */
export const GROOVE_DIM = "#1e1209";
export const GROOVE_DIM_PINNED = "#5c1404";
/** The glow's colours (additive: scaled by its strength). */
export const GLOW = "#ffcf6a";
export const GLOW_PINNED = "#ff5f14";

const STRIP_STEP = 5;

/** The routes a switch's state sets (one per end it shows), and those it doesn't. */
export function routesShown(def: PieceDef, state: number, ends: number[], from: (def: PieceDef, end: number) => PathDef[]): { set: PathDef[]; unset: PathDef[] } {
  const set = new Set<PathDef>();
  const all = new Set<PathDef>();
  for (const end of ends) {
    const routes = from(def, end);
    for (const r of routes) all.add(r);
    set.add(routes[state % routes.length]);
  }
  return { set: [...set], unset: [...all].filter((r) => !set.has(r)) };
}

/**
 * Short strips (x, z, heading, length, piece-local) along routes' two grooves (`offsets` from the centre line: the
 * grooves, or 0 for a band down the middle). `avoid`: skip groove spots lying in another route's groove.
 */
export function stripsAlong(routes: PathDef[], offsets: number[], avoid: PathDef[] = [], overlap = 0.6): number[] {
  const out: number[] = [];
  const s = createSample();
  const q = createSample();
  const avoidPts: number[] = [];
  for (const r of avoid) {
    const l = pathLength(r.geom);
    for (let d = 0; d <= l; d += 2) {
      samplePath(r.geom, d, q);
      for (const o of [-GROOVE_SPACING / 2, GROOVE_SPACING / 2]) avoidPts.push(q.x - Math.sin(q.heading) * o, q.z + Math.cos(q.heading) * o);
    }
  }
  for (const r of routes) {
    const len = pathLength(r.geom);
    const n = Math.max(1, Math.round(len / STRIP_STEP));
    const step = len / n;
    for (let i = 0; i < n; i++) {
      samplePath(r.geom, (i + 0.5) * step, s);
      for (const o of offsets) {
        const x = s.x - Math.sin(s.heading) * o;
        const z = s.z + Math.cos(s.heading) * o;
        let hit = false;
        for (let k = 0; k < avoidPts.length && !hit; k += 2) if (Math.hypot(avoidPts[k] - x, avoidPts[k + 1] - z) < GROOVE_WIDTH / 2 + 1) hit = true;
        if (!hit) out.push(x, z, s.heading, step + overlap);
      }
    }
  }
  return out;
}

export const GROOVE_OFFSETS = [-GROOVE_SPACING / 2, GROOVE_SPACING / 2];
/** The groove floor, a hair up (mm): strips laid there show only down in the groove. */
export const GROOVE_FLOOR = TRACK_THICKNESS - GROOVE_DEPTH + 0.15;

/** A flat strip 1 mm long (along x) and `width` wide, facing up, `y` high: scaled along x to each strip's length. */
export function stripGeometry(width: number, y: number): BufferGeometry {
  const w = width / 2;
  const pos = [-0.5, y, -w, -0.5, y, w, 0.5, y, w, -0.5, y, -w, 0.5, y, w, 0.5, y, -w];
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.computeBoundingSphere();
  return g;
}

/** A wooden pointer: a flat arrow (pointing +x, about its pivot at 0) on a short round stub. */
export function pointerGeometry(): BufferGeometry {
  const sh = new Shape();
  // Shaft 16 long and 6 wide behind the pivot, head 14 long and 15 wide.
  sh.moveTo(-8, -3);
  sh.lineTo(8, -3);
  sh.lineTo(8, -7.5);
  sh.lineTo(22, 0);
  sh.lineTo(8, 7.5);
  sh.lineTo(8, 3);
  sh.lineTo(-8, 3);
  sh.closePath();
  const arrow = new ExtrudeGeometry(sh, { depth: 3, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 1 });
  // Lie it flat (the shape's y becomes z), its top at 9 mm.
  arrow.rotateX(Math.PI / 2);
  arrow.translate(0, 8.4, 0);
  const stub = new CylinderGeometry(3, 4, 6, 12).translate(0, 3, 0);
  return mergeGeometries([arrow, stub].map(nonIndexed).map((g) => {
    g.deleteAttribute("uv");
    return g;
  }));
}

/**
 * Which way a switch's pointer points (radians, piece-local, 0 along the trunk): toward where the set route from the
 * trunk ends up, its turn exaggerated so a branch reads as one (×1.6, at least 25°).
 */
export function pointerAngle(route: PathDef): number {
  const s = createSample();
  samplePath(route.geom, 0, s);
  const x0 = s.x;
  const z0 = s.z;
  samplePath(route.geom, pathLength(route.geom), s);
  const a = Math.atan2(s.z - z0, s.x - x0);
  if (Math.abs(a) < 0.02) return 0;
  return Math.sign(a) * Math.min(1.1, Math.max(0.44, Math.abs(a) * 1.6));
}

/** How bright a glow is `t` s after it started: up quickly, held, then fading out (0 when done). */
export function glowLevel(t: number): number {
  if (t < 0.1) return t / 0.1;
  if (t < 0.6) return 1;
  if (t < 1.5) return 1 - (t - 0.6) / 0.9;
  return 0;
}
export const GLOW_S = 1.5;
