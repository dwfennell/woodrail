import { CanvasTexture, Color, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { rng } from "../lib/rng";
import { gpuOnlyEnabled } from "./gpu-only";

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

/**
 * Generated pixels kept between visits (per build, in the browser's cache: see `piece-cache.ts`), by name: the beech's
 * three maps and the felt's fibres. Given by `useTextureCache` before the materials are made; what was made afresh
 * comes back from `texturesMade`, to be kept. (Making the beech took ~0.5 s of a load on a desktop, ~2 s on a phone.)
 */
let cached: Map<string, Uint8ClampedArray[]> = new Map();
const made = new Map<string, Uint8ClampedArray[]>();
/** Names made afresh (not from the cache) since `texturesMade` last said so. */
const fresh = new Set<string>();

/** The pixels kept from an earlier visit (or none), for the textures made from now on. */
export function useTextureCache(pixels: Map<string, Uint8ClampedArray[]> | null): void {
  cached = pixels ?? new Map();
}

/** Everything kept and made so far (to keep for next time), or null when nothing was made afresh. */
export function texturesMade(): Map<string, Uint8ClampedArray[]> | null {
  if (fresh.size === 0) return null;
  fresh.clear();
  const all = new Map(cached);
  for (const [k, v] of made) all.set(k, v);
  return all;
}

/**
 * Let go of the pixels kept for the texture cache (once `texturesMade` has handed them over to be saved, and the
 * game's materials are made): a few MB the page needn't hold. Textures made after this are generated afresh.
 */
export function forgetTextureCache(): void {
  cached = new Map();
  made.clear();
  fresh.clear();
}

/**
 * Half the size, for the mobile tier: what the GPU's first mip level would have been anyway, so it looks the same at
 * play zoom on a phone (only right up close is the grain a little softer), in a quarter of the memory.
 */
function halved(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(1, c.width >> 1);
  out.height = Math.max(1, c.height >> 1);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

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
    return freedOnUpload(t);
  };
  return { map: tex(c.color, true), roughnessMap: tex(c.rough, false), bumpMap: tex(c.bump, false) };
}

