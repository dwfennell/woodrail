import { beforeAll, describe, expect, it } from "vitest";
import { loadFootprints } from "../props/footprints-testing";
import { checkProp, TrackIndex, type Footprint } from "../props/placement";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { CATALOGUE } from "../catalogue/assets";
import { kindsOf, total } from "../economy/goods";
import { advanceGrands, achievements, centralWhy, countRider, earned, GRAND_CENTRAL_KITS, moveCentralKit, HUB_FARE, hubFare, exhibitionGift, FAIR_MONTH, FAIR_RIDERS, fairTown, giveExhibition, GRAND_LEVEL, grandOf, grandRiders, grandRow, GRANDS, growthCut, PILGRIMS, ROYAL_GIFT, siteAsset, siteSpot, stageLacks, startGrand, unionFootprint, WHEEL_COINS, wheelTickets, type GrandId } from "./grand";
import { RECIPES } from "../economy/economy";
import { CARRIES } from "../economy/cargo";
import { FULL_PAY } from "./towns";
import { isGift, ruleOf } from "./things";
import { fareFor, ROYAL_FARE, SEATS } from "./passengers";
import { appendPiece, connectorRef, getPieceDef } from "../track";
import { startLine } from "./lines";
import { Progress } from "./progress";
import { growthOf, receivedBy, statusOf, TownLife, type TownLifeHost } from "./town-life";
import { townLevel, townStatus, wantsWith } from "./towns";
import { buildStarterWorld, syncIndustries, type World } from "./world";
import { deliverByTrain } from "./workshop-testing";
import type { Town } from "../landscape";

/**
 * Grand projects (spec 2026-11-05-character-and-goals.md): started from a City ★'s card, built in stages from goods
 * brought by train to its station, and finished for a lasting reward. By the player's path: Build on the card
 * (`startGrand`: coins paid, its site found by the city), each stage's goods by train (`deliverByTrain` to the city's
 * station), its stages moving on as TownLife sees the goods in (`advanceGrands`, the site's model swapped).
 */

let footprintOf: (asset: string) => Footprint | undefined = () => undefined;
beforeAll(async () => {
  footprintOf = await loadFootprints(["bldg", "scene", "grand"]);
}, 60_000);

