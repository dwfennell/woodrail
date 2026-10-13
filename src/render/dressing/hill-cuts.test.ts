import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3, type BufferGeometry } from "three";
import { blockOutline, hillsOf, insideBlock, gridWithPlots, SURF_RIVER, syncCuttings, type Landscape } from "../../landscape";
import { Layout, RAMP_LENGTH, RISER_HEIGHT } from "../../track";
import { columnGeometry, cutColumn, HillCutsView } from "./hill-cuts";

/** Signed volume (positive when faces point out) and how many edges aren't shared by exactly two triangles. */
function solidity(g: BufferGeometry): { volume: number; openEdges: number } {
  const p = g.getAttribute("position");
  let volume = 0;
  const edges = new Map<string, number>();
  const key = (i: number) => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
  for (let i = 0; i < p.count; i += 3) {
    const [a, b, c] = [i, i + 1, i + 2].map((k) => new Vector3(p.getX(k), p.getY(k), p.getZ(k)));
    volume += a.dot(b.clone().cross(c)) / 6;
    for (const [m, n] of [[i, i + 1], [i + 1, i + 2], [i + 2, i]]) {
      const e = [key(m), key(n)].sort().join("|");
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  // An edge on an odd number of faces is a hole's rim. (Four faces: the surface touches itself there, where a cutting
  // reaches right down to the block's foot: top and bottom meet, still closed.)
  let openEdges = 0;
  for (const count of edges.values()) if (count % 2 === 1) openEdges++;
  return { volume, openEdges };
}

/** Area of a plan polygon. */
const area = (poly: { x: number; z: number }[]) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p.x * q.z - q.x * p.z; }, 0) / 2);

const heightAt = (g: BufferGeometry, x: number, z: number): number | null => {
  const hit = new Raycaster(new Vector3(x, 500, z), new Vector3(0, -1, 0)).intersectObject(new Mesh(g, new MeshBasicMaterial()))[0];
  return hit ? hit.point.y : null;
};

describe("hill block columns", () => {
  it("an uncut block is a closed, outward-facing box of the right volume, all of its top painted", () => {
    for (const corners of [0, 5]) {
      const outline = blockOutline(corners, 0.4, 8);
      const { body, paint } = columnGeometry(outline, 0, () => 63.6, 63.6);
      const { volume, openEdges } = solidity(body);
      expect(openEdges, `corners ${corners}`).toBe(0);
      expect(volume / (area(outline) * 63.6), `corners ${corners}`).toBeCloseTo(1, 2);
      expect(paint.getAttribute("position").count).toBeGreaterThan(0);
      expect(heightAt(body, 0, 0)).toBeCloseTo(63.6, 3);
    }
  });

  it("a block with a sloping cut is closed, outward-facing, the right volume, and its top follows the cut", () => {
    const outline = blockOutline(0, 0.4, 8);
    // A cut whose floor slopes from 10 mm at x = −36 up to 50 mm at x = +36, across the middle band |z| < 20, with
    // 60° banks either side: the block's top is the lower of that and 63.6.
    const tan = Math.tan(Math.PI / 3);
    const top = (x: number, z: number) => Math.min(63.6, 10 + ((x + 36) / 72) * 40 + Math.max(0, Math.abs(z) - 20) * tan);
    const { body, paint } = columnGeometry(outline, 0, top, 63.6);
    const { volume, openEdges } = solidity(body);
    expect(openEdges).toBe(0);
    // Numerically integrate the model's volume over the outline.
    let model = 0;
    const step = 0.5;
    for (let x = -35.6 + step / 2; x < 35.6; x += step) for (let z = -35.6 + step / 2; z < 35.6; z += step) model += top(x, z) * step * step;
    expect(volume / model).toBeGreaterThan(0.99);
    expect(volume / model).toBeLessThan(1.01);
    // Looking straight down, the top is where the model says (to the subdivision's few millimetres).
    for (const [x, z] of [[0, 0], [-30, 5], [30, -10], [10, 30], [-20, -33]] as const) {
      expect(heightAt(body, x, z)!, `${x},${z}`).toBeCloseTo(top(x, z), 0);
    }
    // Paint only where the block's top is untouched (out beyond the banks).
    expect(heightAt(paint, 30, 33)).not.toBeNull();
    expect(heightAt(paint, 0, 0)).toBeNull();
  });

  it("with a bevel round its top, a cut block is still closed and outward-facing", () => {
    const outline = blockOutline(0, 0.4, 8);
    const inner = blockOutline(0, 2.4, 8);
    const tan = Math.tan(Math.PI / 3);
    for (const top of [
      (x: number, z: number) => Math.min(63.6, 10 + ((x + 36) / 72) * 40 + Math.max(0, Math.abs(z) - 20) * tan),
      (_x: number, z: number) => (Math.abs(z) < 15 ? -5 : 63.6),
    ]) {
      const { body } = columnGeometry(outline, 0, top, 63.6, { bevel: { inner, drop: 2 } });
      const { volume, openEdges } = solidity(body);
      expect(openEdges).toBe(0);
      expect(volume).toBeGreaterThan(0);
      // The edge is 2 mm down where the top is whole.
      expect(heightAt(body, 35.5, 33)).toBeLessThan(62);
    }
  });

  it("where a cut takes a block right down to its base, nothing is drawn there, and what's left is still closed", () => {
    const outline = blockOutline(0, 0.4, 8);
    const top = (_x: number, z: number) => (Math.abs(z) < 15 ? -5 : 63.6);
    const { body } = columnGeometry(outline, 0, top, 63.6);
    expect(solidity(body).openEdges).toBe(0);
    expect(heightAt(body, 0, 0)).toBeNull();
    expect(heightAt(body, 0, 30)).toBeCloseTo(63.6, 3);
  });
});

