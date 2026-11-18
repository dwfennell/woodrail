import { describe, it } from "vitest";
import { loadBugMap } from "./bugmap";
import { runJams, type JamsHooks } from "./jams";
import { BEFORE_S, judge, oTrainsOf, verdictOf, type Judgement } from "../routing/dispatch-shadow";
import type { OTrain } from "../routing/oracle";

/**
 * The jams bar's runs (src/play/jams.ts), one a reference map: `npm run jams` (scripts/jams.mjs) runs them sharded and
 * prints one `JAMS {json}` line each. Skipped unless JAMS=1. JAMS_MAPS: the maps (file names, comma separated, default
 * all); JAMS_SECONDS: how long (default 1800).
 */
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MAPS = Object.fromEntries(
  Object.entries(import.meta.glob("./bugmaps/reference/*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>).map(([k, v]) => [k.split("/").pop()!, v]),
);
const ONLY = ENV.JAMS_MAPS ? new Set(ENV.JAMS_MAPS.split(",")) : null;
const SECONDS = Number(ENV.JAMS_SECONDS ?? 1800);

describe.skipIf(!ENV.JAMS)("the jams bar: the reference maps, each jam cleared as a player would", () => {
  for (const [file, text] of Object.entries(MAPS)) {
    if (ONLY && !ONLY.has(file)) continue;
    it(file, async () => {
      const { world } = await loadBugMap(text);
      const t0 = performance.now();
      // (JAMS_SHADOW: the dispatcher's first report (routing/dispatch-shadow.ts): each jam judged now and as it stood
      // `BEFORE_S` before it began, from where every train stood each second.)
      const shadow: { at: number; engine: number; verdict: string; now: Judgement; before: Judgement | null }[] = [];
      const hooks: JamsHooks = {};
      if (ENV.JAMS_SHADOW) {
        const kept = new Map<number, OTrain[]>();
        hooks.second = (now) => {
          kept.set(now, oTrainsOf(world.layout, world.sim, world.economy));
          kept.delete(now - BEFORE_S - 90);
        };
        hooks.jam = (now, engine, since) => {
          const j = judge(world.layout, oTrainsOf(world.layout, world.sim, world.economy));
          const then = kept.get(since - BEFORE_S);
          const b = j.best >= j.trains || !then ? null : judge(world.layout, then);
          shadow.push({ at: now, engine, verdict: verdictOf(j, b), now: j, before: b });
        };
      }
      const r = runJams(world, SECONDS, hooks);
      const line = { map: file, jams: r.jams, arrivals: r.arrivals, longestStand: r.longestStand, firstBreak: r.firstBreak, seconds: r.seconds, ms: Math.round(performance.now() - t0), log: r.log, ...(ENV.JAMS_SHADOW ? { shadow } : {}) };
      (globalThis as { process?: { stdout: { write(s: string): void } } }).process?.stdout.write(`\nJAMS ${JSON.stringify(line)}\n`);
    }, 3_600_000);
  }
});
