import { describe, expect, it } from "vitest";
import { CARGO, GOODS_ICON } from "../economy/cargo";
import { capAt, type DepotState } from "../economy/economy";
import { SIM_HZ } from "../sim/sim";
import type { PieceTypeId } from "../track";
import { chainOf, chainRows, loadHint, loadHintText, makerOf, partnersOf, stateWords, wagonFor, type PlaceOf } from "./chains";
import { engineView } from "./engine-status";
import { siteWhy, updateRates } from "./industries";
import { buildStarterWorld, depotName, syncIndustries, type World } from "./world";

/** Sandbox's starter map (no Game sites), with industries put down where the test says (as the tray would). */
function sandbox() {
  const w = buildStarterWorld(false);
  const place = (type: PieceTypeId, x: number, z: number): DepotState => {
    const id = w.layout.addPiece(type, { x, z, heading: 0 });
    syncIndustries(w);
    return w.economy.depotAtPiece(id)!;
  };
  return { w, place };
}
const placeOf =
  (w: World): PlaceOf =>
  (d) => {
    const p = w.layout.getPiece(d.pieceId);
    return p ? { x: p.pose.x + Math.cos(p.pose.heading) * 108, z: p.pose.z + Math.sin(p.pose.heading) * 108 } : null;
  };
const rowsOf = (w: World, d: DepotState) => chainRows(chainOf(d, w.economy.allDepots(), placeOf(w)), (o) => depotName(w, o), (k) => GOODS_ICON[k]).map((r) => r.text);

describe("chains: what an industry makes, where its goods come from and go", () => {
  it("the starter map's sawmill: logs from the forest yard, planks to the nearest town and the rest", () => {
    const w = buildStarterWorld(false);
    const mill = w.economy.allDepots().find((d) => d.role === "sawmill")!;
    const view = chainOf(mill, w.economy.allDepots(), placeOf(w));
    expect(view.inputs.map((l) => [l.kind, l.place?.role])).toEqual([["log", "forest"]]);
    expect(view.outputs.map((l) => [l.kind, l.place?.role])).toEqual([["planks", "town"]]);
    const towns = w.economy.allDepots().filter((d) => d.role === "town").length;
    expect(view.outputs[0].more).toBe(towns - 1);
    const rows = rowsOf(w, mill);
    expect(rows[0]).toBe(`${GOODS_ICON.log} Logs from the Forest yard${view.inputs[0].more ? ` and ${view.inputs[0].more} more` : ""}`);
    expect(rows[1]).toMatch(new RegExp(`^${GOODS_ICON.planks} Planks go to [A-Z][a-z]+ and ${towns - 1} more$`));
    // Nothing in: waiting for logs. Logs in: working. Planks piled to the cap: full.
    expect(stateWords(view)).toBe("Waiting for logs");
    mill.piles[CARGO.log.index] = 3;
    expect(stateWords(chainOf(mill, w.economy.allDepots(), placeOf(w)))).toBe("Working");
    mill.piles[CARGO.planks.index] = capAt(mill);
    expect(stateWords(chainOf(mill, w.economy.allDepots(), placeOf(w)))).toBe("Full of planks: a train can take them");
  });

  it("the bread chain: a bakery says what's missing and which industry makes it, then where each comes from", () => {
    const { w, place } = sandbox();
    const bakery = place("depot-bakery", 3000, 3000);
    expect(rowsOf(w, bakery)).toEqual([
      `${GOODS_ICON.flour} Flour: none made on the map yet. Place a Mill (Industries tab)`,
      `${GOODS_ICON.milk} Milk: none made on the map yet. Place a Dairy farm (Industries tab)`,
      expect.stringMatching(new RegExp(`^${GOODS_ICON.bread} Bread goes to [A-Z][a-z]+`)),
    ]);
    expect(stateWords(chainOf(bakery, w.economy.allDepots(), placeOf(w)))).toBe("Waiting for flour and milk");
    place("depot-mill", 3000, 3600);
    place("depot-dairy", 3600, 3000);
    // (A second mill, further off: the nearest is named, and one more.)
    place("depot-mill", 3000, 5000);
    const rows = rowsOf(w, bakery);
    expect(rows.slice(0, 2)).toEqual([`${GOODS_ICON.flour} Flour from the Mill and 1 more`, `${GOODS_ICON.milk} Milk from the Dairy farm`]);
    // The mill: grain from nowhere yet (a farm yard makes it), flour to the bakery (nearer than any town).
    const mill = w.economy.allDepots().find((d) => d.role === "mill")!;
    expect(rowsOf(w, mill)).toEqual([`${GOODS_ICON.grain} Grain: none made on the map yet. Place a Farm yard (Industries tab)`, `${GOODS_ICON.flour} Flour goes to the Bakery and ${w.landscape.towns.length} more`]);
    // Show buttons go to the place named.
    const shows = chainRows(chainOf(bakery, w.economy.allDepots(), placeOf(w)), (o) => depotName(w, o), (k) => GOODS_ICON[k]).map((r) => r.show);
    expect(shows[0]).toBe(mill.id);
    expect(shows.every((s) => s >= 0)).toBe(true);
  });

  it("a town's card names only goods something on the map makes for it", () => {
    const { w, place } = sandbox();
    const town = w.economy.allDepots().find((d) => d.role === "town")!;
    expect(chainOf(town, w.economy.allDepots(), placeOf(w)).inputs.map((l) => l.kind)).toEqual(["planks"]);
    place("depot-orchard", 2000, 2000);
    expect(chainOf(town, w.economy.allDepots(), placeOf(w)).inputs.map((l) => l.kind)).toEqual(["planks", "fruit"]);
    expect(chainOf(town, w.economy.allDepots(), placeOf(w)).state).toBeNull();
  });

  it("taken up, a place isn't named (its piece is off the map)", () => {
    const { w, place } = sandbox();
    const bakery = place("depot-bakery", 3000, 3000);
    const dairy = place("depot-dairy", 3600, 3000);
    w.layout.removePiece(dairy.pieceId);
    expect(chainOf(bakery, w.economy.allDepots(), placeOf(w)).inputs.find((l) => l.kind === "milk")!.place).toBeNull();
  });

  it("which industry makes a good, and which wagon carries it", () => {
    expect([makerOf("log"), makerOf("planks"), makerOf("flour"), makerOf("milk"), makerOf("iron")]).toEqual(["Harvester", "Sawmill", "Mill", "Dairy farm", "Foundry"]);
    expect([wagonFor("log"), wagonFor("grain"), wagonFor("bread"), wagonFor("milk")]).toEqual(["a flatbed", "a hopper", "a goods van", "a milk tank"]);
  });

  it("held to place: gold rings on what makes its goods, green on what takes them", () => {
    const { w, place } = sandbox();
    const dairy = place("depot-dairy", 3600, 3000);
    const { from, to } = partnersOf("bakery", w.economy.allDepots(), (d) => w.economy.onMap(d));
    expect(from).toEqual([dairy]);
    expect(to.every((d) => d.role === "town")).toBe(true);
    expect(partnersOf("warehouse", w.economy.allDepots(), () => true)).toEqual({ from: [], to: [] });
  });
});

