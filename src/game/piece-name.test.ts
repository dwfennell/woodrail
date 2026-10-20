import { describe, expect, it } from "vitest";
import { pieceName } from "./piece-name";

describe("a piece's name for many (\"Out of …\", QA junction notes)", () => {
  it("switches, crossings and curves by their own plurals; straights by size", () => {
    expect(pieceName("switch")).toBe("switches");
    expect(pieceName("switch-y")).toBe("Y switches");
    expect(pieceName("switch-3way")).toBe("three-ways");
    expect(pieceName("crossing")).toBe("crossings");
    expect(pieceName("crossing-45")).toBe("45° crossings");
    expect(pieceName("curve-large")).toBe("curves");
    expect(pieceName("straight-216")).toBe("long pieces");
    expect(pieceName("straight-288")).toBe("extra long pieces");
    expect(pieceName("curve-small")).toBe("tight curves");
  });
});