/** A starter world with Game mode's towns living, and what TownLife said (grand goods in, towns grown). */
function game() {
  const w = buildStarterWorld();
  const said = { grand: 0, grew: [] as number[] };
  const host: TownLifeHost = Object.assign(w, { footprintOf: (a: string) => footprintOf(a), editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
  const life = new TownLife(host, { grew: (t) => said.grew.push(t.id), received: () => {}, grandGoods: () => said.grand++ });
  life.reset();
  const p = Progress.fresh();
  return { w, life, p, said };
}

/** A town grown to `level` (deliveries written as trains would bring them: a setup shortcut, as places.test.ts). */
function growTo(w: World, life: TownLife, townId: number, level: number): void {
  const bag: Record<string, number> = {};
  for (let k = 0; k < level; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) bag[g] = (bag[g] ?? 0) + n!;
  w.economy.delivered.set(townId, bag.planks ?? 0);
  w.economy.deliveredGoods.set(townId, { ...bag });
  life.update();
}

/** Every town's standing, as main gives the Achievements tab. */
function standings(w: World) {
  return w.landscape.towns.map((town) => {
    const s = statusOf(w, town.id);
    return { town, level: s.level, name: s.name, have: total(s.got), need: total(s.wants) };
  });
}

/** Every stage's footprint of a project, together (its whole site), as main finds it. */
/** Saved and loaded again, as a reload does. */
function reload(w: World): World {
  const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
  if (!back.ok) throw new Error(back.error);
  return back.value;
}

const siteOf = (id: GrandId) => {
  const g = grandOf(id)!;
  return unionFootprint(
    Array.from({ length: g.stages.length + 1 }, (_, i) => footprintOf(siteAsset(g, i))),
    g.scale,
  )!;
};

/** Tap Build on a project's tile, as main does: its site found by the city, its plot put up. */
function build(w: World, p: Progress, town: Town, id: GrandId) {
  const level = statusOf(w, town.id).level;
  return startGrand(w, p, town, level, id, () => siteSpot(w, town, siteOf(id), footprintOf), (asset, pose, scale) => w.props.add(asset, pose, undefined, { scale }).id);
}

/** Swap a site's model as main does (`advanceGrand`). */
const swap = (w: World) => (prop: number, asset: string) => {
  const p = w.props.get(prop)!;
  w.props.remove(prop);
  w.props.add(asset, { x: p.x, z: p.z, heading: p.heading, y: p.y }, prop, { scale: p.scale });
};

/** Bring a stage's goods by train to the city's station, kind by kind, and let TownLife and the stages see them. */
function bringStage(w: World, life: TownLife, town: Town, id: GrandId) {
  const plan = w.economy.grandPlans.get(id)!;
  const stage = grandOf(id)!.stages[plan.stage];
  for (const k of kindsOf(stage.goods)) deliverByTrain(w, w.stations.get(town.id)!, k, stage.goods[k]!);
  life.update();
  return advanceGrands(w, swap(w));
}

describe("the grand projects' table", () => {
  it("each has stages of goods, a price, a reward and a model per stage (0: its plot)", () => {
    const ids = new Set(CATALOGUE.map((a) => a.id));
    for (const g of GRANDS) {
      expect(g.stages.length, g.id).toBeGreaterThanOrEqual(3);
      expect(g.coins, g.id).toBeGreaterThan(0);
      expect(g.reward.length, g.id).toBeGreaterThan(10);
      for (const s of g.stages) expect(total(s.goods) + (s.riders ?? 0), `${g.id} ${s.name}`).toBeGreaterThan(0);
      for (let i = 0; i <= g.stages.length; i++) expect(ids.has(siteAsset(g, i)), siteAsset(g, i)).toBe(true);
    }
  });
});

describe("the City ★ card's Grand projects row", () => {
  it("waits for a City ★, then offers Build for its coins; short of coins it says so", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, 3);
    expect(grandRow(w, p, town, statusOf(w, town.id).level)[0].state).toBe("level");
    growTo(w, life, town.id, GRAND_LEVEL);
    p.coins = 10;
    expect(grandRow(w, p, town, statusOf(w, town.id).level)[0].state).toBe("short");
    p.coins = 1000;
    const tile = grandRow(w, p, town, statusOf(w, town.id).level)[0];
    expect(tile.state).toBe("build");
    expect(tile.note).toContain(String(grandOf("exhibition")!.coins));
  });

  it("is one per map: started in one city, another says so", () => {
    const { w, life, p } = game();
    const [a, b] = w.landscape.towns;
    growTo(w, life, a.id, GRAND_LEVEL);
    growTo(w, life, b.id, GRAND_LEVEL);
    p.coins = 1000;
    expect(build(w, p, a, "exhibition")).toBe("started");
    expect(grandRow(w, p, b, statusOf(w, b.id).level)[0].state).toBe("elsewhere");
    expect(grandRow(w, p, a, statusOf(w, a.id).level)[0].state).toBe("building");
    // (Tapped again: nothing.)
    expect(build(w, p, b, "exhibition")).toBe("not-now");
  });
});

describe("starting a grand project", () => {
  it("pays its coins and puts its plot on clear, level land by the city: clear of track, props and the town", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, GRAND_LEVEL);
    p.coins = 1000;
    const g = grandOf("exhibition")!;
    expect(build(w, p, town, "exhibition")).toBe("started");
    expect(p.coins).toBe(1000 - g.coins);
    const plan = w.economy.grandPlans.get("exhibition")!;
    expect(plan).toMatchObject({ townId: town.id, stage: 0, got: {} });
    const prop = w.props.get(plan.prop)!;
    expect(prop.asset).toBe("grand-exhibition-0");
    expect(prop.scale).toBe(g.scale);
    // Its whole site (every stage's) was clear where it stands.
    const c = checkProp({ land: w.landscape, track: new TrackIndex(w.layout), props: w.props, footprint: footprintOf }, siteOf("exhibition"), prop, "land", prop.id);
    expect(c.kind).toBe("clear");
    expect(Math.hypot(prop.x - town.centre.x, prop.z - town.centre.z)).toBeLessThan(1400);
  });

  it("with no room by the city, nothing is paid or put up", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, GRAND_LEVEL);
    p.coins = 1000;
    const props = w.props.size;
    expect(startGrand(w, p, town, GRAND_LEVEL, "exhibition", () => null, () => -1)).toBe("no-room");
    expect(p.coins).toBe(1000);
    expect(w.economy.grandPlans.size).toBe(0);
    expect(w.props.size).toBe(props);
  });
});

