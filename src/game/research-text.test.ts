import { describe, expect, it } from "vitest";
import { Progress } from "./progress";
import { deliver, pick, tick } from "./research";
import * as text from "./research-text";
import { cardState, chipsText, goalPick, IdleNotice, idleText, pickerKey, pillKey, pillResearch, pillText, pillView, researchCard, researchChips, schoolCard, schoolCardKey, shortLabel, showMePick } from "./research-text";
import { TECHS } from "./tech";

const SCHOOL = "Larkfield school";

describe("the picker's card states", () => {
  it("learned · researching · next · ready · locked · soon", () => {
    const p = Progress.fresh();
    expect(cardState(p, "switches")).toBe("ready");
    expect(cardState(p, "junctions")).toBe("locked"); // needs switches
    expect(cardState(p, "tunnels")).toBe("soon"); // not in the game yet
    pick(p, "switches");
    expect(cardState(p, "switches")).toBe("researching");
    pick(p, "bridges");
    expect(cardState(p, "bridges")).toBe("next");
    deliver(p, "planks", 4);
    tick(p, 20);
    expect(cardState(p, "switches")).toBe("learned");
    // Next up started as soon as switches was done.
    expect(cardState(p, "bridges")).toBe("researching");
    expect(cardState(p, "junctions")).toBe("ready");
  });
});

describe("a card's chips", () => {
  it("each good got of needed, then the coins (red while short) unless paid", () => {
    const p = Progress.fresh();
    p.learned.add("farming");
    expect(chipsText(researchChips(p, "bridges"))).toBe("🪵 0/10");
    // Mills: planks and grain, and 40 coins (none in hand: short).
    expect(researchChips(p, "mills")).toEqual([{ text: "🪵 0/6" }, { text: "🌾 0/6" }, { text: "🪙 40", short: true }]);
    expect(chipsText(researchChips(p, "mills"))).toBe("🪵 0/6 · 🌾 0/6 · 🪙 40");
    p.coins = 50;
    expect(researchChips(p, "mills")[2]).toEqual({ text: "🪙 40" });
    // Started: its coins are paid (no chip), its goods count up.
    pick(p, "mills");
    deliver(p, "planks", 4);
    expect(chipsText(researchChips(p, "mills"))).toBe("🪵 4/6 · 🌾 0/6");
  });

  it("a ready card: Research when idle, else Next up; the one up next swaps with Research now", () => {
    const p = Progress.fresh();
    expect(researchCard(p, "switches", SCHOOL)).toEqual({ chips: [{ text: "🪵 0/3" }], study: "20 s study", action: "Research" });
    pick(p, "switches");
    expect(researchCard(p, "bridges", SCHOOL)).toEqual({ chips: [{ text: "🪵 0/10" }], study: "20 s study", action: "Next up" });
    pick(p, "bridges");
    expect(researchCard(p, "bridges", SCHOOL)).toEqual({ chips: [{ text: "🪵 0/10" }], study: "20 s study", why: "Next up, after Switches", action: "Research now" });
    // Tapping it again swaps the two.
    pick(p, "bridges");
    expect(cardState(p, "bridges")).toBe("researching");
    expect(cardState(p, "switches")).toBe("next");
  });

  it("the one under way shows live progress and no button; learned, locked and soon have no research card", () => {
    const p = Progress.fresh();
    pick(p, "bridges");
    deliver(p, "planks", 6);
    expect(researchCard(p, "bridges", SCHOOL)).toEqual({ chips: [{ text: "🪵 6/10" }], study: "20 s study", why: "bring 4🪵 to Larkfield school", fill: 0.6 });
    deliver(p, "planks", 4);
    tick(p, 5);
    expect(researchCard(p, "bridges", SCHOOL)).toMatchObject({ why: "studying: 15 s", fill: 0.25 });
    expect(researchCard(p, "junctions", SCHOOL)).toBeNull();
    expect(researchCard(p, "tunnels", SCHOOL)).toBeNull();
    p.learned.add("switches");
    expect(researchCard(p, "switches", SCHOOL)).toBeNull();
  });

  it("one up next whose coins are short says so, its button held; with no school nothing can be picked", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    pick(p, "routes"); // 40 coins, none in hand: waits up next
    expect(researchCard(p, "routes", SCHOOL)).toMatchObject({ why: "Waiting for 40🪙", action: "Research now", blocked: true });
    expect(researchCard(p, "signals", null)).toMatchObject({ why: "Needs a school", action: "Research", blocked: true });
  });
});

