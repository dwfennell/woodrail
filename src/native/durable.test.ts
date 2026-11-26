import { describe, expect, it } from "vitest";
import { MIRROR_DELAY_MS, mirror, restore, type Durable } from "./durable";

/** A Storage of its own class, so each test's mirror wraps its own prototype. */
function fakeStorage(): Storage {
  class Fake {
    private m = new Map<string, string>();
    get length() {
      return this.m.size;
    }
    key(i: number) {
      return [...this.m.keys()][i] ?? null;
    }
    getItem(k: string) {
      return this.m.get(k) ?? null;
    }
    setItem(k: string, v: string) {
      if (v === "too big") throw new Error("QuotaExceededError");
      this.m.set(k, v);
    }
    removeItem(k: string) {
      this.m.delete(k);
    }
    clear() {
      this.m.clear();
    }
  }
  return new Fake() as unknown as Storage;
}

function fakeDurable(init: Record<string, string> = {}): Durable & { m: Map<string, string>; writes: number } {
  const m = new Map(Object.entries(init));
  const d = {
    m,
    writes: 0,
    keys: async () => [...m.keys()],
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => {
      d.writes++;
      m.set(k, v);
    },
    remove: async (k: string) => {
      d.writes++;
      m.delete(k);
    },
  };
  return d;
}

/** A schedule run by hand: `run()` fires what's waiting. */
function handClock() {
  const due: (() => void)[] = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      expect(ms).toBe(MIRROR_DELAY_MS);
      due.push(fn);
    },
    run: () => due.splice(0).forEach((f) => f()),
  };
}

describe("restore", () => {
  it("puts back lost woodrail keys and leaves the ones still there", async () => {
    const s = fakeStorage();
    s.setItem("woodrail.muted", "0");
    const back = await restore(s, fakeDurable({ "woodrail.game.v2": "{save}", "woodrail.muted": "1", "other.key": "x" }));
    expect(back).toEqual(["woodrail.game.v2"]);
    expect(s.getItem("woodrail.game.v2")).toBe("{save}");
    expect(s.getItem("woodrail.muted")).toBe("0"); // the WebView's own is newer
    expect(s.getItem("other.key")).toBeNull();
  });

  it("skips a key the storage has no room for", async () => {
    const s = fakeStorage();
    expect(await restore(s, fakeDurable({ "woodrail.a": "too big", "woodrail.b": "ok" }))).toEqual(["woodrail.b"]);
  });
});

describe("mirror", () => {
  it("copies woodrail writes after the delay, one write per key", async () => {
    const s = fakeStorage();
    const d = fakeDurable();
    const clock = handClock();
    const m = mirror(s, d, clock.schedule);
    s.setItem("woodrail.game.v2", "one");
    s.setItem("woodrail.game.v2", "two");
    s.setItem("unrelated", "x");
    expect(d.m.size).toBe(0);
    clock.run();
    await m.flush();
    expect([...d.m]).toEqual([["woodrail.game.v2", "two"]]);
    expect(d.writes).toBe(1);
  });

  it("copies removes and clear, and flush writes at once", async () => {
    const s = fakeStorage();
    const d = fakeDurable({ "woodrail.a": "1", "woodrail.b": "2" });
    const m = mirror(s, d, handClock().schedule);
    s.setItem("woodrail.a", "1");
    s.setItem("woodrail.b", "2");
    s.removeItem("woodrail.a");
    await m.flush();
    expect([...d.m.keys()]).toEqual(["woodrail.b"]);
    s.clear();
    await m.flush();
    expect(d.m.size).toBe(0);
  });

  it("copies nothing when the write itself fails", async () => {
    const s = fakeStorage();
    const d = fakeDurable();
    const m = mirror(s, d, handClock().schedule);
    expect(() => s.setItem("woodrail.a", "too big")).toThrow();
    await m.flush();
    expect(d.m.size).toBe(0);
  });

  it("leaves another storage on the same prototype alone", async () => {
    const s = fakeStorage();
    const other = new (Object.getPrototypeOf(s).constructor as new () => Storage)();
    const d = fakeDurable();
    const m = mirror(s, d, handClock().schedule);
    other.setItem("woodrail.session", "x");
    await m.flush();
    expect(d.m.size).toBe(0);
    expect(other.getItem("woodrail.session")).toBe("x");
  });

  it("goes on when the copy fails", async () => {
    const s = fakeStorage();
    const d = fakeDurable();
    d.set = async () => {
      throw new Error("disk");
    };
    const m = mirror(s, d, handClock().schedule);
    s.setItem("woodrail.a", "1");
    await expect(m.flush()).resolves.toBeUndefined();
    expect(s.getItem("woodrail.a")).toBe("1");
  });
});
