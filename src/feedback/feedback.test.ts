import { describe, expect, it } from "vitest";
import { buildFeedback, feedbackBody, feedbackCopyText, fitSize, sendFeedback, FEEDBACK_MAX_TEXT, type FeedbackInput } from "./feedback";

const MAP = "woodrail-map:1:AAAA";
const input = (over: Partial<FeedbackInput> = {}): FeedbackInput => ({
  kind: "bug",
  text: "  The train fell off  ",
  map: MAP,
  includeMap: false,
  shot: "/9j/AAAA",
  mode: "game",
  build: "abc",
  userAgent: "UA",
  viewport: { width: 390.4, height: 844, dpr: 3 },
  badges: [],
  ...over,
});

describe("feedback payload", () => {
  it("always carries the map with a bug, and with an idea only if asked", () => {
    expect(buildFeedback(input()).map).toBe(MAP);
    expect(buildFeedback(input({ kind: "idea" })).map).toBeNull();
    expect(buildFeedback(input({ kind: "idea", includeMap: true })).map).toBe(MAP);
  });

  it("trims the note, rounds the screen, keeps the last ten badges", () => {
    const p = buildFeedback(input({ text: "x".repeat(FEEDBACK_MAX_TEXT + 50), badges: Array.from({ length: 12 }, (_, i) => `b${i}`) }));
    expect(p.text.length).toBe(FEEDBACK_MAX_TEXT);
    expect(p.viewport).toEqual({ width: 390, height: 844, dpr: 3 });
    expect(p.badges).toEqual(["b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10", "b11"]);
    expect(buildFeedback(input()).text).toBe("The train fell off");
  });

  it("drops the picture to fit the size cap, and gives up only if the rest is too big", () => {
    const p = buildFeedback(input({ shot: "A".repeat(1000) }));
    expect(feedbackBody(p, 5000)?.droppedShot).toBe(false);
    const fit = feedbackBody(p, 800);
    expect(fit?.droppedShot).toBe(true);
    expect(JSON.parse(fit!.body).shot).toBeNull();
    expect(JSON.parse(fit!.body).map).toBe(MAP);
    expect(feedbackBody(buildFeedback(input({ map: "woodrail-map:1:" + "A".repeat(900) })), 800)).toBeNull();
  });

  it("copies the note and map for Copy instead", () => {
    const t = feedbackCopyText(buildFeedback(input({ badges: ["no-overlap: train 3"] })));
    expect(t.startsWith("[bug] The train fell off\n")).toBe(true);
    expect(t).toContain("no-overlap: train 3");
    expect(t.endsWith(MAP)).toBe(true);
  });

  it("fits the picture in 1280 px, never larger", () => {
    expect(fitSize(2560, 1440)).toEqual({ width: 1280, height: 720 });
    expect(fitSize(1170, 2532)).toEqual({ width: 591, height: 1280 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("sending feedback", () => {
  it("posts JSON to /feedback and returns the id and issue", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "x1", issue: "https://github.com/i/1" }), { status: 200 });
    }) as typeof fetch;
    expect(await sendFeedback("https://w.test/", '{"a":1}', fake)).toEqual({ id: "x1", issue: "https://github.com/i/1" });
    expect(seen!.url).toBe("https://w.test/feedback");
    expect(seen!.init?.method).toBe("POST");
  });

  it("says why it failed", async () => {
    const answer = (status: number) => (async () => new Response("{}", { status })) as typeof fetch;
    await expect(sendFeedback("https://w.test", "{}", answer(429))).rejects.toThrow(/Too many/);
    await expect(sendFeedback("https://w.test", "{}", answer(413))).rejects.toThrow(/too big/);
    await expect(sendFeedback("https://w.test", "{}", answer(500))).rejects.toThrow(/500/);
    await expect(sendFeedback("https://w.test", "{}", (async () => { throw new TypeError("offline"); }) as typeof fetch)).rejects.toThrow(/online/);
  });
});
