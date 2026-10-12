import { BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, type InstancedMesh, type MeshBasicMaterial } from "three";
import { CELL, COLS, generateSurroundings, ROWS, SURF_LANE, SURF_RIVER, SURF_ROAD, TreeClearance, type HeldPiece, type Landscape, type Town, type TreeSpot } from "../landscape";
import type { Layout } from "../track";
import { SIGN_HEIGHT, SIGN_THICKNESS, SIGN_WIDTH, SIGN_Y, signPose, STATION_ROOF_TOP } from "../landscape/sign";
import { Batcher } from "./dressing/batcher";
import { buildBlocks } from "./dressing/blocks";
import { buildShed, buildStation, buildTown } from "./dressing/buildings";
import { buildContactShadows, type Footprint } from "./dressing/contact";
import { buildFeltGround, buildFeltRibbons } from "./dressing/felt";
import { buildSurroundings } from "./dressing/surroundings";
import { buildTrees, treePlacements, type PlaceTrees, type TreeAt, type TreePlacement } from "./dressing/trees";
import { easeInOutCubic, easeOutBack } from "../lib/tween";
import { buildField } from "./dressing/fields";
import type { Flourish } from "./flourishes";
import type { Materials } from "./materials";

/** A tree stepping aside takes this long (s) to hop, this high (mm); each sets off a little after the last. */
const TREE_HOP_TIME = 0.42;
const TREE_HOP_HEIGHT = 26;
const TREE_HOP_STAGGER = 0.05;
const TREE_HOP_SPREAD = 0.3;

/** How brightly an unconnected name board lights itself (connected ones glow warm). */
const SIGN_SELF_LIGHT = 0.3;

/** Draws the felt mat and everything on it (block hills, rivers, roads, trees, towns, stations, name signs) and the scenery around it. */
const POST_RADIUS = 2.4;
const RAIL_H = 3;

export class LandscapeView {
  readonly group = new Group();
  private signs = new Map<number, MeshStandardMaterial>();
  private readonly signNames = new Map<number, string>();
  private connected = new Set<number>();
  private placeTrees: PlaceTrees = () => {};
  private clearance!: TreeClearance;
  /** A piece held over the mat, that trees are keeping clear of. */
  private held: HeldPiece | null = null;
  /** Each tree as drawn, where its hop started and where it's going, and how far along it is (≥ 1: there). */
  private treeAnim = { shown: [] as Required<TreeAt>[], from: [] as Required<TreeAt>[], to: [] as Required<TreeAt>[], progress: new Float32Array(0) };
  /** The animation moving trees, while any are on the move. */
  private treeHop: Flourish | null = null;

