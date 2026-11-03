import { Color, Mesh, MeshStandardMaterial, PerspectiveCamera, Sprite } from "three";
import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, TRACK_THICKNESS, type PieceTypeId } from "../track";
import { aheadRuns, lineLegs, nearestAhead, stopCursors } from "../game/route-path";
import type { Materials } from "./materials";
import { discLabel, LANE_MIN, laneRuns, ribbonEdge, RIBBON_OPACITY, ribbonScale, RouteView } from "./route-view";
import { LINE_COLOURS } from "../game/lines";

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
    // The dotted way: soft dashes, one mesh for its colour.
    expect(meshes.map((m) => m.name).sort()).toEqual(["route-chevrons", "route-dots", "route-edge", "route-ribbon"]);
    const discs = view.group.children.filter((o) => (o as Sprite).isSprite);
    expect(discs.map((d) => d.userData)).toMatchObject(stops.map((pieceId, index) => ({ kind: "route-stop", pieceId, index })));
    // (The ribbon, its dark edge, its arrows, the dots, and a disc and post a stop.)
    expect(view.group.children).toHaveLength(4 + 3 * 2);
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
    // (The ribbon, its edge and its arrows.)
    expect(view.group.children).toHaveLength(3);
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

  it("a changed stretch lights up over the ribbon, fades out in under 2 s and goes; it stays through a redraw; steady with reduced motion", () => {
    const { layout, ids } = line();
    const view = new RouteView(layout, stubMaterials());
    const legs = lineLegs(layout, [ids[0], ids[6]]);
    const ribbons = legs.map((l) => ({ runs: l!, colour: "#3a7bd5" }));
    view.show(ribbons, []);
    const lit = () => view.group.children.find((o) => o.name === "route-lit") as Mesh | undefined;
    const opacity = () => (lit()!.material as { opacity: number }).opacity;
    view.highlight(legs[0]!.slice(1, 3), 10);
    expect(lit()).toBeDefined();
    expect(view.animate(10)).toBe(true);
    const o0 = opacity();
    // (The train moves on a piece: the route is drawn again, the light stays.)
    view.show(ribbons, []);
    expect(lit()).toBeDefined();
    expect(view.animate(10.8)).toBe(true);
    expect(opacity()).toBeLessThan(o0);
    expect(view.animate(12)).toBe(false);
    expect(lit()).toBeUndefined();
    // (Reduced motion: no fade, then gone.)
    view.highlight(legs[0]!.slice(1, 3), 20, false);
    view.animate(20);
    const s0 = opacity();
    view.animate(21);
    expect(opacity()).toBe(s0);
    view.animate(22);
    expect(lit()).toBeUndefined();
    // (The card closed: gone at once.)
    view.highlight(legs[0]!.slice(1, 3), 30);
    view.clear();
    expect(lit()).toBeUndefined();
  });
});

