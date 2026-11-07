/**
 * "Help improve Woodrail": anonymous play stats, sent only once the player has said yes (opt-in, asked after their
 * first goal; see docs/stats.md).
 *
 * What goes: a random id made on this device when the player says yes (not tied to them, and dropped if they say no
 * later), the build, the kind of device (phone, tablet or desktop) and where the game is played (itch, the GitHub site,
 * elsewhere), with a few events: a mode started, a goal ticked, how long a session lasted, and errors. No railway, no
 * names, no codes.
 *
 * Events wait in memory and go up in one small POST when the page hides or a minute after the first one waiting, so
 * an idle game sends nothing. Before the player has answered, events are held in memory only: sent if they say yes
 * (the session's start and the goal that led to the question), dropped if they say no or leave first.
 *
 * The same yes covers railway snapshots (snapshots.ts): now and then a copy of the railway, under the same id. A player
 * who said yes before the question said so (no answer kept for it) is asked again, once, and can share stats only.
 */

export type Consent = "yes" | "no" | null;

export type StatEvent =
  | { e: "start"; mode: string; fresh: boolean }
  | { e: "goal"; id: string; n: number }
  | { e: "end"; mode: string; minutes: number }
  | { e: "error"; msg: string };

/** What a batch holds, as the Worker reads it (`cloud/src/stats.ts`). */
export interface StatBatch {
  id: string;
  build: string;
  host: string;
  device: string;
  events: (StatEvent & { t: number })[];
}

export interface StatsDeps {
  /** Where batches go (`<url>/v1/stats`), or empty: no stats in this build, and nothing is asked. */
  url: string;
  build: string;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** Sends a batch (a beacon when the page is hiding). */
  send(url: string, body: string, leaving: boolean): void;
  now(): number;
  /** A minute's wait for the next batch (or a test's own). */
  later(fn: () => void, ms: number): unknown;
  host: string;
  device: string;
  randomId(): string;
}

const CONSENT_KEY = "woodrail.stats";
const ID_KEY = "woodrail.stats.id";
/** Railway snapshots too: "yes" or "no" (unset: said yes before the question mentioned them, or not yet asked). */
const MAPS_KEY = "woodrail.stats.maps";
/** How long events wait for others before they go up (ms). */
export const BATCH_MS = 60_000;
/** The most a batch holds; more than that waiting are dropped (a loop gone wrong shouldn't flood the Worker). */
export const MAX_EVENTS = 50;
/** Errors sent a session at most. */
const MAX_ERRORS = 3;

function get(s: StatsDeps["storage"], k: string): string | null {
  try {
    return s?.getItem(k) ?? null;
  } catch {
    return null;
  }
}

function set(s: StatsDeps["storage"], k: string, v: string | null): void {
  try {
    if (v === null) s?.removeItem(k);
    else s?.setItem(k, v);
  } catch {
    // storage unavailable: lasts for this session only
  }
}

export class Stats {
  private queue: (StatEvent & { t: number })[] = [];
  private waiting = false;
  private errors = 0;
  private consentNow: Consent;
  private mapsNow: Consent;

  constructor(private readonly d: StatsDeps) {
    const c = get(d.storage, CONSENT_KEY);
    this.consentNow = c === "yes" || c === "no" ? c : null;
    const m = get(d.storage, MAPS_KEY);
    this.mapsNow = m === "yes" || m === "no" ? m : null;
  }

  /** Can this build send stats at all? (No: nothing is asked, and the menu item doesn't show.) */
  get available(): boolean {
    return this.d.url !== "";
  }

  get consent(): Consent {
    return this.consentNow;
  }

  /** Railway snapshots shared (stats are, and the player said yes to these too). */
  get shareMaps(): boolean {
    return this.consentNow === "yes" && this.mapsNow === "yes";
  }

  /**
   * Should the player be asked now? (Once, ever: a no is kept, and the menu can still turn it on. Or once more: a yes
   * to stats from before snapshots, which the question didn't mention.)
   */
  get shouldAsk(): boolean {
    return this.available && (this.consentNow === null || this.asksAboutMaps);
  }

