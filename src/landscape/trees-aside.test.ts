import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { FEAT_BUILDING, FEAT_NONE, FEAT_TREE, gridWithPlots, SURF_GRASS, SURF_RIVER, type LandscapeGrid } from "./grid";
import { hillsOf } from "./hill-shape";
import { addTrackPoints, BUCKET, bucketKey, TREE_CLEARANCE, TreeClearance, trackPoints, treesAside, type HeldPiece, type TreeSpot } from "./trees-aside";

const P = (x: number, z: number, heading = 0) => ({ x, z, heading });
/** Distance (plan) from a point to the line z = 0 between x = 0 and x = 216: a straight laid along x. */
const offStraight = (t: { x: number; z: number }) => (t.x < 0 ? Math.hypot(t.x, t.z) : t.x > 216 ? Math.hypot(t.x - 216, t.z) : Math.abs(t.z));

describe("treesAside", () => {
  it("leaves trees where they grew while no track comes near", () => {
    const layout = new Layout();
    layout.addPiece("straight-216", P(0, 0));
    const trees = [{ x: 100, z: 200, y: 0 }];
    expect(treesAside(gridWithPlots(-1, -1, 2, 2), layout, trees)).toEqual(trees);
  });

  it("steps a tree out from under track, away from it and clear of it", () => {
    const layout = new Layout();
    layout.addPiece("straight-216", P(0, 0));
    const [moved] = treesAside(gridWithPlots(-1, -1, 2, 2), layout, [{ x: 100, z: 8, y: 0 }]);
    expect(moved).not.toBeNull();
    expect(offStraight(moved!)).toBeGreaterThanOrEqual(TREE_CLEARANCE);
    // Out the side it was nearer, not across the track.
    expect(moved!.z).toBeGreaterThan(0);
    expect(Math.hypot(moved!.x - 100, moved!.z - 8)).toBeLessThan(100);
  });

  it("keeps trees that step aside apart from each other", () => {
    const layout = new Layout();
    layout.addPiece("straight-216", P(0, 0));
    const out = treesAside(gridWithPlots(-1, -1, 2, 2), layout, [{ x: 100, z: 5, y: 0 }, { x: 104, z: 6, y: 0 }]);
    expect(out[0]).not.toBeNull();
    expect(out[1]).not.toBeNull();
    expect(Math.hypot(out[0]!.x - out[1]!.x, out[0]!.z - out[1]!.z)).toBeGreaterThanOrEqual(34);
  });

  it("won't step into a river or a building, and with nowhere to go the tree is taken away", () => {
    const grid = gridWithPlots(-1, -1, 2, 2);
    // Everything around the track is river or buildings: no grass to stand on.
    for (let i = 0; i < grid.cellCount; i++) {
      grid.surface[i] = SURF_RIVER;
      grid.feature[i] = FEAT_BUILDING;
    }
    const layout = new Layout();
    layout.addPiece("straight-216", P(0, 0));
    expect(treesAside(grid, layout, [{ x: 100, z: 0, y: 0 }])).toEqual([null]);
  });

  it("brings trees back when the track is taken up", () => {
    const layout = new Layout();
    const id = layout.addPiece("straight-216", P(0, 0));
    const trees = [{ x: 100, z: 0, y: 0 }];
    expect(treesAside(gridWithPlots(-1, -1, 2, 2), layout, trees)[0]).not.toEqual(trees[0]);
    layout.removePiece(id);
    expect(treesAside(gridWithPlots(-1, -1, 2, 2), layout, trees)).toEqual(trees);
  });

  it("steps trees aside for a piece held over them, and back when it's moved on", () => {
    const layout = new Layout();
    const trees = [{ x: 100, z: 8, y: 0 }];
    const c = new TreeClearance(gridWithPlots(-1, -1, 2, 2), trees);
    c.setLayout(layout);
    const [aside] = c.spots({ type: "straight-216", flipped: false, pose: P(0, 0), y: 0 });
    expect(aside).not.toBeNull();
    expect(offStraight(aside!)).toBeGreaterThanOrEqual(TREE_CLEARANCE);
    expect(c.spots({ type: "straight-216", flipped: false, pose: P(0, 600), y: 0 })).toEqual(trees);
    expect(c.spots()).toEqual(trees);
  });
});

