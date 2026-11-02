import type { Economy } from "../economy";

/** One row of a big station's departure board: a line's colour and "Red line → Mill". */
export interface BoardRow {
  readonly colour: string;
  readonly text: string;
}

/** Most rows a departure board shows. */
export const BOARD_ROWS = 3;

/**
 * What a big station's departure board shows: the trains due there (routed trains whose next stop is depot `depotId`,
 * or standing at it), each as its line and the stop it heads for after this one ("Red line → Mill"), by line, at most
 * `BOARD_ROWS` and no row twice (a line's trains in a row going the same way are one row). `nameOf` names a stop.
 * Worked out only when a train's next stop changes (`Economy.nextVersion`), never per frame.
 */
export function departures(economy: Pick<Economy, "lineIdOf" | "lines" | "routeOf">, depotId: number, nameOf: (depotId: number) => string): BoardRow[] {
  const due: { lineId: number; engine: number; row: BoardRow }[] = [];
  for (const [engine, lineId] of economy.lineIdOf) {
    const line = economy.lines.get(lineId);
    const route = economy.routeOf(engine);
    if (!line || !route || route.stops.length === 0) continue;
    const n = route.stops.length;
    const i = route.next % n;
    if (route.stops[i].depotId !== depotId) continue;
    // Where it goes after: the first stop on that isn't here (stops in a row at one depot are one visit).
    let to = -1;
    for (let k = 1; k < n && to < 0; k++) if (route.stops[(i + k) % n].depotId !== depotId) to = route.stops[(i + k) % n].depotId;
    if (to < 0) continue;
    due.push({ lineId, engine, row: { colour: line.colour, text: `${line.name} → ${nameOf(to)}` } });
  }
  due.sort((a, b) => a.lineId - b.lineId || a.engine - b.engine);
  const rows: BoardRow[] = [];
  for (const d of due) {
    if (rows.length >= BOARD_ROWS) break;
    if (!rows.some((r) => r.text === d.row.text)) rows.push(d.row);
  }
  return rows;
}

/** A board's rows as one string: it's painted again only when this changes. */
export function boardKey(rows: readonly BoardRow[]): string {
  return rows.map((r) => `${r.colour}${r.text}`).join("|");
}