describe("ribbon edges against the track (audit F10)", () => {
  /** WCAG contrast of two "#rrggbb" colours. */
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** `top` at `alpha` over `under`, mixed per channel as the screen does. */
  const over = (top: string, under: string, alpha: number) =>
    "#" + [1, 3, 5].map((i) => Math.round(parseInt(top.slice(i, i + 2), 16) * alpha + parseInt(under.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");
  it("every line colour's edge, drawn at the ribbon's opacity over beech, holds 3:1 against beech", () => {
    const BEECH = "#e7c89a";
    for (const { name, colour } of LINE_COLOURS) expect(contrast(over(ribbonEdge(colour), BEECH, RIBBON_OPACITY), BEECH), name).toBeGreaterThanOrEqual(3);
  });
});

describe("which way a ribbon runs (audit F8)", () => {
  it("arrowheads along it, spaced, each pointing the way its run goes", () => {
    // (A straight run, so "ahead" is one way all along it.)
    const layout = new Layout();
    const ids: number[] = [];
    for (const t of ["depot-farm", "straight-216", "straight-216", "straight-216", "depot-mill"] as PieceTypeId[]) ids.push(ids.length ? appendPiece(layout, t, false, connectorRef(ids[ids.length - 1], 1)) : layout.addPiece(t, { x: 0, z: 0, heading: 0 }));
    const view = new RouteView(layout, stubMaterials());
    const legs = lineLegs(layout, [ids[0], ids[4]]);
    view.show([{ runs: legs[0]!, colour: "#3a7bd5" }], []);
    const arrows = view.group.children.find((o) => o.name === "route-chevrons") as Mesh;
    const p = arrows.geometry.getAttribute("position");
    const n = p.count / 3;
    expect(n).toBeGreaterThanOrEqual(2);
    // Each: its tip (the first point) ahead of its two back corners, the way the train goes from stop 1 to stop 2.
    const from = layout.getPiece(ids[0])!.pose;
    const to = layout.getPiece(ids[4])!.pose;
    const way = { x: to.x - from.x, z: to.z - from.z };
    // (The leg first runs back to the end of the farm's piece, where the train turns, and its arrows there point back:
    // those on the straights between the stops are checked.)
    let between = 0;
    for (let i = 0; i < n; i++) {
      const tip = { x: p.getX(3 * i), z: p.getZ(3 * i) };
      if (tip.x < 216 || tip.x > 864) continue;
      between++;
      const back = { x: (p.getX(3 * i + 1) + p.getX(3 * i + 2)) / 2, z: (p.getZ(3 * i + 1) + p.getZ(3 * i + 2)) / 2 };
      expect((tip.x - back.x) * way.x + (tip.z - back.z) * way.z).toBeGreaterThan(0);
    }
    expect(between).toBeGreaterThanOrEqual(4);
    view.dispose();
  });
});

describe("ribbons seen from far (audit F9)", () => {
  it("are drawn wide enough to be 4 px on screen, in steps of √2; at the track's own width close up", () => {
    // (A 390×844 phone's view, 30° high.)
    const px = (scale: number, d: number) => (14 * scale * 844) / (2 * d * Math.tan(Math.PI / 12));
    expect(ribbonScale(800, 844, 30)).toBe(1);
    for (const d of [3000, 8000, 15000, 30000, 60000]) {
      const s = ribbonScale(d, 844, 30);
      expect(px(s, d), `${d} mm`).toBeGreaterThanOrEqual(4);
      if (s > 1) expect(px(s / Math.SQRT2, d), `${d} mm, a step less`).toBeLessThan(4);
    }
  });
});

describe("two-way legs as two lanes (audit F8)", () => {
  /** `stop ══ ══ ══ stop` along +x from the origin. */
  function straightLine() {
    const layout = new Layout();
    const ids: number[] = [];
    for (const t of ["depot-farm", "straight-216", "straight-216", "straight-216", "depot-mill"] as PieceTypeId[]) ids.push(ids.length ? appendPiece(layout, t, false, connectorRef(ids[ids.length - 1], 1)) : layout.addPiece(t, { x: 0, z: 0, heading: 0 }));
    return { layout, ids };
  }

  it("laneRuns: a stretch run both ways is a lane each way; one way only stays one ribbon", () => {
    const there = [{ pieceId: 1, pathIndex: 0, s0: 0, s1: 216 }, { pieceId: 2, pathIndex: 0, s0: 0, s1: 216 }];
    // (Back over piece 2 only, and a different path of piece 1: not the same track.)
    const back = [{ pieceId: 2, pathIndex: 0, s0: 216, s1: 0 }, { pieceId: 1, pathIndex: 1, s0: 216, s1: 0 }];
    const [a, b] = laneRuns([there, back]);
    expect(a).toMatchObject([{ ...there[0], lane: false }, { ...there[1], lane: true }]);
    expect(b).toMatchObject([{ ...back[0], lane: true }, { ...back[1], lane: false }]);
    // The same way twice (a train's way to its next stop over its line's leg) is no lane.
    expect(laneRuns([there, there]).flat().every((r) => !r.lane)).toBe(true);
  });

  it("laneRuns: a part of a piece run back is split out, in the run's own direction; slivers are left as they are", () => {
    const there = [{ pieceId: 1, pathIndex: 0, s0: 0, s1: 216 }];
    const back = [{ pieceId: 1, pathIndex: 0, s0: 200, s1: 100 }];
    const [a, b] = laneRuns([there, back]);
    expect(a).toMatchObject([
      { pieceId: 1, pathIndex: 0, s0: 0, s1: 100, lane: false },
      // (Within LANE_MIN of the piece's end: the lane runs on to it, no sliver of ribbon.)
      { pieceId: 1, pathIndex: 0, s0: 100, s1: 216, lane: true },
    ]);
    expect(b).toMatchObject([{ ...back[0], lane: true }]);
    // A stretch run back shorter than LANE_MIN: no lanes.
    const [c] = laneRuns([there, [{ pieceId: 1, pathIndex: 0, s0: 100, s1: 100 - LANE_MIN / 2 }]]);
    expect(c).toMatchObject([{ ...there[0], lane: false }]);
  });

  it("a shuttle's two legs are drawn as two lanes, each on the left of its way, its arrows on it pointing its way", () => {
    const { layout, ids } = straightLine();
    const view = new RouteView(layout, stubMaterials());
    const legs = lineLegs(layout, [ids[0], ids[4]]);
    view.show(legs.map((l) => ({ runs: l!, colour: "#3a7bd5" })), []);
    // (Between the stops: three straights each way.)
    expect(view.laneLength).toBeGreaterThanOrEqual(2 * 3 * 216);
    const arrows = view.group.children.find((o) => o.name === "route-chevrons") as Mesh;
    const p = arrows.geometry.getAttribute("position");
    let east = 0;
    let west = 0;
    for (let i = 0; i < p.count / 3; i++) {
      const tip = { x: p.getX(3 * i), z: p.getZ(3 * i) };
      if (tip.x < 216 || tip.x > 864) continue;
      const back = (p.getX(3 * i + 1) + p.getX(3 * i + 2)) / 2;
      // Seen from above (+z toward the viewer, down the screen), the left of a way east is −z, of a way west +z.
      if (tip.x > back) (east++, expect(tip.z).toBeLessThan(-3));
      else (west++, expect(tip.z).toBeGreaterThan(3));
    }
    expect(east).toBeGreaterThanOrEqual(3);
    expect(west).toBeGreaterThanOrEqual(3);
    // The lanes keep to the track: each side within the ribbon's edge and a little.
    const ribbon = view.group.children.find((o) => o.name === "route-ribbon") as Mesh;
    ribbon.geometry.computeBoundingBox();
    expect(ribbon.geometry.boundingBox!.max.z).toBeLessThanOrEqual(12);
    expect(ribbon.geometry.boundingBox!.min.z).toBeGreaterThanOrEqual(-12);
    view.dispose();
  });

  it("a one-way leg is one ribbon: no lanes", () => {
    const { layout, ids } = straightLine();
    const view = new RouteView(layout, stubMaterials());
    const legs = lineLegs(layout, [ids[0], ids[4]]);
    view.show([{ runs: legs[0]!, colour: "#3a7bd5" }], []);
    // (Only where it turns at the end of the farm's piece, run back over it: that piece, no more.)
    expect(view.laneLength).toBeLessThanOrEqual(2 * 216);
    view.dispose();
  });

  it("laneRuns: lines sharing track are side by side, in the order given, the same sides whichever way each runs", () => {
    const red = [{ pieceId: 1, pathIndex: 0, s0: 0, s1: 216 }];
    const blue = [{ pieceId: 1, pathIndex: 0, s0: 216, s1: 0 }];
    const [r, b] = laneRuns([red, blue], ["red", "blue"]);
    expect(r).toMatchObject([{ lane: true, lines: 2 }]);
    expect(b).toMatchObject([{ lane: true, lines: 2 }]);
    // Red first across the track (the lower side), blue beside it, whichever way blue runs.
    expect(r[0].offset).toBeLessThan(0);
    expect(b[0].offset).toBeGreaterThan(0);
    expect(laneRuns([red, red], ["red", "blue"])[1][0].offset).toBeGreaterThan(0);
    // The path run against the map's sense: the other way across it.
    const [r2, b2] = laneRuns([red, blue], ["red", "blue"], () => true);
    expect(r2[0].offset).toBeGreaterThan(0);
    expect(b2[0].offset).toBeLessThan(0);
    // One line on its own: the whole ribbon, in the middle.
    expect(laneRuns([red], ["red"])[0]).toMatchObject([{ lane: false, offset: 0, width: 14, lines: 1 }]);
  });

  it("laneRuns: a line run both ways beside another line: three lanes, its two still each on the left of its way", () => {
    const there = [{ pieceId: 1, pathIndex: 0, s0: 0, s1: 216 }];
    const back = [{ pieceId: 1, pathIndex: 0, s0: 216, s1: 0 }];
    const other = [{ pieceId: 1, pathIndex: 0, s0: 0, s1: 216 }];
    const [t, k, o] = laneRuns([there, back, other], ["red", "red", "blue"]);
    // (Red's way up at the lowest side, its way down next, blue beyond: evenly spaced, none overlapping.)
    expect(t[0].offset).toBeLessThan(k[0].offset);
    expect(k[0].offset).toBeLessThan(o[0].offset);
    expect(k[0].offset - t[0].offset).toBeCloseTo(o[0].offset - k[0].offset);
    expect(k[0].offset - t[0].offset).toBeGreaterThanOrEqual(t[0].width);
    expect(t[0].lines).toBe(2);
  });

  it("two lines over one straight: drawn side by side, each its own colour, both within the track", () => {
    const { layout, ids } = straightLine();
    const view = new RouteView(layout, stubMaterials());
    const legs = lineLegs(layout, [ids[0], ids[4]]);
    view.show([{ runs: legs[0]!, colour: "#3a7bd5" }, { runs: legs[0]!, colour: "#e0603a" }], []);
    expect(view.sharedLength).toBeGreaterThanOrEqual(2 * 3 * 216);
    const ribbons = view.group.children.filter((o) => o.name === "route-ribbon") as Mesh[];
    expect(ribbons).toHaveLength(2);
    const zs = ribbons.map((m) => {
      m.geometry.computeBoundingBox();
      return m.geometry.boundingBox!;
    });
    // (Along x, so across is z: one each side of the middle, apart, inside the track's 40 mm.)
    const mids = zs.map((b) => (b.min.z + b.max.z) / 2).sort((a, b) => a - b);
    expect(mids[0]).toBeLessThan(-2);
    expect(mids[1]).toBeGreaterThan(2);
    for (const b of zs) expect(Math.max(-b.min.z, b.max.z)).toBeLessThanOrEqual(20);
    view.dispose();
  });
});
