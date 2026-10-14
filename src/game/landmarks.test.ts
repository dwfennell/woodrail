import { describe, expect, it } from "vitest";
import { townProps } from "../props/towns";
import { landmarksOf, LANDMARKS, SCHOOL_IDEA_SECONDS, townLandmarks } from "./landmarks";
import { Progress } from "./progress";
import { payDelivery, schoolIdeas } from "./rewards";
import { TownLife, type TownLifeHost } from "./town-life";
import { townStatus } from "./towns";
import { buildStarterWorld, type World } from "./world";

function life(w: World) {
  const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
  const grew: string[] = [];
  const town = new TownLife(host, { grew: (t, s) => grew.push(`${t.name} ${s.name}`), received: () => {} });
  town.reset();
  return { town, grew };
}

describe("town landmarks", () => {
  it("go up as a town reaches their level: a school for a village, a market for a town, a library for a city", () => {
    const w = buildStarterWorld();
    const { town } = life(w);
    const t = w.landscape.towns[0];
    const deliver = (bag: { planks?: number; flour?: number }) => {
      w.economy.delivered.set(t.id, bag.planks ?? 0);
      w.economy.deliveredGoods.set(t.id, { ...bag });
      town.update();
    };
    deliver({ planks: 4 });
    expect([...townLandmarks(t)]).toEqual(["school"]);
    deliver({ planks: 12 });
    expect([...townLandmarks(t)].sort()).toEqual(["market", "school"]);
    // Flour alone (no new planks) still grows it: a city, with its library.
    deliver({ planks: 26 });
    deliver({ planks: 26, flour: 6 });
    expect(townStatus({ planks: 26, flour: 6 }).level).toBe(3);
    expect(landmarksOf(w.landscape).has("library")).toBe(true);
    // Each is a building of the town, with its own model (or a stand-in from the catalogue).
    const props = townProps(w.landscape, t);
    for (const id of ["school", "market", "library"]) {
      const b = t.buildings.find((x) => x.landmark === id)!;
      const asset = props.find((p) => p.building === b.id)!.asset;
      const mark = LANDMARKS.find((l) => l.id === id)!;
      expect([...mark.models.two, ...mark.models.one], id).toContain(asset);
    }
  });

  it("a school has ideas: a blueprint offer every few minutes of play, one waiting at a time", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    const clock = { seconds: 0 };
    const random = () => 0.3;
    expect(schoolIdeas(p, w.landscape, clock, SCHOOL_IDEA_SECONDS, random)).toBeNull();
    w.landscape.towns[0].buildings[0].landmark = "school";
    expect(schoolIdeas(p, w.landscape, clock, SCHOOL_IDEA_SECONDS - 1, random)).toBeNull();
    expect(schoolIdeas(p, w.landscape, clock, 1, random)).toBe(`${w.landscape.towns[0].name} school`);
    expect(p.offers).toHaveLength(1);
    expect(schoolIdeas(p, w.landscape, clock, SCHOOL_IDEA_SECONDS * 2, random)).toBeNull();
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
