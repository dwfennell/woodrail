import { describe, expect, it } from "vitest";
import { hillsOf, inRiver, type BlockReason } from "../landscape";
import { createWorldConnector, DrawLine, fitAutoStraight, getPieceDef, JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE, normalizeAngle, solveParentPose, transformPose, type DrawCandidate, type DrawEnd, type DrawOptions, type PieceTypeId } from "../track";
import { DrawNotice, TOO_SHARP } from "./draw-notice";
import { Progress } from "./progress";
import { isFree, ruleOf, thingsFor } from "./things";
import { drawMessage, drawRefusal, trackMessage, trackPlacement, type TrackRules } from "./track-rules";
import { createWorld, type World } from "./world";

/**
 * QA's regression sweep, item 1: false (and missing) refusals while drawing, on the real starter map (seed 7) with
 * the game's rules, as DrawHand runs a line and says things (`DrawNotice`).
 */

function gameStock(world: World, progress: Progress = Progress.fresh()) {
  const stock = (type: PieceTypeId): number => {
    let n = Infinity;
    for (const [id, k] of thingsFor({ kind: "piece", type })) {
      if (!progress.knows(id)) return 0;
      if (isFree(id)) continue;
      n = Math.min(n, Math.floor(progress.available(world, id) / k));
    }
    return n;
  };
  const unlearned = (type: PieceTypeId): string | null => {
    for (const id of thingsFor({ kind: "piece", type }).keys()) if (!isFree(id) && !progress.knows(id)) return `${ruleOf(id)!.label}: not learned yet`;
    return null;
  };
  return { stock, unlearned };
}

function drawOptions(world: World, game: ReturnType<typeof gameStock> | null): DrawOptions {
  const land = world.landscape;
  const layout = world.layout;
  const rules: TrackRules = { land, layout, props: world.props, footprint: () => undefined };
  const hills = hillsOf(land.grid);
  return {
    check: (c) => {
      const p = trackPlacement(rules, c.type, c.flipped, c.pose, c.y, -1);
      const why = drawRefusal(land, c.type, c.flipped, c.pose, c.y, p.reason, p.risers);
      return why ? { reason: why.reason, message: drawMessage(why.reason, why.levels, (r) => trackMessage(r as BlockReason, why.levels)), levels: why.levels } : null;
    },
    allow: game ? (type, line) => line.filter((p) => p.type === type).length < game.stock(type) : undefined,
    meet: (e: DrawEnd): DrawCandidate | null => {
      const seated = e.kind === "peg" ? 0 : 1;
      const long = getPieceDef("straight-216", false);
      const pose = solveParentPose(long.connectors[seated].pose, { x: e.x, z: e.z, heading: e.heading + Math.PI }, { x: 0, z: 0, heading: 0 });
      const fit = fitAutoStraight(layout, pose, e.y, seated, []);
      if (!fit || fit.gap) return null;
      const def = getPieceDef(fit.type, fit.flipped);
      if (def.connectors.length !== 2) return null;
      const exit = 1 - seated;
      const w = transformPose(fit.pose, def.connectors[exit].pose, { x: 0, z: 0, heading: 0 });
      return { type: fit.type, flipped: fit.flipped, pose: fit.pose, y: e.y, entry: seated, exit, length: fit.length, end: { x: w.x, z: w.z, heading: w.heading, y: e.y, kind: def.connectors[exit].kind } };
    },
    closes: (e) => {
      const near: number[] = [];
      const w = createWorldConnector();
      const n = layout.queryFreeConnectors(e.x, e.z, JOINT_POS_TOLERANCE, near);
      for (let i = 0; i < n; i++) {
        layout.worldConnector(near[i], w);
        if (Math.abs(w.y - e.y) > 2 || Math.hypot(w.x - e.x, w.z - e.z) > JOINT_POS_TOLERANCE) continue;
        if (Math.abs(normalizeAngle(w.heading - e.heading - Math.PI)) <= JOINT_ANGLE_TOLERANCE) return true;
      }
      return false;
    },
    groundAt: (x, z) => hills.groundAt(x, z),
    wet: (x, z) => inRiver(land.grid, x, z),
    onMap: (x, z) => land.grid.cellAtWorld(x, z) !== -1,
    outOf: (type) => game?.unlearned(type) ?? `Out of ${type}`,
  };
}

