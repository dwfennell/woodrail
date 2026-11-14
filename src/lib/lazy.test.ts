import { describe, expect, it } from "vitest";
import { lazy } from "./lazy";

describe("lazy", () => {
  it("makes it once, on the first use, and every use waiting gets it in order", async () => {
    let made = 0;
    const l = lazy(async () => ({ n: ++made }), () => {});
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

  it("a failed make drops the waiting calls, says so, and the next use tries again", async () => {
    let tries = 0;
    const errors: unknown[] = [];
    const l = lazy(async () => {
      if (++tries === 1) throw new Error("Failed to fetch dynamically imported module");
      return { n: tries };
    }, (e) => errors.push(e));
    const got: number[] = [];
    l.use((t) => got.push(t.n));
    l.use((t) => got.push(t.n));
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveLength(1);
    expect(got).toEqual([]);
    expect(l.now).toBeNull();
    l.use((t) => got.push(t.n));
    await Promise.resolve();
    await Promise.resolve();
    expect(got).toEqual([2]);
    expect(tries).toBe(2);
    expect(errors).toHaveLength(1);
  });
});
