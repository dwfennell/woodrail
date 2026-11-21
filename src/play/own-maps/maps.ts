/**
 * Our own reference maps for the jams bar (dispatcher spec §8 step 0; report:
 * docs/superpowers/specs/evidence/2026-11-18-dispatcher/own-maps.md): the layouts players build, the hard cases most of
 * all, each laid by `Build` with the game's own placement rules. `npm run own-maps` (OWN_MAPS=1, own-maps.test.ts)
 * writes them into src/play/bugmaps/reference/ as `own-NN-name.txt`.
 */
import type { CarKind } from "../../sim";
import { planTracks, tracksAfter } from "../../game/depot-tracks";
import { rulesFor } from "../rules";
import { Build, passingLoop, type Step } from "./build";

const S: Step = "straight-216";
const C: Step = "curve-large";
const CR: Step = ["curve-large", true];

/** Trains by length: an engine and `n` wagons of `kind`. */
const cars = (n: number, kind: CarKind = "timber"): CarKind[] => ["engine", ...Array<CarKind>(n).fill(kind)];

export interface OwnMap {
  file: string;
  /** What it is, in a line (for the report). */
  what: string;
  build(): Build;
}

/** Signal pairs at both ends of each road of a passing loop, inside its points (as players put them). */
function loopSignals(b: Build, l: ReturnType<typeof passingLoop>): void {
  b.signals(b.end(l.main[0], 0));
  b.signals(b.end(l.main[l.main.length - 1], 1));
  b.signals(b.end(l.side[0], 0));
  b.signals(b.end(l.side[l.side.length - 1], 1));
}

/** 1. A long single line, three passing loops (the middle one shorter than the longest train), four trains of mixed lengths on three lines. */
function singleLoops(): Build {
  const b = new Build();
  const A = b.start("depot-forest", -4200, 0);
  b.lay(b.end(A, 0), "buffer");
  const r1 = b.run(b.end(A, 1), [S, S, S]);
  const l1 = passingLoop(b, r1.end, [S, S, S]);
  const r2 = b.run(l1.end, [S, S, "depot-farm", S, S]);
  const F = r2.ids[2];
  const l2 = passingLoop(b, r2.end, [S]);
  const r3 = b.run(l2.end, [S, S, S, S]);
  const l3 = passingLoop(b, r3.end, [S, S], [S]);
  const r4 = b.run(l3.end, [S, S, "depot-sawmill", S]);
  const B = r4.ids[2];
  b.lay(r4.end, "buffer");
  for (const l of [l1, l2, l3]) loopSignals(b, l);
  b.depots();
  const long = b.train(cars(6), r1.ids[1], false, 150, "Long");
  const red = b.line(long, [A, B]);
  const short = b.train(cars(1), r4.ids[1], true, 100, "Short");
  b.join(short, red);
  const hop = b.train(cars(3, "hopper"), r3.ids[2], false, 100, "Hopper");
  b.line(hop, [F, B]);
  const mid = b.train(cars(4), r2.ids[0], true, 100, "Middle");
  b.line(mid, [A, F]);
  return b;
}

/** Lay the eight-curve turn (180°) of an oval: four curves, `flipped` the other way. */
const turn = (flipped = false): Step[] => Array<Step>(4).fill(flipped ? CR : C);

/**
 * 2. A figure of eight over a diamond crossing: two lobes (east clockwise, west anticlockwise), on each a station on
 * the far side, a passing loop and a second station; two lines of two trains between the lobes.
 */
