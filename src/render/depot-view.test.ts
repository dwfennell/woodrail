import { Color, MeshStandardMaterial, PerspectiveCamera, Quaternion } from "three";
import { describe, expect, it } from "vitest";
import { CARGO, Economy } from "../economy";
import { Sim, SIM_DT } from "../sim";
import { Layout } from "../track";
import { DepotView } from "./depot-view";
import { cullTiles, detailReach, viewReach } from "./dressing/tiles";
import type { Materials } from "./materials";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

/** A sawmill with logs to cut (so it's working), no trains, drawn by a DepotView; a camera looking at it, or away. */
function world() {
  const layout = new Layout();
  const at = layout.addPiece("depot-sawmill", { x: 0, z: 0, heading: 0 });
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const saw = economy.addDepot("sawmill", at);
  saw.piles[CARGO.log.index] = 6;
  const view = new DepotView(stubMaterials());
  view.setWorld(economy, layout);
  const camera = new PerspectiveCamera(50, 390 / 844, 10, 100000);
  const look = (x: number, z: number) => {
    camera.position.set(x, 900, z + 700);
    camera.lookAt(x, 0, z);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
  };
  look(108, 60);
  return { economy, saw, view, camera, look };
}

/**
 * The game's loop, as far as depots go (`Game.frame`): the sim runs unless paused, the view is updated, and a frame
 * is drawn (culling what's out of view first) only if the view asked for one. Frames drawn over `seconds`.
 */
function run(w: ReturnType<typeof world>, seconds: number, paused: boolean, clock: { sim: number }): number {
  let drawn = 0;
  const reach = viewReach(1100);
  for (let f = 0; f < seconds * 30; f++) {
    if (!paused)
      for (let k = 0; k < 4; k++) {
        w.economy.tick();
        clock.sim += SIM_DT;
      }
    const r = w.view.update(w.economy, [], 0, () => undefined, clock.sim, paused);
    if (r === "still") continue;
    cullTiles([w.view.group], w.camera, reach, detailReach(1100));
    drawn++;
  }
  return drawn;
}

describe("DepotView: a working depot draws only while the game runs and it's in view", () => {
  it("paused, a working sawmill asks for no frames, and its saw holds still", () => {
    const w = world();
    const clock = { sim: 0 };
    run(w, 1, false, clock); // drawn once, in view
    expect(w.economy.working(w.saw)).toBe(true);
    const turn = (o: { quaternion: Quaternion }) => o.quaternion.clone();
    const saws = w.view.group.children.filter((o) => o.userData.depotMoving);
    const before = saws.map(turn);
    expect(run(w, 30, true, clock)).toBe(0);
    expect(saws.map(turn).every((q, i) => q.equals(before[i]))).toBe(true);
    // Resumed: it turns on, and asks for frames.
    expect(run(w, 1, false, clock)).toBeGreaterThan(20);
    expect(saws.map(turn).some((q, i) => !q.equals(before[i]))).toBe(true);
  });

  it("running, a working sawmill in view keeps drawing; out of view it draws (about) nothing", () => {
    const w = world();
    const clock = { sim: 0 };
    expect(run(w, 2, false, clock)).toBe(60);
    // The camera looks far away: the move draws (culling the sawmill's moving parts), then nothing more.
    w.look(30000, 30000);
    w.view.update(w.economy, [], 0, () => undefined, clock.sim, false);
    cullTiles([w.view.group], w.camera, viewReach(1100), detailReach(1100));
    expect(w.economy.working(w.saw)).toBe(true);
    // 30 s off screen with the trains stopped: the logs it cuts (one every 8 s) change its piles unseen, drawn nothing.
    const logs = w.saw.piles[CARGO.log.index];
    expect(run(w, 30, false, clock)).toBe(0);
    expect(w.saw.piles[CARGO.log.index]).toBeLessThan(logs);
    expect(w.view.update(w.economy, [], 0, () => undefined, clock.sim + SIM_DT, false)).toBe("still");
    // Back in view: the camera move draws, and from the next frame it animates again.
    w.look(108, 60);
    cullTiles([w.view.group], w.camera, viewReach(1100), detailReach(1100));
    expect(w.view.update(w.economy, [], 0, () => undefined, clock.sim + 2 * SIM_DT, false)).toBe("moving");
    expect(run(w, 1, false, clock)).toBe(30);
  });

  it("the saw turns by the game's time, not by frames", () => {
    const w = world();
    const saws = w.view.group.children.filter((o) => o.userData.depotMoving);
    w.view.update(w.economy, [], 0, () => undefined, 10, false);
    const q0 = saws.map((o) => o.quaternion.clone());
    // Many frames, the same game time: nothing turns.
    for (let i = 0; i < 20; i++) w.view.update(w.economy, [], 0, () => undefined, 10, false);
    expect(saws.every((o, i) => o.quaternion.equals(q0[i]))).toBe(true);
    // Half a second of game time in one frame or in many: the same turn.
    const a = world();
    const b = world();
    const sa = a.view.group.children.filter((o) => o.userData.depotMoving);
    const sb = b.view.group.children.filter((o) => o.userData.depotMoving);
    a.view.update(a.economy, [], 0, () => undefined, 0, false);
    b.view.update(b.economy, [], 0, () => undefined, 0, false);
    a.view.update(a.economy, [], 0, () => undefined, 0.5, false);
    for (let i = 1; i <= 50; i++) b.view.update(b.economy, [], 0, () => undefined, i * 0.01, false);
    for (let i = 0; i < sa.length; i++) expect(sa[i].quaternion.angleTo(sb[i].quaternion)).toBeLessThan(1e-6);
  });
});

describe("DepotView.depotAt: a tap on a depot's yard or buildings means that depot (QA: the workshop's far end went to the town beside it)", () => {
  for (const heading of [0, Math.PI / 3]) {
    it(`by the yard it's on, its far end too (heading ${heading.toFixed(2)})`, () => {
      const layout = new Layout();
      const at = layout.addPiece("depot-workshop", { x: 500, z: -300, heading });
      const economy = new Economy(layout, new Sim(layout));
      const shop = economy.addDepot("workshop", at);
      const view = new DepotView(stubMaterials());
      view.setWorld(economy, layout);
      // In the site's frame (t along the track, l across): the yard runs t 10..206, l 30..114.
      const world = (t: number, l: number) => ({ x: 500 + Math.cos(heading) * t - Math.sin(heading) * l, z: -300 + Math.sin(heading) * t + Math.cos(heading) * l });
      for (const [t, l] of [[190, 100], [200, 40], [20, 110], [108, 72]]) {
        const p = world(t, l);
        expect(view.depotAt(p.x, p.z), `t ${t}, l ${l}`).toBe(shop.id);
      }
      const off = world(108, 200);
      expect(view.depotAt(off.x, off.z)).toBe(-1);
    });
  }
});
