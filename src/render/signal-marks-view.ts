/**
 * Signal marks on joints (docs/superpowers/specs/2026-10-31-signals.md §4, §5): a post on the driver's right of each
 * mark, its head red or green as the sim shows it. Drawn instanced (one draw for the posts, one for the heads), worked
 * out again only when the marks, the track or an aspect changed (`sync` returns true then: the caller redraws). And the
 * block tint shown while a signal is held or its card is open: one mesh, built when its joint changes.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, Vector3, type Camera, type Material } from "three";
import { createSample, getPieceDef, pathLength, pieceOfRef, samplePath, type Layout } from "../track";
import { postAt, type Block } from "../game/signal-place";
import type { Materials } from "./materials";

const POST_H = 46;
const RED = new Color("#d8382c");
const GREEN = new Color("#39b04a");
const HELD = new Color("#a01c14");

/** What the view reads of the sim: each mark's aspect (true: clear). */
export interface MarkAspects {
  markClear(id: number): boolean;
  readonly signalsVersion: number;
}

export class SignalMarksView {
  readonly group = new Group();
  private posts: InstancedMesh;
  private heads: InstancedMesh;
  private capacity = 0;
  private readonly postGeom = new CylinderGeometry(2.2, 2.8, POST_H, 8).translate(0, POST_H / 2, 0);
  private readonly headGeom = new BoxGeometry(8, 11, 6).translate(0, POST_H + 3, 0);
  private readonly postMat: Material;
  private readonly headMat: Material;
  /** Marks drawn, in instance order: id, and where the post's top is (for picking). */
  private shown: { id: number; x: number; y: number; z: number }[] = [];
  private key = "";
  /** A mark not drawn (picked up, in the hand). */
  hidden = -1;

  constructor(
    private layout: Layout,
    private readonly sim: MarkAspects,
    mats: Materials,
  ) {
    this.postMat = mats.lacquer("#f6f1e6");
    this.headMat = mats.lacquer("#ffffff");
    this.posts = this.make(this.postGeom, this.postMat, true);
    this.heads = this.make(this.headGeom, this.headMat, false);
  }

  private make(geom: BufferGeometry, mat: Material, shadow: boolean): InstancedMesh {
    const m = new InstancedMesh(geom, mat, Math.max(1, this.capacity));
    m.count = 0;
    m.castShadow = shadow;
    m.frustumCulled = false;
    m.userData = { kind: "signal-mark" };
    this.group.add(m);
    return m;
  }

  setLayout(layout: Layout): void {
    this.layout = layout;
    this.key = "";
  }

  /** Bring the drawing up to date; true if anything changed (redraw). Cheap when nothing did: a string compare. */
  sync(): boolean {
    const L = this.layout;
    const key = `${L.signalsVersion}:${L.revision}:${this.sim.signalsVersion}:${this.hidden}:${L.signalCount}`;
    if (key === this.key) return false;
    this.key = key;
    const marks = [...L.signals()].filter((m) => m.id !== this.hidden && !L.isLifted(pieceOfRef(m.at)));
    if (marks.length > this.capacity) {
      this.capacity = Math.max(8, marks.length * 2);
      this.group.remove(this.posts, this.heads);
      this.posts.dispose();
      this.heads.dispose();
      this.posts = this.make(this.postGeom, this.postMat, true);
      this.heads = this.make(this.headGeom, this.headMat, false);
    }
    const m4 = new Matrix4();
    this.shown = [];
    let n = 0;
    for (const m of marks) {
      const p = postAt(L, m.at);
      if (!p) continue;
      m4.makeRotationY(-p.heading).setPosition(p.px, p.y, p.pz);
      this.posts.setMatrixAt(n, m4);
      this.heads.setMatrixAt(n, m4);
      this.heads.setColorAt(n, m.held ? HELD : this.sim.markClear(m.id) ? GREEN : RED);
      this.shown.push({ id: m.id, x: p.px, y: p.y + POST_H, z: p.pz });
      n++;
    }
    this.posts.count = n;
    this.heads.count = n;
    this.posts.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
    return true;
  }

  /** The mark nearest a screen point (CSS px) within `slack` px of its post (top to foot), or −1. */
  pick(x: number, y: number, camera: Camera, width: number, height: number, slack: number): number {
    let best = -1;
    let bestD = slack;
    const v = new Vector3();
    for (const s of this.shown) {
      // (The post from foot to top: the nearest point of that segment on screen.)
      for (const h of [0, 0.5, 1]) {
        v.set(s.x, s.y - POST_H * (1 - h), s.z).project(camera);
        if (v.z > 1) continue;
        const d = Math.hypot((v.x * 0.5 + 0.5) * width - x, (-v.y * 0.5 + 0.5) * height - y);
        if (d < bestD) {
          bestD = d;
          best = s.id;
        }
      }
    }
    return best;
  }

