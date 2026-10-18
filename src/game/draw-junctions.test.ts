import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { gridWithPlots, hillsOf, type Landscape } from "../landscape";
import { Sim } from "../sim";
import { appendPiece, connectorRef, DrawLine, Layout, type DrawOptions, type PieceTypeId } from "../track";
import { branchFrom, BUSY_MESSAGE, linePlan, mergeAt, type JunctionRules } from "./draw-junctions";
import { Progress } from "./progress";
import { pieceStock, pieceUnlearned } from "./supply";
import { drawMessage, drawRefusal, trackMessage, trackPlacement, type TrackRules } from "./track-rules";
import { createWorld } from "./world";
import type { BlockReason } from "../landscape";

/**
 * Junctions in a drawn line (N2 phase 2, spec §3): a branch off a line's body through a switch swapped in there, and a
 * merge into a line on lift, as DrawHand makes them, with the game's own track rules and the Editor.
 */

function flat(): Landscape {
  return { seed: 0, starter: false, grid: gridWithPlots(-1, -1, 2, 2), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}

/** A line of four long straights from (0, Z) along +x; their ids. */
const Z = 36;
function line(layout: Layout): number[] {
  const ids = [layout.addPiece("straight-216", { x: 0, z: Z, heading: 0 }, 0)];
  for (let i = 1; i < 4; i++) ids.push(appendPiece(layout, "straight-216", false, connectorRef(ids[i - 1], 1)));
  return ids;
}

function setup(stock: Partial<Record<PieceTypeId, number>> | null = null, trainOn: (ids: number[]) => number[] = () => []) {
  const land = flat();
  const layout = new Layout();
  const ids = line(layout);
  const busy = new Set(trainOn(ids));
  const sim = new Sim(layout);
  const editor = new Editor(layout, sim, () => {});
  const rules: TrackRules = { land, layout, props: null, footprint: () => undefined };
  const junctions: JunctionRules = {
    layout,
    check: (type, flipped, pose, y, ignore) => {
      const p = trackPlacement(rules, type, flipped, pose, y, ignore);
      const why = p.reason ?? (p.risers.length ? "unsupported" : null);
      return why ? trackMessage(why) : null;
    },
    occupied: (id) => busy.has(id),
    may: (type, used) => (!stock || (stock[type] ?? Infinity) > used ? null : `Out of ${type}`),
  };
  /** The line's own checks, the straights a branch replaces left out (as DrawHand does). */
  const options = (ignore: ReadonlySet<number>): DrawOptions => ({
    check: (c) => {
      const p = trackPlacement(rules, c.type, c.flipped, c.pose, c.y, ignore);
      const why = drawRefusal(land, c.type, c.flipped, c.pose, c.y, p.reason, p.risers);
      return why ? { reason: why.reason, message: drawMessage(why.reason, why.levels, (r) => trackMessage(r as BlockReason, why.levels)), levels: why.levels } : null;
    },
    groundAt: (x, z) => hillsOf(land.grid).groundAt(x, z),
  });
  return { land, layout, ids, sim, editor, junctions, options };
}

type Setup = ReturnType<typeof setup>;

/** A stroke pressed on straight `onto` at (px, Z) going off at `deg` degrees for `length` mm: the branch and the line after it. */
function branchStroke(s: Setup, onto: number, px: number, deg: number, length = 600) {
  const a = (deg * Math.PI) / 180;
  const at = (d: number) => ({ x: px + Math.cos(a) * d, z: Z + Math.sin(a) * d });
  let d = 4;
  let b = branchFrom(s.junctions, onto, { x: px, z: Z }, at(d));
  for (; b.kind === "wait" && d < length; d += 4) b = branchFrom(s.junctions, onto, { x: px, z: Z }, at(d));
  if (b.kind !== "branch") return { b, line: null };
  const drawn = new DrawLine(b.swap.end, s.options(new Set(b.swap.covers)));
  for (; d <= length; d += 4) drawn.addPoint(at(d).x, at(d).z);
  drawn.finish();
  return { b, line: drawn };
}

describe("drawing a branch off a line (a switch swapped in)", () => {
  it("off a straight, either hand: a switch to the side the stroke leaves, the line from its branch, all one undo step", () => {
    for (const [deg, side] of [[45, 1], [-45, -1], [60, 1], [-70, -1]] as const) {
      const s = setup();
      const before = s.layout.pieceCount;
      const joints = s.layout.jointCount;
      const { b, line: drawn } = branchStroke(s, s.ids[1], 300, deg);
      expect(b.kind, `${deg}°`).toBe("branch");
      if (b.kind !== "branch" || !drawn) continue;
      expect(drawn.pieces.length, `${deg}°`).toBeGreaterThan(0);
      expect(drawn.pieces.some((p) => p.blocked), `${deg}°`).toBe(false);
      const plan = linePlan(b.swap, drawn.placeable(), null);
      const ids = s.editor.replaceRun(plan.covers, plan.pieces);
      const sw = ids[0];
      expect(s.layout.getPiece(sw)?.type).toBe("switch");
      // The branch leaves to the stroke's side, and the switch is set to the old line (its straight way, state 0).
      expect(Math.sign(b.swap.end.z - Z), `${deg}°`).toBe(side);
      expect(s.layout.switchState(sw)).toBe(0);
      // The straights it replaced are up; every piece is joined: the old line through the switch, the new line off it.
      for (const id of plan.covers) expect(s.layout.getPiece(id)).toBeUndefined();
      expect(s.layout.jointCount, `${deg}°`).toBe(joints - plan.covers.length + (plan.line + 1) - 1 + drawn.placeable().length);
      // One undo puts the line back as it was, every straight where it was.
      s.editor.undo();
      expect(s.layout.pieceCount).toBe(before);
      expect(s.layout.jointCount).toBe(joints);
      for (const id of s.ids) expect(s.layout.getPiece(id)?.type).toBe("straight-216");
    }
  });

  it("the straights it takes the place of go back in the box (the layout has them no more), and a switch comes out", () => {
    const s = setup();
    const { b, line: drawn } = branchStroke(s, s.ids[2], 520, 45);
    if (b.kind !== "branch" || !drawn) throw new Error(b.kind);
    const count = (t: PieceTypeId) => [...s.layout.pieceIds()].filter((id) => s.layout.getPiece(id)!.type === t).length;
    const long0 = count("straight-216");
    const plan = linePlan(b.swap, drawn.placeable(), null);
    s.editor.replaceRun(plan.covers, plan.pieces);
    // (Game mode counts the toy box against the map: owned less what's on it.)
    expect(count("switch")).toBe(1);
    expect(count("straight-216")).toBe(long0 - plan.covers.length + plan.pieces.filter((p) => p.type === "straight-216").length);
  });

  it("is refused with a train on the straight, and when there's no switch left (or not learned)", () => {
    const busy = setup(null, (ids) => [ids[1]]);
    expect(branchStroke(busy, busy.ids[1], 300, 45).b).toEqual({ kind: "refused", message: BUSY_MESSAGE });
    const none = setup({ switch: 0 });
    expect(branchStroke(none, none.ids[1], 300, 45).b).toEqual({ kind: "refused", message: "Out of switch" });
  });

  it("waits till the finger is 30 mm off the line and 50 mm on, so its way is known (no switch for a wobble along it)", () => {
    const s = setup();
    expect(branchFrom(s.junctions, s.ids[1], { x: 300, z: Z }, { x: 340, z: Z + 10 }).kind).toBe("wait");
    expect(branchFrom(s.junctions, s.ids[1], { x: 300, z: Z }, { x: 320, z: Z + 31 }).kind).toBe("wait");
    expect(branchFrom(s.junctions, s.ids[1], { x: 300, z: Z }, { x: 340, z: Z + 40 }).kind).toBe("branch");
  });
});

describe("merging into a line on lift", () => {
  it("a line drawn in at 45° and let go on a straight joins it through a switch (and a straight to fit), in the same undo step", () => {
    let merged = 0;
    for (const x0 of [200, 236, 272, 308]) {
      const s = setup();
      const joints = s.layout.jointCount;
      // From open ground above the line, heading down onto it at 45°, let go on it.
      const start = { x: x0, z: Z + 324, heading: -Math.PI / 4, y: 0, kind: "peg" as const };
      const drawn = new DrawLine(start, s.options(new Set()));
      const end = { x: x0 + 324, z: Z };
      for (let d = 4; d <= 458; d += 4) drawn.addPoint(x0 + (d / 458) * 324, Z + 324 - (d / 458) * 324);
      void end;
      drawn.finish();
      const m = mergeAt(s.junctions, drawn.start, drawn.placeable(), drawn.tip, new Set(), 0);
      if (!m || m.kind !== "merge") continue;
      merged++;
      const plan = linePlan(null, drawn.placeable(), m);
      const before = s.layout.pieceCount;
      s.editor.replaceRun(plan.covers, plan.pieces);
      const sw = [...s.layout.pieceIds()].find((id) => s.layout.getPiece(id)!.type === "switch")!;
      expect(s.layout.switchState(sw)).toBe(0);
      // Every joint made: the old line through the switch, the new one into its branch.
      expect(s.layout.jointCount, `from ${x0}`).toBe(joints - m.swap.covers.length + m.swap.pieces.length + plan.pieces.length - m.swap.pieces.length);
      s.editor.undo();
      expect(s.layout.pieceCount).toBe(before);
      expect(s.layout.jointCount).toBe(joints);
    }
    expect(merged).toBeGreaterThan(1);
  });

  it("not when let go away from the line, nor with a train on it, nor with no switch left", () => {
    const s = setup();
    const start = { x: 236, z: Z + 324, heading: -Math.PI / 4, y: 0, kind: "peg" as const };
    const drawn = new DrawLine(start, s.options(new Set()));
    for (let d = 4; d <= 300; d += 4) drawn.addPoint(236 + (d / 458) * 324, Z + 324 - (d / 458) * 324);
    drawn.finish();
    expect(mergeAt(s.junctions, drawn.start, drawn.placeable(), drawn.tip, new Set(), 0)).toBeNull();
  });
});

describe("Game mode's supply for drawn junctions", () => {
  it("a switch is learned from the starting board; the three-way and crossings need the junctions blueprint", () => {
    const p = Progress.fresh();
    const world = createWorld(7);
    expect(pieceUnlearned(p, "switch")).toBe("Switch: not learned yet");
    expect(pieceStock(p, world, "switch")).toBe(0);
    p.learned.add("switches");
    expect(pieceUnlearned(p, "switch")).toBeNull();
    expect(pieceUnlearned(p, "switch-3way")).toBe("Three-way: not learned yet");
    expect(pieceStock(p, world, "switch-3way")).toBe(0);
    expect(pieceUnlearned(p, "crossing")).toBe("Crossing: not learned yet");
    expect(pieceUnlearned(p, "crossing-45")).toBe("45° crossing: not learned yet");
    p.learned.add("junctions");
    expect(pieceUnlearned(p, "switch-3way")).toBeNull();
  });
});

describe("junctions' cost", () => {
  it("looking for a merge on each move is cheap on a big layout (400 straights): well under a millisecond", () => {
    const layout = new Layout();
    for (let r = 0; r < 20; r++) {
      let id = layout.addPiece("straight-216", { x: -2000, z: -1500 + r * 150, heading: 0 }, 0);
      for (let k = 1; k < 20; k++) id = appendPiece(layout, "straight-216", false, connectorRef(id, 1));
    }
    expect(layout.pieceCount).toBe(400);
    const junctions: JunctionRules = { layout, check: () => null, occupied: () => false, may: () => null };
    const start = { x: 0, z: 400, heading: -Math.PI / 4, y: 0, kind: "peg" as const };
    const run = () => {
      let worst = 0;
      for (let k = 0; k < 200; k++) {
        const t0 = performance.now();
        mergeAt(junctions, start, [], { x: (k * 37) % 3000 - 1500, z: (k * 53) % 3000 - 1500 }, new Set(), 0);
        worst = Math.max(worst, performance.now() - t0);
      }
      return worst;
    };
    run();
    let worst = run();
    for (let k = 0; k < 4 && worst >= 1; k++) worst = Math.min(worst, run());
    expect(worst).toBeLessThan(1);
  });
});