describe("building it, stage by stage, by train", () => {
  it("a stage's goods go into it at the city's station (unpaid, not toward growth), and it moves on: its model swapped", () => {
    const { w, life, p, said } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, GRAND_LEVEL);
    p.coins = 1000;
    build(w, p, town, "exhibition");
    const plan = w.economy.grandPlans.get("exhibition")!;
    const before = receivedBy(w, town.id);
    // Half the first stage's stone: it's had that, the city none of it.
    const left = deliverByTrain(w, w.stations.get(town.id)!, "stone", 10);
    expect(left).toBe(0);
    expect(plan.got.stone).toBe(10);
    expect(receivedBy(w, town.id).stone).toBe(before.stone);
    expect(stageLacks("exhibition", plan, "stone")).toBe(10);
    life.update();
    expect(said.grand).toBeGreaterThan(0);
    expect(advanceGrands(w, swap(w))).toEqual([]);
    // The rest of the stage: it moves on to the iron hall, and its site shows the foundations.
    const ev = bringStage(w, life, town, "exhibition");
    expect(ev).toEqual([{ kind: "stage", id: "exhibition", stage: 1 }]);
    expect(plan.stage).toBe(1);
    expect(plan.got).toEqual({});
    expect(w.props.get(plan.prop)!.asset).toBe("grand-exhibition-1");
  });

  it("takes only what its stage under way lacks: more of a filled good goes to the city as ever", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, GRAND_LEVEL);
    p.coins = 1000;
    build(w, p, town, "exhibition");
    const plan = w.economy.grandPlans.get("exhibition")!;
    const stone = receivedBy(w, town.id).stone ?? 0;
    deliverByTrain(w, w.stations.get(town.id)!, "stone", 24);
    expect(plan.got.stone).toBe(20);
    expect(receivedBy(w, town.id).stone).toBe(stone + 4);
  });

  it("four stages by train: earned, an achievement in the Journal, its site the finished hall", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, GRAND_LEVEL);
    p.coins = 1000;
    build(w, p, town, "exhibition");
    const all = [];
    for (let i = 0; i < 4; i++) all.push(...bringStage(w, life, town, "exhibition"));
    expect(all.map((e) => e.kind)).toEqual(["stage", "stage", "stage", "earned"]);
    expect(earned(w, "exhibition")).toBe(true);
    expect(w.props.get(w.economy.grandPlans.get("exhibition")!.prop)!.asset).toBe("grand-exhibition-4");
    const view = achievements(w, p, standings(w)).find((a) => a.id === "exhibition")!;
    expect(view).toMatchObject({ done: 4, of: 4, earned: true, town: town.name });
    // Finished, it takes nothing more: stone goes to the city.
    expect(stageLacks("exhibition", w.economy.grandPlans.get("exhibition")!, "stone")).toBe(0);
    expect(grandRow(w, p, town, statusOf(w, town.id).level)[0].state).toBe("earned");
  });
});

