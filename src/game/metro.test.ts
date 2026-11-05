import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { Economy } from "../economy";
import { checkPlacement, setTunnels, SURF_ROAD } from "../landscape";
import { lineOf } from "../render/metro-line-view";
import { findTunnels } from "../render/tunnels-view";
import { LandEditor } from "../landscape/edit";
import { Sim, SIM_HZ, type CarKind, type CarLook } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, METRO_KIT, type PieceTypeId } from "../track";
import { attachEngines } from "./engines";
import { DIG_COINS, digWhy, METRO_COAL_SECONDS, METRO_QUARTERS, METRO_SLOWER, metroDraw, settleDigging, squaresDugUnder } from "./metro";
import { attachPassengers, peopleArrive, riderSeconds } from "./passengers";
import { Progress, inUse } from "./progress";
import { thingsFor, THING_RULES } from "./things";
import { BLUEPRINTS } from "./blueprints";
import { PRICES, townStatus } from "./towns";
import { buildStarterWorld, HALT_KITS, haltWhy, kioskAt, METRO_ENTRANCE, metroTown, stopTown, syncIndustries, type World } from "./world";

/** Lay `type` on free end `ref` (seated by an end of the other kind); returns its id. */
function lay(layout: Layout, ref: number, type: PieceTypeId): number {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  return appendPiece(layout, type, false, ref, via);
}
const otherEnd = (layout: Layout, id: number) => [0, 1].map((k) => connectorRef(id, k)).find((r) => layout.joinedConnector(r) === -1)!;

/** What a town needs delivered to be a City ★ (level 4): every level's wants before it. */
const CITY_STAR = { planks: 4 + 8 + 14 + 22, flour: 6 + 12, stone: 10 };

/**
 * A metro line in a City ★ (town 0): a straight, metro stop A, `gap` straights, metro stop B, a straight (open ends: a
 * train turns back at each). A power station off to one side with coal. Flat, as the economy sees it (the tunnel and
 * the town over it are the placement's, tested on a map below).
 */
function line(gap = 4) {
  const layout = new Layout();
  const s0 = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  const a = lay(layout, connectorRef(s0, 1), METRO_KIT);
  let last = a;
  const between: number[] = [];
  for (let i = 0; i < gap; i++) between.push((last = lay(layout, otherEnd(layout, last), "straight-216")));
  const b = lay(layout, otherEnd(layout, last), METRO_KIT);
  lay(layout, otherEnd(layout, b), "straight-216");
  const power = layout.addPiece("depot-power", { x: 0, z: 2000, heading: 0 });
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const A = economy.addDepot("town", a, 0);
  const B = economy.addDepot("town", b, 0);
  const P = economy.addDepot("power", power);
  P.piles[CARGO.coal.index] = 10_000;
  // (Setup: town 0 a City ★, as its deliveries would make it.)
  economy.delivered.set(0, CITY_STAR.planks);
  economy.deliveredGoods.set(0, { flour: CITY_STAR.flour, stone: CITY_STAR.stone });
  const w = { layout, sim, economy, stations: new Map(), depots: new Map(), landscape: { towns: [] } } as unknown as World;
  return { w, layout, sim, economy, A, B, P, s0, a, b, mid: between[1] };
}

/** A metro train (its motor car and two cars, in the metro's look) at `pieceId`, lever on. */
function metroTrain(w: World, pieceId: number, s = 150): number {
  const looks: CarLook[] = ["metro", "metro", "metro"];
  const cars: CarKind[] = ["engine", "passenger", "passenger"];
  const r = w.sim.addTrain(cars, { pieceId, pathIndex: 0, reversed: false, s });
  if (r.kind !== "placed") throw new Error(r.kind);
  const t = w.sim.getTrain(r.trainId)!;
  t.cars.forEach((c, i) => w.sim.setLook(c.id, looks[i]));
  w.sim.setLever(t.cars[0].id, 1);
  return t.cars[0].id;
}

