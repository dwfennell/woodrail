import { beforeAll, describe, expect, it } from "vitest";
import { loadFootprints } from "../props/footprints-testing";
import type { Footprint } from "../props/placement";
import { fitScale, PLACE_MIN_FIT } from "../props/towns";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { BLUEPRINTS } from "./blueprints";
import { landmarksOf, townLandmarks } from "./landmarks";
import { buyTreat, placeRow, startPlace, stopPlace } from "./place-row";
import { inSeason, MAX_SMILES, PLACES, placeOf, planDone, townPlaces, townSmiles, treatPrice, TREATS, visitorFactor } from "./places";
import { fareFor, visitorsFor } from "./passengers";
import { Progress } from "./progress";
import { built } from "./tech";
import { growthOf, statusOf, TownLife, type TownLifeHost } from "./town-life";
import { townLevel, townStatus, wantsWith } from "./towns";
import { buildStarterWorld, type World } from "./world";
import { deliverByTrain } from "./workshop-testing";

/**
 * Civic and leisure places (spec 2026-11-04-civic-leisure-design.md): built from a town's card, their goods brought by
 * train to its station, then they stand in the town and do their thing (smiles cut what it needs to grow; visitors
 * pay more). By the player's path: Build on the card (`startPlace`), goods by train (`deliverByTrain` to the town's
 * station), the place going up as TownLife sees the last of them.
 */

let footprintOf: (asset: string) => Footprint | undefined = () => undefined;
beforeAll(async () => {
  footprintOf = await loadFootprints(["bldg", "scene"]);
}, 60_000);

