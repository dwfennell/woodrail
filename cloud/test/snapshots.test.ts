import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { MAX_PER_DEVICE, MAX_SNAPSHOT_BYTES, parseSnapshot } from "../src/snapshots";

const BASE = "https://cloud.test";
const MAP = "woodrail-map:1:H4sIAAAAAAAAA6tWKkotLs3JUbJSSs7PS8tMLy1KLVLSUUpJLElUslIqS8wpTtVRSs7PS0nNA4qVFqUCAJ8V0mExAAAA";
const ADMIN = { Authorization: "Bearer test-admin" };
const E = { ...env, ADMIN_KEY: "test-admin" } as typeof env;
let n = 0;
/** A device id of its own a test, so their counts don't meet. */
const device = () => (++n).toString(16).padStart(16, "0");
const snap = (id: string, over: Record<string, unknown> = {}) => ({ id, map: MAP, goals: 2, why: "goal:place-train", build: "b1", host: "itch", device: "phone", ...over });
let ip = 0;
const post = (body: unknown, origin: string | null = "https://html-classic.itch.zone", size?: string) =>
  worker.fetch(
    new Request(`${BASE}/v1/snapshots`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "text/plain", "CF-Connecting-IP": `10.1.0.${++ip}`, ...(origin ? { Origin: origin } : {}), ...(size ? { "Content-Length": size } : {}) } }),
    E,
  );
const get = (path: string, headers: Record<string, string> = ADMIN) => worker.fetch(new Request(`${BASE}${path}`, { headers }), E);

describe("snapshots: the checks", () => {
  it("takes a snapshot's known fields, cut short, and turns away a bad one", () => {
    const ok = parseSnapshot({ ...snap("0123456789abcdef"), why: "x".repeat(200), extra: "dropped" });
    expect(typeof ok).toBe("object");
    if (typeof ok === "string") return;
    expect(ok.why.length).toBe(80);
    expect(ok).not.toHaveProperty("extra");
    expect(parseSnapshot(snap("nope"))).toBe("id must be 16 hex digits");
    expect(parseSnapshot(snap("0123456789abcdef", { map: "hello" }))).toBe("map isn't a copied map");
    expect(parseSnapshot(snap("0123456789abcdef", { map: "woodrail-map:1:<script>" }))).toBe("map isn't a copied map");
  });
});

describe("snapshots: the endpoint", () => {
  it("stores one from the game's pages, and the admin reads it back, newest first", async () => {
    const id = device();
    expect((await post(snap(id, { goals: 2 }))).status).toBe(201);
    expect((await post(snap(id, { goals: 3, why: "goal:get-moving" }))).status).toBe(201);
    const mine = (await (await get(`/v1/snapshots/${id}`)).json()) as { key: string; goals: string; why: string; host: string }[];
    expect(mine.map((s) => s.goals)).toEqual(["3", "2"]);
    expect(mine[0]).toMatchObject({ why: "goal:get-moving", host: "itch" });
    const map = await get(`/v1/snapshots/${id}/${mine[1].key}`);
    expect(map.status).toBe(200);
    expect(await map.text()).toBe(MAP);
    const latest = (await (await get("/v1/snapshots")).json()) as { id: string; goals: string }[];
    expect(latest[0]).toMatchObject({ id, goals: "3" });
  });

  it("reads back nothing without the admin key", async () => {
    const id = device();
    await post(snap(id));
    expect((await get("/v1/snapshots", {})).status).toBe(401);
    expect((await get(`/v1/snapshots/${id}`, { Authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("turns away a page from elsewhere, a bad body, a big one, and a device past its share", async () => {
    expect((await post(snap(device()), "https://evil.example")).status).toBe(403);
    expect((await post("not json")).status).toBe(400);
    expect((await post(snap("zz")))).toHaveProperty("status", 400);
    expect((await post(snap(device()), undefined, String(MAX_SNAPSHOT_BYTES + 1))).status).toBe(413);
    const id = device();
    for (let i = 0; i < MAX_PER_DEVICE; i++) expect((await post(snap(id, { goals: i }))).status).toBe(201);
    expect((await post(snap(id))).status).toBe(429);
  });

  it("answers a preflight from itch, and leaves the saves' origin check as it was", async () => {
    const pre = await worker.fetch(new Request(`${BASE}/v1/snapshots`, { method: "OPTIONS", headers: { Origin: "https://html-classic.itch.zone" } }), E);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("https://html-classic.itch.zone");
    const saves = await worker.fetch(new Request(`${BASE}/v1/saves/game`, { headers: { Origin: "https://html-classic.itch.zone", "X-Woodrail-Code": "acorn-badge-otter-0420" } }), E);
    expect(saves.status).toBe(403);
  });
});