describe("the metro: riders", () => {
  it("a metro stop is a quarter of its town: riders from one get off at another of the same town, and pay", () => {
    const { w, economy, A, sim, mid } = line(4);
    const p = Progress.fresh();
    p.learned.add("passengers");
    attachPassengers(w, () => p);
    attachEngines(w);
    A.waiting = 3;
    const engine = metroTrain(w, mid, 150);
    for (let i = 0; i < 40 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
    expect(p.riders).toBeGreaterThanOrEqual(3);
    expect(p.coins).toBeGreaterThanOrEqual(3);
    void engine;
  });

  it("riders turn up at a town's first two metro stops, each at half its town's rate, apart from its station's", () => {
    const { w, economy, A, B } = line(4);
    // A third metro stop, laid on past B: a stop, but no quarter of its own.
    const c = w.layout.addPiece(METRO_KIT, { x: 5000, z: 0, heading: 0 });
    const C = economy.addDepot("town", c, 0);
    const p = Progress.fresh();
    p.learned.add("passengers");
    const level = townStatus({ planks: CITY_STAR.planks, flour: CITY_STAR.flour, stone: CITY_STAR.stone }).level;
    expect(level).toBe(4);
    const every = riderSeconds(level) * METRO_SLOWER;
    const clock = new Map<number, number>();
    // Just short of two riders' time: one each at A and B, none at C.
    peopleArrive(w, p, every * 2 - 0.1, clock);
    expect([A.waiting, B.waiting, C.waiting]).toEqual([1, 1, 0]);
    expect(METRO_QUARTERS).toBe(2);
  });
});

describe("the metro: what it costs", () => {
  it("the dearest way to carry people: its stop, its train and its research all cost more than anything else for passengers", () => {
    const stop = THING_RULES["piece:kit-metro-stop"]!;
    const train = THING_RULES["look:metro"]!;
    const halt = THING_RULES["piece:kit-country-halt"]!;
    expect(stop.coins).toBe(600);
    expect(train.coins).toBe(400);
    expect((stop.coins ?? 0) > (halt.coins ?? 0) * 5).toBe(true);
    // Every other passenger stop and coach costs less (halts, big stations, coaches, the lookout).
    for (const id of [...HALT_KITS].map((t) => `piece:${t}`).concat(["piece:kit-two-platform-station", "piece:kit-grand-terminus", "car:passenger", "car:engine"])) {
      if (id === "piece:kit-metro-stop") continue;
      const r = THING_RULES[id as keyof typeof THING_RULES];
      expect(r?.coins ?? 0, id).toBeLessThan(train.coins!);
    }
    const metro = BLUEPRINTS.find((b) => b.id === "metro")!;
    expect(metro.plan).toBeUndefined();
    expect(metro.price.coins).toBe(400);
    // The metro train takes its own price besides its cars.
    const item = { kind: "train" as const, cars: ["engine", "passenger", "passenger"] as CarKind[], looks: ["metro", "metro", "metro"] as CarLook[] };
    expect([...thingsFor(item)]).toEqual([
      ["car:engine", 1],
      ["car:passenger", 2],
      ["look:metro", 1],
    ]);
  });

  it("a metro train on the map is one in use; a running one draws a coal every 20 s from the power station", () => {
    const { w, P, mid } = line(4);
    const engine = metroTrain(w, mid, 150);
    expect(inUse(w, "look:metro")).toBe(1);
    const t = w.sim.findCar(engine)!.train;
    t.speed = 50;
    const before = P.piles[CARGO.coal.index];
    const clock = new Map<number, number>();
    for (let s = 0; s < 3 * METRO_COAL_SECONDS; s++) metroDraw(w, 1, clock);
    expect(before - P.piles[CARGO.coal.index]).toBe(3);
    // Standing: none.
    t.speed = 0;
    for (let s = 0; s < 3 * METRO_COAL_SECONDS; s++) metroDraw(w, 1, clock);
    expect(before - P.piles[CARGO.coal.index]).toBe(3);
  });
});

describe("the metro: under a town", () => {
  /** A town of the starter map, and a line along a row of its squares, two levels under the felt. */
  function underTown() {
    const w = buildStarterWorld();
    setTunnels(true);
    const g = w.landscape.grid;
    const town = w.landscape.towns[0];
    // A free square of the town (no house, no station) to stand a kiosk on.
    // A square for a kiosk: a green of the town, or the grass beside it (the starter towns are houses and streets).
    const beside = (i: number) => [g.index(g.colOf(i) + 1, g.rowOf(i)), g.index(g.colOf(i) - 1, g.rowOf(i)), g.index(g.colOf(i), g.rowOf(i) + 1), g.index(g.colOf(i), g.rowOf(i) - 1)];
    const free =
      town.cells.find((i) => g.feature[i] === 0 && g.surface[i] !== SURF_ROAD && g.road[i] === 0) ??
      town.cells.flatMap(beside).find((i) => i !== -1 && !town.cells.includes(i) && g.feature[i] === 0 && g.surface[i] === 0 && g.road[i] === 0 && g.height[i] === 0 && w.landscape.towns.every((t) => t === town || !t.cells.includes(i)))!;
    return { w, g, town, free };
  }

  it("a metro stop goes two levels under the felt, wholly in the tunnel; not on the felt, not a level down", () => {
    const { w, town } = underTown();
    const pose = { x: town.centre.x - 108, z: town.centre.z, heading: 0 };
    expect(checkPlacement(w.landscape, METRO_KIT, false, pose, -96)).toEqual({ kind: "clear" });
    expect(checkPlacement(w.landscape, METRO_KIT, false, pose, 0).kind).toBe("blocked");
    // (Points still need daylight.)
    expect(checkPlacement(w.landscape, "switch", false, pose, -96)).toEqual({ kind: "blocked", reason: "daylight" });
    setTunnels(false);
  });

  it("its entrance goes on a free square of a town; it's a stop of that town", () => {
    const { w, g, town, free } = underTown();
    // A pose whose kiosk lands on the free square's middle.
    const fx = g.centreX(g.colOf(free));
    const fz = g.centreZ(g.rowOf(free));
    const at = kioskAt({ x: 0, z: 0, heading: 0 });
    const pose = { x: fx - at.x, z: fz - at.z, heading: 0 };
    expect(metroTown(w.landscape, pose)?.id).toBe(town.id);
    expect(haltWhy(w.landscape, METRO_KIT, pose)).toBeNull();
    expect(stopTown(w.landscape, METRO_KIT, pose)?.id).toBe(town.id);
    // On a house: no.
    const house = town.buildings[0].cells[0];
    const onHouse = { x: g.centreX(g.colOf(house)) - at.x, z: g.centreZ(g.rowOf(house)) - at.z, heading: 0 };
    expect(haltWhy(w.landscape, METRO_KIT, onHouse)).toBe(METRO_ENTRANCE);
    // On a street: no (road vehicles drive there).
    const street = town.cells.find((i) => g.surface[i] === SURF_ROAD || g.road[i] !== 0);
    if (street !== undefined) expect(haltWhy(w.landscape, METRO_KIT, { x: g.centreX(g.colOf(street)) - at.x, z: g.centreZ(g.rowOf(street)) - at.z, heading: 0 })).toBe(METRO_ENTRANCE);
    // Laid: a stop of that town's, a metro stop.
    const id = w.layout.addPiece(METRO_KIT, pose, -96, false);
    syncIndustries(w, true);
    const d = w.economy.depotAtPiece(id)!;
    expect(d.townId).toBe(town.id);
    expect(w.economy.isMetro(d)).toBe(true);
    setTunnels(false);
  });

  it("the town can grow over a line two levels down, but not on a metro stop's entrance", () => {
    const { w, g, town } = underTown();
    // A square a house could go on now (the town's grass, or the grass by it).
    const near = [...town.cells, ...town.cells.flatMap((i) => [g.index(g.colOf(i) + 1, g.rowOf(i)), g.index(g.colOf(i) - 1, g.rowOf(i)), g.index(g.colOf(i), g.rowOf(i) + 1), g.index(g.colOf(i), g.rowOf(i) - 1)])];
    const free = near.find((i) => i >= 0 && new LandEditor(w.landscape, w.layout).checkLot([i], false) === null)!;
    expect(free).toBeDefined();
    const x = g.centreX(g.colOf(free));
    const z = g.centreZ(g.rowOf(free));
    // A deep straight right under the free square: the land editor still lets a house go there.
    const deepId = w.layout.addPiece("straight-216", { x: x - 108, z, heading: 0 }, -96, false);
    expect(new LandEditor(w.landscape, w.layout).checkLot([free], false)).toBeNull();
    w.layout.removePiece(deepId);
    // The same at the felt: not.
    const top = w.layout.addPiece("straight-216", { x: x - 108, z, heading: 0 }, 0, false);
    expect(new LandEditor(w.landscape, w.layout).checkLot([free], false)).toBe("track");
    w.layout.removePiece(top);
    // A metro stop whose kiosk stands there: not.
    const at = kioskAt({ x: 0, z: 0, heading: 0 });
    w.layout.addPiece(METRO_KIT, { x: x - at.x, z: z - at.z, heading: 0 }, -96, false);
    expect(new LandEditor(w.landscape, w.layout).checkLot([free], false)).toBe("track");
    void town;
    setTunnels(false);
  });

  it("digging under a town costs 60 coins a square, once; refused when the coins are short", () => {
    const { w, town } = underTown();
    const p = Progress.fresh();
    const pose = { x: town.centre.x - 108, z: town.centre.z, heading: 0 };
    p.coins = 10;
    expect(digWhy(w, p, "straight-216", pose, -96)).toMatch(/^Digging under the town costs \d+🪙: you have 10🪙$/);
    // (On the felt, or well away from any town: nothing to dig.)
    expect(digWhy(w, p, "straight-216", pose, 0)).toBeNull();
    expect(digWhy(w, p, "straight-216", { ...pose, x: pose.x + 30000 }, -96)).toBeNull();
    p.coins = 1000;
    expect(digWhy(w, p, "straight-216", pose, -96)).toBeNull();
    w.layout.addPiece("straight-216", pose, -96, false);
    const squares = squaresDugUnder(w);
    expect(squares).toBeGreaterThanOrEqual(3);
    expect(settleDigging(p, squares)).toBe(squares * DIG_COINS);
    expect(p.coins).toBe(1000 - squares * DIG_COINS);
    expect(settleDigging(p, squares)).toBe(0);
    setTunnels(false);
  });
});

/**
 * The payback (the user: "Balance it so the extra riders pay back slowly, over a long game"): a metro across a City ★,
 * two stops ~1.1 m apart (a big city's width), one metro train, run 30 game minutes on the sim and economy's own ticks.
 * What it costs against what its riders pay, less the coal it draws (valued at a town's price for coal).
 */
describe("the metro: payback", { timeout: 120_000 }, () => {
  it("pays back slowly: more than two hours of play for the line, after its research", () => {
    const { w, economy, sim, P, mid } = line(4);
    const p = Progress.fresh();
    p.learned.add("passengers");
    p.learned.add("stations");
    attachPassengers(w, () => p);
    attachEngines(w);
    metroTrain(w, mid, 150);
    const clock = new Map<number, number>();
    const draw = new Map<number, number>();
    const coal0 = P.piles[CARGO.coal.index];
    const MINUTES = 30;
    for (let sec = 0; sec < MINUTES * 60; sec++) {
      for (let k = 0; k < SIM_HZ; k++) {
        sim.tick();
        economy.tick();
      }
      peopleArrive(w, p, 1, clock);
      metroDraw(w, 1, draw);
    }
    // (The power station's own burn aside: only what the train drew.)
    const coal = coal0 - P.piles[CARGO.coal.index];
    const perMin = { coins: p.coins / MINUTES, riders: p.riders / MINUTES, coal: coal / MINUTES };
    // (A coal's worth: what a town pays for one, `PRICES.coal`.)
    const COAL_PRICE = PRICES.coal!;
    const net = perMin.coins - perMin.coal * COAL_PRICE;
    // The line's coins: two stops, the train, and the digging under a city's width (its two stops and four straights
    // under some 16 of its squares).
    const squares = 16;
    const outlay = 2 * THING_RULES["piece:kit-metro-stop"]!.coins! + THING_RULES["look:metro"]!.coins! + squares * DIG_COINS;
    const research = BLUEPRINTS.find((b) => b.id === "metro")!.price.coins ?? 0;
    // Its iron (2 × 25 + 15, and the research's 40) valued at a town's price for iron (8).
    const iron = (2 * 25 + 15) * PRICES.iron!;
    const payback = { line: Math.round(outlay / net), lineAndIron: Math.round((outlay + iron) / net), withResearch: Math.round((outlay + iron + research + 40 * PRICES.iron!) / net) };
    console.log(`metro payback: ${JSON.stringify({ perMin, net: Math.round(net * 10) / 10, outlay, iron, research, payback })}`);
    expect(perMin.riders).toBeGreaterThan(0);
    expect(net).toBeGreaterThan(0);
    // Slowly: the line alone takes over an hour and a half of play to pay for itself; with its iron and its research,
    // over two and a half hours (the long part of a game runs 180 to 440 minutes).
    expect(payback.line).toBeGreaterThan(100);
    expect(payback.withResearch).toBeGreaterThan(150);
  });
});

describe("the metro: showing the line", () => {
  it("a stop's line is the track two levels under the felt joined to it, and the mouths at its ends; not past them", () => {
    const layout = new Layout();
    const s0 = layout.addPiece("straight-216", { x: -216, z: 0, heading: 0 });
    const m0 = lay(layout, connectorRef(s0, 1), "tunnel-mouth");
    const d0 = lay(layout, otherEnd(layout, m0), "straight-216");
    const stop = lay(layout, otherEnd(layout, d0), METRO_KIT);
    const d1 = lay(layout, otherEnd(layout, stop), "straight-216");
    expect(layout.getPiece(stop)!.y).toBe(-96);
    expect(new Set(lineOf(layout, stop))).toEqual(new Set([m0, d0, stop, d1]));
  });
});

describe("the metro: dashes over a street", () => {
  it("over a line under a town's street, the dashes are painted on the street's top, not hidden under it", () => {
    const w = buildStarterWorld();
    setTunnels(true);
    const g = w.landscape.grid;
    const town = w.landscape.towns[0];
    const street = town.cells.find((i) => g.surface[i] === SURF_ROAD || g.road[i] !== 0)!;
    const x = g.centreX(g.colOf(street));
    const z = g.centreZ(g.rowOf(street));
    w.layout.addPiece("straight-216", { x: x - 108, z, heading: 0 }, -96, false);
    const { dashes } = findTunnels(w.layout, w.landscape);
    const over = dashes.filter((d) => g.cellAtWorld(d.x0, d.z0) === street);
    expect(over.length).toBeGreaterThan(0);
    for (const d of over) expect(d.y).toBeGreaterThanOrEqual(4.5);
    setTunnels(false);
  });
});
