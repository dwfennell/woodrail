/**
 * The dispatcher's per-stretch search timed in plain Node (dispatcher spec §5's budget: one decision ≤ 1 ms at the cap;
 * docs/superpowers/specs/2026-11-18-dispatcher.md), on the reference maps (src/play/bugmaps/reference/): each map run as
 * the jams bar runs it (`runJams`), the dispatcher's grant/hold model in shadow beside today's rules
 * (`DispatchShadow`), and each jam judged by the per-stretch judge. Prints, per map, the disagreements by kind and the
 * decisions' cost (p50, p98, max), and one `DISPATCH {json}` line a map.
 *
 *   npm run bench:dispatch                       (every map, 1800 s)
 *   DISPATCH_MAP=wren DISPATCH_SECONDS=600 npm run bench:dispatch
 *
 * `npm run dispatch:report` runs it sharded over the cores.
 */
import { loadBugMap } from "../src/play/bugmap";
import { loadSaveSchemas } from "../src/persist/schemas";
import { loadCarver } from "../src/render/carver";
import { runJams } from "../src/play/jams";
import { economyWorld } from "../src/game/dev-checks";
import { trainState } from "../src/game/engine-status";
import { DispatchShadow } from "../src/routing/dispatch-stretch-shadow";
import { judgeStretch, snapOf, type Snap, type StretchJudgement } from "../src/routing/stretch";

await Promise.all([loadSaveSchemas(), loadCarver()]);

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MAPS = import.meta.glob("../src/play/bugmaps/reference/*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const seconds = Number(ENV.DISPATCH_SECONDS ?? 1800);
const only = ENV.DISPATCH_MAP ? ENV.DISPATCH_MAP.split(",") : null;
/** How far back (s) "before" looks: from when the jam's train was first stuck (as the oracle's report, BEFORE_S). */
const BEFORE_S = 30;

const rows: Record<string, unknown>[] = [];
for (const [path, text] of Object.entries(MAPS)) {
  const f = path.split("/").pop()!;
  if (only && !only.some((o) => f.includes(o))) continue;
  const { world } = await loadBugMap(text);
  const eco = world.economy;
  const live = economyWorld(eco);
  const shadow = new DispatchShadow(
    {
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
    },
    !!ENV.DISPATCH_PROBE,
  );
  // Each jam judged: now, `BEFORE_S` before, with one back-up.
  const kept = new Map<number, Snap[]>();
  const jams: { at: number; engine: number; verdict: string; now: StretchJudgement | null; before: StretchJudgement | null; names: string[] }[] = [];
  const t0 = performance.now();
  const r = runJams(world, seconds, {
    tick: () => shadow.tick(),
    second: (now) => {
      kept.set(now, snapOf(world.layout, world.sim, eco));
      kept.delete(now - BEFORE_S - 90);
    },
    jam: (now, engine, since) => {
      const j = judgeStretch(world.layout, snapOf(world.layout, world.sim, eco), engine);
      const then = kept.get(since - BEFORE_S);
      const all = (x: StretchJudgement | null) => !!x && x.value >= x.of;
      const b = !j || all(j) || !then ? null : judgeStretch(world.layout, then, engine, j.keys);
      const verdict = !j ? "none" : all(j) ? (j.plain >= j.of ? "resolvable" : "detour") : all(b) ? "avoidable" : j.backUp && j.backUp.value > j.value ? "backup" : j.capped || b?.capped ? "unknown" : "layout";
      jams.push({ at: now, engine, verdict, now: j, before: b, names: (j?.keys ?? [engine]).map((k) => world.sim.nameOf(k)) });
    },
  });
  const ms = performance.now() - t0;
  const sum = shadow.summary();
  const verdicts: Record<string, number> = {};
  for (const j of jams) verdicts[j.verdict] = (verdicts[j.verdict] ?? 0) + 1;
  const judgeMs = jams.flatMap((j) => [j.now?.ms ?? 0, j.before?.ms ?? 0]);
  console.log(`DISPATCH ${JSON.stringify({ map: f, jams: r.jams, arrivals: r.arrivals, seconds, runMs: Math.round(ms), verdicts, judgeMsMax: Math.round(Math.max(0, ...judgeMs)), judged: jams, decisionMs: shadow.decisionMs.map((x) => Number(x.toFixed(4))), decisionStates: shadow.decisionStates, plainStates: shadow.plainStates, probeMs: shadow.probeMs.map((x) => Number(x.toFixed(4))), probeStates: shadow.probeStates, probeCapped: shadow.probeCapped, probeWarm: shadow.probeWarm, decisionSizes: shadow.stretchSizes, ...sum })}`);
  rows.push({ map: f, jams: r.jams, ...verdicts, decisions: sum.decisions, "p50 ms": sum.ms.p50, "p98 ms": sum.ms.p98, "max ms": sum.ms.max, capped: sum.capped });
}
console.table(rows);
