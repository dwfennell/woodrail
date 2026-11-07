import { describe, expect, it } from "vitest";
import { BUILD_EVERY_MS, BUILD_SETTLE_MS, MAX_SNAPSHOTS, Snapshots, type SnapshotDeps } from "./snapshots";

function setup(over: { shareMaps?: boolean; map?: string | null } = {}) {
  const store = new Map<string, string>();
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let clock = 1_000_000;
  const deps: SnapshotDeps = {
    stats: { shareMaps: over.shareMaps ?? true, deviceId: () => "0123456789abcdef", about: { build: "b1", host: "itch", device: "phone" }, url: "https://cloud.test" },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    mapText: async () => (over.map === undefined ? "woodrail-map:1:abc" : over.map),
    send: (url, body) => sent.push({ url, body: JSON.parse(body) as Record<string, unknown> }),
    now: () => clock,
    later: (fn, ms) => timers.push({ fn, ms }),
  };
  return { snaps: new Snapshots(deps), sent, timers, store, tick: (ms: number) => (clock += ms) };
}
const both = (id: string) => id === "join-two" || id === "place-train";
const first = (id: string) => id === "join-two";
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Snapshots", () => {
  it("sends nothing till two towns are joined and an engine is on the track", async () => {
    const { snaps, sent } = setup();
    snaps.goal("join-two", first, 1);
    await flush();
    expect(sent).toEqual([]);
    snaps.goal("place-train", both, 2);
    await flush();
    expect(sent.length).toBe(1);
    expect(sent[0].url).toBe("https://cloud.test/v1/snapshots");
    expect(sent[0].body).toEqual({ id: "0123456789abcdef", map: "woodrail-map:1:abc", goals: 2, why: "goal:place-train", build: "b1", host: "itch", device: "phone" });
  });

  it("sends nothing for a player who doesn't share their railway, or when there's no map", async () => {
    for (const s of [setup({ shareMaps: false }), setup({ map: null })]) {
      s.snaps.goal("place-train", both, 2);
      s.snaps.edited(both, () => 2);
      for (const t of s.timers) t.fn();
      await flush();
      expect(s.sent).toEqual([]);
    }
  });

  it("building: one a minute after the first edit, then none for a while", async () => {
    const { snaps, sent, timers, tick } = setup();
    snaps.edited(first, () => 1);
    expect(timers).toEqual([]);
    snaps.edited(both, () => 2);
    snaps.edited(both, () => 2);
    expect(timers.length).toBe(1);
    expect(timers[0].ms).toBe(BUILD_SETTLE_MS);
    timers[0].fn();
    await flush();
    expect(sent.map((s) => s.body.why)).toEqual(["building"]);
    tick(BUILD_EVERY_MS - 1);
    snaps.edited(both, () => 2);
    expect(timers.length).toBe(1);
    tick(1);
    snaps.edited(both, () => 2);
    expect(timers.length).toBe(2);
  });

  it(`stops at ${MAX_SNAPSHOTS} a device, counted in storage`, async () => {
    const { snaps, sent, store } = setup();
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
      snaps.goal(`g${i}`, both, i);
      await flush();
    }
    expect(sent.length).toBe(MAX_SNAPSHOTS);
    expect(store.get("woodrail.stats.maps.sent")).toBe(String(MAX_SNAPSHOTS));
  });
});
