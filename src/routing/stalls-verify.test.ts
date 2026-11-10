import { describe, it } from "vitest";
import { Layout } from "../track";
import { getPieceDef } from "../track/pieces";
import { createSample, pathLength, samplePath } from "../track/path";
import { createWorldSample, cursorWorld } from "../sim/cursor";
import { driveOf } from "../sim/train-cars";
import { HarnessRun } from "./harness";
import { fuzz } from "./scenarios";
import { next } from "./graph";
import { oracle, type Elem, type OTrain } from "./stalls-oracle";
import type { Train } from "../sim";

/**
 * Scratch (docs/agents/stalls-verify-2026-11-10.md): the long fuzz's stalled seeds, each run to its first stall and
 * dumped: the track (piece by piece, with world points for a sketch), each train (where it stands, which way it drives,
 * its route and next stop, who it waits on and why), at the stall and at the end. Skipped unless STALLS_VERIFY is set
 * to a list of seeds ("7,37,94"); writes JSON to STALLS_OUT (default .stalls-verify/). Test-only, changes nothing.
 *
 *   STALLS_VERIFY=7,37 npx vitest run --silent=false src/routing/stalls-verify.test.ts
 */
// (Node's fs, loaded only when run, as bugmaps.test.ts does: the game's tsconfig has no Node types.)
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs")) as { mkdirSync(path: string, o: { recursive: boolean }): void; writeFileSync(path: string, text: string): void };
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = (ENV.STALLS_VERIFY ?? "").split(",").filter(Boolean).map(Number);
const OUT = ENV.STALLS_OUT ?? ".stalls-verify";
const SECONDS = Number(ENV.STALLS_SECONDS ?? 1800);

function snapshot(h: HarnessRun) {
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

/** A train as the oracle sees it: its front two pieces, tail first, which way it drives (stalls-oracle.ts). */
function elemsOf(layout: Layout, t: Train): Elem[] {
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
  for (let i = 0; i < 3; i++) {
    const f = elems[0];
    const back = next(layout, f.p, f.en);
    if (!back) break;
    const q = pathOf(back.pieceId, back.entry);
    elems.unshift({ p: back.pieceId, en: q.from === back.entry ? (q.to ?? -1) : q.from, ex: back.entry });
  }
  // (Off a buffer: the train's front is the piece before it.)
  while (layout.getPiece(elems[elems.length - 1].p)!.type.startsWith("buffer")) elems.pop();
  return elems.slice(-2);
}

function oTrains(h: HarnessRun): OTrain[] {
  return h.engines.map((engine) => ({ elems: elemsOf(h.layout, h.sim.findCar(engine)!.train), stops: h.routes.get(engine)?.stops ?? null }));
}

function track(layout: Layout) {
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

if (ENV.STALLS_DBG) (globalThis as { DBG?: boolean }).DBG = true;
describe.skipIf(SEEDS.length === 0)("stalls verify: dump stalled fuzz seeds", () => {
  for (const seed of SEEDS)
    it(`seed ${seed}`, async () => {
      const { mkdirSync, writeFileSync } = await fs();
      mkdirSync(OUT, { recursive: true });
      const layout = new Layout();
      const h = new HarnessRun(layout, { ...fuzz(seed, SECONDS), heldFree: true });
      const startTrains = snapshot(h);
      const startTrack = track(layout);
      const startO = oTrains(h);
      let stallO: OTrain[] | null = null;
      let stallAt = -1;
      let atStall: ReturnType<typeof snapshot> | null = null;
      let report = h.run(0);
      for (let s = 0; s < SECONDS; s++) {
        report = h.run(1);
        if (ENV.STALLS_TRACE && s < Number(ENV.STALLS_TRACE)) console.log(`t=${s + 1}: ${snapshot(h).map((x) => ("gone" in x ? "gone" : `t${x.k}@${x.pieces.join(">")} v${x.speed} goal ${x.goal} ${x.sectionsWait ? JSON.stringify(x.sectionsWait).slice(0, 40) : ""}`)).join(" | ")}`);
        if (stallAt < 0 && h.engines.some((e) => h.stalls.stuckOf(e))) {
          stallAt = s + 1;
          atStall = snapshot(h);
          stallO = oTrains(h);
        }
      }
      const end = snapshot(h);
      const atStallO = stallO ?? oTrains(h);
      const o = {
        startAny: oracle(layout, startO, "any"),
        startOwn: oracle(layout, startO, "own"),
        stallAny: oracle(layout, atStallO, "any"),
        stallOwn: oracle(layout, atStallO, "own"),
      };
      const brief = (r: ReturnType<typeof oracle>) => `${r.best}/${startO.length} [${r.bestSet.join(",")}] (${r.states} states${r.capped ? ", CAPPED" : ""})`;
      console.log(`ORACLE seed ${seed}: from start any ${brief(o.startAny)} own ${brief(o.startOwn)}; from stall any ${brief(o.stallAny)} own ${brief(o.stallOwn)}; game stops ${report.arrivals.join("/")}`);
      const doc = { seed, oracle: o, startO, stallO: atStallO, stallAt, start: startTrains, atStall, end, track: startTrack, endTrack: track(layout), arrivals: report.arrivals, begun: report.stalls.begun };
      writeFileSync(`${OUT}/seed-${seed}.json`, JSON.stringify(doc));
      const line = (x: ReturnType<typeof snapshot>[number]) =>
        "gone" in x ? `  train ${x.k}: gone` : `  train ${x.k} (engine ${x.engine}${x.line != null ? `, line ${x.line}` : ", hand-run"}): stops ${JSON.stringify(x.stops)} next ${x.next} goal ${x.goal} | drive ${x.drive} v ${x.speed} pieces ${x.pieces.join(">")} | sec ${JSON.stringify(x.sectionsWait)} router ${JSON.stringify(x.routerWait)} held ${x.heldHow}/${x.heldBy} room ${x.heldForRoom} stuck ${JSON.stringify(x.stuck)}`;
      console.log(`seed ${seed}: stall at ${stallAt} s; stops ${report.arrivals.join("/")}\n start:\n${startTrains.map(line).join("\n")}\n at stall:\n${(atStall ?? []).map(line).join("\n")}`);
    }, 600_000);
});