describe("hill blocks cut by ramps' cuttings", () => {
  const P = (x: number, z: number, heading = 0) => ({ x, z, heading });
  /** Where the hill starts: a square short of a ramp's top end (from x = 0), so its last square runs into the hill. */
  const HILL = RAMP_LENGTH - 72;
  /** Felt, with a hill `height` blocks high from x = HILL eastward over a band of rows, and any squares raised higher. */
  function land(height = 1, extra: (x: number, z: number) => number = () => 0): Landscape {
    const grid = gridWithPlots(-1, -1, 2, 2);
    for (let x = HILL + 36; x < 1200; x += 72) for (let z = -300; z < 300; z += 72) {
      const i = grid.cellAtWorld(x, z);
      if (i !== -1) grid.height[i] = height + extra(x, z);
    }
    return { seed: 0, starter: false, grid, towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
  }
  const cases: { name: string; land: Landscape; ramps: { pose: { x: number; z: number; heading: number }; y: number }[]; blocks: number }[] = [
    { name: "straight into an edge (its banks reach the rows beside)", land: land(), ramps: [{ pose: P(0, 36), y: 0 }], blocks: 3 },
    { name: "straddling two rows", land: land(), ramps: [{ pose: P(0, 0), y: 0 }], blocks: 2 },
    { name: "across several blocks (into the hill at a slant)", land: land(), ramps: [{ pose: P(40, 0, 0.35), y: 0 }], blocks: 3 },
    { name: "diagonal (45°)", land: land(), ramps: [{ pose: P(60, -40, Math.PI / 4), y: 0 }], blocks: 6 },
    { name: "level 1 to level 2", land: land(1, (x) => (x > 216 + HILL ? 1 : 0)), ramps: [{ pose: P(216, 36), y: RISER_HEIGHT }], blocks: 3 },
    { name: "two ramps cutting the same block", land: land(), ramps: [{ pose: P(0, 0), y: 0 }, { pose: P(0, 56), y: 0 }], blocks: 3 },
  ];
  // A ramp into a rounded corner: a lone block with a river round it.
  {
    const l = land(0);
    const at = (x: number, z: number) => l.grid.cellAtWorld(x, z);
    const bx = HILL + 36;
    for (let x = bx - 72; x <= bx + 72; x += 72) for (let z = -36 - 72; z <= -36 + 72; z += 72) l.grid.surface[at(x, z)] = SURF_RIVER;
    l.grid.surface[at(bx, -36)] = 0;
    l.grid.height[at(bx, -36)] = 1;
    cases.push({ name: "into a rounded corner", land: l, ramps: [{ pose: P(20, 0, -0.25), y: 0 }], blocks: 1 });
  }

  for (const c of cases) {
    it(`${c.name}: every cut block is closed and its top is the ground`, () => {
      const layout = new Layout();
      for (const r of c.ramps) layout.addPiece("ramp", r.pose, r.y);
      syncCuttings(c.land, layout);
      const hills = hillsOf(c.land.grid);
      const cut = hills.cutBlocks();
      expect(cut.length, "blocks cut").toBe(c.blocks);
      for (const b of cut) {
        const { body } = cutColumn(c.land.grid, b);
        const { volume, openEdges } = solidity(body);
        expect(openEdges, `${b.col},${b.row},${b.level}`).toBe(0);
        expect(volume).toBeGreaterThan(0);
        // Seen from above, inside the block (clear of its edges), its top is where the ground is, or it's gone right
        // down there and the ground is the block under it (or the felt).
        const cx = c.land.grid.centreX(b.col);
        const cz = c.land.grid.centreZ(b.row);
        const corners = hills.blockCorners(b.col, b.row, b.level);
        for (let ox = -32; ox <= 32; ox += 8) {
          for (let oz = -32; oz <= 32; oz += 8) {
            if (!insideBlock(corners, ox, oz) || !insideBlock(corners, ox * 1.08, oz * 1.08)) continue;
            const ground = hills.groundAt(cx + ox, cz + oz);
            const hit = heightAt(body, cx + ox, cz + oz);
            if (ground <= b.level * RISER_HEIGHT + 0.5) expect(hit === null || hit < b.level * RISER_HEIGHT + 1.5).toBe(true);
            else expect(Math.abs(hit! - Math.min(ground, (b.level + 1) * RISER_HEIGHT - 0.4)), `${b.col},${b.row},${b.level} at ${ox},${oz}`).toBeLessThan(2.5);
          }
        }
      }
    });
  }
});

describe("HillCutsView when plots are built again", () => {
  it("replaces their core and shadow rather than adding more", () => {
    const grid = gridWithPlots(-1, -1, 2, 2);
    for (let x = 180; x < 900; x += 72) for (let z = -300; z < 300; z += 72) grid.height[grid.cellAtWorld(x, z)] = 2;
    const view = new HillCutsView(grid, { wood: new MeshBasicMaterial(), top: new MeshBasicMaterial() }, () => []);
    const before = view.group.children.length;
    expect(before).toBeGreaterThan(0);
    view.plotsRebuilt([0, 1, 2, 3]);
    view.plotsRebuilt([3]);
    expect(view.group.children.length).toBe(before);
  });
});
