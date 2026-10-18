import { BoxGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, type BufferGeometry, type Material, type Object3D } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CrossingGate, CrossingStyle, StyledCrossing } from "../landscape";
import type { SimSnapshot } from "../sim";
import type { Materials } from "./materials";

const POST_H = 30;
const ARM_LEN = 48;
const STRIPES = 6;
/** Arms come down when any car is this close to the crossing (mm), and go back up once it has passed. */
const NEAR = 260;
/** Radians per second. */
const ARM_SPEED = 3;
/** A gate swings a little slower than an arm drops. */
const GATE_SPEED = 2;
const UP = Math.PI / 2;
/** The level-crossing style's posts are taller, and its booms longer, with a counterweight behind the pivot. */
const BOOM_POST_H = 34;
const BOOM_LEN = 54;
/** The gated style's gates (mm along, from the hinge) and their posts. */
const GATE_LEN = 50;
const GATE_POST_H = 24;
/** Lamps flash at this many changes a second while the booms are down. */
const FLASH = 3;

/**
 * A barrier at one of a crossing's gates: its pivot, and the angle it's at, between `open` (road traffic may pass) and
 * `shut`, about its pivot's z (an arm lowering) or y (a gate swinging).
 */
interface Barrier {
  pivot: Group;
  axis: "y" | "z";
  open: number;
  shut: number;
  angle: number;
  speed: number;
}

interface Crossing {
  c: StyledCrossing;
  key: string;
  barriers: Barrier[];
  posts: Group[];
  /** The level-crossing style's lit lamps: each post's pair, shown in turn while the booms are down. */
  lamps: Mesh[][];
}

const keyOf = (c: StyledCrossing) =>
  `${Math.round(c.x)}|${Math.round(c.z)}|${Math.round(c.y)}|${c.gates.map((g) => `${Math.round(g.x)},${Math.round(g.z)}`).join(";")}|${c.style ?? ""}:${c.styleProp ?? ""}`;

/**
 * Toy level crossings: a white post with a red lamp and a striped arm on each side, lowered while a train passes. A
 * crossing with a style (a crossing prop on it: see `styleCrossings`) draws that style's instead: striped booms with
 * twin lamps that flash while they're down ("barriers"), or white field gates that swing shut across the road
 * ("gates"). Built only when the list changes (`setCrossings`, from the game when track, roads or props change).
 */
export class CrossingsView {
  readonly group = new Group();
  private crossings: Crossing[] = [];
  private readonly post: BufferGeometry;
  private readonly lamp: BufferGeometry;
  private readonly base: BufferGeometry;
  private readonly stripe: BufferGeometry;
  private readonly boomPost: BufferGeometry;
  private readonly boomStripe: BufferGeometry;
  private readonly counterweight: BufferGeometry;
  private readonly lampHead: BufferGeometry;
  private readonly lens: BufferGeometry;
  private readonly gatePost: BufferGeometry;
  private readonly gateCap: BufferGeometry;
  private readonly rail: BufferGeometry;
  private readonly stile: BufferGeometry;
  private readonly brace: BufferGeometry;
  private readonly disc: BufferGeometry;
  private readonly white: Material;
  private readonly red: Material;
  private readonly wood: Material;
  private readonly black: Material;
  private readonly grey: Material;
  private readonly lit: Material;
  /** Seconds the booms have been flashing for (the lamps' phase). */
  private time = 0;

