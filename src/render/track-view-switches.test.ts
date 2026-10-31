import { Color, Matrix4, Mesh, MeshBasicMaterial, MultiplyBlending, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

// These tests are about the switches' chevrons and levers, not the pieces' carved wood: each kind of piece is drawn as
// its plain body (no CSG), so the suite doesn't spend seconds carving five switches before its first test (it timed out
// under a loaded full run).
vi.mock("./track-geometry", async (importOriginal) => {
  const m = await importOriginal<typeof import("./track-geometry")>();
  return { ...m, buildPieceGeometry: (def: Parameters<typeof m.buildPieceStandIn>[0]) => m.buildPieceStandIn(def) };
});
import { Flourishes } from "./flourishes";
import { createSample, getPieceDef, Layout, pathLength, samplePath, TRACK_THICKNESS, type PathDef, type PieceDef, type PieceTypeId } from "../track";
import type { Materials } from "./materials";
import { ARROW_FAR_SCALES, arrowEnds, arrowRoads, BURN_GAP, BURN_SIZES, burnExtent, burnOutline, arrowScaleFor, switchArrows, SWITCH_ARROW_AT, SWITCH_ARROW_BURN, SWITCH_ARROW_BURN_FAR, SWITCH_ARROW_CLEAR, trunkRoutes, SWITCH_ARROW_PINNED, SWITCH_SWING_S, TrackView } from "./track-view";

const plain = () => new MeshBasicMaterial();
const mats = { track: plain(), trackCut: plain(), bridgePaint: plain(), lacquer: plain, naturalWood: plain(), magnet: plain() } as unknown as Materials;
const P = (x: number, z: number, heading = 0) => ({ x, z, heading });
const N = SWITCH_ARROW_AT.length;

/** Every state a switch can be in: a wye's 8 (a bit per corner, #15), or one per route from its trunk. */
const statesOf = (def: PieceDef) => (def.cornerLevers ? 1 << def.connectors.length : trunkRoutes(def).length);

/** The road each chevron a switch shows in a state lies on, in `switchArrows`'s order: a row of N, or 2 for both ways. */
const roadOfEach = (def: PieceDef, state: number) => arrowRoads(def, state).flatMap(({ route, ends }) => Array<PathDef>(ends.length > 1 ? 2 : N).fill(route));

/** Each chevron as drawn: where it is (world x, z) and which way it points (world heading). */
function arrowsOf(view: TrackView) {
  const mesh = view.switchArrows;
  if (!mesh) return [];
  const m = new Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    const at = new Vector3().setFromMatrixPosition(m);
    const dir = new Vector3(1, 0, 0).transformDirection(m);
    const c = new Color();
    mesh.getColorAt(i, c);
    return { x: at.x, y: at.y, z: at.z, heading: Math.atan2(dir.z, dir.x), colour: `#${c.getHexString()}` };
  });
}

function oneSwitch(type: PieceTypeId, state = 0, flipped = false) {
  const layout = new Layout();
  const id = layout.addPiece(type, P(0, 0), 0, flipped);
  if (state) layout.setSwitchState(id, state);
  const view = new TrackView(layout, mats);
  view.sync();
  return { layout, id, view };
}

/** A lever's lean as drawn (about the piece's x, from its matrix). */
function leanOf(view: TrackView, id: number): number {
  const lever = view.group.children.find((c): c is Mesh => c instanceof Mesh && c.userData.kind === "switch-lever" && c.userData.pieceId === id)!;
  const up = new Vector3(0, 1, 0).transformDirection(lever.matrix);
  return Math.atan2(up.z, up.y);
}

