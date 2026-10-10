import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { rng } from "../lib/rng";

export { rng };

/** Tileable 2D value noise over a period (in lattice cells). */
function makeNoise(seed: number, period: number): (x: number, y: number) => number {
  const r = rng(seed);
  const table = new Float32Array(period * period);
  for (let i = 0; i < table.length; i++) table[i] = r();
  const at = (ix: number, iy: number) => table[(((iy % period) + period) % period) * period + (((ix % period) + period) % period)];
  return (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f);
    f *= 2;
    amp *= 0.5;
  }
  return sum;
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Canvases {
  color: HTMLCanvasElement;
  rough: HTMLCanvasElement;
  bump: HTMLCanvasElement;
}

function canvases(w: number, h: number): Canvases {
  const make = () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  };
  return { color: make(), rough: make(), bump: make() };
}

export interface SurfaceTextures {
  map: Texture;
  roughnessMap: Texture;
  bumpMap: Texture;
}

function toTextures(c: Canvases, repeatX: number, repeatY: number, anisotropy: number): SurfaceTextures {
  const tex = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const t = new CanvasTexture(canvas);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  };
  return { map: tex(c.color, true), roughnessMap: tex(c.rough, false), bumpMap: tex(c.bump, false) };
}

function fill(c: Canvases, w: number, h: number, pixel: (x: number, y: number) => [RGB, number, number]): void {
  const ctxs = [c.color, c.rough, c.bump].map((cv) => cv.getContext("2d")!);
  const imgs = ctxs.map((ctx) => ctx.createImageData(w, h));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [rgb, rough, bump] = pixel(x, y);
      const i = (y * w + x) * 4;
      imgs[0].data[i] = rgb[0];
      imgs[0].data[i + 1] = rgb[1];
      imgs[0].data[i + 2] = rgb[2];
      imgs[0].data[i + 3] = 255;
      const r = clamp01(rough) * 255;
      imgs[1].data[i] = imgs[1].data[i + 1] = imgs[1].data[i + 2] = r;
      imgs[1].data[i + 3] = 255;
      const b = clamp01(bump) * 255;
      imgs[2].data[i] = imgs[2].data[i + 1] = imgs[2].data[i + 2] = b;
      imgs[2].data[i + 3] = 255;
    }
  }
  ctxs.forEach((ctx, k) => ctx.putImageData(imgs[k], 0, 0));
}

/**
 * Beech: pale, fine, straight grain with faint flecks. The texture covers 512 × 128 mm, grain along x (uv.u = distance along track).
 */
export function beechTextures(anisotropy: number): SurfaceTextures {
  const W = 1024;
  const H = 256;
  const c = canvases(W, H);
  const n1 = makeNoise(11, 64);
  const n2 = makeNoise(23, 128);
  const n3 = makeNoise(37, 256);
  const light = hex("#e9c896");
  const dark = hex("#c08c55");
  const fleck = hex("#a8743f");
  fill(c, W, H, (x, y) => {
    const u = x / W;
    const v = y / H;
    const warp = fbm(n1, u * 8, v * 4, 4) * 3.2;
    const g = v * 22 + warp + fbm(n2, u * 3, v * 2, 3) * 1.5;
    const ring = Math.abs(Math.sin(g * Math.PI));
    const band = Math.pow(ring, 6);
    const pores = Math.pow(n3(u * 256, v * 24), 6);
    const flecks = Math.pow(clamp01(n2(u * 64, v * 128) * 1.6 - 0.6), 3);
    let col = mix(light, dark, band * 0.55 + fbm(n1, u * 2, v * 2, 2) * 0.25);
    col = mix(col, fleck, flecks * 0.5 + pores * 0.25);
    return [col, 0.5 + band * 0.12 + pores * 0.2, 0.55 - band * 0.18 - pores * 0.3];
  });
  return toTextures(c, 1 / 512, 1 / 128, anisotropy);
}

/** Oak floorboards: 2048 mm square tile, boards 150 mm wide running along x, staggered butt joints. */
export function oakFloorTextures(anisotropy: number, size = 1024): SurfaceTextures {
  const W = size;
  const H = size;
  const tile = 2048;
  const c = canvases(W, H);
  const n1 = makeNoise(5, 64);
  const n2 = makeNoise(9, 128);
  const r = rng(77);
  const boardW = 150;
  const rows = Math.floor(tile / boardW) + 1;
  const boards: { start: number; tone: number; shift: number }[][] = [];
  for (let row = 0; row < rows; row++) {
    const list: { start: number; tone: number; shift: number }[] = [];
    let x = -r() * 1200;
    while (x < tile) {
      list.push({ start: x, tone: r(), shift: r() * 100 });
      x += 700 + r() * 900;
    }
    boards.push(list);
  }
  const base = hex("#b07c4c");
  const darker = hex("#7d522d");
  const honey = hex("#c8955e");
  fill(c, W, H, (px, py) => {
    const mmX = (px / W) * tile;
    const mmY = (py / H) * tile;
    const row = Math.floor(mmY / boardW);
    const inRow = mmY - row * boardW;
    const list = boards[row % boards.length];
    let b = list[0];
    for (const cand of list) if (cand.start <= mmX) b = cand;
    const along = mmX - b.start;
    const edgeDist = Math.min(inRow, boardW - inRow, Math.abs(along), 1e9);
    const gap = edgeDist < 1.6 ? 1 : 0;
    const u = (mmX + b.shift * 10) / tile;
    const v = (mmY + b.shift) / tile;
    const g = v * 140 + fbm(n1, u * 6, v * 30, 4) * 4;
    const ring = Math.pow(Math.abs(Math.sin(g * Math.PI)), 3);
    const streak = fbm(n2, u * 60, v * 8, 3);
    let col = mix(base, b.tone > 0.5 ? honey : darker, Math.abs(b.tone - 0.5) * 0.9);
    col = mix(col, darker, ring * 0.35 + streak * 0.2);
    if (gap) col = mix(col, hex("#2a1a10"), 0.85);
    const bevel = clamp01(1 - edgeDist / 4);
    return [col, gap ? 0.9 : 0.38 + ring * 0.1 + streak * 0.15, gap ? 0 : 0.6 - bevel * 0.35 - ring * 0.1];
  });
  return toTextures(c, 1 / tile, 1 / tile, anisotropy);
}

