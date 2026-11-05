import { describe, expect, it } from "vitest";
import { placeNear, type Place } from "./place-near";

describe("placeNear (which place a train on a card is 'by')", () => {
  // QA 2026-11-05 #2, as played: the oil well's stretch from x -90 to 126 at z -126; Elderwick's station from 432 to
  // 648 at z 108, across a field; the crane car standing at x 375 on the oil well's line, heading along x.
  const places: Place[] = [
    { name: "Elderwick", a: { x: 432, z: 108 }, b: { x: 648, z: 108 } },
    { name: "the oil well", a: { x: 126, z: -126 }, b: { x: -90, z: -126 } },
  ];

  it("names the stop on the train's own line before a town across the field", () => {
    expect(placeNear({ x: 375, z: -126 }, 0, places, 900)).toBe("the oil well");
    // (Running the other way along the same line: the same.)
    expect(placeNear({ x: 375, z: -126 }, Math.PI, places, 900)).toBe("the oil well");
  });

  it("names the town when the train is at its station, or on a line running past it", () => {
    expect(placeNear({ x: 540, z: 108 }, 0, places, 900)).toBe("Elderwick");
    expect(placeNear({ x: 540, z: -40 }, Math.PI / 2, places, 900)).toBe("Elderwick");
  });

  it("names nothing beyond reach, and passes over names too long for the card", () => {
    expect(placeNear({ x: 3000, z: 3000 }, 0, places, 900)).toBe("");
    expect(placeNear({ x: 375, z: -126 }, 0, places, 900, 10)).toBe("Elderwick");
  });
});
