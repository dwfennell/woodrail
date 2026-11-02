/**
 * Woodrail's cloud saves: one gzipped bundle per sync code and mode, in R2.
 *
 *   PUT  /v1/saves/:mode         store a bundle (the one it replaces is kept as `<mode>.prev`)
 *   GET  /v1/saves/:mode         the bundle (`?prev=1`: the one before it)
 *   HEAD /v1/saves/:mode         just its headers: what's there, without the bytes
 *   POST /v1/stats               anonymous play stats, from players who said yes (stats.ts)
 *   /feedback…                   "Report a bug or give feedback": reports, their maps and pictures (feedback.ts)
 *
 * The sync code is the only key: sent in `X-Woodrail-Code` (never in the URL, so it stays out of logs), and stored only
 * as an HMAC under the Worker's secret `CODE_KEY` (so the bucket's keys can't be tried against codes without it). The bundle is opaque here: the game gzips it, and checks it when it loads it. What the Worker keeps beside
 * it, and answers in headers: `X-Saved-At` (ms, when the game made the bundle), `X-Save-Version` (the game's save
 * format) and `X-Game-Version` (its build).
 *
 * A PUT says whether its copy has a layout edit (`X-Edit-Kind: layout`) or only the game's progress (`progress`), and
 * the Worker keeps when a layout one was last stored (`X-Layout-At`), so the games can rank a conflict.
 *
 * A PUT may say which copy it was made from (`X-Base-Saved-At`: that copy's `X-Saved-At`, 0 for none): if another has
 * been stored since, it's turned away (409), so a device never writes over a copy it hasn't seen.
 */

import { readCapped } from "./body";
import { handleFeedback, type FeedbackEnv } from "./feedback";
import { MAX_BYTES, MIN_PUT_INTERVAL_MS, MODES } from "./limits";
import { handleStats, type StatsEnv } from "./stats";

export interface Env extends StatsEnv, FeedbackEnv {
  SAVES: R2Bucket;
  /** The pages that may call the Worker, comma separated (`https://example.com,http://localhost:5173`). */
  ALLOWED_ORIGINS: string;
  /** The secret the codes are keyed under (`wrangler secret put CODE_KEY`; `npm run dev` passes a local one). */
  CODE_KEY: string;
}

/** Three words of 3 to 5 letters and four digits, as the game sends it (lowercase, hyphenated): about 43 bits. */
const CODE = /^[a-z]{3,5}-[a-z]{3,5}-[a-z]{3,5}-\d{4}$/;
const PATH = /^\/v1\/saves\/([a-z]+)$/;
const EXPOSED = "X-Saved-At, X-Save-Version, X-Game-Version, X-Stored-At, X-Layout-At, X-Layout-Stored-At, X-Server-Now";
/** Any port on this machine (the dev server, a preview, a test's own): a page there is the developer's. */
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
/**
 * Where else the game is served, for feedback only (saves stay with `ALLOWED_ORIGINS`): itch.io (its games are served
 * from shared CDN hosts) and a claude.ai artifact (served from claude's own content hosts).
 */
