import { beforeAll, describe, expect, it } from "vitest";
import { loadFootprints } from "../props/footprints-testing";
import type { Footprint } from "../props/placement";
import { TownLife, type TownLifeHost } from "./town-life";
import { townLevel } from "./towns";
import { buildStarterWorld } from "./world";

let footprintOf: (asset: string) => Footprint | undefined = () => undefined;
beforeAll(async () => {
  footprintOf = await loadFootprints(["bldg"]);
}, 60_000);

describe("a growing town's new streets", () => {
  it("are redrawn: each growth step that lays street squares tells the game its roads changed", () => {
    const w = buildStarterWorld();
    const g = w.landscape.grid;
    const streets = () => {
      let key = "";
      for (let i = 0; i < g.cellCount; i++) if (g.road[i] !== 0) key += `${i}:${g.road[i]} `;
      return key;
    };
    let drawn = streets();
    let laid = 0;
    const host: TownLifeHost = Object.assign(w, {
      footprintOf: (asset: string) => footprintOf(asset),
      // The game's `editLand` draws the road pieces again only when told the roads changed.
      editLand: (_slots: readonly number[], roads?: boolean) => {
        if (!roads) return;
        drawn = streets();
        laid++;
      },
      propsChanged: () => {},
      setSignBadge: () => {},
    });
    const town = new TownLife(host, { grew: () => {}, received: () => {} });
    town.reset();
    const t = w.landscape.towns[0];
    for (let level = 1; level <= 5; level++) {
      const bag: Record<string, number> = {};
      for (let k = 0; k < level; k++) for (const [good, n] of Object.entries(townLevel(k).wants)) bag[good] = (bag[good] ?? 0) + n!;
      w.economy.delivered.set(t.id, bag.planks ?? 0);
      w.economy.deliveredGoods.set(t.id, bag);
      town.update();
      expect(drawn, `level ${level}`).toBe(streets());
    }
    // The town did lay streets as it grew (else this checks nothing).
    expect(laid).toBeGreaterThan(0);
  });
});