describe("switch chevrons", () => {
  it("each switch has one row of chevrons, on the route set only; plain track has none", () => {
    const layout = new Layout();
    layout.addPiece("straight-144", P(0, -400));
    for (const [i, t] of (["switch", "switch-y", "switch-3way", "wye", "crossover"] as const).entries()) layout.addPiece(t, P(i * 500, 0));
    const view = new TrackView(layout, mats);
    view.sync();
    // (The crossover shows both its lines' set routes; the wye each corner's (#15), set at 0 a row for corner 2's way to
    // the trunk and a both-ways mark of 2 on the curve its trunk and corner 1 are both set along.)
    expect(view.switchArrows!.count).toBe(6 * N + 2);
    // One draw for all of them: a single mesh, a handful of triangles a chevron.
    expect(view.group.children.filter((c) => c.userData.kind === "switch-arrows")).toHaveLength(1);
    // (A charred core of 4 and a singe round it of 12.)
    expect(view.switchArrows!.geometry.attributes.position.count / 3).toBe(16);
    const none = new Layout();
    none.addPiece("straight-144", P(0, 0));
    const plainView = new TrackView(none, mats);
    plainView.sync();
    expect(plainView.switchArrows).toBeNull();
  });

  it("a two-way switch: straight on along the line, or along the curve, pointing away from the trunk", () => {
    const straight = arrowsOf(oneSwitch("switch").view);
    expect(straight).toHaveLength(N);
    for (const a of straight) {
      expect(a.z).toBeCloseTo(0, 5);
      expect(a.heading).toBeCloseTo(0, 5);
      expect(a.x).toBeGreaterThan(0);
    }
    // Further from the trunk, one after another.
    expect(straight[0].x).toBeLessThan(straight[1].x);
    const curve = arrowsOf(oneSwitch("switch", 1).view);
    const def = getPieceDef("switch", false);
    const side = Math.sign(def.connectors[2].pose.z);
    for (const [i, a] of curve.entries()) {
      // Off to the branch's side, more so further on, and turning that way.
      expect(Math.sign(a.z)).toBe(side);
      if (i > 0) expect(Math.abs(a.z)).toBeGreaterThan(Math.abs(curve[i - 1].z));
      expect(Math.sign(a.heading)).toBe(side);
    }
    // Painted on the track's top.
    expect(curve[0].y).toBeGreaterThan(12);
    expect(curve[0].y).toBeLessThan(13);
  });

  it("a mirrored switch's curve goes the other way", () => {
    const a = arrowsOf(oneSwitch("switch", 1).view);
    const b = arrowsOf(oneSwitch("switch", 1, true).view);
    expect(Math.sign(b[2].z)).toBe(-Math.sign(a[2].z));
  });

  it("a Y: one curve or the other", () => {
    const left = arrowsOf(oneSwitch("switch-y", 0).view);
    const right = arrowsOf(oneSwitch("switch-y", 1).view);
    expect(Math.sign(left[2].z)).toBe(-Math.sign(right[2].z));
    expect(left[2].z).not.toBeCloseTo(0, 0);
  });

  it("a three-way: straight on, then a curve each side", () => {
    const ways = [0, 1, 2].map((s) => arrowsOf(oneSwitch("switch-3way", s).view)[2]);
    expect(ways[0].z).toBeCloseTo(0, 5);
    expect(ways[0].heading).toBeCloseTo(0, 5);
    expect(Math.sign(ways[1].z)).toBe(-Math.sign(ways[2].z));
    expect(Math.abs(ways[1].z)).toBeGreaterThan(10);
  });

  it("a wye shows each road as it's set (#15): both ways, one way or not at all, in each of its 8 states", () => {
    const def = getPieceDef("wye", false);
    // The roads: 0 the curve from the trunk to corner 1, 1 the curve to corner 2, 2 the straight across between them.
    const roadIndex = (r: PathDef) => def.paths.indexOf(r);
    for (let state = 0; state < 8; state++) {
      // What each road should show: the corners whose levers send trains onto it (bit k for corner k: from the trunk 0
      // left, 1 right; from a branch 0 to the trunk, 1 across).
      const want = new Map<number, number[]>([[0, []], [1, []], [2, []]]);
      want.get(state & 1 ? 1 : 0)!.push(0);
      want.get(state & 2 ? 2 : 0)!.push(1);
      want.get(state & 4 ? 2 : 1)!.push(2);
      const roads = arrowRoads(def, state);
      for (const [road, ends] of want) expect(roads.find((r) => roadIndex(r.route) === road)?.ends ?? [], `state ${state.toString(2)} road ${road}`).toEqual(ends);
      // Drawn: on each road set from one end, a row of N pointing away from it; from both, 2 pointing out toward each
      // end; from neither, nothing.
      const arrows = arrowsOf(oneSwitch("wye", state).view);
      const along = roadOfEach(def, state);
      expect(arrows, `state ${state.toString(2)}`).toHaveLength(along.length);
      expect(arrows.length).toBe([...want.values()].reduce((n, e) => n + (e.length === 0 ? 0 : e.length === 1 ? N : 2), 0));
      const s = createSample();
      for (const [road, ends] of want) {
        const on = arrows.filter((_, i) => roadIndex(along[i]) === road);
        if (ends.length === 0) expect(on).toHaveLength(0);
        const r = def.paths[road];
        for (const a of on) {
          // On the road (within a millimetre of its centre line) ...
          let best = { d: Infinity, h: 0, at: 0 };
          for (let d = 0; d <= pathLength(r.geom); d += 0.5) {
            samplePath(r.geom, d, s);
            const off = Math.hypot(s.x - a.x, s.z - a.z);
            if (off < best.d) best = { d: off, h: s.heading, at: d };
          }
          expect(best.d).toBeLessThan(1);
          // ... pointing toward the end it sends trains to: away from the one end set; out toward the nearer end, both.
          const forward = Math.cos(a.heading - best.h) > 0;
          const towardTo = ends.length === 1 ? ends[0] === r.from : best.at > pathLength(r.geom) / 2;
          expect(forward, `state ${state.toString(2)} road ${road} at ${a.x.toFixed(0)}, ${a.z.toFixed(0)}`).toBe(towardTo);
        }
        // Both ways: one near each end.
        if (ends.length === 2) {
          const ats = on.map((a) => Math.hypot(a.x - def.connectors[r.from].pose.x, a.z - def.connectors[r.from].pose.z)).sort((x, y) => x - y);
          expect(ats[1] - ats[0]).toBeGreaterThan(60);
        }
      }
    }
  });

  it("the chevrons start past where the routes part: none lies over another route's groove near the trunk", () => {
    const q = createSample();
    for (const type of ["switch", "switch-y", "switch-3way", "wye", "crossover"] as const) {
      for (const flipped of [false, true]) {
        const def = getPieceDef(type, flipped);
        for (let state = 0; state < statesOf(def); state++) {
          // (Each road's chevrons in turn, along it: a row from one end, or a both-ways mark of 2.)
          const along = roadOfEach(def, state);
          const all = arrowsOf(oneSwitch(type, state, flipped).view);
          expect(all, `${type} ${state}`).toHaveLength(along.length);
          for (const [i, a] of all.entries()) {
            const route = along[i];
            const end = route.from;
            // Every other track through the piece (its other routes, a wye's straight across, a crossover's other line).
            let nearest = Infinity;
            for (const p of def.paths) {
              if (p === route) continue;
              for (let d = 0; d <= pathLength(p.geom); d += 1) {
                samplePath(p.geom, d, q);
                nearest = Math.min(nearest, Math.hypot(q.x - a.x, q.z - a.z));
              }
            }
            expect(nearest, `${type}${flipped ? " flipped" : ""} state ${state} end ${end}: chevron at ${a.x.toFixed(0)}, ${a.z.toFixed(0)}`).toBeGreaterThanOrEqual(SWITCH_ARROW_CLEAR - 0.5);
          }
        }
      }
    }
  });

  it("a crossover shows both lines' set routes (QA N4); set over, a both-ways mark on the link", () => {
    const def = getPieceDef("crossover", false);
    expect(arrowEnds(def)).toEqual([0, 3]);
    const [onA, onB] = [0, 1].map((s) => arrowsOf(oneSwitch("crossover", s).view));
    // Straight on: line A's row along line A, line B's along line B (72 mm over), both pointing the one way, as the link
    // goes over (QA, sc3: line B's pointed back toward end 2, the two rows facing opposite ways).
    for (const a of onA.slice(0, N)) expect([Math.round(a.z), Math.round(Math.cos(a.heading))]).toEqual([0, 1]);
    for (const a of onA.slice(N)) expect([Math.round(a.z), Math.round(Math.cos(a.heading))]).toEqual([72, 1]);
    // (And each row one after another the way it points.)
    for (const row of [onA.slice(0, N), onA.slice(N)]) for (let i = 1; i < N; i++) expect(row[i].x).toBeGreaterThan(row[i - 1].x);
    // Over: the link is set from both its ends (line A's start and line B's end), so trains cross either way: a mark of
    // 2 on it, clear of both lines' grooves, one near each end pointing out toward it ("<  >"), never two rows facing
    // each other mid-link, like trains meeting (QA on switch clarity 2).
    expect(onB).toHaveLength(2);
    const [near, far] = [...onB].sort((p, q) => p.x - q.x);
    expect(Math.cos(near.heading)).toBeLessThan(-0.7);
    expect(Math.cos(far.heading)).toBeGreaterThan(0.7);
    expect(far.z).toBeGreaterThan(near.z);
  });

  it("drawn bigger in the middle step, they still clear the other route's groove (QA: at 1.8x they didn't)", () => {
    const q = createSample();
    const k = ARROW_FAR_SCALES[0];
    // The other track's groove reaches 16 mm from its centre line; the burn, singe and all, its reach at this size.
    const clear = 16 + burnExtent(BURN_SIZES[1]).reach;
    for (const type of ["switch", "switch-y", "switch-3way", "wye", "crossover"] as const) {
      const def = getPieceDef(type, false);
      for (let state = 0; state < statesOf(def); state++) {
        const along = roadOfEach(def, state);
        for (const [i, a] of switchArrows(def, state, k).entries()) {
          const route = along[i];
          let nearest = Infinity;
          for (const p of def.paths) {
            if (p === route) continue;
            for (let d = 0; d <= pathLength(p.geom); d += 1) {
              samplePath(p.geom, d, q);
              nearest = Math.min(nearest, Math.hypot(q.x - a.x, q.z - a.z));
            }
          }
          expect(nearest, `${type} state ${state} at ${a.x.toFixed(0)}, ${a.z.toFixed(0)}`).toBeGreaterThanOrEqual(clear - 0.5);
        }
      }
    }
  });

  it("each chevron is burned into the wood: one mesh, no rim, multiplying the wood under it, its singe fading out", () => {
    const { view } = oneSwitch("switch");
    const burn = view.switchArrows!;
    expect(burn.children).toHaveLength(0);
    expect(view.group.children.filter((c) => String(c.userData.kind).startsWith("switch-arrows"))).toHaveLength(1);
    const mat = burn.material as MeshBasicMaterial;
    expect(mat.blending).toBe(MultiplyBlending);
    expect(mat.premultipliedAlpha).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(burn.castShadow).toBe(false);
    // Flush with the track's top (a hair above it), the singe's outer edge faded to nothing, the core at full strength.
    burn.geometry.computeBoundingBox();
    expect(burn.geometry.boundingBox!.max.y).toBe(0);
    const colour = burn.geometry.attributes.color;
    expect(colour.itemSize).toBe(4);
    const alphas = new Set(Array.from({ length: colour.count }, (_, i) => colour.getW(i)));
    expect([...alphas].sort()).toEqual([0, 1]);
    // The singe reaches a little past the core (a chevron 6 mm half-wide), within the room kept round it.
    expect(burn.geometry.boundingBox!.max.z).toBeGreaterThan(6.5);
    expect(burn.geometry.boundingBox!.max.z).toBeLessThan(6 + 1.4 + 0.5);
    for (const a of arrowsOf(view)) {
      expect(a.y).toBeGreaterThan(TRACK_THICKNESS);
      expect(a.y).toBeLessThan(TRACK_THICKNESS + 0.1);
    }
  });

  it("further out they're drawn bigger, in steps (with a margin), placed afresh only when the step changes", () => {
    expect(arrowScaleFor(1000)).toBe(1);
    expect(arrowScaleFor(2500)).toBe(ARROW_FAR_SCALES[0]);
    expect(arrowScaleFor(4018)).toBe(ARROW_FAR_SCALES[1]);
    // Hovering at a step doesn't flip-flop.
    expect(arrowScaleFor(2700, ARROW_FAR_SCALES[1])).toBe(ARROW_FAR_SCALES[1]);
    expect(arrowScaleFor(2700, ARROW_FAR_SCALES[0])).toBe(ARROW_FAR_SCALES[0]);
    // (The bigger step comes by 2800: at 3300 the middle size was faint on a DPR 1 screen.)
    expect(arrowScaleFor(3300)).toBe(ARROW_FAR_SCALES[1]);
    expect(arrowScaleFor(1700, ARROW_FAR_SCALES[0])).toBe(ARROW_FAR_SCALES[0]);
    expect(arrowScaleFor(1500, ARROW_FAR_SCALES[0])).toBe(1);
    // Further out, each a bigger shape, as long as the old chevrons grew but kept between the grooves (10 mm either side
    // of the middle), singe and all: their arms don't run into the grooves' dark lines.
    const { view } = oneSwitch("switch", 1);
    const mesh = view.switchArrows!;
    const near = mesh.geometry;
    expect(view.setArrowScale(ARROW_FAR_SCALES[1])).toBe(true);
    expect(view.setArrowScale(ARROW_FAR_SCALES[1])).toBe(false);
    expect(view.switchArrows).toBe(mesh);
    expect(mesh.geometry).not.toBe(near);
    // (Each size longer than the last; the biggest at least as long as the old chevrons grew.)
    let was = 0;
    for (const k of [1, ...ARROW_FAR_SCALES]) {
      view.setArrowScale(k);
      const box = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox!);
      expect(box.max.z, `at ${k}`).toBeLessThanOrEqual(10);
      expect(box.max.x - box.min.x, `at ${k}`).toBeGreaterThan(was);
      was = box.max.x - box.min.x;
      expect(mesh.geometry.attributes.position.count / 3).toBe(16);
    }
    expect(was).toBeGreaterThanOrEqual(2 * 4.4 * ARROW_FAR_SCALES[1]);
    view.setArrowScale(ARROW_FAR_SCALES[1]);
    // Drawn at their size in the shape, not scaled by their matrix.
    const m = new Matrix4();
    mesh.getMatrixAt(0, m);
    expect(new Vector3(0, 0, 1).applyMatrix4(m).sub(new Vector3().setFromMatrixPosition(m)).length()).toBeCloseTo(1, 5);
    // Still on the set route, pointing away from the trunk.
    for (const a of arrowsOf(view)) expect(Math.sign(a.z)).toBe(Math.sign(getPieceDef("switch", false).connectors[2].pose.z));
    // (Further out, a deeper char: the grain doesn't show from there, the arrows must. Pinned stays red.)
    const tones = () => arrowsOf(view).map((a) => a.colour);
    expect(new Set(tones())).toEqual(new Set([SWITCH_ARROW_BURN_FAR]));
    view.setArrowScale(1);
    expect(mesh.geometry).toBe(near);
    expect(new Set(tones())).toEqual(new Set([SWITCH_ARROW_BURN]));
  });

  it("a step in the zoom places them cheaply: the clearances are worked out once a route, whatever the size (QA, sc3)", () => {
    // (Fresh piece definitions, so nothing is cached yet: a flipped crossover, the costliest, is built at its own size.)
    const def = getPieceDef("crossover", true);
    switchArrows(def, 0, 1);
    switchArrows(def, 1, 1);
    // Each run steps to sizes not drawn before (the far sizes, a hair off: each its own entry), so every call is a step
    // in the zoom: a scan of the clearances already worked out (a median of 0.015-0.02 ms a call here; worked out
    // again on every call, 0.12-0.19 ms).
    let fresh = 0;
    const run = () => {
      const times: number[] = [];
      for (let rep = 0; rep < 8; rep++) {
        fresh++;
        for (const k of ARROW_FAR_SCALES)
          for (const state of [0, 1]) {
            const t0 = performance.now();
            switchArrows(def, state, k * (1 + fresh * 1e-9));
            times.push(performance.now() - t0);
          }
      }
      times.sort((a, b) => a - b);
      return { median: times[times.length >> 1], worst: times[times.length - 1] };
    };
    run(); // warm up
    // The best of up to six runs: a loaded machine slows a run now and then (a single call took 4.2 ms once, in a full
    // run), not all six. The median is what a real slowdown moves; the slowest call has a generous bound.
    const MEDIAN_BOUND = 0.08;
    const TAIL_BOUND = 2;
    const ok = (r: { median: number; worst: number }) => r.median < MEDIAN_BOUND && r.worst < TAIL_BOUND;
    let best = run();
    for (let i = 1; i < 6 && !ok(best); i++) {
      const r = run();
      if (ok(r) || r.median < best.median) best = r;
    }
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DRAW_BENCH) console.log("zoom steps", JSON.stringify(best));
    // (It took up to 7.4 ms in the browser, around 4 here; now it's a scan of numbers already worked out.)
    expect(best.median, `median ${best.median.toFixed(3)} ms`).toBeLessThan(MEDIAN_BOUND);
    expect(best.worst, `slowest ${best.worst.toFixed(3)} ms`).toBeLessThan(TAIL_BOUND);
  });

  it("no two chevrons burn over each other, at any size, on any switch, and further out wood shows between them (QA on switch-burned: rows fused into a blob)", () => {
    // Each chevron's outline, singe and all, as its two arms (convex quads), placed where it's drawn.
    const arms = (size: (typeof BURN_SIZES)[number], a: { x: number; z: number; heading: number }) => {
      const o = burnOutline(size).singe;
      const c = Math.cos(a.heading);
      const s = Math.sin(a.heading);
      const at = (p: number[]) => [a.x + p[0] * c - p[1] * s, a.z + p[0] * s + p[1] * c];
      return [
        [o[0], o[1], o[2], o[3]].map(at),
        [o[0], o[3], o[4], o[5]].map(at),
      ];
    };
    // How far apart two convex shapes are along the edge normal that best separates them (at most their distance
    // apart; negative if they overlap).
    const gap = (p: number[][], q: number[][]) => {
      let best = -Infinity;
      for (const poly of [p, q])
        for (let i = 0; i < poly.length; i++) {
          const [x0, z0] = poly[i];
          const [x1, z1] = poly[(i + 1) % poly.length];
          const l = Math.hypot(z1 - z0, x0 - x1);
          const nx = (z1 - z0) / l;
          const nz = (x0 - x1) / l;
          const span = (r: number[][]) => r.map(([x, z]) => x * nx + z * nz);
          const a = span(p);
          const b = span(q);
          best = Math.max(best, Math.min(...b) - Math.max(...a), Math.min(...a) - Math.max(...b));
        }
      return best;
    };
    const scales = [1, ...ARROW_FAR_SCALES];
    for (const [k, scale] of scales.entries())
      for (const type of ["switch", "switch-y", "switch-3way", "wye", "crossover"] as const)
        for (const flipped of [false, true]) {
          const def = getPieceDef(type, flipped);
          for (let state = 0; state < statesOf(def); state++) {
            const shapes = switchArrows(def, state, scale).map((a) => arms(BURN_SIZES[k], a));
            const { depth } = burnExtent(BURN_SIZES[k]);
            // Apart, and drawn bigger, wood a couple of pixels wide between them (QA on switch-burned-2: 1–2 px at
            // about 2800 mm). (A best edge normal can only underestimate the distance: a little under `BURN_GAP`.)
            const least = scale === 1 ? 0 : BURN_GAP - 0.4;
            for (let i = 0; i < shapes.length; i++)
              for (let j = i + 1; j < shapes.length; j++)
                for (const p of shapes[i])
                  for (const q of shapes[j]) expect(gap(p, q), `${type}${flipped ? " flipped" : ""} state ${state} at ${scale}x (arms ${depth.toFixed(1)} mm deep): chevrons ${i} and ${j}`).toBeGreaterThan(least);
          }
        }
  });

  it("the chevrons follow the piece (turned and moved)", () => {
    const layout = new Layout();
    layout.addPiece("switch", P(300, 200, Math.PI / 2));
    const view = new TrackView(layout, mats);
    view.sync();
    for (const a of arrowsOf(view)) {
      expect(a.x).toBeCloseTo(300, 5);
      expect(a.z).toBeGreaterThan(200);
      expect(a.heading).toBeCloseTo(Math.PI / 2, 5);
    }
  });

  it("rebuilt on a flip, in the same mesh; a pinned switch's burn red and its peg shows", () => {
    const { layout, id, view } = oneSwitch("switch");
    const mesh = view.switchArrows;
    const before = arrowsOf(view);
    expect(before.every((a) => a.colour === SWITCH_ARROW_BURN)).toBe(true);
    expect(view.pinShown(id)).toBe(false);
    layout.setSwitchState(id, 1);
    view.syncSwitches();
    expect(view.switchArrows).toBe(mesh);
    expect(arrowsOf(view)[2].z).not.toBeCloseTo(before[2].z, 1);
    layout.setPinned(id, true);
    view.syncSwitches();
    expect(arrowsOf(view).every((a) => a.colour === SWITCH_ARROW_PINNED)).toBe(true);
    expect(view.pinShown(id)).toBe(true);
    layout.setPinned(id, false);
    view.syncSwitches();
    expect(arrowsOf(view).every((a) => a.colour === SWITCH_ARROW_BURN)).toBe(true);
    expect(view.pinShown(id)).toBe(false);
  });

  it("a switch taken away takes its chevrons (and the mesh goes with the last)", () => {
    const layout = new Layout();
    const a = layout.addPiece("switch", P(0, 0));
    const b = layout.addPiece("switch-y", P(500, 0));
    const view = new TrackView(layout, mats);
    view.sync();
    expect(view.switchArrows!.count).toBe(2 * N);
    layout.removePiece(a);
    view.sync();
    expect(view.switchArrows!.count).toBe(N);
    layout.removePiece(b);
    view.sync();
    expect(view.switchArrows).toBeNull();
  });

  it("nothing per frame: a flip without a swing asks for none, and the chevrons aren't picked", () => {
    const { layout, id, view } = oneSwitch("switch");
    layout.setSwitchState(id, 1);
    expect(view.syncSwitches()).toBeNull();
    expect(view.swinging).toBe(false);
    expect(view.switchArrows!.raycast).toBeTypeOf("function");
    const hits: unknown[] = [];
    view.switchArrows!.raycast({} as never, hits as never);
    expect(hits).toHaveLength(0);
  });
});

