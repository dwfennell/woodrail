import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { handleStats, MAX_STATS_BYTES, points } from "../src/stats";

const URL_ = "https://cloud.test/v1/stats";
const batch = (events: unknown[], over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "0123456789abcdef", build: "b1", host: "itch", device: "phone", events, ...over });

function fake() {
  const written: AnalyticsEngineDataPoint[] = [];
  return { env: { STATS: { writeDataPoint: (p?: AnalyticsEngineDataPoint) => void written.push(p!) } }, written };
}
const post = (body: string, e = fake().env, origin = "https://html-classic.itch.zone") =>
  handleStats(new Request(URL_, { method: "POST", body, headers: { Origin: origin, "Content-Type": "text/plain" } }), e, { "Access-Control-Allow-Origin": "*" });

describe("stats", () => {
  it("writes one data point an event, from any page", async () => {
    const f = fake();
    const res = await post(
      batch([
        { e: "start", mode: "game", fresh: true, t: 1 },
        { e: "goal", id: "first-loop", n: 1, t: 2 },
        { e: "end", mode: "game", minutes: 12.5, t: 3 },
        { e: "error", msg: "x".repeat(500), t: 4 },
        { e: "nonsense", t: 5 },
      ]),
      f.env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(f.written.map((p) => p.blobs![0])).toEqual(["start", "goal", "end", "error"]);
    expect(f.written[0]).toEqual({ indexes: ["0123456789abcdef"], blobs: ["start", "game", "", "b1", "itch", "phone"], doubles: [0, 1] });
    expect(f.written[1].blobs![2]).toBe("first-loop");
    expect(f.written[2].doubles![0]).toBe(12.5);
    expect((f.written[3].blobs![2] as string).length).toBe(200);
  });

  it("turns away a malformed or oversized batch", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(batch([], { id: "nope" }))).status).toBe(400);
    expect((await post(batch(Array(51).fill({ e: "goal", id: "g", n: 1 })))).status).toBe(400);
    expect((await post(batch([{ e: "error", msg: "x".repeat(MAX_STATS_BYTES) }]))).status).toBe(413);
    expect(points({ id: "0123456789abcdef", events: "x" })).toBeNull();
  });

  it("is served by the Worker from any origin, and answers a preflight", async () => {
    const res = await worker.fetch(new Request(URL_, { method: "POST", body: batch([{ e: "start", mode: "sandbox", fresh: false }]), headers: { "Content-Type": "text/plain", Origin: "https://html-classic.itch.zone" } }), env);
    expect(res.status).toBe(204);
    const pre = await worker.fetch(new Request(URL_, { method: "OPTIONS", headers: { Origin: "https://example.com" } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    const get = await worker.fetch(new Request(URL_, { method: "GET" }), env);
    expect(get.status).toBe(405);
  });

  it("leaves the saves' origin check as it was", async () => {
    const res = await worker.fetch(new Request("https://cloud.test/v1/saves/game", { headers: { Origin: "https://html-classic.itch.zone", "X-Woodrail-Code": "acorn-badge-otter-0420" } }), env);
    expect(res.status).toBe(403);
  });
});
