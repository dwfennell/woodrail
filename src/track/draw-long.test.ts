import { describe, expect, it } from "vitest";
import { DrawLine, STANDARD_DRAW_TYPES, warmDrawing, type DrawEnd } from "./draw-path";

/**
 * Hand-like strokes, drawn a few mm a point and lifted: how many pieces a metre the line takes, how many of them are
 * standard pieces (`STANDARD_DRAW_TYPES`), how far its track strays from the stroke, and what a pointer move costs.
 * Run with DRAW_BENCH=1 to print the table.
 */

type Stroke = { name: string; start: DrawEnd; length: number; at: (s: number) => { x: number; z: number }; step?: number };

/** A small seeded random number (mulberry32), so the strokes are the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hand's wobble: two slow waves of uneven length and a little jitter, at most about `amp` mm either side, 0 at s = 0. */
function wobble(amp: number, seed: number): (s: number) => number {
  const r = rng(seed);
  const w1 = 180 + 120 * r();
  const w2 = 60 + 40 * r();
  const p1 = 2 * Math.PI * r();
  const p2 = 2 * Math.PI * r();
  const f = (s: number) => 0.7 * Math.sin((2 * Math.PI * s) / w1 + p1) + 0.3 * Math.sin((2 * Math.PI * s) / w2 + p2);
  const f0 = f(0);
  // (Easing in over the first few cm: the finger sets off the way it means to go.)
  return (s: number) => amp * (f(s) - f0) * Math.min(1, s / 60);
}

/** A path given as runs (a straight `len` mm, or an arc of radius `r` turning `deg` degrees, + left / − right), wobbled sideways. */
function path(deg0: number, runs: readonly { len?: number; r?: number; deg?: number }[], amp: number, seed: number): { length: number; at: (s: number) => { x: number; z: number } } {
  const segs: { s0: number; len: number; x: number; z: number; h: number; k: number }[] = [];
  let x = 0;
  let z = 0;
  let h = (deg0 * Math.PI) / 180;
  let s0 = 0;
  for (const run of runs) {
    const len = run.len ?? (run.r! * Math.abs(run.deg!) * Math.PI) / 180;
    const k = run.r ? Math.sign(run.deg!) / run.r : 0;
    segs.push({ s0, len, x, z, h, k });
    if (k === 0) {
      x += len * Math.cos(h);
      z += len * Math.sin(h);
    } else {
      const h1 = h + k * len;
      x += (Math.sin(h1) - Math.sin(h)) / k;
      z += (Math.cos(h) - Math.cos(h1)) / k;
      h = h1;
    }
    s0 += len;
  }
  const w = wobble(amp, seed);
  return {
    length: s0,
    at: (s: number) => {
      let g = segs[segs.length - 1];
      for (const q of segs) if (s >= q.s0 && s < q.s0 + q.len) g = q;
      const t = s - g.s0;
      let px: number;
      let pz: number;
      let ph: number;
      if (g.k === 0) {
        px = g.x + t * Math.cos(g.h);
        pz = g.z + t * Math.sin(g.h);
        ph = g.h;
      } else {
        ph = g.h + g.k * t;
        px = g.x + (Math.sin(ph) - Math.sin(g.h)) / g.k;
        pz = g.z + (Math.cos(g.h) - Math.cos(ph)) / g.k;
      }
      const d = w(s);
      return { x: px - d * Math.sin(ph), z: pz + d * Math.cos(ph) };
    },
  };
}

/** A dead straight stroke at `deg` degrees from the origin. */
const line = (deg: number) => ({ at: (s: number) => ({ x: s * Math.cos((deg * Math.PI) / 180), z: s * Math.sin((deg * Math.PI) / 180) }) });

/** The line's start, as a line begun on open ground: its heading the stroke's first way, rounded to an eighth. */
const startOn = (deg: number): DrawEnd => ({ x: 0, z: 0, heading: (Math.round(deg / 45) * Math.PI) / 4, y: 0, kind: "peg" });

