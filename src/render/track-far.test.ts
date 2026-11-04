import { Box3, InstancedMesh, Mesh, MeshBasicMaterial, Raycaster, Vector3, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { createSample, getPieceDef, GROOVE_SPACING, Layout, pathLength, samplePath, TRACK_THICKNESS, type PieceTypeId } from "../track";
import type { Materials } from "./materials";
import { buildPieceFar, buildPieceGeometry, compactPiece, GROOVE_DEPTH, hasFarVersion, SLOT_BODY, SLOT_CUT } from "./track-geometry";
import { FAR_TRACK_PX_PER_MM, TrackView } from "./track-view";

const triangles = (g: BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const mesh = (g: BufferGeometry) => new Mesh(g, new MeshBasicMaterial());

/** The height of the top (from above) at a point across a piece's path, `along` its length and `across` it (mm). */
function topAt(m: Mesh, type: PieceTypeId, along: number, across: number): number | null {
  const geom = getPieceDef(type, false).paths[0].geom;
  const s = samplePath(geom, pathLength(geom) * along, createSample());
  const x = s.x - Math.sin(s.heading) * across;
  const z = s.z + Math.cos(s.heading) * across;
  const hit = new Raycaster(new Vector3(x, 200, z), new Vector3(0, -1, 0)).intersectObject(m)[0];
  return hit ? hit.point.y : null;
}

describe("a piece's far version", () => {
  it("plain track has one (straights, curves, S-curves and joins); pieces with supports, slopes, ends or several paths don't", () => {
    for (const t of ["straight-144", "curve-large", "curve-small", "curve-wide", "s-curve", "s-curve-short", "join-144-18"] as PieceTypeId[]) {
      expect(hasFarVersion(getPieceDef(t, false)), t).toBe(true);
      expect(hasFarVersion(getPieceDef(t, true)), `${t} flipped`).toBe(true);
    }
    for (const t of ["switch", "crossing", "buffer", "ramp", "ramp-curve", "bridge", "bridge-curve", "underpass", "riser", "joiner"] as PieceTypeId[]) {
      expect(hasFarVersion(getPieceDef(t, false)), t).toBe(false);
    }
  });

  it("is a tenth of the carved piece's triangles or less", () => {
    for (const t of ["curve-large", "curve-small", "s-curve", "straight-216"] as PieceTypeId[]) {
      const def = getPieceDef(t, false);
      const carved = triangles(compactPiece(buildPieceGeometry(def)));
      const far = triangles(compactPiece(buildPieceFar(def)));
      expect(far, t).toBeLessThan(carved / 10);
    }
  });

  it("has the carved piece's shape: its bounds, its top, its grooves (in the carving's colour)", () => {
    for (const [t, flipped] of [["curve-large", false], ["curve-large", true], ["s-curve", false], ["straight-144", false]] as [PieceTypeId, boolean][]) {
      const def = getPieceDef(t, flipped);
      const carved = mesh(buildPieceGeometry(def));
      const far = mesh(compactPiece(buildPieceFar(def)));
      const a = new Box3().setFromObject(carved);
      const b = new Box3().setFromObject(far);
      // (Its curve in fewer steps: within a millimetre of the carved one's bounds.)
      for (const k of ["x", "y", "z"] as const) {
        expect(Math.abs(a.min[k] - b.min[k]), `${t} min ${k}`).toBeLessThan(1);
        expect(Math.abs(a.max[k] - b.max[k]), `${t} max ${k}`).toBeLessThan(1);
      }
      if (flipped) continue;
      // The top, and down in each groove, along the piece (not at its ends, where the carved one has its holes).
      for (const along of [0.3, 0.5, 0.7]) {
        expect(topAt(far, t, along, 0), `${t} top`).toBeCloseTo(TRACK_THICKNESS, 1);
        for (const groove of [-GROOVE_SPACING / 2, GROOVE_SPACING / 2]) {
          expect(topAt(far, t, along, groove), `${t} groove`).toBeCloseTo(TRACK_THICKNESS - GROOVE_DEPTH, 0);
          expect(topAt(carved, t, along, groove), `${t} carved groove`).toBeCloseTo(TRACK_THICKNESS - GROOVE_DEPTH, 0);
        }
      }
      // The body's faces and the grooves', each in its material's group, every face in one.
      const g = far.geometry;
      expect(g.groups.map((gr) => gr.materialIndex)).toEqual([SLOT_BODY, SLOT_CUT]);
      expect(g.groups.reduce((n, gr) => n + gr.count, 0)).toBe(g.index!.count);
    }
  });
});

describe("TrackView far track", () => {
  const plain = () => new MeshBasicMaterial();
  const mats = { track: plain(), trackCut: plain(), bridgePaint: plain(), lacquer: plain, naturalWood: plain(), magnet: plain() } as unknown as Materials;
  /** The track meshes (each tile's pieces of a kind), by their triangles a piece. */
  const drawn = (view: TrackView) =>
    view.group.children
      .filter((c): c is InstancedMesh => c instanceof InstancedMesh && Array.isArray(c.material))
      .map((m) => triangles(m.geometry))
      .sort((x, y) => x - y);

  it("draws a tile's track in its far version where a millimetre is under half a pixel, carved again nearer (with some room between)", () => {
    const layout = new Layout();
    layout.addPiece("curve-large", { x: 0, z: 0, heading: 0 });
    layout.addPiece("switch", { x: 300, z: 0, heading: 0 });
    const view = new TrackView(layout, mats);
    view.sync();
    const carved = drawn(view);
    // A phone's view: 1688 pixels high at a 30° fov.
    const scale = 1688 / (2 * Math.tan(Math.PI / 12));
    const at = (pxPerMm: number) => new Vector3(0, scale / pxPerMm, 0);
    expect(view.setDetail(at(1), scale)).toBe(false);
    expect(drawn(view)).toEqual(carved);
    expect(view.setDetail(at(FAR_TRACK_PX_PER_MM * 0.8), scale)).toBe(true);
    const far = drawn(view);
    // The curve's far version; the switch has none (still carved).
    expect(far[0]).toBeLessThan(carved[0] / 10);
    expect(far).toContain(Math.max(...carved));
    // A little nearer: still far (no flicking back and forth at the edge); nearer still, carved again.
    expect(view.setDetail(at(FAR_TRACK_PX_PER_MM * 1.05), scale)).toBe(false);
    expect(view.setDetail(at(FAR_TRACK_PX_PER_MM * 1.2), scale)).toBe(true);
    expect(drawn(view)).toEqual(carved);
    // Laid again (a piece added) while far out: drawn far at once.
    view.setDetail(at(FAR_TRACK_PX_PER_MM * 0.5), scale);
    layout.addPiece("curve-large", { x: 0, z: 400, heading: 0 });
    view.sync();
    expect(drawn(view)[0]).toBeLessThan(carved[0] / 10);
  });
});
