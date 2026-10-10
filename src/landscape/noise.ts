import { rng } from "../lib/rng";

/** Seeded smooth 2D value noise in [0, 1] (lattice of random values, smoothstep interpolation). */
export function valueNoise(seed: number): (x: number, y: number) => number {
  const random = rng(seed);
  const SIZE = 256;
  const table = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < table.length; i++) table[i] = random();
  const at = (ix: number, iy: number) => table[(((iy % SIZE) + SIZE) % SIZE) * SIZE + (((ix % SIZE) + SIZE) % SIZE)];
  return (x, y) => {
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
