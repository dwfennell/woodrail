import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type InstancedMesh,
} from "three";
import {
  CELL,
  FEAT_TREE,
  forEachInPlot,
  generateSurroundings,
  hashInts,
  plotKey,
  heldCut,
  hillsOf,
  plotOfCol,
  plotOfRow,
  PLOT_CELLS,
  PLOT_COLS,
  PLOT_DEPTH,
  PLOT_ROWS,
  PLOT_WIDTH,
  plotSlabs,
  SURF_LANE,
  SURF_RIVER,
  SURF_ROAD,
  TreeClearance,
  extentOf,
  type HeldPiece,
  type Landscape,
  type OuterBlock,
  type OuterHouse,
  type OuterTree,
  type PlotCoord,
  type Rect,
  type Surroundings,
  type Town,
  type TreeSpot,
} from "../landscape";
import { RISER_HEIGHT } from "../track";
import type { Layout } from "../track";
import { SIGN_HEIGHT, SIGN_THICKNESS, SIGN_WIDTH, SIGN_Y, signPose, STATION_ROOF_TOP } from "../landscape/sign";
import { Batcher } from "./dressing/batcher";
import { buildBlocks, type BlockInstanceRef } from "./dressing/blocks";
import { HillCutsView } from "./dressing/hill-cuts";
import { buildShed, buildStation, buildTown } from "./dressing/buildings";
import { buildContactShadows, type Footprint } from "./dressing/contact";
import { buildFeltGround, buildFeltRibbons, type FeltCache } from "./dressing/felt";
import { buildScenery, disposeSceneryPart, sceneryPart, type SceneryPart } from "./dressing/surroundings";
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

/** How far (mm) the land shown around the world reaches past its last plot, before the far scenery takes over. */
const AROUND_MARGIN = 0;

/** Land shown around the world: a plot not (yet) in it, and what it would bring. */
export interface AroundPlot {
  px: number;
  pz: number;
  land: Landscape;
}

/**
 * Draws the land and everything on it (block hills, rivers, roads, trees, towns, stations, name signs), plot by plot,
 * and the scenery around it: the land of the plots around (as it would be if bought), then toy countryside into the
 * haze. When plots are added (`addPlots`), only they, and the plots beside them whose blocks change, are built; the
 * felt, the trees and the scenery around (cheap, and laid across plots) are built again.
 */
const POST_RADIUS = 2.4;
const RAIL_H = 3;

export class LandscapeView {
  readonly group = new Group();
  /** Per plot (by slot): its blocks, buildings and the like. */
  private readonly plotGroups = new Map<number, Group>();
  /** Per plot: the corners of the blocks round its edge, which change when a plot beside it is added. */
  private readonly edgeCorners = new Map<number, string>();
  /** The felt ground, its hem and the felt rivers, roads and lanes (laid across plots). */
  private feltGroup = new Group();
  private treeGroup = new Group();
  /** The land around (as it would be), and the scenery beyond. */
  private aroundGroup = new Group();
  private around: AroundPlot[] = [];
  /** The land around, made ready to draw, by plot (see `prepareAround`). */
  private readonly aroundParts = new Map<number, SceneryPart>();
  /** The countryside beyond, made ready to draw, and the rectangle it's around. */
  private backdrop: { key: string; part: SceneryPart } | null = null;
  /** Felt already extruded, by outline (see `buildFeltRibbons`). */
  private readonly feltCaches: Record<"river" | "road" | "lane", FeltCache> = { river: new Map(), road: new Map(), lane: new Map() };
  /** The markers on plots for sale, while choosing one. */
  private saleGroup = new Group();
  private readonly blockIndex = new Map<string, BlockInstanceRef[]>();
  private signs = new Map<number, MeshStandardMaterial>();
  private readonly signNames = new Map<number, string>();
  private connected = new Set<number>();
  private placeTrees: PlaceTrees = () => {};
  private clearance!: TreeClearance;
  /** Hill blocks cut by ramps' cuttings. */
  private cuts!: HillCutsView;
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

  /** The rectangle of the land (its plots' bounding box, world mm). */
  get landRect(): Rect {
    return this.land.grid.extent();
  }

