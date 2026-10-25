import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { MAX_BYTES, MIN_PUT_INTERVAL_MS } from "../src/limits";

const ORIGIN = "http://localhost:5173";
const CODE = "acorn-badge-otter-0420";
const URL_ = "https://cloud.test/v1/saves/sandbox";

function call(method: string, opts: { url?: string; code?: string | null; origin?: string | null; body?: BodyInit; headers?: Record<string, string> } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.code !== null) headers["X-Woodrail-Code"] = opts.code ?? CODE;
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  return worker.fetch(new Request(opts.url ?? URL_, { method, headers, body: opts.body }), env);
}

const put = (body: BodyInit, savedAt = 1000, extra: { code?: string; url?: string; headers?: Record<string, string> } = {}) =>
  call("PUT", { body, code: extra.code, url: extra.url, headers: { "X-Saved-At": String(savedAt), "X-Save-Version": "13", "X-Game-Version": "abc123", ...extra.headers } });

declare global {
  namespace Cloudflare {
    interface Env {
      SAVES: R2Bucket;
      ALLOWED_ORIGINS: string;
      CODE_KEY: string;
    }
  }
}

beforeEach(async () => {
  // (Each test starts with an empty bucket.)
  const all = await env.SAVES.list();
  if (all.objects.length) await env.SAVES.delete(all.objects.map((o) => o.key));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => vi.useRealTimers());
const later = () => vi.setSystemTime(Date.now() + MIN_PUT_INTERVAL_MS + 1);

describe("saves", () => {
  it("stores a bundle and gives it back with its metadata", async () => {
    expect((await put(new Uint8Array([1, 2, 3]), 1234)).status).toBe(200);
    const got = await call("GET");
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(got.headers.get("X-Saved-At")).toBe("1234");
    expect(got.headers.get("X-Save-Version")).toBe("13");
    expect(got.headers.get("X-Game-Version")).toBe("abc123");
    expect(got.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(got.headers.get("Access-Control-Expose-Headers")).toContain("X-Saved-At");
    expect(got.headers.get("X-Stored-At")).toBe(String(Date.now()));
    expect(got.headers.get("X-Server-Now")).toBe(String(Date.now()));
  });

  it("HEAD answers what's there without the bytes", async () => {
    await put("hello", 77);
    const head = await call("HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("X-Saved-At")).toBe("77");
    expect(await head.text()).toBe("");
  });

  it("is 404 for a code with nothing saved", async () => {
    expect((await call("GET", { code: "zebra-zebra-zebra-0000" })).status).toBe(404);
    expect((await call("HEAD", { code: "zebra-zebra-zebra-0000" })).status).toBe(404);
  });

  it("keeps the one before as prev", async () => {
    await put("one", 1);
    later();
    await put("two", 2);
    expect(await (await call("GET")).text()).toBe("two");
    const prev = await call("GET", { url: `${URL_}?prev=1` });
    expect(await prev.text()).toBe("one");
    expect(prev.headers.get("X-Saved-At")).toBe("1");
  });

  it("keeps each mode and each code apart, and stores only a hash of the code", async () => {
    await put("sandbox railway");
    await put("game railway", 1000, { url: "https://cloud.test/v1/saves/game" });
    await put("someone else's", 1000, { code: "zebra-mango-tulip-9999" });
    expect(await (await call("GET")).text()).toBe("sandbox railway");
    expect(await (await call("GET", { url: "https://cloud.test/v1/saves/game" })).text()).toBe("game railway");
    const keys = (await env.SAVES.list()).objects.map((o) => o.key);
    expect(keys).toHaveLength(3);
    for (const k of keys) {
      expect(k).toMatch(/^saves\/[0-9a-f]{64}\/(sandbox|game)$/);
      expect(k).not.toContain("acorn");
    }
  });

  it("turns away a second PUT too soon (429), and takes it after", async () => {
    expect((await put("one")).status).toBe(200);
    const again = await put("two");
    expect(again.status).toBe(429);
    expect(again.headers.get("Retry-After")).toBe("10");
    expect(await (await call("GET")).text()).toBe("one");
    later();
    expect((await put("two")).status).toBe(200);
  });

  it("turns away a PUT made from a copy that's since been replaced (409)", async () => {
    expect((await put("first", 100, { headers: { "X-Base-Saved-At": "0" } })).status).toBe(200);
    later();
    // Made from nothing, but there's a copy now.
    expect((await put("stale", 200, { headers: { "X-Base-Saved-At": "0" } })).status).toBe(409);
    // Made from a copy that isn't the one there.
    expect((await put("stale", 200, { headers: { "X-Base-Saved-At": "99" } })).status).toBe(409);
    expect(await (await call("GET")).text()).toBe("first");
    expect((await put("second", 200, { headers: { "X-Base-Saved-At": "100" } })).status).toBe(200);
    expect(await (await call("GET")).text()).toBe("second");
  });

  it("keys a code by an HMAC under CODE_KEY, and won't run without one", async () => {
    await put("x");
    const [key] = (await env.SAVES.list()).objects.map((o) => o.key);
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-only-key"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const want = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(CODE)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(key).toBe(`saves/${want}/sandbox`);
    const res = await worker.fetch(new Request(URL_, { headers: { "X-Woodrail-Code": CODE, Origin: ORIGIN } }), { ...env, CODE_KEY: "" });
    expect(res.status).toBe(500);
  });

  it("of two PUTs over the same copy at once, one is a 409", async () => {
    await put("first", 100);
    later();
    const [a, b] = await Promise.all([put("from a", 200, { headers: { "X-Base-Saved-At": "100" } }), put("from b", 300, { headers: { "X-Base-Saved-At": "100" } })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = a.status === 200 ? "from a" : "from b";
    expect(await (await call("GET")).text()).toBe(won);
    expect(await (await call("GET", { url: `${URL_}?prev=1` })).text()).toBe("first");
  });

  it("of two first PUTs under a code at once, one is a 409", async () => {
    const [a, b] = await Promise.all([put("from a", 100), put("from b", 200)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = a.status === 200 ? "from a" : "from b";
    expect(await (await call("GET")).text()).toBe(won);
    // (Nothing before it.)
    expect((await call("GET", { url: `${URL_}?prev=1` })).status).toBe(404);
  });

  it("keeps when a layout edit was made and when it was stored, carried on by progress-only copies", async () => {
    const editedAt = Date.now() - 25_000;
    const first = await put("laid", 100, { headers: { "X-Edit-Kind": "layout", "X-Edited-At": String(editedAt) } });
    expect(first.headers.get("X-Stored-At")).toBe(String(Date.now()));
    const storedAt = String(Date.now());
    later();
    await put("earned", 200, { headers: { "X-Edit-Kind": "progress", "X-Base-Saved-At": "100" } });
    const head = await call("HEAD");
    expect(head.headers.get("X-Layout-At")).toBe(String(editedAt));
    expect(head.headers.get("X-Layout-Stored-At")).toBe(storedAt);
    expect(head.headers.get("X-Stored-At")).toBe(String(Date.now()));
    later();
    // (An edit time from the future is taken as now; none said, as now.)
    await put("laid again", 300, { headers: { "X-Edit-Kind": "layout", "X-Base-Saved-At": "200", "X-Edited-At": String(Date.now() + 999_999) } });
    expect((await call("HEAD")).headers.get("X-Layout-At")).toBe(String(Date.now()));
  });

  it("turns away a bundle that's too big (413)", async () => {
    expect((await put(new Uint8Array(MAX_BYTES + 1))).status).toBe(413);
    // (Streamed, with no length said up front.)
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(MAX_BYTES / 2 + 1));
        c.close();
      },
    });
    expect((await put(stream)).status).toBe(413);
    expect((await call("GET")).status).toBe(404);
  });

  it("wants a well-formed code, in the header", async () => {
    expect((await call("GET", { code: null })).status).toBe(400);
    expect((await call("GET", { code: "acorn badge otter 0420" })).status).toBe(400);
    expect((await call("GET", { code: "ACORN-BADGE-OTTER-0420" })).status).toBe(400);
    expect((await call("GET", { code: "acorn-badge-0420" })).status).toBe(400);
  });

  it("wants the bundle's time and save version", async () => {
    expect((await call("PUT", { body: "x" })).status).toBe(400);
    expect((await put("x", 0)).status).toBe(400);
    expect((await put("", 5)).status).toBe(400);
  });

  it("knows only its modes and paths", async () => {
    expect((await call("GET", { url: "https://cloud.test/v1/saves/other" })).status).toBe(404);
    expect((await call("GET", { url: "https://cloud.test/" })).status).toBe(404);
    expect((await call("DELETE")).status).toBe(405);
  });

  it("answers CORS only for the allowed pages", async () => {
    const pre = await call("OPTIONS", { code: null });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(pre.headers.get("Access-Control-Allow-Headers")).toContain("X-Woodrail-Code");
    expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
    // Any port on this machine.
    expect((await call("OPTIONS", { code: null, origin: "http://localhost:5397" })).headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5397");
    expect((await call("OPTIONS", { code: null, origin: "http://127.0.0.1:4100" })).status).toBe(204);
    expect((await call("OPTIONS", { code: null, origin: "http://localhost.evil.example" })).status).toBe(403);
    const evil = await call("GET", { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await call("OPTIONS", { origin: "https://evil.example" })).status).toBe(403);
  });
});
