import type { DepotState, Economy, Line, RouteStopDef } from "../economy";
import { flipCursor, type Cursor } from "../sim";
import { topologyOf } from "../economy/sections";
import { trainLength } from "../sim/train-cars";
import { legFromCursor, runsLength, viaLegs, type LegStop, type PathRun } from "./route-path";

/**
 * Lines: a train's route with a colour and a name (see docs/superpowers/specs/2026-10-17-routes-design.md). The
 * economy keeps them (`Economy.lines`, `lineIdOf`) and runs the trains on them (each engine's `Route` holds its line's
 * very `stops` array); this module makes them and edits them, keeping each train heading for the stop it was.
 */

/** The lines' colours, in the order new lines take them: bright toy paints, apart from track, grass and roofs. */
export const LINE_COLOURS: readonly { colour: string; name: string }[] = [
  { colour: "#e0533d", name: "Red" },
  { colour: "#2f6db5", name: "Blue" },
  { colour: "#e6b52c", name: "Yellow" },
  { colour: "#3c9a5f", name: "Green" },
  { colour: "#8a4fb5", name: "Purple" },
  { colour: "#e07b2e", name: "Orange" },
  { colour: "#2fa3b5", name: "Teal" },
  { colour: "#c2457a", name: "Pink" },
];

/** The line this engine runs, if any. */
export function lineOf(economy: Economy, engineCarId: number): Line | undefined {
  const id = economy.lineIdOf.get(engineCarId);
  return id === undefined ? undefined : economy.lines.get(id);
}

/**
 * A colour's line name no line has yet: "Red line", else "Red line 2", "Red line 3"… (past eight lines the colours come
 * round again, and two lines of one name couldn't be told apart in the Lines list).
 */
