import type { Economy, Line, RouteStopDef } from "../economy";

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

/** A new line's colour and name: the first colour no line has (then round again). */
function nextColour(economy: Economy): { colour: string; name: string } {
  const used = new Set([...economy.lines.values()].map((l) => l.colour));
  const free = LINE_COLOURS.find((c) => !used.has(c.colour));
  return free ?? LINE_COLOURS[economy.lines.size % LINE_COLOURS.length];
}

/** A line made for this engine, with these stops, its train heading for the first. (Replaces any line it ran.) */
export function startLine(economy: Economy, engineCarId: number, stops: RouteStopDef[], id = nextLineId(economy), look = nextColour(economy)): Line {
  const line: Line = { id, colour: look.colour, name: `${look.name} line`, stops: [...stops] };
  economy.lines.set(id, line);
  economy.lineIdOf.set(engineCarId, id);
  economy.setRoute(engineCarId, line.stops.length > 0 ? { stops: line.stops, next: 0 } : null);
  return line;
}

function nextLineId(economy: Economy): number {
  let id = 1;
  for (const k of economy.lines.keys()) id = Math.max(id, k + 1);
  return id;
}

/**
 * Change this engine's line: `edit` gets its stops (in place) and changes them; the line is made if it has none.
 * Its train keeps heading for the stop it was (where it's still on the line), else the one now in that place. No stops
 * left: the line's gone, and the train goes anywhere again.
 */
export function editLine(economy: Economy, engineCarId: number, edit: (stops: RouteStopDef[]) => void): Line | null {
  let line = lineOf(economy, engineCarId);
  if (!line) line = startLine(economy, engineCarId, []);
  const route = economy.routeOf(engineCarId);
  const heading = route ? line.stops[route.next % Math.max(1, line.stops.length)] : undefined;
  const at = route?.next ?? 0;
  edit(line.stops);
  if (line.stops.length === 0) {
    stopLine(economy, engineCarId);
    return null;
  }
  const kept = heading ? line.stops.indexOf(heading) : -1;
  const next = kept !== -1 ? kept : Math.min(at, line.stops.length - 1);
  economy.setRoute(engineCarId, { stops: line.stops, next, at: kept !== -1 ? route?.at : false });
  return line;
}

/** This engine runs no line now (goes anywhere, works at every stop); a line no train runs is forgotten. */
export function stopLine(economy: Economy, engineCarId: number): void {
  const id = economy.lineIdOf.get(engineCarId);
  economy.lineIdOf.delete(engineCarId);
  economy.setRoute(engineCarId, null);
  if (id !== undefined && ![...economy.lineIdOf.values()].includes(id)) economy.lines.delete(id);
}

/** Move a stop from `from` to `to` in a stop list (for reordering), in place. */
export function moveStop(stops: RouteStopDef[], from: number, to: number): void {
  if (from === to || from < 0 || from >= stops.length) return;
  const [s] = stops.splice(from, 1);
  stops.splice(Math.max(0, Math.min(stops.length, to)), 0, s);
}

/** A saved line, as the save format keeps it: stops as [depot id, action, wait to fill]. */
export interface SavedLine {
  id: number;
  colour: string;
  name: string;
  stops: [number, RouteStopDef["action"], boolean][];
}

/**
 * Loading a save: put this engine on its saved line (made the first time one of its trains is loaded), heading for
 * stop `next`. Stops at depots no longer on the map are left out; a line left with none isn't run.
 */
export function joinSavedLine(economy: Economy, saved: readonly SavedLine[], engineCarId: number, id: number, next: number): void {
  let line = economy.lines.get(id);
  if (!line) {
    const spec = saved.find((l) => l.id === id);
    if (!spec) return;
    const stops = spec.stops.filter(([d]) => economy.depot(d)).map(([depotId, action, waitFill]) => ({ depotId, action, ...(waitFill ? { waitFill } : {}) }));
    if (stops.length === 0) return;
    line = { id, colour: spec.colour, name: spec.name, stops };
    economy.lines.set(id, line);
  }
  economy.lineIdOf.set(engineCarId, id);
  economy.setRoute(engineCarId, { stops: line.stops, next: Math.min(next, line.stops.length - 1) });
}
