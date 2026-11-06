import { describe, expect, it } from "vitest";
import { lazy } from "./lazy";

describe("lazy", () => {
  it("makes it once, on the first use, and every use waiting gets it in order", async () => {
    let made = 0;
    const l = lazy(async () => ({ n: ++made }));
    expect(l.now).toBeNull();
    expect(made).toBe(0);
    const got: string[] = [];
    l.use((t) => got.push(`a${t.n}`));
    l.use((t) => got.push(`b${t.n}`));
    expect(got).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(got).toEqual(["a1", "b1"]);
    expect(l.now).toEqual({ n: 1 });
    l.use((t) => got.push(`c${t.n}`));
    expect(got).toEqual(["a1", "b1", "c1"]);
    expect(made).toBe(1);
  });
});