  constructor(mats: Materials) {
    this.post = new CylinderGeometry(2.2, 2.4, POST_H, 12).translate(0, POST_H / 2, 0);
    this.base = new CylinderGeometry(6, 7, 3, 16).translate(0, 1.5, 0);
    this.lamp = new CylinderGeometry(3, 3, 2, 14).rotateX(Math.PI / 2).translate(0, POST_H - 7, 2.6);
    this.stripe = new RoundedBoxGeometry(ARM_LEN / STRIPES, 3.4, 2.6, 1, 0.8);
    this.boomPost = new CylinderGeometry(2.6, 2.8, BOOM_POST_H, 12).translate(0, BOOM_POST_H / 2, 0);
    this.boomStripe = new RoundedBoxGeometry(BOOM_LEN / STRIPES, 3.6, 3, 1, 0.8);
    this.counterweight = new RoundedBoxGeometry(8, 6, 5, 1, 1);
    this.lampHead = new RoundedBoxGeometry(16, 7, 4, 1, 1.2).translate(0, BOOM_POST_H - 9, 0);
    this.lens = new CylinderGeometry(2.2, 2.2, 1.2, 14).rotateX(Math.PI / 2);
    this.gatePost = new CylinderGeometry(2.5, 2.5, GATE_POST_H, 12).translate(0, GATE_POST_H / 2, 0);
    this.gateCap = new SphereGeometry(2.6, 12, 8).translate(0, GATE_POST_H + 1, 0);
    this.rail = new BoxGeometry(GATE_LEN, 3, 2.5).translate(GATE_LEN / 2, 0, 0);
    this.stile = new BoxGeometry(3, 16, 2.5).translate(GATE_LEN - 1.5, 10, 0);
    const braceLen = Math.hypot(GATE_LEN - 4, 11);
    this.brace = new BoxGeometry(braceLen, 2, 2).rotateZ(Math.atan2(11, GATE_LEN - 4)).translate(GATE_LEN / 2, 10.5, 0);
    this.disc = new CylinderGeometry(4, 4, 3, 16).rotateX(Math.PI / 2).translate(GATE_LEN / 2, 10, 0);
    this.white = mats.lacquer("#f6f1e6");
    this.red = mats.lacquer("#c8442f");
    this.wood = mats.naturalWood;
    this.black = mats.lacquer("#2a2a2a");
    this.grey = mats.lacquer("#8c8c8c");
    this.lit = mats.lacquer("#ff4a2e");
  }

