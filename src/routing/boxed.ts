/**
 * The boxed-in convoy (routing spec §16, the user's decision (4), 2026-11-02, kept 2026-11-06): a stall a route makes on
 * a single line where hand-run trains would run as a convoy into a dead end. A hand-run train stands between the end of
 * the line and the routed train, nothing on its far side but plain track to the end (no facing points to go another
 * way, no other train), and the routed train's next stop is on that side, behind it. All hand-run, the two give way and
 * run end to end, the one behind following the other into the dead end (§16 Q9); with a route, single-line working lets
 * only one train into the dead end, so they stand, said stuck "in the way" with the card's fix a passing loop. Kept so:
 * "a route never makes it worse" (harness-fuzz.test.ts) excuses a stall of exactly this shape, and only it.
 */
import type { Train } from "../sim";
import { boxOf } from "./give-way";
import type { HarnessRun } from "./harness";

/**
 * Are the trains said stuck now a boxed-in convoy, and only that? Each stuck routed train is "in the way" of a hand-run
 * one with the card's fix a passing loop (`loop`), that hand-run train boxed into a dead end (`boxOf`) on the side away
 * from the routed one, with the routed train's next stop in that box. Each other stuck train is hand-run, "in the way"
 * of a stuck routed one, and boxed in too. Anything else (two routed trains, too many for a line, a parked train, signals,
 * a hand-run train with a road out, a stop not behind it) isn't.
 */
export function boxedConvoy(run: HarnessRun): boolean {
  const { sim, layout } = run;
  const trains = sim.trainIds().map((id) => sim.getTrain(id)!);
  const engineOf = (t: Train) => t.cars.find((c) => c.kind === "engine")?.id ?? -1;
  const stuck = trains.filter((t) => run.stalls.stuckOf(engineOf(t)) !== null);
  const routed = stuck.filter((t) => run.routed(engineOf(t)));
  if (routed.length === 0) return false;
  const routedEngines = new Set(routed.map(engineOf));
  for (const r of routed) {
    const why = run.stalls.stuckOf(engineOf(r))!;
    if (why.kind !== "in-way" || !why.loop) return false;
    const h = sim.findCar(why.by)?.train;
    if (!h || run.routed(engineOf(h)) || !stuck.includes(h)) return false;
    const box = boxOf(layout, trains, h, new Set(r.bogies.map((b) => b.pieceId)));
    const goal = run.target(engineOf(r));
    if (!box || goal < 0 || !box.has(goal) || r.bogies.some((b) => box.has(b.pieceId))) return false;
  }
  for (const h of stuck) {
    if (routed.includes(h)) continue;
    const why = run.stalls.stuckOf(engineOf(h))!;
    if (why.kind !== "in-way" || !routedEngines.has(why.by)) return false;
    const by = sim.findCar(why.by)!.train;
    if (!boxOf(layout, trains, h, new Set(by.bogies.map((b) => b.pieceId)))) return false;
  }
  return true;
}
