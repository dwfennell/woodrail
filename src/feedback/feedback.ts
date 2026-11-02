/**
 * "Report a bug or give feedback" (the ☰ menu; its sheet is src/ui/feedback-sheet.ts): a report built and sent to the
 * cloud Worker's `POST /feedback` (cloud/src/feedback.ts), which keeps it and opens a GitHub issue for it.
 *
 * A report holds the player's note and its kind, the "Copy map for a bug report" text (`woodrail-map:1:…`), a picture
 * of the game (a JPEG, at most `SHOT_MAX_PX` on its long side and about `SHOT_TARGET_BYTES`), the build, the browser's
 * user agent, the screen's size, the mode, and the problems the game noticed lately (dev invariant breaks, errors).
 * Nothing else about the player.
 */
import type { GameMode } from "../game/modes";

export type FeedbackKind = "bug" | "idea";

/** What's posted (the Worker's `parseFeedback` checks the same). */
export interface FeedbackPayload {
  kind: FeedbackKind;
  text: string;
  /** The map's text, or null (an idea sent without it). A bug always has it. */
  map: string | null;
  /** The picture, a JPEG as base64 (no `data:` prefix), or null. */
  shot: string | null;
  mode: GameMode;
  build: string;
  userAgent: string;
  viewport: { width: number; height: number; dpr: number };
  badges: string[];
}

/** The largest report the Worker takes (bytes, as sent): the same as its `MAX_FEEDBACK_BYTES`. */
export const FEEDBACK_MAX_BYTES = 2 * 1024 * 1024;
/** A note's longest (characters): the Worker's `MAX_TEXT`. */
export const FEEDBACK_MAX_TEXT = 4000;
/** The picture's longest side (px). */
export const SHOT_MAX_PX = 1280;
/** About how big the picture may be (bytes). */
export const SHOT_TARGET_BYTES = 300 * 1024;

export interface FeedbackInput {
  kind: FeedbackKind;
  text: string;
  /** The map's text (always sent with a bug; with an idea only if `includeMap`). */
  map: string;
  includeMap: boolean;
  shot: string | null;
  mode: GameMode;
  build: string;
  userAgent: string;
  viewport: { width: number; height: number; dpr: number };
  badges: readonly string[];
}

/** The payload for what the sheet holds. */
export function buildFeedback(i: FeedbackInput): FeedbackPayload {
  return {
    kind: i.kind,
    text: i.text.trim().slice(0, FEEDBACK_MAX_TEXT),
    map: i.kind === "bug" || i.includeMap ? i.map : null,
    shot: i.shot,
    mode: i.mode,
    build: i.build.slice(0, 40),
    userAgent: i.userAgent.slice(0, 300),
    viewport: { width: Math.round(i.viewport.width), height: Math.round(i.viewport.height), dpr: Math.round(i.viewport.dpr * 100) / 100 },
    badges: i.badges.slice(-10).map((b) => b.slice(0, 300)),
  };
}

/**
 * The payload as the body to post, under the Worker's cap: the picture is left out if that's what it takes (the map
 * and note are what matter). Null if it's too big even so (a map that big: Copy instead).
 */
export function feedbackBody(p: FeedbackPayload, max = FEEDBACK_MAX_BYTES): { body: string; droppedShot: boolean } | null {
  const size = (s: string) => new TextEncoder().encode(s).length;
  const body = JSON.stringify(p);
  if (size(body) <= max) return { body, droppedShot: false };
  if (p.shot === null) return null;
  const without = JSON.stringify({ ...p, shot: null });
  return size(without) <= max ? { body: without, droppedShot: true } : null;
}

/** What "Copy instead" copies: the note, its kind, the device, and the map (pasted to us by hand). */
export function feedbackCopyText(p: FeedbackPayload): string {
  return [`[${p.kind}] ${p.text}`, "", `${p.mode} · build ${p.build || "?"} · ${p.viewport.width}×${p.viewport.height} @${p.viewport.dpr}x`, p.userAgent, ...(p.badges.length ? ["", ...p.badges] : []), ...(p.map ? ["", p.map] : [])].join("\n");
}

export interface Sent {
  id: string;
  issue: string | null;
}

/** Post a report to the Worker at `base`. Throws with a short reason on failure (offline, too big, too many). */
export async function sendFeedback(base: string, body: string, fetcher: typeof fetch = fetch): Promise<Sent> {
  let res: Response;
  try {
    res = await fetcher(`${base.replace(/\/$/, "")}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  } catch {
    throw new Error("Couldn't reach the server. Are you online?");
  }
  if (res.status === 429) throw new Error("Too many reports just now. Try again in a minute.");
  if (res.status === 413) throw new Error("This report is too big to send.");
  if (!res.ok) throw new Error(`The server said no (${res.status}).`);
  const got = (await res.json()) as Partial<Sent>;
  if (typeof got.id !== "string") throw new Error("The server's answer was garbled.");
  return { id: got.id, issue: typeof got.issue === "string" ? got.issue : null };
}

/** A picture's size scaled to fit `max` on its long side (never up). */
export function fitSize(width: number, height: number, max = SHOT_MAX_PX): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * A captured frame as the report's JPEG (base64): scaled to `SHOT_MAX_PX` at most, at falling quality, then smaller,
 * until it's about `SHOT_TARGET_BYTES`. Null if the browser can't make one.
 */
export async function jpegShot(frame: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(frame);
  } catch {
    return null;
  }
  try {
    let { width, height } = fitSize(bitmap.width, bitmap.height);
    for (let shrink = 0; shrink < 3; shrink++) {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const g = c.getContext("2d");
      if (!g) return null;
      g.drawImage(bitmap, 0, 0, width, height);
      for (const q of [0.8, 0.65, 0.5]) {
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", q));
        if (!blob) return null;
        if (blob.size <= SHOT_TARGET_BYTES || (shrink === 2 && q === 0.5)) return base64(new Uint8Array(await blob.arrayBuffer()));
      }
      ({ width, height } = fitSize(width, height, Math.round(Math.max(width, height) * 0.75)));
    }
    return null;
  } finally {
    bitmap.close();
  }
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