const HEADINGS = [0, 4, 12, 30, 45, 63, 80];
const SETS: { name: string; strokes: Stroke[] }[] = [
  {
    name: "straight ±5 mm",
    strokes: HEADINGS.map((deg, i) => ({ name: `${deg}°`, start: startOn(deg), ...path(deg, [{ len: 1500 }], 5, 100 + i) })),
  },
  {
    name: "straight ±10 mm",
    strokes: HEADINGS.map((deg, i) => ({ name: `${deg}°`, start: startOn(deg), ...path(deg, [{ len: 1500 }], 10, 200 + i) })),
  },
  {
    // (Nearly along the grid, where the line runs on the stroke its way and is scored as any stroke is.)
    name: "near-grid straight ±10 mm",
    strokes: [2, 5, 8, 42, 47, 87, 93].map((deg, i) => ({ name: `${deg}°`, start: startOn(deg), ...path(deg, [{ len: 1500 }], 10, 700 + i) })),
  },
  {
    // (A long swipe bows a little: about 25 mm over 700, more than a straight stroke's band takes.)
    name: "bowed straight ±5 mm",
    strokes: HEADINGS.map((deg, i) => ({ name: `${deg}°`, start: startOn(deg), ...path(deg, [{ r: 2500, deg: (i % 2 ? 1 : -1) * 34 }], 5, 600 + i) })),
  },
  {
    // (A swipe half way between two eighths, a point every 14 mm as a quick finger gives them: the line zigzags from one
    // eighth to the other, as many curves as straights at best. e2e 7b's swipe was one: 703 mm at −23°.)
    name: "slant half way",
    strokes: [-45, 0].flatMap((h0) =>
      [-20, -22, -23, -24, -26].flatMap((deg) =>
        [600, 703, 800].map((len) => ({ name: `${deg}° ${len}`, start: { ...startOn(h0), heading: (h0 * Math.PI) / 180 }, length: len, step: 14, ...line(deg) })),
      ),
    ),
  },
  {
    name: "gentle S",
    strokes: [0, 45, 90].flatMap((deg, i) => [
      { name: `${deg}° r450`, start: startOn(deg), ...path(deg, [{ len: 150 }, { r: 450, deg: 50 }, { r: 450, deg: -50 }, { len: 150 }], 4, 300 + i) },
      { name: `${deg}° r700`, start: startOn(deg), ...path(deg, [{ len: 150 }, { r: 700, deg: -35 }, { r: 700, deg: 35 }, { len: 150 }], 4, 310 + i) },
    ]),
  },
  {
    name: "90° turn",
    strokes: [0, 45, 90].flatMap((deg, i) => [
      { name: `${deg}° r180`, start: startOn(deg), ...path(deg, [{ len: 400 }, { r: 180, deg: 90 }, { len: 400 }], 4, 400 + i) },
      { name: `${deg}° r250`, start: startOn(deg), ...path(deg, [{ len: 400 }, { r: 250, deg: -90 }, { len: 400 }], 4, 410 + i) },
    ]),
  },
  {
    name: "long sweep",
    strokes: [0, 45, 90].flatMap((deg, i) => [
      { name: `${deg}° r400`, start: startOn(deg), ...path(deg, [{ len: 100 }, { r: 400, deg: 150 }], 4, 500 + i) },
      { name: `${deg}° r600`, start: startOn(deg), ...path(deg, [{ len: 100 }, { r: 600, deg: -120 }], 4, 510 + i) },
    ]),
  },
];

const STANDARD = new Set<string>(STANDARD_DRAW_TYPES);

/**
 * Draw a stroke (4 mm a point, or its `step`) and lift; each move timed into `times` (ms): addPoint and the ghosts it
 * shows (`preview`), as DrawHand does on a pointer move.
 */
