import { describe, it } from "vitest";
import { Layout } from "../track";
import { HarnessRun } from "./harness";
import { fuzz } from "./scenarios";
import { oracle, type OTrain } from "./stalls-oracle";
import { oTrains, snapshot, track } from "./stalls-dump";

/**
 * Scratch (docs/agents/stalls-verify-2026-11-10.md): the long fuzz's stalled seeds, each run to its first stall and
 * dumped: the track (piece by piece, with world points for a sketch), each train (where it stands, which way it drives,
 * its route and next stop, who it waits on and why), at the stall and at the end. Skipped unless STALLS_VERIFY is set
 * to a list of seeds ("7,37,94"); writes JSON to STALLS_OUT (default .stalls-verify/). Test-only, changes nothing.
 *
 *   STALLS_VERIFY=7,37 npx vitest run --silent=false src/routing/stalls-verify.test.ts
 */
// (Node's fs, loaded only when run, as bugmaps.test.ts does: the game's tsconfig has no Node types.)
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs")) as { mkdirSync(path: string, o: { recursive: boolean }): void; writeFileSync(path: string, text: string): void };
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = (ENV.STALLS_VERIFY ?? "").split(",").filter(Boolean).map(Number);
const OUT = ENV.STALLS_OUT ?? ".stalls-verify";
const SECONDS = Number(ENV.STALLS_SECONDS ?? 1800);

if (ENV.STALLS_DBG) (globalThis as { DBG?: boolean }).DBG = true;
describe.skipIf(SEEDS.length === 0)("stalls verify: dump stalled fuzz seeds", () => {
  for (const seed of SEEDS)
    it(`seed ${seed}`, async () => {
      const { mkdirSync, writeFileSync } = await fs();
      mkdirSync(OUT, { recursive: true });
      const layout = new Layout();
      const h = new HarnessRun(layout, { ...fuzz(seed, SECONDS), heldFree: true });
      const startTrains = snapshot(h);
      const startTrack = track(layout);
      const startO = oTrains(h);
      let stallO: OTrain[] | null = null;
      let stallAt = -1;
      let atStall: ReturnType<typeof snapshot> | null = null;
      let report = h.run(0);
      for (let s = 0; s < SECONDS; s++) {
        report = h.run(1);
        if (ENV.STALLS_TRACE && s < Number(ENV.STALLS_TRACE)) console.log(`t=${s + 1}: ${snapshot(h).map((x) => ("gone" in x ? "gone" : `t${x.k}@${x.pieces.join(">")} v${x.speed} goal ${x.goal} ${x.sectionsWait ? JSON.stringify(x.sectionsWait).slice(0, 40) : ""}`)).join(" | ")}`);
        if (stallAt < 0 && h.engines.some((e) => h.stalls.stuckOf(e))) {
          stallAt = s + 1;
          atStall = snapshot(h);
          stallO = oTrains(h);
        }
      }
      const end = snapshot(h);
      const atStallO = stallO ?? oTrains(h);
      const o = {
        startAny: oracle(layout, startO, "any"),
        startOwn: oracle(layout, startO, "own"),
        stallAny: oracle(layout, atStallO, "any"),
        stallOwn: oracle(layout, atStallO, "own"),
      };
      const brief = (r: ReturnType<typeof oracle>) => `${r.best}/${startO.length} [${r.bestSet.join(",")}] (${r.states} states${r.capped ? ", CAPPED" : ""})`;
      console.log(`ORACLE seed ${seed}: from start any ${brief(o.startAny)} own ${brief(o.startOwn)}; from stall any ${brief(o.stallAny)} own ${brief(o.stallOwn)}; game stops ${report.arrivals.join("/")}`);
      const doc = { seed, oracle: o, startO, stallO: atStallO, stallAt, start: startTrains, atStall, end, track: startTrack, endTrack: track(layout), arrivals: report.arrivals, begun: report.stalls.begun };
      writeFileSync(`${OUT}/seed-${seed}.json`, JSON.stringify(doc));
      const line = (x: ReturnType<typeof snapshot>[number]) =>
        "gone" in x ? `  train ${x.k}: gone` : `  train ${x.k} (engine ${x.engine}${x.line != null ? `, line ${x.line}` : ", hand-run"}): stops ${JSON.stringify(x.stops)} next ${x.next} goal ${x.goal} | drive ${x.drive} v ${x.speed} pieces ${x.pieces.join(">")} | sec ${JSON.stringify(x.sectionsWait)} router ${JSON.stringify(x.routerWait)} held ${x.heldHow}/${x.heldBy} room ${x.heldForRoom} stuck ${JSON.stringify(x.stuck)}`;
      console.log(`seed ${seed}: stall at ${stallAt} s; stops ${report.arrivals.join("/")}\n start:\n${startTrains.map(line).join("\n")}\n at stall:\n${(atStall ?? []).map(line).join("\n")}`);
    }, 600_000);
});