export function freeName(economy: Economy, colourName: string): string {
  const taken = new Set([...economy.lines.values()].map((l) => l.name));
  const base = `${colourName} line`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A new line's colour and name: the first colour no line has (then round again). */
export function nextColour(economy: Economy): { colour: string; name: string } {
  const used = new Set([...economy.lines.values()].map((l) => l.colour));
  const free = LINE_COLOURS.find((c) => !used.has(c.colour));
  return free ?? LINE_COLOURS[economy.lines.size % LINE_COLOURS.length];
}

/** A line made for this engine, with these stops, its train heading for the first. (Replaces any line it ran.) */
export function startLine(economy: Economy, engineCarId: number, stops: RouteStopDef[], id = nextLineId(economy), look = nextColour(economy)): Line {
  const line: Line = { id, colour: look.colour, name: freeName(economy, look.name), stops: [...stops] };
  economy.lines.set(id, line);
  economy.lineIdOf.set(engineCarId, id);
  economy.setRoute(engineCarId, line.stops.length > 0 ? { stops: line.stops, next: 0 } : null);
  return line;
}

/**
 * A line of its own, no train running it yet (made from the Lines list, or kept when its last train left): these stops,
 * the next free colour. Trains are put on it later (`joinLine`).
 */
export function createLine(economy: Economy, stops: readonly RouteStopDef[], look = nextColour(economy), id = nextLineId(economy)): Line {
  const line: Line = { id, colour: look.colour, name: freeName(economy, look.name), stops: stops.map(copyStop) };
  economy.lines.set(id, line);
  return line;
}

/**
 * A line gone, by the player's hand (the Lines list's Delete): its trains run no line now (they go anywhere again), and
 * it's forgotten. (Taking a line's last train off it keeps the line: `stopLine`.)
 */
export function deleteLine(economy: Economy, id: number): void {
  for (const engine of trainsOn(economy, id)) {
    economy.lineIdOf.delete(engine);
    economy.setRoute(engine, null);
  }
  economy.lines.delete(id);
}

function nextLineId(economy: Economy): number {
  let id = 1;
  for (const k of economy.lines.keys()) id = Math.max(id, k + 1);
  return id;
}

/** The engines that run line `id`. */
export function trainsOn(economy: Economy, id: number): number[] {
  const out: number[] = [];
  for (const [engine, line] of economy.lineIdOf) if (line === id) out.push(engine);
  return out;
}

/**
 * Change this engine's line: `edit` gets its stops (in place) and changes them; the line is made if it has none. Every
 * train on the line keeps heading for the stop it was (where it's still on the line), else the one now in that place.
 * No stops left: the line's gone, and its trains go anywhere again.
 */
export function editLine(economy: Economy, engineCarId: number, edit: (stops: RouteStopDef[]) => void): Line | null {
  const line = lineOf(economy, engineCarId) ?? startLine(economy, engineCarId, []);
  return editLineById(economy, line.id, edit);
}

/**
 * Change line `id`'s stops (`editLine`, by the line rather than one of its trains: a line no train runs is edited so
 * too). No stops left: the line's gone, and its trains (if any) go anywhere again. Null too for no such line.
 */
export function editLineById(economy: Economy, id: number, edit: (stops: RouteStopDef[]) => void): Line | null {
  const line = economy.lines.get(id);
  if (!line) return null;
  const had = line.stops.length;
  const trains = trainsOn(economy, line.id).map((engine) => {
    const route = economy.routeOf(engine);
    return { engine, route, heading: route ? line!.stops[route.next % Math.max(1, line!.stops.length)] : undefined, at: route?.next ?? 0 };
  });
  edit(line.stops);
  if (line.stops.length === 0) {
    deleteLine(economy, line.id);
    return null;
  }
  for (const t of trains) {
    // (The line just got its second stop: a way to run. Each train heads for the stop it comes to first along its way,
    // not the first tapped: it never turns round mid-line, so one just past that stop went the whole way round to it,
    // play-test 2026-11-01. Its ▶ on the card moves there.)
    if (had < 2 && line.stops.length >= 2) {
      const first = firstStopAhead(economy, t.engine, line.stops);
      if (first !== -1) {
        economy.setRoute(t.engine, { stops: line.stops, next: first, at: false });
        continue;
      }
    }
    const kept = t.heading ? line.stops.indexOf(t.heading) : -1;
    const next = kept !== -1 ? kept : Math.min(t.at, line.stops.length - 1);
    // (Via points passed on its way to the stop it was heading for stay passed.)
    const via = kept !== -1 && t.route?.viaFor === t.at ? { viaFor: next, viaDone: t.route.viaDone } : {};
    economy.setRoute(t.engine, { stops: line.stops, next, at: kept !== -1 ? t.route?.at : false, ...via });
  }
  return line;
}

/**
 * This engine runs line `id` from now on (leaving any it ran), heading for the line's stop it comes to first along its
 * way (`firstStopAhead`; the first stop if none can be reached).
 */
export function joinLine(economy: Economy, engineCarId: number, id: number): Line | null {
  const line = economy.lines.get(id);
  if (!line || line.stops.length === 0) return null;
  if (economy.lineIdOf.get(engineCarId) === id) return line;
  stopLine(economy, engineCarId);
  economy.lineIdOf.set(engineCarId, id);
  const first = line.stops.length >= 2 ? firstStopAhead(economy, engineCarId, line.stops) : -1;
  economy.setRoute(engineCarId, { stops: line.stops, next: first === -1 ? 0 : first });
  return line;
}

/**
 * A line's stop at depot `d` for the way between stops (`viaLegs`): its piece, its via points on to the next stop, and,
 * a depot of several tracks, all those a train can reach (`Economy.reachableTracks`). The user, 2026-11-22: a
 * warehouse's second track on another line than its first, its stop drawn out of reach ("!") though trains loaded there.
 */
export function legStop(economy: Economy, d: DepotState, via?: readonly number[]): LegStop {
  const tracks = economy.trackCount(d.id) > 1 ? economy.reachableTracks(d) : undefined;
  return { piece: d.pieceId, ...(via ? { via } : {}), ...(tracks && tracks.length > 1 ? { tracks } : {}) };
}

/**
 * The railways (`Economy.railwayOf`: track joined to one another, whatever the switches) a stop's place is on: those of
 * each of its tracks a train can reach. Empty: not on the map.
 */
export function railwaysOf(economy: Economy, depotId: number): Set<number> {
  const d = economy.liveDepot(depotId);
  return new Set(d ? economy.reachableTracks(d).map((p) => economy.railwayOf(p)) : []);
}

/**
 * Is stop `k` of a line on a railway none of its other stops is on (no track joins it to theirs: the user's 2026-11-26
 * Warehouse 2, moved onto the main line beside Orange line 2's loop)? False with no other stop on the map, or for a
 * place off the map (in the hand). For the sheet's word when a place is tapped in.
 */
export function stopApart(economy: Economy, stops: readonly RouteStopDef[], k: number): boolean {
  const mine = railwaysOf(economy, stops[k].depotId);
  if (mine.size === 0) return false;
  let others = 0;
  for (let i = 0; i < stops.length; i++) {
    if (i === k || stops[i].depotId === stops[k].depotId) continue;
    const theirs = railwaysOf(economy, stops[i].depotId);
    if (theirs.size === 0) continue;
    others++;
    for (const r of theirs) if (mine.has(r)) return false;
  }
  return others > 0;
}

/**
 * The stop (an index into `stops`) the train with this engine comes to first along its way: the shortest of the ways a
 * routed train would take from its front (as the drawn line and the router choose at points; it turns round only where
 * the track ends) to each stop on the map, the earlier stop on a tie. −1: it's not on the track, or reaches none.
 */
export function firstStopAhead(economy: Economy, engineCarId: number, stops: readonly RouteStopDef[]): number {
  const found = economy.sim.findCar(engineCarId);
  if (!found || found.train.derailed) return -1;
  const t = found.train;
  const engine = t.cars[found.index];
  // (The way it's going, or standing, the way its front faces: as the map's ribbon reads it.)
  const way = (engine.lever || 1) * engine.facing;
  const front: Cursor = { ...(way > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1]) };
  if (way < 0) flipCursor(economy.layout, front);
  let best = -1;
  let bestLen = Infinity;
  const seen = new Map<number, number>();
  stops.forEach((st, k) => {
    const d = economy.liveDepot(st.depotId);
    if (!d) return;
    let len = seen.get(d.pieceId);
    if (len === undefined) {
      // (To its nearest track, a depot of several.)
      len = Infinity;
      for (const p of economy.reachableTracks(d)) {
        const leg = legFromCursor(economy.layout, front, p);
        if (leg) len = Math.min(len, runsLength(leg));
      }
      seen.set(d.pieceId, len);
    }
    if (len < bestLen) [best, bestLen] = [k, len];
  });
  return best;
}

