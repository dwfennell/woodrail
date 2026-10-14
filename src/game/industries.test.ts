import { describe, expect, it } from "vitest";
import { FEAT_FIELD, FEAT_NONE, FEAT_TREE, SURF_GRASS } from "../landscape";
import { rateFor, resourceAt, siteWhy, updateRates } from "./industries";
import { buildStarterWorld, syncIndustries } from "./world";

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

  it("a farm yard needs farm fields", () => {
    const { w, pose, near } = openPatch();
    const land = w.landscape;
    expect(siteWhy(land, "depot-farm", pose)).toBe("Needs farm fields nearby: 0 of 4");
    for (const i of near(150).slice(0, 4)) land.grid.feature[i] = FEAT_FIELD;
    expect(siteWhy(land, "depot-farm", pose)).toBeNull();
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
