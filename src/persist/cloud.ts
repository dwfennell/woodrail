import type { GameMode } from "../game/modes";
import { newCode, parseCode } from "./sync-code";

/**
 * Cloud saves: each mode's railway (its storage keys, see `modeKeys`) sent, gzipped, to the Worker in `cloud/` under
 * the player's sync code, and fetched back on another device. The device's own storage stays the save: the cloud is a
 * copy of it, sent at most every 30 s after it's edited (`edited`: the track, the props, the land, the game's goods and
 * research, never the clock running on or trains rolling along) and when the page is hidden, and checked when the game
 * starts, before each upload, and when a code is typed in. Nothing runs while nothing's edited.
 *
 * Two copies of a railway that were both edited since they last matched: the one edited later wins, and the other is
 * kept on the device as a backup, to restore from the Cloud save card; one only edited elsewhere is simply taken. A
 * copy saved by a newer game than this one is never loaded nor written over.
 */

export const UPLOAD_EVERY_MS = 30_000;
/** Progress alone (coins, goals, towns growing, with trains running) goes up at most this often: cheap, but bounded. */
export const PROGRESS_EVERY_MS = 60_000;

/**
 * What an edit was: the player's (the railway laid out, things made, picked, moved: `layout`), or the game's own
 * running on (deliveries' coins, fares, goals ticked, towns growing: `progress`). A layout edit outranks progress in a
 * conflict: a device left running never wins over another device's building just by earning later.
 */
export type EditKind = "layout" | "progress";
/** A bundle no bigger than this goes with `keepalive` as the page closes (browsers allow 64 KB in all). */
const KEEPALIVE_MAX = 60_000;
const META_KEY = "woodrail.cloud.v1";
const backupKey = (mode: GameMode): string => `woodrail.cloud.backup.${mode}`;
/** The mergeable keys as this device last synced them (sent or taken): what a merge counts each side's change from. */
const baseKey = (mode: GameMode): string => `woodrail.cloud.base.${mode}`;

type Keys = Record<string, string | null>;

/**
 * Keys two devices' copies can be merged in, when neither changed the layout since they last matched (Game mode's
 * progress and goals: `progress-merge.ts`), so the game's progress made on both is kept, without a backup or a toast.
 */
export interface Merger {
  keys: Partial<Record<GameMode, readonly string[]>>;
  /** The merged values of `keys[mode]`, from the base (as both last had them) and each side's. */
  merge(mode: GameMode, base: Keys, local: Keys, remote: Keys, later: "local" | "remote"): Keys;
}
const MODES: readonly GameMode[] = ["sandbox", "game"];

export interface RemoteMeta {
  /** When the game made the bundle (ms). */
  savedAt: number;
  /** Its save format (`SAVE_VERSION`). */
  saveVersion: number;
  /** When the cloud stored it, by the cloud's clock (ms; 0: not said). */
  storedAt?: number;
  /**
   * The last layout edit in it (this copy's or an earlier one's), by the cloud's clock: when it was made (`layoutAt`),
   * and when it was stored (`layoutStoredAt`). 0: none; not said: not known.
   */
  layoutAt?: number;
  layoutStoredAt?: number;
}

/** A reply from the cloud, or why there's none: `status` 0 is no connection at all. */
export type Reply<T> = { ok: true; value: T } | { ok: false; status: number };