/** A line's new name (trimmed, kept short; empty keeps the old one). */
export function renameLine(economy: Economy, id: number, name: string): void {
  const line = economy.lines.get(id);
  const n = name.trim().slice(0, LINE_NAME_MAX);
  if (line && n) line.name = n;
}

/** Longest a line's name may be. */
export const LINE_NAME_MAX = 24;

/** A line's new colour (one of `LINE_COLOURS`); its name follows if it was the colour's own ("Red line"). */
export function recolourLine(economy: Economy, id: number, colour: string): void {
  const line = economy.lines.get(id);
  const to = LINE_COLOURS.find((c) => c.colour === colour);
  if (!line || !to) return;
  const from = LINE_COLOURS.find((c) => c.colour === line.colour);
  // (Its own colour's name, numbered or not: it takes the new colour's, one no other line has.)
  if (from && (line.name === `${from.name} line` || new RegExp(`^${from.name} line \\d+$`).test(line.name))) {
    line.name = "";
    line.name = freeName(economy, to.name);
  }
  line.colour = colour;
}

/**
 * The player takes this train off its line (its card's Leave line, or the line sheet's Take off): it runs no line now,
 * hand-run, and stands where it is (once clear of points: it never stands on them, `stopClearOfPoints`). The line stays,
 * run by its other trains or none ("No trains" in the Lines list). False if it ran no line.
 */
export function takeOffLine(economy: Economy, engineCarId: number): boolean {
  if (!economy.lineIdOf.has(engineCarId)) return false;
  stopLine(economy, engineCarId);
  economy.stopClearOfPoints(engineCarId);
  return true;
}

/**
 * The trains of line `lineId` this train, standing where it is, keeps from going round: none when no other train runs
 * the line, or the train stands off the line's way (a siding, the other road of a passing loop, another line's track).
 * The line's way is its lap as its trains plan it (`viaLegs`); a piece of it that's a loop road doesn't count, as the
 * others take the loop's other road (2026-11-16: Leave line on a single oval left the train on the only track, and the
 * line's other train waited behind it for good; the toast now says so, and only then).
 */
