import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, POINTS_CLEAR_S } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { Economy } from "../economy/economy";
import { chain, train, type World } from "../economy/loop-fixtures";

const S: PieceTypeId = "straight-216";

/**
 * A train following another into facing points waits short of them till they've been clear `POINTS_CLEAR_S`, so the
 * player can throw the lever between the two and send them different ways (the user, 2026-11-05).
 *
 *   ⊐ ══ ══ ══ ══ ══ (points) ══ ══ ══ ⊏   (straight road)
 *                          ⌒ ══ ══ ══ ⊏   (curved road)
 */
function world() {
  const layout = new Layout();
  const trunk = chain(layout, Array<PieceTypeId>(6).fill(S));
  appendPiece(layout, "buffer-turnback", false, connectorRef(trunk[0], 0), 0);
  const sw = appendPiece(layout, "switch", false, connectorRef(trunk[5], 1), 0);
  const straight = chain(layout, [S, S, S, S], connectorRef(sw, 1));
  appendPiece(layout, "buffer-turnback", false, connectorRef(straight[3], 1));
  const curved = chain(layout, ["curve-large", S, S, S], connectorRef(sw, 2), [true]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(curved[3], 1));
  const w = { layout } as World;
  w.sim = new Sim(layout);
  w.economy = new Economy(layout, w.sim);
  return { w, sw, trunk, straight: new Set(straight), curved: new Set(curved) };
}

const step = (w: World) => {
  w.sim.tick();
  w.economy.tick();
};
/** Two trains on the trunk, the second come up close behind the first (standing), then both off toward the points. */
function closeBehind(w: World, trunk: readonly number[]) {
  const lead = train(w, trunk[4], false, ["engine", "timber"], 100);
  const follow = train(w, trunk[1], false, ["engine", "timber"], 100);
  w.sim.setLever(lead, 0);
  for (let i = 0; i < 10 * SIM_HZ; i++) step(w);
  const gap = w.sim.getTrain(w.sim.findCar(follow)!.train.id)!;
  expect(gap.speed).toBeLessThan(1);
  w.sim.setLever(lead, 1);
  return { lead, follow };
}

const onPiece = (w: World, engine: number, pieces: ReadonlySet<number>) => w.sim.findCar(engine)!.train.bogies.some((b) => pieces.has(b.pieceId));

describe("a train following another into facing points waits till they're clear (points-gap)", () => {
  it("stands short of the points while the one ahead is on them, and a lever thrown in the gap sends it the other way", () => {
    const { w, sw, trunk, straight, curved } = world();
    const { lead, follow } = closeBehind(w, trunk);
    const points = new Set([sw]);
    // (Till the one ahead is off the points: the follower never comes onto them.)
    let k = 0;
    for (; k < 30 * SIM_HZ && !onPiece(w, lead, straight); k++) step(w);
    for (; k < 30 * SIM_HZ && onPiece(w, lead, points); k++) {
      step(w);
      expect(onPiece(w, follow, points)).toBe(false);
    }
    expect(onPiece(w, lead, points)).toBe(false);
    // (Just clear: the follower is still short of them, standing or nearly, for the gap.)
    expect(onPiece(w, follow, points)).toBe(false);
    const r = w.economy.router.lever(sw);
    expect("refused" in r ? r.refused : undefined).toBeUndefined();
    for (let i = 0; i < Math.floor(POINTS_CLEAR_S * SIM_HZ) - 2; i++) {
      step(w);
      expect(onPiece(w, follow, points)).toBe(false);
    }
    for (let i = 0; i < 20 * SIM_HZ && !onPiece(w, follow, curved); i++) step(w);
    expect(onPiece(w, follow, curved)).toBe(true);
    expect(onPiece(w, lead, straight)).toBe(true);
  });

  it("with no lever thrown, it follows the same way once the gap has passed", () => {
    const { w, sw, trunk, straight } = world();
    const { lead, follow } = closeBehind(w, trunk);
    for (let i = 0; i < 30 * SIM_HZ && !onPiece(w, follow, straight); i++) step(w);
    expect(onPiece(w, follow, straight)).toBe(true);
    expect(onPiece(w, lead, straight)).toBe(true);
    expect(sw).toBeGreaterThanOrEqual(0);
  });
});
