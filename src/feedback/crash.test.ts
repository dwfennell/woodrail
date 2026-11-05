import { beforeEach, describe, expect, it } from "vitest";
import { cleanStack, CrashReporter, crashPayload, MAX_MESSAGE, setCrashReportsOff } from "./crash";

const about = () => ({ build: "abc", userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 10)", screen: { width: 412, height: 923, dpr: 2.625 }, pixelRatio: 2, quality: "mobile" });

/** In-memory storage, for node. */
function storage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, get length() { return m.size; } } as Storage;
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = storage();
  (globalThis as { sessionStorage?: Storage }).sessionStorage = storage();
});

describe("crash reports", () => {
  it("cut links in a stack to file:line, with no host, query or #map", () => {
    const s = cleanStack("Error: x\n    at f (https://html-classic.itch.zone/html/123/assets/index-Ab.js?v=2:10:5)\n    at g (http://localhost:5173/src/main.ts#load=woodrail-map:1:AAAA:3:1)");
    expect(s).toContain("at f (index-Ab.js:10:5)");
    expect(s).toContain("at g (main.ts)");
    expect(s).not.toMatch(/itch\.zone|localhost|woodrail-map/);
  });

  it("send only the error and the device: no map, no save", () => {
    const p = crashPayload("error", new Error("y".repeat(400)), about());
    expect(Object.keys(p).sort()).toEqual(["build", "kind", "message", "pixelRatio", "quality", "screen", "stack", "userAgent"]);
    expect(p.message.length).toBe(MAX_MESSAGE);
  });

  it("go once a session, and not when switched off", () => {
    const sent: string[] = [];
    const r = new CrashReporter("https://cloud.test/", about, (url, body) => sent.push(`${url} ${body}`));
    expect(r.report("context-lost", { message: "WebGL context lost" })).toBe(true);
    expect(r.report("error", new Error("again"))).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^https:\/\/cloud\.test\/crash \{"kind":"context-lost"/);
    // A reload in the same tab: still sent.
    expect(new CrashReporter("https://cloud.test", about, (u) => sent.push(u)).report("error", new Error("z"))).toBe(false);
    sessionStorage.clear();
    setCrashReportsOff(true);
    expect(new CrashReporter("https://cloud.test", about, (u) => sent.push(u)).report("error", new Error("z"))).toBe(false);
    expect(sent).toHaveLength(1);
  });
});
