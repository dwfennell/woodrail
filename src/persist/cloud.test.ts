import { describe, expect, it, vi } from "vitest";
import type { GameMode } from "../game/modes";
import { CloudSync, gunzip, PROGRESS_EVERY_MS, statusText, UPLOAD_EVERY_MS, type CloudBackend, type EditKind, type KeyStore, type Merger, type RemoteMeta, type Reply } from "./cloud";
import { WORDS } from "./code-words";
import { gameMerger } from "./progress-merge";
import { newCode, parseCode, showCode } from "./sync-code";

const KEYS: Record<GameMode, string[]> = { sandbox: ["s.save", "s.session"], game: ["g.save", "g.session", "g.goals", "g.prog"] };

class MemStore implements KeyStore {
  readonly m = new Map<string, string>();
  full = false;
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.full) throw new Error("QuotaExceededError");
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

/** The Worker, in memory (see cloud/src/index.ts), with switches for its failures. */
class FakeCloud implements CloudBackend {
  readonly saves = new Map<string, { meta: RemoteMeta; bytes: Uint8Array }>();
  puts = 0;
  offline = false;
  /** Each PUT's kind, in order. */
  readonly kinds: EditKind[] = [];
  /** Stored, but the answer never comes (the page closed). */
  hangPuts = false;
  /** The cloud's own clock, when a test has one: copies are stored at its time (`storedAt`). */
  server: { t: number } | null = null;
  reply429 = false;
  async head(code: string, mode: GameMode): Promise<Reply<RemoteMeta | null>> {
    if (this.offline) return { ok: false, status: 0 };
    return { ok: true, value: this.saves.get(`${code}/${mode}`)?.meta ?? null };
  }
  async get(code: string, mode: GameMode): Promise<Reply<{ meta: RemoteMeta; bytes: Uint8Array } | null>> {
    if (this.offline) return { ok: false, status: 0 };
    return { ok: true, value: this.saves.get(`${code}/${mode}`) ?? null };
  }
  async put(code: string, mode: GameMode, bytes: Uint8Array, meta: RemoteMeta, base: number, edit: { kind: EditKind; at: number }): Promise<Reply<{ storedAt: number }>> {
    const kind = edit.kind;
    if (this.offline) return { ok: false, status: 0 };
    if (this.reply429) return { ok: false, status: 429 };
    if ((this.saves.get(`${code}/${mode}`)?.meta.savedAt ?? 0) !== base) return { ok: false, status: 409 };
    this.puts++;
    const was = this.saves.get(`${code}/${mode}`)?.meta;
    const storedAt = this.server ? this.server.t : meta.savedAt;
    const layout = kind === "layout";
    this.saves.set(`${code}/${mode}`, {
      meta: { ...meta, storedAt, layoutAt: layout ? Math.min(edit.at || storedAt, storedAt) : (was?.layoutAt ?? 0), layoutStoredAt: layout ? storedAt : (was?.layoutStoredAt ?? 0) },
      bytes,
    });
    this.kinds.push(kind);
    if (this.hangPuts) return new Promise(() => {});
    return { ok: true, value: { storedAt } };
  }
  async keysOf(code: string, mode: GameMode): Promise<Record<string, string>> {
    return (JSON.parse(await gunzip(this.saves.get(`${code}/${mode}`)!.bytes)) as { keys: Record<string, string> }).keys;
  }
}

