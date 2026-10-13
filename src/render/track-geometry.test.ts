import { Box3, Raycaster, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createSample, getPieceDef, pathLength, RAMP_LENGTH, RISER_HEIGHT, samplePath, TRACK_THICKNESS, TRACK_WIDTH } from "../track";
import { buildPieceGeometry, GROOVE_DEPTH, PEG_HEIGHT } from "./track-geometry";

function topHeightAt(geomMesh: Mesh, x: number, z: number): number | null {
  const ray = new Raycaster(new Vector3(x, 500, z), new Vector3(0, -1, 0));
  const hit = ray.intersectObject(geomMesh)[0];
  return hit ? hit.point.y : null;
}

const meshOf = (type: Parameters<typeof getPieceDef>[0], flipped = false) =>
  new Mesh(buildPieceGeometry(getPieceDef(type, flipped)), new MeshBasicMaterial());

describe("buildPieceGeometry", () => {
  it("every piece's faces are in material groups (meshes use a body + cut material pair, which draws only grouped faces)", () => {
    for (const type of ["riser", "straight-144", "ramp", "bridge", "bridge-curve", "switch", "crossing"] as const) {
      const g = buildPieceGeometry(getPieceDef(type, false), type.startsWith("bridge") ? 2 : 0);
      const count = g.index ? g.index.count : g.attributes.position.count;
      const covered = g.groups.reduce((n, gr) => n + Math.min(gr.count, count - gr.start), 0);
      expect(covered, type).toBe(count);
    }
  });

  it("a bridge's arches reach from its deck down as many levels as asked, curved ones along the curve", () => {
    for (const type of ["bridge", "bridge-curve"] as const) {
      for (const levels of [1, 3]) {
        const box = new Box3().setFromObject(new Mesh(buildPieceGeometry(getPieceDef(type, false), levels), new MeshBasicMaterial()));
        expect(box.min.y, `${type} ${levels}`).toBeCloseTo(-levels * RISER_HEIGHT - 1, 0);
        expect(box.max.y, `${type} ${levels}`).toBeCloseTo(TRACK_THICKNESS, 0);
      }
    }
    // Under the middle of the curve (off the straight line between its ends) there is viaduct, below the deck.
    const curve = new Mesh(buildPieceGeometry(getPieceDef("bridge-curve", false), 1), new MeshBasicMaterial());
    const mid = getPieceDef("bridge-curve", false).paths[0].geom;
    const s = createSample();
    samplePath(mid, pathLength(mid) * 0.5, s);
    const ray = new Raycaster(new Vector3(s.x, -RISER_HEIGHT / 2, s.z - 100), new Vector3(0, 0, 1));
    expect(ray.intersectObject(curve).length).toBeGreaterThan(0);
  });

  it("a raised ramp's arches stand level on the ground under its slope", () => {
    const m = new Mesh(buildPieceGeometry(getPieceDef("ramp", false), 1), new MeshBasicMaterial());
    const box = new Box3().setFromObject(m);
    expect(box.min.y).toBeCloseTo(-RISER_HEIGHT - 1, 0);
    expect(box.max.y).toBeGreaterThan(RISER_HEIGHT);
    // Viaduct reaches the ground at both ends (just in from each end, below the deck).
    for (const x of [8, RAMP_LENGTH - 8]) {
      const ray = new Raycaster(new Vector3(x, -RISER_HEIGHT + 2, -100), new Vector3(0, 0, 1));
      expect(ray.intersectObject(m).length, `x ${x}`).toBeGreaterThan(0);
    }
  });

  it("without levels a bridge is just its deck", () => {
    const box = new Box3().setFromObject(meshOf("bridge"));
    expect(box.min.y).toBeGreaterThan(-1);
  });

  it("straight spans its length plus the peg, full width and thickness", () => {
    const m = meshOf("straight-144");
    const box = new Box3().setFromObject(m);
    expect(box.min.x).toBeCloseTo(0, 0);
    expect(box.max.x).toBeGreaterThan(144 + 15);
    expect(box.max.x).toBeLessThan(144 + 25);
    expect(box.max.z - box.min.z).toBeCloseTo(TRACK_WIDTH, 0);
    expect(box.max.y).toBeCloseTo(TRACK_THICKNESS, 0);
  });

  it("has wheel grooves cut into the top surface", () => {
    const m = meshOf("straight-144");
    expect(topHeightAt(m, 70, 0)).toBeCloseTo(TRACK_THICKNESS, 1); // centre strip
    expect(topHeightAt(m, 70, 13)).toBeCloseTo(TRACK_THICKNESS - GROOVE_DEPTH, 1); // groove
    expect(topHeightAt(m, 70, -13)).toBeCloseTo(TRACK_THICKNESS - GROOVE_DEPTH, 1);
  });

  it("cuts a keyhole socket at the socket end and adds a lower peg at the peg end", () => {
    const m = meshOf("straight-144");
    const inSocket = topHeightAt(m, 14, 0);
    expect(inSocket === null || inSocket < 1).toBe(true);
    expect(topHeightAt(m, 144 + 14, 0)).toBeCloseTo(PEG_HEIGHT, 1);
  });

  it("switch carries grooves for both routes", () => {
    const m = meshOf("switch");
    expect(topHeightAt(m, 120, 13)).toBeCloseTo(TRACK_THICKNESS - GROOVE_DEPTH, 1); // straight route, left groove
    // on the curved route, well past the split, its own centre line is solid and its grooves are cut
    const def = getPieceDef("switch", false);
    const end = def.connectors[2].pose;
    expect(topHeightAt(m, end.x - 20 * Math.cos(end.heading), end.z - 20 * Math.sin(end.heading))).toBeCloseTo(TRACK_THICKNESS, 1);
  });

  it("ramp rises to riser height", () => {
    const box = new Box3().setFromObject(meshOf("ramp"));
    expect(box.max.y).toBeGreaterThan(RISER_HEIGHT + TRACK_THICKNESS - 1);
  });

  it("produces normals and uvs for every vertex", () => {
    const g = buildPieceGeometry(getPieceDef("curve-large", true));
    const n = g.getAttribute("position").count;
    expect(n).toBeGreaterThan(100);
    expect(g.getAttribute("normal").count).toBe(n);
    expect(g.getAttribute("uv").count).toBe(n);
  });
});