  /** Where a drawn mark's post top is (world), for tests and cards; null if it isn't drawn. */
  topOf(id: number): { x: number; y: number; z: number } | null {
    return this.shown.find((s) => s.id === id) ?? null;
  }

  dispose(): void {
    this.posts.dispose();
    this.heads.dispose();
  }
}

/** A mark in the hand: its post and head, and an arrow on the track the way it guards. */
export function markGhost(mats: Materials): Group {
  const g = new Group();
  g.add(new Mesh(new CylinderGeometry(2.2, 2.8, POST_H, 8).translate(0, POST_H / 2, 0), mats.lacquer("#f6f1e6")));
  const head = new Mesh(new BoxGeometry(8, 11, 6).translate(0, POST_H + 3, 0), mats.lacquer("#39b04a"));
  g.add(head);
  // (The arrow lies on the track, pointing the way trains it guards go: local +x, set by `placeGhost`.)
  const arrow = new Mesh(new ConeGeometry(9, 22, 3).rotateZ(-Math.PI / 2), new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthTest: false }));
  arrow.name = "arrow";
  arrow.renderOrder = 3;
  g.add(arrow);
  return g;
}

/** Stand a mark's ghost at a joint end (its post on the right of the way it guards, the arrow on the track). */
export function placeGhost(ghost: Object3D, layout: Layout, at: number): boolean {
  const p = postAt(layout, at);
  if (!p) return false;
  ghost.position.set(p.px, p.y, p.pz);
  ghost.rotation.set(0, -p.heading, 0);
  const arrow = ghost.getObjectByName("arrow");
  // (Back over the track's centre, a little before the joint, in the ghost's own frame: x along, z right.)
  if (arrow) arrow.position.set(-22, 6, -26);
  return true;
}

const tintSample = createSample();
const AHEAD = new Color("#3fcf5a");
const BEHIND = new Color("#4a8ff0");

/**
 * The tint over a signal's blocks: the one it guards green, the one it ends blue (signals spec §4). One mesh, its
 * geometry built when `show` is given another joint (or the track changed), dropped by `hide`.
 */
export class BlockTint {
  readonly mesh: Mesh;
  private key = "";

  constructor() {
    this.mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide }));
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.userData = { kind: "block-tint" };
  }

  /** Show the tint for these blocks, `key` naming them (the same key: nothing rebuilt). */
  show(layout: Layout, key: string, of: () => { ahead: Block; behind: Block }): void {
    this.mesh.visible = true;
    if (key === this.key) return;
    this.key = key;
    const blocks = of();
    const pos: number[] = [];
    const col: number[] = [];
    const strip = (block: Block, c: Color) => {
      for (const [id, bits] of block) {
        const p = layout.getPiece(id);
        if (!p || layout.isLifted(id)) continue;
        const def = getPieceDef(p.type, p.flipped);
        const ch = Math.cos(p.pose.heading);
        const sh = Math.sin(p.pose.heading);
        def.paths.forEach((path, i) => {
          if (((bits >> i) & 1) === 0) return;
          const len = pathLength(path.geom);
          const n = Math.max(2, Math.ceil(len / 12));
          let prev: number[] | null = null;
          for (let k = 0; k <= n; k++) {
            samplePath(path.geom, (len * k) / n, tintSample);
            // (Across the track: ±16 mm either side of the centre line.)
            const nx = -Math.sin(tintSample.heading) * 16;
            const nz = Math.cos(tintSample.heading) * 16;
            const lx = [tintSample.x - nx, tintSample.x + nx];
            const lz = [tintSample.z - nz, tintSample.z + nz];
            const y = p.y + tintSample.y + 3.5;
            const w = [0, 1].map((j) => [p.pose.x + lx[j] * ch - lz[j] * sh, y, p.pose.z + lx[j] * sh + lz[j] * ch]);
            const cur = [...w[0], ...w[1]];
            if (prev) {
              const [a, b, c2, d] = [prev.slice(0, 3), prev.slice(3), cur.slice(0, 3), cur.slice(3)];
              pos.push(...a, ...b, ...c2, ...b, ...d, ...c2);
              for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
            }
            prev = cur;
          }
        });
      }
    };
    strip(blocks.behind, BEHIND);
    strip(blocks.ahead, AHEAD);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }

  /** Hide it (the key is kept: shown again for the same joint, nothing is rebuilt). */
  hide(): boolean {
    const was = this.mesh.visible;
    this.mesh.visible = false;
    return was;
  }

  /** Forget the built tint (the track changed under it). */
  reset(): void {
    this.key = "";
  }
}