/** A device: its storage, its clock and its timers (run by hand). */
function device(cloud: CloudBackend & FakeCloud, store = new MemStore(), clock = { t: 1_000_000 }, merge: Merger | null = null) {
  const timers: (() => void)[] = [];
  const sync = new CloudSync({
    backend: cloud,
    storage: store,
    keys: KEYS,
    saveVersion: 13,
    merge,
    now: () => clock.t,
    setTimer: (fn, ms) => {
      expect([UPLOAD_EVERY_MS, PROGRESS_EVERY_MS]).toContain(ms);
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => timers.splice(0),
  });
  const notes: [GameMode, string | null][] = [];
  sync.onNote = (m, n) => notes.push([m, n]);
  return {
    sync,
    store,
    clock,
    notes,
    timers,
    /** The 30 s timer goes off (and its upload finishes). */
    async tick(): Promise<void> {
      clock.t += UPLOAD_EVERY_MS;
      const due = timers.splice(0);
      for (const fn of due) fn();
      await sync.idle();
    },
    /** An edit, saved (the player's, unless said: `progress` is the game's own, coins from a delivery). */
    save(mode: GameMode, text: string, kind: EditKind = "layout"): void {
      store.setItem(KEYS[mode][0], `{"version":13,"text":"${text}"}`);
      sync.edited(mode, kind);
    },
    /** The 5 s save of a railway played on, nothing edited (its clock, its trains rolling): no edit. */
    tickOn(mode: GameMode, clockText: string): void {
      store.setItem(KEYS[mode][1], `{"clock":"${clockText}"}`);
    },
  };
}

describe("sync codes", () => {
  it("has 1024 words of 3 to 5 lowercase letters, all different", () => {
    expect(WORDS).toHaveLength(1024);
    expect(new Set(WORDS).size).toBe(1024);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]{3,5}$/);
  });

  it("makes three words and four digits", () => {
    for (let i = 0; i < 50; i++) {
      const c = newCode();
      expect(c).toMatch(/^[a-z]{3,5}-[a-z]{3,5}-[a-z]{3,5}-\d{4}$/);
      expect(parseCode(c)).toBe(c);
    }
    expect(newCode(() => 0)).toBe(`${WORDS[0]}-${WORDS[0]}-${WORDS[0]}-0000`);
  });

  it("reads a code however it's typed", () => {
    expect(parseCode("Acorn badge, otter 0420")).toBe("acorn-badge-otter-0420");
    expect(parseCode("  ACORN-BADGE-OTTER-0420 ")).toBe("acorn-badge-otter-0420");
    expect(parseCode(showCode("acorn-badge-otter-0420"))).toBe("acorn-badge-otter-0420");
    expect(parseCode("acorn badge otter")).toBeNull();
    expect(parseCode("acorn badge otter 420")).toBeNull();
    expect(parseCode("acorn badge qqqq 0420")).toBeNull();
    expect(parseCode("")).toBeNull();
  });
});

