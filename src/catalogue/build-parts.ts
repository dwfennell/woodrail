import { Color, CylinderGeometry, Group, Mesh, type Material, type Object3D } from "three";
import { TOY, type Kit } from "./kit";

/**
 * Parts shared by the grand projects, the secret sites and the town paths' landmarks (`assets/grand.ts`,
 * `assets/secrets.ts`, `assets/paths.ts`): building-site dressing (scaffolding, a tower crane, a hoarding, stacks of
 * goods), overgrowth, and a dull palette for a place not found yet. Plain boxes (no rounding) where a part is thin or
 * many, to keep the triangles down: these are big models, drawn as props (merged by material, `PROP_DETAIL`).
 */

/** A thin square-section part (a pole, a board): a plain box, its base on y = `y`. */
export function stick(k: Kit, mat: Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): Mesh {
  return k.box(mat, w, h, d, 0, x, y, z);
}

/**
 * Scaffolding round a `w` × `d` block (centred at x, z), `h` high: poles every ~36 mm along each side, a board walk
 * every 24 mm up on the long sides, and a ladder.
 */
export function scaffold(k: Kit, w: number, d: number, h: number, x = 0, z = 0): Group {
  const g = new Group();
  const pole = k.wood;
  const board = k.paint("#c9a26b");
  const nx = Math.max(2, Math.round(w / 36) + 1);
  const nz = Math.max(2, Math.round(d / 36) + 1);
  const ring: [number, number][] = [];
  for (let i = 0; i < nx; i++) for (const s of [-1, 1]) ring.push([-w / 2 + (w * i) / (nx - 1), (s * d) / 2]);
  for (let i = 1; i < nz - 1; i++) for (const s of [-1, 1]) ring.push([(s * w) / 2, -d / 2 + (d * i) / (nz - 1)]);
  for (const [px, pz] of ring) g.add(stick(k, pole, 2, h, 2, x + px, 0, z + pz));
  for (let y = 22; y < h; y += 24) {
    for (const s of [-1, 1]) {
      g.add(stick(k, board, w + 4, 1.4, 7, x, y, z + s * (d / 2 + 2)));
      g.add(stick(k, pole, w, 1, 1, x, y + 10, z + s * (d / 2 + 5)));
    }
    for (const s of [-1, 1]) g.add(stick(k, board, 7, 1.4, d + 4, x + s * (w / 2 + 2), y, z));
  }
  // A ladder up one end.
  const lx = x + w / 2 + 6;
  for (const lz of [-4, 4]) g.add(stick(k, pole, 1.2, h, 1.2, lx, 0, z + lz));
  for (let y = 6; y < h; y += 8) g.add(stick(k, pole, 1, 1, 8, lx, y, z));
  return g;
}

