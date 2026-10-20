import { describe, expect, it } from "vitest";
import { dateOf, dateText, MONTH_S } from "./calendar";

describe("the game's calendar", () => {
  it("opens in January 2000 and turns a month every MONTH_S seconds of play", () => {
    expect(dateText(0)).toBe("Jan 2000");
    expect(dateText(MONTH_S - 0.01)).toBe("Jan 2000");
    expect(dateText(MONTH_S)).toBe("Feb 2000");
    expect(dateText(14 * MONTH_S)).toBe("Mar 2001");
    expect(dateOf(-5)).toEqual({ year: 2000, month: 0 });
  });

  it("paces a three-hour game at about seven and a half years, City (about 100 min) in spring 2004", () => {
    expect(dateOf(3 * 3600).year).toBe(2007);
    expect(dateText(100 * 60)).toBe("Mar 2004");
  });
});
