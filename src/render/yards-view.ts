import { Group, Mesh, type Object3D } from "three";
import type { YardBuild } from "../economy";
import { berthOf, isYard, LAUNCH_SECONDS, progressOf } from "../game/yards";
import type { Waters } from "../game/boats";
import { modelKey, type PropLibrary } from "./props/library";

/** A yard's hull on its ways, by stage (half built: keel and ribs; then planked), and what slides into the water. */
const STAGES: Record<YardBuild, [string, string, string]> = {
  tug: ["water-tug-frame", "water-tug-planked", "water-river-tug"],
  barge: ["water-tug-frame", "water-tug-planked", "water-barge"],
  ship: ["water-ship-frame", "water-ship-planked", "water-cargo-ship"],
  ferry: ["water-ship-frame", "water-ship-planked", "water-train-ferry"],
};
/** The ways' top (the yards' quay, mm): where a hull being built stands. */
const WAYS_TOP = 12;

interface Shown {
  key: string;
  root: Group;
}

interface Launch {
  depotId: number;
  root: Group;
  start: number;
}

/**
 * The yards (src/game/yards.ts): a hull standing on each building yard's ways, its stage by the goods gone into it (a
 * keel and ribs, then planked), placed only when that changes; and a finished hull sliding sideways down into the
 * water for `LAUNCH_SECONDS` (a flourish: frames only while it slides). Nothing at all while no yard builds.
 */
export class YardsView {
  readonly group = new Group();
  private readonly shown = new Map<number, Shown>();
  private readonly launches: Launch[] = [];
  private readonly models = new Map<string, Promise<Object3D | null>>();

  constructor(
    private readonly library: PropLibrary,
    private readonly invalidate: () => void,
  ) {
    this.group.name = "yards";
  }

  clear(): void {
    this.shown.clear();
    this.launches.length = 0;
    this.group.clear();
  }

  /** A hull just finished at a yard: it slides down into the water. */
  launch(depotId: number, build: YardBuild): void {
    const root = new Group();
    this.group.add(root);
    const l: Launch = { depotId, root, start: performance.now() };
    this.launches.push(l);
    void this.model(STAGES[build][2]).then((m) => {
      if (m) root.add(m.clone());
      this.invalidate();
    });
  }

  /** Each frame: hulls on the ways (placed only when their stage or yard changes), and launches sliding. True while one slides. */
  update(world: Waters, piecesVersion: number): boolean {
    const orders = world.economy.yardOrders;
    if (orders.size === 0 && this.shown.size === 0 && this.launches.length === 0) return false;
    for (const [id, s] of this.shown) {
      if (orders.has(id)) continue;
      this.group.remove(s.root);
      this.shown.delete(id);
      this.invalidate();
    }
    for (const [id, o] of orders) {
      const d = world.economy.depot(id);
      if (!isYard(d)) continue;
      const stage = progressOf(o) < 0.5 ? 0 : 1;
      const key = `${o.build}|${stage}|${piecesVersion}`;
      let s = this.shown.get(id);
      if (s && s.key === key) continue;
      if (s) this.group.remove(s.root);
      s = { key, root: new Group() };
      this.shown.set(id, s);
      this.group.add(s.root);
      const at = berthOf(world, id);
      if (at) {
        s.root.position.set(at.x, WAYS_TOP, at.z);
        s.root.rotation.y = -at.heading;
      }
      const root = s.root;
      void this.model(STAGES[o.build][stage]).then((m) => {
        if (m && this.shown.get(id)?.root === root) root.add(m.clone());
        this.invalidate();
      });
    }
    let sliding = false;
    const now = performance.now();
    for (let i = this.launches.length - 1; i >= 0; i--) {
      const l = this.launches[i];
      const at = berthOf(world, l.depotId);
      const u = Math.min(1, (now - l.start) / 1000 / LAUNCH_SECONDS);
      if (!at || u >= 1) {
        this.group.remove(l.root);
        this.launches.splice(i, 1);
        this.invalidate();
        continue;
      }
      // Slowly off the ways, then faster into the water, settling as it floats.
      const f = u * u;
      l.root.position.set(at.x + (at.out.x - at.x) * f, WAYS_TOP * (1 - f) + 0.6 * f, at.z + (at.out.z - at.z) * f);
      l.root.rotation.set(0, -at.heading, 0);
      sliding = true;
    }
    return sliding;
  }

  private model(asset: string): Promise<Object3D | null> {
    let p = this.models.get(asset);
    if (!p) {
      p = this.library
        .load(modelKey(asset))
        .then((model) => {
          if (!model) return null;
          const g = new Group();
          for (const part of model.parts) {
            const m = new Mesh(part.geometry, part.material);
            m.userData.sharedGeometry = true;
            m.castShadow = true;
            g.add(m);
          }
          return g as Object3D;
        })
        .catch(() => null);
      this.models.set(asset, p);
    }
    return p;
  }
}