function figureEight(): Build {
  const b = new Build();
  const x = b.start("crossing", 0, 0);
  // (The east lobe: out east, round right three quarters, in from the south. Its sides fit the curves' 180 mm radius.)
  const e1 = b.run(b.end(x, 1), [S, "straight-108", C, C, S, "depot-forest", S]);
  const le = passingLoop(b, e1.end, [S, S], undefined, true);
  const e2 = b.run(le.end, [S, C, C, S, C, C, S, "depot-farm", S, S, S, S, S, "straight-180"]);
  b.close(e2.end, b.end(x, 3));
  // (The west lobe: out north, round left three quarters, in from the west.)
  const w1 = b.run(b.end(x, 2), [S, "straight-108", CR, CR, S, "depot-sawmill", S]);
  const lw = passingLoop(b, w1.end, [S, S]);
  const w2 = b.run(lw.end, [S, CR, CR, S, CR, CR, S, "depot-mill", S, S, S, S, S, "straight-180"]);
  b.close(w2.end, b.end(x, 0));
  for (const l of [le, lw]) loopSignals(b, l);
  // (Signals either side of the diamond, a straight out.)
  for (const [ids, k] of [[e1.ids, 0], [w1.ids, 0], [e2.ids, 12], [w2.ids, 12]] as const) b.signals(b.end(ids[k], 1));
  const [A, F, B, M] = [e1.ids[5], e2.ids[7], w1.ids[5], w2.ids[7]];
  b.depots();
  const r1 = b.train(cars(4), e2.ids[9], false, 100, "Red one");
  const red = b.line(r1, [A, B]);
  b.join(b.train(cars(2), w2.ids[9], false, 100, "Red two"), red);
  const g1 = b.train(cars(3, "hopper"), e2.ids[0], false, 100, "Green one");
  const green = b.line(g1, [F, M]);
  b.join(b.train(cars(5, "hopper"), w2.ids[0], false, 100, "Green two"), green);
  return b;
}

/** 3. A terminus of three platforms behind a throat of points, a single line out with two loops to a two-road station at the far end; five trains. */
function terminus(): Build {
  const b = new Build();
  // (The far end first: a buffer, a station loop with an industry on each road.)
  const far = b.start("straight-216", 2600, 0, 4);
  b.lay(b.end(far, 0), "buffer");
  const st = passingLoop(b, b.end(far, 1), [S, "depot-sawmill", S], ["depot-mill", S], true);
  const m1 = b.run(st.end, [S, S, S]);
  const l1 = passingLoop(b, m1.end, [S, S, S], undefined, true);
  const m2 = b.run(l1.end, [S, S, S]);
  const l2 = passingLoop(b, m2.end, [S, S], undefined, true);
  const m3 = b.run(l2.end, [S, S]);
  // (The throat: two points, three roads.)
  const s1 = b.lay(m3.end, "switch", false, 0).id;
  const s2 = b.lay(b.end(s1, 1), "switch", true, 0).id;
  const p1 = b.run(b.end(s2, 1), [S, "depot-forest", S]);
  b.lay(p1.end, "buffer");
  const p2 = b.run(b.end(s2, 2), [C, "depot-farm", S]);
  b.lay(p2.end, "buffer");
  const p3 = b.run(b.end(s1, 2), [CR, S, S, "depot-quarry", S]);
  b.lay(p3.end, "buffer");
  // (Signals: the throat's way in, each platform's way out, the loops and the far station's roads.)
  b.signals(b.end(s1, 0));
  b.signals(b.end(p1.ids[0], 0));
  b.signals(b.end(p2.ids[0], 1));
  b.signals(b.end(p3.ids[1], 1));
  for (const l of [l1, l2, st]) loopSignals(b, l);
  const [P1, P2, P3, SAW, MILL] = [p1.ids[1], p2.ids[1], p3.ids[3], st.main[1], st.side[1]];
  b.depots();
  const a = b.train(cars(4), m2.ids[1], false, 100, "Logs one");
  const logs = b.line(a, [P1, SAW]);
  b.join(b.train(cars(3), m1.ids[1], false, 100, "Logs two"), logs);
  const g = b.train(cars(4, "hopper"), l1.main[1], false, 100, "Grain one");
  const grain = b.line(g, [P2, MILL]);
  b.join(b.train(cars(2, "hopper"), m3.ids[0], false, 100, "Grain two"), grain);
  const q = b.train(cars(3, "hopper"), p3.ids[2], false, 100, "Stone");
  b.line(q, [P3, SAW]);
  return b;
}