export function inTheWayOf(economy: Economy, engineCarId: number, lineId: number): number[] {
  const line = economy.lines.get(lineId);
  const train = economy.sim.findCar(engineCarId)?.train;
  if (!line || !train) return [];
  const others = [...economy.lineIdOf].filter(([e, id]) => id === lineId && e !== engineCarId && !train.cars.some((c) => c.id === e)).map(([e]) => e);
  if (others.length === 0) return [];
  const stops: LegStop[] = [];
  for (const st of line.stops) {
    const d = economy.liveDepot(st.depotId);
    if (d) stops.push(legStop(economy, d, st.via));
  }
  const way = new Set<number>();
  for (const leg of viaLegs(economy.layout, stops)) for (const r of leg ?? []) way.add(r.pieceId);
  for (const st of stops) for (const p of st.tracks ?? [st.piece]) way.add(p);
  const under = [...economy.sim.piecesUnder(train.id)].filter((p) => way.has(p));
  if (under.length === 0) return [];
  // (The loops the line's trains fit, as the line's own rules count them: for its longest train.)
  let longest = trainLength(train);
  for (const e of others) {
    const t = economy.sim.findCar(e)?.train;
    if (t) longest = Math.max(longest, trainLength(t));
  }
  const topo = topologyOf(economy.layout, longest);
  const onRoad = (p: number) => {
    const sl = topo.slotOf.get(p);
    return sl !== undefined && topo.slots[sl].kind === "road" && !topo.pinnedLoops.some((l) => l.pieces.includes(p));
  };
  return under.every(onRoad) ? [] : others;
}

/**
 * This engine runs no line now (goes anywhere, works at every stop). Its line stays, run by no train if this was its
 * last (the Lines list shows it, to put a train on again), but for a transient one (a call home), which is forgotten.
 */
export function stopLine(economy: Economy, engineCarId: number): void {
  const id = economy.lineIdOf.get(engineCarId);
  economy.lineIdOf.delete(engineCarId);
  economy.setRoute(engineCarId, null);
  if (id !== undefined && economy.lines.get(id)?.transient && ![...economy.lineIdOf.values()].includes(id)) economy.lines.delete(id);
}

/** Move a stop from `from` to `to` in a stop list (for reordering), in place. */
export function moveStop(stops: RouteStopDef[], from: number, to: number): void {
  if (from === to || from < 0 || from >= stops.length) return;
  const [s] = stops.splice(from, 1);
  stops.splice(Math.max(0, Math.min(stops.length, to)), 0, s);
}

/**
 * A line's stops the other way round, in place: the order reversed, and each leg's via points with it (a leg's via
 * points are kept on the stop it leaves, so those of the leg from a to b, run from b to a, go on b, in reverse order).
 * Each stop's own settings (what it does, wait to fill) go with it.
 */
export function reverseStops(stops: RouteStopDef[]): void {
  const n = stops.length;
  if (n < 2) return;
  const vias = stops.map((st) => st.via);
  stops.reverse();
  // (Now stop i is old n−1−i; its leg on is to old n−2−i, the old leg from n−2−i to n−1−i, run back. The last, old 0,
  // goes on to old n−1: the old leg from n−1 round to 0.)
  stops.forEach((st, i) => {
    const via = vias[i === n - 1 ? n - 1 : n - 2 - i];
    if (via && via.length > 0) st.via = [...via].reverse();
    else delete st.via;
  });
}

/**
 * A copy of line `id` (its stops, their settings and via points), a new line in the next colour, run by this engine
 * (which runs no line), heading for the stop it comes to first along its way (`firstStopAhead`; else the first).
 */
export function copyLine(economy: Economy, id: number, engineCarId: number): Line | null {
  const from = economy.lines.get(id);
  if (!from || from.stops.length === 0) return null;
  stopLine(economy, engineCarId);
  const line = startLine(
    economy,
    engineCarId,
    from.stops.map((st) => ({ ...st, ...(st.via ? { via: [...st.via] } : {}) })),
  );
  const first = line.stops.length >= 2 ? firstStopAhead(economy, engineCarId, line.stops) : -1;
  economy.setRoute(engineCarId, { stops: line.stops, next: first === -1 ? 0 : first });
  return line;
}

/** The most via points a stop keeps (on the way to the next stop). */
export const MAX_VIAS = 8;

/** A saved line, as the save format keeps it: stops as [depot id, action, wait to fill, via points (if any)]. */
export interface SavedLine {
  id: number;
  colour: string;
  name: string;
  transient?: true;
  stops: ([number, RouteStopDef["action"], boolean] | [number, RouteStopDef["action"], boolean, number[]])[];
}