  constructor(
    private readonly land: Landscape,
    private readonly mats: Materials,
    /** Draw soft blob shadows under scenery (for devices without ambient occlusion). */
    private readonly contactShadows = false,
  ) {
    this.build();
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      // Instanced meshes hold per-instance buffers that only their own dispose() frees.
      if ((m as InstancedMesh).isInstancedMesh) (m as InstancedMesh).dispose();
      // Materials made just for this view (shared ones from Materials are kept).
      if (m.userData.ownsMaterial) {
        const mat = m.material as MeshBasicMaterial;
        mat.alphaMap?.dispose();
        mat.dispose();
      }
    });
    for (const m of this.signs.values()) {
      m.map?.dispose();
      m.dispose();
    }
  }

  /** A bright pulse on these towns' signs (a celebration when they're connected). */
  flash(towns: readonly number[]): Flourish {
    const ids = towns.filter((id) => this.signs.has(id));
    let t = 0;
    return {
      update: (dt) => {
        t += dt;
        const k = Math.max(0, Math.sin((t / 1.2) * Math.PI * 3)) * (1 - t / 1.2);
        for (const id of ids) {
          const m = this.signs.get(id)!;
          m.emissive.set("#ffcf6b");
          m.emissiveIntensity = (this.connected.has(id) ? 0.55 : SIGN_SELF_LIGHT) + k * 1.4;
        }
        return t < 1.2;
      },
      // Settle on whatever the sign should show now: the connection may have been undone mid-flash.
      dispose: () => this.setConnected(this.connected),
    };
  }

  /**
   * Trees step aside from track (see `treesAside`); call after the layout changes. With `animate`, the trees that
   * move hop there: returns the animation to run, if one has to start.
   */
  syncTrees(layout: Layout, animate = false): Flourish | null {
    this.clearance.setLayout(layout);
    return this.retarget(this.clearance.spots(this.held ?? undefined), animate);
  }

  /** Trees hop aside for a piece held over the mat, and back when it moves on (null: nothing held). */
  previewTrees(held: HeldPiece | null): Flourish | null {
    this.held = held;
    return this.retarget(this.clearance.spots(held ?? undefined), true);
  }

  /** Stop keeping clear of a held piece, without moving any trees yet (the next sync does). */
  forgetHeld(): void {
    this.held = null;
  }

  /** Send each tree whose spot changed toward it (hopping, shrinking away or springing up). */
  private retarget(spots: readonly (TreeSpot | null)[], animate: boolean): Flourish | null {
    const a = this.treeAnim;
    let started = 0;
    spots.forEach((spot, i) => {
      const shown = a.shown[i];
      const goal = spot ? { x: spot.x, z: spot.z, y: spot.y, s: 1 } : { x: a.to[i].x, z: a.to[i].z, y: a.to[i].y, s: 0 };
      const to = a.to[i];
      if (to.x === goal.x && to.z === goal.z && to.s === goal.s) return;
      if (!animate) {
        Object.assign(shown, goal);
        Object.assign(to, goal);
        a.progress[i] = 1;
        return;
      }
      Object.assign(a.from[i], shown);
      Object.assign(to, goal);
      // Each tree sets off a moment after the last, so they scatter rather than move as one.
      a.progress[i] = -Math.min(TREE_HOP_STAGGER * started++, TREE_HOP_SPREAD) / TREE_HOP_TIME;
    });
    if (!animate || started === 0) {
      if (!this.treeHop) this.placeTrees(a.shown);
      return null;
    }
    if (this.treeHop) return null;
    const hop: Flourish = {
      update: (dt) => {
        let running = false;
        for (let i = 0; i < a.shown.length; i++) {
          if (a.progress[i] >= 1) continue;
          a.progress[i] = Math.min(1, a.progress[i] + dt / TREE_HOP_TIME);
          const p = Math.max(0, a.progress[i]);
          if (p < 1) running = true;
          const from = a.from[i];
          const to = a.to[i];
          const shown = a.shown[i];
          const e = easeInOutCubic(p);
          const moving = Math.hypot(to.x - from.x, to.z - from.z) > 1;
          // A hop: across in an arc, with a little squash on landing; or shrinking away, or springing up.
          shown.x = from.x + (to.x - from.x) * e;
          shown.z = from.z + (to.z - from.z) * e;
          shown.y = from.y + (to.y - from.y) * e + (moving ? 4 * TREE_HOP_HEIGHT * p * (1 - p) : 0);
          const grow = to.s > from.s ? easeOutBack(p) : e;
          shown.s = (from.s + (to.s - from.s) * grow) * (moving ? 1 - 0.12 * Math.sin(Math.PI * p) : 1);
        }
        this.placeTrees(a.shown);
        return running;
      },
      dispose: () => {
        // Finished, or cut short: every tree where it's going.
        for (let i = 0; i < a.shown.length; i++) {
          Object.assign(a.shown[i], a.to[i]);
          a.progress[i] = 1;
        }
        this.placeTrees(a.shown);
        if (this.treeHop === hop) this.treeHop = null;
      },
    };
    this.treeHop = hop;
    return hop;
  }

  /** Light the signs of connected towns. */
  setConnected(towns: ReadonlySet<number>): void {
    this.connected = new Set(towns);
    for (const [id, m] of this.signs) {
      const on = towns.has(id);
      // Unconnected boards still carry a little light of their own, so the name reads on the shady side.
      m.emissive.set(on ? "#ffcf6b" : "#ffffff");
      m.emissiveIntensity = on ? 0.55 : SIGN_SELF_LIGHT;
    }
  }

  private build(): void {
    const { grid } = this.land;
    const b = new Batcher(this.mats.paint);

    // The felt ground, and felt rivers and roads laid on it.
    this.group.add(buildFeltGround(this.mats));
    const river = buildFeltRibbons(grid, SURF_RIVER, this.mats.riverFelt, 1.6);
    const road = buildFeltRibbons(grid, SURF_ROAD, this.mats.roadFelt, 1.1);
    const lane = buildFeltRibbons(grid, SURF_LANE, this.mats.roadFelt, 1.1);
    if (river) this.group.add(river);
    if (road) this.group.add(road);
    if (lane) this.group.add(lane);

    // Hills: stacks of individual wooden blocks, painted green on top.
    this.group.add(buildBlocks(grid, this.land.seed, this.mats));

    // Turned-wood toy trees, standing on whatever block they grew on.
    const trees = treePlacements(this.land);
    this.clearance = new TreeClearance(this.land.grid, trees);
    const spot = (t: TreePlacement): Required<TreeAt> => ({ x: t.x, z: t.z, y: t.y, s: 1 });
    this.treeAnim = { shown: trees.map(spot), from: trees.map(spot), to: trees.map(spot), progress: new Float32Array(trees.length).fill(1) };
    const treeGroup = buildTrees(trees, this.mats);
    this.placeTrees = treeGroup.userData.place as PlaceTrees;
    this.group.add(treeGroup);
    const prints: Footprint[] = trees.map((t) => ({ x: t.x, z: t.z, y: t.y, rx: 24 * t.scale, rz: 24 * t.scale, heading: 0, strength: 1 }));

    for (const town of this.land.towns) {
      for (const h of buildTown(this.land, town, this.mats, b)) prints.push({ x: h.cx, z: h.cz, y: 0, rx: h.w / 2 + 12, rz: h.d / 2 + 12, heading: 0, strength: 1 });
      buildStation(town, this.mats, b);
      this.buildSign(town, b);
    }

    // Fenced paddocks of toy animals.
    for (const field of this.land.fields) buildField(this.land, field, this.mats, b);
    if (this.land.shed) buildShed(this.land, this.land.shed, this.mats, b);

    // The toy countryside around the mat, fading into the haze.
    this.group.add(buildSurroundings(generateSurroundings(this.land.seed), this.mats));

    b.build(this.group);

    if (this.contactShadows) {
      // Hill edges: a blob under each ground-level block that has open felt beside it.
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          if (grid.height[grid.index(col, row)] === 0) continue;
          const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => grid.inBounds(col + dc, row + dr) && grid.height[grid.index(col + dc, row + dr)] === 0);
          if (open) prints.push({ x: grid.centreX(col), z: grid.centreZ(row), y: 0, rx: CELL * 0.66, rz: CELL * 0.66, heading: 0, strength: 0.9 });
        }
      }
      this.group.add(buildContactShadows(prints));
    }
  }

  /** Name board on two posts on the station house roof; glows when the town is connected. */
  private buildSign(town: Town, b: Batcher): void {
    const pose = signPose(town);
    const sign = this.makeSign(town.name);
    this.signNames.set(town.id, town.name);
    const board = new Mesh(new BoxGeometry(SIGN_WIDTH, SIGN_HEIGHT, SIGN_THICKNESS), [this.mats.blockWood, this.mats.blockWood, this.mats.blockWood, this.mats.blockWood, sign, sign]);
    board.rotation.y = -pose.heading;
    board.position.set(pose.x, SIGN_Y, pose.z);
    board.castShadow = true;
    this.group.add(board);
    const dx = Math.cos(pose.heading);
    const dz = Math.sin(pose.heading);
    // The board sits on a rail carried by two short posts, so nothing crosses the lettering on either face.
    const bottom = SIGN_Y - SIGN_HEIGHT / 2;
    const postH = bottom - RAIL_H - STATION_ROOF_TOP;
    for (const off of [-28, 28]) {
      const post = new CylinderGeometry(POST_RADIUS, POST_RADIUS, postH, 10);
      post.translate(pose.x + dx * off, STATION_ROOF_TOP + postH / 2, pose.z + dz * off);
      b.add(this.mats.naturalWood, post);
    }
    const rail = new BoxGeometry(SIGN_WIDTH * 0.75, RAIL_H, SIGN_THICKNESS + 3);
    rail.rotateY(-pose.heading);
    rail.translate(pose.x, bottom - RAIL_H / 2, pose.z);
    b.add(this.mats.naturalWood, rail);
    this.signs.set(town.id, sign);
  }

  /** Show how many plank bundles have reached a town, on its sign (from the first one on). */
  setDelivered(townId: number, count: number): void {
    const m = this.signs.get(townId);
    const name = this.signNames.get(townId);
    if (!m || !name || !(m.map instanceof CanvasTexture)) return;
    drawSign(m.map.image as HTMLCanvasElement, name, count);
    m.map.needsUpdate = true;
  }

  private makeSign(name: string): MeshStandardMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    drawSign(canvas, name, 0);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    return new MeshStandardMaterial({ map: tex, roughness: 0.6, emissiveMap: tex, emissive: new Color("#ffffff"), emissiveIntensity: SIGN_SELF_LIGHT });
  }


}


/** Paint a town's name board: its name, and once planks have arrived, a little plank-bundle badge with the count. */
function drawSign(canvas: HTMLCanvasElement, name: string, delivered: number): void {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2f5d3a";
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = "#f3e3c3";
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 492, 108);
  ctx.fillStyle = "#f8efdc";
  ctx.font = "800 64px Nunito, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (delivered <= 0) {
    ctx.fillText(name, 256, 68, 470);
    return;
  }
  ctx.fillText(name, 196, 68, 340);
  // Badge: three stacked planks with a red strap, and the count.
  const x = 384;
  ctx.fillStyle = "#e3bf8c";
  for (let k = 0; k < 3; k++) ctx.fillRect(x, 40 + k * 16, 44, 12);
  ctx.fillStyle = "#c8442f";
  ctx.fillRect(x + 18, 36, 8, 52);
  ctx.fillStyle = "#f8efdc";
  ctx.font = "800 44px Nunito, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(String(delivered), x + 54, 68, 70);
}
