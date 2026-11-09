import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { buildStarterWorld, syncIndustries, fixedPieces } from "../game/world";
import { generateLandscape } from "../landscape/generate";
import { CELL } from "../landscape/grid";
import { LandEditor } from "../landscape/edit";
import { addTownProps } from "../props/towns";
import { connectorRef } from "../track";
import { SIM_HZ } from "../sim";
import { buildOnLots, nextLots } from "../game/town-growth";
import { housesBy, townStatus } from "../game/towns";
import { receivedBy } from "../game/town-life";
import { play } from "./player";
import { endOn, rulesFor } from "./rules";


/**
 * The Game mode's first job, played end to end: a simulated player lays the starter line (sawmill, Larkfield,
 * Elderwick, forest yard: one straight run) with the placement rules on, turnbacks go on its ends, and one timber
 * train shuttles along it through the real sim and economy until a town has grown to a town (level 2): as far as
 * planks alone take it (a city wants flour too: see the farm chain test).
 */
describe("the starter line", () => {
it("is laid by a player and grows a hamlet into a town", () => {
  const log: string[] = [];
  const w = buildStarterWorld();
  const fixed = fixedPieces(w);
  const editor = new Editor(w.layout, w.sim, () => {}, (id) => fixed.has(id));
  const st = (i: number) => w.stations.get(w.landscape.towns[i].id)!;
  const depotPiece = (kind: string) => [...w.depots.values()].find((id) => w.layout.getPiece(id)!.type === `depot-${kind}`)!;
  const saw = depotPiece("sawmill");
  const forest = depotPiece("forest");
  // 1. The simulated player lays the line, leg by leg.
  const legs: [string, number, number][] = [
    ["Larkfield → sawmill", connectorRef(st(0), 0), connectorRef(saw, 1)],
    ["Larkfield → Elderwick", connectorRef(st(0), 1), connectorRef(st(1), 0)],
    ["Elderwick → forest yard", connectorRef(st(1), 1), connectorRef(forest, 0)],
  ];
  for (const [name, a, b] of legs) {
    const r = play(w.layout, editor, a, b, { blocked: rulesFor(w), maxPieces: 60, fiddle: 3 });
    log.push(`${name}: ${r.ok ? `joined, ${r.pieces} pieces` : `FAILED ${JSON.stringify(r)}`}`);
    expect(r.ok, name).toBe(true);
  }
  // 2. Turnback buffers on the line's two ends (the sawmill's far end, the forest yard's far end).
  for (const [piece, k] of [[saw, 0], [forest, 1]] as const) {
    const r = endOn(w, editor, connectorRef(piece, k));
    log.push(`turnback on ${w.layout.getPiece(piece)!.type}: ${"why" in r ? `refused (${r.why})` : "laid"}`);
    expect("why" in r).toBe(false);
  }
  syncIndustries(w);
  log.push(`track: ${w.layout.pieceCount - fixed.size} pieces laid`);
  // 3. A timber train between the towns, set going.
  const between = [...w.layout.pieceIds()].find((id) => !fixed.has(id) && w.layout.getPiece(id)!.type.startsWith("straight") && Math.abs(w.layout.getPiece(id)!.pose.x) < 300)!;
  const placed = w.sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: between, pathIndex: 0, reversed: false, s: 10 });
  if (placed.kind !== "placed") throw new Error(`no room for the train: ${placed.kind}`);
  const train = w.sim.getTrain(placed.trainId)!;
  w.sim.setLever(train.cars[0].id, -1);
  // 4. Run the railway; towns grow as in the game (TownLife's rule: on the delivery that fills the bar).
  const levels = new Map(w.landscape.towns.map((t) => [t.id, 0]));
  const minutes = 25;
  let best = 0;
  for (let tick = 0; tick < minutes * 60 * SIM_HZ; tick++) {
    w.sim.tick();
    w.economy.tick();
    if (tick % SIM_HZ !== 0) continue;
    for (const town of w.landscape.towns) {
      const s = townStatus(receivedBy(w, town.id));
      const was = levels.get(town.id)!;
      if (s.level > was) {
        const lots = nextLots(w.landscape, town, new LandEditor(w.landscape, w.layout), housesBy(s.level) - housesBy(was));
        buildOnLots(w.landscape, town, lots);
        addTownProps(w.landscape, w.props);
        levels.set(town.id, s.level);
        log.push(`${(tick / SIM_HZ / 60).toFixed(1)} min: ${town.name} grew into a ${s.name.toLowerCase()} (+${lots.length} buildings)`);
        best = Math.max(best, s.level);
      }
    }
    if (best >= 2) break;
  }
  log.push(`best level: ${best}; delivered ${JSON.stringify(Object.fromEntries(w.economy.delivered))}`);
  expect(best, log.join("\n")).toBeGreaterThanOrEqual(2);
}, 300_000);

