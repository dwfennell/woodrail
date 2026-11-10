import { describe, expect, it } from "vitest";
import { nextUp, type NextInput } from "./town-next";

const base: NextInput = { underway: false, canStartGrand: false, routes: true, lines: 1, missing: null, hallReady: false };

describe("a town card's Next up", () => {
  it("is the goods bars when nothing's pressing (the card opens on Grow)", () => {
    expect(nextUp(base)).toEqual({ kind: "grow", tab: "grow" });
  });

  it("a good nothing makes: find its industry on the tray, or learn it first", () => {
    expect(nextUp({ ...base, missing: { tech: null } })).toEqual({ kind: "maker", tab: "grow" });
    expect(nextUp({ ...base, missing: { tech: "mills" } })).toEqual({ kind: "research", tab: "grow" });
  });

  it("no line calls: a route first (nothing grows without trains), once routes are learned", () => {
    expect(nextUp({ ...base, lines: 0, missing: { tech: null } })).toEqual({ kind: "route", tab: "station" });
    expect(nextUp({ ...base, routes: false, lines: 0 })).toEqual({ kind: "grow", tab: "grow" });
  });

  it("a City ★ that can start a grand project opens on Projects; one under way does too", () => {
    expect(nextUp({ ...base, canStartGrand: true, missing: { tech: null }, hallReady: true })).toEqual({ kind: "grand", tab: "projects" });
    expect(nextUp({ ...base, underway: true, lines: 0 })).toEqual({ kind: "underway", tab: "projects" });
  });

  it("a town hall ready to build: the Build tab", () => {
    expect(nextUp({ ...base, hallReady: true })).toEqual({ kind: "hall", tab: "build" });
  });
});
