import { describe, expect, it } from "vitest";
import { inStationFootprint } from "./depot-view";

describe("station tap footprint", () => {
  const pose = { x: 1000, z: 500, heading: 0 };
  it("counts the far end of the platform and the station house, not just the crane", () => {
    expect(inStationFootprint(pose, 1000 + 200, 500 + 30, 0)).toBe(true); // far platform end
    expect(inStationFootprint(pose, 1000 + 108, 500 + 70, 0)).toBe(true); // station house
    expect(inStationFootprint(pose, 1000 + 108, 500 - 10, 0)).toBe(true); // canopy over the track
  });
  it("misses ground well clear, and grows by the fingertip margin", () => {
    expect(inStationFootprint(pose, 1000 + 108, 500 + 120, 0)).toBe(false);
    expect(inStationFootprint(pose, 1000 + 108, 500 + 120, 50)).toBe(true);
    expect(inStationFootprint(pose, 1000 + 300, 500, 40)).toBe(false);
  });
  it("follows the station's heading", () => {
    const turned = { x: 0, z: 0, heading: Math.PI / 2 }; // t runs along +z
    expect(inStationFootprint(turned, -30, 200, 0)).toBe(true);
    expect(inStationFootprint(turned, 200, 30, 0)).toBe(false);
  });
});
