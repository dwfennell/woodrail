import { it } from "vitest";
import { generateLandscape, generatePlot } from "./generate";

it("bench", () => {
  const time = (f: () => void, n: number) => {
    for (let k = 0; k < 3; k++) f();
    const t0 = performance.now();
    for (let k = 0; k < n; k++) f();
    return ((performance.now() - t0) / n).toFixed(2);
  };
  let s = 1;
  const start = time(() => generateLandscape(s++), 60);
  s = 1;
  const inland = time(() => generatePlot(s++, -3, 0), 60);
  // Plots one and two out on every side: about half of them coast plots after the coast.
  s = 1;
  let k = 0;
  const ring = [[0, 1], [0, 2], [1, -2], [-2, -3], [2, 0], [-3, 0], [0, -3], [1, 2]];
  const near = time(() => {
    const [px, pz] = ring[k++ % ring.length];
    generatePlot(s++, px, pz);
  }, 80);
  console.log(`BENCH start region ${start} ms, inland plot ${inland} ms, plots near the start ${near} ms`);
});
