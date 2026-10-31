import { describe, expect, it } from "vitest";
import { CAR_SPECS, Sim, SIM_HZ, type Train } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, pathLength, type PieceTypeId } from "../track";
import { editLine } from "../game/lines";
import { Economy } from "./economy";
import { chain, train, type World } from "./loop-fixtures";

/**
 * Issue #2: trains of different lines (or none) reaching a crossing, or a switch where two lines join, together must
 * never run into each other: one goes through, the other stops short and waits, then goes (no turning back).
 */

/** Which are routed: both, one (the first train: X's), other (the second: P's), or none. */
type Routing = "both" | "one" | "other" | "none";

/** A line of two stops for an engine, heading for `next` first (`routed`), or none (lever on, going where it likes). */
function route(w: World, engine: number, stops: number[], next: number, routed: boolean): void {
  if (!routed) return;
  editLine(w.economy, engine, (s) => s.push(...stops.map((depotId) => ({ depotId, action: "auto" as const }))));
  w.economy.routeOf(engine)!.next = next;
}

/** Do two cars' bodies (rectangles, a whisker in from their sides) overlap? */
function carsOverlap(a: Train, ca: number, b: Train, cb: number): boolean {
  const box = (t: Train, c: number) => {
    const f = t.world[2 * c];
    const r = t.world[2 * c + 1];
    const len = Math.hypot(f.x - r.x, f.z - r.z) || 1;
    const spec = CAR_SPECS[t.cars[c].kind];
    return { x: (f.x + r.x) / 2, z: (f.z + r.z) / 2, ux: (f.x - r.x) / len, uz: (f.z - r.z) / len, hl: spec.length / 2 - 1, hw: spec.width / 2 - 1, y: f.y };
  };
  const p = box(a, ca);
  const q = box(b, cb);
  if (Math.abs(p.y - q.y) > 20) return false;
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  for (const [ax, az] of [
    [p.ux, p.uz],
    [-p.uz, p.ux],
    [q.ux, q.uz],
    [-q.uz, q.ux],
  ]) {
    const reach = (o: typeof p) => o.hl * Math.abs(o.ux * ax + o.uz * az) + o.hw * Math.abs(-o.uz * ax + o.ux * az);
    if (Math.abs(dx * ax + dz * az) > reach(p) + reach(q)) return false;
  }
  return true;
}

function trainsOverlap(a: Train, b: Train): boolean {
  for (let i = 0; i < a.cars.length; i++) for (let j = 0; j < b.cars.length; j++) if (carsOverlap(a, i, b, j)) return true;
  return false;
}

/** Runs the world, watching two engines: overlaps, both on the piece on different paths, head-on meetings. */
function watch(w: World, engines: [number, number], piece: number) {
  const s = { overlaps: 0, together: 0, headOn: 0, passes: [0, 0], derailed: false };
  const was = [false, false];
  const noseWas = [false, false];
  const step = () => {
    w.sim.tick();
    w.economy.tick();
    const [a, b] = engines.map((e) => w.sim.findCar(e)!.train);
    if (a.derailed || b.derailed) s.derailed = true;
    if (trainsOverlap(a, b)) s.overlaps++;
    const paths = (t: Train) => new Set(t.bogies.filter((x) => x.pieceId === piece).map((x) => x.pathIndex));
    const pa = paths(a);
    const pb = paths(b);
    if ([...pa].some((p) => pb.size > 0 && !pb.has(p))) s.together++;
    [a, b].forEach((t, k) => {
      const on = t.bogies[0].pieceId === piece;
      if (on && !was[k]) s.passes[k]++;
      was[k] = on;
      // (Met head on: held nose to nose by the other, counted once a meeting.)
      const nose = w.sim.heldHow(t.id) === "nose";
      if (nose && !noseWas[k]) s.headOn++;
      noseWas[k] = nose;
    });
  };
  return { s, step, run: (seconds: number, until?: () => boolean) => { for (let i = 0; i < seconds * SIM_HZ && !until?.(); i++) step(); } };
}

/** Pieces laid back from a hole (`from`, a socket), each joined by its connector 1: the last is farthest. */
function chainBack(layout: Layout, types: readonly PieceTypeId[], from: number): number[] {
  const ids: number[] = [];
  let ref = from;
  for (const t of types) {
    const id = appendPiece(layout, t, false, ref, 1);
    ids.push(id);
    ref = connectorRef(id, 0);
  }
  return ids;
}

/**
 * Two lines crossing on a crossing piece, each arm alike (a stop, two straights): X ══ ══ ╬ ══ ══ Y one way, P ══ ══ ╬
 * ══ ══ Q the other, buffers past the stops. Trains start at the same distance from the crossing on X's and P's arms.
 */