/** 4. A triangle junction (wye) of single track: three arms to three ends, three lines over it, four trains. */
function wye(): Build {
  const b = new Build();
  const W = b.start("depot-forest", -3200, -1200);
  b.lay(b.end(W, 0), "buffer");
  const wa = b.run(b.end(W, 1), [S, S, S]);
  const lw = passingLoop(b, wa.end, [S, S]);
  const wb = b.run(lw.end, [S, S]);
  // (The main's two points 324 apart, each branching south; the legs meet a third points, its stem the south arm.)
  const sa = b.points(wb.end, 0, (e, f) => e.z > f.z);
  const mid = b.run(b.end(sa, 1), ["straight-180"]);
  const sb = b.points(mid.end, 1, (e, f) => e.z > f.z);
  const ea = b.run(b.facing(sb, 0), [S, S, S, S, "depot-sawmill", S]);
  b.lay(ea.end, "buffer");
  const legA = b.run(b.end(sa, 2), [C, S, S]);
  const sc = b.points(legA.end, 1, (e, f) => e.x > f.x);
  const legB = b.run(b.end(sb, 2), [CR, S, "straight-108", C]);
  b.close(legB.end, b.end(sc, 2));
  const sArm = b.run(b.facing(sc, 90), [S, S, S, "depot-farm", S]);
  b.lay(sArm.end, "buffer");
  loopSignals(b, lw);
  b.signals(wb.exits[0]);
  b.signals(ea.exits[0]);
  b.signals(sArm.exits[0]);
  b.signals(legA.exits[1]);
  b.signals(legB.exits[1]);
  const [WF, ES, SF] = [W, ea.ids[4], sArm.ids[3]];
  b.depots();
  const a = b.train(cars(4), wa.ids[1], false, 100, "West–east one");
  const we = b.line(a, [WF, ES]);
  b.join(b.train(cars(3), ea.ids[2], true, 100, "West–east two"), we);
  const c = b.train(cars(3, "hopper"), sArm.ids[1], false, 100, "West–south");
  b.line(c, [WF, SF]);
  const d = b.train(cars(2), legA.ids[2], false, 100, "East–south");
  b.line(d, [ES, SF]);
  return b;
}

/**
 * Double track (two parallel lines, a terminus road at each end of each), joined by two crossovers leaning opposite
 * ways, trains both ways on both. `every`: straights between signal pairs (3: well spaced, longer than any train; 1:
 * on every joint, closer than a train is long).
 */
function doubleTrack(every: number): Build {
  const b = new Build();
  const W1 = b.start("depot-forest", -4000, -600);
  b.lay(b.end(W1, 0), "buffer");
  // (Track A, with the crossovers' points on it, branching south (+z) toward track B.)
  const a1 = b.run(b.end(W1, 1), [S, S, S, S, S]);
  const x1 = b.points(a1.end, 0, (e, f) => e.z > f.z);
  const a2 = b.run(b.end(x1, 1), [S, S, S, S, S, S]);
  const x2 = b.points(a2.end, 1, (e, f) => e.z > f.z);
  const a3 = b.run(b.facing(x2, 0), [S, S, S, S, S, "depot-sawmill"]);
  b.lay(a3.end, "buffer");
  // (Track B, 106 mm south: each crossover's far points, then B's runs, west, between and east.)
  const y1 = b.crossover(b.end(x1, 2));
  const y2 = b.crossover(b.end(x2, 2));
  const bw = b.run(b.facing(y1, 180), [CR, C, S, S, "depot-farm"]);
  b.lay(bw.end, "buffer");
  const bm = b.run(b.facing(y1, 0), [S, S, S, S, S]);
  b.close(bm.end, b.facing(y2, 180));
  const be = b.run(b.facing(y2, 0), [C, CR, S, S, "depot-mill"]);
  b.lay(be.end, "buffer");
  // (Signal pairs on plain joints, `every` straights apart, and at each points' stem.)
  for (const r of [a1, a2, a3, bm]) for (let i = every - 1; i < r.ids.length - 1; i += every) b.signals(r.exits[i]);
  for (const r of [bw, be]) b.signals(r.exits[2]);
  const [E1, W2, E2] = [a3.ids[5], bw.ids[4], be.ids[4]];
  b.depots();
  const t1 = b.train(cars(5), a1.ids[2], false, 100, "Up one");
  const l1 = b.line(t1, [W1, E2]);
  b.join(b.train(cars(3), a3.ids[2], true, 100, "Up two"), l1);
  const t2 = b.train(cars(4, "hopper"), bm.ids[2], false, 100, "Down one");
  const l2 = b.line(t2, [W2, E1]);
  b.join(b.train(cars(2, "hopper"), be.ids[3], true, 100, "Down two"), l2);
  const t3 = b.train(cars(4), a2.ids[3], true, 100, "Along");
  b.line(t3, [W1, E1]);
  return b;
}

