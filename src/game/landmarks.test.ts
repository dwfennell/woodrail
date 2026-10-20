import { describe, expect, it } from "vitest";
import { townProps } from "../props/towns";
import { landmarksAt, landmarksOf, LANDMARKS, townLandmarks } from "./landmarks";
import { Progress } from "./progress";
import { payDelivery } from "./rewards";
import { learnAuto, TECHS } from "./tech";
import { TownLife, type TownLifeHost } from "./town-life";
import { townStatus } from "./towns";
import { buildStarterWorld, syncIndustries, type World } from "./world";

function life(w: World) {
  const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
  const grew: string[] = [];
  const town = new TownLife(host, { grew: (t, s) => grew.push(`${t.name} ${s.name}`), received: () => {} });
  town.reset();
  return { town, grew };
}

describe("town landmarks", () => {
  it("go up as a town reaches their level: a market for a town, a library for a city (none for a village: no school)", () => {
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
    expect([...townLandmarks(t)].sort()).toEqual(["market"]);
    // Flour alone (no new planks) still grows it: a city, with its library.
    deliver({ planks: 26 });
    deliver({ planks: 26, flour: 6 });
    expect(townStatus({ planks: 26, flour: 6 }).level).toBe(3);
    expect(landmarksOf(w.landscape).has("library")).toBe(true);
    // Each is a building of the town, with its own model (or a stand-in from the catalogue).
    const props = townProps(w.landscape, t);
    for (const id of ["market", "library"]) {
      const b = t.buildings.find((x) => x.landmark === id)!;
      const asset = props.find((p) => p.building === b.id)!.asset;
      const mark = LANDMARKS.find((l) => l.id === id)!;
      expect([...mark.models.two, ...mark.models.one], id).toContain(asset);
    }
  });

  it("a town that grows by more than one level at once gets every landmark it passed", () => {
    const w = buildStarterWorld();
    const { town } = life(w);
    const t = w.landscape.towns[1];
    w.economy.delivered.set(t.id, 26);
    w.economy.deliveredGoods.set(t.id, { planks: 26, flour: 6 });
    town.update();
    expect([...townLandmarks(t)].sort()).toEqual(["library", "market"]);
  });

  it("towns don't build schools: the school blueprint comes with your school depot, placed beside a town", () => {
    const w = buildStarterWorld();
    const { town } = life(w);
    const t = w.landscape.towns[0];
    w.economy.delivered.set(t.id, 26);
    w.economy.deliveredGoods.set(t.id, { planks: 26, flour: 6 });
    town.update();
    expect(townLandmarks(t).has("school")).toBe(false);
    expect(landmarksAt(w).has("school")).toBe(false);
    const p = Progress.fresh();
    for (const id of landmarksAt(w)) p.landmarks.add(id);
    expect(learnAuto(p)).not.toContain("school");
    // Your school, the first village's present, placed (beside a town): the school blueprint (College and more need it).
    w.layout.addPiece("depot-school", { x: t.station.x + 400, z: t.station.z, heading: 0 });
    syncIndustries(w, true);
    expect(landmarksAt(w).has("school")).toBe(true);
    for (const id of landmarksAt(w)) p.landmarks.add(id);
    expect(learnAuto(p)).toContain("school");
  });

  it("a market pays half again", () => {
    const w = buildStarterWorld();
    const t = w.landscape.towns[0];
    const p = Progress.fresh();
    const before = townStatus({});
    expect(payDelivery(p, "planks", 2, before, t)).toBe(8);
    t.buildings[0].landmark = "market";
    expect(payDelivery(p, "planks", 2, before, t)).toBe(12);
  });
});

describe("what a landmark's news says", () => {
  it("names Research, not the board (the board is the Research picker now: QA)", () => {
    for (const m of LANDMARKS) expect(m.blurb, m.id).not.toMatch(/\bboard\b/i);
    for (const t of TECHS) expect(t.blurb, t.id).not.toMatch(/\bthe board\b/i);
    // (P3: a school is placed, not raised by a village, and its blurb says Research.)
    expect(TECHS.find((t) => t.id === "school")!.blurb).toMatch(/research/i);
  });

  it("promises no free blueprints (P3: no school ideas, no blueprint offers)", () => {
    for (const m of LANDMARKS) expect(m.blurb, m.id).not.toMatch(/ideas|new blueprint|free|claim/i);
    for (const t of TECHS) expect(t.blurb, t.id).not.toMatch(/ideas come|new blueprint in|learn one free|claim your reward/i);
  });
});
