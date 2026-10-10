import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "../lib/rng";
import {
  CELL,
  COLS,
  FEAT_TREE,
  hillSlabs,
  ROWS,
  SURF_RIVER,
  SURF_ROAD,
  type Landscape,
  type Town,
} from "../landscape";
import { RISER_HEIGHT, TRACK_WIDTH } from "../track";
import { buildFeltMat, buildFeltRibbons } from "./dressing/felt";
import type { Materials } from "./materials";

export { MAT_THICKNESS } from "./dressing/felt";
const CAP = 7; // painted grass layer on top of each block layer
const ROOF_COLORS = ["#c8442f", "#2f6db5", "#3c8f4e", "#6b4a8f"];
const WALL_COLORS = ["#f0ebe0", "#e9d9b8", "#f3e3c3"];

/** Collects geometries per material, then merges each bucket into one mesh (few draw calls, static scenery). */
class Batcher {
  private buckets = new Map<Material, BufferGeometry[]>();
  add(material: Material, geometry: BufferGeometry): void {
    let list = this.buckets.get(material);
    if (!list) this.buckets.set(material, (list = []));
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    list.push(g);
  }
  build(group: Group, castShadow = true): void {
    for (const [material, list] of this.buckets) {
      const merged = mergeGeometries(list);
      if (!merged) continue;
      const mesh = new Mesh(merged, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
    this.buckets.clear();
  }
}

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
    const r = rng(this.land.seed * 31 + 7);

    // The felt play mat, and felt rivers and roads laid on it.
    this.group.add(buildFeltMat(this.mats));
    const river = buildFeltRibbons(grid, SURF_RIVER, this.mats.riverFelt, 1.6);
    const road = buildFeltRibbons(grid, SURF_ROAD, this.mats.roadFelt, 1.1);
    if (river) this.group.add(river);
    if (road) this.group.add(road);

    // Hills: stacked wooden blocks with painted grass tops, one slab per merged rectangle per layer.
    for (const slab of hillSlabs(grid)) {
      const w = slab.x1 - slab.x0;
      const d = slab.z1 - slab.z0;
      const cx = (slab.x0 + slab.x1) / 2;
      const cz = (slab.z0 + slab.z1) / 2;
      const base = (slab.level - 1) * RISER_HEIGHT;
      const wood = new RoundedBoxGeometry(w - 1, RISER_HEIGHT - CAP, d - 1, 2, 2.5);
      wood.translate(cx, base + (RISER_HEIGHT - CAP) / 2, cz);
      b.add(slab.level % 2 ? this.mats.blockWood : this.mats.blockWoodDark, wood);
      const cap = new RoundedBoxGeometry(w - 1, CAP, d - 1, 2, 2.5);
      cap.translate(cx, base + RISER_HEIGHT - CAP / 2, cz);
      b.add(this.mats.blockTop, cap);
    }

    // Trees: lacquered cones and lollipops, standing on whatever block they grew on.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = grid.index(col, row);
        if (grid.feature[i] !== FEAT_TREE) continue;
        const x = grid.centreX(col) + (r() - 0.5) * 18;
        const z = grid.centreZ(row) + (r() - 0.5) * 18;
        const y = grid.groundY(i);
        const s = 0.75 + r() * 0.5;
        const trunk = new CylinderGeometry(4.5 * s, 5.5 * s, 26 * s, 12);
        trunk.translate(x, y + 13 * s, z);
        b.add(this.mats.naturalWood, trunk);
        const green = this.mats.lacquer(["#3c8f4e", "#2f7a43", "#5aa05a", "#6fae4f"][Math.floor(r() * 4)]);
        if (r() < 0.55) {
          const crown = new ConeGeometry(22 * s, 58 * s, 20);
          crown.translate(x, y + 26 * s + 29 * s, z);
          b.add(green, crown);
        } else {
          const crown = new SphereGeometry(20 * s, 20, 14);
          crown.translate(x, y + 26 * s + 16 * s, z);
          b.add(green, crown);
        }
      }
    }

    for (const town of this.land.towns) {
      this.buildTown(town, b, r);
      this.buildStation(town, b);
    }

    b.build(this.group);
  }

  private buildTown(town: Town, b: Batcher, r: () => number): void {
    const { grid } = this.land;
    for (const bld of town.buildings) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const c of bld.cells) {
        const col = c % COLS;
        const row = (c - col) / COLS;
        minX = Math.min(minX, grid.centreX(col) - CELL / 2);
        maxX = Math.max(maxX, grid.centreX(col) + CELL / 2);
        minZ = Math.min(minZ, grid.centreZ(row) - CELL / 2);
        maxZ = Math.max(maxZ, grid.centreZ(row) + CELL / 2);
      }
      const w = maxX - minX - 10;
      const d = maxZ - minZ - 10;
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const h = 40 * bld.floors + 6;
      const wall = this.mats.lacquer(WALL_COLORS[Math.floor(r() * WALL_COLORS.length)]);
      const body = new RoundedBoxGeometry(w, h, d, 2, 2.5);
      body.translate(cx, h / 2, cz);
      b.add(wall, body);
      const roofMat = this.mats.lacquer(ROOF_COLORS[bld.roof]);
      if (bld.kind === "house") {
        // Gable roof along the longer side.
        const along = w >= d;
        const span = along ? d : w;
        const length = along ? w : d;
        const tri = new Shape();
        tri.moveTo(-span / 2 - 4, 0);
        tri.lineTo(span / 2 + 4, 0);
        tri.lineTo(0, span * 0.55);
        tri.lineTo(-span / 2 - 4, 0);
        const roof = new ExtrudeGeometry(tri, { depth: length + 6, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, bevelSegments: 2 });
        roof.translate(0, 0, -(length + 6) / 2);
        if (along) roof.rotateY(Math.PI / 2);
        roof.translate(cx, h, cz);
        b.add(roofMat, roof);
      } else {
        const roof = new RoundedBoxGeometry(w + 6, 5, d + 6, 1, 1.5);
        roof.translate(cx, h + 2.5, cz);
        b.add(roofMat, roof);
        const awning = new RoundedBoxGeometry(w * 0.8, 3, 10, 1, 1);
        awning.translate(cx, h * 0.55, cz + d / 2 + 5);
        b.add(this.mats.lacquer("#c8442f"), awning);
      }
      // Windows on the front and back.
      for (const side of [-1, 1]) {
        for (let f = 0; f < bld.floors; f++) {
          const win = new BoxGeometry(Math.min(14, w * 0.25), 12, 1.5);
          win.translate(cx + (side * w) / 4, 18 + f * 40, cz + d / 2 + 0.6);
          b.add(this.mats.glass, win);
          const back = win.clone();
          back.translate(0, 0, -d - 1.2);
          b.add(this.mats.glass, back);
        }
      }
    }
  }

  private buildStation(town: Town, b: Batcher): void {
    const s = town.station;
    const dx = Math.cos(s.heading);
    const dz = Math.sin(s.heading);
    const lx = -dz;
    const lz = dx;
    const along = (t: number, lateral: number) => ({ x: s.x + dx * t + lx * lateral, z: s.z + dz * t + lz * lateral });
    const yaw = -s.heading;
    const place = (g: BufferGeometry, t: number, lateral: number, y: number) => {
      g.rotateY(yaw);
      const p = along(t, lateral);
      g.translate(p.x, y, p.z);
      return g;
    };

    // Platform beside the track (left side), a canopy on posts, and a little station house.
    const platform = new RoundedBoxGeometry(196, 14, 38, 2, 2.5);
    b.add(this.mats.blockWood, place(platform, 108, TRACK_WIDTH / 2 + 21, 7));
    const edge = new RoundedBoxGeometry(196, 2, 4, 1, 0.8);
    b.add(this.mats.lacquer("#e6b52c"), place(edge, 108, TRACK_WIDTH / 2 + 4, 14.5));
    for (const t of [48, 108, 168]) {
      const post = new CylinderGeometry(2.2, 2.2, 46, 10);
      b.add(this.mats.lacquer("#f0ebe0"), place(post, t, TRACK_WIDTH / 2 + 30, 14 + 23));
    }
    const canopy = new RoundedBoxGeometry(150, 4, 46, 1, 1.5);
    b.add(this.mats.lacquer("#c8442f"), place(canopy, 108, TRACK_WIDTH / 2 + 22, 14 + 48));
    const house = new RoundedBoxGeometry(70, 46, 30, 2, 2.5);
    b.add(this.mats.lacquer("#e9d9b8"), place(house, 108, TRACK_WIDTH / 2 + 58, 14 + 23));
    const roof = new RoundedBoxGeometry(80, 5, 38, 1, 1.5);
    b.add(this.mats.lacquer("#2f6db5"), place(roof, 108, TRACK_WIDTH / 2 + 58, 14 + 48));

    // Name board on two posts at the end of the platform; glows when the town is connected.
    const sign = this.makeSign(town.name);
    const board = new Mesh(new BoxGeometry(84, 22, 3), [this.mats.blockWood, this.mats.blockWood, this.mats.blockWood, this.mats.blockWood, sign, sign]);
    board.rotation.y = yaw;
    const at = along(14, TRACK_WIDTH / 2 + 24);
    board.position.set(at.x, 62, at.z);
    board.castShadow = true;
    this.group.add(board);
    for (const off of [-34, 34]) {
      const post = new CylinderGeometry(2.4, 2.4, 52, 10);
      b.add(this.mats.naturalWood, place(post, 14 + off, TRACK_WIDTH / 2 + 24, 26));
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

