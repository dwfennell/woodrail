import { describe, expect, it } from "vitest";
import { BATCH_MS, deviceOf, hostOf, MAX_EVENTS, Stats, type StatBatch, type StatsDeps } from "./stats";

function setup(over: Partial<StatsDeps> = {}) {
  const store = new Map<string, string>();
  const sent: { url: string; batch: StatBatch; leaving: boolean }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let clock = 1000;
  const deps: StatsDeps = {
    url: "https://cloud.test",
    build: "b1",
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    send: (url, body, leaving) => sent.push({ url, batch: JSON.parse(body) as StatBatch, leaving }),
    now: () => clock++,
    later: (fn, ms) => timers.push({ fn, ms }),
    host: "itch",
    device: "phone",
    randomId: () => "0123456789abcdef",
    ...over,
  };
  return { stats: new Stats(deps), store, sent, timers, deps };
}

describe("Stats", () => {
  it("sends nothing until the player says yes, then what was held", () => {
    const { stats, sent, timers } = setup();
    expect(stats.shouldAsk).toBe(true);
    stats.record({ e: "start", mode: "game", fresh: true });
    stats.record({ e: "goal", id: "join-two", n: 1 });
    stats.flush(true);
    expect(sent).toEqual([]);
    expect(timers).toEqual([]);
    stats.setConsent(true);
    expect(timers.length).toBe(1);
    timers[0].fn();
    expect(sent[0].batch.events.map((e) => e.e)).toEqual(["start", "goal"]);
  });

  it("a no drops what was held, unsent", () => {
    const { stats, sent } = setup();
    stats.record({ e: "start", mode: "game", fresh: true });
    stats.setConsent(false);
    stats.record({ e: "goal", id: "join-two", n: 1 });
    stats.flush(true);
    expect(sent).toEqual([]);
  });

  it("asks nothing, and sends nothing, in a build without a stats URL", () => {
    const { stats, sent } = setup({ url: "" });
    expect(stats.available).toBe(false);
    expect(stats.shouldAsk).toBe(false);
    stats.setConsent(true);
    stats.record({ e: "goal", id: "g1", n: 1 });
    stats.flush(true);
    expect(sent).toEqual([]);
  });

  it("after a yes, batches events and sends them a minute after the first", () => {
    const { stats, sent, timers, store } = setup();
    stats.setConsent(true);
    expect(stats.shouldAsk).toBe(false);
    stats.record({ e: "start", mode: "game", fresh: true });
    stats.record({ e: "goal", id: "first-loop", n: 1 });
    expect(timers.length).toBe(1);
    expect(timers[0].ms).toBe(BATCH_MS);
    timers[0].fn();
    expect(sent.length).toBe(1);
    expect(sent[0].url).toBe("https://cloud.test/v1/stats");
    expect(sent[0].batch).toMatchObject({ id: "0123456789abcdef", build: "b1", host: "itch", device: "phone" });
    expect(sent[0].batch.events.map((e) => e.e)).toEqual(["start", "goal"]);
    expect(store.get("woodrail.stats.id")).toBe("0123456789abcdef");
    // Nothing waiting: nothing sent.
    stats.flush(true);
    expect(sent.length).toBe(1);
  });

  it("remembers the answer, and a no drops the id and what's waiting", () => {
    const { stats, sent, store, deps } = setup();
    stats.setConsent(true);
    stats.record({ e: "start", mode: "sandbox", fresh: false });
    stats.flush(false);
    stats.record({ e: "end", mode: "sandbox", minutes: 3 });
    stats.setConsent(false);
    stats.flush(true);
    expect(sent.length).toBe(1);
    expect(store.get("woodrail.stats")).toBe("no");
    expect(store.has("woodrail.stats.id")).toBe(false);
    const again = new Stats(deps);
    expect(again.consent).toBe("no");
    expect(again.shouldAsk).toBe(false);
  });

  it("caps errors a session and events a batch", () => {
    const { stats, sent } = setup();
    stats.setConsent(true);
    for (let i = 0; i < 10; i++) stats.record({ e: "error", msg: `boom ${i}` });
    for (let i = 0; i < MAX_EVENTS * 2; i++) stats.record({ e: "goal", id: `g${i}`, n: i });
    stats.flush(true);
    const events = sent[0].batch.events;
    expect(events.filter((e) => e.e === "error").length).toBe(3);
    expect(events.length).toBe(MAX_EVENTS);
  });

  it("works without storage", () => {
    const { stats, sent } = setup({ storage: null });
    stats.setConsent(true);
    stats.record({ e: "start", mode: "game", fresh: true });
    stats.flush(true);
    expect(sent.length).toBe(1);
  });
});

describe("hostOf and deviceOf", () => {
  it("names where it's played", () => {
    expect(hostOf("html-classic.itch.zone")).toBe("itch");
    expect(hostOf("dwfennell.github.io")).toBe("pages");
    expect(hostOf("localhost")).toBe("local");
    expect(hostOf("claude.ai")).toBe("other");
  });
  it("names the device", () => {
    expect(deviceOf(false, 900)).toBe("desktop");
    expect(deviceOf(true, 390)).toBe("phone");
    expect(deviceOf(true, 820)).toBe("tablet");
  });
});