describe("lever posts (for a fingertip's slack)", () => {
  it("a switch's lever and semaphore stand beside its trunk, off the track", () => {
    const layout = new Layout();
    const sw = layout.addPiece("switch", P(0, 0));
    const view = new TrackView(layout, mats);
    view.sync();
    const posts = view.leverPosts();
    expect(posts.map((p) => p.pieceId)).toEqual([sw, sw]);
    for (const p of posts) {
      expect(Math.abs(p.z)).toBeGreaterThan(20);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(144);
      expect(p.height).toBeGreaterThan(30);
    }
  });
});

describe("a wye's three levers (#15)", () => {
  it("a lever beside each corner, off the track, each leaning toward the road its own corner is set to", () => {
    const { layout, id, view } = oneSwitch("wye");
    const levers = () => view.group.children.filter((c): c is Mesh => c instanceof Mesh && c.userData.kind === "switch-lever" && c.userData.pieceId === id);
    expect(levers().map((l) => l.userData.corner)).toEqual([0, 1, 2]);
    const posts = view.leverPosts().filter((p) => p.pieceId === id);
    // (Three levers and the trunk's semaphore.)
    expect(posts.map((p) => p.corner ?? 0).sort()).toEqual([0, 0, 1, 2]);
    // Each corner's lever near its own end, and off every road through the wye.
    const def = getPieceDef("wye", false);
    const s = createSample();
    for (const k of [0, 1, 2]) {
      const p = posts.find((q) => (q.corner ?? 0) === k && q.height < 40)!;
      const end = def.connectors[k].pose;
      expect(Math.hypot(p.x - end.x, p.z - end.z)).toBeLessThan(80);
      for (const path of def.paths) {
        const len = pathLength(path.geom);
        for (let d = 0; d <= len; d += 4) {
          samplePath(path.geom, d, s);
          expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeGreaterThan(16);
        }
      }
    }
    // Thrown, only the corner's own lever leans the other way.
    const lean = () => levers().map((l) => Math.atan2(new Vector3(0, 1, 0).transformDirection(l.matrix).z, new Vector3(0, 1, 0).transformDirection(l.matrix).y));
    const before = lean();
    layout.setSwitchState(id, 0b010);
    view.syncSwitches();
    const after = lean();
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[2]).toBeCloseTo(before[2]);
    expect(Math.sign(after[1])).toBe(-Math.sign(before[1]));
  });

  it("a corner's lever thrown so a road is set both ways (or no longer is): the lever still swings, the chevrons are burned afresh", () => {
    const { layout, id, view } = oneSwitch("wye", 0b010);
    // (0b010: every road set from one end, 3 rows.)
    expect(arrowsOf(view)).toHaveLength(3 * N);
    // (Corner 1's lever: the one thrown.)
    const lean1 = () => {
      const l = view.group.children.find((c): c is Mesh => c instanceof Mesh && c.userData.kind === "switch-lever" && c.userData.pieceId === id && c.userData.corner === 1)!;
      return new Vector3(0, 1, 0).transformDirection(l.matrix);
    };
    const before = lean1();
    layout.setSwitchState(id, 0b000);
    const f = view.syncSwitches((p) => p === id)!;
    expect(f).not.toBeNull();
    expect(view.swinging).toBe(true);
    // (The curve to corner 1 now set from the trunk and corner 1 both: a row of N and a mark of 2.)
    const now = arrowsOf(view);
    expect(now).toHaveLength(N + 2);
    const rest = arrowsOf(oneSwitch("wye", 0b000).view);
    now.forEach((a, i) => expect([a.x, a.z, a.heading].map((v) => v.toFixed(3))).toEqual([rest[i].x, rest[i].z, rest[i].heading].map((v) => v.toFixed(3))));
    const flourishes = new Flourishes();
    flourishes.add(f);
    flourishes.update(SWITCH_SWING_S / 2);
    // Part way over ...
    expect(lean1().angleTo(before)).toBeGreaterThan(0.05);
    for (let i = 0; i < 20 && flourishes.count > 0; i++) flourishes.update(1 / 60);
    // ... then over, and still.
    expect(view.swinging).toBe(false);
    // (Leaning as far the other way: 0.45 rad each side of upright.)
    expect(lean1().angleTo(before)).toBeCloseTo(0.9, 3);
    expect(lean1().y).toBeCloseTo(before.y, 5);
  });

  it("pinned: every lever shows the pin", () => {
    const { layout, id, view } = oneSwitch("wye");
    layout.setPinned(id, true);
    view.syncSwitches();
    const pegs = view.group.children.filter((c) => c.userData.kind === "switch-lever" && c.userData.pieceId === id).flatMap((l) => l.children.filter((c) => c.visible));
    expect(pegs).toHaveLength(3);
  });
});