/** What the game needs of the Worker (`WorkerBackend`; a fake in tests). Null: nothing saved under the code. */
export interface CloudBackend {
  /** The cloud's clock less this device's, as last heard (ms; 0 till then): how far off this one is. */
  readonly clockOffset?: number;
  head(code: string, mode: GameMode): Promise<Reply<RemoteMeta | null>>;
  get(code: string, mode: GameMode): Promise<Reply<{ meta: RemoteMeta; bytes: Uint8Array } | null>>;
  /**
   * Stored only if the copy there is still `base` (its `savedAt`; 0: none), else a 409. `kind`: has it a layout edit
   * (since the copy it was made from)? The answer: when the cloud stored it, by its clock (0: not said).
   */
  put(code: string, mode: GameMode, bytes: Uint8Array, meta: RemoteMeta, base: number, edit: { kind: EditKind; at: number }, keepalive: boolean): Promise<Reply<{ storedAt: number }>>;
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
  /** Edited here since then. */
  dirty: boolean;
  /** When it was last edited here (ms). */
  changedAt: number;
  /** Any of those edits the player's (`layout`), and when the last was (ms; 0: none). */
  layout: boolean;
  layoutAt: number;
  /** When the cloud stored the copy this device last sent or took, by the cloud's clock (0: not known). */
  remoteStoredAt: number;
  /**
   * The copy last sent, until the cloud's answer is in (its `savedAt`; 0: none). A copy sent with `keepalive` as the
   * page closed has no answer here: found in the cloud at the next start, it's known as this device's own.
   */
  sentAt: number;
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
  /** How progress is merged (none: a conflict is always one copy or the other). */
  merge?: Merger | null;
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
  /** Whether each mode's dirty edits were already known to include a layout one (`edited`: its meta written once). */
  private readonly wasLayout: Record<GameMode, boolean> = { sandbox: false, game: false };
  /** When the upload timer goes off (`o.now()`), or Infinity. */
  private due = Infinity;
  private readonly busy = new Set<GameMode>();
  private readonly newer = new Set<GameMode>();
  /** Past the start-up check's deadline: it no longer writes a cloud copy into storage (the game has read it). */
  private late = false;
  private _status: CloudStatus;
  onStatus: (s: CloudStatus) => void = () => {};
  /** A mode's railway was changed elsewhere too while this one was played: theirs is kept as the backup. */
  onNote: (mode: GameMode, note: SyncNote) => void = () => {};
  /**
   * While playing, a newer copy from another device was written into storage over this one (kept as the backup): the
   * game should load it again (`note` says what happened, for after).
   */
  onTaken: (mode: GameMode, note: SyncNote) => void = () => {};
  /**
   * May a newer copy be taken now, while playing (the game starts again on it)? Not mid-gesture (a finger down, a
   * piece in hand): then it waits for the next round, as the rewards sheet does.
   */
  mayTake: () => boolean = () => true;
  /**
   * While playing, the mode's progress was merged with another device's into storage, the railway kept as it is here:
   * the game should take up the merged progress (and goals) from storage now, before its next save.
   */
  onMerged: (mode: GameMode) => void = () => {};
  /** A turn on, a code taken in, or a restore, under way (each waits for the other). */
  private working = false;
  /** The upload under way (the timer's, or `flush`'s), for `idle`. */
  private flushing: Promise<void> = Promise.resolve();