/** 7. A ring that two lines run round opposite ways (three stops each, in opposite orders), one passing loop; three trains. */
function ringOpposite(): Build {
  const b = new Build();
  const A = b.start("depot-forest", -2400, -800);
  const r1 = b.run(b.end(A, 1), [S, S]);
  const lp = passingLoop(b, r1.end, [S, S, S], undefined, true);
  // (Round right; the far side as long as the near: 2232 mm.)
  const r2 = b.run(lp.end, [S, "depot-sawmill", S, ...turn(), S, S, S, S, "depot-farm", S, S, S, S, S, "straight-72", ...turn()]);
  b.close(r2.end, b.end(A, 0));
  loopSignals(b, lp);
  const [B, F] = [r2.ids[1], r2.ids[11]];
  b.signals(r2.exits[2]);
  b.signals(r2.exits[13]);
  b.signals(r2.exits[16]);
  b.depots();
  const a = b.train(cars(4), r2.ids[8], false, 100, "Clockwise one");
  const cw = b.line(a, [A, B, F]);
  b.join(b.train(cars(2), r1.ids[1], false, 100, "Clockwise two"), cw);
  const c = b.train(cars(3, "hopper"), r2.ids[14], false, 100, "Anticlockwise");
  b.line(c, [F, B, A]);
  return b;
}

/** 8. A main line (two loops) with a branch off it at points: a shuttle on the branch to a stop on the main, through trains end to end, one onto the branch. */
function branch(): Build {
  const b = new Build();
  const A = b.start("depot-forest", -4200, -800);
  b.lay(b.end(A, 0), "buffer");
  const m1 = b.run(b.end(A, 1), [S, S, S]);
  const l1 = passingLoop(b, m1.end, [S, S, S]);
  const m2 = b.run(l1.end, [S, S]);
  const j = b.lay(m2.end, "switch", false, 0).id;
  const m3 = b.run(b.end(j, 1), [S, "depot-farm", S, S]);
  const l2 = passingLoop(b, m3.end, [S, S, S]);
  const m4 = b.run(l2.end, [S, S, S, "depot-sawmill", S]);
  b.lay(m4.end, "buffer");
  const br = b.run(b.end(j, 2), [C, S, S, S, S, S, "depot-quarry", S]);
  b.lay(br.end, "buffer");
  for (const l of [l1, l2]) loopSignals(b, l);
  b.signals(b.end(j, 0));
  b.signals(b.end(m3.ids[0], 0));
  b.signals(b.end(br.ids[0], 1));
  const [MF, X, MB, T] = [A, m3.ids[1], m4.ids[3], br.ids[6]];
  b.depots();
  const sh = b.train(cars(2, "hopper"), br.ids[3], false, 100, "Shuttle");
  b.line(sh, [T, X]);
  const t1 = b.train(cars(5), m1.ids[1], false, 100, "Through one");
  const through = b.line(t1, [MF, MB]);
  b.join(b.train(cars(3), m4.ids[1], true, 100, "Through two"), through);
  const t3 = b.train(cars(4, "hopper"), m2.ids[0], false, 100, "Onto the branch");
  b.line(t3, [MF, T]);
  return b;
}

