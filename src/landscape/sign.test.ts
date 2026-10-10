import { describe, expect, it } from "vitest";
import { TRACK_WIDTH } from "../track";
import { generateLandscape, STATION_LENGTH } from "./generate";
import { SIGN_THICKNESS, SIGN_WIDTH, signPose } from "./sign";

describe("signPose", () => {
  it("keeps the name board on the platform, clear of the station track, on every map", () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const town of generateLandscape(seed).towns) {
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
            expect(Math.abs(along), `seed ${seed} ${town.name}`).toBeLessThan(STATION_LENGTH / 2 - 2);
            expect(lateral).toBeGreaterThan(TRACK_WIDTH / 2 + 4);
            expect(lateral).toBeLessThan(118);
          }
        }
      }
    }
  });
});