describe("cloud saves", () => {
  it("is off until turned on, and costs nothing then", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.save("sandbox", "one");
    expect(a.sync.status.kind).toBe("off");
    expect(a.timers).toHaveLength(0);
    await a.sync.flush();
    expect(cloud.puts).toBe(0);
  });

  it("turning on with nothing to send yet: on, and saved (nothing's waiting)", async () => {
    const a = device(new FakeCloud());
    await a.sync.enable();
    expect(a.sync.status.kind).toBe("synced");
  });

  it("turning on sends each railway there is", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.store.setItem("s.save", '{"version":13}');
    a.store.setItem("s.session", "{}");
    const code = (await a.sync.enable())!;
    expect(cloud.puts).toBe(1);
    expect(await cloud.keysOf(code, "sandbox")).toEqual({ "s.save": '{"version":13}', "s.session": "{}" });
    expect(a.sync.status.kind).toBe("synced");
  });

  it("sends changes at most every 30 s, and nothing when nothing changed", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    await a.sync.enable();
    for (let i = 0; i < 5; i++) a.save("sandbox", `edit ${i}`);
    expect(cloud.puts).toBe(0);
    expect(a.timers).toHaveLength(1);
    await a.tick();
    expect(cloud.puts).toBe(1);
    expect(a.sync.status.kind).toBe("synced");
    // Saved again, unchanged (the 5 s autosave of a still railway): not sent.
    a.save("sandbox", "edit 4");
    await a.tick();
    expect(cloud.puts).toBe(1);
    expect(a.timers).toHaveLength(0);
  });

  it("carries a railway to another device with its code", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const code = (await a.sync.enable())!;
    a.save("game", "my game");
    a.store.setItem("g.goals", '["a"]');
    a.sync.edited("game");
    await a.sync.flush();

    const b = device(cloud);
    b.store.setItem("g.save", '{"version":13,"text":"b\'s own"}');
    const res = await b.sync.useCode(showCode(code).toUpperCase());
    expect(res).toEqual({ ok: true, took: ["game"] });
    expect(b.store.getItem("g.save")).toBe('{"version":13,"text":"my game"}');
    expect(b.store.getItem("g.goals")).toBe('["a"]');
    expect(b.sync.code).toBe(code);
    // B's own game is kept, to restore.
    expect(b.sync.backupOf("game")).not.toBeNull();
    expect(await b.sync.restore("game")).toBe(true);
    expect(b.store.getItem("g.save")).toBe('{"version":13,"text":"b\'s own"}');
    // (And back again: a restore swaps.)
    expect(await b.sync.restore("game")).toBe(true);
    expect(b.store.getItem("g.save")).toBe('{"version":13,"text":"my game"}');
  });

  it("says why a code won't do", async () => {
    const cloud = new FakeCloud();
    const b = device(cloud);
    expect(await b.sync.useCode("not a code")).toEqual({ ok: false, error: "malformed" });
    expect(await b.sync.useCode("acorn badge otter 0420")).toEqual({ ok: false, error: "nothing" });
    cloud.offline = true;
    expect(await b.sync.useCode("acorn badge otter 0420")).toEqual({ ok: false, error: "offline" });
    expect(b.sync.code).toBeNull();
  });

  it("at start-up takes the newer copy from the cloud", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const code = (await a.sync.enable())!;
    a.save("sandbox", "v1");
    await a.sync.flush();
    // B carries on with it, and sends a newer one.
    const b = device(cloud, new MemStore(), { t: 2_000_000 });
    expect((await b.sync.useCode(code)).ok).toBe(true);
    b.save("sandbox", "v2 from b");
    await b.sync.flush();
    // A starts again: B's is there, and A has changed nothing since.
    const a2 = device(cloud, a.store, a.clock);
    expect(await a2.sync.start()).toEqual({});
    expect(a2.store.getItem("s.save")).toContain("v2 from b");
    expect(a2.sync.backupOf("sandbox")).toBeNull();
  });

  it("both changed: the newer wins, and the other is kept", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const code = (await a.sync.enable())!;
    a.save("sandbox", "v1");
    await a.sync.flush();
    const b = device(cloud, new MemStore(), { t: 3_000_000 });
    expect((await b.sync.useCode(code)).ok).toBe(true);
    // A changes it (at 1 000 000, offline: not sent), then B, later, sends its own.
    cloud.offline = true;
    a.save("sandbox", "a's change");
    await a.sync.flush();
    expect(a.sync.status.kind).toBe("offline");
    cloud.offline = false;
    b.save("sandbox", "b's change");
    await b.sync.flush();
    // A starts again: B's is newer.
    const a2 = device(cloud, a.store, a.clock);
    expect(await a2.sync.start()).toEqual({ sandbox: "took-cloud" });
    expect(a2.store.getItem("s.save")).toContain("b's change");
    expect(await a2.sync.restore("sandbox")).toBe(true);
    expect(a2.store.getItem("s.save")).toContain("a's change");
  });

  it("both changed, this one later: it's kept, and goes up over the cloud's (which is kept here)", async () => {
    const cloud = new FakeCloud();
    const b = device(cloud, new MemStore(), { t: 1_000_000 });
    const code = (await b.sync.enable())!;
    b.save("sandbox", "b's");
    await b.sync.flush();
    const a = device(cloud, new MemStore(), { t: 1_000_500 });
    expect((await a.sync.useCode(code)).ok).toBe(true);
    a.clock.t = 5_000_000;
    cloud.offline = true;
    a.save("sandbox", "a's later change");
    await a.sync.flush();
    cloud.offline = false;
    b.clock.t = 2_000_000;
    b.save("sandbox", "b's change");
    await b.sync.flush();
    const a2 = device(cloud, a.store, a.clock);
    expect(await a2.sync.start()).toEqual({ sandbox: "kept-here" });
    expect(a2.store.getItem("s.save")).toContain("a's later change");
    await a2.tick();
    expect(await cloud.keysOf(code, "sandbox")).toMatchObject({ "s.save": expect.stringContaining("a's later change") });
    expect(a2.sync.backupOf("sandbox")).toBe(2_000_000);
  });

  it("while playing, both edited, this one later: the other device's is kept, and this one goes up", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.store.setItem("s.save", '{"version":13,"text":"a\'s first"}');
    const code = (await a.sync.enable())!;
    const b = device(cloud, new MemStore(), { t: 1_000_100 });
    expect((await b.sync.useCode(code)).ok).toBe(true);
    b.save("sandbox", "b's again");
    await b.sync.flush();
    a.clock.t = 1_000_200;
    a.save("sandbox", "a's");
    await a.tick();
    expect(a.notes).toEqual([["sandbox", "both-changed"]]);
    expect(await cloud.keysOf(code, "sandbox")).toMatchObject({ "s.save": expect.stringContaining("a's") });
    expect(a.sync.backupOf("sandbox")).not.toBeNull();
  });

  it("on the way out, never over another device's copy: settled at the next start", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.store.setItem("s.save", '{"version":13,"text":"a\'s first"}');
    const code = (await a.sync.enable())!;
    const b = device(cloud, new MemStore(), { t: 2_000_000 });
    expect((await b.sync.useCode(code)).ok).toBe(true);
    b.save("sandbox", "b's change");
    await b.sync.flush();
    // A, not knowing, changes its own and closes.
    a.save("sandbox", "a's change");
    await a.sync.flush(true);
    expect(await cloud.keysOf(code, "sandbox")).toMatchObject({ "s.save": expect.stringContaining("b's change") });
    // Next time: B's is newer, so it's taken, and A's change is kept to restore.
    const a2 = device(cloud, a.store, a.clock);
    expect(await a2.sync.start()).toEqual({ sandbox: "took-cloud" });
    expect(a2.store.getItem("s.save")).toContain("b's change");
    expect(a2.sync.backupOf("sandbox")).not.toBeNull();
  });

  it("QA B1: a device only open (its clock running on, nothing edited) sends nothing, and never over another's edits", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.store.setItem("s.save", '{"version":13,"text":"8 pieces"}');
    const code = (await a.sync.enable())!;
    const b = device(cloud, new MemStore(), { t: 1_000_100 });
    expect((await b.sync.useCode(code)).ok).toBe(true);
    b.save("sandbox", "14 pieces");
    await b.sync.flush();
    const puts = cloud.puts;
    // A plays on for minutes, untouched.
    for (let i = 0; i < 10; i++) {
      a.tickOn("sandbox", `clock ${i}`);
      await a.tick();
    }
    expect(a.timers).toHaveLength(0);
    expect(cloud.puts).toBe(puts);
    expect(await cloud.keysOf(code, "sandbox")).toMatchObject({ "s.save": expect.stringContaining("14 pieces") });
    // Started again, A simply takes B's: nothing of A's was edited, so nothing's kept aside or said.
    const a2 = device(cloud, a.store, a.clock);
    expect(await a2.sync.start()).toEqual({});
    expect(a2.store.getItem("s.save")).toContain("14 pieces");
    expect(a2.sync.backupOf("sandbox")).toBeNull();
  });

  it("QA B2: back online, an edit made offline before the other device's: the other's is taken (the game reloads it)", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.store.setItem("s.save", '{"version":13,"text":"8 pieces"}');
    const code = (await a.sync.enable())!;
    const taken: [GameMode, string | null][] = [];
    a.sync.onTaken = (m, n) => taken.push([m, n]);
    cloud.offline = true;
    a.clock.t = 1_000_500;
    a.save("sandbox", "10 pieces");
    await a.sync.flush();
    cloud.offline = false;
    const b = device(cloud, new MemStore(), { t: 2_000_000 });
    expect((await b.sync.useCode(code)).ok).toBe(true);
    b.save("sandbox", "13 pieces");
    await b.sync.flush();
    // Back online.
    await a.sync.flush();
    expect(await cloud.keysOf(code, "sandbox")).toMatchObject({ "s.save": expect.stringContaining("13 pieces") });
    expect(a.store.getItem("s.save")).toContain("13 pieces");
    expect(taken).toEqual([["sandbox", "took-cloud"]]);
    // A's edit is kept to restore.
    expect(await a.sync.restore("sandbox")).toBe(true);
    expect(a.store.getItem("s.save")).toContain("10 pieces");
  });

  it("QA B3: a device that didn't edit (only saved as its page hid) takes the other's edits at its next start", async () => {
    const cloud = new FakeCloud();
    const b = device(cloud, new MemStore(), { t: 1_000_000 });
    b.store.setItem("s.save", '{"version":13,"text":"8 pieces"}');
    const code = (await b.sync.enable())!;
    const a = device(cloud, new MemStore(), { t: 1_000_100 });
    expect((await a.sync.useCode(code)).ok).toBe(true);
    // B's page hides (saved, not edited), later than A's edit below would be.
    b.clock.t = 3_000_000;
    b.tickOn("sandbox", "paused");
    await b.sync.flush(true);
    a.clock.t = 2_000_000;
    a.save("sandbox", "12 pieces");
    await a.sync.flush(true);
    const b2 = device(cloud, b.store, b.clock);
    expect(await b2.sync.start()).toEqual({});
    expect(b2.store.getItem("s.save")).toContain("12 pieces");
    await b2.tick();
    expect(await cloud.keysOf(code, "sandbox")).toMatchObject({ "s.save": expect.stringContaining("12 pieces") });
  });

  it("a copy sent as the page closed (no answer heard) is known as this device's own at the next start", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.store.setItem("s.save", '{"version":13,"text":"first"}');
    const code = (await a.sync.enable())!;
    a.clock.t = 1_500_000;
    a.save("sandbox", "closing");
    cloud.hangPuts = true;
    void a.sync.flush(true);
    await new Promise((r) => setTimeout(r, 0));
    await vi.waitFor(() => expect(cloud.puts).toBe(2));
    cloud.hangPuts = false;
    const a2 = device(cloud, a.store, a.clock);
    expect(await a2.sync.start()).toEqual({});
    expect(a2.sync.backupOf("sandbox")).toBeNull();
    expect(a2.timers).toHaveLength(0);
    expect(await cloud.keysOf(code, "sandbox")).toMatchObject({ "s.save": expect.stringContaining("closing") });
  });

  it("one turn-on, code or restore at a time", async () => {
    const a = device(new FakeCloud());
    a.store.setItem("s.save", '{"version":13}');
    const [one, two] = await Promise.all([a.sync.enable(), a.sync.enable()]);
    expect(one).not.toBeNull();
    expect(two).toBeNull();
    expect(a.sync.code).toBe(one);
  });

  it("turning off forgets the railway kept aside too", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const code = (await a.sync.enable())!;
    a.save("game", "theirs");
    await a.sync.flush();
    const b = device(cloud);
    b.store.setItem("g.save", '{"version":13,"text":"mine"}');
    expect((await b.sync.useCode(code)).ok).toBe(true);
    expect(b.sync.backupOf("game")).not.toBeNull();
    b.sync.disable();
    expect(b.sync.backupOf("game")).toBeNull();
  });

  it("a railway kept aside is labelled by when it was last edited, not when it was kept", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const code = (await a.sync.enable())!;
    a.save("game", "theirs");
    await a.sync.flush();
    // B, off, edits its own at 1 200 000; it's kept aside when B takes A's code later, at 5 000 000.
    const b = device(cloud, new MemStore(), { t: 1_200_000 });
    b.save("game", "mine");
    const b2 = device(cloud, b.store, b.clock);
    b2.clock.t = 5_000_000;
    expect((await b2.sync.useCode(code)).ok).toBe(true);
    expect(b2.sync.backupOf("game")).toBe(1_200_000);
  });

  it("which edit came later is judged by the cloud's clock, not the other device's (B's clock 25 min slow)", async () => {
    const cloud = new FakeCloud();
    const server = { t: 1_000_000 };
    cloud.server = server;
    // A's clock is right; B's is behind. A device knows its offset from the cloud's answers.
    const a = device(cloud, new MemStore(), server);
    const bClock = { t: server.t - 1_500_000 };
    const bCloud = Object.assign(Object.create(cloud) as FakeCloud, { clockOffset: 1_500_000 });
    a.store.setItem("s.save", '{"version":13,"text":"first"}');
    const code = (await a.sync.enable())!;
    const taken: GameMode[] = [];
    a.sync.onTaken = (m) => taken.push(m);
    // A edits offline at 2 000 000; B edits and sends later, at 2 100 000 (its clock says 600 000).
    cloud.offline = true;
    server.t = 2_000_000;
    a.save("sandbox", "a's edit");
    await a.sync.flush();
    cloud.offline = false;
    const b = device(bCloud, new MemStore(), bClock);
    expect((await b.sync.useCode(code)).ok).toBe(true);
    server.t = 2_100_000;
    bClock.t = server.t - 1_500_000;
    b.save("sandbox", "b's later edit");
    await b.sync.flush();
    // A back online: B's came later, though B's own clock says otherwise.
    server.t = 2_200_000;
    await a.sync.flush();
    expect(taken).toEqual(["sandbox"]);
    expect(a.store.getItem("s.save")).toContain("b's later edit");
  });

  describe("the player's edits outrank the game's progress (CoS: QA's delivery coins)", () => {
    /** A (on the code first) and B (joined), both with the game's railway, at server time 1 000 000 on. */
    async function pair() {
      const cloud = new FakeCloud();
      const server = { t: 1_000_000 };
      cloud.server = server;
      const a = device(cloud, new MemStore(), server);
      a.store.setItem("g.save", '{"version":13,"text":"start"}');
      const code = (await a.sync.enable())!;
      const b = device(cloud, new MemStore(), server);
      expect((await b.sync.useCode(code)).ok).toBe(true);
      const taken: [string, GameMode, string | null][] = [];
      a.sync.onTaken = (m, n) => taken.push(["a", m, n]);
      b.sync.onTaken = (m, n) => taken.push(["b", m, n]);
      return { cloud, server, a, b, code, taken };
    }

    it("progress alone goes up at most every 60 s; a layout edit brings it to 30 s", async () => {
      const { a } = await pair();
      const ms: number[] = [];
      const real = a.timers.push.bind(a.timers);
      a.timers.push = (...fns) => (ms.push(a.sync["due"] - a.clock.t), real(...fns));
      a.save("game", "coins 1100", "progress");
      a.save("game", "laid a piece");
      expect(ms).toEqual([60_000, 30_000]);
    });

    it("A only earns, B does nothing: B takes A's coins", async () => {
      const { server, a, b, code } = await pair();
      server.t = 2_000_000;
      a.save("game", "coins 1120", "progress");
      await a.tick();
      expect(await (a.sync["o"].backend as FakeCloud).keysOf(code, "game")).toMatchObject({ "g.save": expect.stringContaining("coins 1120") });
      const b2 = device(b.sync["o"].backend as FakeCloud, b.store, server);
      expect(await b2.sync.start()).toEqual({});
      expect(b2.store.getItem("g.save")).toContain("coins 1120");
    });

    it("A earns later, B laid track earlier: B's layout wins at A's next upload; A's coins kept to restore, said", async () => {
      const { server, a, b, cloud, code, taken } = await pair();
      server.t = 2_000_000;
      b.save("game", "b laid track");
      await b.sync.flush();
      server.t = 3_000_000;
      a.save("game", "a earned coins", "progress");
      await a.tick();
      expect(taken).toEqual([["a", "game", "took-cloud"]]);
      expect(a.store.getItem("g.save")).toContain("b laid track");
      expect(await cloud.keysOf(code, "game")).toMatchObject({ "g.save": expect.stringContaining("b laid track") });
      expect(await a.sync.restore("game")).toBe(true);
      expect(a.store.getItem("g.save")).toContain("a earned coins");
    });

    it("A laid track earlier, B earns later: A's layout wins over B's progress; B's kept here, said", async () => {
      const { server, a, b, cloud, code } = await pair();
      server.t = 2_000_000;
      a.save("game", "a laid track");
      cloud.offline = true;
      await a.sync.flush();
      cloud.offline = false;
      server.t = 3_000_000;
      b.save("game", "b earned coins", "progress");
      await b.sync.flush();
      expect(cloud.kinds.at(-1)).toBe("progress");
      server.t = 4_000_000;
      await a.sync.flush();
      expect(a.notes).toEqual([["game", "both-changed"]]);
      expect(await cloud.keysOf(code, "game")).toMatchObject({ "g.save": expect.stringContaining("a laid track") });
      expect(a.sync.backupOf("game")).toBe(3_000_000);
    });

    it("a progress-only copy carries the layout edit before it: two layout edits, the later wins", async () => {
      const { server, a, b, cloud, code, taken } = await pair();
      server.t = 2_000_000;
      a.save("game", "a laid track");
      cloud.offline = true;
      await a.sync.flush();
      cloud.offline = false;
      server.t = 2_500_000;
      b.save("game", "b laid track");
      await b.sync.flush();
      server.t = 3_000_000;
      b.save("game", "b laid track, then earned", "progress");
      await b.sync.flush();
      server.t = 4_000_000;
      await a.sync.flush();
      // (B's layout edit, at 2 500 000, is later than A's at 2 000 000, though B's last copy was progress.)
      expect(taken).toEqual([["a", "game", "took-cloud"]]);
      expect(await cloud.keysOf(code, "game")).toMatchObject({ "g.save": expect.stringContaining("then earned") });
    });

    it("two layout edits: the one made later wins, not the one stored later (QA t4 4b)", async () => {
      const { server, a, b, cloud, code, taken } = await pair();
      // B lays track at 2 000 000; its timer stores it 30 s later.
      server.t = 2_000_000;
      b.save("game", "b laid track");
      // A, offline, lays track 5 s after B did.
      cloud.offline = true;
      server.t = 2_005_000;
      a.save("game", "a laid track later");
      await a.sync.flush();
      cloud.offline = false;
      server.t = 2_030_000;
      await b.sync.flush();
      expect(cloud.saves.get(`${code}/game`)!.meta).toMatchObject({ layoutAt: 2_000_000, layoutStoredAt: 2_030_000 });
      // A back online: its edit was the later.
      server.t = 2_040_000;
      await a.sync.flush();
      expect(taken).toEqual([]);
      expect(a.notes).toEqual([["game", "both-changed"]]);
      expect(await cloud.keysOf(code, "game")).toMatchObject({ "g.save": expect.stringContaining("a laid track later") });
      expect(a.sync.backupOf("game")).toBe(2_030_000);
    });

    it("mid-gesture, a newer copy waits: taken on a later round, once the finger's up", async () => {
      const { server, a, b, taken } = await pair();
      server.t = 2_000_000;
      a.save("game", "a's edit");
      cloud_offline(a, true);
      await a.sync.flush();
      cloud_offline(a, false);
      server.t = 3_000_000;
      b.save("game", "b's later edit");
      await b.sync.flush();
      let busy = true;
      a.sync.mayTake = () => !busy;
      server.t = 4_000_000;
      await a.sync.flush();
      expect(taken).toEqual([]);
      expect(a.store.getItem("g.save")).toContain("a's edit");
      expect(a.timers).toHaveLength(1);
      busy = false;
      await a.tick();
      expect(taken).toEqual([["a", "game", "took-cloud"]]);
    });
  });

  describe("Game progress made on both is merged, not lost (CoS: no toasts for progress)", () => {
    const merger = gameMerger({ progress: "g.prog", goals: "g.goals" });
    const prog = (coins: number, learned: string[] = []) => JSON.stringify({ owned: [], learned, coins });
    const coinsOf = (store: KeyStore) => (JSON.parse(store.getItem("g.prog")!) as { coins: number }).coins;
    /** C and D on one code, both with the same railway and 1000 coins, at server time 1 000 000 on. */
    async function pair() {
      const cloud = new FakeCloud();
      const server = { t: 1_000_000 };
      cloud.server = server;
      const c = device(cloud, new MemStore(), server, merger);
      c.store.setItem("g.save", '{"version":13,"text":"the railway"}');
      c.store.setItem("g.prog", prog(1000));
      c.store.setItem("g.goals", '["join-towns"]');
      const code = (await c.sync.enable())!;
      const d = device(cloud, new MemStore(), server, merger);
      expect((await d.sync.useCode(code)).ok).toBe(true);
      const events: string[] = [];
      for (const [name, x] of [["c", c], ["d", d]] as const) {
        x.sync.onTaken = (m, n) => events.push(`${name} taken ${m} ${n}`);
        x.sync.onMerged = (m) => events.push(`${name} merged ${m}`);
      }
      /** A device earns (a delivery's coins): its progress saved, a progress edit. */
      const earn = (x: typeof c, coins: number, extra: Partial<{ learned: string[]; goals: string[] }> = {}) => {
        x.store.setItem("g.prog", prog(coins, extra.learned));
        if (extra.goals) x.store.setItem("g.goals", JSON.stringify(extra.goals));
        x.sync.edited("game", "progress");
      };
      return { cloud, server, c, d, code, events, earn };
    }

    it("both earn: each merge sums what each earned, with no toast and nothing kept aside", async () => {
      const { cloud, server, c, d, code, events, earn } = await pair();
      server.t = 2_000_000;
      earn(c, 1120);
      await c.sync.flush();
      server.t = 2_010_000;
      earn(d, 1050);
      await d.sync.flush();
      expect(coinsOf(d.store)).toBe(1170);
      expect(events).toEqual(["d merged game"]);
      expect(d.notes).toEqual([]);
      expect(d.sync.backupOf("game")).toBeNull();
      expect(JSON.parse((await cloud.keysOf(code, "game"))["g.prog"]).coins).toBe(1170);
      expect(cloud.kinds.at(-1)).toBe("progress");
      // C earns again meanwhile; its next round merges D's merged copy: still exact.
      server.t = 2_020_000;
      earn(c, 1150);
      await c.sync.flush();
      expect(coinsOf(c.store)).toBe(1200);
      expect(c.notes).toEqual([]);
      // D, not earning since, simply takes it at its next start.
      const d2 = device(cloud, d.store, server, merger);
      expect(await d2.sync.start()).toEqual({});
      expect(coinsOf(d2.store)).toBe(1200);
    });

    it("blueprints learned and goals done on either are kept", async () => {
      const { server, c, d, earn } = await pair();
      server.t = 2_000_000;
      earn(c, 1000, { learned: ["switches"], goals: ["join-towns", "first-delivery"] });
      await c.sync.flush();
      server.t = 2_010_000;
      earn(d, 1080, { goals: ["join-towns", "second-train"] });
      await d.sync.flush();
      expect(JSON.parse(d.store.getItem("g.prog")!)).toMatchObject({ coins: 1080, learned: ["switches"] });
      expect(new Set(JSON.parse(d.store.getItem("g.goals")!))).toEqual(new Set(["join-towns", "first-delivery", "second-train"]));
    });

    it("the railway itself is the later copy's: here, the game reloads onto it (no toast)", async () => {
      const { server, c, d, events, earn } = await pair();
      // D earned first (its copy not yet sent); C earned later and sent, its railway moved on (trains ran).
      server.t = 2_000_000;
      earn(d, 1030);
      server.t = 2_100_000;
      c.store.setItem("g.save", '{"version":13,"text":"the railway, trains further on"}');
      earn(c, 1200);
      await c.sync.flush();
      server.t = 2_200_000;
      await d.sync.flush();
      expect(events).toEqual(["d taken game null"]);
      expect(d.store.getItem("g.save")).toContain("trains further on");
      expect(coinsOf(d.store)).toBe(1230);
    });

    it("a layout edit on either side isn't merged: the rules for a clash, as before", async () => {
      const { server, c, d, earn, events } = await pair();
      server.t = 2_000_000;
      c.store.setItem("g.save", '{"version":13,"text":"c laid track"}');
      c.sync.edited("game");
      await c.sync.flush();
      server.t = 2_010_000;
      earn(d, 1500);
      await d.sync.flush();
      expect(events).toEqual(["d taken game took-cloud"]);
      expect(coinsOf(d.store)).toBe(1000);
      expect(d.sync.backupOf("game")).not.toBeNull();
    });
  });

  it("a 429 or a failure never loses what's still to send", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const code = (await a.sync.enable())!;
    a.save("sandbox", "edit");
    cloud.reply429 = true;
    await a.tick();
    expect(cloud.puts).toBe(0);
    expect(a.timers).toHaveLength(1);
    cloud.reply429 = false;
    cloud.offline = true;
    await a.tick();
    expect(a.sync.status.kind).toBe("offline");
    expect(statusText(a.sync.status, 0)).toBe("Offline: saved on this device");
    // (Even across a reload.)
    const a2 = device(cloud, a.store, a.clock);
    cloud.offline = false;
    await a2.sync.start();
    await a2.tick();
    expect(await cloud.keysOf(code, "sandbox")).toMatchObject({ "s.save": expect.stringContaining("edit") });
    expect(a2.sync.status.kind).toBe("synced");
  });

  it("a change made while an upload is on its way goes up next", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    await a.sync.enable();
    a.save("sandbox", "one");
    const sending = a.sync.flush();
    a.save("sandbox", "two");
    await sending;
    expect(a.timers).toHaveLength(1);
  });

  it("leaves a copy from a newer game alone", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const code = (await a.sync.enable())!;
    a.save("sandbox", "mine");
    await a.sync.flush();
    cloud.saves.get(`${code}/sandbox`)!.meta = { savedAt: 9_000_000, saveVersion: 14 };
    const a2 = device(cloud, a.store, a.clock);
    expect(await a2.sync.start()).toEqual({ sandbox: "newer" });
    expect(a2.store.getItem("s.save")).toContain("mine");
    a2.save("sandbox", "more");
    await a2.tick();
    expect(cloud.saves.get(`${code}/sandbox`)!.meta.saveVersion).toBe(14);
    expect(a2.sync.status.kind).toBe("newer");
  });

  it("carries an older save's version, for the game to migrate", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.store.setItem("s.save", '{"version":12}');
    const code = (await a.sync.enable())!;
    expect(cloud.saves.get(`${code}/sandbox`)!.meta.saveVersion).toBe(13);
    expect((JSON.parse(await gunzip(cloud.saves.get(`${code}/sandbox`)!.bytes)) as { saveVersion: number }).saveVersion).toBe(12);
  });

  it("past the start-up deadline, a late answer isn't written into storage", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.store.setItem("s.save", '{"version":13,"text":"a\'s"}');
    const code = (await a.sync.enable())!;
    const b = device(cloud, new MemStore(), { t: 2_000_000 });
    expect((await b.sync.useCode(code)).ok).toBe(true);
    b.save("sandbox", "b's");
    await b.sync.flush();
    const a2 = device(cloud, a.store, a.clock);
    const started = a2.sync.start();
    a2.sync.cutoff();
    await started;
    expect(a2.store.getItem("s.save")).toContain("a's");
    // (Settled by the next upload, A's edited later: B's is kept here, and A's goes up.)
    a2.clock.t = 3_000_000;
    a2.save("sandbox", "a's again");
    await a2.tick();
    expect(a2.sync.backupOf("sandbox")).not.toBeNull();
    expect(await cloud.keysOf(code, "sandbox")).toMatchObject({ "s.save": expect.stringContaining("a's again") });
  });

  it("storage full: a cloud copy isn't half written", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const code = (await a.sync.enable())!;
    a.save("game", "theirs");
    await a.sync.flush();
    const b = device(cloud);
    b.store.setItem("g.save", "mine");
    b.store.full = true;
    expect(await b.sync.useCode(code)).toEqual({ ok: false, error: "offline" });
    expect(b.store.getItem("g.save")).toBe("mine");
  });

  it("turning off forgets the code", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    await a.sync.enable();
    a.sync.disable();
    expect(a.sync.code).toBeNull();
    expect(device(cloud, a.store).sync.code).toBeNull();
    a.save("sandbox", "x");
    expect(a.timers).toHaveLength(0);
  });
});

/** A device's cloud offline or not (the fake is shared). */
function cloud_offline(d: { sync: CloudSync }, off: boolean): void {
  (d.sync["o"].backend as FakeCloud).offline = off;
}
