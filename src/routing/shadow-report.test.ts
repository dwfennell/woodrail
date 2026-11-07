import { describe, it } from "vitest";
import { Layout } from "../track";
import type { Train } from "../sim";
import { loadBugMap, replayBugMap } from "../play/bugmap";
import { economyWorld } from "../game/dev-checks";
import { trainState } from "../game/engine-status";
import { HarnessRun } from "./harness";
import { fuzz, ringFuzz } from "./scenarios";
import { ReservationShadow } from "./shadow";

/**
 * The reservation shadow's disagreements with today's guards (routing redesign §4 step 2), over the fuzz's seeds and the
 * bug maps: one `SHADOW {json}` line a run, which `npm run shadow:report` (scripts/shadow-report.mjs) runs sharded and
 * adds up by kind. Skipped unless SHADOW_REPORT is set.
 *
 *   SHADOW_REPORT=1 SHADOW_SEEDS=8 SHADOW_SECONDS=300 npx vitest run --silent=false src/routing/shadow-report.test.ts
 *
 * SHADOW_FIRST: the first seed (default 1). SHADOW_PARTS: which runs ("plain,signals,ring,maps", default all).
 */

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(ENV.SHADOW_SEEDS ?? 8);
const FIRST = Number(ENV.SHADOW_FIRST ?? 1);
const SECONDS = Number(ENV.SHADOW_SECONDS ?? 300);
const PARTS = new Set((ENV.SHADOW_PARTS ?? "plain,signals,ring,maps").split(","));
const MAPS: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob("../play/bugmaps/*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>).map(([k, v]) => [k.split("/").pop()!, v]));

function line(run: string, s: ReservationShadow, ticks: number): void {
  const out = { run, counts: s.counts, heldFreeBy: Object.fromEntries(s.heldFreeBy), onPointsBy: Object.fromEntries(s.onPointsBy), refusedBy: Object.fromEntries(s.refusedBy), bookings: s.bookings, ms: Number(s.ms.toFixed(1)), ticks, first: s.first };
  console.log(`SHADOW ${JSON.stringify(out)}`);
}

/** What holds a harness train today, in a word (for held-free's `why`). */
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
  if (h.sections.awaitingGrant(engine)) return "sections:awaiting-grant";
  return "held-up";
}

function harnessRun(name: string, h: HarnessRun, seconds: number): void {
  const shadow = new ReservationShadow(h, { why: (t, e) => harnessWhy(h, t, e) });
  h.afterStep = () => shadow.tick();
  h.run(seconds);
  line(name, shadow, h.sim.ticks);
}

describe.skipIf(!ENV.SHADOW_REPORT)("reservation shadow: disagreements with today's guards", () => {
  const seeds = Array.from({ length: SEEDS }, (_, k) => FIRST + k);
  if (PARTS.has("plain")) for (const seed of seeds) it(`fuzz seed ${seed}`, () => harnessRun(`fuzz ${seed}`, new HarnessRun(new Layout(), fuzz(seed, SECONDS)), SECONDS), 3_600_000);
  if (PARTS.has("signals")) for (const seed of seeds) it(`fuzz seed ${seed} with signals`, () => harnessRun(`signals ${seed}`, new HarnessRun(new Layout(), fuzz(seed, SECONDS, true)), SECONDS), 3_600_000);
  if (PARTS.has("ring")) for (const seed of seeds) it(`ring fuzz seed ${seed}`, () => harnessRun(`ring ${seed}`, new HarnessRun(new Layout(), ringFuzz(seed, SECONDS)), SECONDS), 3_600_000);
  // (The bug maps once, in the first shard: a map isn't a seed.)
  if (PARTS.has("maps") && FIRST === 1)
    for (const [file, text] of Object.entries(MAPS))
      it(`bug map ${file}`, async () => {
        const { world } = await loadBugMap(text);
        const eco = world.economy;
        const shadow = new ReservationShadow(economyWorld(eco), {
          why: (t, e) => {
            const found = eco.sim.findCar(e);
            const st = trainState(eco.sim, eco, t, found ? found.train.cars[found.index].lever : 0);
            return st.kind === "stuck" ? `stuck:${st.why}` : st.kind;
          },
        });
        replayBugMap(world, { seconds: 600, stopAtFirst: false, onTick: () => shadow.tick() });
        line(`map ${file}`, shadow, world.sim.ticks);
      }, 3_600_000);
});
