import { describe, expect, it } from "vitest";
import { yardParts } from "../game/depot-footprint";
import { inFootprint } from "../props/placement";
import { Layout, type PieceTypeId } from "../track";
import { buildStarterWorld, INDUSTRY_ROLE } from "../game/world";
import { treePlacements } from "../render/dressing/trees";
import { gridWithPlots } from "./grid";
import { TreeClearance, treesAside, type TreeSpot } from "./trees-aside";

// QA 2026-11-04 (2): trees stood on a new harbour's yard and quay, because they stepped aside only for track.
describe("trees step aside for a depot's yard, not only its track", () => {
  const pose = { x: 200, z: 100, heading: 0.4 };
  const parts = yardParts("depot-harbour")!;
  /** Trees on a grid over the harbour's yard (its own frame, then placed). */
  const onYard = (): TreeSpot[] => {
    const out: TreeSpot[] = [];
    for (const r of parts)
      for (let i = -1; i <= 1; i++)
        for (let k = -1; k <= 1; k++) {
          const lx = r.cx + (i * r.hw) / 2;
          const lz = r.cz + (k * r.hd) / 2;
          out.push({ x: pose.x + lx * Math.cos(pose.heading) - lz * Math.sin(pose.heading), z: pose.z + lx * Math.sin(pose.heading) + lz * Math.cos(pose.heading), y: 0 });
        }
    return out;
  };
  const onAnyYard = (t: TreeSpot | null) => !!t && parts.some((r) => inFootprint(r, pose, t.x, t.z, 8));

  it("a placed harbour: none left standing on its yard or quay (and without the yards given, some would be)", () => {
    const layout = new Layout();
    layout.addPiece("depot-harbour", pose);
    const trees = onYard();
    const grid = gridWithPlots(-2, -2, 4, 4);
    expect(trees.filter((t) => onAnyYard(t)).length).toBeGreaterThan(5);
    expect(treesAside(grid, layout, trees).some(onAnyYard)).toBe(true);
    expect(treesAside(grid, layout, trees, undefined, yardParts).some(onAnyYard)).toBe(false);
  });

  it("a harbour held over them: they step aside for its yard too, and back when it's moved on", () => {
    const layout = new Layout();
    const trees = onYard();
    const c = new TreeClearance(gridWithPlots(-2, -2, 4, 4), trees, yardParts);
    c.setLayout(layout);
    expect(c.spots({ type: "depot-harbour", flipped: false, pose, y: 0 }).some(onAnyYard)).toBe(false);
    expect(c.spots()).toEqual(trees);
  });
});

// QA 2026-11-04 and #27 (trees through a mill's yard): every kind of depot, and the starter map's own.
describe("no tree stands on any depot's yard", () => {
  it("every industry kind dropped on a wood of trees: none left on its yard", () => {
    for (const type of Object.keys(INDUSTRY_ROLE) as PieceTypeId[]) {
      const parts = yardParts(type);
      if (!parts) continue;
      const pose = { x: 300, z: 200, heading: -0.7 };
      const trees: TreeSpot[] = [];
      for (let x = -600; x <= 1200; x += 40) for (let z = -600; z <= 1000; z += 40) trees.push({ x, z, y: 0 });
      const layout = new Layout();
      layout.addPiece(type, pose);
      const out = treesAside(gridWithPlots(-3, -3, 6, 6), layout, trees, undefined, yardParts);
      const on = out.filter((t) => t && parts.some((r) => inFootprint(r, pose, t.x, t.z)));
      expect(on.length, type).toBe(0);
    }
  });

  it("the starter map's trees, with its depots: none on a yard", () => {
    const w = buildStarterWorld();
    const c = new TreeClearance(w.landscape.grid, treePlacements(w.landscape), yardParts);
    c.setLayout(w.layout);
    const spots = c.spots();
    let depots = 0;
    for (const d of w.economy.allDepots()) {
      const piece = w.layout.getPiece(d.pieceId);
      const parts = piece && yardParts(piece.type);
      if (!piece || !parts) continue;
      depots++;
      const on = spots.filter((t) => t && parts.some((r) => inFootprint(r, piece.pose, t.x, t.z)));
      expect(on.length, `${d.role} at ${piece.pose.x},${piece.pose.z}`).toBe(0);
    }
    expect(depots).toBeGreaterThan(0);
  });
});
