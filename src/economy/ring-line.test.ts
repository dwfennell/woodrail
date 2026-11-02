import { describe, expect, it } from "vitest";
import { Sim } from "../sim";
import { CARGO } from "./cargo";
import { Layout } from "../track";
import { editLine, joinLine } from "../game/lines";
import { Economy } from "./economy";
import { runner, train, type World } from "./loop-fixtures";
import { ringWithLoop } from "../routing/scenarios";

/**
 * A line of three trains round a ring with one passing loop, forest to sawmill, in the economy (the user, 2026-11-02:
 * "a line of 3 on a ring with 1 loop is held too many, though they could just follow round"). Laid and routed the way a
 * player does (the line made from the first train's card, `editLine`, the others joined to it, `joinLine`); the
 * trains follow one another round (`Sections.follows`), none held for room, and the logs reach the sawmill.
 */
describe("a line of three round a ring with one loop (economy)", () => {
  const layout = new Layout();
  const r = ringWithLoop(layout);
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const dx = economy.addDepot("forest", r.a, 0);
  const dm = economy.addDepot("sawmill", r.b, 0);
  const w = { layout, sim, economy, dx } as unknown as World;
  const es = [train(w, r.loop.main[0], false), train(w, r.north[1], false), train(w, r.round[2], false)];
  const red = editLine(economy, es[0], (s) => s.push({ depotId: dx.id, action: "auto" }, { depotId: dm.id, action: "auto" }))!;
  for (const e of es.slice(1)) joinLine(economy, e, red.id);
  const run = runner(w, es);
  // (Logs come to the sawmill: every rise in its pile, as trains unload.)
  let delivered = 0;
  let was = dm.piles[CARGO.log.index];
  const watch = () => {
    const now = dm.piles[CARGO.log.index];
    if (now > was) delivered += now - was;
    was = now;
    // (The sawmill saws them, so there's always room to unload: kept from filling up, a test shortcut.)
    if (now > 4) dm.piles[CARGO.log.index] = was = 0;
  };
  let full = 0;
  for (let s = 0; s < 20 * 60; s++) {
    for (let k = 0; k < 120; k++) {
      run.step();
      watch();
    }
    if (es.some((e) => economy.sections.fullness(e))) full++;
  }
  it("no train held for room: the line isn't full", () => {
    expect(full).toBe(0);
    for (const e of es) expect([...run.waits.get(e)!]).not.toContain("room");
  });
  it("every train comes to its stops (15+ each in 20 min) and the logs reach the sawmill", () => {
    for (const e of es) expect(run.arrivals.get(e)!).toBeGreaterThanOrEqual(15);
    expect(delivered).toBeGreaterThanOrEqual(40);
  });
  it("they never meet head on", () => expect(run.meetings).toEqual([]));
});