describe("the HUD's research pill", () => {
  it("says what's under way and its first good still lacking, then its study; Pick research when nothing is picked", () => {
    const p = Progress.fresh();
    // No school, nothing picked: no pill.
    expect(pillView(p, false)).toBeNull();
    expect(pillText(pillView(p, false))).toBe("");
    expect(pillText(pillView(p, true))).toBe("📘 Pick research");
    expect(pillView(p, true)?.idle).toBe(true);
    pick(p, "bridges");
    deliver(p, "planks", 6);
    expect(pillText(pillView(p, true))).toBe("📘 Bridges 6/10🪵");
    expect(pillView(p, true)).toMatchObject({ name: "Bridges", fill: 0.6, idle: false });
    deliver(p, "planks", 4);
    expect(pillText(pillView(p, true))).toBe("📘 Bridges 20 s");
    tick(p, 20);
    expect(pillText(pillView(p, true))).toBe("📘 Pick research");
  });

  it("a research with two goods shows the first still lacking; one waiting for coins shows them", () => {
    const p = Progress.fresh();
    p.learned.add("farming");
    p.coins = 40;
    pick(p, "mills");
    deliver(p, "planks", 12);
    expect(pillText(pillView(p, true))).toBe("📘 Mills 0/6🌾");
    const q = Progress.fresh();
    q.learned.add("switches");
    q.coins = 5;
    pick(q, "routes");
    expect(pillText(pillView(q, true))).toBe("📘 Train routes 5/40🪙");
  });

  it("a tap opens the picker on the research it shows: the one under way, or the one up next waiting for coins (QA P5)", () => {
    const p = Progress.fresh();
    expect(pillResearch(p)).toBeNull();
    p.learned.add("switches");
    p.coins = 10;
    pick(p, "routes");
    expect(pillText(pillView(p, true))).toBe("📘 Train routes 10/40🪙");
    expect(pillResearch(p)).toBe("routes");
    // (Where the picker would open by itself: the goal's research, since nothing is under way.)
    expect(goalPick(p, "bridges", true)).toBe("bridges");
    // Under way: that one, whatever waits next.
    const q = Progress.fresh();
    pick(q, "bridges");
    pick(q, "signals");
    expect(pillResearch(q)).toBe("bridges");
  });

  it("its key changes only when what it shows may: a pick, a delivery, a second of study, a school, coins while waiting", () => {
    const p = Progress.fresh();
    const k0 = pillKey(p, true);
    expect(pillKey(p, true)).toBe(k0);
    expect(pillKey(p, false)).not.toBe(k0);
    // Coins don't matter while nothing waits for them.
    p.coins = 50;
    expect(pillKey(p, true)).toBe(k0);
    pick(p, "bridges");
    const k1 = pillKey(p, true);
    expect(k1).not.toBe(k0);
    // The workshop's clock with no goods in: no change.
    tick(p, 0.25);
    expect(pillKey(p, true)).toBe(k1);
    deliver(p, "planks", 1);
    const k2 = pillKey(p, true);
    expect(k2).not.toBe(k1);
    // A goods it doesn't take: no change.
    deliver(p, "grain", 3);
    expect(pillKey(p, true)).toBe(k2);
    deliver(p, "planks", 9);
    const k3 = pillKey(p, true);
    // Studying: a quarter second within the same whole second is no change; the next whole second is.
    tick(p, 0.25);
    const k4 = pillKey(p, true);
    tick(p, 0.25);
    expect(pillKey(p, true)).toBe(k4);
    tick(p, 1);
    expect(pillKey(p, true)).not.toBe(k4);
    expect(k3).not.toBe(k2);
    // Waiting for coins: the coins are part of it.
    const q = Progress.fresh();
    q.learned.add("switches");
    pick(q, "routes");
    const w0 = pillKey(q, true);
    q.coins = 5;
    expect(pillKey(q, true)).not.toBe(w0);
  });

  it("names are cut short", () => {
    expect(shortLabel("bridges")).toBe("Bridges");
    expect(shortLabel("diesel")).toBe("Diesel");
    expect(shortLabel("switches")).toBe("Switches");
  });
});

describe("the goal's pre-pick", () => {
  it("opens the picker on the goal's research while the school is idle; nothing is picked for you", () => {
    const p = Progress.fresh();
    expect(goalPick(p, "switches", true)).toBe("switches");
    expect(p.research.current).toBeNull();
    // No school yet, no blueprint, or one under way: none.
    expect(goalPick(p, "switches", false)).toBeNull();
    expect(goalPick(p, undefined, true)).toBeNull();
    pick(p, "bridges");
    expect(goalPick(p, "switches", true)).toBeNull();
    // Not ready yet (junctions needs switches): none.
    expect(goalPick(Progress.fresh(), "junctions", true)).toBeNull();
  });

  it("Show me opens the picker on it once a school is placed, till it's under way or learned", () => {
    const p = Progress.fresh();
    expect(showMePick(p, "switches", false)).toBeNull();
    expect(showMePick(p, "switches", true)).toBe("switches");
    // Something else under way: still the picker (to put it up next).
    pick(p, "bridges");
    expect(showMePick(p, "switches", true)).toBe("switches");
    const q = Progress.fresh();
    pick(q, "switches");
    expect(showMePick(q, "switches", true)).toBeNull();
    q.learned.add("bridges");
    expect(showMePick(q, "bridges", true)).toBeNull();
  });
});

describe("the P1 stopgap is gone", () => {
  it("no tap-to-research toast or board line", () => {
    expect("tapResearch" in text).toBe(false);
    expect("researchLine" in text).toBe(false);
  });
});

