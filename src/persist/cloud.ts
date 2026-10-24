import type { GameMode } from "../game/modes";
import { newCode, parseCode } from "./sync-code";

/**
 * Cloud saves: each mode's railway (its storage keys, see `modeKeys`) sent, gzipped, to the Worker in `cloud/` under
 * the player's sync code, and fetched back on another device. The device's own storage stays the save: the cloud is a
 * copy of it, sent at most every 30 s while something changes (`UPLOAD_EVERY_MS`) and when the page is hidden, and
 * checked when the game starts and when a code is typed in. Nothing runs while nothing changes.
 *
 * Two copies of a railway that both changed: the newer wins, and the other is kept on the device as a backup, to
 * restore from the Cloud save card. A copy saved by a newer game than this one is never loaded nor written over.
 */

export const UPLOAD_EVERY_MS = 30_000;
/** A bundle no bigger than this goes with `keepalive` as the page closes (browsers allow 64 KB in all). */
const KEEPALIVE_MAX = 60_000;
const META_KEY = "woodrail.cloud.v1";
const backupKey = (mode: GameMode): string => `woodrail.cloud.backup.${mode}`;
const MODES: readonly GameMode[] = ["sandbox", "game"];

export interface RemoteMeta {
  /** When the game made the bundle (ms). */
  savedAt: number;
  /** Its save format (`SAVE_VERSION`). */
  saveVersion: number;
}

/** A reply from the cloud, or why there's none: `status` 0 is no connection at all. */
export type Reply<T> = { ok: true; value: T } | { ok: false; status: number };

/** What the game needs of the Worker (`WorkerBackend`; a fake in tests). Null: nothing saved under the code. */
export interface CloudBackend {
  head(code: string, mode: GameMode): Promise<Reply<RemoteMeta | null>>;
  get(code: string, mode: GameMode): Promise<Reply<{ meta: RemoteMeta; bytes: Uint8Array } | null>>;
  /** Stored only if the copy there is still `base` (its `savedAt`; 0: none), else a 409. */
  put(code: string, mode: GameMode, bytes: Uint8Array, meta: RemoteMeta, base: number, keepalive: boolean): Promise<Reply<void>>;
}

export type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** One mode's railway as it travels: its storage keys, as they're stored. */
export interface CloudBundle {
  format: 1;
  mode: GameMode;
  savedAt: number;
  saveVersion: number;
  keys: Record<string, string>;
}

interface ModeMeta {
  /** The cloud copy this device last sent or took (its `savedAt`; 0: none). */
  remoteSavedAt: number;
  /** Changed here since then. */
  dirty: boolean;
  /** When it last changed here (ms). */
  changedAt: number;
}

interface Meta {
  code: string | null;
  modes: Record<GameMode, ModeMeta>;
}

export type CloudStatus =
  | { kind: "off" }
  | { kind: "saving" }
  | { kind: "synced"; at: number }
  | { kind: "offline" }
  /** A mode's cloud copy is from a newer game: left alone till this one updates. */
  | { kind: "newer" };

/** What happened to a mode's railway when the cloud was checked (for a toast), or null: nothing to say. */
export type SyncNote = "took-cloud" | "kept-here" | "both-changed" | "newer" | null;

export type UseCodeResult = { ok: true; took: GameMode[] } | { ok: false; error: "malformed" | "nothing" | "offline" | "newer" };

export interface CloudOptions {
  backend: CloudBackend;
  storage: KeyStore;
  /** Each mode's storage keys (`modeKeys`): the first is its autosave. */
  keys: Record<GameMode, string[]>;
  saveVersion: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export class CloudSync {
  private readonly o: Required<CloudOptions>;
  private meta: Meta;
  private timer: unknown = null;
  /** What was last sent of each mode's keys, so an unchanged railway isn't sent again. */
  private readonly sent: Record<GameMode, Map<string, string | null> | null> = { sandbox: null, game: null };
  /** Counts changes, so one made while an upload is on its way keeps the mode dirty. */
  private readonly gen: Record<GameMode, number> = { sandbox: 0, game: 0 };
  private readonly busy = new Set<GameMode>();
  private readonly newer = new Set<GameMode>();
  /** Past the start-up check's deadline: it no longer writes a cloud copy into storage (the game has read it). */
  private late = false;
  private _status: CloudStatus;
  onStatus: (s: CloudStatus) => void = () => {};
  /** A mode's railway was changed elsewhere too while this one was played: theirs is kept as the backup. */
  onNote: (mode: GameMode, note: SyncNote) => void = () => {};

  constructor(opts: CloudOptions) {
    this.o = {
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as number),
      ...opts,
    };
    this.meta = this.readMeta();
    this._status = this.meta.code ? { kind: "saving" } : { kind: "off" };
  }

