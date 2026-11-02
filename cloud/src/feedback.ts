/**
 * "Report a bug or give feedback" (the game's side: src/feedback/feedback.ts and src/ui/feedback-sheet.ts).
 *
 *   POST /feedback                 a report from the game: stored in R2 under a new id, then (with GITHUB_TOKEN and
 *                                  GITHUB_REPO set) a GitHub issue opened for it
 *   GET  /feedback/:id             the report (its text and device info), as JSON
 *   GET  /feedback/:id/map         its map, the "Copy map for a bug report" text (`woodrail-map:1:…`)
 *   GET  /feedback/:id/shot.jpg    its picture of the game, if it has one
 *   GET  /feedback                 the latest reports, newest first: admin only (`Authorization: Bearer <ADMIN_KEY>`)
 *
 * An id is a time and 128 random bits: unguessable, so the links in a (public) issue are the only way to a report.
 * R2 keys: `feedback/<id>/report.json`, `feedback/<id>/map.txt`, `feedback/<id>/shot.jpg`, and
 * `feedback-index/<newest first>-<id>` (empty, its summary in its metadata) for the admin list.
 *
 * Limits: a body of 2 MB at most (413); a few reports a minute per IP (the `FEEDBACK_LIMIT` rate-limit binding; 429);
 * and at most `FEEDBACK_ISSUES_PER_DAY` issues a day: past that, reports are only stored.
 */

import { readCapped } from "./body";

/** A report's largest body (bytes): the map (a big railway gzips well under 200 KB), and a picture of 300 KB or so. */
export const MAX_FEEDBACK_BYTES = 2 * 1024 * 1024;
/** Its note's longest (characters). */
export const MAX_TEXT = 4000;
/** Its picture's largest (bytes, decoded). */
export const MAX_SHOT_BYTES = 600 * 1024;
/** Issues opened a day at most (UTC), whatever the per-IP limit lets through: past that, reports are stored only. */
export const FEEDBACK_ISSUES_PER_DAY = 40;
/** The admin list's length. */
const LIST_SIZE = 50;

export interface FeedbackEnv {
  SAVES: R2Bucket;
  /** Per-IP limit on POSTs (wrangler.toml `[[ratelimits]]`). Unset: none. */
  FEEDBACK_LIMIT?: RateLimit;
  /** A fine-grained GitHub token with Issues: read and write on the repo (`wrangler secret put GITHUB_TOKEN`). */
  GITHUB_TOKEN?: string;
  /** `owner/name` of the repo the issues go to. */
  GITHUB_REPO?: string;
  /** The admin list's key (`wrangler secret put ADMIN_KEY`). Unset: no list. */
  ADMIN_KEY?: string;
}

export type Kind = "bug" | "idea";

/** A report as stored (`report.json`): everything but the map and the picture, which are kept beside it. */
export interface StoredReport {
  id: string;
  at: string;
  kind: Kind;
  text: string;
  mode: string;
  build: string;
  userAgent: string;
  viewport: { width: number; height: number; dpr: number };
  badges: string[];
  hasMap: boolean;
  hasShot: boolean;
  /** The issue opened for it, or why there's none. */
  issue: string | null;
  issueError?: string;
}

/** A report as the game sends it, checked; the picture as bytes. */
export interface Incoming {
  report: Omit<StoredReport, "id" | "at" | "hasMap" | "hasShot" | "issue" | "issueError">;
  map: string | null;
  shot: Uint8Array | null;
}

const ID = /^\d{8}T\d{6}-[0-9a-f]{32}$/;
const MAP_TAG = "woodrail-map:1:";
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, max: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);