describe("lever swing", () => {
  it("a flip that swings: the lever goes over and the chevrons slide across over ~120 ms, then it all stops", () => {
    const { layout, id, view } = oneSwitch("switch");
    const lean0 = leanOf(view, id);
    const from = arrowsOf(view);
    layout.setSwitchState(id, 1);
    const f = view.syncSwitches((p) => p === id)!;
    expect(f).not.toBeNull();
    expect(view.swinging).toBe(true);
    // Still where it was until the first step.
    expect(leanOf(view, id)).toBeCloseTo(lean0, 5);
    const flourishes = new Flourishes();
    flourishes.add(f);
    flourishes.update(SWITCH_SWING_S / 2);
    const mid = arrowsOf(view);
    const leanMid = leanOf(view, id);
    expect(flourishes.count).toBe(1);
    expect(Math.abs(mid[2].z)).toBeGreaterThan(Math.abs(from[2].z) + 1);
    expect(leanMid).not.toBeCloseTo(lean0, 2);
    let frames = 1;
    while (flourishes.count > 0 && frames < 100) {
      flourishes.update(1 / 60);
      frames++;
    }
    // Settled in about 120 ms of frames, then nothing more asked for.
    expect(frames).toBeLessThanOrEqual(Math.ceil(SWITCH_SWING_S * 60) + 2);
    expect(view.swinging).toBe(false);
    expect(leanOf(view, id)).toBeCloseTo(-lean0, 5);
    const rest = oneSwitch("switch", 1);
    const want = arrowsOf(rest.view);
    arrowsOf(view).forEach((a, i) => {
      expect(a.x).toBeCloseTo(want[i].x, 5);
      expect(a.z).toBeCloseTo(want[i].z, 5);
      expect(a.heading).toBeCloseTo(want[i].heading, 5);
    });
  });

  it("only the switches asked swing; the others are just set", () => {
    const layout = new Layout();
    const a = layout.addPiece("switch", P(0, 0));
    const b = layout.addPiece("switch", P(500, 0));
    const view = new TrackView(layout, mats);
    view.sync();
    const leanB = leanOf(view, b);
    layout.setSwitchState(a, 1);
    layout.setSwitchState(b, 1);
    view.syncSwitches((id) => id === a);
    expect(leanOf(view, b)).toBeCloseTo(-leanB, 5);
    expect(leanOf(view, a)).toBeCloseTo(leanB, 5);
  });

  it("a second swing while one runs joins it (no second flourish); cleared, it finishes at rest", () => {
    const layout = new Layout();
    const a = layout.addPiece("switch", P(0, 0));
    const b = layout.addPiece("switch", P(500, 0));
    const view = new TrackView(layout, mats);
    view.sync();
    const lean0 = leanOf(view, a);
    const flourishes = new Flourishes();
    layout.setSwitchState(a, 1);
    flourishes.add(view.syncSwitches((id) => id === a)!);
    flourishes.update(0.03);
    layout.setSwitchState(b, 1);
    expect(view.syncSwitches((id) => id === b)).toBeNull();
    expect(view.swinging).toBe(true);
    flourishes.clear();
    expect(view.swinging).toBe(false);
    expect(leanOf(view, a)).toBeCloseTo(-lean0, 5);
    expect(leanOf(view, b)).toBeCloseTo(-lean0, 5);
    // A new swing after that gets a flourish of its own.
    layout.setSwitchState(a, 0);
    expect(view.syncSwitches((id) => id === a)).not.toBeNull();
  });

  it("a layout change mid-swing draws the switch at rest", () => {
    const { layout, id, view } = oneSwitch("switch");
    const lean0 = leanOf(view, id);
    const flourishes = new Flourishes();
    layout.setSwitchState(id, 1);
    flourishes.add(view.syncSwitches((p) => p === id)!);
    flourishes.update(0.02);
    view.sync();
    expect(view.swinging).toBe(false);
    expect(leanOf(view, id)).toBeCloseTo(-lean0, 5);
    flourishes.update(1 / 60);
    expect(flourishes.count).toBe(0);
  });

  it("a three-way swings from upright to a curve", () => {
    const { layout, id, view } = oneSwitch("switch-3way");
    expect(leanOf(view, id)).toBeCloseTo(0, 5);
    layout.setSwitchState(id, 1);
    const flourishes = new Flourishes();
    flourishes.add(view.syncSwitches((p) => p === id)!);
    for (let k = 0; k < 20; k++) flourishes.update(1 / 60);
    expect(Math.abs(leanOf(view, id))).toBeCloseTo(0.45, 5);
  });
});