describe("the Journal's Build it in: the player picks the city", () => {
  it("lists every City ★ that could build it, ready ones first, with what each can do; then the nearest to City ★", () => {
    const { w, life, p } = game();
    const [a, b, c] = w.landscape.towns;
    growTo(w, life, a.id, GRAND_LEVEL);
    growTo(w, life, b.id, GRAND_LEVEL);
    growTo(w, life, c.id, GRAND_LEVEL - 1);
    p.coins = 1000;
    // b builds the Cathedral first: it can't start a second until that's done.
    build(w, p, b, "cathedral");
    const view = achievements(w, p, standings(w)).find((v) => v.id === "exhibition")!;
    expect(view.line).toBe("Pick a City ★ to build it in");
    // (The hamlets aren't listed: there's a City ★ to build it in.)
    expect(view.cities.map((r) => [r.name, r.ready, r.star])).toEqual([
      [a.name, true, true],
      [b.name, false, true],
      [c.name, false, false],
    ]);
    expect(view.cities[0].note).toBe("Ready: start it for 400 🪙");
    expect(view.cities[1].note).toBe("Building the Cathedral: one at a time");
    expect(view.cities[2].note).toMatch(/^\d+ of \d+ goods to grow$/);
    expect(view.cities.length).toBeLessThanOrEqual(4);
    // Started, it lists no towns: its line says where it is.
    expect(achievements(w, p, standings(w)).find((v) => v.id === "cathedral")!.cities).toEqual([]);
  });

  it("short of coins, says how many; with no City ★, lists the towns nearest to one", () => {
    const { w, life, p } = game();
    const [a] = w.landscape.towns;
    expect(achievements(w, p, standings(w))[0].cities.every((r) => !r.star)).toBe(true);
    expect(achievements(w, p, standings(w))[0].line).toBe("Grow a town into a City ★ to build it");
    growTo(w, life, a.id, GRAND_LEVEL);
    p.coins = 120;
    expect(achievements(w, p, standings(w))[0].cities[0]).toMatchObject({ name: a.name, ready: false, note: "Needs 400 🪙 (you have 120)" });
  });
});

describe("the Great Exhibition's reward: every town grows a step", () => {
  it("a town below a city is given all it lacks for its next level; a city a quarter of its next star's wants", () => {
    expect(exhibitionGift(1, { planks: 8 }, { planks: 3 })).toEqual({ planks: 5 });
    expect(exhibitionGift(4, { planks: 33, iron: 10 }, { planks: 30, iron: 0 })).toEqual({ planks: 3, iron: 3 });
  });

  it("given as it opens, every town below a city grows a level on the next update, and it's saved", () => {
    const { w, life, said } = game();
    const [city, ...rest] = w.landscape.towns;
    growTo(w, life, city.id, GRAND_LEVEL);
    const before = new Map(w.landscape.towns.map((t) => [t.id, statusOf(w, t.id).level]));
    const cityFill = statusOf(w, city.id).fill;
    giveExhibition(w, w.landscape, (id) => statusOf(w, id));
    life.rewardsChanged();
    said.grew.length = 0;
    life.update();
    for (const t of rest) expect(statusOf(w, t.id).level, t.name).toBe(before.get(t.id)! + 1);
    expect(new Set(said.grew)).toEqual(new Set(rest.map((t) => t.id)));
    expect(statusOf(w, city.id).level).toBe(GRAND_LEVEL);
    expect(statusOf(w, city.id).fill).toBeGreaterThan(cityFill + 0.2);
    // Saved with the world, and held after loading.
    const back = reload(w);
    for (const t of w.landscape.towns) expect(growthOf(back, t.id), t.name).toEqual(growthOf(w, t.id));
  });
});

describe("rewards that cut what towns need (the Cathedral's tenth)", () => {
  it("adds to the smiles' cut, rounded up, never below one; none until earned", () => {
    expect(wantsWith(4, 0, 0.1)).toEqual(Object.fromEntries(Object.entries(townLevel(4).wants).map(([k, n]) => [k, Math.ceil(n! * 0.9 - 1e-9)])));
    expect(wantsWith(0, 2, 0.1).planks).toBe(Math.ceil(4 * 0.8 - 1e-9));
    const { w } = game();
    expect(growthCut(w)).toBe(0);
    expect(townStatus({ planks: 3 }, 0, 0.25).level).toBe(1);
  });
});

describe("saves", () => {
  it("keep a project under way: its city, stages done, goods so far and site", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, GRAND_LEVEL);
    p.coins = 1000;
    build(w, p, town, "exhibition");
    bringStage(w, life, town, "exhibition");
    deliverByTrain(w, w.stations.get(town.id)!, "iron", 5);
    const plan = w.economy.grandPlans.get("exhibition")!;
    const back = reload(w);
    expect(back.economy.grandPlans.get("exhibition")).toEqual(plan);
    expect(back.props.get(plan.prop)!.asset).toBe("grand-exhibition-1");
  });
});

