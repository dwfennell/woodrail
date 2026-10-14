import { describe, expect, it } from "vitest";
import { layoutLines, type Station } from "./blueprint-board";

const st = (id: string, needs: string[] = []): Station => ({ id, label: id, blurb: "", makes: [], state: "locked", needs });

describe("the blueprint line map", () => {
  it("puts each first blueprint on its own line, and those that need one along or branching off it", () => {
    const placed = layoutLines([st("switches"), st("bridges"), st("loops", ["switches"]), st("junctions", ["switches"]), st("hoppers", ["junctions"])]);
    const at = Object.fromEntries(placed.map((p) => [p.station.id, [p.col, p.row]]));
    // Switches' line: switches, then loops along it; junctions branches below, hoppers on after it.
    expect(at.switches).toEqual([1, 0]);
    expect(at.loops).toEqual([2, 0]);
    expect(at.junctions).toEqual([2, 1]);
    expect(at.hoppers).toEqual([3, 1]);
    // Bridges gets the next line down.
    expect(at.bridges).toEqual([1, 2]);
    // No two stations share a place.
    expect(new Set(placed.map((p) => `${p.col},${p.row}`)).size).toBe(placed.length);
  });
});
