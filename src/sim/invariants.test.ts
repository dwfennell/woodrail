import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout } from "../track";
import { Sim } from "./sim";
import { Economy } from "../economy/economy";
import { chain } from "../economy/loop-fixtures";
import { economyChecks } from "../game/dev-checks";

/** Straights, a switch (its branch a spur), straights: no trains. */
function world() {
  const L = new Layout();
  const ids = chain(L, ["straight-216", "straight-216", "switch", "straight-216", "buffer-turnback"]);
  appendPiece(L, "buffer-turnback", false, connectorRef(ids[0], 0));
  chain(L, ["straight-216", "buffer-turnback"], connectorRef(ids[2], 2));
  const sim = new Sim(L);
  const economy = new Economy(L, sim);
  return { L, sim, economy, sw: ids[2] };
}

describe("the invariants on an economy (src/sim/invariants.ts, src/game/dev-checks.ts)", () => {
  it("pinned: a lever tap on pinned points is the player's (a pin keeps routes off them), not a break; any other throw is", () => {
    const w = world();
    const checks = economyChecks(w.economy);
    w.L.setPinned(w.sw, true);
    for (let i = 0; i < 60; i++) {
      w.sim.tick();
      w.economy.tick();
    }
    expect("ok" in w.economy.router.lever(w.sw)).toBe(true);
    for (let i = 0; i < 60; i++) {
      w.sim.tick();
      w.economy.tick();
    }
    expect(checks.summary()).toBe("");
    w.L.setSwitchState(w.sw, w.L.switchState(w.sw) === 0 ? 1 : 0);
    expect(checks.broke.pinned.count).toBe(1);
    expect(checks.broke.pinned.first[0]).toMatch(new RegExp(`pinned points ${w.sw} thrown to`));
    checks.off();
  });

  it("checks nothing once off, and the layout's own setSwitchState is back", () => {
    const w = world();
    const own = w.L.setSwitchState;
    const checks = economyChecks(w.economy);
    expect(w.L.setSwitchState).not.toBe(own);
    checks.off();
    expect(w.L.setSwitchState).toBe(own);
    expect(w.economy.checker).toBeNull();
  });
});
