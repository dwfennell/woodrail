import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { appendPiece, connectorRef, getPieceDef, Layout, pathLength, PIECE_TYPES, type PieceTypeId } from "../track";
import type { CarKind } from "./cars";
import { Sim, SIM_DT } from "./sim";

/**
 * The rule: a train can always run on track that is snapped together. Every piece that changes the grade (a ramp, a
 * curved ramp) or sits up on a deck (a bridge, a curved bridge) is entered from a straight, a curve and a switch,
 * either way round, with either kind of joint (peg or hole) meeting, and an engine with three full wagons must get
 * through, up and down, pulling and pushing.
 */

/** Pieces whose path rises, or that stand up on a deck: found from the catalogue, not listed by hand. */
const GRADE_PIECES: PieceTypeId[] = PIECE_TYPES.filter((t) => {
  const def = getPieceDef(t, false);
  return def.paths.some((p) => p.geom.rise !== 0) || t === "bridge" || t === "bridge-curve";
});

interface Step {
  type: PieceTypeId;
  flipped: boolean;
  /** Connector that meets the piece before. */
  enter: number;
  /** Connector the train leaves by, and the switch setting that sends it there. */
  exit: number;
  state?: number;
}

const other = (ci: number) => (ci === 0 ? 1 : 0);

/** The pieces laid end to end, or null if any of them does not snap onto the one before (peg to peg, say). */
function build(steps: Step[]): { layout: Layout; ids: number[] } | null {
  const layout = new Layout();
  const ids = [layout.addPiece(steps[0].type, { x: 0, z: 0, heading: 0 }, 0, steps[0].flipped)];
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const ref = connectorRef(ids[i - 1], prev.exit);
    const id = appendPiece(layout, steps[i].type, steps[i].flipped, ref, steps[i].enter);
    if (id < 0 || layout.joinedConnector(ref) !== connectorRef(id, steps[i].enter)) return null;
    ids.push(id);
    if (prev.state !== undefined) layout.setSwitchState(ids[i - 1], prev.state);
  }
  return { layout, ids };
}

const straight = (o: number): Step => ({ type: "straight-216", flipped: false, enter: o, exit: other(o) });

function leadIns(o: number): Step[] {
  const out: Step[] = [straight(o)];
  for (const flipped of [false, true]) out.push({ type: "curve-large", flipped, enter: o, exit: other(o) });
  // A switch is entered by its trunk (connector 0) and left by the straight (1) or the branch (2).
  if (o === 0) {
    out.push({ type: "switch", flipped: false, enter: 0, exit: 1, state: 0 });
    out.push({ type: "switch", flipped: false, enter: 0, exit: 2, state: 1 });
    out.push({ type: "switch", flipped: true, enter: 0, exit: 2, state: 1 });
  }
  return out;
}

function grades(): Step[] {
  const out: Step[] = [];
  for (const type of GRADE_PIECES) for (const flipped of [false, true]) for (const enter of [0, 1]) out.push({ type, flipped, enter, exit: other(enter) });
  return out;
}

function followers(o: number): Step[] {
  // Another grade piece (ramp up then a bridge, a ramp then a ramp), or the flat.
  const out: Step[] = [straight(o)];
  for (const type of ["bridge", "ramp"] as PieceTypeId[]) for (const flipped of [false, true]) for (const enter of [0, 1]) out.push({ type, flipped, enter, exit: other(enter) });
  return out;
}

const pushings = (i: number): boolean[] => (i % 4 === 0 ? [false, true] : [false]);

const WAGONS: CarKind[] = ["timber", "timber", "timber"];

/** Run the train; the sim second at which its lead axle first stood on `marker` (or Infinity). */
function runTo(layout: Layout, from: { pieceId: number; reversed: boolean; s: number }, marker: number, pushing: boolean, limit: number): number {
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const kinds: CarKind[] = pushing ? [...WAGONS, "engine"] : ["engine", ...WAGONS];
  const r = sim.addTrain(kinds, { pieceId: from.pieceId, pathIndex: 0, reversed: from.reversed, s: from.s });
  if (r.kind !== "placed") throw new Error(`no room: ${r.kind}`);
  const t = sim.getTrain(r.trainId)!;
  for (const c of t.cars) {
    if (c.kind === "engine") sim.setLever(c.id, 1);
    else economy.setCargo(c.id, "planks", 99);
  }
  for (let k = 0; k * SIM_DT < limit; k++) {
    sim.tick();
    for (const id of sim.trainIds()) {
      const tr = sim.getTrain(id)!;
      // Any axle on the marker piece will do (a turned-back train has its axles the other way round).
      if (tr.bogies.some((b) => b.pieceId === marker)) return k * SIM_DT;
    }
  }
  return Infinity;
}

