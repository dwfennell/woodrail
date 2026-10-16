import { describe, expect, it } from "vitest";
import { ago, Journal, JOURNAL_CAP } from "./journal";

const planks = (town: string) => ({ kind: "event" as const, key: `deliver:${town}:planks`, qty: 3, text: "", format: (n: number) => `Delivered ${n} planks to ${town}`, place: { x: 1, z: 2 } });

describe("Journal", () => {
  it("does not log a refusal; it stays a plain toast", () => {
    const j = new Journal(() => 0);
    const r = j.add({ kind: "refusal", text: "No room" });
    expect(r.toast).toBe(true);
    expect(r.entry).toBeNull();
    expect(j.entries).toHaveLength(0);
    expect(j.unread).toBe(0);
  });

  it("logs an event with no toast", () => {
    const j = new Journal(() => 0);
    const r = j.add({ kind: "event", text: "A boat took 3 planks" });
    expect(r.toast).toBe(false);
    expect(j.entries).toHaveLength(1);
  });

  it("logs a milestone with a toast", () => {
    const j = new Journal(() => 0);
    const r = j.add({ kind: "milestone", text: "Goal done" });
    expect(r.toast).toBe(true);
    expect(j.entries[0].kind).toBe("milestone");
  });

  it("merges 5 quick deliveries into one entry with the summed quantity and no x5", () => {
    const j = new Journal(() => 0);
    for (let i = 0; i < 5; i++) j.add(planks("Larkfield"), i * 1000);
    expect(j.entries).toHaveLength(1);
    expect(j.entries[0].text).toBe("Delivered 15 planks to Larkfield");
    expect(j.entries[0].qty).toBe(15);
  });

  it("adds x2 only where the text carries no quantity", () => {
    const j = new Journal(() => 0);
    j.add({ kind: "event", key: "boat", text: "A boat came in" }, 0);
    j.add({ kind: "event", key: "boat", text: "A boat came in" }, 10);
    expect(j.entries).toHaveLength(1);
    expect(j.entries[0].text).toBe("A boat came in (×2)");
    expect(j.entries[0].count).toBe(2);
  });

  it("puts a merged entry first again, and a later add before older ones", () => {
    const j = new Journal(() => 0);
    j.add(planks("Larkfield"), 0);
    j.add({ kind: "milestone", text: "grew" }, 1);
    j.add({ kind: "milestone", text: "goal" }, 2);
    expect(j.entries.map((e) => e.text)).toEqual(["goal", "grew", "Delivered 3 planks to Larkfield"]);
    j.add(planks("Larkfield"), 3);
    expect(j.entries[0].text).toBe("Delivered 6 planks to Larkfield");
  });

  it("keeps different towns apart", () => {
    const j = new Journal(() => 0);
    j.add(planks("Larkfield"), 0);
    j.add(planks("Mill End"), 100);
    expect(j.entries).toHaveLength(2);
  });

  it("starts a new entry for a delivery after the window", () => {
    const j = new Journal(() => 0);
    j.add(planks("Larkfield"), 0);
    j.add(planks("Larkfield"), 61_000);
    expect(j.entries).toHaveLength(2);
    expect(j.entries[0].text).toBe("Delivered 3 planks to Larkfield");
  });

  it("keeps the last 50, newest first", () => {
    const j = new Journal(() => 0);
    for (let i = 0; i < 60; i++) j.add({ kind: "event", text: `e${i}` }, i);
    expect(j.entries).toHaveLength(JOURNAL_CAP);
    expect(j.entries[0].text).toBe("e59");
    expect(j.entries[49].text).toBe("e10");
  });

  it("counts unread until marked read, and a merge into a read entry is unread again", () => {
    const j = new Journal(() => 0);
    j.add({ kind: "event", text: "a" }, 0);
    j.add(planks("Larkfield"), 1);
    expect(j.unread).toBe(2);
    j.markRead();
    expect(j.unread).toBe(0);
    j.add(planks("Larkfield"), 2);
    expect(j.unread).toBe(1);
    j.add({ kind: "milestone", text: "m" }, 3);
    expect(j.unread).toBe(2);
  });
});

describe("ago", () => {
  it("words the time", () => {
    expect(ago(10_000)).toBe("just now");
    expect(ago(125_000)).toBe("2 min ago");
    expect(ago(3 * 3_600_000)).toBe("3 h ago");
  });
});

describe("Journal.amend", () => {
  it("changes the text, moves the entry to the top and counts it as news", () => {
    const j = new Journal(() => 0);
    const a = j.add({ kind: "milestone", text: "A grew" }).entry!;
    j.add({ kind: "event", text: "B" });
    j.markRead();
    j.amend(a, "A grew · ✓ goal");
    expect(j.entries[0]).toBe(a);
    expect(a.text).toBe("A grew · ✓ goal");
    expect(j.unread).toBe(1);
  });
});
