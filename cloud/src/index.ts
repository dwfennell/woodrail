/**
 * Woodrail's cloud saves: one gzipped bundle per sync code and mode, in R2.
 *
 *   PUT  /v1/saves/:mode         store a bundle (the one it replaces is kept as `<mode>.prev`)
 *   GET  /v1/saves/:mode         the bundle (`?prev=1`: the one before it)
 *   HEAD /v1/saves/:mode         just its headers: what's there, without the bytes
 *
 * The sync code is the only key: sent in `X-Woodrail-Code` (never in the URL, so it stays out of logs), and stored only
 * hashed. The bundle is opaque here: the game gzips it, and checks it when it loads it. What the Worker keeps beside
 * it, and answers in headers: `X-Saved-At` (ms, when the game made the bundle), `X-Save-Version` (the game's save
 * format) and `X-Game-Version` (its build).
 *
 * A PUT may say which copy it was made from (`X-Base-Saved-At`: that copy's `X-Saved-At`, 0 for none): if another has
 * been stored since, it's turned away (409), so a device never writes over a copy it hasn't seen.
 */

import { MAX_BYTES, MIN_PUT_INTERVAL_MS, MODES } from "./limits";

export interface Env {
  SAVES: R2Bucket;
  /** The pages that may call the Worker, comma separated (`https://example.com,http://localhost:5173`). */
  ALLOWED_ORIGINS: string;
}

/** Three words of 3 to 5 letters and four digits, as the game sends it (lowercase, hyphenated): about 43 bits. */
const CODE = /^[a-z]{3,5}-[a-z]{3,5}-[a-z]{3,5}-\d{4}$/;
const PATH = /^\/v1\/saves\/([a-z]+)$/;
const EXPOSED = "X-Saved-At, X-Save-Version, X-Game-Version";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed = origin !== null && env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).includes(origin);
    const cors = (res: Response): Response => {
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
            "Access-Control-Allow-Headers": "X-Woodrail-Code, X-Saved-At, X-Save-Version, X-Game-Version, X-Base-Saved-At, Content-Type",
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
  const key = `saves/${await sha256(code)}/${mode}`;

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
    // The one it replaces is kept, one step back.
    if (current) {
      const old = await env.SAVES.get(key);
      if (old) await env.SAVES.put(`${key}.prev`, old.body, { customMetadata: old.customMetadata });
    }
    const gameVersion = (request.headers.get("X-Game-Version") ?? "").slice(0, 40);
    await env.SAVES.put(key, body, { customMetadata: { savedAt: String(savedAt), saveVersion: String(saveVersion), gameVersion, putAt: String(now) } });
    return text(200, "Saved");
  }

  return text(405, "Method not allowed", { Allow: "GET, HEAD, PUT, OPTIONS" });
}

function metaHeaders(obj: R2Object): Headers {
  const meta = obj.customMetadata ?? {};
  return new Headers({ "X-Saved-At": meta.savedAt ?? "0", "X-Save-Version": meta.saveVersion ?? "0", "X-Game-Version": meta.gameVersion ?? "" });
}

/** The body, or null once it runs past `max` bytes (Content-Length can be missing, or wrong). */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

async function sha256(s: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
