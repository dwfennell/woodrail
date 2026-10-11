import { BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, type InstancedMesh, type MeshBasicMaterial } from "three";
import { CELL, COLS, generateSurroundings, ROWS, SURF_RIVER, SURF_ROAD, type Landscape, type Town } from "../landscape";
import { SIGN_HEIGHT, SIGN_THICKNESS, SIGN_WIDTH, SIGN_Y, signPose, STATION_ROOF_TOP } from "../landscape/sign";
import { Batcher } from "./dressing/batcher";
import { buildBlocks } from "./dressing/blocks";
import { buildStation, buildTown } from "./dressing/buildings";
import { buildContactShadows, type Footprint } from "./dressing/contact";
import { buildFeltGround, buildFeltRibbons } from "./dressing/felt";
import { buildSurroundings } from "./dressing/surroundings";
import { buildTrees, treePlacements } from "./dressing/trees";
import type { Flourish } from "./flourishes";
import type { Materials } from "./materials";

/** How brightly an unconnected name board lights itself (connected ones glow warm). */
const SIGN_SELF_LIGHT = 0.3;

/** Draws the felt mat and everything on it (block hills, rivers, roads, trees, towns, stations, name signs) and the scenery around it. */
export class LandscapeView {
  readonly group = new Group();
  private signs = new Map<number, MeshStandardMaterial>();
  private connected = new Set<number>();

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
    if (river) this.group.add(river);
    if (road) this.group.add(road);

    // Hills: stacks of individual wooden blocks, painted green on top.
    this.group.add(buildBlocks(grid, this.land.seed, this.mats));

    // Turned-wood toy trees, standing on whatever block they grew on.
    const trees = treePlacements(this.land);
    this.group.add(buildTrees(trees, this.mats));
    const prints: Footprint[] = trees.map((t) => ({ x: t.x, z: t.z, y: t.y, rx: 24 * t.scale, rz: 24 * t.scale, heading: 0, strength: 1 }));

    for (const town of this.land.towns) {
      for (const h of buildTown(this.land, town, this.mats, b)) prints.push({ x: h.cx, z: h.cz, y: 0, rx: h.w / 2 + 12, rz: h.d / 2 + 12, heading: 0, strength: 1 });
      buildStation(town, this.mats, b);
      this.buildSign(town, b);
    }

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
    const board = new Mesh(new BoxGeometry(SIGN_WIDTH, SIGN_HEIGHT, SIGN_THICKNESS), [this.mats.blockWood, this.mats.blockWood, this.mats.blockWood, this.mats.blockWood, sign, sign]);
    board.rotation.y = -pose.heading;
    board.position.set(pose.x, SIGN_Y, pose.z);
    board.castShadow = true;
    this.group.add(board);
    const dx = Math.cos(pose.heading);
    const dz = Math.sin(pose.heading);
    const postH = SIGN_Y - STATION_ROOF_TOP;
    for (const off of [-28, 28]) {
      const post = new CylinderGeometry(2.4, 2.4, postH, 10);
      post.translate(pose.x + dx * off, STATION_ROOF_TOP + postH / 2, pose.z + dz * off);
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
    return new MeshStandardMaterial({ map: tex, roughness: 0.6, emissiveMap: tex, emissive: new Color("#ffffff"), emissiveIntensity: SIGN_SELF_LIGHT });
  }
}

