import { vi } from "vitest";
import { type Landscape, type Town } from "../landscape";
import { LandEditor } from "../landscape/edit";
import { TownLife, type TownLifeHost } from "./town-life";
import { townStatus } from "./towns";
import type { World } from "./world";

// Helpers for the tests of towns growing (not part of the game).

/** Grow a town of the starter map to a city (school, market, library), as deliveries would. */
export function growToCity(w: World, t: Town): { levels: number[]; buildings: number[] } {
  const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
  const life = new TownLife(host, { grew: () => {}, received: () => {} });
  life.reset();
  const levels: number[] = [];
  const buildings: number[] = [];
  for (const bag of [{ planks: 4 }, { planks: 12 }, { planks: 26 }, { planks: 26, flour: 6 }]) {
    w.economy.delivered.set(t.id, bag.planks);
    w.economy.deliveredGoods.set(t.id, { ...bag });
    life.update();
    levels.push(townStatus(bag).level);
    buildings.push(t.buildings.length);
  }
  return { levels, buildings };
}

/** No 2×2 lots: the editor refuses any lot that's exactly a 2×2 block (as if there were no room for one). */
export function noRoomForBlocks(land: Landscape) {
  const check = LandEditor.prototype.checkLot;
  vi.spyOn(LandEditor.prototype, "checkLot").mockImplementation(function (this: LandEditor, cells, reach) {
    const g = land.grid;
    if (cells.length === 4 && new Set(cells.map((c) => g.colOf(c))).size === 2 && new Set(cells.map((c) => g.rowOf(c))).size === 2) return "taken";
    return check.call(this, cells, reach);
  });
}

