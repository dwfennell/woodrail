import { CylinderGeometry, Group, Mesh, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { LevelCrossing } from "../landscape";
import type { SimSnapshot } from "../sim";
import type { Materials } from "./materials";

const POST_H = 30;
const ARM_LEN = 48;
const STRIPES = 6;
/** Arms come down when any car is this close to the crossing (mm), and go back up once it has passed. */
const NEAR = 260;
/** Radians per second. */
const ARM_SPEED = 3;
const UP = Math.PI / 2;

interface Barrier {
  pivot: Group;
  angle: number;
}

interface Crossing {
  c: LevelCrossing;
  key: string;
  barriers: Barrier[];
  posts: Group[];
}

const keyOf = (c: LevelCrossing) => `${Math.round(c.x)}|${Math.round(c.z)}|${Math.round(c.y)}|${c.gates.map((g) => `${Math.round(g.x)},${Math.round(g.z)}`).join(";")}`;

/** Toy level crossings: a white post with a red lamp and a striped arm on each side, lowered while a train passes. */
export class CrossingsView {
  readonly group = new Group();
  private crossings: Crossing[] = [];
  private readonly post: BufferGeometry;
  private readonly lamp: BufferGeometry;
  private readonly base: BufferGeometry;
  private readonly stripe: BufferGeometry;
  private readonly white: Material;
  private readonly red: Material;
  private readonly wood: Material;

  constructor(mats: Materials) {
    this.post = new CylinderGeometry(2.2, 2.4, POST_H, 12).translate(0, POST_H / 2, 0);
    this.base = new CylinderGeometry(6, 7, 3, 16).translate(0, 1.5, 0);
    this.lamp = new CylinderGeometry(3, 3, 2, 14).rotateX(Math.PI / 2).translate(0, POST_H - 7, 2.6);
    this.stripe = new RoundedBoxGeometry(ARM_LEN / STRIPES, 3.4, 2.6, 1, 0.8);
    this.white = mats.lacquer("#f6f1e6");
    this.red = mats.lacquer("#c8442f");
    this.wood = mats.naturalWood;
  }

  /**
   * The crossings now on the map. Only what changed is rebuilt: a crossing that's still there keeps its posts and its
   * arms just as they are (a change elsewhere, or a switch thrown, doesn't send them back up), new ones are added and
   * gone ones removed.
   */
  setCrossings(list: readonly LevelCrossing[]): void {
    const had = new Map(this.crossings.map((x) => [x.key, x]));
    const next: Crossing[] = [];
    for (const c of list) {
      const key = keyOf(c);
      const kept = had.get(key);
      if (kept) {
        had.delete(key);
        next.push(kept);
      } else next.push(this.build(c, key));
    }
    for (const gone of had.values()) for (const post of gone.posts) this.group.remove(post);
    this.crossings = next;
  }

  private build(c: LevelCrossing, key: string): Crossing {
    const barriers: Barrier[] = [];
    const posts: Group[] = [];
    // A barrier at each gate, its arm reaching across that half of the road.
    for (const gate of c.gates) {
      // The post where the gate is (clear of the track: see `findCrossings`), its arm reaching across the road.
      const post = new Group();
      post.position.set(gate.x, gate.y, gate.z);
      post.add(this.mesh(this.base, this.wood), this.mesh(this.post, this.white));
      const lamp = this.mesh(this.lamp, this.red);
      // Face the lamp toward the track.
      lamp.rotation.y = Math.atan2(gate.dx, gate.dz);
      post.add(lamp);
      const pivot = new Group();
      pivot.position.set(0, POST_H - 3, 0);
      // Local +x along the arm: pointing across the road, toward its middle.
      pivot.rotation.y = -Math.atan2(gate.az, gate.ax);
      pivot.rotation.z = UP;
      for (let k = 0; k < STRIPES; k++) {
        const m = this.mesh(this.stripe, k % 2 ? this.white : this.red);
        m.position.x = 4 + (ARM_LEN / STRIPES) * (k + 0.5);
        pivot.add(m);
      }
      post.add(pivot);
      this.group.add(post);
      posts.push(post);
      barriers.push({ pivot, angle: UP });
    }
    return { c, key, barriers, posts };
  }

  /** Lower the arms where a car is near, raise them elsewhere. */
  /** Raise and lower the barriers for this frame. True while any barrier is moving. */
  update(snap: SimSnapshot, dt: number): boolean {
    let moving = false;
    for (const { c, barriers } of this.crossings) {
      let near = false;
      for (let i = 0; i < snap.count && !near; i++) {
        if (snap.derailed[i]) continue;
        const dx = snap.transforms[i * 6] - c.x;
        const dz = snap.transforms[i * 6 + 2] - c.z;
        near = dx * dx + dz * dz < NEAR * NEAR;
      }
      const target = near ? 0 : UP;
      for (const b of barriers) {
        if (b.angle === target) continue;
        const step = ARM_SPEED * dt;
        b.angle = b.angle < target ? Math.min(target, b.angle + step) : Math.max(target, b.angle - step);
        b.pivot.rotation.z = b.angle;
        moving = true;
      }
    }
    return moving;
  }

  private mesh(g: BufferGeometry, m: Material): Mesh {
    const mesh = new Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private clear(): void {
    this.group.clear();
    this.crossings = [];
  }

  dispose(): void {
    this.clear();
    for (const g of [this.post, this.lamp, this.base, this.stripe]) g.dispose();
  }
}
