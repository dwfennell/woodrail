import { TRACK_WIDTH, type Layout } from "../track";
import { hashInts } from "./edges";
import { reachable, type Landscape, type Shed } from "./generate";
import { CELL, FEAT_FIELD, FEAT_NONE, FEAT_SHED, FEAT_TREE, MAX_HEIGHT, PLOT_CELLS, SURF_GRASS } from "./grid";
import { BUCKET, bucketKey, trackPoints } from "./trees-aside";

/** Why a square's height can't change. */
export type LandBlock = "not-grass" | "in-use" | "station-way" | "top" | "bottom" | "steep" | "track" | "prop" | "cut-off" | "off-land" | "taken" | "uneven";

export const LAND_MESSAGES: Record<LandBlock, string> = {
  "not-grass": "Only grass can be raised or lowered",
  "in-use": "Something stands there",
  "station-way": "Keep the way into the station level",
  top: "That's as high as the land goes",
  bottom: "That's as low as it goes",
  steep: "Too steep: raise or lower the squares around it first",
  track: "There's track on or beside it",
  prop: "Move what's standing there first",
  "cut-off": "That would cut a town or depot off",
  "off-land": "That's past the edge of your land",
  taken: "Something's already there",
  uneven: "Needs level ground",
};

/** Something on the map that the Move tool can pick up: a tree (or bush, or rock), a field, or the engine shed. */
export type Scenery = { kind: "tree"; cell: number } | { kind: "field"; id: number } | { kind: "shed" };

/**
 * The seed of the tree on square `i` (at col, row): kept in the square's `owner` once a tree has been moved there (so
 * it looks the same in its new place), else made from the map's seed and the square.
 */
export function treeSeed(land: Landscape, i: number, col: number, row: number): number {
  const o = land.grid.owner[i];
  return o >= 0 ? o : hashInts(land.seed, col, row, 131) & 0x7fffffff;
}

/** What scenery stands on square `i`, if any. */
export function sceneryAt(land: Landscape, i: number): Scenery | null {
  const f = land.grid.feature[i];
  if (f === FEAT_TREE) return { kind: "tree", cell: i };
  if (f === FEAT_FIELD) return { kind: "field", id: land.grid.owner[i] };
  if (f === FEAT_SHED && land.shed) return { kind: "shed" };
  return null;
}

/** The squares a piece of scenery covers (none for a removed field). */
export function sceneryCells(land: Landscape, s: Scenery): number[] {
  if (s.kind === "tree") return [s.cell];
  if (s.kind === "field") return [...(land.fields[s.id]?.cells ?? [])];
  return [...(land.shed?.cells ?? [])];
}

/** A copy of what a land edit can change about some squares and scenery, to put back (undo or redo). */
export interface LandSnapshot {
  cells: [number, number, number][];
  field?: { id: number; cells: number[] };
  shed?: Shed | null;
}

export function snapshot(land: Landscape, cells: Iterable<number>, s: Scenery | null): LandSnapshot {
  const g = land.grid;
  const out: LandSnapshot = { cells: [...new Set(cells)].map((i) => [i, g.feature[i], g.owner[i]]) };
  if (s?.kind === "field") out.field = { id: s.id, cells: [...land.fields[s.id].cells] };
  if (s?.kind === "shed") out.shed = land.shed ? { ...land.shed, cells: [...land.shed.cells] } : null;
  return out;
}

/** Put a snapshot back; returns the plot slots changed. */
export function restore(land: Landscape, snap: LandSnapshot): number[] {
  const g = land.grid;
  const slots = new Set<number>();
  for (const [i, f, o] of snap.cells) {
    g.feature[i] = f;
    g.owner[i] = o;
    slots.add(plotSlotOf(i));
  }
  if (snap.field) land.fields[snap.field.id].cells = [...snap.field.cells];
  if (snap.shed !== undefined) land.shed = snap.shed ? { ...snap.shed, cells: [...snap.shed.cells] } : null;
  for (const slot of slots) g.touch(slot);
  return [...slots];
}