/** A saved line made afresh, its stops at depots no longer on the map left out (none left: null, not made). */
function lineFromSave(economy: Economy, spec: SavedLine): Line | null {
  const stops = spec.stops
    .filter(([d]) => economy.depot(d))
    .map(([depotId, action, waitFill, vias]): RouteStopDef => ({ depotId, action, ...(waitFill ? { waitFill } : {}), ...(vias && vias.length > 0 ? { via: [...vias] } : {}) }));
  if (stops.length === 0) return null;
  const line: Line = { id: spec.id, colour: spec.colour, name: spec.name, stops, ...(spec.transient ? { transient: true } : {}) };
  economy.lines.set(spec.id, line);
  return line;
}

/**
 * Loading a save: every saved line, before the trains (which then join theirs, `joinSavedLine`), so a line no train
 * runs comes back too. (Saves from before lines could stand alone listed only lines their trains ran: the same.) A
 * transient line comes back only with a train on it.
 */
export function loadSavedLines(economy: Economy, saved: readonly SavedLine[]): void {
  for (const spec of saved) if (!spec.transient && !economy.lines.has(spec.id)) lineFromSave(economy, spec);
}

/**
 * Loading a save: put this engine on its saved line (made the first time one of its trains is loaded), heading for
 * stop `next`. Stops at depots no longer on the map are left out; a line left with none isn't run.
 */
export function joinSavedLine(economy: Economy, saved: readonly SavedLine[], engineCarId: number, id: number, next: number, via = 0): void {
  let line = economy.lines.get(id) ?? null;
  if (!line) {
    const spec = saved.find((l) => l.id === id);
    line = spec ? lineFromSave(economy, spec) : null;
    if (!line) return;
  }
  economy.lineIdOf.set(engineCarId, id);
  const at = Math.min(next, line.stops.length - 1);
  economy.setRoute(engineCarId, { stops: line.stops, next: at, ...(via > 0 ? { viaFor: at, viaDone: via } : {}) });
}

/** A stop's fields, copied (its via points a list of their own). */
const copyStop = (s: RouteStopDef): RouteStopDef => ({ depotId: s.depotId, action: s.action, ...(s.waitFill ? { waitFill: true } : {}), ...(s.via ? { via: [...s.via] } : {}) });

/** Where a train is on its line: the stop object it's heading for, at it or not, and its via points passed. */
interface LineRun {
  readonly engine: number;
  readonly line: number;
  readonly heading: RouteStopDef | undefined;
  readonly next: number;
  readonly at: boolean;
  readonly viaFor?: number;
  readonly viaDone?: number;
}

/**
 * The lines as they stand, for a route edit's undo and redo (audit F1): every line (the very objects, with their stops'
 * fields copied), and each train on one, where it is on it. Small: a few lines of a few stops.
 */
export interface LinesSnapshot {
  readonly lines: readonly { readonly line: Line; readonly colour: string; readonly name: string; readonly stops: readonly { readonly ref: RouteStopDef; readonly copy: RouteStopDef }[] }[];
  readonly runs: readonly LineRun[];
}

function runOf(economy: Economy, engine: number, id: number): LineRun {
  const r = economy.routeOf(engine);
  const line = economy.lines.get(id);
  const heading = r && line && line.stops.length > 0 ? line.stops[r.next % line.stops.length] : undefined;
  return { engine, line: id, heading, next: r?.next ?? 0, at: !!r?.at, ...(r?.viaFor !== undefined ? { viaFor: r.viaFor, viaDone: r.viaDone } : {}) };
}

export function snapshotLines(economy: Economy): LinesSnapshot {
  return {
    lines: [...economy.lines.values()].map((line) => ({ line, colour: line.colour, name: line.name, stops: line.stops.map((ref) => ({ ref, copy: copyStop(ref) })) })),
    runs: [...economy.lineIdOf].map(([engine, id]) => runOf(economy, engine, id)),
  };
}

/** Do two snapshots say the same (the same lines, stops and trains on them; not where the trains are on them)? */
export function sameLines(a: LinesSnapshot, b: LinesSnapshot): boolean {
  const key = (s: LinesSnapshot) =>
    JSON.stringify([s.lines.map((l) => [l.line.id, l.colour, l.name, l.stops.map((st) => st.copy)]), s.runs.map((r) => [r.engine, r.line]).sort((x, y) => x[0] - y[0])]);
  return key(a) === key(b);
}

