import { describe, expect, it } from "vitest";
import type { GameMode } from "../game/modes";
import { CloudSync, gunzip, statusText, UPLOAD_EVERY_MS, type CloudBackend, type KeyStore, type RemoteMeta, type Reply } from "./cloud";
import { WORDS } from "./code-words";
import { newCode, parseCode, showCode } from "./sync-code";

const KEYS: Record<GameMode, string[]> = { sandbox: ["s.save", "s.session"], game: ["g.save", "g.session", "g.goals"] };

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
  reply429 = false;
  async head(code: string, mode: GameMode): Promise<Reply<RemoteMeta | null>> {
    if (this.offline) return { ok: false, status: 0 };
    return { ok: true, value: this.saves.get(`${code}/${mode}`)?.meta ?? null };
  }
  async get(code: string, mode: GameMode): Promise<Reply<{ meta: RemoteMeta; bytes: Uint8Array } | null>> {
    if (this.offline) return { ok: false, status: 0 };
    return { ok: true, value: this.saves.get(`${code}/${mode}`) ?? null };
  }
  async put(code: string, mode: GameMode, bytes: Uint8Array, meta: RemoteMeta, base: number): Promise<Reply<void>> {
    if (this.offline) return { ok: false, status: 0 };
    if (this.reply429) return { ok: false, status: 429 };
    if ((this.saves.get(`${code}/${mode}`)?.meta.savedAt ?? 0) !== base) return { ok: false, status: 409 };
    this.puts++;
    this.saves.set(`${code}/${mode}`, { meta, bytes });
    return { ok: true, value: undefined };
  }
  async keysOf(code: string, mode: GameMode): Promise<Record<string, string>> {
    return (JSON.parse(await gunzip(this.saves.get(`${code}/${mode}`)!.bytes)) as { keys: Record<string, string> }).keys;
  }
}

/** A device: its storage, its clock and its timers (run by hand). */
function device(cloud: FakeCloud, store = new MemStore(), clock = { t: 1_000_000 }) {
  const timers: (() => void)[] = [];
  const sync = new CloudSync({
    backend: cloud,
    storage: store,
    keys: KEYS,
    saveVersion: 13,
    now: () => clock.t,
    setTimer: (fn, ms) => {
      expect(ms).toBe(UPLOAD_EVERY_MS);
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
      await settle();
    },
    save(mode: GameMode, text: string): void {
      store.setItem(KEYS[mode][0], `{"version":13,"text":"${text}"}`);
      sync.changed(mode);
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

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
    const code = await a.sync.enable();
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
    const code = await a.sync.enable();
    a.save("game", "my game");
    a.store.setItem("g.goals", '["a"]');
    a.sync.changed("game");
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
    const code = await a.sync.enable();
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
    const code = await a.sync.enable();
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
    const code = await b.sync.enable();
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

  it("while playing: another device's copy sent meanwhile is kept, and this one goes up", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.store.setItem("s.save", '{"version":13,"text":"a\'s first"}');
    const code = await a.sync.enable();
    const b = device(cloud, new MemStore(), { t: 1_000_100 });
    expect((await b.sync.useCode(code)).ok).toBe(true);
    b.save("sandbox", "b's again");
    await b.sync.flush();
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
    const code = await a.sync.enable();
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

  it("a 429 or a failure never loses what's still to send", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const code = await a.sync.enable();
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
    const code = await a.sync.enable();
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
    const code = await a.sync.enable();
    expect(cloud.saves.get(`${code}/sandbox`)!.meta.saveVersion).toBe(13);
    expect((JSON.parse(await gunzip(cloud.saves.get(`${code}/sandbox`)!.bytes)) as { saveVersion: number }).saveVersion).toBe(12);
  });

  it("past the start-up deadline, a late answer isn't written into storage", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    a.store.setItem("s.save", '{"version":13,"text":"a\'s"}');
    const code = await a.sync.enable();
    const b = device(cloud, new MemStore(), { t: 2_000_000 });
    expect((await b.sync.useCode(code)).ok).toBe(true);
    b.save("sandbox", "b's");
    await b.sync.flush();
    const a2 = device(cloud, a.store, a.clock);
    const started = a2.sync.start();
    a2.sync.cutoff();
    await started;
    expect(a2.store.getItem("s.save")).toContain("a's");
    // (Settled by the next upload: B's is kept here, and A's goes up.)
    a2.save("sandbox", "a's again");
    await a2.tick();
    expect(a2.sync.backupOf("sandbox")).not.toBeNull();
    expect(await cloud.keysOf(code, "sandbox")).toMatchObject({ "s.save": expect.stringContaining("a's again") });
  });

  it("storage full: a cloud copy isn't half written", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const code = await a.sync.enable();
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