  /**
   * The crossings now on the map, with their styles. Only what changed is rebuilt: a crossing that's still there (with
   * the same style) keeps its posts and its arms just as they are (a change elsewhere, or a switch thrown, doesn't send
   * them back up), new ones are added and gone ones removed.
   */
  setCrossings(list: readonly StyledCrossing[]): void {
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

  /** The crossing prop (its id) whose style a raycast hit, or −1 (an unstyled crossing's posts, or anything else). */
  propAt(object: Object3D): number {
    for (let o: Object3D | null = object; o && o !== this.group; o = o.parent) if (typeof o.userData.crossingProp === "number") return o.userData.crossingProp as number;
    return -1;
  }

  private build(c: StyledCrossing, key: string): Crossing {
    const out: Crossing = { c, key, barriers: [], posts: [], lamps: [] };
    // A barrier at each gate, its arm (or gate) reaching across that half of the road.
    for (const gate of c.gates) {
      // The post where the gate is (clear of the track: see `findCrossings`).
      const post = new Group();
      post.position.set(gate.x, gate.y, gate.z);
      if (c.styleProp !== undefined) post.userData.crossingProp = c.styleProp;
      this.buildPost(post, gate, c.style, out);
      this.group.add(post);
      out.posts.push(post);
    }
    return out;
  }

  private buildPost(post: Group, gate: CrossingGate, style: CrossingStyle | undefined, out: Crossing): void {
    // Local +x along an arm or gate shut: pointing across the road, toward its middle.
    const across = -Math.atan2(gate.az, gate.ax);
    // Facing the track.
    const facing = Math.atan2(gate.dx, gate.dz);
    if (style === "gates") {
      post.add(this.mesh(this.gatePost, this.black), this.mesh(this.gateCap, this.white));
      const pivot = new Group();
      for (const g of [this.rail, this.rail, this.stile, this.brace]) pivot.add(this.mesh(g, this.white));
      pivot.children[0].position.y = 4;
      pivot.children[1].position.y = 16;
      pivot.add(this.mesh(this.disc, this.red));
      // Open: swung back along the roadside, away from the crossing (a quarter turn from across the road).
      const open = -Math.atan2(-gate.dz, -gate.dx);
      // The short way round from open to shut.
      const shut = open + normalise(across - open);
      pivot.rotation.y = open;
      post.add(pivot);
      out.barriers.push({ pivot, axis: "y", open, shut, angle: open, speed: GATE_SPEED });
      return;
    }
    if (style === "barriers") {
      post.add(this.mesh(this.base, this.black), this.mesh(this.boomPost, this.white));
      // The lamp head across the post, facing the track: two dark lenses, and lit ones over them that flash.
      const head = new Group();
      head.rotation.y = facing;
      head.add(this.mesh(this.lampHead, this.black));
      const lit: Mesh[] = [];
      for (const side of [-4.5, 4.5]) {
        const dark = this.mesh(this.lens, this.red);
        dark.position.set(side, BOOM_POST_H - 9, 2.4);
        const on = this.mesh(this.lens, this.lit);
        on.position.set(side, BOOM_POST_H - 9, 2.7);
        on.scale.set(1.08, 1.08, 1);
        on.visible = false;
        on.userData.lit = true;
        head.add(dark, on);
        lit.push(on);
      }
      post.add(head);
      out.lamps.push(lit);
      const pivot = new Group();
      pivot.position.set(0, BOOM_POST_H - 3, 0);
      pivot.rotation.y = across;
      pivot.rotation.z = UP;
      for (let k = 0; k < STRIPES; k++) {
        const m = this.mesh(this.boomStripe, k % 2 ? this.white : this.red);
        m.position.x = 4 + (BOOM_LEN / STRIPES) * (k + 0.5);
        pivot.add(m);
      }
      const weight = this.mesh(this.counterweight, this.grey);
      weight.position.x = -5;
      pivot.add(weight);
      post.add(pivot);
      out.barriers.push({ pivot, axis: "z", open: UP, shut: 0, angle: UP, speed: ARM_SPEED });
      return;
    }
    post.add(this.mesh(this.base, this.wood), this.mesh(this.post, this.white));
    const lamp = this.mesh(this.lamp, this.red);
    lamp.rotation.y = facing;
    post.add(lamp);
    const pivot = new Group();
    pivot.position.set(0, POST_H - 3, 0);
    pivot.rotation.y = across;
    pivot.rotation.z = UP;
    for (let k = 0; k < STRIPES; k++) {
      const m = this.mesh(this.stripe, k % 2 ? this.white : this.red);
      m.position.x = 4 + (ARM_LEN / STRIPES) * (k + 0.5);
      pivot.add(m);
    }
    post.add(pivot);
    out.barriers.push({ pivot, axis: "z", open: UP, shut: 0, angle: UP, speed: ARM_SPEED });
  }

  /**
   * Raise and lower the barriers (swing the gates) for this frame. True while any barrier is moving. A styled
   * crossing's lamps flash while its booms are down; they change only on frames already being drawn for the train
   * (they don't keep the view drawing on their own).
   */
  update(snap: SimSnapshot, dt: number): boolean {
    let moving = false;
    this.time += dt;
    const blink = Math.floor(this.time * FLASH) % 2;
    for (const { c, barriers, lamps } of this.crossings) {
      let near = false;
      for (let i = 0; i < snap.count && !near; i++) {
        if (snap.derailed[i]) continue;
        const dx = snap.transforms[i * 6] - c.x;
        const dz = snap.transforms[i * 6 + 2] - c.z;
        near = dx * dx + dz * dz < NEAR * NEAR;
      }
      for (const b of barriers) {
        const target = near ? b.shut : b.open;
        if (b.angle === target) continue;
        const step = b.speed * dt;
        b.angle = b.angle < target ? Math.min(target, b.angle + step) : Math.max(target, b.angle - step);
        if (b.axis === "z") b.pivot.rotation.z = b.angle;
        else b.pivot.rotation.y = b.angle;
        moving = true;
      }
      if (lamps.length === 0) continue;
      const down = barriers.some((b) => b.angle !== b.open);
      for (const pair of lamps)
        for (let k = 0; k < pair.length; k++) {
          const on = down && k === blink;
          if (pair[k].visible !== on) pair[k].visible = on;
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
    for (const g of [this.post, this.lamp, this.base, this.stripe, this.boomPost, this.boomStripe, this.counterweight, this.lampHead, this.lens, this.gatePost, this.gateCap, this.rail, this.stile, this.brace, this.disc]) g.dispose();
  }
}

/** An angle brought into (−π, π]. */
function normalise(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}
