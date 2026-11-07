import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout } from "../track";
import { walkOn } from "./graph";

describe("walkOn: piece by piece while the way has no choice", () => {
  const layout = new Layout();
  const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  const b = appendPiece(layout, "straight-216", false, connectorRef(a, 1));
  const sw = appendPiece(layout, "switch", false, connectorRef(b, 1));
  const c = appendPiece(layout, "straight-216", false, connectorRef(sw, 1));
  const buf = appendPiece(layout, "buffer", false, connectorRef(c, 1));

  it("visits each piece and ends at a choice of way, after visiting it", () => {
    const seen: number[] = [];
    expect(walkOn(layout, a, 1, (p) => void seen.push(p))).toBe("choice");
    expect(seen).toEqual([b, sw]);
  });

  it("from a trailing end it goes on through the points, to the end of the track", () => {
    const seen: number[] = [];
    expect(walkOn(layout, c, 0, (p) => void seen.push(p))).toBe("end");
    expect(seen).toEqual([sw, b, a]);
    // (An open end at once: nothing visited.)
    expect(walkOn(layout, a, 0, () => {})).toBe("end");
  });

  it("a buffer's piece is visited, then the end", () => {
    const seen: number[] = [];
    expect(walkOn(layout, sw, 1, (p) => void seen.push(p))).toBe("end");
    expect(seen).toEqual([c, buf]);
  });

  it("stops where the visitor says, or after `max` pieces", () => {
    expect(walkOn(layout, a, 1, (p) => p !== b)).toBe("stopped");
    expect(walkOn(layout, c, 0, () => {}, 2)).toBe("far");
  });
});