it("is laid on the felt from the forest yard to the sawmill: straights, and a curve into the sawmill", () => {
  // The first lines a new player lays (goals "Load logs" and "Deliver planks"): no ramp, bridge or tunnel on the way,
  // but the sawmill stands across the line, so the way in to it takes a curve.
  const w = buildStarterWorld();
  const fixed = fixedPieces(w);
  const editor = new Editor(w.layout, w.sim, () => {}, (id) => fixed.has(id));
  const st = (i: number) => w.stations.get(w.landscape.towns[i].id)!;
  const depotPiece = (kind: string) => [...w.depots.values()].find((id) => w.layout.getPiece(id)!.type === `depot-${kind}`)!;
  const legs: [string, number, number][] = [
    ["Elderwick → forest yard", connectorRef(st(1), 1), connectorRef(depotPiece("forest"), 0)],
    ["Larkfield → Elderwick", connectorRef(st(0), 1), connectorRef(st(1), 0)],
    ["Larkfield → sawmill", connectorRef(st(0), 0), connectorRef(depotPiece("sawmill"), 1)],
  ];
  const g = w.landscape.grid;
  for (const [name, a, b] of legs) {
    const before = new Set(w.layout.pieceIds());
    const r = play(w.layout, editor, a, b, { blocked: rulesFor(w), maxPieces: 60, fiddle: 3 });
    expect(r.ok, `${name}: ${JSON.stringify(r)}`).toBe(true);
    const laid = [...w.layout.pieceIds()].filter((id) => !before.has(id)).map((id) => w.layout.getPiece(id)!);
    for (const p of laid) {
      expect(p.type, name).toMatch(/^(straight|curve|auto)/);
      expect(p.y, `${name}: ${p.type} up a level`).toBe(0);
      const i = g.cellAtWorld(p.pose.x, p.pose.z);
      expect(g.height[i], `${name}: ${p.type} on a hill`).toBe(0);
    }
    const curves = laid.filter((p) => p.type.startsWith("curve")).length;
    if (name === "Larkfield → sawmill") expect(curves, "the way in to the sawmill turns").toBeGreaterThanOrEqual(1);
  }
});

it("keeps the first lines' ground free of hills on Flat and Gentle starter-style maps", () => {
  // Every new Game map is starter-style: the ground about the sawmill's turn and on along the line to the forest yard
  // is level there (Hilly and Mountainous keep their hills: the player chose them).
  const hilly: number[] = [];
  for (let seed = 0; seed < 60; seed++) {
    for (const hills of ["flat", "gentle"] as const) {
      const land = generateLandscape(seed, { starter: true, hills });
      const [a] = land.towns;
      const [saw, forest] = land.depots;
      const x0 = saw.centre.x - 2 * CELL;
      const x1 = forest.centre.x + 2 * CELL;
      const z0 = Math.min(saw.centre.z, a.centre.z) - 2 * CELL;
      const z1 = Math.max(saw.centre.z, a.centre.z) + 2 * CELL;
      let n = 0;
      land.grid.forEachCell((i, col, row) => {
        const x = land.grid.centreX(col);
        const z = land.grid.centreZ(row);
        const nearSawmill = x < a.centre.x && z >= z0 && z <= z1;
        const nearLine = Math.abs(z - a.centre.z) <= 2 * CELL;
        if (x >= x0 && x <= x1 && (nearSawmill || nearLine) && land.grid.height[i] > 0) n++;
      });
      if (n > 0) hilly.push(seed);
    }
  }
  expect(hilly, "seeds with hills on the first lines' ground").toEqual([]);
});
});