  dispose(): void {
    disposeTree(this.group);
    for (const p of this.aroundParts.values()) disposeSceneryPart(p);
    if (this.backdrop) disposeSceneryPart(this.backdrop.part);
    for (const cache of Object.values(this.feltCaches)) for (const g of cache.values()) g.dispose();
    for (const m of this.signs.values()) {
      m.map?.dispose();
      m.dispose();
    }
  }

  private build(): void {
    const g = this.land.grid;
    this.group.add(this.feltGroup, this.treeGroup, this.aroundGroup, this.saleGroup);
    g.plots.forEach((_, slot) => this.buildPlot(slot));
    this.cuts = new HillCutsView(g, { wood: this.mats.blockWood, top: this.mats.blockTop }, this.blockIndex);
    this.group.add(this.cuts.group);
    this.buildFelt();
    this.buildTrees();
    this.buildAround(true);
  }

  /**
   * Plots have been added to the land (by slot): build them, and again the plots beside them whose edge blocks
   * changed (their corners, which round off against open land, now meet the new plot).
   */
  addPlots(slots: readonly number[], around: readonly AroundPlot[]): void {
    const g = this.land.grid;
    const rebuilt = new Set(slots);
    for (const slot of slots) {
      const { px, pz } = g.plots[slot];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = g.slotOf(px + dx, pz + dz);
        if (n !== -1 && !rebuilt.has(n) && this.edgeCorners.get(n) !== edgeCornerKey(this.land, n)) rebuilt.add(n);
      }
    }
    for (const slot of rebuilt) this.buildPlot(slot);
    this.cuts.plotsRebuilt([...rebuilt]);
    this.around = around.filter((a) => !g.hasPlot(a.px, a.pz));
    this.buildFelt();
    this.buildTrees();
    // The countryside beyond stays as it is for now: the land around isn't all ready yet (see `setAround`).
    this.buildAround(false);
    this.syncTrees(this.layout ?? null);
  }

  /** Show this land around the world (plots not in it), with the scenery beyond. */
  setAround(around: readonly AroundPlot[]): void {
    this.around = around.filter((a) => !this.land.grid.hasPlot(a.px, a.pz));
    this.buildFelt();
    this.buildAround(true);
  }

  /**
   * Make a plot of land around ready to draw (the slow part: its houses), ahead of `setAround`, so that's quick. Call
   * between frames, a plot at a time.
   */
  prepareAround(a: AroundPlot): void {
    const key = plotKey(a.px, a.pz);
    if (!this.aroundParts.has(key)) this.aroundParts.set(key, sceneryPart(aroundScenery([a], this.land.seed), this.mats, key, true));
  }

  /** Is this plot of land around ready to draw (see `prepareAround`)? */
  aroundReady(px: number, pz: number): boolean {
    return this.aroundParts.has(plotKey(px, pz));
  }

  /** Make the countryside beyond this land around ready to draw, ahead of `setAround`. */
  prepareBackdrop(around: readonly PlotCoord[]): void {
    const shown = extentOf([...this.land.grid.plots, ...around]);
    const margin = around.length > 0 ? AROUND_MARGIN : undefined;
    const key = `${shown.x0},${shown.z0},${shown.x1},${shown.z1},${margin}`;
    if (this.backdrop?.key === key) return;
    if (this.backdrop) disposeSceneryPart(this.backdrop.part);
    this.backdrop = { key, part: sceneryPart(generateSurroundings(this.land.seed, shown, margin), this.mats) };
  }

  /** Is this the land shown around the world now? */
  showsAround(around: readonly AroundPlot[]): boolean {
    const key = (list: readonly AroundPlot[]) => list.map((a) => `${a.px},${a.pz}`).sort().join(";");
    return key(around) === key(this.around);
  }

  /** Mark plots for sale (while choosing one to buy), and the one chosen (brighter, without its badge); or none. */
  showForSale(plots: readonly PlotCoord[], chosen: PlotCoord | null = null): void {
    disposeTree(this.saleGroup);
    this.saleGroup.clear();
    if (plots.length === 0) return;
    const tint = new MeshBasicMaterial({ color: "#fff6dc", transparent: true, opacity: 0.32, depthWrite: false, fog: false });
    const bright = new MeshBasicMaterial({ color: "#ffe9a8", transparent: true, opacity: 0.5, depthWrite: false, fog: false });
    const badge = new SpriteMaterial({ map: plusTexture(), transparent: true, fog: false, depthTest: false });
    for (const p of plots) {
      const picked = chosen !== null && chosen.px === p.px && chosen.pz === p.pz;
      const plane = new Mesh(new PlaneGeometry(PLOT_WIDTH - 40, PLOT_DEPTH - 40), picked ? bright : tint);
      plane.rotateX(-Math.PI / 2);
      plane.position.set((p.px + 0.5) * PLOT_WIDTH, RISER_HEIGHT * 3 + 4, (p.pz + 0.5) * PLOT_DEPTH);
      plane.renderOrder = 2;
      plane.userData.ownsMaterial = true;
      this.saleGroup.add(plane);
      if (picked) continue;
      const plus = new Sprite(badge);
      plus.position.set((p.px + 0.5) * PLOT_WIDTH, 320, (p.pz + 0.5) * PLOT_DEPTH);
      plus.scale.set(300, 300, 1);
      plus.renderOrder = 3;
      this.saleGroup.add(plus);
    }
  }

  /** One plot's blocks, towns, fields and shed (built again if it was already). */
  private buildPlot(slot: number): void {
    const old = this.plotGroups.get(slot);
    if (old) {
      this.group.remove(old);
      disposeTree(old);
    }
    const land = this.land;
    const grid = land.grid;
    const { px, pz } = grid.plots[slot];
    const group = new Group();
    const b = new Batcher(this.mats.paint);
    // Hills: stacks of individual wooden blocks, painted green on top.
    group.add(buildBlocks(grid, land.seed, this.mats, this.blockIndex, false, [slot]));
    this.edgeCorners.set(slot, edgeCornerKey(land, slot));
    const here = (x: number, z: number) => plotOfCol(Math.floor(x / CELL)) === px && plotOfRow(Math.floor(z / CELL)) === pz;
    const prints: Footprint[] = [];
    for (const town of land.towns) {
      if (!here(town.centre.x, town.centre.z)) continue;
      for (const h of buildTown(land, town, this.mats, b)) prints.push({ x: h.cx, z: h.cz, y: 0, rx: h.w / 2 + 12, rz: h.d / 2 + 12, heading: 0, strength: 1 });
      buildStation(town, this.mats, b);
      this.buildSign(town, b, group);
    }
    // Fenced paddocks of toy animals.
    for (const field of land.fields) {
      if (((field.cells[0] / PLOT_CELLS) | 0) !== slot) continue;
      buildField(land, field, this.mats, b);
    }
    if (land.shed && here(land.shed.x, land.shed.z)) buildShed(land, land.shed, this.mats, b);
    b.build(group);
    if (this.contactShadows) {
      // Hill edges: a blob under each ground-level block that has open felt beside it.
      forEachInPlot(slot, grid.plots[slot], (i, col, row) => {
        if (grid.height[i] === 0) return;
        const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => {
          const j = grid.index(col + dc, row + dr);
          return j !== -1 && grid.height[j] === 0;
        });
        if (open) prints.push({ x: grid.centreX(col), z: grid.centreZ(row), y: 0, rx: CELL * 0.66, rz: CELL * 0.66, heading: 0, strength: 0.9 });
      });
      if (prints.length > 0) group.add(buildContactShadows(prints));
    }
    this.plotGroups.set(slot, group);
    this.group.add(group);
  }

  /** The felt ground and its hem round the land, and the felt rivers, roads and lanes (on the land and around it). */
  private buildFelt(): void {
    this.group.remove(this.feltGroup);
    disposeTree(this.feltGroup);
    const group = new Group();
    const grid = this.land.grid;
    const shown = extentOf([...grid.plots, ...this.around]);
    group.add(buildFeltGround(this.mats, shown, grid.plots));
    const grids = [grid, ...this.around.map((a) => a.land.grid)];
    const river = buildFeltRibbons(grids, SURF_RIVER, this.mats.riverFelt, 1.6, this.feltCaches.river);
    const road = buildFeltRibbons(grids, SURF_ROAD, this.mats.roadFelt, 1.1, this.feltCaches.road);
    const lane = buildFeltRibbons(grids, SURF_LANE, this.mats.roadFelt, 1.1, this.feltCaches.lane);
    if (river) group.add(river);
    if (road) group.add(road);
    if (lane) group.add(lane);
    this.feltGroup = group;
    this.group.add(group);
  }

  /** Turned-wood toy trees, standing on whatever block they grew on (all the land's, as one instanced draw each). */
  private buildTrees(): void {
    this.treeHop?.dispose();
    this.group.remove(this.treeGroup);
    disposeTree(this.treeGroup);
    const trees = treePlacements(this.land);
    this.clearance = new TreeClearance(this.land.grid, trees);
    const spot = (t: TreePlacement): Required<TreeAt> => ({ x: t.x, z: t.z, y: t.y, s: 1 });
    this.treeAnim = { shown: trees.map(spot), from: trees.map(spot), to: trees.map(spot), progress: new Float32Array(trees.length).fill(1) };
    const group = buildTrees(trees, this.mats);
    this.placeTrees = group.userData.place as PlaceTrees;
    if (this.contactShadows) group.add(buildContactShadows(trees.map((t) => ({ x: t.x, z: t.z, y: t.y, rx: 24 * t.scale, rz: 24 * t.scale, heading: 0, strength: 1 }))));
    this.treeGroup = group;
    this.group.add(group);
  }

  /**
   * The land around (as it would be if bought), and the toy countryside beyond it, fading into the haze: each made
   * ready once (see `prepareAround`, `prepareBackdrop`), then drawn together. Without `newBackdrop` the countryside
   * stays as it was (if there is one).
   */
  private buildAround(newBackdrop: boolean): void {
    this.group.remove(this.aroundGroup);
    disposeTree(this.aroundGroup);
    // Plots no longer around (bought) are done with.
    const keep = new Set(this.around.map((a) => plotKey(a.px, a.pz)));
    for (const [key, part] of this.aroundParts) {
      if (keep.has(key)) continue;
      disposeSceneryPart(part);
      this.aroundParts.delete(key);
    }
    for (const a of this.around) this.prepareAround(a);
    if (newBackdrop || !this.backdrop) this.prepareBackdrop(this.around);
    const parts = [...this.around.map((a) => this.aroundParts.get(plotKey(a.px, a.pz))!), this.backdrop!.part];
    this.aroundGroup = buildScenery(parts, this.mats, this.landRect);
    this.group.add(this.aroundGroup);
  }

  /** The layout the trees were last kept clear of. */
  private layout: Layout | null = null;

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
  syncTrees(layout: Layout | null, animate = false): Flourish | null {
    if (!layout) return null;
    this.layout = layout;
    this.clearance.setLayout(layout);
    this.cuts.sync(heldCut(this.land, this.held));
    return this.retarget(this.clearance.spots(this.held ?? undefined), animate);
  }

  /** Trees hop aside for a piece held over the mat, and back when it moves on (null: nothing held). */
  previewTrees(held: HeldPiece | null): Flourish | null {
    this.held = held;
    this.cuts.sync(heldCut(this.land, held));
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
        // The trees were built again (the land grew): this hop is over.
        if (this.treeAnim !== a) return false;
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
        if (this.treeHop === hop) this.treeHop = null;
        if (this.treeAnim !== a) return;
        // Finished, or cut short: every tree where it's going.
        for (let i = 0; i < a.shown.length; i++) {
          Object.assign(a.shown[i], a.to[i]);
          a.progress[i] = 1;
        }
        this.placeTrees(a.shown);
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

  /** Name board on two posts on the station house roof; glows when the town is connected. */
  private buildSign(town: Town, b: Batcher, group: Group): void {
    const pose = signPose(town);
    this.signs.get(town.id)?.map?.dispose();
    this.signs.get(town.id)?.dispose();
    const sign = this.makeSign(town.name);
    this.signNames.set(town.id, town.name);
    const board = new Mesh(new BoxGeometry(SIGN_WIDTH, SIGN_HEIGHT, SIGN_THICKNESS), [this.mats.blockWood, this.mats.blockWood, this.mats.blockWood, this.mats.blockWood, sign, sign]);
    board.rotation.y = -pose.heading;
    board.position.set(pose.x, SIGN_Y, pose.z);
    board.castShadow = true;
    group.add(board);
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
    if (this.connected.has(town.id)) this.setConnected(this.connected);
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

/** Free a group's geometries, instance buffers and own materials (shared ones from Materials are kept). */
function disposeTree(root: Group): void {
  root.traverse((o) => {
    // Sprites share their geometry and the badge texture: only their material is theirs.
    if ((o as Sprite).isSprite) {
      (o as Sprite).material.dispose();
      return;
    }
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    // Instanced meshes hold per-instance buffers that only their own dispose() frees.
    if ((m as InstancedMesh).isInstancedMesh) (m as InstancedMesh).dispose();
    if (m.userData.ownsMaterial) {
      const mat = m.material as MeshBasicMaterial;
      mat.alphaMap?.dispose();
      mat.dispose();
    }
  });
}

/** The corners of the blocks round a plot's edge (which depend on the plots beside it). */
function edgeCornerKey(land: Landscape, slot: number): string {
  const g = land.grid;
  const hills = hillsOf(g);
  const out: number[] = [];
  forEachInPlot(slot, g.plots[slot], (i, col, row) => {
    const c = col - g.plots[slot].px * PLOT_COLS;
    const r = row - g.plots[slot].pz * PLOT_ROWS;
    if (c !== 0 && r !== 0 && c !== PLOT_COLS - 1 && r !== PLOT_ROWS - 1) return;
    for (let level = 0; level < g.height[i]; level++) out.push(hills.blockCorners(col, row, level));
  });
  return out.join("");
}

/**
 * The land around the world as scenery: its blocks (only those that show), trees and town houses, drawn like the
 * countryside beyond (cheaply, a few draws for all of it).
 */
function aroundScenery(around: readonly AroundPlot[], seed: number): Surroundings {
  const blocks: OuterBlock[] = [];
  const trees: OuterTree[] = [];
  const houses: OuterHouse[] = [];
  const slabs: Surroundings["slabs"] = [];
  for (const a of around) {
    const g = a.land.grid;
    const height = (c: number, r: number) => {
      const i = g.index(c, r);
      return i === -1 ? 0 : g.height[i];
    };
    g.forEachCell((i, col, row) => {
      const h = g.height[i];
      const x = g.centreX(col);
      const z = g.centreZ(row);
      const lowest = Math.min(height(col + 1, row), height(col - 1, row), height(col, row + 1), height(col, row - 1));
      for (let level = 0; level < h; level++) {
        if (level < h - 1 && lowest > level) continue;
        blocks.push({ x, z, y: level * RISER_HEIGHT, size: CELL, height: RISER_HEIGHT, top: level === h - 1, tone: hashInts(seed, col, row, level) & 1023 });
      }
      if (g.feature[i] === FEAT_TREE) {
        const v = hashInts(seed, col, row, 77) / 4294967296;
        trees.push({ x: x + (v - 0.5) * 20, z: z + (((v * 7) % 1) - 0.5) * 20, y: h * RISER_HEIGHT, scale: 0.8 + ((v * 13) % 1) * 0.4, variant: v });
      }
    });
    for (const town of a.land.towns) {
      for (const bld of town.buildings) {
        const xs = bld.cells.map((c) => g.centreX(g.colOf(c)));
        const zs = bld.cells.map((c) => g.centreZ(g.rowOf(c)));
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
        const tx = town.centre.x - cx;
        const tz = town.centre.z - cz;
        const front = Math.abs(tx) > Math.abs(tz) ? { x: Math.sign(tx) || 1, z: 0 } : { x: 0, z: Math.sign(tz) || 1 };
        houses.push({ cx, cz, w: Math.max(...xs) - Math.min(...xs) + CELL - 12, d: Math.max(...zs) - Math.min(...zs) + CELL - 12, floors: bld.floors, roof: bld.roof, front });
      }
    }
    slabs.push(...plotSlabs({ px: a.px, pz: a.pz }, (c, r, level) => height(c, r) >= level));
  }
  return { blocks, trees, houses, hamlets: 0, slabs };
}

let plusTex: CanvasTexture | null = null;
/** A round badge with a plus: "buy this plot". */
function plusTexture(): CanvasTexture {
  if (plusTex) return plusTex;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2f5d3a";
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f3e3c3";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = "#f8efdc";
  ctx.fillRect(56, 30, 16, 68);
  ctx.fillRect(30, 56, 68, 16);
  plusTex = new CanvasTexture(canvas);
  plusTex.colorSpace = SRGBColorSpace;
  return plusTex;
}