function crossingWorld(type: "crossing" | "crossing-45", routing: Routing) {
  const layout = new Layout();
  const [x, w1, , cross, , , y] = chain(layout, ["depot-forest", "straight-216", "straight-216", type, "straight-216", "straight-216", "depot-sawmill"]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(x, 0));
  appendPiece(layout, "buffer-turnback", false, connectorRef(y, 1));
  const [, s1, p] = chainBack(layout, ["straight-216", "straight-216", "depot-forest"], connectorRef(cross, 2));
  appendPiece(layout, "buffer-turnback", false, connectorRef(p, 0), 0);
  const [, , q] = chain(layout, ["straight-216", "straight-216", "depot-sawmill"], connectorRef(cross, 3));
  appendPiece(layout, "buffer-turnback", false, connectorRef(q, 1));
  const w = { layout } as World;
  w.sim = new Sim(layout);
  w.economy = new Economy(layout, w.sim);
  const dx = w.economy.addDepot("forest", x, 0);
  const dy = w.economy.addDepot("town", y, 1);
  const dp = w.economy.addDepot("forest", p, 0);
  const dq = w.economy.addDepot("town", q, 1);
  w.dx = dx;
  const a = train(w, w1, false);
  const b = train(w, s1, false);
  route(w, a, [dx.id, dy.id], 1, routing === "both" || routing === "one");
  route(w, b, [dp.id, dq.id], 1, routing === "both" || routing === "other");
  return { w, a, b, cross };
}

/**
 * Two lines joining at a switch onto one track to a stop Y: X ══ ══ ╲ the switch's straight, P ══ ══ ⌒ its curve (and a curve back),
 * then ══ ══ ══ Y. Trains start as far from the switch on each, heading for Y.
 */
function junctionWorld(routing: Routing) {
  const layout = new Layout();
  const [y, , t2, t1, sw] = chain(layout, ["depot-sawmill", "straight-216", "straight-216", "straight-216", "switch"]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(y, 0), 0);
  const [, x2, x] = chain(layout, ["straight-216", "straight-216", "depot-forest"], connectorRef(sw, 1));
  appendPiece(layout, "buffer-turnback", false, connectorRef(x, 1));
  const [c1, p1, , p] = chain(layout, ["curve-large", "straight-216", "straight-216", "depot-forest"], connectorRef(sw, 2), [true]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(p, 1));
  const w = { layout } as World;
  w.sim = new Sim(layout);
  w.economy = new Economy(layout, w.sim);
  const dy = w.economy.addDepot("town", y, 0);
  const dx = w.economy.addDepot("forest", x, 1);
  const dp = w.economy.addDepot("forest", p, 1);
  w.dx = dx;
  const curve = (id: number) => pathLength(getPieceDef(layout.getPiece(id)!.type, layout.getPiece(id)!.flipped).paths[0].geom);
  // P's train 100 mm into its first straight past the curves, heading in; X's as far from the switch.
  const fromSwitch = curve(c1) + (216 - 100);
  const b = train(w, p1, true, undefined, 100);
  const a = train(w, x2, true, undefined, 216 - (fromSwitch - 216));
  route(w, a, [dx.id, dy.id], 1, routing === "both" || routing === "one");
  route(w, b, [dp.id, dy.id], 1, routing === "both" || routing === "other");
  return { w, a, b, sw, past: t2, t1 };
}

describe("trains of different lines at a crossing (issue #2)", () => {
  for (const type of ["crossing", "crossing-45"] as const)
    for (const routing of ["both", "one", "other", "none"] as const)
      it(`${type}, routed: ${routing}: one goes over at a time, the other waits and goes; no overlap, no meeting`, () => {
        const { w, a, b, cross } = crossingWorld(type, routing);
        const { s, run } = watch(w, [a, b], cross);
        run(120);
        expect(s.derailed).toBe(false);
        expect(s.overlaps).toBe(0);
        expect(s.together).toBe(0);
        expect(s.headOn).toBe(0);
        // Each keeps going over (out and back, again and again), not stuck waiting.
        expect(Math.min(...s.passes)).toBeGreaterThanOrEqual(4);
      });
});

describe("trains of different lines joining at a switch (issue #2)", () => {
  for (const routing of ["both", "one", "other", "none"] as const)
    it(`routed: ${routing}: one goes onto the shared track, the other waits and follows; no overlap, no meeting`, () => {
      const { w, a, b, sw, past } = junctionWorld(routing);
      const { s, run } = watch(w, [a, b], sw);
      const beyond = (e: number) => w.sim.findCar(e)!.train.bogies.some((x) => x.pieceId === past);
      const reached = new Set<number>();
      run(40, () => {
        for (const e of [a, b]) if (beyond(e)) reached.add(e);
        return reached.size === 2;
      });
      expect(s.derailed).toBe(false);
      expect(reached.size).toBe(2);
      expect(s.overlaps).toBe(0);
      expect(s.together).toBe(0);
      expect(s.headOn).toBe(0);
    });
});
