import { describe, expect, it } from "vitest";
import { Sim } from "../sim";
import { connectorRef, Layout } from "../track";
import { Editor } from "./editor";

/** As the game sets the editor up (main.ts): stations fixed. */
function hazelwick() {
  const layout = new Layout();
  const sim = new Sim(layout);
  const home = { x: 792, z: 36, heading: 0 };
  const station = layout.addPiece("station", home);
  // Player's track coming in from the east: a straight-144 ending at (1080, 31), 5 mm off the station's end line,
  // joined to more loose track beyond.
  const a = layout.addPiece("straight-144", { x: 1080, z: 31, heading: 0 });
  const b = layout.addPiece("straight-216", { x: 1224, z: 31, heading: 0 });
  const c = layout.addPiece("straight-216", { x: 1440, z: 31, heading: 0 });
  const editor = new Editor(layout, sim, () => {}, (id) => id === station);
  return { layout, sim, editor, station, home, a, b, c };
}

describe("stations never move", () => {
  it("closing a 5 mm-misaligned gap into a station end bends the drawn track, not the station (QA: Hazelwick)", () => {
    const { layout, editor, station, home, a } = hazelwick();
    // The closer: a straight-72 drawn from (1080, 31) west into the station's east end at (1008, 36).
    const [closer] = editor.placeRun([{ type: "straight-72", pose: { x: 1008, z: 31, heading: 0 }, y: 0, flipped: false }]);
    expect(layout.joinedConnector(connectorRef(closer, 1))).toBe(connectorRef(a, 0));
    expect(layout.joinedConnector(connectorRef(closer, 0))).toBe(connectorRef(station, 1));
    expect(layout.getPiece(station)!.pose).toEqual(home);
    // The loose track took it up: no joint left gaping.
    for (const j of layout.joints()) expect(j.posError).toBeLessThan(4.5);
    // Undo and redo leave it home too.
    editor.undo();
    expect(layout.getPiece(station)!.pose).toEqual(home);
    editor.redo();
    expect(layout.getPiece(station)!.pose).toEqual(home);
  });

  it("a station never shifts for track closing on it 30 mm short: the gap stays open", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const home = { x: 216 * 3 + 30, z: 0, heading: 0 };
    const station = layout.addPiece("station", home);
    const start = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const editor = new Editor(layout, sim, () => {}, (id) => id === start || id === station);
    editor.place("straight-216", { x: 216, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-216", { x: 432, z: 0, heading: 0 }, 0, false);
    expect(layout.getPiece(station)!.pose).toEqual(home);
    expect(layout.joinedConnector(connectorRef(b, 1))).toBe(-1);
  });
});

/** The closer's end: 6 mm short of the station's end and 4 mm to the side (within joint play). */
const GAP = 6;
const OFF = 4;

describe("a station's other end after track closed on it (QA: Millbrook)", () => {
  it("drawing or placing on from the station's other free end isn't refused as 'The station is in the way'", async () => {
    const { createWorld } = await import("../game/world");
    const { trackPlacement } = await import("../game/track-rules");
    const world = createWorld(7, true);
    const { layout, sim, landscape } = world;
    // (Plus a piece standing in for the rest of a loop that can't give: the run's far end.)
    const held = new Set<number>();
    const fixed = (id: number) => held.has(id) || [...world.stations.values(), ...world.depots.values(), ...world.ruins.values()].includes(id);
    const editor = new Editor(layout, sim, () => {}, fixed);
    const rules = { land: landscape, layout, props: null, footprint: () => undefined };
    for (const town of landscape.towns) {
      const station = world.stations.get(town.id)!;
      const home = { ...layout.getPiece(station)!.pose };
      const c = Math.cos(home.heading);
      const s = Math.sin(home.heading);
      const at = (along: number, side: number, h = home.heading) => ({ x: home.x + c * along - s * side, z: home.z + s * along + c * side, heading: h });
      const westPiece = { pose: at(-216, 0), y: 0 };
      const before = trackPlacement(rules, "straight-216", false, westPiece.pose, westPiece.y, -1).reason;
      // Loose track 5 mm off the east end's line, closed onto it with a straight-72.
      layout.addPiece("straight-144", at(216 + GAP + 72, OFF));
      held.add(layout.addPiece("straight-216", at(216 + GAP + 72 + 144, OFF)));
      const [closer] = editor.placeRun([{ type: "straight-72", pose: at(216 + GAP, OFF), y: 0, flipped: false }]);
      expect(layout.joinedConnector(connectorRef(closer, 0)), town.name).toBe(connectorRef(station, 1));
      expect(layout.getPiece(station)!.pose, town.name).toEqual(home);
      // From where the station's west end is now.
      const now = layout.getPiece(station)!.pose;
      const from = { x: now.x - Math.cos(now.heading) * 216, z: now.z - Math.sin(now.heading) * 216, heading: now.heading };
      const after = trackPlacement(rules, "straight-216", false, from, 0, -1).reason;
      expect(after, town.name).not.toBe("station");
      expect(after, town.name).toBe(before);
    }
  });
});