/**
 * Put the lines back as `to` has them (a route edit undone or redone): their stops, names and colours, which train
 * runs which. A train still where `from` (the state the edit left, or the undo before) had it on its line goes back to
 * where `to` had it (it heads where it did before the edit); one that has run on since keeps heading for its stop where
 * that's still on the line, else for the stop it comes to first. Trains no longer on the map are left out; a line no
 * train runs stays (but for a transient one).
 */
export function restoreLines(economy: Economy, to: LinesSnapshot, from: LinesSnapshot): void {
  // Where each train is now, and whether that's still as `from` left it.
  const now = new Map([...economy.lineIdOf].map(([engine, id]) => [engine, runOf(economy, engine, id)]));
  const was = new Map(from.runs.map((r) => [r.engine, r]));
  const unmoved = (engine: number) => {
    const n = now.get(engine);
    const f = was.get(engine);
    if (!n || !f) return !n && !f;
    return n.line === f.line && n.heading === f.heading && n.at === f.at;
  };
  const still = new Map([...new Set([...now.keys(), ...to.runs.map((r) => r.engine)])].map((e) => [e, unmoved(e)]));
  const onMap = (engine: number) => !!economy.sim.findCar(engine);
  // The lines: each stop object as it was, in its place.
  for (const id of [...economy.lines.keys()]) if (!to.lines.some((l) => l.line.id === id)) economy.lines.delete(id);
  for (const l of to.lines) {
    if (l.line.transient && !to.runs.some((r) => r.line === l.line.id && onMap(r.engine))) {
      economy.lines.delete(l.line.id);
      continue;
    }
    for (const { ref, copy } of l.stops) {
      ref.depotId = copy.depotId;
      ref.action = copy.action;
      if (copy.waitFill) ref.waitFill = true;
      else delete ref.waitFill;
      if (copy.via) ref.via = [...copy.via];
      else delete ref.via;
    }
    l.line.stops.splice(0, l.line.stops.length, ...l.stops.map((s) => s.ref));
    l.line.colour = l.colour;
    l.line.name = l.name;
    economy.lines.set(l.line.id, l.line);
  }
  // The trains: off lines `to` hasn't them on; on the rest, heading as said above.
  for (const engine of [...economy.lineIdOf.keys()]) {
    if (to.runs.some((r) => r.engine === engine)) continue;
    economy.lineIdOf.delete(engine);
    economy.setRoute(engine, null);
  }
  for (const run of to.runs) {
    const line = economy.lines.get(run.line);
    if (!line || !onMap(run.engine)) continue;
    economy.lineIdOf.set(run.engine, run.line);
    const cur = now.get(run.engine);
    const as = still.get(run.engine) ? run : cur && cur.line === run.line && cur.heading && line.stops.includes(cur.heading) ? cur : null;
    let next: number;
    let at = false;
    let via = {};
    if (as) {
      const k = as.heading ? line.stops.indexOf(as.heading) : -1;
      next = k !== -1 ? k : Math.min(as.next, line.stops.length - 1);
      at = k !== -1 && as.at;
      if (k !== -1 && as.viaFor !== undefined && as.viaFor === as.next) via = { viaFor: next, viaDone: as.viaDone };
    } else {
      const first = line.stops.length >= 2 ? firstStopAhead(economy, run.engine, line.stops) : -1;
      next = first !== -1 ? first : 0;
    }
    economy.setRoute(run.engine, { stops: line.stops, next, at, ...via });
  }
}

/** Does a run of track turn back on itself here (the next run on the same path, the other way: the end of a line)? */
function turnsBack(runs: readonly PathRun[]): boolean {
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1];
    const b = runs[i];
    if (a.pieceId === b.pieceId && a.pathIndex === b.pathIndex && a.s1 - a.s0 !== 0 && b.s1 - b.s0 !== 0 && Math.sign(a.s1 - a.s0) !== Math.sign(b.s1 - b.s0)) return true;
  }
  return false;
}

/**
 * Is this line a ring: its trains go one way round it, lap after lap, never turning back where a line ends (an oval, or
 * a line with a balloon loop at each end)? On one, the stops run the other way round mean the trains must turn round
 * too, or they keep their way and go the long way round to each stop. False where a way between its stops isn't known.
 */