function fill(c: Canvases, w: number, h: number, name: string, pixel: (x: number, y: number) => [RGB, number, number]): void {
  const ctxs = [c.color, c.rough, c.bump].map((cv) => cv.getContext("2d")!);
  const imgs = ctxs.map((ctx) => ctx.createImageData(w, h));
  // (Made already on this page, as the loading screen's toys made it, or kept from an earlier visit.)
  const kept = made.get(name) ?? cached.get(name);
  if (kept && kept.length === 3 && kept.every((d) => d.length === w * h * 4)) {
    imgs.forEach((img, k) => img.data.set(kept[k]));
    ctxs.forEach((ctx, k) => ctx.putImageData(imgs[k], 0, 0));
    return;
  }
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
  made.set(name, imgs.map((img) => img.data.slice()));
  fresh.add(name);
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
  fill(c, W, H, `beech-${W}x${H}`, (x, y) => {
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

const FELT_N = 512;
let fibres: { bump: HTMLCanvasElement; pixels: ImageData } | null = null;

/** The felt's fibres (a bump tile), drawn once and shared by every felt colour: only the colour maps differ. */
function feltFibres(): { bump: HTMLCanvasElement; pixels: ImageData } {
  if (fibres) return fibres;
  const N = FELT_N;
  const bump = document.createElement("canvas");
  bump.width = bump.height = N;
  // (Read back once drawn: kept on the CPU, so the read doesn't wait on the GPU for 9,000 strokes.)
  const bc = bump.getContext("2d", { willReadFrequently: true })!;
  const kept = cached.get("felt-fibres")?.[0];
  if (kept && kept.length === N * N * 4) {
    const img = bc.createImageData(N, N);
    img.data.set(kept);
    bc.putImageData(img, 0, 0);
    fibres = { bump, pixels: img };
    return fibres;
  }
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
  fibres = { bump, pixels: bc.getImageData(0, 0, N, N) };
  made.set("felt-fibres", [fibres.pixels.data]);
  fresh.add("felt-fibres");
  return fibres;
}

/** The felt's colour speckle goes from this much to this much more of its colour (with the fibres' light and shade). */
const SPECKLE_LOW = 0.86;
const SPECKLE_HIGH = 1.12;
/** The speckle's map holds (k / SPECKLE_HIGH)^SPECKLE_GAMMA, the felt's colour SPECKLE_HIGH^SPECKLE_GAMMA more of itself. */
const SPECKLE_GAMMA = 2.2;

/** The felt's two tiles, shared by every felt of a set of materials (its own repeat a clone each: one upload). */
export interface FeltTiles {
  bump: Texture;
  speckle: Texture;
}

/** A set of materials' felt tiles (its own canvases: nothing shared with another renderer's set). */
export function feltTileTextures(small: boolean): FeltTiles {
  const { bump: fibreCanvas, pixels: bi } = feltFibres();
  // The speckle, the same for every colour: the colour is the material's (see `feltTextures`).
  const speckle = document.createElement("canvas");
  speckle.width = speckle.height = FELT_N;
  const sc = speckle.getContext("2d")!;
  const si = sc.createImageData(FELT_N, FELT_N);
  for (let i = 0; i < FELT_N * FELT_N * 4; i += 4) {
    const k = SPECKLE_LOW + (bi.data[i] / 255) * (SPECKLE_HIGH - SPECKLE_LOW);
    // Stored as sRGB: three decodes it to (k / SPECKLE_HIGH)^SPECKLE_GAMMA, near enough (within 2 levels of 255).
    const v = Math.round(linearToSrgb((k / SPECKLE_HIGH) ** SPECKLE_GAMMA) * 255);
    si.data[i] = si.data[i + 1] = si.data[i + 2] = v;
    si.data[i + 3] = 255;
  }
  sc.putImageData(si, 0, 0);
  const make = (c: HTMLCanvasElement, srgb: boolean) => {
    const tex = new CanvasTexture(c);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
    return freedOnUpload(tex);
  };
  // (The fibres' canvas is the page's, drawn once: this set's is a copy, halved or not.)
  return { bump: make(small ? halved(fibreCanvas) : copied(fibreCanvas), false), speckle: make(small ? halved(speckle) : speckle, true) };
}

function copied(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = c.width;
  out.height = c.height;
  out.getContext("2d")!.drawImage(c, 0, 0);
  return out;
}

/**
 * Free a generated texture's canvas once the GPU has it (while drawn-only geometry is freed too, `gpuOnlyEnabled`:
 * a lost context is then restored by reloading, never by uploading again). A canvas's pixels are the page's memory
 * as well as the GPU's. Clones share the upload (same source and settings), so they need it no more than it does.
 */
export function freedOnUpload(t: Texture): Texture {
  t.onUpdate = () => {
    if (!gpuOnlyEnabled()) return;
    const c = t.image as HTMLCanvasElement | undefined;
    if (c && "width" in c && c.width > 1) {
      c.width = 1;
      c.height = 1;
    }
  };
  return t;
}

function linearToSrgb(l: number): number {
  return l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
}

/**
 * Felt: a tile of short, randomly oriented fibres (about 0.2 mm per pixel at the default repeat) for the bump and a
 * matching speckle in the colour map. Broad colour mottling is added separately in world space (see `mottleTexture`).
 * Every felt shares the two tiles (one upload each): its colour is `color`, for the material, which the speckle
 * shades as a colour map of its own once did (to within 2 levels of 255).
 */
export function feltTextures(anisotropy: number, base: string, repeat: number, tiles: FeltTiles): { map: Texture; bumpMap: Texture; color: Color } {
  const clone = (t: Texture) => {
    const c = t.clone();
    c.repeat.set(repeat, repeat);
    c.anisotropy = anisotropy;
    return c;
  };
  const color = new Color(base).multiplyScalar(SPECKLE_HIGH ** SPECKLE_GAMMA);
  return { map: clone(tiles.speckle), bumpMap: clone(tiles.bump), color };
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
