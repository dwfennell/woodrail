import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, PerspectiveCamera, Vector3, type BufferGeometry, type Mesh, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { CARGO, Economy, type DepotRole } from "../economy";
import { Sim, SIM_DT } from "../sim";
import { Layout, type PieceTypeId } from "../track";
import { DepotView } from "./depot-view";
import { cullTiles, detailReach, viewReach } from "./dressing/tiles";
import { INDUSTRY_MOTES, moteMatrix, MOTE_PERIOD, PIG_REACH, TUB_RUN, type MoteKind } from "./industry-motes";
import type { Materials } from "./materials";

function stubMaterials(): Materials {
  const cache = new Map<string, MeshStandardMaterial>();
  const lacquer = (c: string) => {
    let m = cache.get(c);
    if (!m) cache.set(c, (m = new MeshStandardMaterial({ color: new Color(c) })));
    return m;
  };
  const m = () => new MeshStandardMaterial();
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

const at = new Vector3();
const pos = (kind: MoteKind, time: number) => at.setFromMatrixPosition(moteMatrix(kind, time, new Matrix4())).clone();

describe("industry motes: each loop is a pure function of the game clock, and stays where it belongs", () => {
  it("the same time gives the same pose (any number of industries can share one clock)", () => {
    for (const kind of Object.keys(MOTE_PERIOD) as MoteKind[]) {
      expect(moteMatrix(kind, 12.34, new Matrix4()).equals(moteMatrix(kind, 12.34, new Matrix4()))).toBe(true);
    }
  });

  it("a pig wanders but never leaves its pen", () => {
    let spanT = 0;
    let spanL = 0;
    for (let t = 0; t < 2000; t += 0.37) {
      const p = pos("pig", t);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(PIG_REACH.t + 1e-6);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(PIG_REACH.l + 1e-6);
      spanT = Math.max(spanT, Math.abs(p.x));
      spanL = Math.max(spanL, Math.abs(p.z));
    }
    // It does go round the pen, not just shuffle.
    expect(spanT).toBeGreaterThan(PIG_REACH.t * 0.9);
    expect(spanL).toBeGreaterThan(PIG_REACH.l * 0.9);
  });

  it("the quarry's tub runs its rails end to end and waits at each end, never past them", () => {
    const xs: number[] = [];
    for (let t = 0; t < MOTE_PERIOD.tub; t += 0.05) xs.push(pos("tub", t).x);
    expect(Math.min(...xs)).toBeCloseTo(-TUB_RUN, 5);
    expect(Math.max(...xs)).toBeCloseTo(TUB_RUN, 5);
    expect(xs.filter((x) => Math.abs(x - TUB_RUN) < 1e-6).length).toBeGreaterThan(10);
  });

  it("the axe and the hammer swing within their arcs; the cap hops and lands", () => {
    const angle = (kind: MoteKind, t: number) => {
      const e = new Vector3(1, 0, 0).applyMatrix4(moteMatrix(kind, t, new Matrix4()));
      return Math.atan2(e.y, e.x);
    };
    for (let t = 0; t < 10; t += 0.01) {
      expect(angle("axe", t)).toBeGreaterThanOrEqual(-0.36);
      expect(angle("axe", t)).toBeLessThanOrEqual(1.31);
      const y = pos("cap", t).y;
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(3.21);
    }
  });
});

/** Industries of these roles in a row, with what they work on, drawn by a DepotView; a camera on them, or away. */
function world(roles: DepotRole[]) {
  const layout = new Layout();
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const depots = roles.map((role, k) => {
    const piece = layout.addPiece(`depot-${role}` as PieceTypeId, { x: k * 400, z: 0, heading: 0 });
    return economy.addDepot(role, piece);
  });
  const stock = (on: boolean) => {
    for (const d of depots) {
      d.piles.fill(0);
      // Idle: a farm, quarry or forest stands still with its pile full (no room for more); the others with nothing in.
      for (const k of ["log", "planks", "iron", "coal", "ore"] as const) if (on) d.piles[CARGO[k].index] = 6;
      if (!on) for (const k of ["grain", "stone", "log"] as const) d.piles[CARGO[k].index] = 999;
    }
  };
  // A train far off, so what they make has somewhere to go (with none on the map, they stand still: tested below).
  const line = layout.addPiece("straight-216", { x: 0, z: 90000, heading: 0 });
  const train = sim.addTrain(["engine"], { pieceId: line, pathIndex: 0, reversed: false, s: 100 });
  const view = new DepotView(stubMaterials());
  view.calm = false;
  view.setWorld(economy, layout);
  const camera = new PerspectiveCamera(50, 390 / 844, 10, 100000);
  const look = (x: number, z: number) => {
    camera.position.set(x, 1600, z + 1200);
    camera.lookAt(x, 0, z);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
  };
  look(roles.length * 200, 60);
  return { economy, sim, train, depots, view, camera, look, stock };
}

/** The game's loop as far as depots go (as depot-view.test.ts's): frames drawn over `seconds`. */
function run(w: ReturnType<typeof world>, seconds: number, clock: { sim: number }): number {
  let drawn = 0;
  for (let f = 0; f < seconds * 30; f++) {
    w.economy.tick();
    clock.sim += SIM_DT * 4;
    const r = w.view.update(w.economy, [], 0, () => undefined, clock.sim, false);
    if (r === "still") continue;
    cullTiles([w.view.group], w.camera, viewReach(1100), detailReach(1100));
    drawn++;
  }
  return drawn;
}

/** Every mote instance's matrix now, flattened (to compare). */
function snapshot(w: ReturnType<typeof world>): number[] {
  const out: number[] = [];
  w.view.group.traverse((o) => {
    if (!(o instanceof InstancedMesh) || !o.parent || o.parent === w.view.group) return;
    for (let i = 0; i < o.count; i++) out.push(...o.getMatrixAt(i, new Matrix4()).elements);
  });
  return out;
}

const MOVING: DepotRole[] = ["forest", "farm", "quarry", "foundry", "smithy", "carpenter"];

describe("DepotView: busy industries move, idle ones stand still, and only in view", () => {
  it("every industry with motes has them, as instances: one mesh per kind and colour, however many industries", () => {
    const one = world(MOVING);
    const many = world([...MOVING, ...MOVING, ...MOVING]);
    const meshes = (w: ReturnType<typeof world>) => {
      let n = 0;
      w.view.group.traverse((o) => {
        if (o instanceof InstancedMesh && o.parent !== w.view.group) n++;
      });
      return n;
    };
    expect(meshes(many)).toBe(meshes(one));
    expect(snapshot(many).length).toBe(3 * snapshot(one).length);
    for (const role of MOVING) expect(INDUSTRY_MOTES[role]?.length).toBeGreaterThan(0);
  });

  it("idle industries stand still and ask for no frames; working ones move and keep drawing", () => {
    const w = world(MOVING);
    const clock = { sim: 0 };
    w.stock(false);
    for (const d of w.depots) expect(w.economy.working(d)).toBe(false);
    run(w, 0.2, clock);
    const still = snapshot(w);
    expect(run(w, 5, clock)).toBe(0);
    expect(snapshot(w)).toEqual(still);
    w.stock(true);
    for (const d of w.depots) expect(w.economy.working(d)).toBe(true);
    expect(run(w, 2, clock)).toBe(60);
    expect(snapshot(w)).not.toEqual(still);
  });

  it("working with no train on the map (Sandbox's opening view): what they make has nowhere to go, so no frames", () => {
    const w = world([...MOVING, "sawmill"]);
    const clock = { sim: 0 };
    w.stock(true);
    run(w, 0.2, clock);
    const id = "trainId" in w.train ? w.train.trainId : -1;
    w.sim.removeTrain(id as number);
    expect(w.sim.trainCount).toBe(0);
    for (const d of w.depots) expect(w.economy.working(d)).toBe(true);
    run(w, 0.2, clock);
    const still = snapshot(w);
    expect(run(w, 5, clock)).toBe(0);
    expect(snapshot(w)).toEqual(still);
    // They still make goods: the yard fills while standing still.
    const forest = w.depots[0];
    const logs = forest.piles[CARGO.log.index];
    for (let t = 0; t < 20 / SIM_DT; t++) w.economy.tick();
    expect(forest.piles[CARGO.log.index]).toBeGreaterThan(logs);
  });

  it("working but out of view: no frames, and they hold where they were until seen again", () => {
    const w = world(MOVING);
    const clock = { sim: 0 };
    w.stock(true);
    run(w, 1, clock);
    w.look(60000, 60000);
    w.view.update(w.economy, [], 0, () => undefined, clock.sim, false);
    cullTiles([w.view.group], w.camera, viewReach(1100), detailReach(1100));
    const held = snapshot(w);
    expect(run(w, 10, clock)).toBe(0);
    expect(snapshot(w)).toEqual(held);
    w.look(MOVING.length * 200, 60);
    cullTiles([w.view.group], w.camera, viewReach(1100), detailReach(1100));
    expect(run(w, 1, clock)).toBe(30);
    expect(snapshot(w)).not.toEqual(held);
  });

  it("asked for less motion (prefers-reduced-motion), working industries stand still and ask for no frames", () => {
    const w = world([...MOVING, "sawmill"]);
    w.view.calm = true;
    const clock = { sim: 0 };
    w.stock(true);
    const saw = w.view.group.children.filter((o) => o.userData.depotMoving && !(o instanceof InstancedMesh));
    // (The first frame draws the piles as stocked.)
    run(w, 0.1, clock);
    const turns = saw.map((o) => o.quaternion.clone());
    const before = snapshot(w);
    expect(run(w, 3, clock)).toBe(0);
    expect(snapshot(w)).toEqual(before);
    expect(saw.every((o, i) => o.quaternion.equals(turns[i]))).toBe(true);
  });

  it("a still picture of a yard (the piece in a hand, the tray's) has its motes at rest; a ruin keeps only its machines", () => {
    const view = new DepotView(stubMaterials());
    const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    const verts = (o: Object3D) => {
      let n = 0;
      o.traverse((m) => {
        if ((m as Mesh).isMesh) n += tris((m as Mesh).geometry);
      });
      return n;
    };
    // A farm's picture has its pen and pigs; its ruin neither.
    let ruin = 0;
    view.staticParts("farm", { x: 0, z: 0, heading: 0 }, (_m, g) => (ruin += tris(g)));
    expect(verts(view.model("farm"))).toBeGreaterThan(ruin + 200);
    // A quarry's ruin keeps its tub wagon (a machine).
    let quarryRuin = 0;
    view.staticParts("quarry", { x: 0, z: 0, heading: 0 }, (_m, g) => (quarryRuin += tris(g)));
    expect(Math.abs(verts(view.model("quarry")) - quarryRuin)).toBeLessThan(10);
  });
});
