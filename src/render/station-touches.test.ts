import { BoxGeometry, MeshBasicMaterial } from "three";
import { describe, expect, it, vi } from "vitest";

// The doll models come from Blender files the unit tests don't load: a box stands in.
vi.mock("./blender-models", () => ({ partPieces: () => [[new BoxGeometry(4, 18, 4), new MeshBasicMaterial()]] }));

const { StationTouchesView } = await import("./station-touches");

const town = { id: 1, name: "Elderwick", station: { x: 0, z: 0, heading: 0 }, upgraded: "kit-two-platform-station" } as never;
const mats = { naturalWood: new MeshBasicMaterial(), lacquer: () => new MeshBasicMaterial() } as never;

function view(calm = false) {
  const held: (number | null)[] = [];
  const v = new StationTouchesView(
    mats,
    {
      townAt: (pieceId) => (pieceId === 2 ? town : undefined),
      carPoint: () => ({ x: 100, y: 0, z: 0 }),
      trainPoint: () => ({ x: 100, y: 0, z: 0 }),
      waitingShown: () => 5,
      holdWaiting: (_t, from) => held.push(from),
    },
    () => calm,
  );
  return { v, held };
}
const run = (v: InstanceType<typeof StationTouchesView>, seconds: number) => {
  let moving = 0;
  for (let k = 0; k < seconds * 30; k++) if (v.update(1 / 30) === "moving") moving++;
  return moving;
};

describe("station touches (the view)", () => {
  it("a stop: the top of the queue leans toward the train, one hops on, one off; set off, all back in the batch", () => {
    const { v, held } = view();
    v.event("halted", 2, 1, 7);
    expect(v.state().visits[0].dolls).toHaveLength(4);
    expect(held).toEqual([1]);
    expect(run(v, 1)).toBeGreaterThan(0);
    expect(v.state().visits[0].dolls.every((d) => d.lean > 0.15)).toBe(true);
    // Still: no frames asked for.
    expect(v.update(1 / 30)).toBe("idle");
    v.event("off", 2, 1, 7);
    v.event("on", 2, 1, 7);
    const modes = v.state().visits[0].dolls.map((d) => d.mode);
    expect(modes).toContain("on");
    expect(modes).toContain("off");
    run(v, 3);
    expect(v.state().visits[0].dolls).toHaveLength(3);
    v.event("left", 2, 1, -1);
    run(v, 2);
    expect(v.state().visits).toEqual([]);
    expect(held[held.length - 1]).toBe(null);
    expect(v.busy).toBe(false);
  });

  it("a whole visit and the next one's halt heard in one frame (stepped while paused): the new stop is shown", () => {
    const { v } = view();
    v.event("halted", 2, 1, 7);
    for (let k = 0; k < 5; k++) v.event("on", 2, 1, 7);
    v.event("left", 2, 1, -1);
    v.event("halted", 1, 2, 7);
    v.event("halted", 2, 3, 7);
    v.update(1 / 30);
    expect(v.state().visits).toHaveLength(1);
    expect(v.state().visits[0].dolls.length).toBeGreaterThan(0);
  });

  it("reduced motion: on board at once, no one shown getting off", () => {
    const { v } = view(true);
    v.event("halted", 2, 1, 7);
    v.event("on", 2, 1, 7);
    v.event("off", 2, 1, 7);
    v.update(1 / 30);
    expect(v.state().visits[0].dolls.map((d) => d.mode)).toEqual(["stand", "stand", "stand"]);
  });
});