/** A starter world with Game mode's towns living (no coins paid: that's main's `received`), and what reached them. */
function game() {
  const w = buildStarterWorld();
  const received: { town: number; kind: string; n: number }[] = [];
  const built: { town: number; place: string }[] = [];
  const host: TownLifeHost = Object.assign(w, { footprintOf: (a: string) => footprintOf(a), editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
  const life = new TownLife(host, { grew: () => {}, received: (t, kind, n) => received.push({ town: t.id, kind, n }), placeBuilt: (t, place) => built.push({ town: t.id, place: place.id }) });
  life.reset();
  const p = Progress.fresh();
  return { w, life, p, received, built };
}

/** A town grown to `level` (deliveries written as trains would bring them: a setup shortcut, as e2e:town-shape). */
function growTo(w: World, life: TownLife, townId: number, level: number): void {
  const bag: Record<string, number> = {};
  for (let k = 0; k < level; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) bag[g] = (bag[g] ?? 0) + n!;
  w.economy.delivered.set(townId, bag.planks ?? 0);
  w.economy.deliveredGoods.set(townId, { ...bag });
  life.update();
}

const stationOf = (w: World, townId: number) => w.stations.get(townId)!;

describe("the places table", () => {
  it("every place's blueprint is built and its row in the catalogue; treats have none", () => {
    for (const p of PLACES) {
      if (p.kind === "treat") {
        expect(p.tech, p.id).toBeUndefined();
        continue;
      }
      const row = BLUEPRINTS.find((b) => b.id === p.tech);
      expect(row, p.id).toBeDefined();
      expect(built(row!), p.id).toBe(true);
      expect(["civic", "leisure"]).toContain(row!.branch);
    }
  });

  it("every place has a model that fits a lot it can be given (2×2, two squares or one)", () => {
    for (const p of PLACES) {
      const fits = [...(p.models.four ?? []).map((a) => fitScale(a, 4, PLACE_MIN_FIT)), ...p.models.two.map((a) => fitScale(a, 2, PLACE_MIN_FIT)), ...p.models.one.map((a) => fitScale(a, 1, PLACE_MIN_FIT))];
      expect(fits.some((k) => k !== null), p.id).toBe(true);
    }
  });

  it("places are coins and goods (trains bring them); treats are coins only, dearer the more on the map", () => {
    for (const p of PLACES.filter((x) => x.kind !== "treat")) {
      expect(p.coins, p.id).toBeGreaterThan(0);
      expect(Object.keys(p.goods).length, p.id).toBeGreaterThan(0);
      // Only goods a player has by then: planks, stone, iron (no flowers or paint yet).
      for (const k of Object.keys(p.goods)) expect(["planks", "stone", "iron", "bricks"], `${p.id} ${k}`).toContain(k);
    }
    expect([0, 1, 2, 9].map(treatPrice)).toEqual([100, 150, 200, 550]);
    expect(TREATS.map((t) => t.level)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("smiles", () => {
  it("each 😊 cuts a twentieth of every good a level wants, rounded up, never below one, up to four", () => {
    expect(wantsWith(3, 0)).toEqual(townLevel(3).wants);
    expect(wantsWith(3, 2)).toEqual({ planks: 20, flour: 11, stone: 9 });
    expect(wantsWith(3, 4)).toEqual({ planks: 18, flour: 10, stone: 8 });
    // (No more past four.)
    expect(wantsWith(3, 9)).toEqual(wantsWith(3, 4));
    expect(wantsWith(0, 4)).toEqual({ planks: 4 });
  });

  it("a town a few goods short grows when a smile cuts what it needs", () => {
    // A town (level 2) with 13 of a city's 14 planks... its next level, the city, wants 22 planks, 12 flour, 10 stone.
    const before = { planks: 4 + 8 + 14 + 20, flour: 6 + 11, stone: 9 };
    expect(townStatus(before).level).toBe(3);
    expect(townStatus(before, 2).level).toBe(4);
  });
});

describe("visitors", () => {
  it("seasons: summer Jun–Aug, winter Nov–Feb, spring and autumn the rest", () => {
    expect([5, 6, 7].every((m) => inSeason("summer", m))).toBe(true);
    expect(inSeason("summer", 8)).toBe(false);
    expect([10, 11, 0, 1].every((m) => inSeason("winter", m))).toBe(true);
    expect([2, 3, 4, 8, 9].every((m) => inSeason("spring-autumn", m))).toBe(true);
  });

  it("riders getting off at a town with a leisure place pay more (its best place; in its season, its peak)", () => {
    const { w } = game();
    const [a, b] = w.landscape.towns;
    const from = w.economy.depotAtPiece(stationOf(w, a.id))!;
    const to = w.economy.depotAtPiece(stationOf(w, b.id))!;
    const plain = fareFor(w, from, to, -1);
    expect(visitorFactor(b)).toBe(1);
    // A cinema stands in the second town (a Building with its id, as `addPlace` makes it).
    b.buildings[0].landmark = "cinema";
    expect(visitorFactor(b, 3)).toBe(1.5);
    expect(visitorFactor(b, 11)).toBe(2);
    expect(fareFor(w, from, to, -1, 11)).toBe(Math.round(plain * 2));
    // Only the best counts.
    b.buildings[1].landmark = "museum";
    expect(visitorFactor(b, 3)).toBe(1.5);
    expect(visitorFactor(b, 11)).toBe(2);
  });

  it("a ride within one town is no visitor's (a metro ride across a city pays its plain fare)", () => {
    const { w } = game();
    const [a, b] = w.landscape.towns;
    const from = w.economy.depotAtPiece(stationOf(w, a.id))!;
    const to = w.economy.depotAtPiece(stationOf(w, b.id))!;
    b.buildings[0].landmark = "cinema";
    // (A stop of the same town, as a metro stop is: the first town's station counted as the second town's.)
    const within = { ...from, townId: b.id };
    expect(visitorsFor(w, from, to, 11)).toBe(2);
    expect(visitorsFor(w, within, to, 11)).toBe(1);
    expect(fareFor(w, within, to, -1, 11)).toBe(fareFor(w, within, to, -1, 3));
  });
});

describe("building a place: the player's path", () => {
  it("Town hall: Build pays its coins, trains bring its planks to the station, and it goes up; not paid for, not growth", () => {
    const { w, life, p, received, built } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, 3);
    const level = statusOf(w, town.id).level;
    expect(level).toBe(3);
    // Not learned: no tile to build it.
    expect(placeRow(w, p, town, level).tiles.find((t) => t.id === "town-hall")?.state).not.toBe("build");
    p.learned.add("town-hall"); // (Setup: research isn't the thing tested.)
    p.coins = 100;
    const row = placeRow(w, p, town, level);
    expect(row.needsHall).toBe(true);
    expect(row.tiles.map((t) => t.id)).toEqual(["town-hall"]);
    expect(row.tiles[0].state).toBe("build");
    expect(startPlace(w, life, p, town, level, "town-hall")).toBe("started");
    expect(p.coins).toBe(40);
    expect(w.economy.placePlans.get(town.id)).toEqual({ id: "town-hall", got: {} });
    const grown = { ...growthOf(w, town.id) };
    received.length = 0;
    // A train brings the town hall's planks to the station.
    const left = deliverByTrain(w, stationOf(w, town.id), "planks", placeOf("town-hall")!.goods.planks!);
    expect(left).toBe(0);
    life.update();
    expect(townPlaces(town).has("town-hall")).toBe(true);
    expect(built).toEqual([{ town: town.id, place: "town-hall" }]);
    expect(w.economy.placePlans.has(town.id)).toBe(false);
    // Its goods went into it: not counted toward growth, nor paid for (no `received`).
    expect(growthOf(w, town.id)).toEqual(grown);
    expect(received.filter((r) => r.kind === "planks")).toEqual([]);
    // It's a place, not a landmark (a blueprint needing one never counts it).
    expect(townLandmarks(town).has("town-hall")).toBe(false);
    expect(landmarksOf(w.landscape).has("town-hall")).toBe(false);
    // Now the card shows the rest learned.
    expect(placeRow(w, p, town, level).needsHall).toBe(false);
  });

  it("a park: +1 😊, so the town needs fewer goods, and one a few goods short grows as it goes up", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    // A city, its next level (City ★) almost in: 2 planks short of 33.
    const city: Record<string, number> = {};
    for (let k = 0; k < 4; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) city[g] = (city[g] ?? 0) + n!;
    const star = townLevel(4).wants;
    const bag = { ...city };
    for (const [g, n] of Object.entries(star)) bag[g] = (bag[g] ?? 0) + n!;
    bag.planks -= 2;
    w.economy.delivered.set(town.id, bag.planks);
    w.economy.deliveredGoods.set(town.id, bag);
    life.update();
    expect(statusOf(w, town.id).level).toBe(4);
    // A town hall stands already (setup), and Park is learned.
    for (const id of ["town-hall", "park"]) p.learned.add(id);
    expect(life.addPlace(town, placeOf("town-hall")!)).not.toBeNull();
    p.coins = 500;
    expect(startPlace(w, life, p, town, 4, "park")).toBe("started");
    expect(deliverByTrain(w, stationOf(w, town.id), "planks", 8)).toBe(0);
    life.update();
    expect(townSmiles(town)).toBe(1);
    // City ★'s wants less 5%: the 2 planks short are covered now, so it grows.
    expect(statusOf(w, town.id).level).toBe(5);
  });

  it("smiles stop at four", () => {
    const { w, life } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, 3);
    for (const id of ["park", "fire-station", "police", "hospital", "clock-tower"]) expect(life.addPlace(town, placeOf(id)!), id).not.toBeNull();
    expect(townSmiles(town)).toBe(MAX_SMILES);
  });

  it("refused when it can't be built: not learned, too small, short of coins, research waiting for coins, another under way", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, 3);
    p.learned.add("town-hall");
    p.coins = 10;
    expect(startPlace(w, life, p, town, 3, "town-hall")).toBe("not-now");
    expect(placeRow(w, p, town, 3).tiles[0].state).toBe("short");
    p.coins = 1000;
    // Research waits for coins: it comes first.
    p.research.next = "boilers";
    expect(placeRow(w, p, town, 3).tiles[0].state).toBe(p.coins >= 150 ? "build" : "saving");
    p.coins = 100;
    expect(placeRow(w, p, town, 3).tiles[0].state).toBe("saving");
    p.research.next = null;
    expect(startPlace(w, life, p, town, 3, "town-hall")).toBe("started");
    // A second under way: busy.
    life.addPlace(town, placeOf("town-hall")!);
    w.economy.placePlans.set(town.id, { id: "park", got: {} });
    p.learned.add("fire-station");
    p.coins = 1000;
    expect(placeRow(w, p, town, 3).tiles.find((t) => t.id === "fire-station")?.state).toBe("busy");
  });

  it("Stop gives the coins back and the town takes nothing more for it", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, 3);
    p.learned.add("town-hall");
    p.coins = 60;
    startPlace(w, life, p, town, 3, "town-hall");
    expect(p.coins).toBe(0);
    expect(stopPlace(w, p, town)?.id).toBe("town-hall");
    expect(p.coins).toBe(60);
    expect(w.economy.placePlans.has(town.id)).toBe(false);
  });

  it("a place with its goods in but no room waits, and goes up when there is", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, 3);
    w.economy.placePlans.set(town.id, { id: "park", got: { planks: 8 } });
    expect(planDone(w.economy.placePlans.get(town.id)!)).toBe(true);
    const lotFor = life.lotFor.bind(life);
    life.lotFor = () => null;
    life.retryPlaces();
    life.update();
    expect(townPlaces(town).has("park")).toBe(false);
    expect(placeRow(w, p, town, 3).plan?.stuck).toBe(true);
    life.lotFor = lotFor;
    life.retryPlaces();
    life.update();
    expect(townPlaces(town).has("park")).toBe(true);
  });

  it("one per map: a bank in one town, and the others' tiles say so", () => {
    const { w, life, p } = game();
    const [a, b] = w.landscape.towns;
    for (const t of [a, b]) {
      growTo(w, life, t.id, 3);
      life.addPlace(t, placeOf("town-hall")!);
    }
    p.learned.add("bank");
    p.coins = 1000;
    expect(life.addPlace(a, placeOf("bank")!)).not.toBeNull();
    expect(placeRow(w, p, b, 3).tiles.find((t) => t.id === "bank")?.state).toBe("elsewhere");
  });

  it("saved and loaded: the place under way and its goods, and the places standing", () => {
    const { w, life } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, 3);
    life.addPlace(town, placeOf("town-hall")!);
    w.economy.placePlans.set(town.id, { id: "park", got: { planks: 3 } });
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.economy.placePlans.get(town.id)).toEqual({ id: "park", got: { planks: 3 } });
    expect(townPlaces(back.value.landscape.towns[0]).has("town-hall")).toBe(true);
  });
});