/** A posted body checked: the report, or what's wrong with it. */
export function parseFeedback(raw: unknown): Incoming | string {
  if (typeof raw !== "object" || raw === null) return "not an object";
  const b = raw as Record<string, unknown>;
  if (b.kind !== "bug" && b.kind !== "idea") return "kind must be bug or idea";
  if (typeof b.text !== "string" || b.text.trim() === "") return "no text";
  if (b.text.length > MAX_TEXT) return "text too long";
  let map: string | null = null;
  if (b.map !== undefined && b.map !== null) {
    if (typeof b.map !== "string" || !b.map.startsWith(MAP_TAG) || !/^[A-Za-z0-9+/=_-]*$/.test(b.map.slice(MAP_TAG.length))) return "map isn't a copied map";
    map = b.map;
  }
  if (b.kind === "bug" && map === null) return "a bug needs its map";
  let shot: Uint8Array | null = null;
  if (b.shot !== undefined && b.shot !== null) {
    if (typeof b.shot !== "string" || b.shot.length > Math.ceil((MAX_SHOT_BYTES * 4) / 3) + 4) return "picture too big";
    try {
      shot = Uint8Array.from(atob(b.shot), (c) => c.charCodeAt(0));
    } catch {
      return "picture isn't base64";
    }
    // A JPEG starts FF D8 FF.
    if (shot.length < 3 || shot[0] !== 0xff || shot[1] !== 0xd8 || shot[2] !== 0xff) return "picture isn't a JPEG";
  }
  const v = (typeof b.viewport === "object" && b.viewport !== null ? b.viewport : {}) as Record<string, unknown>;
  const badges = Array.isArray(b.badges) ? b.badges.filter((x): x is string => typeof x === "string").slice(0, 10).map((x) => x.slice(0, 300)) : [];
  return {
    report: {
      kind: b.kind,
      text: b.text.trim(),
      mode: b.mode === "game" || b.mode === "sandbox" ? b.mode : "",
      build: str(b.build, 40),
      userAgent: str(b.userAgent, 300),
      viewport: { width: Math.round(num(v.width, 20000)), height: Math.round(num(v.height, 20000)), dpr: num(v.dpr, 10) },
      badges,
    },
    map,
    shot,
  };
}

/** A new report id: when (UTC, to the second) and 128 random bits. */
export function newId(now = new Date()): string {
  const t = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const rand = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${t}-${rand}`;
}

/** The issue's title: "[bug] <first line>" or "[idea] …", cut to fit. */
export function issueTitle(kind: Kind, text: string): string {
  const first = text.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  return `[${kind}] ${first.length > 80 ? `${first.slice(0, 79)}…` : first}`;
}

/** The issue's body: the note (fenced, so it can't @mention anyone or carry markup), the device, and the links. */
export function issueBody(r: StoredReport, base: string): string {
  const longest = Math.max(2, ...[...r.text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const at = `${base}/feedback/${r.id}`;
  const lines = [
    `${fence}text`,
    r.text,
    fence,
    "",
    "| | |",
    "| --- | --- |",
    `| Kind | ${r.kind} |`,
    `| Mode | ${r.mode || "?"} |`,
    `| Build | \`${r.build.replace(/[`|]/g, "") || "?"}\` |`,
    `| Screen | ${r.viewport.width}×${r.viewport.height} @${r.viewport.dpr}x |`,
    `| Browser | \`${r.userAgent.replace(/[`|]/g, "") || "?"}\` |`,
    `| Report id | \`${r.id}\` |`,
  ];
  if (r.badges.length) lines.push("", "Recent problems the game noticed:", "", "```text", ...r.badges.map((b) => b.replace(/`/g, "'")), "```");
  lines.push("");
  if (r.hasMap) lines.push(`**Map:** ${at}/map — to replay it: \`npm run feedback -- ${at}/map\`, then \`npm run replay -- feedback-${r.id}.txt\``);
  if (r.hasShot) lines.push("", `![The game when this was sent](${at}/shot.jpg)`);
  lines.push("", "_Sent from the game's \"Report a bug or give feedback\"._");
  return lines.join("\n");
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Constant-time string compare (for the admin key). */
function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Count one more issue today; false when today's are used up (best effort: R2 has no atomic counter). */
async function issueAllowed(env: FeedbackEnv, now: Date): Promise<boolean> {
  const key = `feedback-day/${now.toISOString().slice(0, 10)}`;
  const cur = await env.SAVES.head(key);
  const n = Number(cur?.customMetadata?.issues ?? 0);
  if (n >= FEEDBACK_ISSUES_PER_DAY) return false;
  await env.SAVES.put(key, "", { customMetadata: { issues: String(n + 1) } });
  return true;
}

/** Open the report's issue: its URL, or throws with why not. */
async function openIssue(env: FeedbackEnv, r: StoredReport, base: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "woodrail-feedback",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: issueTitle(r.kind, r.text), body: issueBody(r, base), labels: ["feedback"] }),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  const made = (await res.json()) as { html_url?: string };
  return made.html_url ?? "";
}

/** POST /feedback. */
async function post(request: Request, env: FeedbackEnv, cors: Record<string, string>): Promise<Response> {
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_FEEDBACK_BYTES) return json(413, { error: "too big" }, cors);
  if (env.FEEDBACK_LIMIT) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.FEEDBACK_LIMIT.limit({ key: `feedback:${ip}` });
    if (!success) return json(429, { error: "too many reports: try again in a minute" }, { ...cors, "Retry-After": "60" });
  }
  const bytes = await readCapped(request, MAX_FEEDBACK_BYTES);
  if (bytes === null) return json(413, { error: "too big" }, cors);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(400, { error: "not JSON" }, cors);
  }
  const got = parseFeedback(raw);
  if (typeof got === "string") return json(400, { error: got }, cors);
  const now = new Date();
  const id = newId(now);
  const report: StoredReport = { id, at: now.toISOString(), ...got.report, hasMap: got.map !== null, hasShot: got.shot !== null, issue: null };
  const dir = `feedback/${id}`;
  if (got.map !== null) await env.SAVES.put(`${dir}/map.txt`, got.map, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  if (got.shot !== null) await env.SAVES.put(`${dir}/shot.jpg`, got.shot, { httpMetadata: { contentType: "image/jpeg" } });
  const base = new URL(request.url).origin;
  if (env.GITHUB_TOKEN && env.GITHUB_REPO && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO)) {
    if (await issueAllowed(env, now)) {
      try {
        report.issue = await openIssue(env, report, base);
      } catch (e) {
        report.issueError = String((e as Error).message ?? e).slice(0, 200);
      }
    } else report.issueError = "today's issues are used up";
  }
  await env.SAVES.put(`${dir}/report.json`, JSON.stringify(report), { httpMetadata: { contentType: "application/json" } });
  // Newest first in the admin list: the key counts down with time.
  const order = String(9_999_999_999_999 - now.getTime()).padStart(13, "0");
  await env.SAVES.put(`feedback-index/${order}-${id}`, "", { customMetadata: { at: report.at, kind: report.kind, title: issueTitle(report.kind, report.text), issue: report.issue ?? "" } });
  return json(200, { id, issue: report.issue }, cors);
}

