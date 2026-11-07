import { describe, expect, it } from "vitest";
import { capital, listed } from "./words";

describe("words", () => {
  it("lists: none, one, two, three; and with or", () => {
    expect(listed([])).toBe("");
    expect(listed(["logs"])).toBe("logs");
    expect(listed(["flour", "milk"])).toBe("flour and milk");
    expect(listed(["coal", "ore", "iron"])).toBe("coal, ore and iron");
    expect(listed(["Hopper", "Goods van", "Cold van"], "or")).toBe("Hopper, Goods van or Cold van");
  });
  it("capitals the first letter only", () => {
    expect(capital("open countryside")).toBe("Open countryside");
    expect(capital("")).toBe("");
  });
});
