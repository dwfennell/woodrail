import { BufferAttribute, CanvasTexture, Color, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Object3D } from "three";
import type { CarLook } from "../sim";

/** Where a look's plate sits on its cab side (car-local mm: x along the car, y up) and how wide it is. */
interface Spot {
  x: number;
  y: number;
  w: number;
}

/** The chassis top in the Blender models (tools/blender/trains.py `TOP`): bodies sit on it. */
const TOP = 23;
/** Half the body's width: the cab sides' face (mm), and how far proud of it the plate stands. */
const SIDE = 16;
const PROUD = 0.35;
/** A plate's height for its width (the atlas slot's shape). */
const ASPECT = 4;

/** Each engine look's plate: under the cab's side window (the electric's mid-body, the express's beside its windows). */
export const PLATE_SPOTS: Readonly<Record<string, Spot>> = {
  classic: { x: -28, y: TOP + 9, w: 24 },
  tank: { x: -27, y: TOP + 8, w: 24 },
  goods: { x: -18, y: TOP + 8, w: 20 },
  diesel: { x: -29, y: TOP + 9, w: 24 },
  electric: { x: 0, y: TOP + 6, w: 24 },
  express: { x: 6, y: TOP + 19, w: 22 },
};

/** The atlas: pages of SLOT_W × SLOT_H slots, COLS across and ROWS down. */
const SLOT_W = 256;
const SLOT_H = SLOT_W / ASPECT;
const COLS = 2;
const ROWS = 8;
const PER_PAGE = COLS * ROWS;

interface Page {
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  material: MeshStandardMaterial;
  free: number[];
}

interface Plate {
  page: Page;
  slot: number;
  name: string;
}

/**
 * Engines' name plates: a small painted plaque on each side of an engine's cab with its name. All plates share a few
 * atlas pages (one canvas texture and material each, 16 names a page), so an engine costs two tiny quads and a slot;
 * a plate is painted when its engine is built or renamed, never per frame.
 */
export class NamePlates {
  private readonly pages: Page[] = [];
  private readonly plates = new Map<number, Plate>();

  /**
   * The plates for an engine (car id `carId`, look `look`) named `name`: a group to add to its model, or null where
   * there's nothing to paint on (no DOM: tests).
   */
  make(carId: number, name: string, look: CarLook): Group | null {
    if (typeof document === "undefined" || !name) return null;
    this.release(carId);
    const page = this.pages.find((p) => p.free.length > 0) ?? this.addPage();
    const slot = page.free.shift()!;
    const plate: Plate = { page, slot, name };
    this.plates.set(carId, plate);
    this.paint(plate);
    const spot = PLATE_SPOTS[look] ?? PLATE_SPOTS.classic;
    const geometry = new PlaneGeometry(spot.w, spot.w / ASPECT);
    // The slot's corner of the page (v up from the canvas's bottom).
    const col = slot % COLS;
    const row = Math.floor(slot / COLS) % ROWS;
    const u0 = col / COLS;
    const u1 = (col + 1) / COLS;
    const v1 = 1 - row / ROWS;
    const v0 = 1 - (row + 1) / ROWS;
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array([u0, v1, u1, v1, u0, v0, u1, v0]), 2));
    const group = new Group();
    group.name = "name-plates";
    for (const s of [1, -1]) {
      const mesh = new Mesh(geometry, page.material);
      // Facing out of each side, read left to right from that side.
      mesh.position.set(spot.x, spot.y, s * (SIDE + PROUD));
      if (s < 0) mesh.rotation.y = Math.PI;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.userData.namePlate = true;
      // (One geometry for both sides: the first frees it.)
      if (s < 0) mesh.userData.sharedGeometry = true;
      group.add(mesh);
    }
    return group;
  }

  /** Paint an engine's plate again with a new name (its page is uploaded once more). */
  rename(carId: number, name: string): void {
    const plate = this.plates.get(carId);
    if (!plate || plate.name === name || !name) return;
    plate.name = name;
    this.paint(plate);
  }

  /** The name an engine's plate shows ("" for none). */
  nameShown(carId: number): string {
    return this.plates.get(carId)?.name ?? "";
  }

  /** An engine gone: its slot is free for the next. */
  release(carId: number): void {
    const plate = this.plates.get(carId);
    if (!plate) return;
    this.plates.delete(carId);
    plate.page.free.push(plate.slot);
  }

  /** True for a plate's mesh (it's no part of the car's outline). */
  static isPlate(o: Object3D): boolean {
    return o.userData.namePlate === true;
  }

  private addPage(): Page {
    const canvas = document.createElement("canvas");
    canvas.width = SLOT_W * COLS;
    canvas.height = SLOT_H * ROWS;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    // (A little light of its own, as town signs have, so the cream reads in the cab's shade.)
    const material = new MeshStandardMaterial({ map: texture, roughness: 0.55, alphaTest: 0.5, emissiveMap: texture, emissive: new Color("#ffffff"), emissiveIntensity: 0.18, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const page: Page = { canvas, texture, material, free: Array.from({ length: PER_PAGE }, (_, i) => i) };
    this.pages.push(page);
    return page;
  }

  /** A cream plaque with a brown rim and the name in brown, filling its slot (a little clear round it for mipmaps). */
  private paint({ page, slot, name }: Plate): void {
    const ctx = page.canvas.getContext("2d");
    if (!ctx) return;
    const x = (slot % COLS) * SLOT_W;
    const y = Math.floor(slot / COLS) * SLOT_H;
    ctx.clearRect(x, y, SLOT_W, SLOT_H);
    const pad = 4;
    const w = SLOT_W - 2 * pad;
    const h = SLOT_H - 2 * pad;
    const r = h / 2.4;
    ctx.beginPath();
    ctx.roundRect(x + pad, y + pad, w, h, r);
    ctx.fillStyle = "#6a4a2c";
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x + pad + 4, y + pad + 4, w - 8, h - 8, r - 3);
    ctx.fillStyle = "#f6ecd2";
    ctx.fill();
    ctx.fillStyle = "#5a3a1e";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // As big as fits, a long name a little smaller.
    let size = 38;
    const font = (px: number) => `800 ${px}px Nunito, system-ui, sans-serif`;
    ctx.font = font(size);
    while (size > 16 && ctx.measureText(name).width > w - 24) ctx.font = font(--size);
    ctx.fillText(name, x + SLOT_W / 2, y + SLOT_H / 2 + 1, w - 20);
    page.texture.needsUpdate = true;
  }

  dispose(): void {
    for (const p of this.pages) {
      p.texture.dispose();
      p.material.dispose();
    }
    this.pages.length = 0;
    this.plates.clear();
  }
}
