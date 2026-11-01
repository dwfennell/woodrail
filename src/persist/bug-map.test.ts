import { describe, expect, it } from "vitest";
import { MAP_TAG, mapText, readMapText, writeMap } from "./bug-map";
import { modeKeys } from "./save";

/** A bare `Storage` stand-in. */
function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("a map copied for a bug report", () => {
  it("goes round: the mode's keys out as tagged text, and back into another device's storage in place of its own", async () => {
    const keys = modeKeys("game");
    const here = store({ [keys[0]]: '{"version":9,"layout":[1,2,3]}', [keys[2]]: "goals", other: "not sent" });
    const text = await mapText("game", here);
    expect(text.startsWith(MAP_TAG)).toBe(true);
    // (As pasted from a chat: wrapped, or URL-escaped in a link.)
    const back = await readMapText(encodeURIComponent(text.slice(0, 20) + "\n" + text.slice(20)));
    expect(back).toEqual({ mode: "game", keys: { [keys[0]]: '{"version":9,"layout":[1,2,3]}', [keys[2]]: "goals" } });
    const there = store({ [keys[1]]: "their session", [keys[0]]: "their railway" });
    writeMap(back!, there);
    expect(there.m.get(keys[0])).toBe('{"version":9,"layout":[1,2,3]}');
    expect(there.m.has(keys[1])).toBe(false);
  });

  it("turns away anything else", async () => {
    expect(await readMapText("hello")).toBeNull();
    expect(await readMapText(MAP_TAG + "!!!")).toBeNull();
  });
});
