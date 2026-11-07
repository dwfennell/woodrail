import { describe, expect, it } from "vitest";
import { HILLINESS } from "../landscape/hills";
import { DEFAULT_CHOICES, loadChoices, NEW_GAME_ROWS, saveChoices } from "./new-game";

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage;
}

describe("the new-game sheet's choices", () => {
  it("has a Hills row, its steps flattest to highest, Gentle picked first", () => {
    expect(NEW_GAME_ROWS.map((r) => r.key)).toEqual(["hills", "water", "coast"]);
    expect(NEW_GAME_ROWS[0].steps.map((s) => s.value)).toEqual([...HILLINESS]);
    expect(NEW_GAME_ROWS[0].steps.map((s) => s.label)).toEqual(["Flat", "Gentle", "Hilly", "Mountainous"]);
    expect(DEFAULT_CHOICES.hills).toBe("gentle");
    expect(loadChoices(memory())).toEqual(DEFAULT_CHOICES);
  });

  it("remembers the last choice for the next new game, and keeps the default for one it doesn't know", () => {
    const s = memory();
    saveChoices({ hills: "mountains", water: "lots", coast: false }, s);
    expect(loadChoices(s)).toEqual({ hills: "mountains", water: "lots", coast: false });
    s.setItem("woodrail.newGame", JSON.stringify({ hills: "alps", more: 1 }));
    expect(loadChoices(s)).toEqual(DEFAULT_CHOICES);
    s.setItem("woodrail.newGame", "{not json");
    expect(loadChoices(s)).toEqual(DEFAULT_CHOICES);
    expect(loadChoices(null)).toEqual(DEFAULT_CHOICES);
  });
});