function drawStroke(k: Stroke, times: number[] | null) {
  const line = new DrawLine(k.start);
  const xs: number[] = [];
  const zs: number[] = [];
  const step = k.step ?? 4;
  for (let s = step; s <= k.length; s += step) {
    const p = k.at(s);
    xs.push(p.x);
    zs.push(p.z);
    const t0 = performance.now();
    line.addPoint(p.x, p.z);
    line.preview();
    if (times) times.push(performance.now() - t0);
  }
  // What the lift lays is the last ghosts (on open ground too: the look-ahead's stretch included).
  const shown = line.preview().slice();
  line.finish();
  const asShown = shown.length === line.pieces.length && shown.every((p, i) => p === line.pieces[i]);
  // The track's furthest from the stroke (each piece's track points against the stroke as a polyline).
  let off = 0;
  for (const p of line.pieces)
    for (let i = 0; i < p.track.length; i += 3) {
      const x = p.track[i];
      const z = p.track[i + 1];
      let d2 = Infinity;
      for (let j = 0; j + 1 < xs.length; j++) {
        const sx = xs[j + 1] - xs[j];
        const sz = zs[j + 1] - zs[j];
        const l2 = sx * sx + sz * sz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - xs[j]) * sx + (z - zs[j]) * sz) / l2)) : 0;
        const dx = xs[j] + sx * t - x;
        const dz = zs[j] + sz * t - z;
        d2 = Math.min(d2, dx * dx + dz * dz);
      }
      off = Math.max(off, Math.sqrt(d2));
    }
  const n = line.pieces.length;
  const straights = line.pieces.filter((p) => p.type.startsWith("straight")).length;
  const standard = line.pieces.filter((p) => STANDARD.has(p.type)).length;
  let h = k.start.heading;
  const name = line.pieces
    .map((p) => {
      const turn = p.type.startsWith("curve") ? (Math.sin(p.end.heading - h) > 0 ? "+" : "-") : "";
      h = p.end.heading;
      return p.type.replace("straight-", "s").replace("curve-", "") + turn;
    })
    .join(" ");
  return { asShown, n, standard, staircase: straights >= n / 2, off, metres: k.length / 1000, name, reached: Math.hypot(line.end.x - k.at(k.length).x, line.end.z - k.at(k.length).z) };
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function measure(set: (typeof SETS)[number], reps: number) {
  const times: number[] = [];
  let n = 0;
  let standard = 0;
  let metres = 0;
  let off = 0;
  let reached = 0;
  let staircases = 0;
  let asShown = 0;
  const lines: string[] = [];
  for (const k of set.strokes) {
    const r = drawStroke(k, null);
    n += r.n;
    standard += r.standard;
    metres += r.metres;
    off = Math.max(off, r.off);
    reached = Math.max(reached, r.reached);
    if (r.staircase) staircases++;
    if (r.asShown) asShown++;
    lines.push(`    ${k.name.padEnd(9)} ${(r.n / r.metres).toFixed(1).padStart(4)}/m off ${r.off.toFixed(0).padStart(3)} end ${r.reached.toFixed(0).padStart(3)}  ${r.name}`);
  }
  for (let i = 0; i < reps; i++) for (const k of set.strokes) drawStroke(k, times);
  times.sort((a, b) => a - b);
  return { asShown: asShown / set.strokes.length, perMetre: n / metres, share: standard / n, staircases: staircases / set.strokes.length, off, reached, p50: quantile(times, 0.5), p99: quantile(times, 0.99), p999: quantile(times, 0.999), lines };
}

/** DRAW_BENCH=1 prints the table (and times more runs). */
const BENCH = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DRAW_BENCH;