describe("treats", () => {
  it("on sale once any town is a City; bought outright, then the next costs more; none taken without room", () => {
    const { w, life, p } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, 2);
    expect(placeRow(w, p, town, 2).treats).toBeNull();
    p.bestLevel = 3;
    p.coins = 1000;
    const row = placeRow(w, p, town, 2);
    expect(row.treats?.map((t) => [t.id, t.state])).toEqual([
      ["playground", "build"],
      ["fountain", "build"],
      ["flower-clock", "level"],
      ["statue", "level"],
      ["street-party", "level"],
    ]);
    expect(buyTreat(w, life, p, town, 2, "fountain")).toBe("bought");
    expect(p.coins).toBe(900);
    expect(townPlaces(town).has("fountain")).toBe(true);
    expect(placeRow(w, p, town, 2).treatPrice).toBe(150);
    // A treat is looks only: no smile.
    expect(townSmiles(town)).toBe(0);
    const lotFor = life.lotFor.bind(life);
    life.lotFor = () => null;
    expect(buyTreat(w, life, p, town, 2, "playground")).toBe("no-room");
    expect(p.coins).toBe(900);
    life.lotFor = lotFor;
  });
});

describe("look-alikes open free", () => {
  it("learning Fire station: a plain building dressed as one becomes the place, +1 😊", () => {
    const { w, life } = game();
    const town = w.landscape.towns[0];
    growTo(w, life, town.id, 3);
    // A plain building wearing the fire station's model (as a city's growth builds them).
    const b = town.buildings.find((x) => !x.landmark)!;
    const prop = [...w.props.all()].find((q) => q.building === b.id)!;
    w.props.remove(prop.id);
    w.props.add("bldg-fire-station", { x: prop.x, z: prop.z, heading: prop.heading, y: prop.y }, undefined, { building: b.id, town: town.id });
    expect(life.openFree(placeOf("fire-station")!).map((t) => t.id)).toEqual([town.id]);
    expect(b.landmark).toBe("fire-station");
    expect(townSmiles(town)).toBe(1);
    // Once: nothing more opens.
    expect(life.openFree(placeOf("fire-station")!)).toEqual([]);
  });
});
