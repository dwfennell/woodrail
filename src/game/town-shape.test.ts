import { beforeAll, describe, expect, it } from "vitest";
import { plus, type Bag } from "../economy/goods";
import { FEAT_BUILDING, SURF_TOWN, type Town } from "../landscape";
import { loadFootprints } from "../props/footprints-testing";
import type { Footprint } from "../props/placement";
import { stacks } from "../props/storeys";
import { sharesOut } from "../props/towns";
import { TownLife, type TownLifeHost } from "./town-life";
import { townLevel } from "./towns";
import { buildStarterWorld, type World } from "./world";

// How a Game-mode town looks as it grows: only its middle rises, its edge and its new buildings stay single-storey,
// and it spreads with new buildings on free ground. Grown by deliveries, through TownLife, as in play.

let footprintOf: (asset: string) => Footprint | undefined;
beforeAll(async () => {
  footprintOf = await loadFootprints(["bldg"]);
});

/** A starter world whose towns grow a level per `deliver` (what the next level wants, delivered), as in play. */
function growing(): { w: World; deliver(t: Town): void } {
  const w = buildStarterWorld();
  const host: TownLifeHost = Object.assign(w, { footprintOf, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
  const life = new TownLife(host, { grew: () => {}, received: () => {} });
  life.reset();
  const bags = new Map<number, Bag>();
  const levels = new Map<number, number>();
  return {
    w,
    deliver(t) {
      const level = levels.get(t.id) ?? 0;
      const bag = plus(bags.get(t.id) ?? {}, townLevel(level).wants);
      bags.set(t.id, bag);
      levels.set(t.id, level + 1);
      w.economy.delivered.set(t.id, bag.planks ?? 0);
      w.economy.deliveredGoods.set(t.id, { ...bag });
      life.update();
    },
  };
}

const townHouses = (w: World, t: Town) => [...w.props.all()].filter((p) => p.town === t.id && p.building !== undefined && stacks(p.asset));

describe("a growing town's shape", () => {
  it("only some houses rise, the middle ones; the outer fifth stays single-storey at every level", () => {
    const { w, deliver } = growing();
    for (const t of w.landscape.towns.slice(0, 3)) {
      for (let level = 1; level <= 5; level++) {
        deliver(t);
        const shares = sharesOut(w.landscape, t);
        const houses = townHouses(w, t);
        const tall = houses.filter((p) => (p.storeys ?? 0) > 0);
        for (const p of houses) if (shares.get(p.building!)! >= 0.8) expect(p.storeys ?? 0, `${t.name} level ${level}: house ${p.building} at the edge`).toBe(0);
        // Never every house: at most about two in three, even at city ★★.
        expect(tall.length, `${t.name} level ${level}`).toBeLessThan(houses.length * 0.7);
        if (level >= 3) {
          // A city has a taller middle: some rise, and they're nearer the centre than the ones that don't.
          expect(tall.length, `${t.name} level ${level}`).toBeGreaterThan(0);
          const mean = (list: typeof houses) => list.reduce((s, p) => s + shares.get(p.building!)!, 0) / Math.max(1, list.length);
          expect(mean(tall)).toBeLessThan(mean(houses.filter((p) => !p.storeys)));
        }
      }
    }
  });

  it("each level puts up new buildings on free ground; they start single-storey and keep off track, streets and houses", () => {
    const { w, deliver } = growing();
    const g = w.landscape.grid;
    for (const t of w.landscape.towns.slice(0, 3)) {
      for (let level = 1; level <= 5; level++) {
        const before = new Set(t.buildings.map((b) => b.id));
        const cellsBefore = new Set(t.cells);
        const owners = new Map<number, number>();
        for (let i = 0; i < g.cellCount; i++) if (g.feature[i] === FEAT_BUILDING) owners.set(i, g.owner[i]);
        deliver(t);
        const fresh = t.buildings.filter((b) => !before.has(b.id));
        expect(fresh.length, `${t.name} level ${level}`).toBeGreaterThan(0);
        for (const b of fresh) {
          expect(b.born, `${t.name} level ${level}`).toBe(level);
          // On squares that were nobody's building before, now the town's.
          for (const c of b.cells) {
            expect(owners.has(c), `${t.name}: square ${c} was a building`).toBe(false);
            expect(g.feature[c]).toBe(FEAT_BUILDING);
            expect(g.surface[c]).toBe(SURF_TOWN);
          }
          // One height across the lot (no step of a hill through a house).
          expect(new Set(b.cells.map((c) => g.height[c])).size).toBe(1);
          const prop = [...w.props.all()].find((p) => p.building === b.id)!;
          expect(prop.storeys ?? 0, `${t.name} level ${level}: new ${prop.asset}`).toBe(0);
        }
        // The town spreads: it has squares it didn't have before.
        expect(t.cells.some((c) => !cellsBefore.has(c))).toBe(true);
      }
    }
  });

  it("a building put up at a level rises only with the levels after it", () => {
    const { w, deliver } = growing();
    const t = w.landscape.towns[0];
    for (let level = 1; level <= 7; level++) deliver(t);
    const shares = sharesOut(w.landscape, t);
    // A house put up late in the middle (born at 5 or later) is lower than an old one there would be.
    const late = townHouses(w, t).filter((p) => (t.buildings.find((b) => b.id === p.building)!.born ?? 0) >= 6);
    for (const p of late) expect(p.storeys ?? 0, `house ${p.building} at share ${shares.get(p.building!)!.toFixed(2)}`).toBeLessThanOrEqual(7 - 6);
  });
});