  get code(): string | null {
    return this.meta.code;
  }
  get status(): CloudStatus {
    return this._status;
  }

  /**
   * At start-up, before a railway is read from storage: each mode's cloud copy compared with the device's, and the
   * newer one kept (a cloud copy is written into storage, so the game loads it as it loads its own, migrated if older).
   * `cutoff` after it: a late answer is left for the next upload to settle.
   */
  async start(): Promise<Partial<Record<GameMode, SyncNote>>> {
    const code = this.meta.code;
    if (!code) return {};
    const notes = await Promise.all(MODES.map((m) => this.reconcile(code, m, false)));
    const out: Partial<Record<GameMode, SyncNote>> = {};
    MODES.forEach((m, i) => notes[i] && (out[m] = notes[i]));
    for (const m of MODES) if (this.meta.modes[m].dirty) this.arm();
    if (this._status.kind === "saving") this.setStatus(this.anyDirty() ? { kind: "saving" } : { kind: "synced", at: this.o.now() });
    return out;
  }

  cutoff(): void {
    this.late = true;
  }

  /** The mode's railway was saved to storage: it goes up within `UPLOAD_EVERY_MS`. Cheap: called on every autosave. */
  changed(mode: GameMode): void {
    if (!this.meta.code) return;
    this.gen[mode]++;
    const m = this.meta.modes[mode];
    m.changedAt = this.o.now();
    if (!m.dirty) {
      m.dirty = true;
      this.writeMeta();
    }
    this.arm();
  }

  /** Send what's changed now: on the way out (`leaving`: the page hidden or closing), or when back online. */
  async flush(leaving = false): Promise<void> {
    if (this.timer !== null) {
      this.o.clearTimer(this.timer);
      this.timer = null;
    }
    if (!this.meta.code) return;
    await Promise.all(MODES.map((m) => this.upload(m, leaving)));
    // (Nothing there was to send.)
    if (this._status.kind === "saving" && !this.anyDirty()) this.settle();
    // (Kept: `changedAt`, for the next start's check.)
    if (leaving) this.writeMeta();
  }

  /** Turn cloud saves on with a new code: both railways go up now. */
  async enable(): Promise<string> {
    const code = newCode();
    this.meta = { code, modes: { sandbox: freshMode(), game: freshMode() } };
    for (const m of MODES) {
      this.sent[m] = null;
      if (this.o.storage.getItem(this.o.keys[m][0]) !== null) this.meta.modes[m].dirty = true;
    }
    this.writeMeta();
    this.setStatus({ kind: "saving" });
    await this.flush();
    return code;
  }

  /**
   * Carry on with the railways saved under a code from another device: theirs replace this device's (which are kept
   * as backups), and from now on changes go up under that code. A mode with nothing saved under it sends this
   * device's railway.
   */
  async useCode(typed: string): Promise<UseCodeResult> {
    const code = parseCode(typed);
    if (!code) return { ok: false, error: "malformed" };
    const heads = await Promise.all(MODES.map((m) => this.o.backend.head(code, m)));
    if (heads.some((h) => !h.ok)) return { ok: false, error: "offline" };
    const remote = heads.map((h) => (h.ok ? h.value : null));
    if (remote.every((r) => r === null)) return { ok: false, error: "nothing" };
    if (remote.some((r) => r !== null && r.saveVersion > this.o.saveVersion)) return { ok: false, error: "newer" };
    const took: GameMode[] = [];
    const modes = { sandbox: freshMode(), game: freshMode() };
    for (const [i, mode] of MODES.entries()) {
      if (remote[i] === null) {
        modes[mode].dirty = this.o.storage.getItem(this.o.keys[mode][0]) !== null;
        continue;
      }
      const got = await this.o.backend.get(code, mode);
      if (!got.ok || !got.value) return { ok: false, error: "offline" };
      const bundle = await this.readBundle(got.value.bytes, mode);
      if (!bundle) return { ok: false, error: "offline" };
      if (this.o.storage.getItem(this.o.keys[mode][0]) !== null) await this.keepBackup(mode, this.bundleHere(mode, this.o.now()));
      if (!this.apply(bundle)) return { ok: false, error: "offline" };
      modes[mode].remoteSavedAt = modes[mode].changedAt = got.value.meta.savedAt;
      took.push(mode);
    }
    this.meta = { code, modes };
    for (const m of MODES) this.sent[m] = null;
    this.newer.clear();
    this.writeMeta();
    this.setStatus({ kind: "synced", at: this.o.now() });
    return { ok: true, took };
  }