describe("the early game is as it was", () => {
  it("with no project, a town's status is what it was before projects (no gift, no cut)", () => {
    const { w, life } = game();
    for (const t of w.landscape.towns) growTo(w, life, t.id, 2);
    for (const t of w.landscape.towns) expect(statusOf(w, t.id)).toEqual(townStatus(growthOf(w, t.id), 0));
    expect(w.economy.grandGift.size).toBe(0);
    expect(achievements(w, Progress.fresh(), standings(w)).every((a) => !a.earned && a.done === 0)).toBe(true);
  });

  it("no project can start below City ★: the earliest is after the bands' 180-minute window", () => {
    const { w, life, p } = game();
    p.coins = 10_000;
    const town = w.landscape.towns[0];
    for (let level = 0; level < GRAND_LEVEL; level++) {
      growTo(w, life, town.id, level);
      for (const g of GRANDS) expect(startGrand(w, p, town, statusOf(w, town.id).level, g.id, () => ({ x: 0, z: 0, heading: 0, y: 0 }), () => 0), `${g.id} at ${level}`).toBe("not-now");
    }
  });
});

/** Finish project `id` in `town` by the player's path: Build, then every stage's goods by train. */
function finish(w: World, life: TownLife, p: Progress, town: Town, id: GrandId) {
  p.coins = Math.max(p.coins, grandOf(id)!.coins + 100);
  expect(build(w, p, town, id), id).toBe("started");
  const all = [];
  for (let i = 0; i < grandOf(id)!.stages.length; i++) all.push(...bringStage(w, life, town, id));
  expect(all.at(-1), id).toEqual({ kind: "earned", id });
  return all;
}

describe("the Cathedral", () => {
  it("built in four stages by train (glass from a glassworks among them), then every town needs a tenth fewer goods to grow", () => {
    const { w, life, p } = game();
    const [city, other] = w.landscape.towns;
    growTo(w, life, city.id, GRAND_LEVEL);
    growTo(w, life, other.id, 1);
    const before = statusOf(w, other.id).wants.planks!;
    finish(w, life, p, city, "cathedral");
    expect(w.props.get(w.economy.grandPlans.get("cathedral")!.prop)!.asset).toBe("grand-cathedral-4");
    expect(growthCut(w)).toBeCloseTo(0.1);
    life.rewardsChanged();
    expect(statusOf(w, other.id).wants.planks).toBe(Math.ceil(before * 0.9 - 1e-9));
  });

  it("brings pilgrims to its city (1.5× riders), none elsewhere", () => {
    const { w, life, p } = game();
    const [city, other] = w.landscape.towns;
    growTo(w, life, city.id, GRAND_LEVEL);
    expect(grandRiders(w, city.id)).toBe(0);
    finish(w, life, p, city, "cathedral");
    expect(grandRiders(w, city.id)).toBeCloseTo(PILGRIMS - 1);
    expect(grandRiders(w, other.id)).toBe(0);
  });
});

describe("the glassworks", () => {
  it("makes glass of coal (its sand from its own pit: it needs no coast), and towns buy glass at the full price", () => {
    expect(RECIPES.glassworks).toMatchObject({ takes: ["coal"], gives: ["glass"] });
    expect(FULL_PAY.has("glass")).toBe(true);
    expect(RECIPES.town.takes).toContain("glass");
    expect(CARRIES.van).toContain("glass");
    expect(ruleOf("piece:depot-glassworks")?.tech).toBe("glassworks");
  });
});

