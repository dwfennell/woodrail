import { describe, it } from "vitest";
import { Layout } from "../track";
import type { Train } from "../sim";
import { HarnessRun } from "./harness";
import { fuzz, ringFuzz } from "./scenarios";
import { DispatchShadow } from "./dispatch-stretch-shadow";

/**
 * The dispatcher's grant/hold model in shadow (dispatcher spec §8 step 1; `dispatch-stretch-shadow.ts`) over the fuzz's
 * seeds (plain, with signals, rings): one `DISPATCH {json}` line a run, which `npm run dispatch:report`
 * (scripts/dispatch-report.mjs) runs sharded and adds up by kind, with the reference maps (`bench/dispatch.bench.ts`).
 * Skipped unless DISPATCH_REPORT is set.
 *
 *   DISPATCH_REPORT=1 DISPATCH_SEEDS=8 DISPATCH_SECONDS=300 npx vitest run --silent=false src/routing/dispatch-report.test.ts
 *
 * DISPATCH_FIRST: the first seed (default 1). DISPATCH_PARTS: which runs ("plain,signals,ring", default all).
 */
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(ENV.DISPATCH_SEEDS ?? 8);
const FIRST = Number(ENV.DISPATCH_FIRST ?? 1);
const SECONDS = Number(ENV.DISPATCH_SECONDS ?? 300);
const PARTS = new Set((ENV.DISPATCH_PARTS ?? "plain,signals,ring").split(","));

/** What holds a harness train today, in a word (as the reservation shadow's report says it). */
function harnessWhy(h: HarnessRun, t: Train, engine: number): string {
  const stuck = h.stalls.stuckOf(engine);
  if (stuck) return `stuck:${stuck.kind}`;
  const w = h.sections.waitOf(engine);
  if (w) return `sections:${w.kind}`;
  const r = h.router.waitOf(engine);
  if (r) return `router:${r.kind}`;
  if (h.sim.redSignalKeyAhead(t.id) !== -1) return "red-signal";
  const how = h.sim.heldHow(t.id);
  if (how) return `sim:${how}`;
  return "held-up";
}

function harnessRun(name: string, h: HarnessRun, seconds: number): void {
  const shadow = new DispatchShadow({
    layout: h.layout,
    sim: h.sim,
    route: (e) => {
      const r = h.routes.get(e);
      return r && r.stops.length > 0 ? { stops: r.stops, next: r.next, at: r.at } : null;
    },
    busy: (t, e) => h.busy(t, e),
    stuck: (e) => !!h.stalls.stuckOf(e),
    why: (t, e) => harnessWhy(h, t, e),
  });
  h.afterStep = () => shadow.tick();
  const t0 = performance.now();
  h.run(seconds);
  const { decisionMs, ...rest } = { decisionMs: shadow.decisionMs, ...shadow.summary() };
  console.log(`DISPATCH ${JSON.stringify({ run: name, seconds, runMs: Math.round(performance.now() - t0), trains: h.engines.length, decisionMs: decisionMs.map((x) => Number(x.toFixed(4))), ...rest })}`);
}

describe.skipIf(!ENV.DISPATCH_REPORT)("the dispatcher in shadow: where it would decide differently", () => {
  const seeds = Array.from({ length: SEEDS }, (_, k) => FIRST + k);
  if (PARTS.has("plain")) for (const seed of seeds) it(`fuzz seed ${seed}`, () => harnessRun(`fuzz ${seed}`, new HarnessRun(new Layout(), fuzz(seed, SECONDS)), SECONDS), 3_600_000);
  if (PARTS.has("signals")) for (const seed of seeds) it(`fuzz seed ${seed} with signals`, () => harnessRun(`signals ${seed}`, new HarnessRun(new Layout(), fuzz(seed, SECONDS, true)), SECONDS), 3_600_000);
  if (PARTS.has("ring")) for (const seed of seeds) it(`ring fuzz seed ${seed}`, () => harnessRun(`ring ${seed}`, new HarnessRun(new Layout(), ringFuzz(seed, SECONDS)), SECONDS), 3_600_000);
});
