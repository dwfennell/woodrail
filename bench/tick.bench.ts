/**
 * The sim tick's cost on the bug maps (src/play/bugmaps/*.txt), headless: each map loaded as the game loads its save,
 * run `TICK_SECONDS` game seconds (default 120) of `sim.tick()` + `economy.tick()` at 120 Hz, no invariants. Prints
 * µs a tick per map, and the trains on it. `npm run bench:tick` (a plain Node bundle, as bench/track.bench.ts).
 */
import { loadBugMap } from "../src/play/bugmap";
import { SIM_HZ } from "../src/sim";
import { loadSaveSchemas } from "../src/persist/schemas";
import { loadCarver } from "../src/render/carver";

await Promise.all([loadSaveSchemas(), loadCarver()]);

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MAPS = import.meta.glob("../src/play/bugmaps/*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const seconds = Number(ENV.TICK_SECONDS ?? 120);
const only = ENV.TICK_MAP;
const rows: Record<string, unknown>[] = [];
for (const [path, text] of Object.entries(MAPS)) {
  const f = path.split("/").pop()!;
  if (only && !f.includes(only)) continue;
  const { world } = await loadBugMap(text);
  const trains = world.sim.trainIds().length;
  // (Warm up: the first ticks compile and fill caches.)
  for (let i = 0; i < SIM_HZ * 5; i++) {
    world.sim.tick();
    world.economy.tick();
  }
  const n = Math.round(seconds * SIM_HZ);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    world.sim.tick();
    world.economy.tick();
  }
  const ms = performance.now() - t0;
  rows.push({ map: f, trains, "µs/tick": ((ms * 1000) / n).toFixed(1) });
}
console.table(rows);
