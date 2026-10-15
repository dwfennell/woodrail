import { describe, expect, it } from "vitest";
import { TRACK_WIDTH } from "../track";
import { generateLandscape, STATION_LENGTH } from "./generate";
import { SIGN_HEIGHT, SIGN_THICKNESS, SIGN_WIDTH, SIGN_Y, signPose, STATION_ROOF_TOP } from "./sign";

describe("signPose", () => {
  it("keeps the name board on the platform, clear of the station track, on every map", () => {
    // Forty maps spread over two hundred seeds, and the starter map (every map was too slow for the suite's time limit).
    const lands = [generateLandscape(7, { starter: true })];
    for (let seed = 1; seed <= 200; seed += 5) lands.push(generateLandscape(seed));
    for (const land of lands) {
      for (const town of land.towns) {
        const s = signPose(town);
        const dx = Math.cos(town.station.heading);
        const dz = Math.sin(town.station.heading);
        for (const a of [-SIGN_WIDTH / 2, SIGN_WIDTH / 2]) {
          for (const b of [-SIGN_THICKNESS / 2, SIGN_THICKNESS / 2]) {
            // Board corner in world space (the board runs along the track).
            const wx = s.x + dx * a - dz * b;
            const wz = s.z + dz * a + dx * b;
            const px = wx - town.centre.x;
            const pz = wz - town.centre.z;
            const along = px * dx + pz * dz;
            const lateral = -px * dz + pz * dx;
            expect(Math.abs(along), `seed ${land.seed} ${town.name}`).toBeLessThan(STATION_LENGTH / 2 - 2);
            expect(lateral).toBeGreaterThan(TRACK_WIDTH / 2 + 4);
            expect(lateral).toBeLessThan(118);
          }
        }
      }
    }
  });

  it("stands on the station house roof, above the canopy, where a camera looking down can read it", () => {
    expect(SIGN_Y - SIGN_HEIGHT / 2).toBeGreaterThan(STATION_ROOF_TOP + 4);
    // Big enough to read at a normal play distance: at least as wide as the station house.
    expect(SIGN_WIDTH).toBeGreaterThanOrEqual(110);
    expect(SIGN_HEIGHT).toBeGreaterThanOrEqual(28);
  });
});
