import { beforeAll, describe, expect, it } from "vitest";
import { loadFootprints } from "../props/footprints-testing";
import type { Footprint } from "../props/placement";
import { townProps } from "../props/towns";
import { BLUEPRINTS, CITY_SCHOOL_ID, SCHOOL_NEED } from "./blueprints";
import { techOf, TECHS } from "./tech";
import { atSchool, landmarksAt, LANDMARKS, placedSchools, researchSpeed, schoolGrade, schoolGradesKey, schoolHowTo, schoolLevel, townLandmarks } from "./landmarks";
import { Progress } from "./progress";
import { pick, setSpeed, studyLeft, tick } from "./research";
import { payDelivery } from "./rewards";
import { canResearch } from "./research";
import { TownLife, type TownLifeHost } from "./town-life";
import { townStatus } from "./towns";
import { buildStarterWorld, syncIndustries, type World } from "./world";

/** The game's own prop footprints (`Game.footprintOf`), so towns grow around their props as in the game. (Its props are towns' buildings.) */
let footprintOf: (asset: string) => Footprint | undefined = () => {
  throw new Error("footprints not loaded yet (see beforeAll)");
};
beforeAll(async () => {
  footprintOf = await loadFootprints(["bldg"]);
}, 60_000);

function life(w: World) {
  const host: TownLifeHost = Object.assign(w, { footprintOf: (asset: string) => footprintOf(asset), editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
  const grew: string[] = [];
  const town = new TownLife(host, { grew: (t, s) => grew.push(`${t.name} ${s.name}`), received: () => {} });
  town.reset();
  return { town, grew };
}

describe("town landmarks", () => {
  it("a market goes up as a town reaches town level; a city builds no library, and no town a school or college", () => {
    const w = buildStarterWorld();
    const { town } = life(w);
    const t = w.landscape.towns[0];
    const deliver = (bag: { planks?: number; flour?: number }) => {
      w.economy.delivered.set(t.id, bag.planks ?? 0);
      w.economy.deliveredGoods.set(t.id, { ...bag });
      town.update();
    };
    deliver({ planks: 4 });
    expect([...townLandmarks(t)]).toEqual([]);
    deliver({ planks: 12 });
    expect([...townLandmarks(t)]).toEqual(["market"]);
    deliver({ planks: 26, flour: 6 });
    expect(townStatus({ planks: 26, flour: 6 }).level).toBe(3);
    expect([...townLandmarks(t)]).toEqual(["market"]);
    expect(LANDMARKS.map((m) => m.id)).toEqual(["market"]);
    // Its market has its own model (or a stand-in from the catalogue).
    const b = t.buildings.find((x) => x.landmark === "market")!;
    const asset = townProps(w.landscape, t).find((p) => p.building === b.id)!.asset;
    expect([...LANDMARKS[0].models.two, ...LANDMARKS[0].models.one]).toContain(asset);
  });

  it("a town that grows by more than one level at once gets every landmark it passed", () => {
    const w = buildStarterWorld();
    const { town } = life(w);
    const t = w.landscape.towns[1];
    w.economy.delivered.set(t.id, 26);
    w.economy.deliveredGoods.set(t.id, { planks: 26, flour: 6 });
    town.update();
    expect([...townLandmarks(t)]).toEqual(["market"]);
  });
});

describe("a school that grows with its town", () => {
  /** The starter map with a school placed beside its first town, and a way to grow that town to a level. */
  function withSchool() {
    const w = buildStarterWorld();
    const t = w.landscape.towns[0];
    w.layout.addPiece("depot-school", { x: t.station.x + 400, z: t.station.z, heading: 0 });
    syncIndustries(w, true);
    const school = placedSchools(w)[0];
    const grow = (planks: number, flour = 0) => {
      w.economy.delivered.set(t.id, planks);
      w.economy.deliveredGoods.set(t.id, { planks, flour });
    };
    return { w, t, school, grow };
  }

  it("is a schoolhouse by a village; a college by a town once College is learned (study 2×); a library wing by a city (tier 3)", () => {
    const { w, t, school, grow } = withSchool();
    expect(school.townId).toBe(t.id);
    const learned = new Set<string>();
    grow(4);
    expect(schoolGrade(w, school, learned)).toEqual({ college: false, wing: false, university: false });
    expect(researchSpeed(w, learned)).toBe(1);
    // A town: no college till College is learned.
    grow(12);
    expect(schoolGrade(w, school, learned)).toEqual({ college: false, wing: false, university: false });
    learned.add("college");
    expect(schoolGrade(w, school, learned)).toEqual({ college: true, wing: false, university: false });
    expect(researchSpeed(w, learned)).toBe(2);
    // College learned, but beside a village: still a schoolhouse.
    grow(4);
    expect(researchSpeed(w, learned)).toBe(1);
    expect(landmarksAt(w).has(CITY_SCHOOL_ID)).toBe(false);
    // A city: the library wing, which opens tier-3 research.
    grow(26, 6);
    expect(schoolGrade(w, school, learned)).toEqual({ college: true, wing: true, university: false });
    expect(landmarksAt(w).has(CITY_SCHOOL_ID)).toBe(true);
    const p = Progress.fresh();
    for (const id of ["farming", "mills"]) p.learned.add(id);
    expect(canResearch(p, "quarries")).toBe(false);
    for (const id of landmarksAt(w)) p.landmarks.add(id);
    expect(canResearch(p, "quarries")).toBe(true);
    // Taken up: no school, nothing opened.
    w.layout.removePiece(school.pieceId);
    expect(landmarksAt(w).has(CITY_SCHOOL_ID)).toBe(false);
    expect(researchSpeed(w, learned)).toBe(1);
  });

  it("certain research is studied only at a College or a University (tech tree 3): locked till you have one, and only such a school takes its goods", () => {
    const { w, t, school, grow } = withSchool();
    const p = Progress.fresh();
    for (const id of ["farming", "mills", "quarries", "mines", "goods-engine", "tank", "foundry", "routes", "switches", "college"]) p.learned.add(id);
    p.coins = 1000;
    const sync = () => {
      p.landmarks.clear();
      for (const id of landmarksAt(w, p.learned)) p.landmarks.add(id);
    };
    // Beside a village: a schoolhouse. The Car carrier needs a College, and says what to do.
    grow(4);
    sync();
    expect(techOf("car-carrier")!.requires).toContainEqual(SCHOOL_NEED.college);
    expect(canResearch(p, "car-carrier")).toBe(false);
    expect(schoolHowTo(w, p.learned, "college")).toBe(`grow ${t.name} into a city`);
    // A town: a college (it studies twice as fast), but not yet one in a city.
    grow(12);
    sync();
    expect(canResearch(p, "car-carrier")).toBe(false);
    expect(schoolHowTo(w, new Set(), "college")).toBe("learn College");
    // A city: a College in a city. It can be researched, and the school takes its goods.
    grow(26, 6);
    sync();
    expect(schoolLevel(w, school, p.learned)).toBe("college");
    expect(canResearch(p, "car-carrier")).toBe(true);
    p.research.current = "car-carrier";
    expect(atSchool(w, school, p)).toBe(true);
    // The Car factory needs a University: a College isn't enough, and that school takes none of its goods.
    p.learned.add("car-carrier");
    p.counts.set("delivered:iron", 20);
    expect(canResearch(p, "car-factory")).toBe(false);
    expect(schoolHowTo(w, p.learned, "university")).toBe("learn University");
    p.research.current = "car-factory";
    expect(atSchool(w, school, p)).toBe(false);
    // University learned: this College in a city is a University now.
    p.learned.add("university");
    sync();
    expect(schoolLevel(w, school, p.learned)).toBe("university");
    expect(canResearch(p, "car-factory")).toBe(true);
    expect(atSchool(w, school, p)).toBe(true);
    // A town shrunk back to a village (a map edit): no longer a University or a College.
    grow(4);
    expect(atSchool(w, school, p)).toBe(false);
    // Research with no such need: any school.
    p.research.current = "harvesters";
    expect(atSchool(w, school, p)).toBe(true);
  });

  it("the early game and the core goals' research have no such need; the late chains do", () => {
    for (const b of BLUEPRINTS) if ((b.tier ?? 1) < 3) expect(b.school, b.id).toBeUndefined();
    for (const id of ["quarries", "mines", "foundry", "harbours"]) expect(techOf(id)!.school, id).toBeUndefined();
    expect(BLUEPRINTS.filter((b) => b.school === "university").map((b) => b.id).sort()).toEqual(["car-factory", "cranes3", "electric", "toolworks"]);
    // (A College in a city and a University are a city's: those don't ask for a school beside a city as well.)
    for (const b of BLUEPRINTS) if (b.school) expect(b.requires, b.id).not.toContainEqual(expect.objectContaining({ id: CITY_SCHOOL_ID }));
  });

  it("its model is drawn again only when its grade changes (the key holds through deliveries)", () => {
    const { w, grow } = withSchool();
    const learned = new Set(["college"]);
    grow(4);
    const village = schoolGradesKey(w, learned);
    grow(8);
    expect(schoolGradesKey(w, learned)).toBe(village);
    grow(12);
    const town = schoolGradesKey(w, learned);
    expect(town).not.toBe(village);
    grow(20);
    expect(schoolGradesKey(w, learned)).toBe(town);
    grow(26, 6);
    expect(schoolGradesKey(w, learned)).not.toBe(town);
  });

  it("a college studies twice as fast: half the study time left, and done in half the seconds", () => {
    const p = Progress.fresh();
    expect(pick(p, "switches")).toBe("current");
    p.research.got = { planks: 4 };
    setSpeed(p, 2);
    expect(studyLeft(p)).toBe(10);
    expect(tick(p, 9)).toBe(null);
    expect(tick(p, 1)).toBe("switches");
  });
});

describe("markets", () => {
  it("a market pays half again", () => {
    const w = buildStarterWorld();
    const t = w.landscape.towns[0];
    const p = Progress.fresh();
    const before = townStatus({ planks: 12 }); // (a town: the price; a market comes at town level)
    expect(payDelivery(p, "planks", 2, before, t)).toBe(8);
    t.buildings[0].landmark = "market";
    expect(payDelivery(p, "planks", 2, before, t)).toBe(12);
  });
});

describe("what a landmark's news says", () => {
  it("never names the board (it is the Research picker now: QA)", () => {
    for (const m of LANDMARKS) expect(m.blurb, m.id).not.toMatch(/\bboard\b/i);
    for (const t of TECHS) expect(t.blurb, t.id).not.toMatch(/\bthe board\b/i);
  });

  it("promises no free blueprints (P3: no school ideas, no blueprint offers)", () => {
    for (const m of LANDMARKS) expect(m.blurb, m.id).not.toMatch(/ideas|new blueprint|free|claim/i);
    for (const t of TECHS) expect(t.blurb, t.id).not.toMatch(/ideas come|new blueprint in|learn one free|claim your reward/i);
  });
});