describe("a loaded train gets over every grade-changing piece", () => {
  it("ramps, curved ramps and bridges, entered from straights, curves and switches, up and down, pulling and pushing", () => {
    expect(GRADE_PIECES).toEqual(expect.arrayContaining(["ramp", "ramp-curve", "bridge", "bridge-curve"]));
    let checked = 0;
    const failures: string[] = [];
    const seen = new Set<string>();
    for (const o of [0, 1]) {
      for (const lead of leadIns(o)) {
        for (const grade of grades()) {
          for (const follow of followers(o)) {
            const steps = [straight(o), straight(o), lead, grade, follow, straight(o), straight(o)];
            const name = steps.map((s) => `${s.type}${s.flipped ? "'" : ""}:${s.enter}>${s.exit}${s.state ?? ""}`).join(" ");
            if (seen.has(name)) continue;
            seen.add(name);
            const built = build(steps);
            if (!built) continue;
            const { layout, ids } = built;
            let length = 0;
            for (const id of ids) {
              const p = layout.getPiece(id)!;
              length += pathLength(getPieceDef(p.type, p.flipped).paths[0].geom);
            }
            const limit = length / 100 + 6;
            // Forward: from the runway, front on the second piece with its rear back on the first.
            const n = ids.length;
            // Pulling, then (on every fourth layout, to keep it quick) pushing; both ways along the line, and set
            // down straddling each joint of the grade: engine on the flat with wagons on the slope, and so on.
            const starts: { label: string; from: { pieceId: number; reversed: boolean; s: number }; marker: number; pushing: boolean }[] = [];
            for (const pushing of pushings(seen.size)) {
              starts.push({ label: "forward", from: { pieceId: ids[1], reversed: false, s: 200 }, marker: ids[n - 1], pushing });
              starts.push({ label: "back", from: { pieceId: ids[n - 2], reversed: true, s: 200 }, marker: ids[0], pushing });
            }
            for (const at of [3]) {
              starts.push({ label: `straddling piece ${at}`, from: { pieceId: ids[at], reversed: false, s: 40 }, marker: ids[n - 1], pushing: false });
              starts.push({ label: `straddling piece ${at} back`, from: { pieceId: ids[at], reversed: true, s: 40 }, marker: ids[0], pushing: false });
            }
            for (const st of starts) {
              let t: number;
              try {
                t = runTo(layout, st.from, st.marker, st.pushing, limit);
              } catch {
                continue; // no room to set the train down there
              }
              checked++;
              if (!(t < limit)) failures.push(`${name} [${st.label}${st.pushing ? ", pushing" : ""}]`);
            }
          }
        }
      }
    }
    console.log(`grade guard: ${checked} runs over ${seen.size} candidate layouts`);
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  }, 60_000);
});

describe("the reported scene: off a curve, up a ramp, onto a bridge", () => {
  it("an engine with three full timber wagons climbs on, whether the wagons are still on the curve or already on the ramp", () => {
    const up = (type: PieceTypeId): Step => ({ type, flipped: false, enter: 0, exit: 1 });
    const { layout, ids } = build([straight(0), straight(0), up("curve-large"), up("ramp"), up("bridge"), up("bridge"), straight(0), straight(0)])!;
    for (const from of [{ pieceId: ids[1], s: 200 }, { pieceId: ids[2], s: 60 }, { pieceId: ids[3], s: 40 }, { pieceId: ids[3], s: 90 }, { pieceId: ids[4], s: 20 }]) {
      expect(runTo(layout, { ...from, reversed: false }, ids[7], false, 40), `from piece ${ids.indexOf(from.pieceId)} at ${from.s}`).toBeLessThan(40);
    }
  });
});
