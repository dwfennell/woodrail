/**
 * A routed train turns round at its line's end on through track (economy `turnAtLineEnds`): the user's two-train map
 * (2026-11-22, src/play/bugmaps/reference/user-2026-11-22-two-train.txt), where Conker's line runs between the sawmill
 * and the workshop, and the workshop's track runs on round loops that never lead back to the sawmill. At the workshop
 * it turns round and goes back, as at a buffer: before, it stood there for good with the dispatcher on ("held up"), and
 * ran round the loops for good with it off. Both ways: the sawmill reached again and again, no invariant broken (a
 * turn at its line's end isn't a mid-line turn).
 */
import { describe, expect, it } from "vitest";
import { loadBugMap } from "../play/bugmap";
import { economyChecks } from "../game/dev-checks";
import { SIM_HZ } from "../sim";
import { engineStatus } from "../game/engine-status";
import { depotName } from "../game/world";
import twoTrain from "../play/bugmaps/reference/user-2026-11-22-two-train.txt?raw";

const CONKER = 36;
const SAWMILL = 5;
const WORKSHOP = 439;

describe("a routed train turns round at its line's end on through track", () => {
  for (const on of [true, false]) {
    it(`the user's two-train map, the dispatcher ${on ? "on" : "off"}: Conker runs workshop ↔ sawmill`, async () => {
      const { world } = await loadBugMap(twoTrain);
      const e = world.economy;
      e.useDispatcher(on);
      const checks = economyChecks(e, { every: 1 });
      const nameOf = (id: number) => {
        const d = e.depot(id);
        return d ? depotName(world, d) : "";
      };
      const said = new Set<string>();
      let was = false;
      const visits: number[] = [];
      for (let i = 0; i < 300 * SIM_HZ; i++) {
        world.sim.tick();
        e.tick();
        const r = e.routeOf(CONKER);
        const now = !!r?.at;
        if (now && !was && r) visits.push(e.depot(r.stops[r.next % r.stops.length].depotId)?.pieceId ?? -1);
        was = now;
        const t = world.sim.findCar(CONKER)?.train;
        if (t && t.turnback >= 0) said.add(engineStatus(world.sim, e, CONKER, nameOf));
      }
      checks.off();
      const broke = Object.entries(checks.broke).filter(([, b]) => b.count > 0).map(([k, b]) => `${k}: ${b.first[0]}`);
      expect(broke).toEqual([]);
      // (The sawmill reached from the workshop, and the workshop again: turned round there, each time.)
      expect(visits.filter((p) => p === SAWMILL).length).toBeGreaterThanOrEqual(2);
      expect(visits.filter((p) => p === WORKSHOP).length).toBeGreaterThanOrEqual(2);
      // (Its card, while it turns back: where the line ends.)
      const workshop = e.depotAtPiece(WORKSHOP)!;
      expect([...said]).toContain(`Turning back: the line ends at ${nameOf(workshop.id)}`);
    }, 120_000);
  }
});