/** Something standing on the land that a height change must not move: the props' footprints, as world rectangles. */
export interface LandOccupants {
  /** Does anything (a prop) stand within this world rectangle? */
  inRect(x0: number, z0: number, x1: number, z1: number): boolean;
}

const NONE: LandOccupants = { inRect: () => false };

/**
 * Checks and applies height edits (grass blocks) to a landscape. Keeps the generator's rules: only open grass (and
 * tree squares) change; heights stay within 0..MAX_HEIGHT and within one block of each square's four neighbours;
 * nothing standing on a square or beside it (track, props) is buried or left in the air; every town and depot stays
 * reachable. Build one per edit (or per stroke): it samples the track once.
 */
export class LandEditor {
  private readonly track: Map<number, number[]>;
  private readonly corridors: Set<number>;
  private readonly wasReachable: boolean;

  constructor(
    private readonly land: Landscape,
    layout: Layout | null,
    private readonly occupants: LandOccupants = NONE,
  ) {
    this.track = layout ? trackPoints(layout) : new Map();
    this.corridors = new Set(land.corridors);
    this.wasReachable = reachable(land);
  }

  /** Can square `i` go up (`+1`) or down (`-1`) a block? Null if so, else why not. */
  check(i: number, step: 1 | -1): LandBlock | null {
    const g = this.land.grid;
    if (g.surface[i] !== SURF_GRASS) return "not-grass";
    if (g.feature[i] !== FEAT_NONE && g.feature[i] !== FEAT_TREE) return "in-use";
    if (this.corridors.has(i)) return "station-way";
    const h = g.height[i] + step;
    if (h > MAX_HEIGHT) return "top";
    if (h < 0) return "bottom";
    const col = g.colOf(i);
    const row = g.rowOf(i);
    for (const [dc, dr] of DIRS) {
      const n = g.index(col + dc, row + dr);
      if (n !== -1 && Math.abs(g.height[n] - h) > 1) return "steep";
    }
    // Corners round off and ramp cuttings reach into the neighbours, so keep track a square clear all round.
    const x0 = g.centreX(col) - 1.5 * CELL;
    const z0 = g.centreZ(row) - 1.5 * CELL;
    if (this.trackIn(x0, z0, x0 + 3 * CELL, z0 + 3 * CELL)) return "track";
    if (this.occupants.inRect(x0 + CELL, z0 + CELL, x0 + 2 * CELL, z0 + 2 * CELL)) return "prop";
    if (this.wasReachable) {
      g.height[i] = h;
      const ok = reachable(this.land);
      g.height[i] = h - step;
      if (!ok) return "cut-off";
    }
    return null;
  }

  /** Raise or lower square `i` a block if allowed. Returns why not, or null when done. The caller redraws its plot. */
  apply(i: number, step: 1 | -1): LandBlock | null {
    const why = this.check(i, step);
    if (why) return why;
    this.land.grid.height[i] += step;
    this.land.grid.touch(plotSlotOf(i));
    return null;
  }