  /** The question is the one about snapshots alone: stats are shared, snapshots not yet answered. */
  get asksAboutMaps(): boolean {
    return this.consentNow === "yes" && this.mapsNow === null;
  }

  /** Stats and railway snapshots, yes or no together (the question, and the menu's switch). */
  setConsent(yes: boolean): void {
    this.consentNow = yes ? "yes" : "no";
    set(this.d.storage, CONSENT_KEY, this.consentNow);
    this.setMaps(yes);
    if (!yes) {
      // A no: the id goes too, and nothing waiting is sent.
      set(this.d.storage, ID_KEY, null);
      this.queue = [];
    } else if (this.queue.length > 0 && !this.waiting) {
      this.waiting = true;
      this.d.later(() => this.flush(false), BATCH_MS);
    }
  }

  /** Railway snapshots alone, yes or no (stats as they are). */
  setMaps(yes: boolean): void {
    this.mapsNow = yes ? "yes" : "no";
    set(this.d.storage, MAPS_KEY, this.mapsNow);
  }

  /** This device's random id, made now if there's none; null unless the player said yes. */
  deviceId(): string | null {
    if (this.consentNow !== "yes") return null;
    let id = get(this.d.storage, ID_KEY);
    if (!id || !/^[0-9a-f]{16}$/.test(id)) {
      id = this.d.randomId();
      set(this.d.storage, ID_KEY, id);
    }
    return id;
  }

  /** The build, host and device each batch carries. */
  get about(): { build: string; host: string; device: string } {
    return { build: this.d.build, host: this.d.host, device: this.d.device };
  }

  /** The Worker's address (empty: none). */
  get url(): string {
    return this.d.url.replace(/\/$/, "");
  }

  /** Records an event, unless the player said no (not yet answered: held, unsent, till they do). */
  record(ev: StatEvent): void {
    if (!this.available || this.consentNow === "no") return;
    if (ev.e === "error" && this.errors++ >= MAX_ERRORS) return;
    if (this.queue.length >= MAX_EVENTS) return;
    this.queue.push({ ...ev, t: this.d.now() });
    if (this.consentNow === "yes" && !this.waiting) {
      this.waiting = true;
      this.d.later(() => this.flush(false), BATCH_MS);
    }
  }

  /** Sends what's waiting (now, as the page hides: `leaving`). */
  flush(leaving: boolean): void {
    this.waiting = false;
    if (this.queue.length === 0) return;
    const id = this.deviceId();
    if (id === null) return;
    const batch: StatBatch = { id, build: this.d.build, host: this.d.host, device: this.d.device, events: this.queue };
    this.queue = [];
    try {
      this.d.send(`${this.url}/v1/stats`, JSON.stringify(batch), leaving);
    } catch {
      // Not sent: stats are never worth a retry.
    }
  }
}

/** Where the game is played, by the page's host. */
export function hostOf(hostname: string): string {
  if (hostname.endsWith("itch.zone") || hostname.endsWith("itch.io") || hostname.endsWith("hwcdn.net")) return "itch";
  if (hostname.endsWith("github.io")) return "pages";
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local";
  return "other";
}

/** The kind of device, roughly: a coarse pointer on a small or a big screen, or a fine one. */
export function deviceOf(coarse: boolean, shortSide: number): string {
  if (!coarse) return "desktop";
  return shortSide < 600 ? "phone" : "tablet";
}

/** The game's stats, set up for this page. */
export function pageStats(url: string, build: string): Stats {
  let storage: Storage | null = null;
  try {
    storage = localStorage;
  } catch {
    // none
  }
  return new Stats({
    url,
    build,
    storage,
    send: (to, body, leaving) => {
      // A beacon survives the page closing; text/plain keeps it a simple request (no CORS preflight).
      if (leaving && navigator.sendBeacon?.(to, new Blob([body], { type: "text/plain" }))) return;
      void fetch(to, { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true }).catch(() => {});
    },
    now: () => Date.now(),
    later: (fn, ms) => setTimeout(fn, ms),
    host: hostOf(location.hostname),
    device: deviceOf(matchMedia("(pointer: coarse)").matches, Math.min(screen.width, screen.height)),
    randomId: () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join(""),
  });
}