/**
 * 9. The user's pattern: a single-track trunk up ramps and over bridges two levels up (across a line below), loops a
 * straight long (shorter than the trains), signals on every joint (closer than a train is long), two yards at each
 * end, three lines sharing the trunk, and a fourth line under the bridges.
 */
function hill(): Build {
  const b = new Build();
  const t0 = b.start("straight-216", -2600, 0);
  // (The west yards: points off the trunk's end, a road each, the second staggered on past the first.)
  const ja = b.lay(b.end(t0, 0), "switch", false, 0).id;
  const a1 = b.run(b.end(ja, 1), [S, "depot-forest"]);
  b.lay(a1.end, "buffer");
  const a2 = b.run(b.end(ja, 2), [CR, S, S, "depot-farm"]);
  b.lay(a2.end, "buffer");
  const t1 = b.run(b.end(t0, 1), [S]);
  const l1 = passingLoop(b, t1.end, [S]);
  const t2 = b.run(l1.end, [S, "ramp", "ramp", "bridge", "bridge", "bridge", ["ramp", true], ["ramp", true], S]);
  const l2 = passingLoop(b, t2.end, [S]);
  const t3 = b.run(l2.end, [S, "ramp", "ramp", "bridge", "bridge", ["ramp", true], ["ramp", true], S]);
  const jb = b.lay(t3.end, "switch", true, 0).id;
  const b1 = b.run(b.end(jb, 1), [S, "depot-sawmill"]);
  b.lay(b1.end, "buffer");
  const b2 = b.run(b.end(jb, 2), [C, S, S, "depot-mill"]);
  b.lay(b2.end, "buffer");
  // (The line below: north to south under the first bridges' middle one.)
  const mid = b.w.layout.getPiece(t2.ids[4])!;
  const cx = mid.pose.x + 108 * Math.cos(mid.pose.heading);
  const C1 = b.start("depot-quarry", cx, mid.pose.z - 1500, 2);
  b.lay(b.end(C1, 0), "buffer");
  const under = b.run(b.end(C1, 1), [S, S, S, S, S, S, S, S, S, S, S, S, "depot-sawmill"]);
  b.lay(under.end, "buffer");
  // (Signals on every joint of the trunk that has room for a post, the user's way.)
  for (const r of [t1, t2, t3]) for (const at of r.exits) b.trySignals(at);
  for (const l of [l1, l2]) for (const at of Object.values(l.joints)) b.trySignals(at);
  b.trySignals(b.end(t0, 1));
  const [FA, FB, SB, MB, Q, U] = [a1.ids[1], a2.ids[3], b1.ids[1], b2.ids[3], C1, under.ids[12]];
  b.depots();
  const r1 = b.train(cars(5), t1.ids[0], false, 150, "Red one");
  const red = b.line(r1, [FA, SB]);
  b.join(b.train(cars(4), t3.ids[7], false, 100, "Red two"), red);
  const g = b.train(cars(4, "hopper"), a2.ids[2], false, 100, "Green");
  b.line(g, [FB, MB]);
  const y = b.train(cars(3), t2.ids[8], false, 100, "Yellow");
  b.line(y, [FA, MB]);
  const u = b.train(cars(3, "hopper"), under.ids[2], false, 100, "Under");
  b.line(u, [Q, U]);
  return b;
}

/**
 * A second track for depot `depotPiece`, as its card adds one (`planTracks`, then `tracksAfter` and
 * `Economy.setTracks`), joined to the line by a Split from the tray at each end, dropped in place of the straight two
 * out from each end of the yard (as depot-tracks.test.ts's player does). The line runs straight through the yard, two
 * straights each side at least.
 */