  /** Turn cloud saves off: the code is forgotten here (the railways stay, here and in the cloud). */
  disable(): void {
    if (this.timer !== null) this.o.clearTimer(this.timer);
    this.timer = null;
    this.meta = { code: null, modes: { sandbox: freshMode(), game: freshMode() } };
    try {
      this.o.storage.removeItem(META_KEY);
    } catch {
      // nothing kept
    }
    this.setStatus({ kind: "off" });
  }

  /** When the mode's backup (the other railway, from a sync) was saved, or null: there's none. */
  backupOf(mode: GameMode): number | null {
    const b = this.readBackup(mode);
    return b ? b.savedAt : null;
  }

  /** The mode's backup becomes its railway, and the railway its backup (so a restore can be undone the same way). */
  async restore(mode: GameMode): Promise<boolean> {
    const b = this.readBackup(mode);
    if (!b) return false;
    const bundle = await this.readBundle(fromBase64(b.data), mode);
    if (!bundle) return false;
    await this.keepBackup(mode, this.bundleHere(mode, this.o.now()));
    if (!this.apply(bundle)) return false;
    if (this.meta.code) this.changed(mode);
    return true;
  }

  private async reconcile(code: string, mode: GameMode, beforePut: boolean): Promise<SyncNote> {
    const head = await this.o.backend.head(code, mode);
    if (!head.ok) {
      if (head.status === 0) this.setStatus({ kind: "offline" });
      return null;
    }
    const m = this.meta.modes[mode];
    const remote = head.value;
    const here = this.o.storage.getItem(this.o.keys[mode][0]) !== null;
    if (!remote) {
      if (here && !m.dirty) {
        m.dirty = true;
        this.writeMeta();
      }
      return null;
    }
    if (remote.saveVersion > this.o.saveVersion) {
      this.newer.add(mode);
      this.setStatus({ kind: "newer" });
      return "newer";
    }
    if (remote.savedAt === m.remoteSavedAt) return null;
    // Another device sent its copy since this one last did.
    const got = await this.o.backend.get(code, mode);
    if (!got.ok || !got.value) return null;
    const bundle = await this.readBundle(got.value.bytes, mode);
    if (!bundle) return null;
    const cloudWins = !beforePut && (!here || !m.dirty || got.value.meta.savedAt > m.changedAt);
    if (cloudWins) {
      if (this.late) return null;
      // Changed here as well: this device's copy is kept aside.
      const both = here && m.dirty;
      if (both) await this.keepBackup(mode, this.bundleHere(mode, m.changedAt));
      if (!this.apply(bundle)) return null;
      this.meta.modes[mode] = { remoteSavedAt: got.value.meta.savedAt, dirty: false, changedAt: got.value.meta.savedAt };
      this.sent[mode] = null;
      this.writeMeta();
      return both ? "took-cloud" : null;
    }
    // This device's is newer: the cloud's is kept aside, and this one goes up over it.
    await this.keepBackup(mode, bundle);
    m.remoteSavedAt = got.value.meta.savedAt;
    m.dirty = true;
    this.writeMeta();
    return beforePut ? "both-changed" : "kept-here";
  }

