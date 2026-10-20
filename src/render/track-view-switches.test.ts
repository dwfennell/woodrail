import { Color, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Flourishes } from "./flourishes";
import { createSample, getPieceDef, Layout, pathLength, samplePath, type PieceTypeId } from "../track";
import type { Materials } from "./materials";
import { setRoute, SWITCH_ARROW_AT, SWITCH_ARROW_CLEAR, SWITCH_ARROW_CREAM, trunkRoutes, SWITCH_ARROW_PINNED, SWITCH_SWING_S, TrackView } from "./track-view";

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
    expect(view.switchArrows!.count).toBe(5 * N);
    // One draw for all of them: a single mesh, a handful of triangles a chevron.
    expect(view.group.children.filter((c) => c.userData.kind === "switch-arrows")).toHaveLength(1);
    expect(view.switchArrows!.geometry.attributes.position.count / 3).toBe(4);
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
          const route = setRoute(def, state)!;
          const arrows = arrowsOf(oneSwitch(type, state, flipped).view);
          expect(arrows, `${type} ${state}`).toHaveLength(N);
          for (const a of arrows) {
            // Every other track through the piece (its other routes, a wye's straight across, a crossover's other line).
            let nearest = Infinity;
            for (const p of def.paths) {
              if (p === route) continue;
              for (let d = 0; d <= pathLength(p.geom); d += 1) {
                samplePath(p.geom, d, q);
                nearest = Math.min(nearest, Math.hypot(q.x - a.x, q.z - a.z));
              }
            }
            expect(nearest, `${type}${flipped ? " flipped" : ""} state ${state}: chevron at ${a.x.toFixed(0)}, ${a.z.toFixed(0)}`).toBeGreaterThanOrEqual(SWITCH_ARROW_CLEAR - 0.5);
          }
        }
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

  it("rebuilt on a flip, in the same mesh; a pinned switch's go orange and its peg shows", () => {
    const { layout, id, view } = oneSwitch("switch");
    const mesh = view.switchArrows;
    const before = arrowsOf(view);
    expect(before.every((a) => a.colour === SWITCH_ARROW_CREAM)).toBe(true);
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
    expect(arrowsOf(view).every((a) => a.colour === SWITCH_ARROW_CREAM)).toBe(true);
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