const FEEDBACK_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(itch\.zone|itch\.io|hwcdn\.net|claudeusercontent\.com|claude\.ai)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    // Play stats (stats.ts): from any page, so not behind the saves' origin check.
    if (new URL(request.url).pathname === "/v1/stats") return handleStats(request, env, { "Access-Control-Allow-Origin": "*" });
    const allowed = origin !== null && (LOCAL.test(origin) || env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).includes(origin));
    // Feedback (feedback.ts): from the saves' pages and the game's other homes; a request with no Origin (curl, the
    // fetch script) is let through, as for saves. Its maps and pictures are read by unguessable id, from anywhere.
    const path = new URL(request.url).pathname;
    if (path === "/feedback" || path.startsWith("/feedback/")) {
      const pageOk = origin === null || allowed || FEEDBACK_HOSTS.test(origin);
      const cors: Record<string, string> = origin !== null && pageOk ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { "Access-Control-Allow-Origin": "*" };
      return handleFeedback(request, env, cors, pageOk);
    }
    const cors = (res: Response): Response => {
      // (The Worker's clock, so a game can tell how far off its own is: see `X-Stored-At`.)
      res.headers.set("X-Server-Now", String(Date.now()));
      if (allowed) {
        res.headers.set("Access-Control-Allow-Origin", origin);
        res.headers.set("Access-Control-Expose-Headers", EXPOSED);
        res.headers.set("Vary", "Origin");
      }
      return res;
    };
    // A browser page from anywhere else is turned away (a request with no Origin, curl say, is let through: CORS guards
    // pages, and the code is the key either way).
    if (origin !== null && !allowed) return new Response("Origin not allowed", { status: 403 });
    if (request.method === "OPTIONS") {
      return cors(
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Methods": "GET, HEAD, PUT, OPTIONS",
            "Access-Control-Allow-Headers": "X-Woodrail-Code, X-Saved-At, X-Save-Version, X-Game-Version, X-Base-Saved-At, X-Edit-Kind, X-Edited-At, Content-Type",
            "Access-Control-Max-Age": "86400",
          },
        }),
      );
    }
    return cors(await handle(request, env));
  },
};

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const m = PATH.exec(url.pathname);
  if (!m) return text(404, "Not found");
  const mode = m[1];
  if (!(MODES as readonly string[]).includes(mode)) return text(404, "No such mode");
  const code = request.headers.get("X-Woodrail-Code") ?? "";
  if (!CODE.test(code)) return text(400, "Missing or malformed code");
  if (!env.CODE_KEY) return text(500, "Not set up: CODE_KEY");
  const key = `saves/${await hmac(env.CODE_KEY, code)}/${mode}`;

  if (request.method === "GET" || request.method === "HEAD") {
    const name = url.searchParams.get("prev") === "1" ? `${key}.prev` : key;
    const obj = request.method === "GET" ? await env.SAVES.get(name) : await env.SAVES.head(name);
    if (!obj) return text(404, "Nothing saved");
    const headers = metaHeaders(obj);
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Length", String(obj.size));
    headers.set("Cache-Control", "no-store");
    return new Response(request.method === "GET" ? (obj as R2ObjectBody).body : null, { status: 200, headers });
  }

  if (request.method === "PUT") {
    const savedAt = Number(request.headers.get("X-Saved-At"));
    const saveVersion = Number(request.headers.get("X-Save-Version"));
    if (!Number.isSafeInteger(savedAt) || savedAt <= 0 || !Number.isSafeInteger(saveVersion) || saveVersion <= 0) return text(400, "Missing X-Saved-At or X-Save-Version");
    const declared = Number(request.headers.get("Content-Length") ?? NaN);
    if (declared > MAX_BYTES) return text(413, "Too big");
    const body = await readCapped(request, MAX_BYTES);
    if (body === null) return text(413, "Too big");
    if (body.byteLength === 0) return text(400, "Empty");
    const current = await env.SAVES.head(key);
    const base = request.headers.get("X-Base-Saved-At");
    if (base !== null && base !== (current?.customMetadata?.savedAt ?? "0")) return text(409, "Changed since");
    const now = Date.now();
    if (current && now - Number(current.customMetadata?.putAt ?? 0) < MIN_PUT_INTERVAL_MS) {
      return text(429, "Too soon", { "Retry-After": String(Math.ceil(MIN_PUT_INTERVAL_MS / 1000)) });
    }
    // (Read before it's replaced: kept one step back once the new one's in.)
    const old = current ? await env.SAVES.get(key) : null;
    const oldBody = old ? await old.arrayBuffer() : null;
    const gameVersion = (request.headers.get("X-Game-Version") ?? "").slice(0, 40);
    // When a copy with a layout edit (the player's, not just the game's progress) was last stored: carried on by a
    // progress-only one, so a game can tell if there's been a layout edit since the copy it last had.
    // Two times for it: when that layout edit was made (`X-Edited-At`, on the Worker's clock: the game converts it; never
    // later than now), to tell which of two edits came later; and when it was stored, to tell if there's been one since
    // a copy a game had.
    const progressOnly = request.headers.get("X-Edit-Kind") === "progress";
    const editedAt = Number(request.headers.get("X-Edited-At"));
    const layoutAt = progressOnly ? (current?.customMetadata?.layoutAt ?? "0") : String(Number.isSafeInteger(editedAt) && editedAt > 0 ? Math.min(editedAt, now) : now);
    const layoutStoredAt = progressOnly ? (current?.customMetadata?.layoutStoredAt ?? "0") : String(now);
    // Only over the copy checked above, or only if there's still none: another PUT that got in between wins, and this
    // one is a 409.
    const stored = await env.SAVES.put(key, body, {
      customMetadata: { savedAt: String(savedAt), saveVersion: String(saveVersion), gameVersion, putAt: String(now), layoutAt, layoutStoredAt },
      onlyIf: current ? { etagMatches: current.etag } : { etagDoesNotMatch: "*" },
    });
    if (stored === null) return text(409, "Changed since");
    if (old && oldBody) await env.SAVES.put(`${key}.prev`, oldBody, { customMetadata: old.customMetadata });
    return text(200, "Saved", { "X-Stored-At": String(now) });
  }

  return text(405, "Method not allowed", { Allow: "GET, HEAD, PUT, OPTIONS" });
}

function metaHeaders(obj: R2Object): Headers {
  const meta = obj.customMetadata ?? {};
  // (`X-Stored-At`: when the Worker stored it, by its own clock: games compare edits by it, not by each other's clocks.)
  return new Headers({ "X-Saved-At": meta.savedAt ?? "0", "X-Save-Version": meta.saveVersion ?? "0", "X-Game-Version": meta.gameVersion ?? "", "X-Stored-At": meta.putAt ?? "0", "X-Layout-At": meta.layoutAt ?? "0", "X-Layout-Stored-At": meta.layoutStoredAt ?? "0" });
}

async function hmac(secret: string, s: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
