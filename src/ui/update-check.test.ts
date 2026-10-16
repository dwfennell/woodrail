import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isNewer, MIN_GAP_MS, shouldCheck, startUpdateCheck } from "./update-check";

describe("isNewer", () => {
  it("is false for the same build", () => expect(isNewer("abc", { build: "abc" })).toBe(false));
  it("is true for a different build", () => expect(isNewer("abc", { build: "abd" })).toBe(true));
  it("is false for an empty or missing build", () => {
    expect(isNewer("abc", { build: "" })).toBe(false);
    expect(isNewer("abc", {})).toBe(false);
    expect(isNewer("abc", null)).toBe(false);
    expect(isNewer("abc", undefined)).toBe(false);
  });
  it("is false for a build that isn't a string", () => {
    expect(isNewer("abc", { build: 5 })).toBe(false);
    expect(isNewer("abc", { build: null })).toBe(false);
  });
});

describe("shouldCheck", () => {
  it("always checks the first time", () => expect(shouldCheck(1000, null)).toBe(true));
  it("waits out the gap", () => {
    expect(shouldCheck(1000 + MIN_GAP_MS - 1, 1000)).toBe(false);
    expect(shouldCheck(1000 + MIN_GAP_MS, 1000)).toBe(true);
    expect(shouldCheck(1000, 1000)).toBe(false);
  });
  it("takes a gap of its own", () => expect(shouldCheck(50, 0, 50)).toBe(true));
});

describe("startUpdateCheck", () => {
  type Listener = () => void;
  let doc: { visibilityState: string; listeners: Map<string, Set<Listener>> };
  let win: { listeners: Map<string, Set<Listener>> };
  let fetchMock: ReturnType<typeof vi.fn>;
  let remote: unknown;

  const target = (listeners: Map<string, Set<Listener>>) => ({
    addEventListener: (t: string, l: Listener) => (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(l),
    removeEventListener: (t: string, l: Listener) => listeners.get(t)?.delete(l),
  });
  const fire = (listeners: Map<string, Set<Listener>>, t: string) => listeners.get(t)?.forEach((l) => l());
  const flush = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    doc = { visibilityState: "visible", listeners: new Map() };
    win = { listeners: new Map() };
    remote = { build: "new" };
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => remote }));
    vi.stubGlobal("document", Object.assign(doc, target(doc.listeners)));
    vi.stubGlobal("window", Object.assign(win, target(win.listeners), { setTimeout: globalThis.setTimeout }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does nothing without a build id", () => {
    startUpdateCheck({ currentBuild: "", onNewVersion: vi.fn() });
    expect(doc.listeners.size + win.listeners.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks on becoming visible and on focus, at most once per gap, and says so once", async () => {
    remote = { build: "same" };
    const onNewVersion = vi.fn();
    startUpdateCheck({ currentBuild: "same", onNewVersion });
    fire(doc.listeners, "visibilitychange");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("version.json", { cache: "no-store" });
    // Too soon: focus and visibility don't fetch again.
    fire(win.listeners, "focus");
    fire(doc.listeners, "visibilitychange");
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS - 1000);
    fire(win.listeners, "focus");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Hidden doesn't count. (The timer's own check lands just past the gap: that's the second fetch.)
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(2000);
    fire(doc.listeners, "visibilitychange");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    doc.visibilityState = "visible";
    // Past another gap, a new build turns up.
    remote = { build: "next" };
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    fire(win.listeners, "focus");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onNewVersion).toHaveBeenCalledExactlyOnceWith("next");
    // Found: nothing listens or fetches any more.
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS * 3);
    fire(win.listeners, "focus");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onNewVersion).toHaveBeenCalledTimes(1);
  });

  it("checks once on its own after the gap, and keeps going until it finds one", async () => {
    remote = { build: "same" };
    const onNewVersion = vi.fn();
    startUpdateCheck({ currentBuild: "same", onNewVersion });
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    remote = { build: "other" };
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    expect(onNewVersion).toHaveBeenCalledExactlyOnceWith("other");
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores fetch errors and bad answers, and tries again later", async () => {
    const onNewVersion = vi.fn();
    startUpdateCheck({ currentBuild: "old", onNewVersion });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fire(win.listeners, "focus");
    await flush();
    expect(onNewVersion).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ build: "new" }) });
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    fire(win.listeners, "focus");
    await flush();
    expect(onNewVersion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    fire(win.listeners, "focus");
    await flush();
    expect(onNewVersion).toHaveBeenCalledExactlyOnceWith("new");
  });
});
