import { describe, expect, it } from "vitest";
import { getPieceDef, PIECE_TYPES, type PieceDef } from "./pieces";
import { doubleTrack, junction, leverPoints, masksFoul, offersChoice, overlaps, pathsFoul } from "./points";

const def = (t: Parameters<typeof getPieceDef>[0], flipped = false): PieceDef => getPieceDef(t, flipped);

describe("points: one definition of what counts as points", () => {
  it("plain track is nothing", () => {
    const d = def("straight-216");
    expect(leverPoints(d)).toBe(false);
    expect(offersChoice(d)).toBe(false);
    expect(junction(d)).toBe(false);
    expect(doubleTrack(d)).toBe(false);
    expect(overlaps(d)).toEqual([0]);
  });

  it("a switch: lever points, a choice, a junction; its two roads foul by the stem", () => {
    const d = def("switch");
    expect(leverPoints(d)).toBe(true);
    expect(offersChoice(d)).toBe(true);
    expect(junction(d)).toBe(true);
    expect(doubleTrack(d)).toBe(false);
    expect(pathsFoul(d, 0, 1)).toBe(true);
  });

  it("a diamond crossing: no choice, but a junction: its two lines foul where they cross", () => {
    const d = def("crossing");
    expect(leverPoints(d)).toBe(false);
    expect(offersChoice(d)).toBe(false);
    expect(junction(d)).toBe(true);
    expect(pathsFoul(d, 0, 1)).toBe(true);
  });

  it("double track: two roads that never meet, neither a choice nor a junction", () => {
    for (const t of ["double-straight", "double-curve"] as const) {
      const d = def(t);
      expect(doubleTrack(d), t).toBe(true);
      expect(junction(d), t).toBe(false);
      expect(offersChoice(d), t).toBe(false);
      expect(pathsFoul(d, 0, 1), t).toBe(false);
      expect(masksFoul(d, 0b01, 0b10), t).toBe(false);
      expect(masksFoul(d, 0b01, 0b01), t).toBe(true);
    }
  });

  it("a crossover: its two straights don't foul each other, but each fouls the diagonals", () => {
    const d = def("crossover");
    expect(leverPoints(d)).toBe(true);
    expect(junction(d)).toBe(true);
    // (Find the two paths that share no end: the straights.)
    const shareEnd = (i: number, j: number) => {
      const a = d.paths[i];
      const b = d.paths[j];
      return a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to;
    };
    let apart = 0;
    for (let i = 0; i < d.paths.length; i++)
      for (let j = i + 1; j < d.paths.length; j++)
        if (!pathsFoul(d, i, j)) {
          apart++;
          expect(shareEnd(i, j)).toBe(false);
        }
    expect(apart).toBeGreaterThan(0);
  });

  it("overlaps are symmetric and never include the path itself", () => {
    for (const t of PIECE_TYPES)
      for (const flipped of [false, true]) {
        const d = def(t, flipped);
        const o = overlaps(d);
        for (let i = 0; i < o.length; i++) {
          expect((o[i] >> i) & 1, `${t} ${i}`).toBe(0);
          for (let j = 0; j < o.length; j++) expect((o[i] >> j) & 1, `${t} ${i},${j}`).toBe((o[j] >> i) & 1);
        }
      }
  });

  it("a deck or a lift is had whole: any two paths foul, with no overlaps listed", () => {
    for (const t of PIECE_TYPES) {
      const d = def(t);
      if (!d.gated && !d.lift) continue;
      expect(overlaps(d).every((m) => m === 0), t).toBe(true);
      if (d.paths.length > 1) expect(pathsFoul(d, 0, 1), t).toBe(true);
    }
  });

  it("a choice of way is a switch, a deck, or an end with two paths (sections' old `branches`)", () => {
    for (const t of PIECE_TYPES)
      for (const flipped of [false, true]) {
        const d = def(t, flipped);
        let old = d.isSwitch || !!d.gated;
        for (let c = 0; c < d.connectors.length; c++) {
          let n = 0;
          for (const pa of d.paths) if (pa.from === c || pa.to === c) n++;
          if (n > 1) old = true;
        }
        expect(offersChoice(d), t).toBe(old);
      }
  });
});