function secondTrack(b: Build, depotPiece: number): void {
  const w = b.w;
  const d = w.economy.depotAtPiece(depotPiece)!;
  // (The drop rule, `rulesFor`; its checks take a set to ignore as well as one piece.)
  const plan = planTracks(w, d, (t, f, pose, y, ignore) => rulesFor(w)(t, f, pose, y, ignore as number));
  if (typeof plan === "string") throw new Error(plan);
  for (const id of plan.covers) b.editor.remove(id);
  const ids = plan.pieces.map((p) => b.editor.place(p.type, p.pose, p.y, p.flipped));
  const after = tracksAfter(plan, ids);
  w.economy.setTracks(d, after.roads, after.ends, after.ladder);
  // (In the yard's own frame: the straights at −432 and +432 along it, each taken up for a Split, its link to the track.)
  const dp = w.layout.getPiece(depotPiece)!;
  const h = dp.pose.heading;
  const at = (t: number) => ({ x: dp.pose.x + t * Math.cos(h), z: dp.pose.z + t * Math.sin(h) });
  for (const [t, end] of [[-432, false], [432, true]] as const) {
    const c = at(t + 108);
    const old = [...w.layout.pieceIds()].find((id) => {
      const p = w.layout.getPiece(id)!;
      if (p.type !== "straight-216") return false;
      const m = { x: p.pose.x + 108 * Math.cos(p.pose.heading), z: p.pose.z + 108 * Math.sin(p.pose.heading) };
      return Math.hypot(m.x - c.x, m.z - c.z) < 20;
    });
    if (old === undefined) throw new Error(`no straight ${t} along the yard for a split`);
    const y = w.layout.getPiece(old)!.y;
    b.editor.remove(old);
    const pose = end ? { ...at(t + 216), heading: h + Math.PI } : { ...at(t), heading: h };
    const why = rulesFor(w)("split", !end, pose, y, -1);
    if (why) throw new Error(`split: ${why}`);
    b.editor.place("split", pose, y, !end);
  }
  if (w.economy.unjoinedTracks(d).length > 0) throw new Error("the second track isn't joined");
}

/** 10. Depot-heavy: forest → sawmill → workshop, the forest's and the sawmill's yards of two tracks under one crane, four freight trains. */
function depots(): Build {
  const b = new Build();
  const F = b.start("depot-forest", -3600, 0);
  const f0 = b.run(b.end(F, 0), [S, S, S]);
  b.lay(f0.end, "buffer");
  const f1 = b.run(b.end(F, 1), [S, S, S, S]);
  const l1 = passingLoop(b, f1.end, [S, S, S, S]);
  const m0 = b.run(l1.end, [S, S, S, "depot-sawmill", S, S, S, S]);
  const M = m0.ids[3];
  const l2 = passingLoop(b, m0.end, [S, S, S, S]);
  const w0 = b.run(l2.end, [S, S, "depot-workshop", S]);
  b.lay(w0.end, "buffer");
  b.depots();
  secondTrack(b, F);
  secondTrack(b, M);
  for (const l of [l1, l2]) loopSignals(b, l);
  const WK = w0.ids[2];
  b.depots();
  const a = b.train(cars(4), f1.ids[3], false, 100, "Logs one");
  const logs = b.line(a, [F, M]);
  b.join(b.train(cars(5), l1.main[2], false, 100, "Logs two"), logs);
  const p = b.train(cars(3), m0.ids[7], false, 100, "Planks one");
  const planks = b.line(p, [M, WK]);
  b.join(b.train(cars(4), w0.ids[0], true, 100, "Planks two"), planks);
  return b;
}

/**
 * 11. One way: a ring with one-way signals all round (clockwise), a passing loop on it whose two roads both run that
 * way (to overtake), and a two-way branch off it to a terminus; two lines, four trains.
 */