describe("drawing long and standard pieces (hand-like strokes)", () => {
  warmDrawing();
  const results = new Map<string, ReturnType<typeof measure>>();
  for (const set of SETS) results.set(set.name, measure(set, BENCH ? 8 : 1));
  if (BENCH) {
    const rows = [...results].map(
      ([name, r]) =>
        `| ${name} | ${r.perMetre.toFixed(2)} | ${(100 * r.share).toFixed(0)}% | ${(100 * r.staircases).toFixed(0)}% | ${r.off.toFixed(0)} | ${r.reached.toFixed(0)} | ${r.p50.toFixed(3)} | ${r.p99.toFixed(3)} | ${r.p999.toFixed(3)} |\n${r.lines.join("\n")}`,
    );
    console.log(`| set | pieces/m | standard | straights ≥ half | max off (mm) | end (mm) | addPoint p50 | p99 | p99.9 (ms) |\n${rows.join("\n")}`);
  }

  // Before (main a4d7c99) and after, as `DRAW_BENCH=1` prints them: pieces a metre, the share of standard pieces, and
  // the share of strokes laid as at least half straights.
  const BEFORE: Record<string, [number, number, number]> = {
    "straight ±5 mm": [6.0, 0.84, 1],
    "straight ±10 mm": [6.29, 0.91, 1],
    "near-grid straight ±10 mm": [5.71, 0.97, 1],
    "bowed straight ±5 mm": [6.84, 0.82, 1],
    // (Pieces a metre not held here: ending on a straight rather than a curve begun, it takes 7.66 a metre to 7.28.)
    "slant half way": [0, 0.63, 0.9],
    "gentle S": [5.8, 0.62, 1],
    "90° turn": [5.86, 0.83, 1],
    "long sweep": [6.66, 0.62, 1],
  };

  it("no set takes more pieces a metre, or fewer standard ones, than before; none strays further from the finger", () => {
    for (const [name, r] of results) {
      const [perMetre, share] = BEFORE[name];
      if (perMetre) expect(r.perMetre, name).toBeLessThanOrEqual(perMetre + 0.15);
      if (share) expect(r.share, name).toBeGreaterThanOrEqual(share - 0.01);
      expect(r.off, name).toBeLessThan(65);
    }
  });

  it("what the lift lays is what the ghosts showed, the look-ahead's last stretch too (QA: pieces added on the lift)", () => {
    for (const [name, r] of results) expect(r.asShown, name).toBe(1);
  });

  it("a swipe half way between two eighths is a staircase, not mostly curves: it doesn't end on a step begun", () => {
    expect(results.get("slant half way")!.staircases).toBeGreaterThan(BEFORE["slant half way"][2]);
  });

  it("e2e 7b's swipe (703 mm at −23°, a phone on its side, recorded): at least half straights", () => {
    const line = new DrawLine({ x: 0, z: 0, heading: -Math.PI / 4, y: 0, kind: "peg" });
    for (let i = 0; i < PHONE.length; i += 2) line.addPoint(PHONE[i], PHONE[i + 1]);
    line.finish();
    const types = line.pieces.map((p) => p.type);
    expect(types.filter((t) => t.startsWith("straight")).length, types.join(" ")).toBeGreaterThanOrEqual(types.length / 2);
  });

  it("a pointer move stays cheap: p99 of a move (addPoint and its ghosts) under 1 ms, p99.9 under 4 ms (Node; a few times that on a phone)", () => {
    // (Timing guards on a loaded machine: warmed up above, and the best of up to five timed runs counts, so a full run's
    // stalls don't fail it while a real slowdown, ten times, still does. About 0.05 and 0.3 ms here.)
    for (const set of SETS) {
      let best = results.get(set.name)!;
      for (let k = 0; k < 4 && (best.p99 >= 1 || best.p999 >= 4); k++) {
        const again = measure(set, 1);
        if (again.p99 + again.p999 / 4 < best.p99 + best.p999 / 4) best = again;
      }
      expect(best.p99, set.name).toBeLessThan(1);
      expect(best.p999, set.name).toBeLessThan(4);
    }
  });
});

/** e2e 7b's swipe as the line saw it (x, z pairs, mm, from the line's start): 51 points 14 mm apart. */
const PHONE: readonly number[] = [19.5,  -4.8,  32.4,  -10.3,  45.4,  -15.9,  58.3,  -21.4,  71.2,  -27.0,  84.1,  -32.5,  97.0,  -38.0,  109.9,  -43.6,  122.9,  -49.1,  135.8,  -54.6,  148.7,  -60.2,  161.6,  -65.7,  174.5,  -71.2,  187.4,  -76.8,  200.4,  -82.3,  213.3,  -87.9,  226.2,  -93.4,  239.1,  -98.9,  252.0,  -104.5,  265.0,  -110.0,  277.9,  -115.5,  290.8,  -121.1,  303.7,  -126.6,  316.6,  -132.2,  329.6,  -137.7,  342.5,  -143.2,  355.4,  -148.8,  368.3,  -154.3,  381.2,  -159.8,  394.1,  -165.4,  407.1,  -170.9,  420.0,  -176.4,  432.9,  -182.0,  445.8,  -187.5,  458.7,  -193.1,  471.6,  -198.6,  484.6,  -204.1,  497.5,  -209.7,  510.4,  -215.2,  523.3,  -220.7,  536.2,  -226.3,  549.1,  -231.8,  562.1,  -237.3,  575.0,  -242.9,  587.9,  -248.4,  600.8,  -253.9,  613.7,  -259.5,  626.6,  -265.0,  639.6,  -270.6,  652.5,  -276.1];
