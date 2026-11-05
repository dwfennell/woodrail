import { describe, expect, it } from "vitest";
import { canCarry, CARGO, Economy, RECIPES, SORT_SECONDS } from "../economy";
import { CAR_BY_INDEX, CAR_SPECS, Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { startLine } from "./lines";
import { mailSeconds, POST_TECH } from "./post";
import { THING_RULES } from "./things";
import { PRICES } from "./towns";
import { INDUSTRY_ROLE } from "./world";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { buildStarterWorld } from "./world";

const bp = (id: string) => BLUEPRINTS.find((b) => b.id === id)!;

/**
 * Two towns' stations on a closed oval of the game's own pieces (a post office too, where `office`), one hand-run
 * train going round. Towns post mail as the economy says (`mailEvery`, set as Game mode's TownLife sets it once Post
 * office is learned and a post office stands: the shortcut, named); nothing is written into a pile or a wagon.
 */
function oval(cars: CarKind[], office: boolean) {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  const sequence: PieceTypeId[] = [...half, office ? "depot-postoffice" : "straight-216", "station", ...half, "straight-216", "station"];
  const ids: number[] = [];
  let last = -1;
  for (const type of sequence) {
    last = last === -1 ? layout.addPiece(type, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, type, false, connectorRef(last, 1));
    ids.push(last);
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  if (office) economy.addDepot(INDUSTRY_ROLE["depot-postoffice"]!, ids[sequence.indexOf("depot-postoffice")]);
  economy.addDepot("town", ids[sequence.indexOf("station")], 0);
  economy.addDepot("town", ids[sequence.lastIndexOf("station")], 1);
  economy.mailEvery = (d) => (d.role === "town" ? mailSeconds(2) : 0);
  const placed = sim.addTrain(cars, { pieceId: ids[ids.length - 1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const engine = sim.getTrain(placed.trainId)!.cars[0].id;
  sim.setLever(engine, 1);
  const run = (minutes: number) => {
    for (let i = 0; i < minutes * 60 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
    expect(sim.getTrain(placed.trainId)!.derailed).toBe(false);
  };
  const post = () => (economy.deliveredGoods.get(0)?.post ?? 0) + (economy.deliveredGoods.get(1)?.post ?? 0);
  return { sim, economy, run, post, engine, van: sim.getTrain(placed.trainId)!.cars[1].id, closed: [...layout.joints()].length === sequence.length };
}

describe("the Sorting van: its blueprint and wagon", () => {
  it("is built: Trains t2 after Post office, mostly coins; it brings the sorting van, dearer than a mail van", () => {
    expect(bp("mail").plan).toBeUndefined();
    expect(bp("mail")).toMatchObject({ label: "Sorting van", needs: [POST_TECH], tier: 2, research: { goods: { planks: 6 }, coins: 140 } });
    expect(THING_RULES["car:sortvan"]).toMatchObject({ tech: "mail", cost: { planks: 5 } });
    expect(THING_RULES["car:sortvan"]!.cost!.planks!).toBeGreaterThan(THING_RULES["car:mailvan"]!.cost!.planks!);
  });

  it("carries mail and post only, at its own snapshot index", () => {
    expect(canCarry("sortvan", "mail")).toBe(true);
    expect(canCarry("sortvan", "post")).toBe(true);
    expect(canCarry("sortvan", "planks")).toBe(false);
    expect(CAR_SPECS.sortvan.index).toBe(16);
    expect(CAR_BY_INDEX[16]).toBe("sortvan");
  });

  it("sorts slower than a post office: it saves the stop, not the time", () => {
    expect(SORT_SECONDS).toBeGreaterThan(RECIPES.postoffice.cycle!.seconds);
  });
});

describe("the Sorting van by train", () => {
  it("two towns and no post office stop: its mail is sorted on the way and delivered as post, paid", () => {
    const { closed, run, post, economy } = oval(["engine", "sortvan", "sortvan"], false);
    expect(closed).toBe(true);
    const coins = () => [...economy.deliveredGoods.values()].reduce((n, b) => n + (b.post ?? 0), 0) * PRICES.post!;
    run(12);
    expect(economy.made[CARGO.post.index]).toBeGreaterThan(0);
    expect(post()).toBeGreaterThan(0);
    expect(coins()).toBeGreaterThan(0);
    // The mail itself never goes into a town.
    expect(economy.deliveredGoods.get(0)?.mail ?? 0).toBe(0);
  }, 120_000);

  it("routed town to town (its line's \"auto\" stops): it takes the mail, as the next town takes post, and delivers it", () => {
    const o = oval(["engine", "sortvan", "sortvan"], false);
    const towns = o.economy.allDepots().filter((d) => d.role === "town");
    startLine(o.economy, o.engine, towns.map((d) => ({ depotId: d.id, action: "auto" as const })));
    o.run(10);
    expect(o.post()).toBeGreaterThan(0);
    // A mail van on the same line takes none: no stop takes mail.
    const m = oval(["engine", "mailvan", "mailvan"], false);
    startLine(m.economy, m.engine, m.economy.allDepots().filter((d) => d.role === "town").map((d) => ({ depotId: d.id, action: "auto" as const })));
    m.run(4);
    expect(m.economy.cargoOf(m.van).kind).toBeNull();
  }, 120_000);

  it("a mail van on the same line sorts nothing: without a post office its mail never becomes post", () => {
    const { run, post, economy } = oval(["engine", "mailvan", "mailvan"], false);
    run(6);
    expect(economy.made[CARGO.post.index]).toBe(0);
    expect(post()).toBe(0);
  }, 60_000);

  it("only while its train runs: a van standing still with mail stays mail", () => {
    const { sim, economy, engine, van } = oval(["engine", "sortvan"], false);
    sim.setLever(engine, 0);
    economy.setCargo(van, "mail", 2);
    for (let i = 0; i < 3 * SORT_SECONDS * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
    expect(economy.cargoOf(van)).toMatchObject({ kind: "mail", count: 2 });
    expect(economy.sortedShare(van)).toBe(0);
  });

  it("a whole load turns to post after SORT_SECONDS a sack of running", () => {
    const { sim, economy, van } = oval(["engine", "sortvan"], false);
    // (No towns' mail here: the van's load is put on, as a save would.)
    economy.mailEvery = null;
    economy.setCargo(van, "mail", 2);
    let seconds = 0;
    while (economy.cargoOf(van).kind === "mail" && seconds < 120) {
      for (let i = 0; i < SIM_HZ; i++) {
        sim.tick();
        economy.tick();
      }
      seconds++;
      // (The train stops at the towns on its way: it may unload nothing, as they don't take mail.)
    }
    expect(economy.cargoOf(van).kind === "post" || economy.cargoOf(van).kind === null).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(2 * SORT_SECONDS);
  }, 60_000);

  it("balance: a sorting van line delivers no more post than mail vans and a post office on the same line", () => {
    const sorting = oval(["engine", "sortvan", "sortvan"], false);
    const office = oval(["engine", "mailvan", "mailvan"], true);
    sorting.run(15);
    office.run(15);
    expect(sorting.post()).toBeGreaterThan(0);
    expect(office.post()).toBeGreaterThan(0);
    expect(sorting.post()).toBeLessThanOrEqual(office.post() * 1.25);
  }, 180_000);
});

describe("saves", () => {
  it("a sorting van and its post are saved and loaded", () => {
    const w = buildStarterWorld();
    const station = [...w.stations.values()][0];
    const placed = w.sim.addTrain(["engine", "sortvan"], { pieceId: station, pathIndex: 0, reversed: false, s: 150 });
    expect(placed.kind).toBe("placed");
    if (placed.kind !== "placed") return;
    const van = w.sim.getTrain(placed.trainId)!.cars[1].id;
    w.economy.setCargo(van, "post", 2);
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const cars = back.value.sim.trainIds().flatMap((id) => back.value.sim.getTrain(id)!.cars);
    const loaded = cars.find((c) => c.kind === "sortvan")!;
    expect(back.value.economy.cargoOf(loaded.id)).toMatchObject({ kind: "post", count: 2 });
  });
});