  /** Can scenery move by (dc, dr) squares? Its new squares must be open, level grass of your land, clear of track. */
  checkMove(s: Scenery, dc: number, dr: number): LandBlock | null {
    const g = this.land.grid;
    const from = sceneryCells(this.land, s);
    if (from.length === 0) return "taken";
    const own = new Set(from);
    let height = -1;
    const to: number[] = [];
    for (const i of from) {
      const t = g.index(g.colOf(i) + dc, g.rowOf(i) + dr);
      if (t === -1) return "off-land";
      if (g.surface[t] !== SURF_GRASS) return "not-grass";
      if (g.feature[t] !== FEAT_NONE && !own.has(t)) return "taken";
      if (this.corridors.has(t)) return "station-way";
      if (s.kind !== "tree") {
        if (height === -1) height = g.height[t];
        else if (g.height[t] !== height) return "uneven";
      }
      const x0 = g.centreX(g.colOf(t)) - CELL / 2;
      const z0 = g.centreZ(g.rowOf(t)) - CELL / 2;
      if (this.trackIn(x0, z0, x0 + CELL, z0 + CELL)) return "track";
      if (this.occupants.inRect(x0, z0, x0 + CELL, z0 + CELL)) return "prop";
      to.push(t);
    }
    if (this.wasReachable) {
      const snap = snapshot(this.land, [...from, ...to], s);
      moveScenery(this.land, s, dc, dr);
      const ok = reachable(this.land);
      restore(this.land, snap);
      if (!ok) return "cut-off";
    }
    return null;
  }

  private trackIn(x0: number, z0: number, x1: number, z1: number): boolean {
    const m = TRACK_WIDTH / 2;
    for (let bx = Math.floor((x0 - m) / BUCKET); bx <= Math.floor((x1 + m) / BUCKET); bx++) {
      for (let bz = Math.floor((z0 - m) / BUCKET); bz <= Math.floor((z1 + m) / BUCKET); bz++) {
        const list = this.track.get(bucketKey(bx, bz));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const x = list[k];
          const z = list[k + 1];
          if (x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m) return true;
        }
      }
    }
    return false;
  }
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The plot slot a square index is in (indices run plot by plot). */
export function plotSlotOf(i: number): number {
  return Math.floor(i / PLOT_CELLS);
}

/** Set squares' heights (undo and redo of an edit), touching their plots. Returns the plot slots changed. */
export function setHeights(land: Landscape, heights: ReadonlyMap<number, number>): number[] {
  const slots = new Set<number>();
  for (const [i, h] of heights) {
    land.grid.height[i] = h;
    slots.add(plotSlotOf(i));
  }
  for (const s of slots) land.grid.touch(s);
  return [...slots];
}

/**
 * Move scenery by (dc, dr) squares (checked first with `LandEditor.checkMove`). A tree keeps its look (its seed goes
 * with it); a field keeps its id, so its animals and look go with it. Returns the plot slots changed.
 */
export function moveScenery(land: Landscape, s: Scenery, dc: number, dr: number): number[] {
  const g = land.grid;
  const from = sceneryCells(land, s);
  const to = from.map((i) => g.index(g.colOf(i) + dc, g.rowOf(i) + dr));
  const moved = from.map((i) => [g.feature[i], s.kind === "tree" ? treeSeed(land, i, g.colOf(i), g.rowOf(i)) : g.owner[i]] as const);
  for (const i of from) {
    g.feature[i] = FEAT_NONE;
    g.owner[i] = -1;
  }
  to.forEach((t, k) => {
    g.feature[t] = moved[k][0];
    g.owner[t] = moved[k][1];
  });
  if (s.kind === "field") land.fields[s.id].cells = to;
  if (s.kind === "shed" && land.shed) land.shed = { ...land.shed, cells: to, x: land.shed.x + dc * CELL, z: land.shed.z + dr * CELL };
  const slots = new Set([...from, ...to].map(plotSlotOf));
  for (const slot of slots) g.touch(slot);
  return [...slots];
}

/** Take scenery away: its squares become open grass (a field's entry stays, with no squares). Returns the plots changed. */
export function removeScenery(land: Landscape, s: Scenery): number[] {
  const g = land.grid;
  const cells = sceneryCells(land, s);
  for (const i of cells) {
    g.feature[i] = FEAT_NONE;
    g.owner[i] = -1;
  }
  if (s.kind === "field") land.fields[s.id].cells = [];
  if (s.kind === "shed") land.shed = null;
  const slots = new Set(cells.map(plotSlotOf));
  for (const slot of slots) g.touch(slot);
  return [...slots];
}
