/**
 * Crash reports (the game's side: src/feedback/crash.ts): when the game hits an uncaught error, or the browser takes
 * its drawing away (a lost WebGL context), it sends one small report, at most once a session, unless the player
 * switched them off in the ☰ menu.
 *
 *   POST /crash          a report: stored in R2, nothing else (no issue opened)
 *   GET  /crash          the latest reports, newest first: admin only (`Authorization: Bearer <ADMIN_KEY>`)
 *
 * A report holds only the error's message and stack, the game's build, the browser's user agent, the screen's size
 * and density, the drawing's pixel ratio and the graphics tier. No map, no save, no id of the player; the IP is used
 * only by the per-minute rate limiter (the same `FEEDBACK_LIMIT` binding, its own key).
 *
 * R2 keys: `crash/<newest first>-<id>.json`, so a list of the prefix comes newest first.
 */

import { readCapped } from "./body";
import { newId, type FeedbackEnv } from "./feedback";

/** A report's largest body (bytes). */
export const MAX_CRASH_BYTES = 8 * 1024;
export const MAX_MESSAGE = 300;
export const MAX_STACK = 2000;
/** The admin list's length. */
const LIST_SIZE = 100;
/** Larger than any time in ms for a long while: `MAX_TIME - now`, zero-padded, sorts newest first. */
const MAX_TIME = 9_999_999_999_999;

export type CrashKind = "error" | "rejection" | "context-lost";

export interface CrashReport {
  kind: CrashKind;
  message: string;
  stack: string;
  build: string;
  userAgent: string;
  screen: { width: number; height: number; dpr: number };
  pixelRatio: number;
  quality: string;
}

export interface StoredCrash extends CrashReport {
  id: string;
  at: string;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, max: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);

/** A posted body checked: the report (only its known fields, cut short), or what's wrong with it. */
export function parseCrash(raw: unknown): CrashReport | string {
  if (typeof raw !== "object" || raw === null) return "not an object";
  const b = raw as Record<string, unknown>;
  if (b.kind !== "error" && b.kind !== "rejection" && b.kind !== "context-lost") return "kind must be error, rejection or context-lost";
  const s = (typeof b.screen === "object" && b.screen !== null ? b.screen : {}) as Record<string, unknown>;
  return {
    kind: b.kind,
    message: str(b.message, MAX_MESSAGE),
    stack: str(b.stack, MAX_STACK),
    build: str(b.build, 40),
    userAgent: str(b.userAgent, 300),
    screen: { width: Math.round(num(s.width, 20000)), height: Math.round(num(s.height, 20000)), dpr: num(s.dpr, 10) },
    pixelRatio: num(b.pixelRatio, 10),
    quality: str(b.quality, 20),
  };
}

/** Where a report is kept: newest first in a list of `crash/`. */
export function crashKey(id: string, now: number): string {
  return `crash/${String(MAX_TIME - now).padStart(13, "0")}-${id}.json`;
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** /crash: `pageOk` is the feedback's origin check (the game's own homes, or no Origin). */
export async function handleCrash(request: Request, env: FeedbackEnv, cors: Record<string, string>, pageOk: boolean): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" } });
  }
  if (request.method === "GET") {
    const auth = request.headers.get("Authorization") ?? "";
    if (!env.ADMIN_KEY || !same(auth, `Bearer ${env.ADMIN_KEY}`)) return json(401, { error: "admin only" }, cors);
    const listed = await env.SAVES.list({ prefix: "crash/", limit: LIST_SIZE });
    const reports = await Promise.all(listed.objects.map(async (o) => (await env.SAVES.get(o.key))?.json<StoredCrash>()));
    return json(200, { reports: reports.filter(Boolean) }, cors);
  }
  if (request.method !== "POST") return json(405, { error: "POST or GET" }, cors);
  if (!pageOk) return json(403, { error: "origin not allowed" }, cors);
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_CRASH_BYTES) return json(413, { error: "too big" }, cors);
  if (env.FEEDBACK_LIMIT) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.FEEDBACK_LIMIT.limit({ key: `crash:${ip}` });
    if (!success) return json(429, { error: "too many reports" }, { ...cors, "Retry-After": "60" });
  }
  const bytes = await readCapped(request, MAX_CRASH_BYTES);
  if (bytes === null) return json(413, { error: "too big" }, cors);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(400, { error: "not JSON" }, cors);
  }
  const got = parseCrash(raw);
  if (typeof got === "string") return json(400, { error: got }, cors);
  const now = new Date();
  const id = newId(now);
  const stored: StoredCrash = { id, at: now.toISOString(), ...got };
  await env.SAVES.put(crashKey(id, now.getTime()), JSON.stringify(stored), { httpMetadata: { contentType: "application/json" } });
  return json(201, { id }, cors);
}
