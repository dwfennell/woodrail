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
import { next } from "../graph";
import type { Elem, OTrain } from "./oracle";
import type { Train } from "../../sim";

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

/** How many whole pieces the oracle gives a train: what it fills on 216 mm pieces, 2 at least. */
export function piecesFor(t: Train): number {
  return Math.max(2, Math.ceil(trainLength(t) / 216));
}

/** A train as the oracle sees it: the pieces it fills from its front (`piecesFor`), tail first, which way it drives (oracle.ts). */
export function elemsOf(layout: Layout, t: Train, n = piecesFor(t)): Elem[] {
  const d = driveOf(t) < 0 ? -1 : 1;
  const lead = d > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1];
  const rev = d > 0 ? lead.reversed : !lead.reversed;
  const pathOf = (p: number, c: number) => {
    const piece = layout.getPiece(p)!;
    const paths = getPieceDef(piece.type, piece.flipped).paths;
    const used = t.bogies.find((b) => b.pieceId === p)?.pathIndex;
    const ok = paths.map((q, i) => ({ q, i })).filter(({ q }) => q.from === c || q.to === c);
    return (ok.find(({ i }) => i === used) ?? ok[0]).q;
  };
  const piece = layout.getPiece(lead.pieceId)!;
  const path = getPieceDef(piece.type, piece.flipped).paths[lead.pathIndex];
  const elems: Elem[] = [rev ? { p: lead.pieceId, en: path.to ?? -1, ex: path.from } : { p: lead.pieceId, en: path.from, ex: path.to ?? -1 }];
  for (let i = 0; i < n + 1; i++) {
    const f = elems[0];
    const back = next(layout, f.p, f.en);
    if (!back) break;
    const q = pathOf(back.pieceId, back.entry);
    elems.unshift({ p: back.pieceId, en: q.from === back.entry ? (q.to ?? -1) : q.from, ex: back.entry });
  }
  // (Off a buffer: the train's front is the piece before it.)
  while (layout.getPiece(elems[elems.length - 1].p)!.type.startsWith("buffer")) elems.pop();
  return elems.slice(-n);
}

/**
 * A train as the oracle sees it by its real length: the pieces from its front back as far as their paths are as long as
 * it is (a curve is shorter than a straight; the old count, `piecesFor`, took every piece as 216 mm).
 */
export function elemsByLength(layout: Layout, t: Train): Elem[] {
  const L = trainLength(t);
  const all = elemsOf(layout, t, 16);
  const lenOf = (e: Elem) => {
    const piece = layout.getPiece(e.p)!;
    const def = getPieceDef(piece.type, piece.flipped);
    const q = def.paths.find((x) => (x.from === e.en && x.to === e.ex) || (x.from === e.ex && x.to === e.en)) ?? def.paths[0];
    return pathLength(q.geom);
  };
  let sum = 0;
  let i = all.length;
  while (i > 0 && sum < L) sum += lenOf(all[--i]);
  return all.slice(i);
}

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
