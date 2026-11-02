import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { FEEDBACK_ISSUES_PER_DAY, issueBody, issueTitle, MAX_FEEDBACK_BYTES, parseFeedback, type StoredReport } from "../src/feedback";

const BASE = "https://cloud.test";
const MAP = "woodrail-map:1:H4sIAAAAAAAAA6tWKkotLs3JUbJSSs7PS8tMLy1KLVLSUUpJLElUslIqS8wpTtVRSs7PS0nNA4qVFqUCAJ8V0mExAAAA";
/** A tiny JPEG's first bytes (enough for the check: FF D8 FF), base64. */
const SHOT = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1));

const report = (over: Record<string, unknown> = {}) => ({
  kind: "bug",
  text: "The train fell off the bridge\nIt was going fast",
  map: MAP,
  shot: SHOT,
  mode: "game",
  build: "abc1234",
  userAgent: "Mozilla/5.0 (iPhone)",
  viewport: { width: 390, height: 844, dpr: 3 },
  badges: ["no-overlap: train 3 (12.0 s)"],
  ...over,
});
/** Each post from an IP of its own (the real per-IP limiter is on in these tests). */
let ip = 0;
const post = (body: unknown, e: Record<string, unknown> = {}, origin: string | null = "https://dwfennell.github.io") =>
  worker.fetch(
    new Request(`${BASE}/feedback`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.0.0.${++ip}`, ...(origin ? { Origin: origin } : {}) } }),
    { ...env, ...e } as typeof env,
  );
const get = (path: string, headers: Record<string, string> = {}, e: Record<string, unknown> = {}) => worker.fetch(new Request(`${BASE}${path}`, { headers }), { ...env, ...e } as typeof env);

/** GitHub's API, mocked: what was posted to it, and what it answers. */
function mockGitHub(status = 201) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ html_url: "https://github.com/dwfennell/woodrail/issues/77" }), { status });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("feedback: the checks", () => {
  it("takes a well-formed report, and turns away a bad one", () => {
    const ok = parseFeedback(report());
    expect(typeof ok).toBe("object");
    if (typeof ok === "string") return;
    expect(ok.map).toBe(MAP);
    expect(ok.shot?.[0]).toBe(0xff);
    expect(ok.report.viewport).toEqual({ width: 390, height: 844, dpr: 3 });
    expect(parseFeedback(report({ kind: "rant" }))).toBe("kind must be bug or idea");
    expect(parseFeedback(report({ text: "  " }))).toBe("no text");
    expect(parseFeedback(report({ map: undefined }))).toBe("a bug needs its map");
    expect(typeof parseFeedback(report({ kind: "idea", map: undefined }))).toBe("object");
    expect(parseFeedback(report({ map: "hello" }))).toBe("map isn't a copied map");
    expect(parseFeedback(report({ shot: btoa("PNG...") }))).toBe("picture isn't a JPEG");
    expect(parseFeedback(report({ text: "x".repeat(5000) }))).toBe("text too long");
  });

  it("titles and bodies an issue without letting the note @mention or mark up", () => {
    expect(issueTitle("bug", "\n  The train fell off  \nmore")).toBe("[bug] The train fell off");
    expect(issueTitle("idea", "y".repeat(200)).length).toBe("[idea] ".length + 80);
    const r: StoredReport = { id: "20261102T101010-" + "a".repeat(32), at: "", kind: "bug", text: "@someone ```oops``` <b>", mode: "game", build: "b1", userAgent: "UA", viewport: { width: 1, height: 2, dpr: 1 }, badges: ["x"], hasMap: true, hasShot: true, issue: null };
    const body = issueBody(r, BASE);
    expect(body).toMatch(/^````text\n@someone ```oops``` <b>\n````/);
    expect(body).toContain(`${BASE}/feedback/${r.id}/map`);
    expect(body).toContain(`![The game when this was sent](${BASE}/feedback/${r.id}/shot.jpg)`);
  });
});

describe("feedback: the endpoint", () => {
  it("with no token, stores the report, its map and picture under an unguessable id", async () => {
    const calls = mockGitHub();
    const res = await post(report());
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://dwfennell.github.io");
    const { id, issue } = (await res.json()) as { id: string; issue: string | null };
    expect(id).toMatch(/^\d{8}T\d{6}-[0-9a-f]{32}$/);
    expect(issue).toBeNull();
    expect(calls).toHaveLength(0);
    expect(await (await get(`/feedback/${id}/map`)).text()).toBe(MAP);
    const shot = await get(`/feedback/${id}/shot.jpg`);
    expect(shot.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await shot.arrayBuffer())[1]).toBe(0xd8);
    const stored = (await (await get(`/feedback/${id}`)).json()) as StoredReport;
    expect(stored).toMatchObject({ id, kind: "bug", mode: "game", hasMap: true, hasShot: true, issue: null, badges: ["no-overlap: train 3 (12.0 s)"] });
    expect((await get(`/feedback/20261102T101010-${"0".repeat(32)}/map`)).status).toBe(404);
    expect((await get(`/feedback/not-an-id/map`)).status).toBe(404);
  });

  it("with a token, opens an issue on the repo, labelled feedback, linking the map and picture", async () => {
    const calls = mockGitHub();
    const res = await post(report(), { GITHUB_TOKEN: "test-token", GITHUB_REPO: "dwfennell/woodrail" });
    const { id, issue } = (await res.json()) as { id: string; issue: string };
    expect(issue).toBe("https://github.com/dwfennell/woodrail/issues/77");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.github.com/repos/dwfennell/woodrail/issues");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    const sent = JSON.parse(String(calls[0].init.body)) as { title: string; body: string; labels: string[] };
    expect(sent.title).toBe("[bug] The train fell off the bridge");
    expect(sent.labels).toEqual(["feedback"]);
    expect(sent.body).toContain(`${BASE}/feedback/${id}/map`);
    expect(sent.body).toContain(`${BASE}/feedback/${id}/shot.jpg`);
    expect(sent.body).toContain("390×844");
    expect(((await (await get(`/feedback/${id}`)).json()) as StoredReport).issue).toBe(issue);
  });

  it("keeps the report when GitHub fails, and says why", async () => {
    mockGitHub(403);
    const res = await post(report({ kind: "idea", map: undefined, shot: undefined, text: "More bridges" }), { GITHUB_TOKEN: "t", GITHUB_REPO: "dwfennell/woodrail" });
    expect(res.status).toBe(200);
    const { id, issue } = (await res.json()) as { id: string; issue: null };
    expect(issue).toBeNull();
    const stored = (await (await get(`/feedback/${id}`)).json()) as StoredReport;
    expect(stored).toMatchObject({ kind: "idea", hasMap: false, hasShot: false, issueError: "GitHub said 403" });
    expect((await get(`/feedback/${id}/map`)).status).toBe(404);
  });

  it("opens no more than a day's issues", async () => {
    const day = `feedback-day/${new Date().toISOString().slice(0, 10)}`;
    await env.SAVES.put(day, "", { customMetadata: { issues: String(FEEDBACK_ISSUES_PER_DAY) } });
    const calls = mockGitHub();
    const res = await post(report(), { GITHUB_TOKEN: "t", GITHUB_REPO: "dwfennell/woodrail" });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
    await env.SAVES.delete(day);
  });

  it("caps the size, and turns away a bad body", async () => {
    mockGitHub();
    const big = await post(report({ text: "x", badges: ["y".repeat(MAX_FEEDBACK_BYTES)] }));
    expect(big.status).toBe(413);
    expect((await post("not json")).status).toBe(400);
    expect((await post(report({ kind: "rant" }))).status).toBe(400);
  });

  it("rate-limits by IP", async () => {
    mockGitHub();
    let blocked = 0;
    const limiter = { limit: async ({ key }: { key: string }) => ({ success: !key.endsWith("1.2.3.4") }) };
    const req = (ip: string) =>
      worker.fetch(new Request(`${BASE}/feedback`, { method: "POST", body: JSON.stringify(report()), headers: { "CF-Connecting-IP": ip } }), { ...env, FEEDBACK_LIMIT: limiter } as unknown as typeof env);
    const a = await req("1.2.3.4");
    if (a.status === 429) blocked++;
    expect(a.headers.get("Retry-After")).toBe("60");
    expect((await req("5.6.7.8")).status).toBe(200);
    expect(blocked).toBe(1);
    // And the real binding (wrangler.toml), in Miniflare: past its limit a minute, a 429.
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await worker.fetch(new Request(`${BASE}/feedback`, { method: "POST", body: JSON.stringify(report()), headers: { "CF-Connecting-IP": "9.9.9.9" } }), env)).status);
    expect(statuses).toContain(429);
  });

  it("answers the game's pages (Pages, itch, a claude.ai artifact, localhost) and turns others away", async () => {
    mockGitHub();
    for (const o of ["https://dwfennell.github.io", "https://html-classic.itch.zone", "https://v6p9d9t4.ssl.hwcdn.net", "https://abc.claudeusercontent.com", "http://localhost:5173"]) {
      const pre = await worker.fetch(new Request(`${BASE}/feedback`, { method: "OPTIONS", headers: { Origin: o } }), env);
      expect(pre.status, o).toBe(204);
      expect(pre.headers.get("Access-Control-Allow-Origin")).toBe(o);
      expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    }
    expect((await post(report(), {}, "https://evil.example")).status).toBe(403);
    // (Saves keep their own, narrower, list.)
    expect((await worker.fetch(new Request(`${BASE}/v1/saves/game`, { headers: { Origin: "https://html-classic.itch.zone", "X-Woodrail-Code": "acorn-badge-otter-0420" } }), env)).status).toBe(403);
  });

  it("lists the latest reports, newest first, only with the admin key", async () => {
    mockGitHub();
    expect((await get("/feedback")).status).toBe(401);
    expect((await get("/feedback", { Authorization: "Bearer wrong" }, { ADMIN_KEY: "k" })).status).toBe(401);
    const one = ((await (await post(report({ text: "first" }))).json()) as { id: string }).id;
    await new Promise((r) => setTimeout(r, 5));
    const two = ((await (await post(report({ text: "second" }))).json()) as { id: string }).id;
    const list = (await (await get("/feedback", { Authorization: "Bearer k" }, { ADMIN_KEY: "k" })).json()) as { id: string; title: string }[];
    const ids = list.map((r) => r.id);
    expect(ids.indexOf(two)).toBeLessThan(ids.indexOf(one));
    expect(list.find((r) => r.id === two)?.title).toBe("[bug] second");
  });
});
