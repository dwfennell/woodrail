/**
 * Railway snapshots: now and then, a copy of the railway of a player who shares play stats and their railway ("Help
 * improve Woodrail"; the game's side is src/stats/snapshots.ts), to see what people build. Game mode only, and only
 * once they've joined two towns and put an engine on the track.
 *
 *   POST /v1/snapshots               a snapshot: stored in R2, nothing else
 *   GET  /v1/snapshots               the latest, newest first, across devices: admin only
 *   GET  /v1/snapshots/:id           one device's, newest first: admin only
 *   GET  /v1/snapshots/:id/:at       its map, the "Copy map for a bug report" text (`woodrail-map:1:…`): admin only
 *
 * (Admin: `Authorization: Bearer <ADMIN_KEY>`. Unlike feedback, nothing here is public: there's no issue to link it
 * from.)
 *
 * `:id` is the stats' random device id (16 hex digits), the same as a stats batch's. A snapshot holds the map, the
 * goals done, why it was sent (a goal ticked, or a while of building), the build, host and device: no names, no
 * codes; the IP is used only by the rate limiter (the `FEEDBACK_LIMIT` binding, its own key).
 *
 * R2 keys: `snapshots/<id>/<at>.txt` (the map, its summary in its metadata) and `snapshots-index/<at>-<id>` (empty,
 * the same metadata) for the latest across devices. `<at>` counts down with time, so a list comes newest first.
 *
 * Limits: a body of 1 MB at most (413); a few a minute per IP (429); `MAX_PER_DEVICE` a device, then turned away
 * (429; the game stops at fewer).
 */

import { readCapped } from "./body";
import type { FeedbackEnv } from "./feedback";

/** A snapshot's largest body (bytes): a big railway's map gzips to well under 200 KB. */
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;
/** Snapshots kept a device at most (the game sends 20 at most). */
export const MAX_PER_DEVICE = 30;
/** The admin lists' length. */
const LIST_SIZE = 100;
/** Larger than any time in ms for a long while: `MAX_TIME - now`, zero-padded, sorts newest first. */
const MAX_TIME = 9_999_999_999_999;

const ID = /^[0-9a-f]{16}$/;
const AT = /^\d{13}$/;
const MAP_TAG = "woodrail-map:1:";
const word = (v: unknown, max = 24): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, max: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);

/** A snapshot as posted, checked. */
export interface Snapshot {
  id: string;
  map: string;
  /** Goals done when it was taken. */
  goals: number;
  /** Why it was sent: `goal:<id>`, or `building`. */
  why: string;
  build: string;
  host: string;
  device: string;
}

/** A posted body checked: the snapshot (only its known fields, cut short), or what's wrong with it. */
export function parseSnapshot(raw: unknown): Snapshot | string {
  if (typeof raw !== "object" || raw === null) return "not an object";
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== "string" || !ID.test(b.id)) return "id must be 16 hex digits";
  if (typeof b.map !== "string" || !b.map.startsWith(MAP_TAG) || !/^[A-Za-z0-9+/=_-]+$/.test(b.map.slice(MAP_TAG.length))) return "map isn't a copied map";
  return { id: b.id, map: b.map, goals: num(b.goals, 1000), why: word(b.why, 80), build: word(b.build, 40), host: word(b.host), device: word(b.device) };
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

async function post(request: Request, env: FeedbackEnv, cors: Record<string, string>): Promise<Response> {
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_SNAPSHOT_BYTES) return json(413, { error: "too big" }, cors);
  if (env.FEEDBACK_LIMIT) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.FEEDBACK_LIMIT.limit({ key: `snapshot:${ip}` });
    if (!success) return json(429, { error: "too many" }, { ...cors, "Retry-After": "60" });
  }
  const bytes = await readCapped(request, MAX_SNAPSHOT_BYTES);
  if (bytes === null) return json(413, { error: "too big" }, cors);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(400, { error: "not JSON" }, cors);
  }
  const got = parseSnapshot(raw);
  if (typeof got === "string") return json(400, { error: got }, cors);
  const dir = `snapshots/${got.id}/`;
  const kept = await env.SAVES.list({ prefix: dir, limit: MAX_PER_DEVICE });
  if (kept.objects.length >= MAX_PER_DEVICE) return json(429, { error: "enough from this device" }, cors);
  const now = Date.now();
  const at = String(MAX_TIME - now).padStart(13, "0");
  const meta = { at: new Date(now).toISOString(), goals: String(got.goals), why: got.why, build: got.build, host: got.host, device: got.device, bytes: String(got.map.length) };
  await env.SAVES.put(`${dir}${at}.txt`, got.map, { httpMetadata: { contentType: "text/plain; charset=utf-8" }, customMetadata: meta });
  await env.SAVES.put(`snapshots-index/${at}-${got.id}`, "", { customMetadata: meta });
  return json(201, { at }, cors);
}

/**
 * The snapshot endpoints (`/v1/snapshots…`). `pageOk`: feedback's origin check (the game's own homes, or no Origin),
 * for a POST.
 */
export async function handleSnapshots(request: Request, env: FeedbackEnv, cors: Record<string, string>, pageOk: boolean): Promise<Response> {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean).slice(2);
  if (request.method === "OPTIONS") {
    if (!pageOk) return new Response("Origin not allowed", { status: 403 });
    return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" } });
  }
  if (request.method === "POST" && parts.length === 0) {
    if (!pageOk) return json(403, { error: "origin not allowed" }, cors);
    return post(request, env, cors);
  }
  if (request.method !== "GET") return json(405, { error: "POST or GET" }, cors);
  const auth = request.headers.get("Authorization") ?? "";
  if (!env.ADMIN_KEY || !same(auth, `Bearer ${env.ADMIN_KEY}`)) return json(401, { error: "admin only" }, cors);
  if (parts.length === 0) {
    const listed = await env.SAVES.list({ prefix: "snapshots-index/", limit: LIST_SIZE, include: ["customMetadata"] });
    return json(200, listed.objects.map((o) => {
      const [at, id] = o.key.slice("snapshots-index/".length).split("-");
      return { id, key: at, ...o.customMetadata };
    }), cors);
  }
  const id = parts[0];
  if (!ID.test(id) || parts.length > 2) return json(404, { error: "not found" }, cors);
  if (parts.length === 1) {
    const listed = await env.SAVES.list({ prefix: `snapshots/${id}/`, limit: LIST_SIZE, include: ["customMetadata"] });
    return json(200, listed.objects.map((o) => ({ id, key: o.key.slice(`snapshots/${id}/`.length, -".txt".length), ...o.customMetadata })), cors);
  }
  if (!AT.test(parts[1])) return json(404, { error: "not found" }, cors);
  const obj = await env.SAVES.get(`snapshots/${id}/${parts[1]}.txt`);
  if (!obj) return json(404, { error: "not found" }, cors);
  return new Response(obj.body, { status: 200, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