  constructor(opts: CloudOptions) {
    this.o = {
      merge: null,
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
    const notes = (await Promise.all(MODES.map((m) => this.reconcile(code, m, "start")))).map((n) => (n === "wait" ? null : n));
    const out: Partial<Record<GameMode, SyncNote>> = {};
    MODES.forEach((m, i) => notes[i] && (out[m] = notes[i]));
    for (const m of MODES) if (this.meta.modes[m].dirty) this.arm();
    if (this._status.kind === "saving") this.setStatus(this.anyDirty() ? { kind: "saving" } : { kind: "synced", at: this.o.now() });
    return out;
  }

  cutoff(): void {
    this.late = true;
  }

  /**
   * The mode's railway was edited (the game's save after a change, `scheduleSave`; not its 5 s save of the clock and
   * the trains rolling on): it goes up within `UPLOAD_EVERY_MS`. Cheap.
   */
  edited(mode: GameMode, kind: EditKind = "layout"): void {
    const m = this.meta.modes[mode];
    m.changedAt = this.o.now();
    if (kind === "layout") {
      m.layoutAt = m.changedAt;
      m.layout = true;
    }
    // Off: only when it was edited is kept (a railway kept aside when a code is taken in is labelled by it).
    if (!this.meta.code) {
      this.writeMeta();
      return;
    }
    this.gen[mode]++;
    if (!m.dirty || (kind === "layout" && !this.wasLayout[mode])) {
      m.dirty = true;
      this.writeMeta();
    }
    this.wasLayout[mode] = m.layout;
    this.arm();
  }

  /** The upload under way, if any, done (and any it set off). */
  async idle(): Promise<void> {
    let last: Promise<void> | null = null;
    while (last !== this.flushing) {
      last = this.flushing;
      await last;
    }
  }

  /** Send what's changed now: on the way out (`leaving`: the page hidden or closing), or when back online. */
  async flush(leaving = false): Promise<void> {
    if (this.timer !== null) {
      this.o.clearTimer(this.timer);
      this.timer = null;
      this.due = Infinity;
    }
    if (!this.meta.code) return;
    const run = Promise.all(MODES.map((m) => this.upload(m, leaving))).then(() => {});
    this.flushing = run;
    await run;
    // (Nothing there was to send.)
    if (this._status.kind === "saving" && !this.anyDirty()) this.settle();
    // (Kept: `changedAt`, for the next start's check.)
    if (leaving) this.writeMeta();
  }

  /** Turn cloud saves on with a new code: both railways go up now. Null if something else is under way. */
  async enable(): Promise<string | null> {
    if (this.working) return null;
    this.working = true;
    try {
      const code = newCode();
      const was = this.meta.modes;
      this.meta = { code, modes: { sandbox: freshMode(), game: freshMode() } };
      for (const m of MODES) {
        this.sent[m] = null;
        const here = this.o.storage.getItem(this.o.keys[m][0]) !== null;
        // (A railway's first copy up is all of it: the player's.)
        this.meta.modes[m] = { ...freshMode(), dirty: here, layout: here, changedAt: here ? was[m].changedAt || this.o.now() : 0, layoutAt: here ? was[m].changedAt || this.o.now() : 0 };
      }
      this.writeMeta();
      this.setStatus({ kind: "saving" });
      await this.flush();
      return code;
    } finally {
      this.working = false;
    }
  }

  /**
   * Carry on with the railways saved under a code from another device: theirs replace this device's (which are kept
   * as backups), and from now on changes go up under that code. A mode with nothing saved under it sends this
   * device's railway.
   */
  async useCode(typed: string): Promise<UseCodeResult> {
    const code = parseCode(typed);
    if (!code) return { ok: false, error: "malformed" };
    if (this.working) return { ok: false, error: "offline" };
    this.working = true;
    try {
      return await this.takeCode(code);
    } finally {
      this.working = false;
    }
  }

  private async takeCode(code: string): Promise<UseCodeResult> {
    const heads = await Promise.all(MODES.map((m) => this.o.backend.head(code, m)));
    if (heads.some((h) => !h.ok)) return { ok: false, error: "offline" };
    const remote = heads.map((h) => (h.ok ? h.value : null));
    if (remote.every((r) => r === null)) return { ok: false, error: "nothing" };
    if (remote.some((r) => r !== null && r.saveVersion > this.o.saveVersion)) return { ok: false, error: "newer" };
    const took: GameMode[] = [];
    const modes = { sandbox: freshMode(), game: freshMode() };
    for (const [i, mode] of MODES.entries()) {
      if (remote[i] === null) {
        const here = this.o.storage.getItem(this.o.keys[mode][0]) !== null;
        modes[mode] = { ...modes[mode], dirty: here, layout: here, changedAt: this.o.now(), layoutAt: this.o.now() };
        continue;
      }
      const got = await this.o.backend.get(code, mode);
      if (!got.ok || !got.value) return { ok: false, error: "offline" };
      const bundle = await this.readBundle(got.value.bytes, mode);
      if (!bundle) return { ok: false, error: "offline" };
      if (this.o.storage.getItem(this.o.keys[mode][0]) !== null) await this.keepBackup(mode, this.bundleHere(mode, this.meta.modes[mode].changedAt || this.o.now()));
      if (!this.apply(bundle)) return { ok: false, error: "offline" };
      this.writeBase(mode, bundle.keys);
      modes[mode].remoteSavedAt = modes[mode].changedAt = got.value.meta.savedAt;
      modes[mode].remoteStoredAt = got.value.meta.storedAt ?? 0;
      took.push(mode);
    }
    this.meta = { code, modes };
    for (const m of MODES) this.sent[m] = null;
    this.newer.clear();
    this.writeMeta();
    this.setStatus({ kind: "synced", at: this.o.now() });
    return { ok: true, took };
  }

  /**
   * Turn cloud saves off: the code is forgotten here, and the railways kept aside by syncs with it (the card asks
   * first, and says so). The railways stay, here and in the cloud.
   */
  disable(): void {
    if (this.timer !== null) this.o.clearTimer(this.timer);
    this.timer = null;
    const edited = (m: GameMode) => ({ ...freshMode(), changedAt: this.meta.modes[m].changedAt });
    this.meta = { code: null, modes: { sandbox: edited("sandbox"), game: edited("game") } };
    this.writeMeta();
    // (The copy last matched stays: turned on again, maybe on a new code with another device that had it too, it's
    // what the two have in common. A merge uses it only for the same game: see `mergeProgress`.)
    for (const m of MODES) {
      try {
        this.o.storage.removeItem(backupKey(m));
      } catch {
        // gone with the code anyway
      }
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
    if (this.working) return false;
    this.working = true;
    try {
      const b = this.readBackup(mode);
      if (!b) return false;
      const bundle = await this.readBundle(fromBase64(b.data), mode);
      if (!bundle) return false;
      const m = this.meta.modes[mode];
      await this.keepBackup(mode, this.bundleHere(mode, m.changedAt || this.o.now()));
      if (!this.apply(bundle)) return false;
      this.edited(mode);
      return true;
    } finally {
      this.working = false;
    }
  }

  /**
   * The cloud's copy of a mode against this device's, when the game starts or before an upload. A copy there that
   * this device didn't send or take since was sent by another: if this one hasn't been edited since, it's taken; if
   * both were, the one edited later wins and the other is kept as the backup. Taken while playing (`before-put`), the
   * game is told to load it (`onTaken`).
   */
  private async reconcile(code: string, mode: GameMode, when: "start" | "before-put"): Promise<SyncNote | "wait"> {
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
    // This device's own, sent as its page closed (no answer came back to say so).
    if (m.sentAt !== 0 && remote.savedAt === m.sentAt) {
      m.remoteSavedAt = m.sentAt;
      m.remoteStoredAt = remote.storedAt ?? 0;
      if (m.changedAt <= m.sentAt) {
        m.dirty = false;
        m.layout = false;
        // (What went is what's here: nothing was edited since.)
        this.writeBase(mode, Object.fromEntries(this.readKeys(mode)));
      }
      m.sentAt = 0;
      this.writeMeta();
      return null;
    }
    // Another device sent its copy since this one last did.
    const got = await this.o.backend.get(code, mode);
    if (!got.ok || !got.value) return null;
    const bundle = await this.readBundle(got.value.bytes, mode);
    if (!bundle) return null;
    // (When the other copy was made: when the cloud stored it, by this device's clock, so two devices' clocks never
    // disagree about which edit came later; by the other's own clock if the cloud didn't say.)
    const offset = this.o.backend.clockOffset ?? 0;
    const storedAt = remote.storedAt ? remote.storedAt - offset : remote.savedAt;
    // A layout edit there since the copy this device last had (not said, or the copy it had not known: taken as one).
    const theirLayout = remote.layoutStoredAt === undefined || (remote.layoutStoredAt > 0 && (!m.remoteStoredAt || remote.layoutStoredAt > m.remoteStoredAt));
    // Both only played on (no layout edit on either since they last matched): merged, nothing lost, nothing said.
    const mergeable = this.o.merge?.keys[mode];
    if (here && m.dirty && !m.layout && !theirLayout && mergeable && this.o.merge) {
      const later = storedAt > m.changedAt ? "remote" : "local";
      if (when === "start" && this.late) return null;
      if (when === "before-put" && later === "remote" && !this.mayTake()) return "wait";
      const local = Object.fromEntries(this.readKeys(mode));
      const merged = this.o.merge.merge(mode, this.readBase(mode), local, bundle.keys, later);
      // The rest (the railway, its clock) as the later copy has it.
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(later === "remote" ? bundle.keys : local)) if (v !== null) out[k] = v;
      for (const k of mergeable) {
        const v = merged[k];
        if (v === null || v === undefined) delete out[k];
        else out[k] = v;
      }
      if (!this.apply({ ...bundle, keys: out })) return null;
      // (The base is the cloud's, till the merged copy goes up and becomes it.)
      this.writeBase(mode, bundle.keys);
      m.remoteSavedAt = got.value.meta.savedAt;
      m.remoteStoredAt = remote.storedAt ?? 0;
      m.dirty = true;
      this.sent[mode] = null;
      this.writeMeta();
      if (when === "before-put") {
        if (later === "remote") this.onTaken(mode, null);
        else this.onMerged(mode);
      }
      return null;
    }
    const cloudWins = !here || !m.dirty || (theirLayout !== m.layout ? theirLayout : m.layout ? (remote.layoutAt ? remote.layoutAt - offset : storedAt) > m.layoutAt : storedAt > m.changedAt);
    if (cloudWins) {
      if (when === "start" && this.late) return null;
      // (Not mid-gesture: tried again on the next round.)
      if (when === "before-put" && !this.mayTake()) return "wait";
      // Edited here as well: this device's copy is kept aside. Its progress is merged into the one taken (the railway
      // is the layout winner's, the earnings both's): then that goes up.
      const both = here && m.dirty;
      if (both) await this.keepBackup(mode, this.bundleHere(mode, m.changedAt));
      const merged = both ? this.mergedInto(mode, bundle.keys, "remote") : null;
      if (!this.apply(merged ? { ...bundle, keys: merged } : bundle)) return null;
      this.writeBase(mode, bundle.keys);
      this.meta.modes[mode] = { ...freshMode(), remoteSavedAt: got.value.meta.savedAt, changedAt: storedAt, remoteStoredAt: remote.storedAt ?? 0 };
      this.wasLayout[mode] = false;
      this.sent[mode] = null;
      if (merged) {
        this.meta.modes[mode].dirty = true;
        this.meta.modes[mode].changedAt = this.o.now();
        this.arm();
      }
      this.writeMeta();
      const note: SyncNote = both ? "took-cloud" : null;
      if (when === "before-put") this.onTaken(mode, note);
      return note;
    }
    // This device's wins (a layout edit over progress, or the later): the cloud's is kept aside (dated by when the cloud
    // stored it, on this device's clock), and this one goes up over it.
    await this.keepBackup(mode, { ...bundle, savedAt: storedAt });
    // (The cloud's progress merged into this one's: the railway is this one's, the earnings both's.)
    const merged = this.mergedInto(mode, Object.fromEntries(this.readKeys(mode)), "local", bundle.keys);
    if (merged && this.apply({ ...bundle, keys: merged }) && when === "before-put") this.onMerged(mode);
    this.writeBase(mode, bundle.keys);
    m.remoteSavedAt = got.value.meta.savedAt;
    m.remoteStoredAt = remote.storedAt ?? 0;
    m.dirty = true;
    this.writeMeta();
    return when === "start" ? "kept-here" : "both-changed";
  }

  private async upload(mode: GameMode, leaving: boolean): Promise<void> {
    const code = this.meta.code;
    const m = this.meta.modes[mode];
    if (!code || !m.dirty || this.newer.has(mode) || this.busy.has(mode)) return;
    this.busy.add(mode);
    try {
      let keys = this.readKeys(mode);
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
        const note = await this.reconcile(code, mode, "before-put");
        if (note === "wait") {
          this.arm();
          return;
        }
        // (Taken from the cloud: nothing of this one's left to send.)
        if (!m.dirty) return;
        if (note) this.onNote(mode, note);
        if (this.newer.has(mode)) return;
        // (A merge may have changed them.)
        keys = this.readKeys(mode);
      }
      const gen = this.gen[mode];
      const savedAt = this.o.now();
      // (Kept before it goes: a page closing won't hear the answer.)
      m.sentAt = savedAt;
      this.writeMeta();
      const bytes = await gzip(JSON.stringify(bundleOf(mode, savedAt, this.o.saveVersion, keys)));
      // (A layout edit goes with when it was made, on the cloud's clock: QA saw a later edit lose to an earlier one
      // stored later.)
      const edit = { kind: (m.layout ? "layout" : "progress") as EditKind, at: m.layoutAt + (this.o.backend.clockOffset ?? 0) };
      const res = await this.o.backend.put(code, mode, bytes, { savedAt, saveVersion: this.o.saveVersion }, m.remoteSavedAt, edit, leaving && bytes.byteLength <= KEEPALIVE_MAX);
      // (Turned off, or another code taken, meanwhile.)
      if (this.meta.code !== code) return;
      if (res.ok) {
        m.remoteSavedAt = savedAt;
        m.remoteStoredAt = res.value.storedAt;
        m.sentAt = 0;
        this.sent[mode] = keys;
        this.writeBase(mode, Object.fromEntries(keys));
        if (gen === this.gen[mode]) {
          m.dirty = false;
          m.layout = false;
          this.wasLayout[mode] = false;
        }
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

  /** The upload timer: 30 s after a layout edit, 60 s when there's only progress to send (a sooner one replaces it). */
  private arm(): void {
    const layout = MODES.some((m) => this.meta.modes[m].dirty && this.meta.modes[m].layout);
    const ms = layout ? UPLOAD_EVERY_MS : PROGRESS_EVERY_MS;
    const due = this.o.now() + ms;
    if (this.timer !== null) {
      if (due >= this.due) return;
      this.o.clearTimer(this.timer);
    }
    this.due = due;
    this.timer = this.o.setTimer(() => {
      this.timer = null;
      this.due = Infinity;
      this.flushing = this.flush();
    }, ms);
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

  /**
   * The keys `winner` has (the layout clash's winner's: its railway), with the mergeable ones merged with the other
   * side's through the base. `later` names the winner. Null when the mode has nothing to merge.
   */
  private mergedInto(mode: GameMode, winner: Keys, later: "local" | "remote", loser?: Keys): Record<string, string> | null {
    const mergeable = this.o.merge?.keys[mode];
    if (!mergeable || !this.o.merge) return null;
    const local = later === "local" ? winner : Object.fromEntries(this.readKeys(mode));
    const remote = later === "remote" ? winner : (loser ?? {});
    const merged = this.o.merge.merge(mode, this.readBase(mode), local, remote, later);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(winner)) if (v !== null) out[k] = v;
    for (const k of mergeable) {
      const v = merged[k];
      if (v === null || v === undefined) delete out[k];
      else out[k] = v;
    }
    return out;
  }

  /** The mergeable keys as last synced (none kept for a mode with nothing to merge). */
  private readBase(mode: GameMode): Keys {
    try {
      const raw = this.o.storage.getItem(baseKey(mode));
      const b = raw ? (JSON.parse(raw) as unknown) : null;
      return b && typeof b === "object" ? (b as Keys) : {};
    } catch {
      return {};
    }
  }

  private writeBase(mode: GameMode, keys: Keys): void {
    const mergeable = this.o.merge?.keys[mode];
    if (!mergeable) return;
    const out: Keys = {};
    for (const k of mergeable) out[k] = keys[k] ?? null;
    try {
      this.o.storage.setItem(baseKey(mode), JSON.stringify(out));
    } catch {
      // No room: the next merge counts from the cloud's copy.
    }
  }

  private readMeta(): Meta {
    try {
      const raw = this.o.storage.getItem(META_KEY);
      const m = raw ? (JSON.parse(raw) as Meta) : null;
      if (m && typeof m.code === "string" && parseCode(m.code) === m.code) {
        return { code: m.code, modes: { sandbox: { ...freshMode(), ...m.modes?.sandbox }, game: { ...freshMode(), ...m.modes?.game } } };
      }
      // Off: when each was last edited.
      const at = (x: unknown) => (typeof x === "number" ? x : 0);
      if (m) return { code: null, modes: { sandbox: { ...freshMode(), changedAt: at(m.modes?.sandbox?.changedAt) }, game: { ...freshMode(), changedAt: at(m.modes?.game?.changedAt) } } };
    } catch {
      // unreadable: off
    }
    return { code: null, modes: { sandbox: freshMode(), game: freshMode() } };
  }

  private writeMeta(): void {
    try {
      this.o.storage.setItem(META_KEY, JSON.stringify(this.meta));
    } catch {
      // storage full: what's dirty is found again from the next change
    }
  }
}

const freshMode = (): ModeMeta => ({ remoteSavedAt: 0, dirty: false, changedAt: 0, layout: false, layoutAt: 0, remoteStoredAt: 0, sentAt: 0 });

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
  clockOffset = 0;

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

  async put(code: string, mode: GameMode, bytes: Uint8Array, meta: RemoteMeta, base: number, edit: { kind: EditKind; at: number }, keepalive: boolean): Promise<Reply<{ storedAt: number }>> {
    const res = await this.call("PUT", code, mode, {
      body: bytes as BodyInit,
      keepalive,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Saved-At": String(meta.savedAt),
        "X-Save-Version": String(meta.saveVersion),
        "X-Game-Version": this.gameVersion,
        "X-Base-Saved-At": String(base),
        "X-Edit-Kind": edit.kind,
        "X-Edited-At": String(Math.round(edit.at)),
      },
    });
    if (!res) return { ok: false, status: 0 };
    return res.ok ? { ok: true, value: { storedAt: Number(res.headers.get("X-Stored-At") ?? 0) } } : { ok: false, status: res.status };
  }

  private async call(method: string, code: string, mode: GameMode, init: { body?: BodyInit; keepalive?: boolean; headers?: Record<string, string> } = {}): Promise<Response | null> {
    try {
      const res = await fetch(`${this.base.replace(/\/$/, "")}/v1/saves/${mode}`, {
        method,
        body: init.body,
        keepalive: init.keepalive,
        cache: "no-store",
        headers: { "X-Woodrail-Code": code, ...init.headers },
        // (A request on the way out has to go on as the page closes.)
        signal: init.keepalive ? undefined : AbortSignal.timeout(15_000),
      });
      const now = Number(res.headers.get("X-Server-Now"));
      if (now > 0) this.clockOffset = now - Date.now();
      return res;
    } catch {
      return null;
    }
  }
}

const metaOf = (res: Response): RemoteMeta => ({
  savedAt: Number(res.headers.get("X-Saved-At") ?? 0),
  saveVersion: Number(res.headers.get("X-Save-Version") ?? 0),
  storedAt: Number(res.headers.get("X-Stored-At") ?? 0),
  layoutAt: Number(res.headers.get("X-Layout-At") ?? 0),
  layoutStoredAt: Number(res.headers.get("X-Layout-Stored-At") ?? 0),
});

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
