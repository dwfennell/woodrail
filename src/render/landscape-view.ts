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
  type Camera,
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
import { buildFeltGround, buildFeltTiles, type FeltTiles } from "./dressing/felt";
import { buildScenery, disposeSceneryPart, sceneryPart, splitSurroundings, type SceneryPart } from "./dressing/surroundings";
import { byTile, cullTiles, plotRect, setCullRects, TILE_DEPTH, TILE_WIDTH, tileAt } from "./dressing/tiles";
import { buildTiledTrees, treePlacements, type PlaceTrees, type TreeAt, type TreePlacement, type TreeTile } from "./dressing/trees";
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
  /**
   * The land in tiles of 2 × 2 plots (see `tiles.ts`): each with its blocks, towns, signs, fields and shed. Each plot
   * has a group of its own too (by slot in `plotGroups`) for what's built per plot.
   */
  private readonly landTiles = new Map<number, LandTile>();
  private readonly plotGroups = new Map<number, Group>();
  /** Per plot: the corners of the blocks round its edge, which change when a plot beside it is added. */
  private readonly edgeCorners = new Map<number, string>();
  /** The felt ground, its hem and the felt rivers, roads and lanes (laid across plots). */
  private feltGroup = new Group();
  private treeGroup = new Group();
  /** The trees' tiles as built, kept to reuse (see `buildTiledTrees`). */
  private readonly treeTiles = new Map<number, TreeTile>();
  /** The land around (as it would be), and the scenery beyond. */
  private aroundGroup = new Group();
  private around: AroundPlot[] = [];
  /** The land around, made ready to draw, by plot (see `prepareAround`). */
  private readonly aroundParts = new Map<number, SceneryPart>();
  /** The countryside beyond, made ready to draw, and the rectangle it's around. */
  private backdrop: { key: string; parts: SceneryPart[] } | null = null;
  /** Felt already extruded, by tile (see `buildFeltTiles`). */
  private readonly feltTiles: Record<"river" | "roads", FeltTiles> = { river: new Map(), roads: new Map() };
  /** The markers on plots for sale, while choosing one. */
  private saleGroup = new Group();
  private readonly blockIndex = new Map<string, BlockInstanceRef[]>();
  private signs = new Map<number, MeshStandardMaterial>();
  private readonly signNames = new Map<number, string>();
  /** Plank bundles shown on each town's sign. */
  private readonly delivered = new Map<number, number>();
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
    this.dropPending();
    disposeTree(this.group);
    for (const p of this.aroundParts.values()) disposeSceneryPart(p);
    if (this.backdrop) for (const p of this.backdrop.parts) disposeSceneryPart(p);
    for (const cache of Object.values(this.feltTiles)) {
      for (const t of cache.values()) {
        t.geometry?.dispose();
      }
    }
    for (const m of this.signs.values()) {
      m.map?.dispose();
      m.dispose();
    }
  }

  private build(): void {
    const g = this.land.grid;
    this.group.add(this.feltGroup, this.treeGroup, this.aroundGroup, this.saleGroup);
    g.plots.forEach((_, slot) => this.buildPlot(slot));
    for (const key of new Set(g.plots.map((_, slot) => this.tileOfSlot(slot)))) this.buildTile(key);
    this.cuts = new HillCutsView(g, { wood: this.mats.blockWood, top: this.mats.blockTop }, (key) => this.blockIndex.get(key) ?? []);
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
    // Their tiles' far-off blocks and towns too; every plot of those tiles has new far-off blocks for cuttings to hide.
    const tiles = new Set([...rebuilt].map((slot) => this.tileOfSlot(slot)));
    for (const key of tiles) this.buildTile(key);
    this.cuts.plotsRebuilt(g.plots.map((_, slot) => slot).filter((slot) => tiles.has(this.tileOfSlot(slot))));
    this.around = around.filter((a) => !g.hasPlot(a.px, a.pz));
    this.buildFelt();
    this.buildTrees();
    // The countryside beyond stays as it is for now: the land around isn't all ready yet (see `setAround`).
    this.buildAround(false);
    this.syncTrees(this.layout ?? null);
  }

  /**
   * Squares' heights changed in these plots (land editing): rebuild their blocks, and their neighbours' where the edge
   * changed, with their tiles' far-off blocks and towns, cuttings and trees. Like `addPlots`, without the felt (heights
   * don't change it) or the land around.
   */
  landEdited(slots: readonly number[]): void {
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
    const tiles = new Set([...rebuilt].map((slot) => this.tileOfSlot(slot)));
    for (const key of tiles) this.buildTile(key);
    this.cuts.plotsRebuilt(g.plots.map((_, slot) => slot).filter((slot) => tiles.has(this.tileOfSlot(slot))));
    this.buildTrees();
    this.syncTrees(this.layout ?? null);
  }

  /** Show this land around the world (plots not in it), with the scenery beyond. */
  setAround(around: readonly AroundPlot[]): void {
    this.around = around.filter((a) => !this.land.grid.hasPlot(a.px, a.pz));
    const key = this.showKey(this.around);
    const ready = this.pending?.key === key ? this.pending : null;
    this.pending = null;
    this.swapFelt(ready?.felt ?? this.makeFelt());
    this.swapAround(ready?.scenery ?? this.makeAround(true));
  }

  /**
   * Build ahead what `setAround(around)` will show, a step at a time between frames, so showing it is quick: first the
   * felt (`"river"`, `"roads"`, then `"felt"`), then the scenery (`"scenery"`, after `prepareAround` for each plot and
   * `prepareBackdrop`).
   */
  prepareShow(around: readonly AroundPlot[], step: "river" | "roads" | "felt" | "scenery"): void {
    const list = around.filter((a) => !this.land.grid.hasPlot(a.px, a.pz));
    const key = this.showKey(list);
    if (this.pending?.key !== key) {
      this.dropPending();
      this.pending = { key };
    }
    const shown = this.around;
    this.around = list;
    // The felt's outlines extrude into its caches a surface or two at a time (the river, the roads and lanes), then
    // the felt comes together from them.
    if (step === "river") this.warmFelt("river");
    if (step === "roads") this.warmFelt("roads");
    if (step === "felt" && !this.pending.felt) this.pending.felt = this.makeFelt();
    if (step === "scenery" && !this.pending.scenery) this.pending.scenery = this.makeAround(false);
    this.around = shown;
  }

  /** What the land around, built ahead, is for (the land as it is, and the plots around), and what's built. */
  private pending: { key: string; felt?: Group; scenery?: Group } | null = null;

  private showKey(around: readonly AroundPlot[]): string {
    return `${this.land.grid.revision}|${around.map((a) => `${a.px},${a.pz}`).sort().join(";")}`;
  }

  private dropPending(): void {
    if (this.pending?.felt) disposeTree(this.pending.felt);
    if (this.pending?.scenery) disposeTree(this.pending.scenery);
    this.pending = null;
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
    if (this.backdrop) for (const p of this.backdrop.parts) disposeSceneryPart(p);
    // In big chunks (two tiles each way): enough that a close view skips most of it, few enough to stay cheap to draw.
    const chunks = splitSurroundings(generateSurroundings(this.land.seed, shown, margin), 2 * TILE_WIDTH, 2 * TILE_DEPTH);
    this.backdrop = { key, parts: chunks.map((c, k) => sceneryPart(c, this.mats, k * 101)) };
  }

  /**
   * Show only the plots and tiles of trees, felt and scenery the camera sees within `reach`, in the detail their
   * distance calls for (see `cullTiles`). Call before drawing a frame; true if any changed (their shadows need drawing
   * again).
   */
  cull(camera: Camera, reach: number, detail: number): boolean {
    return cullTiles([this.group, this.treeGroup, this.aroundGroup, this.cuts.group, ...this.feltGroup.children], camera, reach, detail);
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

  /** The tile a plot is in (by its middle). */
  private tileOfSlot(slot: number): number {
    const { px, pz } = this.land.grid.plots[slot];
    return tileAt((px + 0.5) * PLOT_WIDTH, (pz + 0.5) * PLOT_DEPTH);
  }

  /** A tile of the land, made (empty) on first use. */
  private landTile(key: number): LandTile {
    let tile = this.landTiles.get(key);
    if (!tile) {
      const group = new Group();
      tile = { group, blocks: null, things: null };
      this.landTiles.set(key, tile);
      this.group.add(group);
    }
    return tile;
  }

  /**
   * One plot's own part of its tile (built again if it was already): the soft shadows round its hills' feet, if any.
   * (Its blocks are built with its tile's, see `buildTile`: one set of draws for the tile rather than per plot.)
   */
  private buildPlot(slot: number): void {
    const old = this.plotGroups.get(slot);
    if (old) {
      old.removeFromParent();
      disposeTree(old);
    }
    const land = this.land;
    const grid = land.grid;
    const { px, pz } = grid.plots[slot];
    const group = new Group();
    this.edgeCorners.set(slot, edgeCornerKey(land, slot));
    if (this.contactShadows) {
      // Hill edges: a blob under each ground-level block that has open felt beside it.
      const prints: Footprint[] = [];
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
    setCullRects(group, [plotRect({ px, pz })], 4 * RISER_HEIGHT);
    this.plotGroups.set(slot, group);
    this.landTile(this.tileOfSlot(slot)).group.add(group);
  }

  /**
   * A tile's blocks (one set for its plots), towns, fields, shed and signs (built again if they were already), all in
   * full at any distance: far out, the materials drop their fine texture instead (see `Materials.setFar`).
   */
  private buildTile(key: number): void {
    const land = this.land;
    const grid = land.grid;
    const tile = this.landTile(key);
    for (const o of [tile.blocks, tile.things]) {
      if (!o) continue;
      o.removeFromParent();
      disposeTree(o);
    }
    const slots = grid.plots.map((_, slot) => slot).filter((slot) => this.tileOfSlot(slot) === key);
    // Hills: stacks of individual wooden blocks, painted green on top.
    tile.blocks = buildBlocks(grid, land.seed, this.mats, this.blockIndex, false, slots);
    tile.group.add(tile.blocks);

    // Towns with their stations and signs, fenced paddocks of toy animals, and the shed.
    const things = new Group();
    const b = new Batcher(this.mats.paint);
    const here = (x: number, z: number) => tileAt(x, z) === key;
    const prints: Footprint[] = [];
    for (const town of land.towns) {
      if (!here(town.centre.x, town.centre.z)) continue;
      for (const h of buildTown(land, town, this.mats, b)) prints.push({ x: h.cx, z: h.cz, y: 0, rx: h.w / 2 + 12, rz: h.d / 2 + 12, heading: 0, strength: 1 });
      buildStation(town, this.mats, b);
      this.buildSign(town, b, things);
    }
    for (const field of land.fields) {
      const first = field.cells[0];
      if (here(grid.centreX(grid.colOf(first)), grid.centreZ(grid.rowOf(first)))) buildField(land, field, this.mats, b);
    }
    if (land.shed && here(land.shed.x, land.shed.z)) buildShed(land, land.shed, this.mats, b);
    b.build(things);
    if (this.contactShadows && prints.length > 0) things.add(buildContactShadows(prints));
    tile.things = things;
    tile.group.add(things);
    // Its blocks, towns and signs stand within its plots (station roofs and signs are the tallest things).
    setCullRects(tile.group, slots.map((slot) => plotRect(grid.plots[slot])), 500);
  }

  /** The felt ground and its hem round the land, and the felt rivers, roads and lanes (on the land and around it). */
  private buildFelt(): void {
    this.swapFelt(this.makeFelt());
  }

  private swapFelt(group: Group): void {
    this.group.remove(this.feltGroup);
    disposeTree(this.feltGroup);
    this.feltGroup = group;
    this.group.add(group);
  }

  /** Extrude the felt of these surfaces into the caches, for the land and the land around now. */
  private warmFelt(which: "river" | "roads"): void {
    this.feltOf(which);
  }

  /** The river felt, or the road and lane felt, a mesh per tile (their geometry belongs to the cache). */
  private feltOf(which: "river" | "roads"): Group {
    const grids = [this.land.grid, ...this.around.map((a) => a.land.grid)];
    return which === "river"
      ? buildFeltTiles(grids, [SURF_RIVER], this.mats.riverFelt, () => 1.6, this.feltTiles.river)
      : buildFeltTiles(grids, [SURF_ROAD, SURF_LANE], this.mats.roadFelt, () => 1.1, this.feltTiles.roads);
  }

  private makeFelt(): Group {
    const group = new Group();
    const grid = this.land.grid;
    const shown = extentOf([...grid.plots, ...this.around]);
    group.add(buildFeltGround(this.mats, shown, grid.plots));
    // Felt rivers, roads and lanes in tiles, so the camera skips those out of view.
    group.add(this.feltOf("river"), this.feltOf("roads"));
    return group;
  }

  /** Turned-wood toy trees, standing on whatever block they grew on (all the land's, as one instanced draw each). */
  private buildTrees(): void {
    this.treeHop?.dispose();
    const trees = treePlacements(this.land);
    this.clearance = new TreeClearance(this.land.grid, trees);
    const spot = (t: TreePlacement): Required<TreeAt> => ({ x: t.x, z: t.z, y: t.y, s: 1 });
    this.treeAnim = { shown: trees.map(spot), from: trees.map(spot), to: trees.map(spot), progress: new Float32Array(trees.length).fill(1) };
    // Tiles whose trees haven't changed (all but those of new plots) are kept, moved over from the old group.
    const shadows = this.contactShadows
      ? (list: readonly TreePlacement[]) => buildContactShadows(list.map((t) => ({ x: t.x, z: t.z, y: t.y, rx: 24 * t.scale, rz: 24 * t.scale, heading: 0, strength: 1 })))
      : undefined;
    const group = buildTiledTrees(trees, this.mats, false, this.treeTiles, shadows);
    this.placeTrees = group.userData.place as PlaceTrees;
    this.group.remove(this.treeGroup);
    disposeTree(this.treeGroup);
    this.treeGroup = group;
    this.group.add(group);
  }

  /**
   * The land around (as it would be if bought), and the toy countryside beyond it, fading into the haze: each made
   * ready once (see `prepareAround`, `prepareBackdrop`), then drawn together. Without `newBackdrop` the countryside
   * stays as it was (if there is one).
   */
  private buildAround(newBackdrop: boolean): void {
    this.swapAround(this.makeAround(newBackdrop));
  }

  private swapAround(group: Group): void {
    this.group.remove(this.aroundGroup);
    disposeTree(this.aroundGroup);
    this.aroundGroup = group;
    this.group.add(group);
  }

  private makeAround(newBackdrop: boolean): Group {
    // Plots no longer around (bought) are done with.
    const keep = new Set(this.around.map((a) => plotKey(a.px, a.pz)));
    for (const [key, part] of this.aroundParts) {
      if (keep.has(key)) continue;
      disposeSceneryPart(part);
      this.aroundParts.delete(key);
    }
    for (const a of this.around) this.prepareAround(a);
    if (newBackdrop || !this.backdrop) this.prepareBackdrop(this.around);
    // A group of draws per tile of the land around, and per chunk of the countryside: those out of view are skipped.
    const group = new Group();
    const tiles = byTile(this.around, (a) => ({ x: (a.px + 0.5) * PLOT_WIDTH, z: (a.pz + 0.5) * PLOT_DEPTH }));
    for (const list of tiles.values()) group.add(buildScenery(list.map((a) => this.aroundParts.get(plotKey(a.px, a.pz))!), this.mats, this.landRect));
    for (const part of this.backdrop!.parts) group.add(buildScenery([part], this.mats, this.landRect));
    return group;
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
    // (Built again when its plot is: it keeps the count it showed.)
    const sign = this.makeSign(town.name, this.delivered.get(town.id) ?? 0);
    this.signNames.set(town.id, town.name);
    // Wood round the edges, the name on both faces: two draws (a box's own six groups would be six).
    const boardGeometry = new BoxGeometry(SIGN_WIDTH, SIGN_HEIGHT, SIGN_THICKNESS);
    boardGeometry.clearGroups();
    boardGeometry.addGroup(0, 24, 0);
    boardGeometry.addGroup(24, 12, 1);
    const board = new Mesh(boardGeometry, [this.mats.blockWood, sign]);
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
    this.delivered.set(townId, count);
    const m = this.signs.get(townId);
    const name = this.signNames.get(townId);
    if (!m || !name || !(m.map instanceof CanvasTexture)) return;
    drawSign(m.map.image as HTMLCanvasElement, name, count);
    m.map.needsUpdate = true;
  }

  private makeSign(name: string, delivered: number): MeshStandardMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    drawSign(canvas, name, delivered);
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
    // (Unless it belongs to a cache, such as tiles of felt.)
    if (!m.userData.sharedGeometry) m.geometry.dispose();
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
  return out.join(",");
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

/** A tile of the land (see `LandscapeView.landTiles`). */
interface LandTile {
  group: Group;
  /** Its plots' blocks. */
  blocks: Group | null;
  /** Its towns, signs, fields and shed. */
  things: Group | null;
}