function oneWay(): Build {
  const b = new Build();
  const A = b.start("depot-forest", -2600, -900);
  const r1 = b.run(b.end(A, 1), [S, S]);
  // (Loop and branch outside the ring: it turns right, so on the left.)
  const lp = passingLoop(b, r1.end, [S, S, S], undefined, true);
  const r2 = b.run(lp.end, [S, S, ...turn(), S, S, "depot-sawmill", S, S]);
  const j = b.lay(r2.end, "switch", true, 0).id;
  const r3 = b.run(b.end(j, 1), [S, S, S, "straight-144", ...turn()]);
  b.close(r3.end, b.end(A, 0));
  const br = b.run(b.end(j, 2), [C, S, S, S, "depot-farm", S]);
  b.lay(br.end, "buffer");
  // (One-way signals facing round the ring's way, on the joints leaving these.)
  for (const at of [b.end(A, 1), ...r1.exits, lp.joints.mainIn, lp.joints.sideIn, lp.joints.mainOut, lp.joints.sideOut, r2.exits[1], r2.exits[6], r2.exits[8], r3.exits[0], r3.exits[2]]) b.oneWay(at);
  // (The branch two-way: a pair at its foot.)
  b.signals(br.exits[1]);
  const [B, F] = [r2.ids[8], br.ids[4]];
  b.depots();
  const a = b.train(cars(5), r3.ids[1], false, 100, "Round one");
  const round = b.line(a, [A, B]);
  b.join(b.train(cars(2), r2.ids[0], false, 100, "Round two"), round);
  b.join(b.train(cars(3), lp.main[1], false, 100, "Round three"), round);
  const c = b.train(cars(3, "hopper"), br.ids[2], false, 100, "Branch");
  b.line(c, [F, A]);
  return b;
}

/**
 * 12. A big mixed map: a ring (two passing loops, a forest and a sawmill on it); a branch north off it up ramps and
 * over bridges two levels up, signals on every joint, a short loop, to a terminus of two platforms; a second branch
 * north then west, passing under the first's bridges, a short loop, to a mill with a second track; nine trains on five
 * lines.
 */
function big(): Build {
  const b = new Build(11, 24);
  const t0 = b.start("straight-216", -1400, 1000);
  // (The ring, round right: the top 2520 long east, the side 1080 south, the bottom 2520 west, the side north.)
  const j1 = b.points(b.end(t0, 1), 0, (e, f) => e.z < f.z);
  const top = b.run(b.end(j1, 1), [S, S]);
  const l1 = passingLoop(b, top.end, [S, S, S], undefined, true);
  const top2 = b.run(l1.end, [S]);
  const j2 = b.points(top2.end, 0, (e, f) => e.z < f.z);
  const top3 = b.run(b.end(j2, 1), [S, S, C, C, S, S, S, S, S, C, C, S, "depot-sawmill", S]);
  const l2 = passingLoop(b, top3.end, [S, S, S], undefined, true);
  const bot = b.run(l2.end, [S, S, S, S, "straight-288", C, C, S, "depot-forest", S, S, S, C, C]);
  b.close(bot.end, b.end(t0, 0));
  // (Branch one: north, up two levels, over two bridges, down, a short loop, two platforms.)
  const b1 = b.run(b.end(j1, 2), [CR, S, "ramp", "ramp", "bridge", "bridge", ["ramp", true], ["ramp", true], S]);
  const lb = passingLoop(b, b1.end, [S]);
  const b2 = b.run(lb.end, [S]);
  const tp = b.lay(b2.end, "switch", false, 0).id;
  const p1 = b.run(b.end(tp, 1), [S, "depot-farm"]);
  b.lay(p1.end, "buffer");
  const p2 = b.run(b.end(tp, 2), [CR, S, S, S, "depot-quarry"]);
  b.lay(p2.end, "buffer");
  // (Branch two: north, then west under branch one's bridges, a short loop, a mill with a second track.)
  const c1 = b.run(b.end(j2, 2), [CR, S, "straight-144", CR, CR, S, S, S, S, S, S, S, S, S, S]);
  const lc = passingLoop(b, c1.end, [S]);
  const c2 = b.run(lc.end, [S, S, S, "depot-mill", S, S, S]);
  b.lay(c2.end, "buffer");
  b.depots();
  secondTrack(b, c2.ids[3]);
  for (const l of [l1, l2]) loopSignals(b, l);
  for (const l of [lb, lc]) for (const at of Object.values(l.joints)) b.trySignals(at);
  for (const at of [...b1.exits, ...b2.exits]) b.trySignals(at);
  b.signals(b.end(t0, 1));
  b.signals(top2.exits[0]);
  b.signals(c1.exits[2]);
  const [SAW, FA, FARM, QU, MILL] = [top3.ids[12], bot.ids[8], p1.ids[1], p2.ids[4], c2.ids[3]];
  b.depots();
  const t = (n: number, k: CarKind, at: number, name: string, rev = false) => b.train(cars(n, k), at, rev, 100, name);
  const red = b.line(t(5, "timber", top.ids[0], "Red one"), [FA, SAW]);
  b.join(t(3, "timber", bot.ids[2], "Red two"), red);
  const blue = b.line(t(4, "hopper", b2.ids[0], "Blue one"), [FARM, MILL]);
  b.join(t(3, "hopper", c1.ids[7], "Blue two"), blue);
  const green = b.line(t(4, "hopper", p2.ids[2], "Green one"), [QU, SAW]);
  b.join(t(2, "hopper", top3.ids[7], "Green two"), green);
  const yel = b.line(t(4, "timber", c2.ids[6], "Yellow one", true), [MILL, FA]);
  b.join(t(3, "timber", c1.ids[2], "Yellow two"), yel);
  b.line(t(3, "timber", top3.ids[1], "Purple"), [FARM, FA, SAW]);
  return b;
}

