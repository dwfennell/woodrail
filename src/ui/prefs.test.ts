import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMuted, saveMuted } from "./prefs";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe("muted preference", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to sound on", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadMuted()).toBe(false);
  });

  it("remembers the choice", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    saveMuted(true);
    expect(loadMuted()).toBe(true);
    saveMuted(false);
    expect(loadMuted()).toBe(false);
  });

  it("copes with storage that throws (private mode)", () => {
    const broken = fakeStorage();
    broken.getItem = () => {
      throw new Error("denied");
    };
    broken.setItem = () => {
      throw new Error("denied");
    };
    vi.stubGlobal("localStorage", broken);
    expect(() => saveMuted(true)).not.toThrow();
    expect(loadMuted()).toBe(false);
  });
});

describe("one-time hints", () => {
  it("are remembered as seen, each on its own, and survive without storage", async () => {
    const { hintSeen, markHintSeen } = await import("./prefs");
    const store = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: unknown };
    const before = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    try {
      expect(hintSeen("drag-selected")).toBe(false);
      markHintSeen("drag-selected");
      expect(hintSeen("drag-selected")).toBe(true);
      expect(hintSeen("other")).toBe(false);
      markHintSeen("other");
      expect(hintSeen("drag-selected") && hintSeen("other")).toBe(true);
    } finally {
      g.localStorage = before;
    }
    // No storage at all: never seen, and marking doesn't throw.
    expect(hintSeen("x")).toBe(false);
    expect(() => markHintSeen("x")).not.toThrow();
  });
});
