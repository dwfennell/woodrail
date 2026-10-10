import { describe, expect, it } from "vitest";
import { getPieceDef } from "../track";
import { checkPlacement, groundUnder } from "./clearance";
import { FEAT_BUILDING, FEAT_TREE, LandscapeGrid, MAT_WIDTH, SURF_RIVER, SURF_TOWN } from "./grid";
import { generateLandscape, stationEnds, type Landscape } from "./generate";

function flat(): Landscape {
  return { seed: 0, starter: false, grid: new LandscapeGrid(), towns: [], corridors: [] };
}
function setCells(land: Landscape, x0: number, x1: number, z0: number, z1: number, fn: (i: number) => void): void {
  const g = land.grid;
  for (let x = x0; x <= x1; x += 16) for (let z = z0; z <= z1; z += 16) {
    const i = g.cellAtWorld(x, z);
    if (i !== -1) fn(i);
  }
}
const P = (x: number, z: number, heading = 0) => ({ x, z, heading });

describe("checkPlacement", () => {
  it("allows a straight on flat grass", () => {
    expect(checkPlacement(flat(), "straight-216", false, P(0, 0), 0)).toEqual({ kind: "clear" });
  });

  it("blocks a straight across a river but not a bridge", () => {
    const land = flat();
    setCells(land, 96, 150, -100, 100, (i) => (land.grid.surface[i] = SURF_RIVER));
    expect(checkPlacement(land, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "blocked", reason: "river" });
    expect(checkPlacement(land, "bridge", false, P(0, 0), 0)).toEqual({ kind: "clear" });
  });

  it("track can sit on a hill top but not cut into it", () => {
    const land = flat();
    setCells(land, -200, 400, -100, 100, (i) => (land.grid.height[i] = 1));
    expect(checkPlacement(land, "straight-216", false, P(0, 0), 64)).toEqual({ kind: "clear" });
    expect(checkPlacement(land, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "blocked", reason: "hill" });
  });

  it("a ramp can climb onto a hill", () => {
    const land = flat();
    // hill begins where the ramp's high end rests
    setCells(land, 200, 600, -100, 100, (i) => (land.grid.height[i] = 1));
    expect(checkPlacement(land, "ramp", false, P(-20, 0), 0)).toEqual({ kind: "clear" });
  });

  it("blocks buildings, trees, town squares and the mat edge", () => {
    const land = flat();
    setCells(land, 60, 80, -10, 10, (i) => (land.grid.feature[i] = FEAT_BUILDING));
    expect(checkPlacement(land, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "blocked", reason: "building" });
    const t = flat();
    setCells(t, 60, 80, -10, 10, (i) => (t.grid.feature[i] = FEAT_TREE));
    expect(checkPlacement(t, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "blocked", reason: "tree" });
    const town = flat();
    setCells(town, 60, 80, -10, 10, (i) => (town.grid.surface[i] = SURF_TOWN));
    expect(checkPlacement(town, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "blocked", reason: "town" });
    expect(checkPlacement(flat(), "straight-216", false, P(MAT_WIDTH / 2 - 100, 0), 0)).toEqual({ kind: "blocked", reason: "off-mat" });
  });

  it("a straight seated on a station end is clear", () => {
    const land = generateLandscape(7, { starter: true });
    const [, peg] = stationEnds(land.towns[0]);
    expect(checkPlacement(land, "straight-216", false, P(peg.x, peg.z, peg.heading), 0)).toEqual({ kind: "clear" });
    const [socket] = stationEnds(land.towns[0]);
    const def = getPieceDef("straight-144", false);
    // attach by its peg to the station socket: origin is 144 mm back along the outward heading... facing inward
    const h = socket.heading + Math.PI;
    const origin = P(socket.x - Math.cos(h) * def.connectors[1].pose.x, socket.z - Math.sin(h) * def.connectors[1].pose.x, h);
    expect(checkPlacement(land, "straight-144", false, origin, 0)).toEqual({ kind: "clear" });
  });
});

describe("groundUnder", () => {
  it("is the highest ground beneath the piece", () => {
    const land = flat();
    setCells(land, -50, 300, -100, 100, (i) => (land.grid.height[i] = 2));
    expect(groundUnder(land, "straight-216", false, P(0, 0))).toBe(128);
    expect(groundUnder(flat(), "straight-216", false, P(0, 0))).toBe(0);
  });
});

describe("station ends across many maps", () => {
  const seat = (end: { x: number; z: number; heading: number }, peg: boolean) =>
    // On the peg end a piece seats by its socket (origin at the end); on the socket end by its peg (origin 54 mm back).
    peg ? P(end.x, end.z, end.heading) : P(end.x + Math.cos(end.heading) * 54, end.z + Math.sin(end.heading) * 54, end.heading + Math.PI);

  it.each(Array.from({ length: 200 }, (_, i) => i + 1))("seed %i: a short straight seats on both ends of every station", (seed) => {
    const land = generateLandscape(seed);
    for (const town of land.towns) {
      const [socketEnd, pegEnd] = stationEnds(town);
      expect(checkPlacement(land, "straight-54", false, seat(pegEnd, true), 0), `${town.name} peg end`).toEqual({ kind: "clear" });
      expect(checkPlacement(land, "straight-54", false, seat(socketEnd, false), 0), `${town.name} socket end`).toEqual({ kind: "clear" });
    }
  });
});