/** DrawHand's toasts for a stroke (points on the ground, in order, then lifted), as `DrawNotice` says them, and the line. */
function drawStroke(start: DrawEnd, opts: DrawOptions, points: readonly { x: number; z: number }[], game: ReturnType<typeof gameStock> | null) {
  const toasts: string[] = [];
  const line = new DrawLine(start, opts);
  const notice = new DrawNotice((t) => game?.unlearned(t) ?? `Out of ${t}`, (t) => t, (t) => game?.unlearned(t) ?? null);
  notice.start();
  for (const p of points) {
    const before = line.pieces.length;
    line.addPoint(p.x, p.z);
    const say = notice.moved(line, p, before);
    if (say) toasts.push(say);
  }
  line.finish();
  const lift = notice.lifted(line, line.placeable().length);
  return { line, toasts, lift };
}

const LARKFIELD_EAST: DrawEnd = { x: -432, z: 108, heading: 0, y: 0, kind: "peg" };
const LARKFIELD_WEST: DrawEnd = { x: -648, z: 108, heading: Math.PI, y: 0, kind: "peg" };

/** Stroke points from (x0, z0) to (x1, z1), `step` mm apart. */
function along(x0: number, z0: number, x1: number, z1: number, step = 8): { x: number; z: number }[] {
  const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step);
  return Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * (i + 1)) / n, z: z0 + ((z1 - z0) * (i + 1)) / n }));
}

/** A stub of the line, for what `DrawNotice` reads of it. */
function stub(s: Partial<{ stalled: boolean; stopped: DrawLine["stopped"]; refused: PieceTypeId | null; leftBehind: boolean; goingBack: boolean; pieces: unknown[] }>): DrawLine {
  return { stalled: false, stopped: null, refused: null, leftBehind: false, goingBack: false, pieces: [], ...s } as unknown as DrawLine;
}

