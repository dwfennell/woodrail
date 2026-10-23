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
import { createSample, getPieceDef, Layout, pathLength, samplePath, TRACK_THICKNESS, type PieceTypeId } from "../track";
import type { Materials } from "./materials";
import { ARROW_FAR_SCALES, arrowEnds, BURN_SIZES, burnExtent, burnOutline, arrowScaleFor, setRoute, switchArrows, SWITCH_ARROW_AT, SWITCH_ARROW_BURN, SWITCH_ARROW_CLEAR, trunkRoutes, SWITCH_ARROW_PINNED, SWITCH_SWING_S, TrackView } from "./track-view";

const plain = () => new MeshBasicMaterial();
const mats = { track: plain(), trackCut: plain(), bridgePaint: plain(), lacquer: plain, naturalWood: plain(), magnet: plain() } as unknown as Materials;
const P = (x: number, z: number, heading = 0) => ({ x, z, heading });
const N = SWITCH_ARROW_AT.length;

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
    // (The crossover shows both its lines' set routes.)
    expect(view.switchArrows!.count).toBe(6 * N);
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

  it("a wye shows the route from its trunk (not the straight across)", () => {
    for (const s of [0, 1]) {
      const arrows = arrowsOf(oneSwitch("wye", s).view);
      // Along a quarter turn from the trunk at x 0: off to one side, pointing away from the trunk end.
      for (const a of arrows) expect(Math.hypot(a.x, a.z)).toBeGreaterThan(20);
      expect(Math.sign(arrows[2].z)).toBe(s === 0 ? 1 : -1);
    }
  });

  it("the chevrons start past where the routes part: none lies over another route's groove near the trunk", () => {
    const q = createSample();
    for (const type of ["switch", "switch-y", "switch-3way", "wye", "crossover"] as const) {
      for (const flipped of [false, true]) {
        const def = getPieceDef(type, flipped);
        for (let state = 0; state < trunkRoutes(def).length; state++) {
          // (Each end's row in turn, along the route set from there; one row for two ends set along the same route.)
          const ends = arrowEnds(def).filter((e, i, all) => all.findIndex((o) => setRoute(def, state, o) === setRoute(def, state, e)) === i);
          const all = arrowsOf(oneSwitch(type, state, flipped).view);
          expect(all, `${type} ${state}`).toHaveLength(N * ends.length);
          const rows = ends.map((end, k) => ({ end, route: setRoute(def, state, end)!, arrows: all.slice(k * N, (k + 1) * N) }));
          for (const { end, route, a } of rows.flatMap((r) => r.arrows.map((a) => ({ ...r, a })))) {
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

  it("a crossover shows both lines' set routes (QA N4); set over, one row the whole way across the link", () => {
    const def = getPieceDef("crossover", false);
    expect(arrowEnds(def)).toEqual([0, 3]);
    const [onA, onB] = [0, 1].map((s) => arrowsOf(oneSwitch("crossover", s).view));
    // Straight on: line A's row along line A, line B's along line B (72 mm over), both pointing the one way, as the link
    // goes over (QA, sc3: line B's pointed back toward end 2, the two rows facing opposite ways).
    for (const a of onA.slice(0, N)) expect([Math.round(a.z), Math.round(Math.cos(a.heading))]).toEqual([0, 1]);
    for (const a of onA.slice(N)) expect([Math.round(a.z), Math.round(Math.cos(a.heading))]).toEqual([72, 1]);
    // (And each row one after another the way it points.)
    for (const row of [onA.slice(0, N), onA.slice(N)]) for (let i = 1; i < N; i++) expect(row[i].x).toBeGreaterThan(row[i - 1].x);
    // Over: one row on the link, where it's clear of both lines' grooves, all pointing the one way, from line A over to
    // line B (no two rows facing each other mid-link, like trains meeting: QA on switch clarity 2).
    expect(onB).toHaveLength(N);
    for (const p of onB) expect(Math.cos(p.heading)).toBeGreaterThan(0.7);
    for (let i = 1; i < N; i++) {
      expect(onB[i].x).toBeGreaterThan(onB[i - 1].x);
      expect(onB[i].z).toBeGreaterThan(onB[i - 1].z);
    }
  });

  it("drawn bigger in the middle step, they still clear the other route's groove (QA: at 1.8x they didn't)", () => {
    const q = createSample();
    const k = ARROW_FAR_SCALES[0];
    // The other track's groove reaches 16 mm from its centre line; the burn, singe and all, its reach at this size.
    const clear = 16 + burnExtent(BURN_SIZES[1]).reach;
    for (const type of ["switch", "switch-y", "switch-3way", "wye", "crossover"] as const) {
      const def = getPieceDef(type, false);
      for (let state = 0; state < trunkRoutes(def).length; state++) {
        const route = setRoute(def, state)!;
        for (const a of switchArrows(def, state, k).slice(0, N)) {
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
    view.setArrowScale(1);
    expect(mesh.geometry).toBe(near);
  });

  it("a step in the zoom places them cheaply: the clearances are worked out once a route, whatever the size (QA, sc3)", () => {
    // (Fresh piece definitions, so nothing is cached yet: a flipped crossover, the costliest, is built at its own size.)
    const def = getPieceDef("crossover", true);
    switchArrows(def, 0, 1);
    switchArrows(def, 1, 1);
    let worst = 0;
    for (const k of ARROW_FAR_SCALES)
      for (const state of [0, 1]) {
        const t0 = performance.now();
        switchArrows(def, state, k);
        worst = Math.max(worst, performance.now() - t0);
      }
    // (It took up to 7.4 ms in the browser, around 4 here; now it's a scan of numbers already worked out.)
    expect(worst).toBeLessThan(1);
  });

  it("no two chevrons burn over each other, at any size, on any switch (QA on switch-burned: rows fused into a blob)", () => {
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
    // Two convex shapes overlap unless some edge's normal separates them.
    const apart = (p: number[][], q: number[][]) => {
      for (const poly of [p, q])
        for (let i = 0; i < poly.length; i++) {
          const [x0, z0] = poly[i];
          const [x1, z1] = poly[(i + 1) % poly.length];
          const nx = z1 - z0;
          const nz = x0 - x1;
          const span = (r: number[][]) => r.map(([x, z]) => x * nx + z * nz);
          const a = span(p);
          const b = span(q);
          if (Math.max(...a) <= Math.min(...b) + 1e-6 || Math.max(...b) <= Math.min(...a) + 1e-6) return true;
        }
      return false;
    };
    const scales = [1, ...ARROW_FAR_SCALES];
    for (const [k, scale] of scales.entries())
      for (const type of ["switch", "switch-y", "switch-3way", "wye", "crossover"] as const)
        for (const flipped of [false, true]) {
          const def = getPieceDef(type, flipped);
          for (let state = 0; state < trunkRoutes(def).length; state++) {
            const shapes = switchArrows(def, state, scale).map((a) => arms(BURN_SIZES[k], a));
            const { depth } = burnExtent(BURN_SIZES[k]);
            for (let i = 0; i < shapes.length; i++)
              for (let j = i + 1; j < shapes.length; j++)
                for (const p of shapes[i])
                  for (const q of shapes[j]) expect(apart(p, q), `${type}${flipped ? " flipped" : ""} state ${state} at ${scale}x (arms ${depth.toFixed(1)} mm deep): chevrons ${i} and ${j}`).toBe(true);
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
