import { beforeAll, describe, expect, it } from "vitest";
import { loadFootprints } from "../props/footprints-testing";
import type { Footprint } from "../props/placement";
import { townProps } from "../props/towns";
import { CITY_SCHOOL_ID } from "./blueprints";
import { TECHS } from "./tech";
import { landmarksAt, LANDMARKS, placedSchools, researchSpeed, schoolGrade, schoolGradesKey, townLandmarks } from "./landmarks";
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
    expect(schoolGrade(w, school, learned)).toEqual({ college: false, wing: false });
    expect(researchSpeed(w, learned)).toBe(1);
    // A town: no college till College is learned.
    grow(12);
    expect(schoolGrade(w, school, learned)).toEqual({ college: false, wing: false });
    learned.add("college");
    expect(schoolGrade(w, school, learned)).toEqual({ college: true, wing: false });
    expect(researchSpeed(w, learned)).toBe(2);
    // College learned, but beside a village: still a schoolhouse.
    grow(4);
    expect(researchSpeed(w, learned)).toBe(1);
    expect(landmarksAt(w).has(CITY_SCHOOL_ID)).toBe(false);
    // A city: the library wing, which opens tier-3 research.
    grow(26, 6);
    expect(schoolGrade(w, school, learned)).toEqual({ college: true, wing: true });
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