describe("drawing: what the line says (QA sweep item 1)", () => {
  it("(a) a stall the line gets past says nothing; one that lasts says 'Too sharp' once; one left at the lift says it then", () => {
    const n = new DrawNotice((t) => `Out of ${t}`, (t) => t);
    n.start();
    const line = stub({ stalled: true });
    // Stuck for 100 mm of finger, then it grows: nothing said.
    for (let x = 0; x <= 100; x += 10) expect(n.moved(line, { x, z: 0 }, 0)).toBe(null);
    const grown = stub({ pieces: [{}] });
    expect(n.moved(grown, { x: 110, z: 0 }, 0)).toBe(null);
    // Stuck again for long enough: said, once.
    const said: (string | null)[] = [];
    for (let x = 120; x <= 600; x += 10) said.push(n.moved(line, { x, z: 0 }, 0));
    expect(said.filter((s) => s !== null)).toEqual([TOO_SHARP]);
    // Lifted (said already): not again.
    expect(n.lifted(stub({ leftBehind: true }), 0)).toBe(null);
    // A new stroke, lifted stuck before it was said: said at the lift.
    n.start();
    expect(n.moved(line, { x: 0, z: 0 }, 0)).toBe(null);
    expect(n.lifted(stub({ leftBehind: true }), 0)).toBe(TOO_SHARP);
    // Closed, nothing to say.
    expect(n.lifted(stub({ stopped: "closed" }), 4)).toBe(null);
  });

  it("(a) a dead-straight stroke from Larkfield's free end to Elderwick: four straights, closed, nothing said", () => {
    for (const step of [4, 8, 16, 32])
      for (const over of [0, 40, 150]) {
        const w = createWorld(7, true);
        const g = gameStock(w);
        const { line, toasts, lift } = drawStroke(LARKFIELD_EAST, drawOptions(w, g), along(-432, 108, 432 + over, 108, step), g);
        expect(line.stopped, `${step} ${over}`).toBe("closed");
        expect(line.pieces.map((p) => p.type)).toEqual(["straight-216", "straight-216", "straight-216", "straight-216"]);
        expect([...toasts, lift].filter(Boolean), `${step} ${over}`).toEqual([]);
      }
  });

  it("(b) Game mode, ramps not learned: a flat line into the sawmill (3 long straights, 2 curves) says nothing of ramps", () => {
    const w = createWorld(7, true);
    const g = gameStock(w);
    expect(g.stock("ramp")).toBe(0);
    // West from Larkfield, then a quarter turn of radius 180 south onto the sawmill's north end (-1476, -72).
    const pts = along(-648, 108, -1296, 108);
    for (let a = 0.04; a <= Math.PI / 2; a += 0.04) pts.push({ x: -1296 - 180 * Math.sin(a), z: -72 + 180 * Math.cos(a) });
    pts.push(...along(-1476, -72, -1476, -120));
    const { line, toasts, lift } = drawStroke(LARKFIELD_WEST, drawOptions(w, g), pts, g);
    expect(line.stopped).toBe("closed");
    expect(line.pieces.map((p) => p.type)).toEqual(["straight-216", "straight-216", "straight-216", "curve-large", "curve-large"]);
    expect(line.refused).toBe(null);
    expect([...toasts, lift].filter(Boolean)).toEqual([]);
  });

  it("(d) Game mode, ramps not learned: strokes west along the gap between the hills to the sawmill say nothing of ramps", () => {
    for (const dz of [-12, -6, 0, 6, 12])
      for (const to of [-1300, -1400]) {
        const w = createWorld(7, true);
        const g = gameStock(w);
        const { line, toasts, lift } = drawStroke(LARKFIELD_WEST, drawOptions(w, g), along(-648, 108, to, 108 + dz), g);
        expect(line.refused, `${dz} ${to}`).toBe(null);
        expect([...toasts, lift].filter((s) => s && /amp/.test(s)), `${dz} ${to}`).toEqual([]);
        expect(line.pieces.some((p) => p.blocked)).toBe(false);
      }
  });

  it("(c) Sandbox: a one-stroke U-turn on the tight curve's radius lays tight curves; tighter than any curve, it says so", () => {
    const uTurn = (r: number, lead: number) => {
      const w = createWorld(7, true);
      const x0 = -200;
      const z0 = -300;
      const pts = along(x0, z0, x0 + lead, z0, 6);
      for (let a = 6 / r; a <= Math.PI; a += 6 / r) pts.push({ x: x0 + lead + r * Math.sin(a), z: z0 + r - r * Math.cos(a) });
      pts.push(...along(x0 + lead, z0 + 2 * r, x0 + lead - 100, z0 + 2 * r, 6));
      return drawStroke({ x: x0, z: z0, heading: 0, y: 0, kind: "peg" }, drawOptions(w, null), pts, null);
    };
    for (const lead of [0, 60]) {
      const { line, toasts, lift } = uTurn(90, lead);
      expect(line.pieces.filter((p) => p.type === "curve-small").length, `lead ${lead}`).toBe(4);
      expect(line.end.heading).toBeCloseTo(Math.PI);
      expect([...toasts, lift].filter(Boolean)).toEqual([]);
    }
    for (const lead of [0, 60, 200]) {
      const { line, toasts, lift } = uTurn(70, lead);
      expect([...toasts, lift].filter(Boolean), `r 70, lead ${lead}: ${line.pieces.map((p) => p.type).join(" ")}`).toEqual([TOO_SHARP]);
    }
  });
});
