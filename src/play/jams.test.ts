import { describe, it } from "vitest";
import { loadBugMap } from "./bugmap";
import { runJams, type JamsHooks } from "./jams";
import { BEFORE_S, judge, judgeWithBackUp, oTrainsOf, verdictOf, type Judgement } from "../routing/dispatch-shadow";
import type { OTrain } from "../routing/oracle";
import { DispatchShadow } from "../routing/dispatch-stretch-shadow";
import { economyWorld } from "../game/dev-checks";
import { trainState } from "../game/engine-status";
import { buildTrain, DISPATCH_STATES, judgeStretch, search, snapOf, stretchOf, type Snap, type StretchJudgement } from "../routing/stretch";

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

/** Decision times (ms): p50, p98, max. */
const msOf = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => (s.length === 0 ? 0 : Number(s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(3)));
  return { n: s.length, p50: at(0.5), p98: at(0.98), max: s.length ? Number(s[s.length - 1].toFixed(3)) : 0 };
};

describe.skipIf(!ENV.JAMS)("the jams bar: the reference maps, each jam cleared as a player would", () => {
  // (JAMS_SEEDS: each map run that many times, seeds 1…n (`startsOf`: a seeded run's trains set going a few seconds
  // apart), a line each.)
  // (JAMS_RUNS: "map@seed,…", the runs themselves (scripts/jams.mjs shards them so).)
  const SEEDS = Math.max(1, Number(ENV.JAMS_SEEDS ?? 1));
  const runs: [string, number][] = ENV.JAMS_RUNS
    ? ENV.JAMS_RUNS.split(",").map((x) => [x.slice(0, x.lastIndexOf("@")), Number(x.slice(x.lastIndexOf("@") + 1))])
    : Object.keys(MAPS).flatMap((f) => Array.from({ length: SEEDS }, (_, i) => [f, i + 1] as [string, number]));
  for (const [file, seed] of runs) {
    const text = MAPS[file];
    if (text === undefined || (ONLY && !ONLY.has(file))) continue;
    it(SEEDS > 1 || ENV.JAMS_RUNS ? `${file} seed ${seed}` : file, async () => {
      const { world } = await loadBugMap(text);
      // (JAMS_DISPATCHER: the dispatcher acting (§8 step 2), in place of sections' holds.)
      // (Else off, though the map's save had it on (a user's beta game): the bar's main run is the dispatcher off.)
      world.economy.useDispatcher(!!ENV.JAMS_DISPATCHER);
      if (ENV.JAMS_DISPATCHER && ENV.JAMS_DEBUG) world.economy.dispatcher!.debug = true;
      const t0 = performance.now();
      // (JAMS_SHADOW: the dispatcher's first report (routing/dispatch-shadow.ts): each jam judged now and as it stood
      // `BEFORE_S` before it began, from where every train stood each second.)
      const shadow: { at: number; engine: number; verdict: string; now: Judgement; before: Judgement | null; backUp?: { best: number; by: number; tried: number; ms: number } }[] = [];
      const hooks: JamsHooks = {};
      if (ENV.JAMS_SHADOW) {
        const kept = new Map<number, OTrain[]>();
        hooks.second = (now) => {
          kept.set(now, oTrainsOf(world.layout, world.sim, world.economy));
          kept.delete(now - BEFORE_S - 90);
        };
        hooks.jam = (now, engine, since) => {
          const trains = oTrainsOf(world.layout, world.sim, world.economy);
          const j = judge(world.layout, trains);
          const then = kept.get(since - BEFORE_S);
          const b = j.best >= j.trains || !then ? null : judge(world.layout, then);
          const verdict = verdictOf(j, b);
          // (Neither: does one back-up keep more going? Only where the search finished: a capped one says nothing.)
          const backUp = verdict === "layout" && !j.capped ? judgeWithBackUp(world.layout, trains, j) : undefined;
          shadow.push({ at: now, engine, verdict: backUp && backUp.best > j.best ? "backup" : verdict, now: j, before: b, ...(backUp ? { backUp } : {}) });
        };
      }
      // (JAMS_STRETCH: the per-stretch search's judgement of each jam (routing/stretch.ts): now, as it stood `BEFORE_S`
      // before it began, and with one back-up.)
      const stretch: { at: number; engine: number; verdict: string; now: StretchJudgement | null; before: StretchJudgement | null; decide?: { build: number; ms: number; states: number; capped: boolean; trains: number; value: number; of: number }; snaps?: Snap[] }[] = [];
      if (ENV.JAMS_STRETCH) {
        const kept = new Map<number, Snap[]>();
        const second = hooks.second;
        hooks.second = (now) => {
          second?.(now);
          kept.set(now, snapOf(world.layout, world.sim, world.economy));
          kept.delete(now - BEFORE_S - 90);
        };
        const jam = hooks.jam;
        hooks.jam = (now, engine, since) => {
          jam?.(now, engine, since);
          const snaps = snapOf(world.layout, world.sim, world.economy);
          // (A dispatcher's decision here: its trains built (the dispatcher keeps them, cached), then one search at its cap.)
          const t0 = performance.now();
          const trains = snaps.map((x) => buildTrain(world.layout, x));
          const t1 = performance.now();
          const k = trains.findIndex((t) => t.key === engine);
          const d = k < 0 ? null : search(trains, stretchOf(trains, k), { cap: DISPATCH_STATES, backUps: true });
          const t2 = performance.now();
          const decide = d ? { build: t1 - t0, ms: t2 - t1, states: d.states, capped: d.capped, trains: stretchOf(trains, k).length, value: d.value, of: d.of } : undefined;
          const j = judgeStretch(world.layout, snaps, engine);
          const then = kept.get(since - BEFORE_S);
          const all = (x: StretchJudgement | null) => !!x && x.value >= x.of;
          const b = !j || all(j) || !then ? null : judgeStretch(world.layout, then, engine, j.keys);
          const verdict = !j ? "none" : all(j) ? (j.plain >= j.of ? "resolvable" : "detour") : all(b) ? "avoidable" : j.backUp && j.backUp.value > j.value ? "backup" : j.capped || b?.capped ? "unknown" : "layout";
          stretch.push({ at: now, engine, verdict, now: j, before: b, decide, ...(ENV.JAMS_STRETCH_DUMP ? { snaps } : {}) });
        };
      }
      // (JAMS_DISPATCH: the dispatcher's grant/hold model in shadow beside today's rules (dispatch-stretch-shadow.ts).)
      let dispatch: DispatchShadow | null = null;
      if (ENV.JAMS_DISPATCH) {
        const eco = world.economy;
        const live = economyWorld(eco);
        dispatch = new DispatchShadow({
          layout: world.layout,
          sim: world.sim,
          route: (e) => {
            const route = eco.routeOf(e);
            if (!route || route.stops.length === 0) return null;
            const stops = route.stops.map((x) => eco.depot(x.depotId)?.pieceId ?? -1);
            return stops.every((p) => p >= 0) ? { stops, next: route.next, at: !!route.at } : null;
          },
          busy: (t, e) => live.busy!(t, e),
          stuck: (e) => !!eco.stalls.stuckOf(e),
          why: (t, e) => {
            const found = eco.sim.findCar(e);
            const st = trainState(eco.sim, eco, t, found ? found.train.cars[found.index].lever : 0);
            return st.kind === "stuck" ? `stuck:${st.why}` : st.kind;
          },
        });
        const tick = hooks.tick;
        hooks.tick = () => {
          tick?.();
          dispatch!.tick();
        };
      }
      const r = runJams(world, SECONDS, hooks, seed);
      const line = { map: file, seed, jams: r.jams, arrivals: r.arrivals, byEngine: Object.fromEntries(Object.entries(r.byEngine).map(([e, n]) => [world.sim.nameOf(Number(e)) || e, n])), longestStand: r.longestStand, firstJam: r.firstJam, stuckBefore: r.stuckBefore, firstBreak: r.firstBreak, seconds: r.seconds, ms: Math.round(performance.now() - t0), log: r.log, ...(ENV.JAMS_SHADOW ? { shadow } : {}), ...(ENV.JAMS_STRETCH ? { stretch } : {}), ...(dispatch ? { dispatch: dispatch.summary() } : {}), ...(world.economy.dispatcher ? { dispatcher: { decisions: world.economy.dispatcher.decisions, grants: world.economy.dispatcher.grants, detours: world.economy.dispatcher.detours, heldBlocked: world.economy.dispatcher.heldBlocked, ms: msOf(world.economy.dispatcher.decisionMs), heldOrder: world.economy.dispatcher.heldOrder, notes: world.economy.dispatcher.notes, perTrain: Object.fromEntries(world.economy.dispatcher.perTrain), offWay: world.economy.dispatcher.offWay, givenBack: world.economy.dispatcher.givenBack, offNotes: world.economy.dispatcher.offNotes } } : {}) };
      (globalThis as { process?: { stdout: { write(s: string): void } } }).process?.stdout.write(`\nJAMS ${JSON.stringify(line)}\n`);
    }, 3_600_000);
  }
});
