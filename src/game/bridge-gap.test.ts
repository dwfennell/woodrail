import { describe, expect, it } from "vitest";
import { archFloors, bridgeLevels, gridWithPlots, type Landscape } from "../landscape";
import { ARCH_CENTRES, ARCH_RADIUS, BRIDGE_LENGTH, Layout, RISER_HEIGHT } from "../track";
import { trackBlock, type TrackRules } from "./track-rules";

/**
 * A bridge over a one-square gap in a hill ridge, track on the ground through the gap (the user's report, 2026-11-01:
 * the bridge stood two levels up, as it must over track, and the arch over the gap was drawn stopping at the
 * hilltops: the track under it ran into a solid wall). Wherever the track rules let the bridge go over that track, the
 * arch the track passes under is drawn open all the way down to it.
 */
function ridgeWithGap(): Landscape {
  const land: Landscape = { seed: 0, starter: false, grid: gridWithPlots(-1, -1, 2, 2), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
  const g = land.grid;
  // One level up along z = 0..72, but for the square at x = 72..144.
  for (let x = -432 + 36; x < 648; x += 72) if (x < 72 || x > 144) g.height[g.cellAtWorld(x, 36)] = 1;
  return land;
}

describe("a bridge over a gap in a hill ridge, track under it", () => {
  it("the arch over the track is open down to it, wherever the rules let the bridge go", () => {
    const land = ridgeWithGap();
    const layout = new Layout();
    // A straight on the ground through the gap, across the ridge.
    layout.addPiece("straight-216", { x: 108, z: 36 - 108, heading: Math.PI / 2 }, 0);
    const rules: TrackRules = { land, layout, props: null, footprint: () => undefined };
    const y = 2 * RISER_HEIGHT;
    let allowed = 0;
    // Every quarter-square start (as a held piece lands) from which the bridge spans the gap, both ways round.
    for (let s = -216; s <= 216; s += 18) {
      for (const heading of [0, Math.PI]) {
        const x = heading === 0 ? s : s + BRIDGE_LENGTH;
        const pose = { x, z: 36, heading };
        // (Only those with the track under the viaduct: along the deck from its start to the track. The rules leave a
        // viaduct's last 20 mm at each end open, for the joint's play: a bridge whose end stands over the track is left
        // out here.)
        const along = heading === 0 ? 108 - x : x - 108;
        if (along < 20 || along > BRIDGE_LENGTH - 20) continue;
        if (trackBlock(rules, "bridge", false, pose, y, -1) !== null) continue;
        allowed++;
        const levels = bridgeLevels(land, "bridge", false, pose, y);
        expect(levels).toBe(2);
        const floors = archFloors(land, "bridge", false, pose, y, levels);
        // The arch the track (at x = 108) passes under.
        const k = ARCH_CENTRES.findIndex((c) => Math.abs(along - c * BRIDGE_LENGTH) <= ARCH_RADIUS * BRIDGE_LENGTH);
        expect(k, `start ${x} heading ${heading}: the track under an opening`).not.toBe(-1);
        expect(floors?.[k] ?? levels, `start ${x} heading ${heading}: floors ${floors}`).toBe(levels);
      }
    }
    // The user's bridge goes over it from somewhere.
    expect(allowed).toBeGreaterThan(0);
  });

  it("one level up, level with the hilltops, it's too low for trains under it", () => {
    const land = ridgeWithGap();
    const layout = new Layout();
    layout.addPiece("straight-216", { x: 108, z: 36 - 108, heading: Math.PI / 2 }, 0);
    const rules: TrackRules = { land, layout, props: null, footprint: () => undefined };
    expect(trackBlock(rules, "bridge", false, { x: 108 - ARCH_CENTRES[1] * BRIDGE_LENGTH, z: 36, heading: 0 }, RISER_HEIGHT, -1)).toBe("headroom");
  });
});
