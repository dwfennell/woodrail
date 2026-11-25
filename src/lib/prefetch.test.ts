import { describe, expect, it } from "vitest";
import { lazy } from "./lazy";
import { prefetchWhenIdle, type PrefetchEnv } from "./prefetch";

/** A page whose timers, idle moments and visibility the test steps by hand. */
function fakePage() {
  type Queued = { kind: "later" | "idle" | "shown"; f: () => void; ms?: number };
  const queue: Queued[] = [];
  const state = { hidden: false, online: true };
  const page = {
    get hidden() {
      return state.hidden;
    },
    set hidden(v: boolean) {
      state.hidden = v;
    },
    get online() {
      return state.online;
    },
    set online(v: boolean) {
      state.online = v;
    },
    queue,
    env: {
      later: (f, ms) => void queue.push({ kind: "later", f, ms }),
      idle: (f) => void queue.push({ kind: "idle", f }),
      hidden: () => state.hidden,
      whenShown: (f) => void queue.push({ kind: "shown", f }),
      online: () => state.online,
    } as PrefetchEnv,
    /** Run the oldest queued callback (and let promises settle). */
    async step(): Promise<string> {
      const q = queue.shift();
      if (!q) return "none";
      q.f();
      await new Promise((r) => setTimeout(r, 0));
      return q.kind;
    },
  };
  return page;
}

describe("prefetchWhenIdle", () => {
  it("waits the quiet seconds, then loads one an idle moment, in order", async () => {
    const page = fakePage();
    const loaded: string[] = [];
    const done = prefetchWhenIdle([async () => loaded.push("a"), async () => loaded.push("b")], page.env, 5000);
    expect(page.queue).toEqual([expect.objectContaining({ kind: "later", ms: 5000 })]);
    expect(loaded).toEqual([]);
    expect(await page.step()).toBe("later");
    expect(loaded).toEqual([]);
    expect(await page.step()).toBe("idle");
    expect(loaded).toEqual(["a"]);
    expect(await page.step()).toBe("idle");
    expect(loaded).toEqual(["a", "b"]);
    expect(await page.step()).toBe("idle");
    await done;
    expect(page.queue).toEqual([]);
  });

  it("loads nothing while the page is hidden, and goes on once it's shown", async () => {
    const page = fakePage();
    const loaded: string[] = [];
    void prefetchWhenIdle([async () => loaded.push("a")], page.env, 0);
    page.hidden = true;
    await page.step();
    await page.step();
    expect(loaded).toEqual([]);
    expect(page.queue.map((q) => q.kind)).toEqual(["shown"]);
    page.hidden = false;
    await page.step();
    await page.step();
    expect(loaded).toEqual(["a"]);
  });

  it("waits while offline rather than fail a load for good", async () => {
    const page = fakePage();
    const loaded: string[] = [];
    void prefetchWhenIdle([async () => loaded.push("a")], page.env, 0);
    page.online = false;
    await page.step();
    await page.step();
    expect(loaded).toEqual([]);
    expect(page.queue).toEqual([expect.objectContaining({ kind: "later", ms: 30_000 })]);
    page.online = true;
    await page.step();
    expect(loaded).toEqual(["a"]);
  });

  it("a load that fails is left, and the rest still load", async () => {
    const page = fakePage();
    const loaded: string[] = [];
    const done = prefetchWhenIdle([() => Promise.reject(new Error("404")), async () => loaded.push("b")], page.env, 0);
    while ((await page.step()) !== "none");
    await done;
    expect(loaded).toEqual(["b"]);
  });

  it("a lazy whose code was prefetched opens with no fetch after (the network refusing it then)", async () => {
    // The module map: the first import fetches, later ones are the same module (as a browser's import() of one URL).
    let served = true;
    let fetches = 0;
    let module: Promise<{ Sheet: new () => { open: boolean } }> | null = null;
    const load = () =>
      (module ??= (fetches++, served ? Promise.resolve({ Sheet: class { open = true } }) : Promise.reject(new Error("404"))));
    const page = fakePage();
    const done = prefetchWhenIdle([load], page.env, 0);
    while ((await page.step()) !== "none");
    await done;
    served = false; // a newer deploy took the file off the site
    const failed: unknown[] = [];
    const sheet = lazy(async () => new (await load()).Sheet(), (e) => failed.push(e));
    let opened = false;
    sheet.use((s) => (opened = s.open));
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toBe(true);
    expect(failed).toEqual([]);
    expect(fetches).toBe(1);
  });
});
