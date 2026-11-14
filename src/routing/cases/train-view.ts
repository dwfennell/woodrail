/**
 * What the routing cases (and the stalls dumps, docs/agents/stalls-verify-2026-11-10.md) read of a harness run: each
 * train (where it stands, which way it drives, its route, who it waits on and why), the track piece by piece with world
 * points for a sketch, and the trains as the oracle sees them. Test-only; nothing in the game imports it.
 */
import { Layout } from "../../track";
import { getPieceDef } from "../../track/pieces";
import { createSample, pathLength, samplePath } from "../../track/path";
import { createWorldSample, cursorWorld } from "../../sim/cursor";
import { driveOf, trainLength } from "../../sim/train-cars";
import type { HarnessRun } from "../harness";
import type { OTrain } from "./oracle";

export function snapshot(h: HarnessRun) {
  const ws = createWorldSample();
  return h.engines.map((engine, k) => {
    const found = h.sim.findCar(engine);
    if (!found) return { k, engine, gone: true };
    const t = found.train;
    const d = driveOf(t);
    const pieces: number[] = [];
    for (const b of t.bogies) if (pieces[pieces.length - 1] !== b.pieceId) pieces.push(b.pieceId);
    const pts = t.bogies.map((b) => {
      cursorWorld(h.layout, b, ws);
      return [Math.round(ws.x), Math.round(ws.z)];
    });
    const r = h.routes.get(engine);
    const sw = h.sections.waitOf(engine);
    const rw = h.router.waitingOn(engine);
    const st = h.stalls.stuckOf(engine);
    return {
      k,
      engine,
      train: t.id,
      line: h.routes.has(engine) ? h.lineOf.get(engine) : null,
      stops: r?.stops ?? null,
      next: r ? r.next % r.stops.length : null,
      at: r?.at ?? false,
      goal: r ? h.target(engine) : null,
      drive: d,
      speed: Math.round(t.speed),
      // (Front first: the end it drives toward.)
      pieces: d < 0 ? [...pieces].reverse() : pieces,
      pts: d < 0 ? [...pts].reverse() : pts,
      sectionsWait: sw,
      routerWait: rw,
      heldHow: h.sim.heldHow(t.id),
      heldBy: h.sim.heldBy(t.id),
      heldForRoom: h.sections.heldForRoom(engine),
      stuck: st,
      turnback: t.turnback,
    };
  });
}

import { elemsByLength } from "../oracle";
export { piecesFor, elemsOf, elemsByLength } from "../oracle";

export function oTrains(h: HarnessRun): OTrain[] {
  return h.engines.map((engine) => {
    const t = h.sim.findCar(engine)!.train;
    return { elems: elemsByLength(h.layout, t), stops: h.routes.get(engine)?.stops ?? null, length: trainLength(t) };
  });
}

export function track(layout: Layout) {
  const s = createSample();
  const out: { id: number; type: string; state: number; paths: number[][][] }[] = [];
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    const def = getPieceDef(p.type, p.flipped);
    const ch = Math.cos(p.pose.heading);
    const sh = Math.sin(p.pose.heading);
    const paths = def.paths.map((path) => {
      const len = pathLength(path.geom);
      const pts: number[][] = [];
      for (let i = 0; i <= 8; i++) {
        samplePath(path.geom, (len * i) / 8, s);
        pts.push([Math.round(p.pose.x + s.x * ch - s.z * sh), Math.round(p.pose.z + s.x * sh + s.z * ch)]);
      }
      return pts;
    });
    out.push({ id, type: p.type, state: layout.switchState(id), paths });
  }
  return out;
}