/** `TreeClearance.spots` worked out the plain way, every tree afresh (as it was before it kept the trees between calls). */
function spotsAfresh(grid: LandscapeGrid, layout: Layout, trees: readonly TreeSpot[], held?: HeldPiece): (TreeSpot | null)[] {
  const track = trackPoints(layout);
  const extra = new Map<number, number[]>();
  if (held) addTrackPoints(extra, held.type, held.flipped, held.pose);
  const near = (b: Map<number, number[]>, x: number, z: number, reach: number) => [...b.values()].some((l) => l.some((_, i) => i % 2 === 0 && Math.hypot(l[i] - x, l[i + 1] - z) < reach));
  const nearest = (b: Map<number, number[]>, x: number, z: number) => {
    let best: { x: number; z: number } | null = null;
    let d = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const l = b.get(bucketKey(Math.floor(x / BUCKET) + dx, Math.floor(z / BUCKET) + dz)) ?? [];
        for (let i = 0; i < l.length; i += 2)
          if (Math.hypot(l[i] - x, l[i + 1] - z) < d) {
            d = Math.hypot(l[i] - x, l[i + 1] - z);
            best = { x: l[i], z: l[i + 1] };
          }
      }
    return best;
  };
  const blocked = (x: number, z: number) => near(track, x, z, TREE_CLEARANCE) || near(extra, x, z, TREE_CLEARANCE);
  const standable = (x: number, z: number, y: number) => {
    const i = grid.cellAtWorld(x, z);
    return i !== -1 && grid.surface[i] === SURF_GRASS && (grid.feature[i] === FEAT_NONE || grid.feature[i] === FEAT_TREE) && Math.abs(hillsOf(grid).groundAt(x, z) - y) < 1;
  };
  const out = trees.map((t) => (blocked(t.x, t.z) ? null : t));
  trees.forEach((t, i) => {
    if (out[i] !== null) return;
    const n = nearest(extra, t.x, t.z) ?? nearest(track, t.x, t.z);
    const away = n ? Math.atan2(t.z - n.z, t.x - n.x) : 0;
    for (const r of [52, 68, 84, 100, 120, 144]) {
      let best: TreeSpot | null = null;
      let bestTurn = Infinity;
      for (let k = 0; k < 12; k++) {
        const a = away + (k * 2 * Math.PI) / 12;
        const x = t.x + Math.cos(a) * r;
        const z = t.z + Math.sin(a) * r;
        if (!standable(x, z, t.y) || blocked(x, z) || out.some((o) => o !== null && Math.hypot(o.x - x, o.z - z) < 34)) continue;
        if (Math.min(k, 12 - k) < bestTurn) {
          bestTurn = Math.min(k, 12 - k);
          best = { x, z, y: t.y };
        }
      }
      if (best) {
        out[i] = best;
        return;
      }
    }
  });
  return out;
}

describe("TreeClearance keeps the trees between calls", () => {
  it("gives just what working every tree out afresh gives, for a piece held anywhere over a wood with track through it", () => {
    const grid = gridWithPlots(-1, -1, 2, 2);
    // A thick wood (a tree every 40 mm, a little jittered), with a line and a loop through it.
    const trees: TreeSpot[] = [];
    for (let x = -300; x <= 700; x += 40) for (let z = -300; z <= 700; z += 40) trees.push({ x: x + ((x * 7 + z * 13) % 11), z: z + ((x * 3 + z * 5) % 9), y: 0 });
    const layout = new Layout();
    layout.addPiece("straight-216", P(-100, 100));
    layout.addPiece("straight-216", P(116, 100));
    layout.addPiece("curve-large", P(300, 300, 1));
    const c = new TreeClearance(grid, trees);
    c.setLayout(layout);
    expect(c.spots()).toEqual(spotsAfresh(grid, layout, trees));
    const helds: HeldPiece[] = [
      { type: "straight-216", flipped: false, pose: P(0, 140), y: 0 },
      { type: "straight-216", flipped: false, pose: P(10, 100, 0.4), y: 0 },
      { type: "curve-large", flipped: true, pose: P(200, 200, 2), y: 0 },
      { type: "depot-workshop", flipped: false, pose: P(400, 500, -0.7), y: 0 },
      { type: "straight-108", flipped: false, pose: P(2000, 2000), y: 0 },
    ];
    for (const held of helds) expect(c.spots(held)).toEqual(spotsAfresh(grid, layout, trees, held));
    // (Holding the first does move trees: some for it, others because those moved.)
    const still = c.spots();
    expect(c.spots(helds[0]).filter((s, i) => s?.x !== still[i]?.x || s?.z !== still[i]?.z).length).toBeGreaterThan(5);
    // And again with the layout changed.
    layout.addPiece("straight-216", P(0, 400, 0.2));
    c.setLayout(layout);
    for (const held of helds) expect(c.spots(held)).toEqual(spotsAfresh(grid, layout, trees, held));
    expect(c.spots()).toEqual(spotsAfresh(grid, layout, trees));
  });
});