/** A yellow tower crane `h` high, its jib along x, hook down at `hook` along it. */
export function towerCrane(k: Kit, h: number, jib: number, x = 0, z = 0, ry = 0): Group {
  const g = new Group();
  const y = k.paint(TOY.yellow);
  g.add(k.box(k.paint(TOY.grey), 22, 6, 22, 1, 0, 0, 0));
  for (const [cx, cz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) g.add(stick(k, y, 2, h, 2, cx, 6, cz));
  for (let ty = 18; ty < h; ty += 18) {
    g.add(stick(k, y, 12, 1.2, 1.2, 0, ty, -5), stick(k, y, 12, 1.2, 1.2, 0, ty, 5));
    g.add(stick(k, y, 1.2, 1.2, 12, -5, ty, 0), stick(k, y, 1.2, 1.2, 12, 5, ty, 0));
  }
  g.add(k.box(y, jib, 5, 6, 0.6, jib / 2 - 20, h + 6, 0));
  g.add(k.box(k.paint(TOY.grey), 14, 10, 10, 1, -24, h + 2, 0)); // counterweight
  g.add(k.box(k.paint(TOY.blue), 12, 10, 10, 1.2, 0, h - 6, 8)); // cab
  const hx = jib * 0.7 - 20;
  g.add(stick(k, k.metal, 0.6, 50, 0.6, hx, h - 44, 0));
  g.add(k.box(k.paint(TOY.red), 5, 4, 5, 0.6, hx, h - 48, 0));
  return k.at(g, x, 0, z, ry);
}

/** A board hoarding round a site: a low painted fence on the four sides, a gap for a gate at +x. */
export function hoarding(k: Kit, w: number, d: number, color: string = TOY.blue, x = 0, z = 0): Group {
  const g = new Group();
  const m = k.paint(color);
  for (const s of [-1, 1]) g.add(stick(k, m, w, 12, 2, x, 0, z + (s * d) / 2));
  g.add(stick(k, m, 2, 12, d, x - w / 2, 0, z));
  for (const s of [-1, 1]) g.add(stick(k, m, 2, 12, d / 2 - 16, x + w / 2, 0, z + s * (d / 4 + 8)));
  return g;
}

/** Stacks of goods brought to a site: planks, stone blocks and an iron girder pile, at (x, z). */
export function goodsStacks(k: Kit, x = 0, z = 0): Group {
  const g = new Group();
  for (let i = 0; i < 3; i++) g.add(stick(k, k.wood, 30, 3, 10, x, i * 3, z - 14));
  for (let i = 0; i < 4; i++) g.add(k.box(k.paint("#b9b2a5"), 9, 7, 9, 1, x - 10 + (i % 2) * 10, Math.floor(i / 2) * 7, z + 2));
  for (let i = 0; i < 3; i++) g.add(stick(k, k.paint(TOY.grey), 28, 2.4, 3, x + 8, i * 2.4, z + 14 - i * 1.5));
  return g;
}

/** A low plinth of foundations: a stone slab `w` × `d`, `h` high, centred at (x, z). */
export function plinth(k: Kit, w: number, d: number, h = 6, x = 0, z = 0, color = "#c9c2b4"): Mesh {
  return k.box(k.paint(color), w, h, d, 1.2, x, 0, z);
}

/** A clump of bushes (overgrowth): `n` squashed leaf balls round (x, z), spread over `r`. */
export function bushes(k: Kit, n: number, r: number, x = 0, z = 0, seed = 1, color: string = TOY.leaf): Group {
  const g = new Group();
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * r;
    const size = 6 + rnd() * 6;
    g.add(k.ball(k.paint(i % 3 === 0 ? TOY.green : color), size, x + Math.cos(a) * d, size * 0.5, z + Math.sin(a) * d, 0.75));
  }
  return g;
}

/** A pennant on a pole, its foot at (x, y, z). */
export function pennant(k: Kit, color: string, h = 30, x = 0, y = 0, z = 0): Group {
  const g = new Group();
  g.add(k.cyl(k.wood, 0.9, h, 0, 0, 0, 0.9, 8));
  g.add(k.extrude(k.paint(color), [[0, 0], [14, -4], [0, -8]], 1, 1, h - 1, 0, 0.2));
  g.add(k.ball(k.paint(TOY.yellow), 1.6, 0, h + 1, 0));
  return k.at(g, x, y, z);
}

/** Half a barrel vault along x: radius `r`, `len` long, its springing line on y = `y`. Open at the ends. */
export function vault(k: Kit, mat: Material, r: number, len: number, x = 0, y = 0, z = 0, segments = 12): Mesh {
  const geo = new CylinderGeometry(r, r, len, Math.max(6, Math.round(segments * Math.min(1, k.detail * 1.5))), 1, true, 0, Math.PI);
  geo.rotateZ(Math.PI / 2);
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** The same vault along z. */
export function vaultZ(k: Kit, mat: Material, r: number, len: number, x = 0, y = 0, z = 0, segments = 12): Group {
  const g = new Group();
  g.add(vault(k, mat, r, len, 0, 0, 0, segments));
  g.rotation.y = Math.PI / 2;
  g.position.set(x, y, z);
  return g;
}

/** Arched ribs over a vault along x: `n` half rings of radius `r` spread over `len`. */
export function ribs(k: Kit, mat: Material, r: number, len: number, n: number, x = 0, y = 0, z = 0, tube = 1.4): Group {
  const g = new Group();
  for (let i = 0; i < n; i++) {
    const rib = k.ring(mat, r, tube, 0, 0, 0, true, Math.PI);
    rib.rotation.y = Math.PI / 2;
    rib.position.set(x - len / 2 + (len * i) / Math.max(1, n - 1), y, z);
    g.add(rib);
  }
  return g;
}

/** A colour, dulled toward a mossy grey: how a place looks before it's found. */
export function dull(color: string): string {
  const c = new Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * 0.18, 0.42 + hsl.l * 0.22);
  return `#${c.lerp(new Color("#7f8a74"), 0.35).getHexString()}`;
}

/** Paint for a site: its own colours once found, dulled before. */
export function sitePaint(k: Kit, found: boolean): { paint: (c: string) => Material; wood: Material } {
  return { paint: (c) => k.paint(found ? c : dull(c)), wood: found ? k.wood : k.paint(dull("#d9b98c")) };
}

/** Name a part (for `animate`). */
export function named<T extends Object3D>(o: T, name: string): T {
  o.name = name;
  return o;
}
