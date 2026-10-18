import { Color, Mesh, MeshStandardMaterial, PerspectiveCamera, Sprite } from "three";
import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, TRACK_THICKNESS, type PieceTypeId } from "../track";
import { aheadRuns, lineLegs, nearestAhead, stopCursors } from "../game/route-path";
import type { Materials } from "./materials";
import { discLabel, RouteView } from "./route-view";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

function line() {
  const layout = new Layout();
  const types: PieceTypeId[] = ["depot-farm", "straight-216", "curve-large", "curve-large", "depot-mill", "straight-216", "depot-mine"];
  const ids: number[] = [];
  for (const t of types) ids.push(ids.length ? appendPiece(layout, t, false, connectorRef(ids[ids.length - 1], 1)) : layout.addPiece(t, { x: 0, z: 0, heading: 0 }));
  return { layout, ids };
}

describe("RouteView", () => {
  it("draws one mesh per colour and kind, a disc and post per stop, tagged for picking; clear() empties it", () => {
    const { layout, ids } = line();
    const view = new RouteView(layout, stubMaterials());
    expect(view.group.name).toBe("route");
    const stops = [ids[0], ids[4], ids[6]];
    const legs = lineLegs(layout, stops);
    view.show(
      [
        ...legs.map((l) => ({ runs: l!, colour: "#3a7bd5" })),
        { runs: aheadRuns(layout, { pieceId: ids[1], pathIndex: 0, reversed: false, s: 0 }, 400), colour: "#e0603a", dotted: true },
        { runs: aheadRuns(layout, { pieceId: ids[5], pathIndex: 0, reversed: false, s: 0 }, 400), colour: "#e0603a", dotted: true },
      ],
      [
        { pieceId: stops[0], label: "1", colour: "#3a7bd5", state: "stop" },
        { pieceId: stops[1], label: "2", colour: "#3a7bd5", state: "next" },
        { pieceId: stops[2], label: "3", colour: "#3a7bd5", state: "unreachable" },
      ],
    );
    const meshes = view.group.children.filter((o) => (o as Mesh).isMesh && o.name.startsWith("route-"));
    // The dotted way: dark dashes under light ones (so they read on light wood), each colour one mesh.
    expect(meshes.map((m) => m.name).sort()).toEqual(["route-dots", "route-dots", "route-ribbon"]);
    const discs = view.group.children.filter((o) => (o as Sprite).isSprite);
    expect(discs.map((d) => d.userData)).toMatchObject(stops.map((pieceId, index) => ({ kind: "route-stop", pieceId, index })));
    expect(view.group.children).toHaveLength(3 + 3 * 2);
    // The ribbon lies just over the track's top (all flat here).
    const ribbon = meshes.find((m) => m.name === "route-ribbon") as Mesh;
    ribbon.geometry.computeBoundingBox();
    expect(ribbon.geometry.boundingBox!.min.y).toBeCloseTo(TRACK_THICKNESS + 0.4);
    expect(ribbon.geometry.boundingBox!.max.y).toBeCloseTo(TRACK_THICKNESS + 0.4);
    // The dotted way is its own mesh, of dashes.
    expect((meshes.find((m) => m.name === "route-dots") as Mesh).geometry.getAttribute("position").count).toBeGreaterThan(0);

    // A second show replaces what was drawn, disposing the old geometry.
    let disposed = false;
    ribbon.geometry.addEventListener("dispose", () => (disposed = true));
    view.show([{ runs: legs[0]!, colour: "#3a7bd5" }], []);
    expect(disposed).toBe(true);
    expect(view.group.children).toHaveLength(1);
    view.clear();
    expect(view.group.children).toHaveLength(0);
    view.dispose();
  });

  it("a gap no track crosses is red dashes, from where the way runs out", () => {
    const { layout, ids } = line();
    const view = new RouteView(layout, stubMaterials());
    // A stop off the track, 300 mm out to the side of the line's end: the nearest the way comes is its far end.
    const end = layout.getPiece(ids[6])!.pose;
    const from = nearestAhead(layout, stopCursors(layout, ids[4]), 3000, end.x + 100, end.z + 300)!;
    expect(from).not.toBe(null);
    view.show([], [], [{ from, to: { x: end.x + 100, y: from.y, z: end.z + 300 } }]);
    const dots = view.group.children.filter((o) => o.name === "route-dots") as Mesh[];
    expect(dots).toHaveLength(1);
    expect(dots[0].geometry.getAttribute("position").count).toBeGreaterThan(6);
  });

  it("the next disc pulses for a while and a new one pops, then they rest (nothing more to draw)", () => {
    const { layout, ids } = line();
    const view = new RouteView(layout, stubMaterials());
    view.show(
      [],
      [
        { pieceId: ids[0], label: "1", colour: "#3a7bd5", state: "stop" },
        { pieceId: ids[4], label: "2", colour: "#3a7bd5", state: "next" },
      ],
    );
    const [first, next] = view.group.children.filter((o) => (o as Sprite).isSprite);
    const size = next.scale.x;
    view.pulse(10);
    view.pop(0, 10);
    expect(view.animate(10.1)).toBe(true);
    expect(first.scale.x).toBeLessThan(first.userData.size);
    expect(view.animate(10.3)).toBe(true);
    expect(next.scale.x).toBeGreaterThan(size);
    // Past the pulse's few beats: back to size, at rest.
    expect(view.animate(20)).toBe(false);
    expect(next.scale.x).toBeCloseTo(size);
    expect(first.scale.x).toBeCloseTo(first.userData.size);
  });

  it("discs that would overlap on screen (seen from far) are fanned out side by side; near, they stay over their stops", () => {
    const { layout, ids } = line();
    const view = new RouteView(layout, stubMaterials());
    view.show(
      [],
      [
        { pieceId: ids[4], label: "1", colour: "#3a7bd5", state: "stop" },
        { pieceId: ids[5], label: "2", colour: "#3a7bd5", state: "stop" },
      ],
    );
    const [a, b] = view.group.children.filter((o) => (o as Sprite).isSprite);
    const look = (d: number) => {
      const cam = new PerspectiveCamera(30, 390 / 844, 10, 50000);
      const t = a.userData.base;
      cam.position.set(t.x, t.y + d, t.z + d * 0.6);
      cam.lookAt(t);
      cam.updateMatrixWorld();
      return cam;
    };
    const apart = () => a.position.distanceTo(b.position);
    const base = a.userData.base.distanceTo(b.userData.base);
    expect(view.fan(look(600), 844)).toBe(true);
    expect(apart()).toBeCloseTo(base);
    // Far off: fanned (further apart than their stops), and asked again for the same view, nothing to do.
    const far = look(12000);
    expect(view.fan(far, 844)).toBe(true);
    expect(apart()).toBeGreaterThan(base);
    expect(view.fan(far, 844)).toBe(false);
  });
});

describe("discLabel: a stop disc's number fits inside it (QA: a place visited four times, '4·6·8·1', was clipped)", () => {
  // Bold digits are about 0.6 of the size wide, a "·" about 0.3.
  const width = (text: string, size: number) => [...text].reduce((w, c) => w + (c === "·" ? 0.3 : 0.6) * size, 0);
  const r = 40;
  it("one or two visits as they were", () => {
    expect(discLabel("3", r, width)).toEqual({ text: "3", size: r * 1.25 });
    expect(discLabel("1·3", r, width)).toEqual({ text: "1·3", size: r * 0.72 });
  });
  it("more, smaller, inside the disc; past what reads, the first two and +", () => {
    for (const label of ["1·3·5", "4·6·8·1", "1·2·3·4·5·6", "10·12·14·16"]) {
      const fit = discLabel(label, r, width);
      expect(width(fit.text, fit.size), label).toBeLessThanOrEqual(r * 1.5 + 1e-9);
      expect(fit.size, label).toBeGreaterThanOrEqual(r * 0.5);
    }
    expect(discLabel("1·2·3·4·5·6", r, width).text).toBe("1·2+");
  });
});