describe("Sandbox's industries work from what's around them, as in Game mode", () => {
  it("a harvester with no trees makes nothing (no work, so nothing to animate) and its site says why; by trees it works", () => {
    const { w, place } = sandbox();
    const bare = place("depot-forest", 9000, 9000);
    updateRates(w);
    expect(bare.rate).toBe(0);
    expect(w.economy.working(bare)).toBe(false);
    for (let i = 0; i < 20 * SIM_HZ; i++) w.economy.tick();
    expect(bare.piles[CARGO.log.index]).toBe(0);
    // (What its card says: Game mode's words for a site short of its resource.)
    const piece = w.layout.getPiece(bare.pieceId)!;
    expect(siteWhy(w.landscape, piece.type, piece.pose)).toMatch(/^Needs trees nearby: 0 of \d+$/);
    // The map's own forest yard works at its recipe's speed.
    const own = w.economy.allDepots().find((d) => d.role === "forest" && d !== bare)!;
    expect(own.rate).toBe(1);
  });
});

describe("a train beside goods it won't load (the engine card, Sandbox's chain hints)", () => {
  /** A train of `cars` standing on a forest yard's track, its logs piled. */
  function atForest(cars: Parameters<World["sim"]["addTrain"]>[0]) {
    const w = buildStarterWorld(false);
    const forest = w.economy.allDepots().find((d) => d.role === "forest")!;
    forest.piles[CARGO.log.index] = 5;
    let id = -1;
    for (let s = 0; s <= 216 && id === -1; s += 12)
      for (const reversed of [false, true]) {
        const r = w.sim.addTrain(cars, { pieceId: forest.pieceId, pathIndex: 0, reversed, s });
        if (r.kind === "placed" && w.sim.getTrain(r.trainId)!.bogies.some((b) => b.pieceId === forest.pieceId)) {
          id = r.trainId;
          break;
        }
      }
    if (id === -1) throw new Error("no room for the train at the forest");
    const t = w.sim.getTrain(id)!;
    return { w, forest, t, engine: t.cars[0].id };
  }
  const at = (w: World) => (id: number) => w.economy.depotAtPiece(id);

  it("coaches at the forest: they need a flatbed for its logs", () => {
    const { w, forest, t, engine } = atForest(["engine", "passenger"]);
    const h = loadHint(t, at(w), null)!;
    expect([h.depot, h.kind, h.why]).toEqual([forest, "log", "wagon"]);
    expect(loadHintText(h, "the forest yard")).toBe("Needs a flatbed for logs: add one to this train");
    // On the engine card with the hints on (Sandbox), and not with them off (Game mode's words unchanged).
    w.sim.setLever(engine, 0);
    expect(engineView(w.sim, w.economy, engine, () => "the forest yard", null, () => "", true).status).toBe("Needs a flatbed for logs: add one to this train");
    expect(engineView(w.sim, w.economy, engine, () => "the forest yard").status).not.toMatch(/flatbed/);
  });

  it("Game mode too: a goods train standing at a place with the wrong wagons is told what it needs", () => {
    // (The player's case: a train of flatbeds at a quarry, "Stone 3/12", nothing happening. Here hoppers at a forest.)
    const { w, engine } = atForest(["engine", "hopper"]);
    w.sim.setLever(engine, 0);
    expect(engineView(w.sim, w.economy, engine, () => "the forest yard").status).toBe("Needs a flatbed for logs: add one to this train");
    // Running through, it isn't stopped to be told.
    w.sim.setLever(engine, 1);
    for (let i = 0; i < 30; i++) w.sim.tick();
    const running = engineView(w.sim, w.economy, engine, () => "the forest yard").status;
    if (w.sim.findCar(engine)!.train.speed > 1) expect(running).not.toMatch(/Needs a/);
  });

  it("a flatbed: nothing to say; routed with no stop there: not picking up logs", () => {
    const { w, forest, t } = atForest(["engine", "timber"]);
    expect(loadHint(t, at(w), null)).toBeNull();
    expect(loadHint(t, at(w), [forest.id])).toBeNull();
    const h = loadHint(t, at(w), [forest.id + 100])!;
    expect(h.why).toBe("not-stop");
    expect(loadHintText(h, "the forest yard")).toBe("Not picking up logs: the forest yard isn't on this route. Edit the route to add a stop here");
  });

  it("a flatbed switched Off for logs on its card: not picking up logs, and why", () => {
    const { w, t } = atForest(["engine", "timber"]);
    const flatbed = t.cars[1].id;
    w.economy.setCarTakes(flatbed, "log", false);
    const h = loadHint(t, at(w), null, (c, k) => w.economy.carTakes(c, k))!;
    expect(h.why).toBe("off");
    expect(loadHintText(h, "the forest yard")).toBe("Not picking up logs: its wagons are set to Off for logs. Switch them on in a wagon's card");
    w.economy.setCarTakes(flatbed, "log", true);
    expect(loadHint(t, at(w), null, (c, k) => w.economy.carTakes(c, k))).toBeNull();
  });

  it("routed past a place not on its line: the card offers to add the stop", () => {
    const { w, forest, t, engine } = atForest(["engine", "timber"]);
    w.sim.setLever(engine, 0);
    const town = w.economy.allDepots().find((d) => d.role === "town")!;
    w.economy.setRoute(engine, { stops: [{ depotId: town.id, action: "auto" }] } as Parameters<typeof w.economy.setRoute>[1]);
    const v = engineView(w.sim, w.economy, engine, () => "the forest yard", null, () => "", true);
    expect(v.status).toMatch(/^Not picking up logs: the forest yard isn't on this route/);
    expect(v.addStop).toBe(forest.id);
    expect(t).toBeTruthy();
  });

  it("nothing piled there, or its crane off: nothing to say", () => {
    const { w, forest, t } = atForest(["engine", "passenger"]);
    forest.piles[CARGO.log.index] = 0;
    expect(loadHint(t, at(w), null)).toBeNull();
    forest.piles[CARGO.log.index] = 4;
    w.economy.setAuto(forest.id, false);
    expect(loadHint(t, at(w), null)).toBeNull();
    // (A place set on its card not to give a good, as a mine's coal or ore can be: its own setting says so, not this.
    // Set here directly: only industries giving several goods have the choice, and `loadHint` reads the mode alone.)
    w.economy.setAuto(forest.id, true);
    forest.modes[CARGO.log.index] = "off";
    expect(loadHint(t, at(w), null)).toBeNull();
  });
});