describe("the Royal Train", () => {
  it("finished, its engine and two saloons are a gift (never made), and its riders pay double", () => {
    const { w, life, p } = game();
    const city = w.landscape.towns[0];
    growTo(w, life, city.id, GRAND_LEVEL);
    finish(w, life, p, city, "royal-train");
    for (const [thing, n] of ROYAL_GIFT) p.add(thing, n);
    expect(isGift("look:royal")).toBe(true);
    expect(p.owned.get("look:royal")).toBe(1);
    const [a, b] = w.landscape.towns;
    const A = w.economy.depotAtPiece(w.stations.get(a.id)!)!;
    const B = w.economy.depotAtPiece(w.stations.get(b.id)!)!;
    let last = w.stations.get(a.id)!;
    for (let i = 0; i < 3; i++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
    const placed = w.sim.addTrain(["engine", "passenger"], { pieceId: last, pathIndex: 0, reversed: false, s: 200 });
    if (placed.kind !== "placed") throw new Error("no room");
    const [, coach] = w.sim.getTrain(placed.trainId)!.cars;
    const plain = fareFor(w, A, B, coach.id);
    w.sim.setLook(coach.id, "royal");
    expect(fareFor(w, A, B, coach.id)).toBe(plain * ROYAL_FARE);
    expect(SEATS.royal).toBeGreaterThan(0);
  });
});

describe("the World's Fair wheel", () => {
  it("pays its tickets each month once finished, and July is fair week in its city (3× riders)", () => {
    const { w, life, p } = game();
    const city = w.landscape.towns[0];
    growTo(w, life, city.id, GRAND_LEVEL);
    expect(wheelTickets(w, 3, 5).coins).toBe(0);
    finish(w, life, p, city, "ferris-wheel");
    // (The first look this session pays nothing: the calendar is the session's.)
    expect(wheelTickets(w, -1, 5)).toEqual({ coins: 0, paidTo: 5 });
    expect(wheelTickets(w, 5, 7)).toEqual({ coins: 2 * WHEEL_COINS, paidTo: 7 });
    expect(wheelTickets(w, 7, 7).coins).toBe(0);
    expect(grandRiders(w, city.id, FAIR_MONTH)).toBe(FAIR_RIDERS - 1);
    expect(grandRiders(w, city.id, FAIR_MONTH + 1)).toBe(0);
    expect(fairTown(w, FAIR_MONTH)).toBe(city.id);
  });
});

describe("Grand Central", () => {
  /** Town 0 a City ★, Grand Central started on its card as main does it (its kit into the toy box). */
  function central() {
    const g = game();
    const { w, life, p } = g;
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, GRAND_LEVEL);
    p.coins = 1000;
    const kit = grandOf("central")!.kits![0];
    const r = startGrand(w, p, town, statusOf(w, town.id).level, "central", () => ({ ...town.station, y: 0 }), () => {
      p.add(`piece:${kit}`, 1);
      return -1;
    });
    expect(r).toBe("started");
    return { ...g, town };
  }

  /** Its kit from the toy box put down by the city (a little way from its station, along the line), joined on. */
  function place(w: World, town: Town): number {
    const st = w.layout.getPiece(w.stations.get(town.id)!)!.pose;
    const id = w.layout.addPiece("kit-grand-central-1", { x: st.x, z: st.z - 400, heading: st.heading });
    syncIndustries(w, true);
    return id;
  }

  it("is given into the toy box as it's started (a gift, never made), and goes on a line by its city as one of its stops", () => {
    const { w, p, town } = central();
    expect(p.owned.get("piece:kit-grand-central-1")).toBe(1);
    expect(isGift("piece:kit-grand-central-1")).toBe(true);
    const id = place(w, town);
    expect(getPieceDef("kit-grand-central-1", false).paths).toHaveLength(3);
    expect(getPieceDef("kit-grand-central-1", false).paths.every((pa) => pa.to !== null)).toBe(true);
    const d = w.economy.depotAtPiece(id)!;
    expect(d.role).toBe("town");
    expect(d.townId).toBe(town.id);
    // Only by its own city.
    expect(centralWhy(w, "kit-grand-central-1", town)).toBeNull();
    expect(centralWhy(w, "kit-grand-central-1", w.landscape.towns[1])).toContain(town.name);
    expect(centralWhy(w, "kit-grand-terminus", w.landscape.towns[1])).toBeNull();
    // Its kits per stage keep the same roads: retyped stage by stage with its joints kept.
    for (const k of GRAND_CENTRAL_KITS) expect(w.layout.canRetype(id, k), k).toBe(true);
  });

  it("goods by train for its first two stages, then riders carried through its city; its kit moved on stage by stage", () => {
    const { w, life, p, town } = central();
    const id = place(w, town);
    const kitOfStage = () => grandOf("central")!.kits![w.economy.grandPlans.get("central")!.stage];
    bringStage(w, life, town, "central");
    moveCentralKit(w, p, kitOfStage());
    expect(w.layout.getPiece(id)!.type).toBe("kit-grand-central-2");
    expect(p.owned.get("piece:kit-grand-central-1")).toBe(0);
    expect(p.owned.get("piece:kit-grand-central-2")).toBe(1);
    bringStage(w, life, town, "central");
    moveCentralKit(w, p, kitOfStage());
    expect(w.layout.getPiece(id)!.type).toBe("kit-grand-central-3");
    const plan = w.economy.grandPlans.get("central")!;
    expect(plan.stage).toBe(2);
    // Goods take it no further: riders do, getting on or off in its city.
    expect(advanceGrands(w, swap(w))).toEqual([]);
    const other = w.landscape.towns[2].id;
    expect(countRider(w, other, w.landscape.towns[3].id)).toBe(false);
    for (let i = 0; i < 59; i++) expect(countRider(w, i % 2 ? town.id : other, i % 2 ? other : town.id)).toBe(true);
    expect(advanceGrands(w, swap(w))).toEqual([]);
    countRider(w, other, town.id);
    expect(advanceGrands(w, swap(w))).toEqual([{ kind: "earned", id: "central" }]);
    expect(earned(w, "central")).toBe(true);
  });

  it("not yet on the map, its stages move the kit in the toy box along", () => {
    const { w, life, p, town } = central();
    bringStage(w, life, town, "central");
    moveCentralKit(w, p, grandOf("central")!.kits![1]);
    expect(p.owned.get("piece:kit-grand-central-1")).toBe(0);
    expect(p.owned.get("piece:kit-grand-central-2")).toBe(1);
  });

  it("finished, riders on a line through it pay a quarter more; off its lines, as ever", () => {
    const { w, life, p, town } = central();
    const id = place(w, town);
    const C = w.economy.depotAtPiece(id)!;
    const [, b, c] = w.landscape.towns;
    const A = w.economy.depotAtPiece(w.stations.get(b.id)!)!;
    const B = w.economy.depotAtPiece(w.stations.get(c.id)!)!;
    let last = w.stations.get(b.id)!;
    for (let i = 0; i < 3; i++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
    const placed = w.sim.addTrain(["engine", "passenger"], { pieceId: last, pathIndex: 0, reversed: false, s: 200 });
    if (placed.kind !== "placed") throw new Error("no room");
    const [engine, coach] = w.sim.getTrain(placed.trainId)!.cars;
    const plain = fareFor(w, A, B, coach.id);
    for (let i = 0; i < 2; i++) bringStage(w, life, town, "central");
    for (let i = 0; i < 60; i++) countRider(w, town.id, b.id);
    advanceGrands(w, swap(w));
    moveCentralKit(w, p, "kit-grand-central-3");
    expect(earned(w, "central")).toBe(true);
    expect(fareFor(w, A, B, coach.id)).toBe(plain);
    startLine(w.economy, engine.id, [
      { depotId: A.id, action: "both" },
      { depotId: C.id, action: "both" },
      { depotId: B.id, action: "both" },
    ]);
    expect(fareFor(w, A, B, coach.id)).toBe(Math.round(plain * HUB_FARE));
    expect(hubFare(w, C, B, undefined)).toBe(HUB_FARE);
  });

  it("keeps its riders counted in a save", () => {
    const { w, life, town } = central();
    for (let i = 0; i < 2; i++) bringStage(w, life, town, "central");
    for (let i = 0; i < 7; i++) countRider(w, town.id, w.landscape.towns[1].id);
    const back = reload(w);
    expect(back.economy.grandPlans.get("central")).toMatchObject({ stage: 2, riders: 7, prop: -1 });
  });
});
