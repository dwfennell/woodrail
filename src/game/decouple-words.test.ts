import { describe, expect, it } from "vitest";
import { decoupleWords } from "./decouple-words";

describe("Decouple's toast: which part keeps the engine", () => {
  it("the engine on the tapped car's side: the wagons that came away", () => {
    expect(decoupleWords(["engine", "hopper", "timber"], ["timber", "van"])).toBe("Uncoupled 2 wagons");
    expect(decoupleWords(["engine"], ["hopper"])).toBe("Uncoupled 1 wagon");
  });
  it("the engine on the other side: the wagons on the tapped car's side", () => {
    expect(decoupleWords(["timber", "van"], ["engine", "hopper", "timber"])).toBe("Uncoupled 2 wagons");
  });
  it("an engine in both parts, or in neither: both parts, the tapped car's first", () => {
    expect(decoupleWords(["engine", "hopper"], ["engine", "timber", "van"])).toBe("Split: engine + 1 | engine + 2");
    expect(decoupleWords(["van"], ["hopper", "timber"])).toBe("Split: 1 wagon | 2 wagons");
    expect(decoupleWords(["engine", "engine"], ["engine"])).toBe("Split: 2 engines | engine");
  });
});
