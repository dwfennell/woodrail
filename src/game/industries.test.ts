import { describe, expect, it } from "vitest";
import { FEAT_FIELD, FEAT_NONE, FEAT_TREE, SURF_GRASS, SURF_TOWN } from "../landscape";
import type { PieceTypeId } from "../track";
import { amountText, rateFor, resourceAt, schoolOf, SITE_RULES, siteWhy, updateRates } from "./industries";
import { buildStarterWorld, depotName, INDUSTRY_ROLE, schoolTown, syncIndustries } from "./world";

/** An open patch of grass on the starter map, cleared of features, and a pose for a depot whose yard sits on it. */
function openPatch() {
  const w = buildStarterWorld();
  const g = w.landscape.grid;
  // The yard's middle is (108, 72) from the piece's origin at heading 0: put that on a grass square away from towns.
  // A square's centre (squares are 72 mm, centred on 36 + 72k): every interior one has the same squares around it.
  let x = 36;
  let z = 36;
  const near = (d: number) => {
    const out: number[] = [];
    g.forEachCell((i) => {
      if (Math.hypot(g.centreX(g.colOf(i)) - x, g.centreZ(g.rowOf(i)) - z) <= d) out.push(i);
    });
    return out;
  };
  // Grass well inside the map (every square within 300 mm of it is on the map) and away from the towns.
  const full = near(300).length;
  let found = false;
  g.forEachCell((i) => {
    if (found || g.surface[i] !== SURF_GRASS) return;
    const cx = g.centreX(g.colOf(i));
    const cz = g.centreZ(g.rowOf(i));
    if (w.landscape.towns.some((t) => Math.hypot(t.centre.x - cx, t.centre.z - cz) < 450)) return;
    [x, z] = [cx, cz];
    if (near(300).length === full) found = true;
  });
  for (const i of near(300)) g.feature[i] = FEAT_NONE;
  if (!found) throw new Error("no open patch");
  return { w, pose: { x: x - 108, z: z - 72, heading: 0 }, near };
}

