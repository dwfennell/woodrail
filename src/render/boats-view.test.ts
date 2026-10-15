import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { BoatsView } from "./boats-view";
import type { PropLibrary } from "./props/library";

/** A library whose boat model comes when `release` is called (no parts: nothing to draw, just a place). */
function slowLibrary(): { library: PropLibrary; release: () => Promise<void> } {
  const waiting: (() => void)[] = [];
  const library = {
    load: () => new Promise((done) => waiting.push(() => done({ parts: [] }))),
  } as unknown as PropLibrary;
  return {
    library,
    release: async () => {
      for (const w of waiting.splice(0)) w();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

/** A camera at the origin looking along +x (or -x). */
function camera(lookX: number): PerspectiveCamera {
  const c = new PerspectiveCamera(50, 1, 1, 5000);
  c.position.set(0, 200, 0);
  c.lookAt(lookX * 2000, 0, 0);
  c.updateMatrixWorld();
  return c;
}

const WAY = [
  { x: 2000, z: 0 },
  { x: 1000, z: 0 },
];

describe("boats", () => {
  it("a boat sailing out of view asks for no frames; in view, it does", async () => {
    const { library, release } = slowLibrary();
    const boats = new BoatsView(library, () => {});
    boats.arrive(1, WAY, 60);
    await release();
    expect(boats.count).toBe(1);
    const away = camera(-1);
    boats.update(away); // (the frame it went out of view)
    expect(boats.update(away)).toBe(false);
    expect(boats.update(camera(1))).toBe(true);
  });

  it("a boat that's gone (its harbour taken up) goes at once, even mid-way in", async () => {
    const { library, release } = slowLibrary();
    const boats = new BoatsView(library, () => {});
    boats.arrive(1, WAY, 60);
    await release();
    boats.remove(1);
    expect(boats.count).toBe(0);
    expect(boats.update(camera(1))).toBe(false);
  });

  it("a boat still loading when its harbour goes, or the map changes, never turns up", async () => {
    const { library, release } = slowLibrary();
    const boats = new BoatsView(library, () => {});
    boats.arrive(1, WAY, 60);
    boats.remove(1);
    boats.arrive(2, WAY, 60);
    boats.clear();
    await release();
    expect(boats.count).toBe(0);
    // A second call for the same harbour while the first loads: one boat.
    boats.arrive(3, WAY, 60);
    boats.arrive(3, WAY, 60);
    await release();
    expect(boats.count).toBe(1);
  });
});
