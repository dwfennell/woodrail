import { describe, expect, it } from "vitest";
import { stopLine } from "../../game/lines";
import { SIM_HZ } from "../../sim";
import { loadBugMap } from "../bugmap";

/**
 * Stall scan (opt-in: STALL_SCAN=1): every saved map here (the bug maps, the perf harness's maps) run 300 s as saved and
 * again with every route taken off (its trains hand-run), counting the time any train is said stuck, the stalls begun,
 * the trains that gave way and the routed trains' stops. A route mustn't make a map stall where hand-run it doesn't.
 *
 *   STALL_SCAN=1 npx vitest run --silent=false src/play/bugmaps/stall-scan.test.ts
 */
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MAPS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(import.meta.glob("./*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>).map(([k, v]) => [k.slice(2), v])),
  ...Object.fromEntries(Object.entries(import.meta.glob("../../../tools/perf/maps/*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>).map(([k, v]) => [k.split("/").pop()!, v])),
};
const SECONDS = Number(ENV.STALL_SCAN_SECONDS ?? 300);

async function scan(text: string, routes: boolean) {
  const { world } = await loadBugMap(text);
  const eco = world.economy;
  const routed = [...eco.lineIdOf.keys()];
  if (!routes) for (const e of routed) stopLine(eco, e);
  let stuck = 0;
  let stops = 0;
  const at = new Map<number, boolean>();
  for (let i = 0; i < SECONDS * SIM_HZ; i++) {
    world.sim.tick();
    eco.tick();
    if (eco.stalls.count > 0) stuck++;
    for (const e of eco.lineIdOf.keys()) {
      const now = !!eco.routeOf(e)?.at;
      if (now && !at.get(e)) stops++;
      at.set(e, now);
    }
  }
  const gave = (eco.stalls as unknown as { gaveWay?: number }).gaveWay ?? 0;
  return { trains: world.sim.trainIds().length, routed: routed.length, stuck: stuck / SIM_HZ, begun: eco.stalls.begun, gave, stops };
}

describe.skipIf(!ENV.STALL_SCAN)("stall scan over the saved maps", () => {
  for (const [name, text] of Object.entries(MAPS))
    it(name, async () => {
      const r = await scan(text, true);
      const h = await scan(text, false);
      console.log(`scan ${name}: ${r.trains} trains, ${r.routed} routed; as saved: stuck ${r.stuck.toFixed(0)} s, ${r.begun} stalls, ${r.gave} gave way, ${r.stops} stops; routes off: stuck ${h.stuck.toFixed(0)} s, ${h.begun} stalls, ${h.gave} gave way`);
      expect(r.stuck > 0 && h.stuck === 0, `${name}: a route makes it stall`).toBe(false);
    }, 600_000);
});
