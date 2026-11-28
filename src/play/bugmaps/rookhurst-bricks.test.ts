import { describe, expect, it } from "vitest";
import { SIM_HZ } from "../../sim";
import { loadBugMap } from "../bugmap";
import { stageLacks } from "../../game/grand";
import { receivedBy, TownLife, type TownLifeHost } from "../../game/town-life";
import MAP from "./reports/2026-11-27-rookhurst-takes-cathedral-bricks.txt?raw";

/**
 * A user's map (2026-11-27): "rookhurst keeps taking bricks that dimbly needs for its cathedral... is it buying them?"
 * Bricks were a good every town always bought, at full price: Rookhurst (City ★★★, needing only flour) is on three lines
 * before Dimbleby, so it had first pick, and the Cathedral's walls waited. Towns now take only what they need (spec
 * docs/superpowers/specs/2026-11-27-towns-buy-what-they-need.md): the bricks ride past Rookhurst to Dimbleby. Game mode's
 * towns are wired as main wires them (TownLife's `accepts` and `grandTake`), the trains run as saved.
 */
describe("the user's Rookhurst map: the cathedral's bricks", () => {
  it("Rookhurst takes no bricks; the cathedral's stage gets its 14; the lines say Rookhurst doesn't need them", async () => {
    const { world: w } = await loadBugMap(MAP);
    const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
    const life = new TownLife(host, { grew: () => {}, received: () => {} });
    life.reset();
    const rook = w.landscape.towns.find((t) => t.name === "Rookhurst")!;
    const cathedral = w.economy.grandPlans.get("cathedral")!;
    expect(w.landscape.towns.find((t) => t.id === cathedral.townId)!.name).toBe("Dimbleby");
    expect(stageLacks("cathedral", cathedral, "bricks")).toBe(14);
    const bricks = receivedBy(w, rook.id).bricks ?? 0;
    // The line sheet: a line carrying bricks to Dimbleby passes Rookhurst with them, saying so.
    const blue = [...w.economy.lines.values()].find((l) => l.name === "Blue line 3")!;
    const plan = w.economy.routePlan(blue.stops);
    const at = blue.stops.findIndex((s) => w.economy.depot(s.depotId)?.townId === rook.id && w.economy.depot(s.depotId)?.role === "town");
    expect(plan[at].passes).toContain("bricks");
    expect(plan[at].drops).not.toContain("bricks");
    let minutes = 0;
    for (; minutes < 40 && stageLacks("cathedral", cathedral, "bricks") > 0; minutes++) {
      for (let i = 0; i < 60 * SIM_HZ; i++) {
        w.sim.tick();
        w.economy.tick();
      }
      life.update();
    }
    expect(stageLacks("cathedral", cathedral, "bricks"), `after ${minutes} min`).toBe(0);
    expect(receivedBy(w, rook.id).bricks ?? 0).toBe(bricks);
  }, 600_000);
});