export function isRingLine(economy: Economy, stops: readonly RouteStopDef[]): boolean {
  const layout = economy.layout;
  const legStops: LegStop[] = [];
  for (const st of stops) {
    const d = economy.liveDepot(st.depotId);
    if (!d) continue;
    legStops.push(legStop(economy, d, st.via));
  }
  if (new Set(legStops.map((s) => s.piece)).size < 2) return false;
  const legs = viaLegs(layout, legStops);
  if (legs.some((l) => !l)) return false;
  // (Each leg goes on the way the one before it arrives: only within a leg can it turn back. All the legs one run, for
  // a turn at a stop's own piece end between two legs.)
  const all = legs.flatMap((l) => l!);
  return all.length > 0 && !turnsBack(all);
}

/** Why a train on a ring wasn't turned round, for the Lines view. */
export type NotTurned = "derailed" | "riding" | "no-room";

export interface ReversedLine {
  /** It's a ring: its trains were to be turned round. */
  readonly ring: boolean;
  /** The engines turned round (now running the other way). */
  readonly turned: readonly number[];
  /** The engines that couldn't be, and why (they keep their way: the long way round). */
  readonly stuck: readonly { readonly engine: number; readonly why: NotTurned; readonly by: number | null }[];
}

/**
 * Line `id`'s stops the other way round (`reverseStops`). On a ring (`isRingLine`) its trains are lifted and turned
 * round where they are, so they really run the other way: each heads for the stop it comes to first along its new way
 * (one being worked at its stop stays there, and leaves the other way). One that can't be turned (off the track, on a
 * lift, no room) keeps its way, and is listed with why. Elsewhere (a line with ends) its trains turn back at the ends as
 * before: each keeps heading for its stop.
 */
export function reverseLine(economy: Economy, id: number): ReversedLine | null {
  const line = economy.lines.get(id);
  const engines = trainsOn(economy, id);
  if (!line || engines.length === 0 || line.stops.length < 2) return null;
  const ring = isRingLine(economy, line.stops);
  editLine(economy, engines[0], reverseStops);
  if (!ring) return { ring, turned: [], stuck: [] };
  return { ring, ...turnTrains(economy, id, engines) };
}

/**
 * Lift these engines' trains on line `id` and turn them round where they are (`Sim.liftAndTurn`): each then heads for
 * the line's stop it comes to first along its new way (one being worked at its stop stays there, and leaves the other
 * way). Those that can't be turned are listed with why. (Reverse on a ring, and its undo and redo.)
 */
export function turnTrains(economy: Economy, id: number, engines: readonly number[]): { turned: number[]; stuck: { engine: number; why: NotTurned; by: number | null }[] } {
  const turned: number[] = [];
  const stuck: { engine: number; why: NotTurned; by: number | null }[] = [];
  const line = economy.lines.get(id);
  if (!line) return { turned, stuck };
  for (const engine of engines) {
    const found = economy.sim.findCar(engine);
    if (!found || economy.lineIdOf.get(engine) !== id) continue;
    const r = economy.sim.liftAndTurn(found.train.id);
    if (r.kind === "none") continue;
    if (r.kind !== "turned") {
      stuck.push({ engine, why: r.kind, by: r.kind === "no-room" ? r.by : null });
      continue;
    }
    turned.push(engine);
    const route = economy.routeOf(engine);
    if (route?.at) continue;
    const first = firstStopAhead(economy, engine, line.stops);
    economy.setRoute(engine, { stops: line.stops, next: first === -1 ? (route?.next ?? 0) : first, at: false });
  }
  return { turned, stuck };
}

/**
 * Put `stop` into a line's stops at `at` (0…length; length: at the end), in place. The stop before it (the last, for
 * the first place: a line runs round) keeps the first `keep` of its via points, on its way to the new stop; the rest
 * go on with the new stop, on its way to the next (all kept by default: as a stop added at the end always was).
 */
export function insertStop(stops: RouteStopDef[], at: number, stop: RouteStopDef, keep = Infinity): void {
  const n = stops.length;
  const k = Math.max(0, Math.min(n, at));
  const prev = n > 0 ? stops[(k - 1 + n) % n] : undefined;
  const added: RouteStopDef = { ...stop };
  delete added.via;
  if (prev?.via && keep < prev.via.length) {
    const rest = prev.via.slice(Math.max(0, keep));
    if (keep <= 0) delete prev.via;
    else prev.via = prev.via.slice(0, keep);
    if (rest.length > 0) added.via = rest;
  }
  stops.splice(k, 0, added);
}

