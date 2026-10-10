import { BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SRGBColorSpace } from "three";
import { SURF_RIVER, SURF_ROAD, type Landscape, type Town } from "../landscape";
import { SIGN_THICKNESS, SIGN_WIDTH, SIGN_Y, signPose } from "../landscape/sign";
import { Batcher } from "./dressing/batcher";
import { buildBlocks } from "./dressing/blocks";
import { buildStation, buildTown } from "./dressing/buildings";
import { buildFeltMat, buildFeltRibbons } from "./dressing/felt";
import { buildTrees, treePlacements } from "./dressing/trees";
import type { Materials } from "./materials";

export { MAT_THICKNESS } from "./dressing/felt";

/** Draws the felt mat and everything on it: block hills, rivers, roads, trees, towns, stations and name signs. */
export class LandscapeView {
  readonly group = new Group();
  private signs = new Map<number, MeshStandardMaterial>();

  constructor(
    private readonly land: Landscape,
    private readonly mats: Materials,
  ) {
    this.build();
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of this.signs.values()) {
      m.map?.dispose();
      m.dispose();
    }
  }

  /** Light the signs of connected towns. */
  setConnected(towns: ReadonlySet<number>): void {
    for (const [id, m] of this.signs) {
      const on = towns.has(id);
      m.emissive.set(on ? "#ffcf6b" : "#000000");
      m.emissiveIntensity = on ? 0.55 : 0;
    }
  }

  private build(): void {
    const { grid } = this.land;
    const b = new Batcher();

    // The felt play mat, and felt rivers and roads laid on it.
    this.group.add(buildFeltMat(this.mats));
    const river = buildFeltRibbons(grid, SURF_RIVER, this.mats.riverFelt, 1.6);
    const road = buildFeltRibbons(grid, SURF_ROAD, this.mats.roadFelt, 1.1);
    if (river) this.group.add(river);
    if (road) this.group.add(road);

    // Hills: stacks of individual wooden blocks, painted green on top.
    this.group.add(buildBlocks(grid, this.land.seed, this.mats));

    // Turned-wood toy trees, standing on whatever block they grew on.
    this.group.add(buildTrees(treePlacements(this.land), this.mats));

    for (const town of this.land.towns) {
      buildTown(this.land, town, this.mats, b);
      buildStation(town, this.mats, b);
      this.buildSign(town, b);
    }

    b.build(this.group);
  }

  /** Name board on two posts at the back of the platform; glows when the town is connected. */
  private buildSign(town: Town, b: Batcher): void {
    const pose = signPose(town);
    const sign = this.makeSign(town.name);
    const board = new Mesh(new BoxGeometry(SIGN_WIDTH, 22, SIGN_THICKNESS), [this.mats.blockWood, this.mats.blockWood, this.mats.blockWood, this.mats.blockWood, sign, sign]);
    board.rotation.y = -pose.heading;
    board.position.set(pose.x, SIGN_Y, pose.z);
    board.castShadow = true;
    this.group.add(board);
    const dx = Math.cos(pose.heading);
    const dz = Math.sin(pose.heading);
    for (const off of [-34, 34]) {
      const post = new CylinderGeometry(2.4, 2.4, SIGN_Y - 14, 10);
      post.translate(pose.x + dx * off, 14 + (SIGN_Y - 14) / 2, pose.z + dz * off);
      b.add(this.mats.naturalWood, post);
    }
    this.signs.set(town.id, sign);
  }

  private makeSign(name: string): MeshStandardMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
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
    ctx.fillText(name, 256, 68, 470);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    return new MeshStandardMaterial({ map: tex, roughness: 0.6, emissiveMap: tex, emissive: new Color("#000000") });
  }
}

