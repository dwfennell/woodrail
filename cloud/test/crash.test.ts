import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { crashKey, MAX_STACK, parseCrash } from "../src/crash";

const BASE = "https://cloud.test";
const crash = (over: Record<string, unknown> = {}) => ({
  kind: "context-lost",
  message: "WebGL context lost",
  stack: "",
  build: "abc1234",
  userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 10)",
  screen: { width: 412, height: 923, dpr: 2.625 },
  pixelRatio: 2,
  quality: "mobile",
  ...over,
});
let ip = 0;
const post = (body: unknown, origin: string | null = "https://html-classic.itch.zone") =>
  worker.fetch(new Request(`${BASE}/crash`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "text/plain", "CF-Connecting-IP": `10.1.0.${++ip}`, ...(origin ? { Origin: origin } : {}) } }), env as typeof env);

describe("crash reports", () => {
  it("keeps only the known fields, cut short", () => {
    const got = parseCrash({ ...crash(), stack: "x".repeat(MAX_STACK + 50), map: "woodrail-map:1:abc", save: { a: 1 } });
    expect(typeof got).toBe("object");
    expect(got).not.toHaveProperty("map");
    expect(got).not.toHaveProperty("save");
    expect((got as { stack: string }).stack.length).toBe(MAX_STACK);
    expect(parseCrash({ ...crash(), kind: "bug" })).toBe("kind must be error, rejection or context-lost");
  });

  it("stores a report from itch.io, listed newest first for the admin", async () => {
    const a = await post(crash({ message: "first" }));
    expect(a.status).toBe(201);
    expect(a.headers.get("Access-Control-Allow-Origin")).toBe("https://html-classic.itch.zone");
    await new Promise((r) => setTimeout(r, 5));
    expect((await post(crash({ kind: "error", message: "second" }))).status).toBe(201);
    const list = await worker.fetch(new Request(`${BASE}/crash`, { headers: { Authorization: "Bearer k" } }), { ...env, ADMIN_KEY: "k" } as typeof env);
    expect(list.status).toBe(200);
    const { reports } = (await list.json()) as { reports: { message: string }[] };
    expect(reports.map((r) => r.message).slice(0, 2)).toEqual(["second", "first"]);
  });

  it("turns away other pages, junk, and the list without the key", async () => {
    expect((await post(crash(), "https://evil.example")).status).toBe(403);
    expect((await post("not json")).status).toBe(400);
    expect((await post("x".repeat(9000))).status).toBe(413);
    expect((await worker.fetch(new Request(`${BASE}/crash`, { headers: { Authorization: "Bearer wrong" } }), { ...env, ADMIN_KEY: "k" } as typeof env)).status).toBe(401);
  });

  it("keys sort newest first", () => {
    expect(crashKey("b", 2000) < crashKey("a", 1000)).toBe(true);
  });
});
