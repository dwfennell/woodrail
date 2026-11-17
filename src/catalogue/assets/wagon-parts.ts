import { Group, type Material, type Mesh } from "three";
import { TOY, type Kit } from "../kit";

/**
 * Parts the code-modelled wagons share (the mail and sorting vans, the cold van, the tank wagons): what makes a box
 * on wheels read as a railway wagon. All small and plain (square-edged boxes, few segments): a wagon stays near 2,000
 * triangles.
 */

/** A van's roof, curved across the van: `len` long, `w` across, `rise` high at its middle, its eaves on y = `y`. */
export function archedRoof(k: Kit, mat: Material, len: number, w: number, rise: number, y: number): Mesh {
  const n = 14;
  const outline: [number, number][] = [[-w / 2, 0]];
  // (A lip at the eaves, then the arc.)
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * (1 - i / n);
    outline.push([(Math.cos(a) * w) / 2, 1.2 + Math.sin(a) * (rise - 1.2)]);
  }
  outline.push([w / 2, 0]);
  const roof = k.extrude(mat, outline, len, 0, y, 0, 0.5);
  roof.rotation.y = Math.PI / 2;
  return roof;
}

/** A round-headed buffer on each side of a wagon's end (`end` +1 front, −1 back), on its deck's end. */
export function buffers(k: Kit, len: number, end: 1 | -1, y: number): Group {
  const g = new Group();
  for (const z of [-9.5, 9.5]) {
    g.add(k.cylX(k.paint(TOY.black), 1.1, 3, end * (len / 2 - 2.6), y, z, 10));
    g.add(k.cylX(k.metal, 2.2, 1.2, end * (len / 2 - 0.6), y, z, 14));
  }
  return g;
}

/** A handrail up each corner of a wagon's end at `x`, `h` high from `y`. */
export function endRails(k: Kit, x: number, y: number, h = 14, z = 11): Group {
  const g = new Group();
  for (const s of [-1, 1]) g.add(k.box(k.metal, 0.8, h, 0.8, 0, x, y, s * z));
  return g;
}

/** The black box slung under a wagon between its wheels. */
export const underBox = (k: Kit): Mesh => k.box(k.paint(TOY.black), 18, 4.5, 20, 0.8, 0, 6.5, 0);

/** A step under a door in a wagon's side (`side` ±1), below its deck at `deck`. */
export const doorStep = (k: Kit, side: number, deck: number, x = 0, w = 16): Mesh => k.box(k.paint(TOY.black), w, 1.2, 4, 0.4, x, deck - 3.4, side * 16.4);
