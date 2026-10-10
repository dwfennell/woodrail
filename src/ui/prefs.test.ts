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