/** Where a new stop fits a line best (`bestInsert`): its place in the stops, and how many via points stay before it. */
export interface InsertFit {
  /** Its index once in (0…length; length: the end). */
  readonly at: number;
  /** Of the stop before's via points, how many stay on its way to the new stop (`insertStop`'s `keep`). */
  readonly keep: number;
  /** It goes in between two stops, not at the end. */
  readonly between: boolean;
}

/**
 * Where a place tapped fits a line best (route-insert, 2026-11-16: "it's still quite difficult to add a stop where you
 * want to add one in an existing route"): the place in its stops (and split of the via points there) adding the least
 * track to a lap of the line, as its trains run it (`viaLegs`: they don't turn round at a stop). On a tie (a place
 * on a line with ends adds nothing between either pair it lies between, there and back) the first gap whose way
 * already passes it, else the end, else the first. At the end, as before, where the line has fewer than two stops, the
 * place is on it already (A → B → A is asked for in order), a stop is off the map, or no way is known.
 */
export function bestInsert(economy: Economy, stops: readonly RouteStopDef[], depotId: number): InsertFit {
  const n = stops.length;
  const end: InsertFit = { at: n, keep: stops[n - 1]?.via?.length ?? 0, between: false };
  const piece = economy.liveDepot(depotId)?.pieceId;
  if (n < 2 || piece === undefined || stops.some((st) => st.depotId === depotId)) return end;
  const lap = lapOf(economy, stops);
  if (!lap) return end;
  const base = viaLegs(economy.layout, stops.map((st) => legStop(economy, economy.liveDepot(st.depotId)!, st.via)));
  const fits: { k: number; keep: number; cost: number; onWay: boolean }[] = [];
  for (let k = 0; k < n; k++) {
    // (The same place twice in a row is one stop: never next to itself.)
    if (stops[k].depotId === depotId || stops[(k + 1) % n].depotId === depotId) continue;
    const leg = base[k];
    fits.push({ k, ...splitAt(lap, stops, depotId, k + 1), onWay: !!leg && leg.some((r) => r.pieceId === piece) });
  }
  const least = Math.min(...fits.map((f) => f.cost));
  if (!Number.isFinite(least)) return end;
  // (Within a millimetre: the same way, summed in another order.)
  const ties = fits.filter((f) => f.cost <= least + 1);
  const pick = ties.find((f) => f.onWay) ?? ties.find((f) => f.k === n - 1) ?? ties[0];
  return { at: pick.k + 1, keep: pick.keep, between: pick.k < n - 1 };
}

/**
 * A new stop put in at `at` by the player's choice (the sheet's +): how many of the stop before's via points stay on
 * its way to the new stop, the rest going on with it (the split adding the least track; all stay where no way is known).
 */
export function keepAt(economy: Economy, stops: readonly RouteStopDef[], depotId: number, at: number): number {
  const n = stops.length;
  const vias = n > 0 ? (stops[(at - 1 + n) % n].via?.length ?? 0) : 0;
  const lap = vias > 0 && economy.liveDepot(depotId) ? lapOf(economy, stops) : null;
  return lap ? splitAt(lap, stops, depotId, at).keep : vias;
}

/** A line's lap length (mm) for a list of stops (Infinity where a leg has no way); null where a stop's off the map. */
function lapOf(economy: Economy, stops: readonly RouteStopDef[]): ((list: readonly RouteStopDef[]) => number) | null {
  if (stops.some((st) => !economy.liveDepot(st.depotId))) return null;
  return (list) => {
    let total = 0;
    for (const leg of viaLegs(economy.layout, list.map((st) => legStop(economy, economy.liveDepot(st.depotId)!, st.via)))) {
      if (!leg) return Infinity;
      total += runsLength(leg);
    }
    return total;
  };
}

/** The best split of the via points before a new stop at `at`: how many stay (most on a tie), and the lap then. */
function splitAt(lap: (list: readonly RouteStopDef[]) => number, stops: readonly RouteStopDef[], depotId: number, at: number): { keep: number; cost: number } {
  const n = stops.length;
  const vias = stops[(at - 1 + n) % n].via?.length ?? 0;
  let best = { keep: vias, cost: Infinity };
  for (let keep = vias; keep >= 0; keep--) {
    const trial = stops.map(copyStop);
    insertStop(trial, at, { depotId, action: "auto" }, keep);
    const cost = lap(trial);
    if (cost < best.cost - 1) best = { keep, cost };
  }
  return best;
}
