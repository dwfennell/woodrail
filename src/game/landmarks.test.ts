import { describe, expect, it } from "vitest";
import { townProps } from "../props/towns";
import { landmarksOf, LANDMARKS, SCHOOL_IDEA_SECONDS, townLandmarks } from "./landmarks";
import { Progress } from "./progress";
import { payDelivery, SCHOOL_BOARD_CAP, schoolIdeas } from "./rewards";
import { ready, TECHS } from "./tech";
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

  it("a town that grows by more than one level at once gets every landmark it passed", () => {
    const w = buildStarterWorld();
    const { town } = life(w);
    const t = w.landscape.towns[1];
    w.economy.delivered.set(t.id, 26);
    w.economy.deliveredGoods.set(t.id, { planks: 26, flour: 6 });
    town.update();
    expect([...townLandmarks(t)].sort()).toEqual(["library", "market", "school"]);
  });

  it("a school has ideas: now and then a blueprint goes on the board, to learn at its price, while its town is supplied", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    // (Farming and mills off the board: three ready ones waiting would stop the school thinking.)
    for (const id of ["farming", "mills"]) p.board.delete(id);
    const clock = { seconds: 0 };
    const random = () => 0.3;
    expect(schoolIdeas(p, w.landscape, clock, SCHOOL_IDEA_SECONDS, random)).toBeNull();
    const town = w.landscape.towns[0];
    town.buildings[0].landmark = "school";
    // Not supplied: no thinking (the clock doesn't run).
    expect(schoolIdeas(p, w.landscape, clock, SCHOOL_IDEA_SECONDS * 2, random, () => false)).toBeNull();
    expect(clock.seconds).toBe(0);
    expect(schoolIdeas(p, w.landscape, clock, SCHOOL_IDEA_SECONDS - 1, random)).toBeNull();
    const idea = schoolIdeas(p, w.landscape, clock, 1, random)!;
    expect(idea.from).toBe(`${town.name} school`);
    // On the board, not learned, and no offer to choose from.
    expect(p.board.has(idea.id)).toBe(true);
    expect(p.learned.has(idea.id)).toBe(false);
    expect(p.offers).toHaveLength(0);
  });

  it("an idea with nothing new to put on the board keeps until there is", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    w.landscape.towns[0].buildings[0].landmark = "school";
    const clock = { seconds: 0 };
    // Everything learnable is already learned.
    for (const t of TECHS) p.learned.add(t.id);
    expect(schoolIdeas(p, w.landscape, clock, SCHOOL_IDEA_SECONDS, () => 0.3)).toBeNull();
    expect(clock.seconds).toBeGreaterThanOrEqual(SCHOOL_IDEA_SECONDS);
    // One comes back within reach: the waiting idea puts it on the board at once.
    const back = TECHS.find((t) => t.learn === "board" && t.needs.length === 0 && t.requires.length === 0)!;
    p.learned.delete(back.id);
    p.board.delete(back.id);
    expect(schoolIdeas(p, w.landscape, clock, 1, () => 0.3)?.id).toBe(back.id);
    expect(clock.seconds).toBe(0);
  });

  it("no school ideas while enough blueprints already wait on the board", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    w.landscape.towns[0].buildings[0].landmark = "school";
    const clock = { seconds: 0 };
    let n = 0;
    for (let k = 0; k < 20; k++) if (schoolIdeas(p, w.landscape, clock, SCHOOL_IDEA_SECONDS, () => 0.3)) n++;
    const waiting = [...p.board].filter((id) => !p.learned.has(id) && ready(p, id)).length;
    expect(waiting).toBeLessThanOrEqual(SCHOOL_BOARD_CAP);
    expect(n).toBeLessThanOrEqual(SCHOOL_BOARD_CAP);
  });

  it("over half an hour, a school is a modest help (the numbers in the commit)", () => {
    // A player with one school, its town always supplied, learning everything the school puts on the board at once
    // (the best case for the school). Before: an idea every 240 s learned one of two blueprints free. Now: one every
    // 480 s puts one on the board, to pay for.
    const run = (college: boolean) => {
      const w = buildStarterWorld();
      const p = Progress.fresh();
      // (The board a new game had when these numbers were taken: switches and bridges.)
      for (const id of ["farming", "mills"]) p.board.delete(id);
      w.landscape.towns[0].buildings[0].landmark = "school";
      const clock = { seconds: 0 };
      let revealed = 0;
      for (let t = 0; t < 30 * 60; t++) {
        const idea = schoolIdeas(p, w.landscape, clock, college ? 2 : 1, () => 0.3);
        if (!idea) continue;
        revealed++;
        p.learned.add(idea.id);
        p.board.delete(idea.id);
      }
      return revealed;
    };
    const before = (college: boolean) => Math.floor((30 * 60 * (college ? 2 : 1)) / 240);
    expect([before(false), before(true)]).toEqual([7, 15]);
    expect([run(false), run(true)]).toEqual([3, 7]);
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
    expect(LANDMARKS.find((m) => m.id === "school")!.blurb).toMatch(/Research/);
  });
});
