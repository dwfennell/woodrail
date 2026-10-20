import { describe, expect, it } from "vitest";
import { Gate, SOFT_CLUNK_GAP_MS } from "./audio";

describe("the soft clunk's rate limit (QA N5)", () => {
  it("lets one through, then none till its gap has passed", () => {
    const g = new Gate(SOFT_CLUNK_GAP_MS);
    expect(g.open(1000)).toBe(true);
    expect(g.open(1001)).toBe(false);
    expect(g.open(1000 + SOFT_CLUNK_GAP_MS - 1)).toBe(false);
    expect(g.open(1000 + SOFT_CLUNK_GAP_MS)).toBe(true);
  });

  it("a busy layout (a throw every 50 ms for 5 s) is heard a handful of times, not a hundred", () => {
    const g = new Gate(SOFT_CLUNK_GAP_MS);
    let heard = 0;
    for (let t = 0; t < 5000; t += 50) if (g.open(t)) heard++;
    expect(heard).toBe(Math.ceil(5000 / SOFT_CLUNK_GAP_MS));
    expect(SOFT_CLUNK_GAP_MS).toBeGreaterThanOrEqual(500);
  });
});
