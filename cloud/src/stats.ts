/**
 * POST /v1/stats: a batch of anonymous play stats from a game whose player said yes ("Help improve Woodrail"; the
 * game's side is src/stats/stats.ts). Each event is one data point in Workers Analytics Engine (binding `STATS`),
 * read with its SQL API (see docs/stats.md). Nothing is kept here: no R2, no logs of the body.
 *
 * Any page may send (it's write-only and anonymous, and itch serves every game from one shared origin). A batch is
 * checked and trimmed: a malformed one is turned away, unknown events are skipped, strings are cut short.
 */

/** A batch's largest size (bytes). */
export const MAX_STATS_BYTES = 16 * 1024;
/** Events a batch at most (the game sends 50 at most). */
export const MAX_STATS_EVENTS = 50;

export interface StatsEnv {
  /** Unset (not configured): batches are accepted and dropped. */
  STATS?: AnalyticsEngineDataset;
}

const ID = /^[0-9a-f]{16}$/;
const word = (v: unknown, max = 24): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * One data point per event. blobs: [event, mode, detail (goal id or error), build, host, device]; doubles: [value
 * (goal count, minutes), fresh (1/0)]; index: the device's random id (so players can be counted, and sampled
 * together).
 */
export function points(batch: unknown): AnalyticsEngineDataPoint[] | null {
  if (typeof batch !== "object" || batch === null) return null;
  const b = batch as Record<string, unknown>;
  if (typeof b.id !== "string" || !ID.test(b.id) || !Array.isArray(b.events) || b.events.length > MAX_STATS_EVENTS) return null;
  const common = [word(b.build), word(b.host), word(b.device)];
  const out: AnalyticsEngineDataPoint[] = [];
  for (const raw of b.events) {
    if (typeof raw !== "object" || raw === null) continue;
    const ev = raw as Record<string, unknown>;
    switch (ev.e) {
      case "start":
        out.push({ indexes: [b.id], blobs: ["start", word(ev.mode), "", ...common], doubles: [0, ev.fresh === true ? 1 : 0] });
        break;
      case "goal":
        out.push({ indexes: [b.id], blobs: ["goal", "game", word(ev.id, 64), ...common], doubles: [num(ev.n), 0] });
        break;
      case "end":
        out.push({ indexes: [b.id], blobs: ["end", word(ev.mode), "", ...common], doubles: [Math.min(num(ev.minutes), 24 * 60), 0] });
        break;
      case "error":
        out.push({ indexes: [b.id], blobs: ["error", "", word(ev.msg, 200), ...common], doubles: [0, 0] });
        break;
    }
  }
  return out;
}

export async function handleStats(request: Request, env: StatsEnv, cors: Record<string, string>): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  const len = Number(request.headers.get("Content-Length") ?? "0");
  if (len > MAX_STATS_BYTES) return new Response("Too large", { status: 413, headers: cors });
  const body = await request.text();
  if (body.length > MAX_STATS_BYTES) return new Response("Too large", { status: 413, headers: cors });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("Not JSON", { status: 400, headers: cors });
  }
  const pts = points(parsed);
  if (pts === null) return new Response("Malformed batch", { status: 400, headers: cors });
  for (const p of pts) env.STATS?.writeDataPoint(p);
  return new Response(null, { status: 204, headers: cors });
}