/**
 * The feedback endpoints (any path under `/feedback`). `cors`: the headers for the page asking (empty for a page that
 * may not post: it's turned away).
 */
export async function handleFeedback(request: Request, env: FeedbackEnv, cors: Record<string, string>, originAllowed: boolean): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (request.method === "OPTIONS") {
    if (!originAllowed) return new Response("Origin not allowed", { status: 403 });
    return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
  }
  if (parts.length === 1 && request.method === "POST") {
    if (!originAllowed) return new Response("Origin not allowed", { status: 403 });
    return post(request, env, cors);
  }
  if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: "method not allowed" }, cors);
  if (parts.length === 1) {
    const auth = request.headers.get("Authorization") ?? "";
    if (!env.ADMIN_KEY || !same(auth, `Bearer ${env.ADMIN_KEY}`)) return json(401, { error: "needs the admin key" }, cors);
    const listed = await env.SAVES.list({ prefix: "feedback-index/", limit: LIST_SIZE, include: ["customMetadata"] });
    return json(200, listed.objects.map((o) => ({ id: o.key.replace(/^feedback-index\/\d+-/, ""), ...o.customMetadata })), cors);
  }
  const id = parts[1];
  if (!ID.test(id) || parts.length > 3) return json(404, { error: "no such report" }, cors);
  const file = parts.length === 2 ? "report.json" : parts[2] === "map" ? "map.txt" : parts[2] === "shot.jpg" ? "shot.jpg" : null;
  if (!file) return json(404, { error: "not found" }, cors);
  const obj = await env.SAVES.get(`feedback/${id}/${file}`);
  if (!obj) return json(404, { error: "not found" }, cors);
  const headers = new Headers(cors);
  headers.set("Content-Type", obj.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Cache-Control", "private, max-age=3600");
  // Never sniffed or framed: what's here is a player's.
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'");
  return new Response(request.method === "HEAD" ? null : obj.body, { status: 200, headers });
}