  private async upload(mode: GameMode, leaving: boolean): Promise<void> {
    const code = this.meta.code;
    const m = this.meta.modes[mode];
    if (!code || !m.dirty || this.newer.has(mode) || this.busy.has(mode)) return;
    this.busy.add(mode);
    try {
      const keys = this.readKeys(mode);
      if (this.sent[mode] && sameKeys(this.sent[mode], keys)) {
        m.dirty = false;
        this.writeMeta();
        this.settle();
        return;
      }
      this.setStatus({ kind: "saving" });
      // (Not on the way out: there's no time to ask first. Then the copy goes up only over the one this device last saw:
      // over another device's, it's turned away, and settled at the next start.)
      if (!leaving) {
        const note = await this.reconcile(code, mode, true);
        if (note) this.onNote(mode, note);
        if (this.newer.has(mode)) return;
      }
      const gen = this.gen[mode];
      const savedAt = this.o.now();
      const bytes = await gzip(JSON.stringify(bundleOf(mode, savedAt, this.o.saveVersion, keys)));
      const res = await this.o.backend.put(code, mode, bytes, { savedAt, saveVersion: this.o.saveVersion }, m.remoteSavedAt, leaving && bytes.byteLength <= KEEPALIVE_MAX);
      // (Turned off, or another code taken, meanwhile.)
      if (this.meta.code !== code) return;
      if (res.ok) {
        m.remoteSavedAt = savedAt;
        this.sent[mode] = keys;
        if (gen === this.gen[mode]) m.dirty = false;
        this.writeMeta();
        this.settle();
      } else {
        // Still to send (a 429, a 409 or a failure never loses it): tried again on the next timer, or back online (a 409
        // after the check that keeps the other copy).
        this.setStatus(res.status === 0 ? { kind: "offline" } : { kind: "saving" });
        this.arm();
      }
    } finally {
      this.busy.delete(mode);
      if (m.dirty && this.timer === null && !leaving) this.arm();
    }
  }

  private settle(): void {
    if (this.newer.size) this.setStatus({ kind: "newer" });
    else if (!this.anyDirty() || this._status.kind !== "offline") this.setStatus({ kind: "synced", at: this.o.now() });
  }

  private anyDirty(): boolean {
    return MODES.some((m) => this.meta.modes[m].dirty && !this.newer.has(m));
  }

  private arm(): void {
    if (this.timer !== null) return;
    this.timer = this.o.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, UPLOAD_EVERY_MS);
  }

  private setStatus(s: CloudStatus): void {
    this._status = s;
    this.onStatus(s);
  }

  private readKeys(mode: GameMode): Map<string, string | null> {
    const out = new Map<string, string | null>();
    for (const k of this.o.keys[mode]) out.set(k, this.o.storage.getItem(k));
    return out;
  }

  private bundleHere(mode: GameMode, savedAt: number): CloudBundle {
    return bundleOf(mode, savedAt, this.o.saveVersion, this.readKeys(mode));
  }

  /** A bundle as sent, checked: its mode's keys only, as strings. Null if it isn't one. */
  private async readBundle(bytes: Uint8Array, mode: GameMode): Promise<CloudBundle | null> {
    try {
      const b = JSON.parse(await gunzip(bytes)) as CloudBundle;
      const allowed = new Set(this.o.keys[mode]);
      if (b?.format !== 1 || b.mode !== mode || typeof b.savedAt !== "number" || typeof b.keys !== "object" || b.keys === null) return null;
      if (!Object.entries(b.keys).every(([k, v]) => allowed.has(k) && typeof v === "string")) return null;
      return b;
    } catch {
      return null;
    }
  }

  /** Write a bundle's keys into storage (a key it hasn't is removed), all or none. */
  private apply(b: CloudBundle): boolean {
    const before = this.readKeys(b.mode);
    try {
      for (const k of this.o.keys[b.mode]) {
        const v = b.keys[k];
        if (v === undefined) this.o.storage.removeItem(k);
        else this.o.storage.setItem(k, v);
      }
      return true;
    } catch {
      // No room: back as it was.
      for (const [k, v] of before) {
        try {
          if (v === null) this.o.storage.removeItem(k);
          else this.o.storage.setItem(k, v);
        } catch {
          // as much as fits
        }
      }
      return false;
    }
  }

  private async keepBackup(mode: GameMode, b: CloudBundle): Promise<void> {
    try {
      this.o.storage.setItem(backupKey(mode), JSON.stringify({ savedAt: b.savedAt, data: toBase64(await gzip(JSON.stringify(b))) }));
    } catch {
      // No room for a backup.
    }
  }

  private readBackup(mode: GameMode): { savedAt: number; data: string } | null {
    try {
      const raw = this.o.storage.getItem(backupKey(mode));
      const b = raw ? (JSON.parse(raw) as { savedAt?: unknown; data?: unknown }) : null;
      return b && typeof b.savedAt === "number" && typeof b.data === "string" ? { savedAt: b.savedAt, data: b.data } : null;
    } catch {
      return null;
    }
  }

  private readMeta(): Meta {
    try {
      const raw = this.o.storage.getItem(META_KEY);
      const m = raw ? (JSON.parse(raw) as Meta) : null;
      if (m && typeof m.code === "string" && parseCode(m.code) === m.code) {
        return { code: m.code, modes: { sandbox: { ...freshMode(), ...m.modes?.sandbox }, game: { ...freshMode(), ...m.modes?.game } } };
      }
    } catch {
      // unreadable: off
    }
    return { code: null, modes: { sandbox: freshMode(), game: freshMode() } };
  }

  private writeMeta(): void {
    if (!this.meta.code) return;
    try {
      this.o.storage.setItem(META_KEY, JSON.stringify(this.meta));
    } catch {
      // storage full: what's dirty is found again from the next change
    }
  }
}