describe("industries near their resource", () => {
  it("a harvester needs trees within reach, and works faster with more (up to half again)", () => {
    const { w, pose, near } = openPatch();
    const land = w.landscape;
    expect(siteWhy(land, "depot-forest", pose)).toBe("Needs trees nearby: 0 of 5");
    const cells = near(250);
    for (const i of cells.slice(0, 5)) land.grid.feature[i] = FEAT_TREE;
    expect(siteWhy(land, "depot-forest", pose)).toBeNull();
    expect(resourceAt(land, "forest", pose)?.count).toBe(5);
    expect(rateFor(5, 10)).toBe(0.5);
    expect(rateFor(30, 10)).toBe(1.5);
    // Workshops, sawmills and mills go anywhere.
    for (const t of ["depot-workshop", "depot-sawmill", "depot-mill"] as const) expect(siteWhy(land, t, pose), t).toBeNull();
  });

  it("a harvester with 8 of the 10 trees it wants may go (QA): it works at 0.8, and short of 5 it's refused, saying so", () => {
    const { w, pose, near } = openPatch();
    const land = w.landscape;
    const cells = near(250);
    for (const i of cells.slice(0, 8)) land.grid.feature[i] = FEAT_TREE;
    expect(resourceAt(land, "forest", pose)).toMatchObject({ count: 8, need: 10 });
    expect(siteWhy(land, "depot-forest", pose)).toBeNull();
    expect(rateFor(8, 10)).toBe(0.8);
    for (const i of cells.slice(4, 8)) land.grid.feature[i] = FEAT_NONE;
    expect(siteWhy(land, "depot-forest", pose)).toBe("Needs trees nearby: 4 of 5");
  });

  it("every industry bound to a resource says what it lacks (never refused without a reason)", () => {
    const { w, pose, near } = openPatch();
    const land = w.landscape;
    for (const i of near(300)) land.grid.height[i] = 0;
    const said: Record<string, string | null> = {};
    for (const [type, role] of Object.entries(INDUSTRY_ROLE)) if (SITE_RULES[role!]) said[type] = siteWhy(land, type as PieceTypeId, pose);
    expect(said).toEqual({
      "depot-forest": "Needs trees nearby: 0 of 5",
      "depot-farm": "Needs a farm field nearby",
      "depot-quarry": "Needs hillside nearby: 0 of 6",
      "depot-mine": "Needs hillside nearby: 0 of 6",
      "depot-harbour": "Needs water nearby: 0 of 4",
      "depot-school": "Needs to be beside a town",
    });
  });

  it("a school goes beside a town (a lot within 300 mm of its yard), takes its name, and one a town", () => {
    const w = buildStarterWorld();
    const land = w.landscape;
    const town = land.towns[0];
    const g = land.grid;
    // A square of the town's, and a pose whose yard's middle is 200 mm off it (along +x, clear of the town).
    const lot = town.cells.find((i) => g.surface[i] === SURF_TOWN)!;
    const [lx, lz] = [g.centreX(g.colOf(lot)), g.centreZ(g.rowOf(lot))];
    const beside = { x: lx + 200 - 108, z: lz - 72, heading: 0 };
    expect(schoolTown(land, beside)?.town).toBe(town);
    expect(siteWhy(land, "depot-school", beside)).toBeNull();
    // Far from every town: refused, saying why.
    const { pose } = openPatch();
    expect(siteWhy(land, "depot-school", pose)).toBe("Needs to be beside a town");
    // Placed, it's that town's school, by name.
    const id = w.layout.addPiece("depot-school", beside);
    syncIndustries(w, true);
    const d = w.economy.depotAtPiece(id)!;
    expect([d.role, d.townId, depotName(w, d)]).toEqual(["school", town.id, `${town.name} school`]);
    // A second at the same town is refused; the one being moved doesn't count against itself.
    const has = (t: number) => schoolOf(w, t);
    expect(siteWhy(land, "depot-school", beside, has)).toBe(`${town.name} has a school`);
    expect(siteWhy(land, "depot-school", beside, (t) => schoolOf(w, t, (p) => p === id))).toBeNull();
    // A school makes nothing: its town doesn't set a speed.
    updateRates(w);
    expect(d.rate).toBe(1);
  });

  it("a farm yard needs farm fields", () => {
    const { w, pose, near } = openPatch();
    const land = w.landscape;
    expect(siteWhy(land, "depot-farm", pose)).toBe("Needs a farm field nearby");
    // (Part of a field, 2 squares of its 4, in reach: said in fields, not "2 of 4", which a player beside two whole
    // fields read as fields. QA: "it needs four but I only have those two".)
    for (const i of near(150).slice(0, 2)) land.grid.feature[i] = FEAT_FIELD;
    expect(siteWhy(land, "depot-farm", pose)).toBe("Move it closer to a farm field");
    for (const i of near(150).slice(0, 4)) land.grid.feature[i] = FEAT_FIELD;
    expect(siteWhy(land, "depot-farm", pose)).toBeNull();
  });

  it("a farm's fields are counted in whole fields (2 × 2 paddocks) in its words, to the half", () => {
    const farm = SITE_RULES.farm!;
    expect([0, 1, 2, 3, 4, 6, 8, 12].map((n) => amountText(farm, n))).toEqual(["0", "0", "½", "½", "1", "1½", "2", "3"]);
    // (Other resources stay in squares.)
    expect(amountText(SITE_RULES.forest!, 7)).toBe("7");
  });

  it("a quarry needs hillside: raised squares nearby", () => {
    const { w, pose, near } = openPatch();
    const land = w.landscape;
    for (const i of near(300)) land.grid.height[i] = 0;
    expect(siteWhy(land, "depot-quarry", pose)).toBe("Needs hillside nearby: 0 of 6");
    for (const i of near(250).slice(0, 6)) land.grid.height[i] = 1;
    expect(siteWhy(land, "depot-quarry", pose)).toBeNull();
  });

  it("placed industries get their rate from what's around them; the map's own depots keep theirs", () => {
    const { w, pose, near } = openPatch();
    for (const i of near(200)) w.landscape.grid.feature[i] = FEAT_TREE;
    const id = w.layout.addPiece("depot-forest", pose);
    syncIndustries(w);
    expect(updateRates(w)).toBe(true);
    expect(w.economy.depotAtPiece(id)!.rate).toBe(1.5);
    for (const d of w.landscape.depots) expect(w.economy.depotAtPiece(w.depots.get(d.id)!)!.rate).toBe(1);
    expect(updateRates(w)).toBe(false);
  });
});
