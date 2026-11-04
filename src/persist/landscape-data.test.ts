import { describe, expect, it } from "vitest";
import { generateLandscape, PLOT_CELLS } from "../landscape";
import { deserializeLandscape, serializeLandscape } from "./landscape-data";

describe("serializeLandscape's encoded plots (reused while their bytes are the same)", () => {
  it("a square changed after a save is in the next save, touched or not", () => {
    const land = generateLandscape(5);
    const first = serializeLandscape(land);
    expect(serializeLandscape(land)).toEqual(first);
    const g = land.grid;
    // Heights changed with no `touch`, on the first plot and the last: both in the next save.
    g.height[3] = (g.height[3] + 1) % 4;
    const last = (g.plots.length - 1) * PLOT_CELLS + 7;
    g.height[last] = (g.height[last] + 1) % 4;
    const second = serializeLandscape(land);
    expect(second.plots[0].height).not.toBe(first.plots[0].height);
    expect(second.plots[0].surface).toBe(first.plots[0].surface);
    const back = deserializeLandscape(second);
    expect(back.ok ? "ok" : back.error).toBe("ok");
    if (!back.ok) return;
    expect(back.value.grid.height[3]).toBe(g.height[3]);
    expect(back.value.grid.height[last]).toBe(g.height[last]);
    // As a fresh encode has it.
    expect(JSON.stringify(serializeLandscape(back.value).plots)).toBe(JSON.stringify(second.plots));
  });
});
