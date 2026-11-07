/**
 * Railway snapshots ("Help improve Woodrail", docs/stats.md): now and then, the railway of a player who shares stats
 * and their railway, to see what people build. The map is the "Copy map for a bug report" text, so a snapshot opens
 * with `npm run replay` or `#load=`. The Worker's side is cloud/src/snapshots.ts.
 *
 * Game mode only, and only once the player has joined two towns and put an engine on the track (`SNAPSHOT_AFTER`): a
 * game opened and left sends nothing. Then one as each goal ticks, and one a minute into a stretch of building at most
 * every `BUILD_EVERY_MS`, `MAX_SNAPSHOTS` a device in all. Nothing on a timer of its own: an idle game sends nothing.
 */
import type { Stats } from "./stats";

/** The goals done before any snapshot. */
export const SNAPSHOT_AFTER: readonly string[] = ["join-two", "place-train"];
/** Snapshots a device sends at most. */
export const MAX_SNAPSHOTS = 20;
/** A snapshot for building (not a goal) this often at most (ms). */
export const BUILD_EVERY_MS = 15 * 60_000;
/** How long after the first edit of a stretch of building its snapshot waits, to take in the rest (ms). */
export const BUILD_SETTLE_MS = 60_000;

const SENT_KEY = "woodrail.stats.maps.sent";

export interface SnapshotDeps {
  stats: Pick<Stats, "shareMaps" | "deviceId" | "about" | "url">;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** The railway as map text, saved first; null when it isn't Game mode's (or can't be read). */
  mapText(): Promise<string | null>;
  send(url: string, body: string): void;
  now(): number;
  later(fn: () => void, ms: number): unknown;
}

export class Snapshots {
  private lastAt = -Infinity;
  private building = false;
  private busy = false;

  constructor(private readonly d: SnapshotDeps) {}

  private get sent(): number {
    try {
      return Number(this.d.storage?.getItem(SENT_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  }

  /** Would one go now: shared, under the cap, and the player far enough in? */
  private ready(done: (id: string) => boolean): boolean {
    return this.d.stats.shareMaps && this.d.stats.url !== "" && this.sent < MAX_SNAPSHOTS && SNAPSHOT_AFTER.every(done);
  }

  /** A goal ticked (Game mode): `done` says which goals are done now, `n` how many. */
  goal(id: string, done: (id: string) => boolean, n: number): void {
    if (this.ready(done)) void this.take(`goal:${id}`, n);
  }

  /** The player changed the railway (Game mode): a snapshot a minute on, if the last was a while ago. */
  edited(done: (id: string) => boolean, n: () => number): void {
    if (this.building || this.d.now() - this.lastAt < BUILD_EVERY_MS || !this.ready(done)) return;
    this.building = true;
    this.d.later(() => {
      this.building = false;
      if (this.ready(done)) void this.take("building", n());
    }, BUILD_SETTLE_MS);
  }

  private async take(why: string, goals: number): Promise<void> {
    const id = this.d.stats.deviceId();
    if (this.busy || id === null) return;
    this.busy = true;
    try {
      const map = await this.d.mapText();
      if (map === null) return;
      this.lastAt = this.d.now();
      try {
        this.d.storage?.setItem(SENT_KEY, String(this.sent + 1));
      } catch {
        // storage unavailable: the Worker's cap still holds
      }
      this.d.send(`${this.d.stats.url}/v1/snapshots`, JSON.stringify({ id, map, goals, why, ...this.d.stats.about }));
    } catch {
      // Not sent: a snapshot is never worth a retry.
    } finally {
      this.busy = false;
    }
  }
}