/** Matt painted plaster wall with faint roller texture. */
export function wallTextures(anisotropy: number): SurfaceTextures {
  const W = 512;
  const H = 512;
  const c = canvases(W, H);
  const n1 = makeNoise(51, 128);
  const paint = hex("#efe6d8");
  fill(c, W, H, (px, py) => {
    const f = fbm(n1, (px / W) * 64, (py / H) * 64, 3);
    return [mix(paint, hex("#e2d6c4"), f * 0.4), 0.85, f];
  });
  return toTextures(c, 1 / 1000, 1 / 1000, anisotropy);
}

/**
 * Felt: a tile of short, randomly oriented fibres (about 0.2 mm per pixel at the default repeat) for the bump and a
 * matching speckle in the colour map. Broad colour mottling is added separately in world space (see `mottleTexture`).
 */
export function feltTextures(anisotropy: number, base: string, repeat: number): { map: Texture; bumpMap: Texture } {
  const N = 512;
  const bump = document.createElement("canvas");
  bump.width = bump.height = N;
  const bc = bump.getContext("2d")!;
  bc.fillStyle = "#808080";
  bc.fillRect(0, 0, N, N);
  const r = rng(91);
  bc.lineCap = "round";
  for (let k = 0; k < 9000; k++) {
    const x = r() * N;
    const y = r() * N;
    const a = r() * Math.PI * 2;
    const len = 6 + r() * 22;
    const bend = (r() - 0.5) * len * 0.6;
    const light = r() < 0.5;
    bc.strokeStyle = light ? `rgba(255,255,255,${0.1 + r() * 0.16})` : `rgba(0,0,0,${0.08 + r() * 0.14})`;
    bc.lineWidth = 0.6 + r() * 1.1;
    const ex = Math.cos(a) * len;
    const ey = Math.sin(a) * len;
    const mx = ex / 2 - Math.sin(a) * bend;
    const my = ey / 2 + Math.cos(a) * bend;
    // Draw wrapped copies near the edges so the tile repeats seamlessly.
    for (const ox of x < 32 ? [0, N] : x > N - 32 ? [0, -N] : [0]) {
      for (const oy of y < 32 ? [0, N] : y > N - 32 ? [0, -N] : [0]) {
        bc.beginPath();
        bc.moveTo(x + ox, y + oy);
        bc.quadraticCurveTo(x + ox + mx, y + oy + my, x + ox + ex, y + oy + ey);
        bc.stroke();
      }
    }
  }
  const bi = bc.getImageData(0, 0, N, N);
  const color = document.createElement("canvas");
  color.width = color.height = N;
  const cc = color.getContext("2d")!;
  const ci = cc.createImageData(N, N);
  const rgb = hex(base);
  for (let i = 0; i < N * N * 4; i += 4) {
    const k = 0.86 + (bi.data[i] / 255) * 0.26;
    ci.data[i] = Math.min(255, rgb[0] * k);
    ci.data[i + 1] = Math.min(255, rgb[1] * k);
    ci.data[i + 2] = Math.min(255, rgb[2] * k);
    ci.data[i + 3] = 255;
  }
  cc.putImageData(ci, 0, 0);
  const make = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  };
  return { map: make(color, true), bumpMap: make(bump, false) };
}

/** Soft, tileable low-frequency noise (linear, centred on 0.5) for broad colour variation across large surfaces. */
export function mottleTexture(): Texture {
  const N = 128;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(N, N);
  const n = makeNoise(37, 8);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = fbm(n, (x / N) * 8, (y / N) * 8, 4);
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp01(v) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = LinearSRGBColorSpace;
  return t;
}

/** Dashed thread for the stitched hem: cream stitches along u on a transparent background. */
export function stitchTexture(anisotropy: number): Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 16;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 16);
  ctx.fillStyle = "#efe6cf";
  ctx.beginPath();
  ctx.roundRect(8, 5, 40, 6, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(10, 10, 36, 1.5);
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}