export const OWN_MAPS: OwnMap[] = [
  { file: "own-01-single-loops.txt", what: "a long single line, three passing loops (the middle one a straight long, shorter than the 7-car train), 4 trains of 2–7 cars on 3 lines", build: singleLoops },
  { file: "own-02-figure-eight.txt", what: "a figure of eight over a diamond, a station and a loop on each lobe, 2 lines of 2 trains", build: figureEight },
  { file: "own-03-terminus.txt", what: "a terminus of 3 platforms behind a throat of 2 points, single line out with 2 loops to a 2-road station, 5 trains on 3 lines", build: terminus },
  { file: "own-04-wye.txt", what: "a triangle junction of single track, 3 arms, 3 lines, 4 trains", build: wye },
  { file: "own-05-double-track.txt", what: "double track, two crossovers, trains both ways on both tracks, signals every 3 straights (longer than any train); 5 trains", build: () => doubleTrack(3) },
  { file: "own-06-double-close.txt", what: "own-05's double track with signals on every joint (a straight apart, shorter than the trains)", build: () => doubleTrack(1) },
  { file: "own-07-ring-opposite.txt", what: "a ring two lines run opposite ways round (3 stops each, opposite orders), one passing loop, 3 trains", build: ringOpposite },
  { file: "own-08-branch.txt", what: "a main line (2 loops) with a branch: a shuttle from the branch's end to a stop on the main, 2 through trains, 1 onto the branch", build: branch },
  { file: "own-09-hill.txt", what: "the user's pattern: single trunk up ramps over bridges (a line below), loops a straight long, signals on every joint, 3 lines over the trunk + 1 below; 5 trains", build: hill },
  { file: "own-10-depots.txt", what: "forest → sawmill → workshop, forest and sawmill with a second track under one crane, 2 loops, 4 freight trains", build: depots },
  { file: "own-11-one-way.txt", what: "a ring made one way by one-way signals, a loop whose both roads run that way, a two-way branch; 4 trains", build: oneWay },
  { file: "own-12-big.txt", what: "big mixed: a ring with 2 loops, a branch over a bridge to a 2-platform terminus, a single-track branch with a short loop to a 2-track mill; 9 trains on 5 lines", build: big },
];