describe("the school's card", () => {
  it("shows the research's goods got of needed, and what it's at; its key changes only when they do", () => {
    const p = Progress.fresh();
    expect(schoolCard(p)).toEqual({ piles: [], note: "Idle: pick research", idle: true });
    const k0 = schoolCardKey(p);
    pick(p, "switches");
    expect(schoolCardKey(p)).not.toBe(k0);
    deliver(p, "planks", 2);
    expect(schoolCard(p)).toEqual({ piles: [{ label: "🪵", count: 2, cap: 3 }], note: "Researching Switches", idle: false });
    const k1 = schoolCardKey(p);
    expect(schoolCardKey(p)).toBe(k1);
    deliver(p, "planks", 1);
    expect(schoolCard(p).note).toBe("Studying Switches: 20 s");
    expect(schoolCardKey(p)).not.toBe(k1);
  });
});

describe("the idle school", () => {
  it("the card says Idle with nothing under way or up next; not while one waits in Next up", () => {
    const p = Progress.fresh();
    expect(schoolCard(p).idle).toBe(true);
    p.learned.add("switches");
    pick(p, "routes");
    // Train routes waits for its coins: not idle, and it says so.
    expect(p.research.next).toBe("routes");
    expect(schoolCard(p)).toMatchObject({ idle: false, note: "Next up: Train routes (40🪙 short)" });
  });

  it("the pill: Pick research, idle (the amber pill), only with a school", () => {
    const p = Progress.fresh();
    expect(pillView(p, false)).toBeNull();
    expect(pillView(p, true)).toMatchObject({ name: "Pick", count: "research", idle: true });
    pick(p, "switches");
    expect(pillView(p, true)?.idle).toBe(false);
    deliver(p, "planks", 3);
    tick(p, 20);
    expect(pillText(pillView(p, true))).toBe("📘 Pick research");
    expect(pillView(p, true)?.idle).toBe(true);
  });

  it("a finish with nothing up next says the school is idle, once", () => {
    const p = Progress.fresh();
    const notice = new IdleNotice();
    pick(p, "switches");
    pick(p, "bridges");
    deliver(p, "planks", 3);
    const done = tick(p, 20)!;
    // Bridges started from Next up: nothing to say.
    expect(done).toBe("switches");
    expect(notice.finished(p, done, SCHOOL)).toBeNull();
    deliver(p, "planks", 10);
    const second = tick(p, 1000)!;
    expect(second).toBe("bridges");
    expect(notice.finished(p, second, SCHOOL)).toBe("Larkfield school is idle: pick what to learn next");
    expect(idleText(SCHOOL)).toBe("Larkfield school is idle: pick what to learn next");
    // The same finish again: once.
    expect(notice.finished(p, second, SCHOOL)).toBeNull();
    // A new game's finish is a new one.
    const q = Progress.fresh();
    expect(notice.finished(q, second, SCHOOL)).toBe(idleText(SCHOOL));
    // No school to name: nothing.
    expect(new IdleNotice().finished(p, second, null)).toBeNull();
  });

  it("not while one waits in Next up for its coins", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    pick(p, "bridges");
    pick(p, "routes");
    deliver(p, "planks", 10);
    const done = tick(p, 1000)!;
    expect(done).toBe("bridges");
    expect(p.research.current).toBeNull();
    expect(p.research.next).toBe("routes");
    expect(new IdleNotice().finished(p, done, SCHOOL)).toBeNull();
  });
});

describe("the picker's key (it's rebuilt only when this changes)", () => {
  const lowest = Math.min(...TECHS.map((t) => t.research.coins ?? Infinity));
  it("changes with the research, not with every coin or counted load (QA: it rebuilt every second)", () => {
    const p = Progress.fresh();
    const key = () => pickerKey(p, SCHOOL, "learn-switches");
    const k0 = key();
    // Coins below the lowest price, and loads moved short of a requirement: nothing the picker shows.
    p.coins = lowest - 1;
    p.counts.set("loadsMoved", 199);
    expect(key()).toBe(k0);
    // A price reached: a coins chip stops being red.
    p.coins = lowest;
    const k1 = key();
    expect(k1).not.toBe(k0);
    // A requirement met (Goods engine's 200 loads).
    p.counts.set("loadsMoved", 200);
    const k2 = key();
    expect(k2).not.toBe(k1);
    // A pick, a delivery.
    pick(p, "switches");
    const k3 = key();
    expect(k3).not.toBe(k2);
    deliver(p, "planks", 1);
    expect(key()).not.toBe(k3);
  });

  it("names the school and the goal", () => {
    const p = Progress.fresh();
    expect(pickerKey(p, SCHOOL, "a")).not.toBe(pickerKey(p, "Elderwick school", "a"));
    expect(pickerKey(p, null, "a")).not.toBe(pickerKey(p, SCHOOL, "a"));
    expect(pickerKey(p, SCHOOL, "a")).not.toBe(pickerKey(p, SCHOOL, "b"));
  });
});
