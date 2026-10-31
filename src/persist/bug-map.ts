/**
 * A player's map for a bug report: the mode's saved keys (`modeKeys`: the railway, its session, and in Game mode the
 * goals and progress), gzipped and base64'd behind a tag, to copy and paste to us. And the way back in, for a session
 * looking into it: `#load=<the text>` in the link, honoured only in a dev server or with `?dev` (it overwrites that
 * mode's save).
 */
import type { GameMode } from "../game/modes";
import { fromBase64, gunzip, gzip, toBase64 } from "./cloud";
import { modeKeys } from "./save";

/** What the copied text starts with (so a paste is recognised, and anything else turned away). */
export const MAP_TAG = "woodrail-map:1:";

interface MapCopy {
  mode: GameMode;
  keys: Record<string, string>;
}

/** The mode's saved keys, as text to paste (save first: this reads what's stored). */
export async function mapText(mode: GameMode, storage: Pick<Storage, "getItem"> = localStorage): Promise<string> {
  const keys: Record<string, string> = {};
  for (const k of modeKeys(mode)) {
    const v = storage.getItem(k);
    if (v !== null) keys[k] = v;
  }
  return MAP_TAG + toBase64(await gzip(JSON.stringify({ mode, keys } satisfies MapCopy)));
}

/** A pasted map read back (spaces, line breaks and URL escapes allowed), or null if it isn't one. */
export async function readMapText(text: string): Promise<MapCopy | null> {
  try {
    const t = decodeURIComponent(text).replace(/\s+/g, "");
    if (!t.startsWith(MAP_TAG)) return null;
    const copy = JSON.parse(await gunzip(fromBase64(t.slice(MAP_TAG.length).replace(/-/g, "+").replace(/_/g, "/")))) as MapCopy;
    if ((copy.mode !== "game" && copy.mode !== "sandbox") || typeof copy.keys !== "object" || !copy.keys) return null;
    // Only the mode's own keys, as strings.
    const allowed = new Set(modeKeys(copy.mode));
    const keys: Record<string, string> = {};
    for (const [k, v] of Object.entries(copy.keys)) if (allowed.has(k) && typeof v === "string") keys[k] = v;
    return { mode: copy.mode, keys };
  } catch {
    return null;
  }
}

/** Put a map in storage in place of the mode's own save (its keys the copy hasn't are cleared). */
export function writeMap(copy: MapCopy, storage: Pick<Storage, "setItem" | "removeItem"> = localStorage): void {
  for (const k of modeKeys(copy.mode)) {
    if (k in copy.keys) storage.setItem(k, copy.keys[k]);
    else storage.removeItem(k);
  }
}

/** Is the dev-only load allowed here: a dev server, or `?dev` in the link? */
export const devLoadAllowed = (): boolean => import.meta.env.DEV || new URLSearchParams(location.search).has("dev");

/**
 * At start-up: a map in the link (`#load=…`, dev only) put in storage, the link's hash cleared. Its mode, or null when
 * there was none (or it wasn't one: warned in the console).
 */
export async function loadLinkedMap(): Promise<GameMode | null> {
  const m = /^#load=(.+)$/s.exec(location.hash);
  if (!m || !devLoadAllowed()) return null;
  history.replaceState(null, "", location.pathname + location.search);
  const copy = await readMapText(m[1]);
  if (!copy) {
    console.warn("Woodrail: #load= isn't a copied map");
    return null;
  }
  writeMap(copy);
  console.info(`Woodrail: loaded a copied ${copy.mode} map (${Object.keys(copy.keys).length} keys)`);
  return copy.mode;
}
