import { describe, expect, it } from "vitest";
import { badgeEms } from "../ui/cost-tag";
import { carLoadWords, loadWords, trainSummary, type SummaryCar } from "./train-summary";

const engine: SummaryCar = { kind: "engine" };
const wagon = (cargo: SummaryCar["cargo"], count = 0): SummaryCar => ({ kind: "wagon", cargo, count });

describe("train summary (#9)", () => {
  it("cars, speed and line; the load by good in cargo order, riders last", () => {
    const s = trainSummary([engine, wagon("planks", 4), wagon("log", 6), wagon("log", 6), { kind: "coach", count: 3 }], 40, "Red line");
    expect(s.about).toBe("4 cars · 40 km/h · Red line");
    expect(s.load).toBe("🌲 12 · 🪵 4 · 🧑 3");
  });

  it("one car, no line; empty", () => {
    expect(trainSummary([engine, wagon(null)], 60, "")).toEqual({ about: "1 car · 60 km/h", load: "Empty" });
  });

  it("an engine alone says no load; a train that can't move says no speed; a long line name is left out", () => {
    expect(trainSummary([engine], 40, "Red line")).toEqual({ about: "0 cars · 40 km/h · Red line", load: "" });
    expect(trainSummary([engine, wagon("stone", 2)], 0, "The long way round")).toEqual({ about: "1 car", load: "🪨 2" });
  });

  it("more than four kinds: three and \"+n more\"", () => {
    const cars = [engine, wagon("log", 1), wagon("planks", 2), wagon("grain", 3), wagon("stone", 4), wagon("coal", 5)];
    expect(loadWords(cars)).toBe("🌲 1 · 🪵 2 · 🌾 3 · +2 more");
  });

  it("each line fits one line of the card at 360 px, at the worst", () => {
    // The card is 328 px at 360 (100vw − 32 px), less its padding; the summary's 13 px type.
    const room = (328 - 2 * 16) / 13;
    const long = trainSummary(
      [engine, ...["log", "planks", "grain", "stone", "coal", "ore", "iron", "tools"].map((k) => wagon(k as SummaryCar["cargo"], 16)), { kind: "coach", count: 12 }],
      60,
      "Purple line",
    );
    expect(badgeEms(long.about)).toBeLessThan(room);
    expect(badgeEms(long.load)).toBeLessThan(room);
  });

  it("a wagon's card: its goods of its room, or what it carries; a coach's seats", () => {
    expect(carLoadWords(wagon("log", 2), 3)).toBe("🌲 Logs: 2 of 3");
    expect(carLoadWords(wagon(null), 3, ["grain", "stone"])).toBe("Empty (carries grain, stone)");
    expect(carLoadWords({ kind: "coach", count: 3 }, 6)).toBe("🧑 3 of 6 seats");
  });
});