const freshMode = (): ModeMeta => ({ remoteSavedAt: 0, dirty: false, changedAt: 0 });

function bundleOf(mode: GameMode, savedAt: number, saveVersion: number, keys: Map<string, string | null>): CloudBundle {
  const out: Record<string, string> = {};
  for (const [k, v] of keys) if (v !== null) out[k] = v;
  // The save's own version, when it has one (an older save carried over is loaded through the game's migration).
  const v = /^\{"version":(\d+)/.exec(out[[...keys.keys()][0]] ?? "");
  return { format: 1, mode, savedAt, saveVersion: v ? Number(v[1]) : saveVersion, keys: out };
}

function sameKeys(a: Map<string, string | null>, b: Map<string, string | null>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Cloud saves need gzip in the browser (`CompressionStream`: every current browser). */
export const cloudSupported = (): boolean => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The Worker in `cloud/`, at `base` (`VITE_CLOUD_URL`). */
export class WorkerBackend implements CloudBackend {
  constructor(
    private readonly base: string,
    private readonly gameVersion: string,
  ) {}

  async head(code: string, mode: GameMode): Promise<Reply<RemoteMeta | null>> {
    const res = await this.call("HEAD", code, mode);
    if (!res) return { ok: false, status: 0 };
    if (res.status === 404) return { ok: true, value: null };
    return res.ok ? { ok: true, value: metaOf(res) } : { ok: false, status: res.status };
  }

  async get(code: string, mode: GameMode): Promise<Reply<{ meta: RemoteMeta; bytes: Uint8Array } | null>> {
    const res = await this.call("GET", code, mode);
    if (!res) return { ok: false, status: 0 };
    if (res.status === 404) return { ok: true, value: null };
    if (!res.ok) return { ok: false, status: res.status };
    try {
      return { ok: true, value: { meta: metaOf(res), bytes: new Uint8Array(await res.arrayBuffer()) } };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  async put(code: string, mode: GameMode, bytes: Uint8Array, meta: RemoteMeta, base: number, keepalive: boolean): Promise<Reply<void>> {
    const res = await this.call("PUT", code, mode, {
      body: bytes as BodyInit,
      keepalive,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Saved-At": String(meta.savedAt),
        "X-Save-Version": String(meta.saveVersion),
        "X-Game-Version": this.gameVersion,
        "X-Base-Saved-At": String(base),
      },
    });
    if (!res) return { ok: false, status: 0 };
    return res.ok ? { ok: true, value: undefined } : { ok: false, status: res.status };
  }

  private async call(method: string, code: string, mode: GameMode, init: { body?: BodyInit; keepalive?: boolean; headers?: Record<string, string> } = {}): Promise<Response | null> {
    try {
      return await fetch(`${this.base.replace(/\/$/, "")}/v1/saves/${mode}`, {
        method,
        body: init.body,
        keepalive: init.keepalive,
        cache: "no-store",
        headers: { "X-Woodrail-Code": code, ...init.headers },
        // (A request on the way out has to go on as the page closes.)
        signal: init.keepalive ? undefined : AbortSignal.timeout(15_000),
      });
    } catch {
      return null;
    }
  }
}

const metaOf = (res: Response): RemoteMeta => ({ savedAt: Number(res.headers.get("X-Saved-At") ?? 0), saveVersion: Number(res.headers.get("X-Save-Version") ?? 0) });

/** The status as the Cloud save card says it. */
export function statusText(s: CloudStatus, now: number): string {
  switch (s.kind) {
    case "off":
      return "Off";
    case "saving":
      return "Saving online…";
    case "offline":
      return "Offline: saved on this device";
    case "newer":
      return "Saved online by a newer version of the game: update to carry on";
    case "synced": {
      const min = Math.floor((now - s.at) / 60_000);
      return min < 1 ? "Saved online just now" : min < 60 ? `Saved online ${min} min ago` : `Saved online at ${new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
  }
}
