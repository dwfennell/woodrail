import { Color, Mesh, MeshStandardMaterial, Sprite } from "three";
import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, TRACK_THICKNESS, type PieceTypeId } from "../track";
import { aheadRuns, lineLegs } from "../game/route-path";
import type { Materials } from "./materials";
import { RouteView } from "./route-view";

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
    expect(meshes.map((m) => m.name).sort()).toEqual(["route-dots", "route-ribbon"]);
    const discs = view.group.children.filter((o) => (o as Sprite).isSprite);
    expect(discs.map((d) => d.userData)).toEqual(stops.map((pieceId, index) => ({ kind: "route-stop", pieceId, index })));
    expect(view.group.children).toHaveLength(2 + 3 * 2);
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
});
