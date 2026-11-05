import { describe, expect, it } from "vitest";
import { Progress } from "./progress";
import { costOf, deliver, pick, startNow, tick, toggleQueue } from "./research";
import * as text from "./research-text";
import { cardState, chipsText, removedText, costWords, unlocksWords, goalPick, IdleNotice, idleText, pickerKey, pillCount, pillKey, pillResearch, pillText, pillView, researchCard, researchChips, schoolCard, schoolCardKey, shortLabel, showMePick } from "./research-text";
import { seenOf, TECHS } from "./tech";

const SCHOOL = "Larkfield school";

describe("the picker's card states", () => {
  it("learned · researching · next · ready · locked · soon", () => {
    const p = Progress.fresh();
    expect(cardState(p, "switches")).toBe("ready");
    expect(cardState(p, "junctions")).toBe("locked"); // needs switches
    expect(cardState(p, "viaduct")).toBe("soon"); // not in the game yet
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
    expect(chipsText(researchChips(p, "bridges"))).toBe("\uE000 0/10");
    // Mills: planks and grain, and 40 coins (none in hand: short).
    expect(researchChips(p, "mills").map(({ text, short }) => ({ text, short }))).toEqual([{ text: "\uE000 0/6" }, { text: "🌾 0/6" }, { text: "🪙 40", short: true }].map(({ text, short }) => ({ text, short })));
    expect(chipsText(researchChips(p, "mills"))).toBe("\uE000 0/6 · 🌾 0/6 · 🪙 40");
    p.coins = 50;
    expect(researchChips(p, "mills")[2]).toEqual({ text: "🪙 40", title: "Coins: 40, paid when it starts" });
    // Started: its coins are paid (no chip), its goods count up.
    pick(p, "mills");
    deliver(p, "planks", 4);
    expect(chipsText(researchChips(p, "mills"))).toBe("\uE000 4/6 · 🌾 0/6");
  });

  it("a ready card: Research when idle, else Add to queue; one in the queue has Remove and Research now (the swap)", () => {
    const p = Progress.fresh();
    expect(researchCard(p, "switches", SCHOOL)).toEqual({ chips: [{ text: "\uE000 0/3", title: "Planks: 0 of 3 brought" }], study: "20 s study", action: "Research" });
    pick(p, "switches");
    expect(researchCard(p, "bridges", SCHOOL)).toEqual({ chips: [{ text: "\uE000 0/10", title: "Planks: 0 of 10 brought" }], study: "20 s study", action: "Add to queue" });
    pick(p, "bridges");
    expect(researchCard(p, "bridges", SCHOOL)).toEqual({ chips: [{ text: "\uE000 0/10", title: "Planks: 0 of 10 brought" }], study: "20 s study", why: "Next up, after Switches", action: "Research now", remove: true });
    // Tapping it again swaps the two.
    pick(p, "bridges");
    expect(cardState(p, "bridges")).toBe("researching");
    expect(cardState(p, "switches")).toBe("next");
  });

  it("the one under way shows live progress and no button; learned, locked and soon have no research card", () => {
    const p = Progress.fresh();
    pick(p, "bridges");
    deliver(p, "planks", 6);
    expect(researchCard(p, "bridges", SCHOOL)).toEqual({ chips: [{ text: "\uE000 6/10", title: "Planks: 6 of 10 brought" }], study: "20 s study", why: "bring 4\uE000 to Larkfield school", fill: 0.6 });
    deliver(p, "planks", 4);
    tick(p, 5);
    expect(researchCard(p, "bridges", SCHOOL)).toMatchObject({ why: "studying: 15 s", fill: 0.25 });
    // Locked by something besides blueprints (Turntable needs a town): no card. Not in the game: none.
    expect(researchCard(p, "turntable", SCHOOL)).toBeNull();
    expect(researchCard(p, "viaduct", SCHOOL)).toBeNull();
    p.learned.add("switches");
    expect(researchCard(p, "switches", SCHOOL)).toBeNull();
  });

  it("one up next whose coins are short says so, its button held; with no school nothing can be picked", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    pick(p, "routes"); // 40 coins, none in hand: waits up next
    expect(researchCard(p, "routes", SCHOOL)).toMatchObject({ why: "Waiting for 40🪙", action: "Research now", blocked: true });
    expect(researchCard(p, "signals", null)).toMatchObject({ why: "Needs a school", action: "Add to queue", blocked: true });
    expect(researchCard(Progress.fresh(), "switches", null)).toMatchObject({ why: "Needs a school", action: "Research", blocked: true });
  });
});

describe("the HUD's research pill", () => {
  it("says what's under way and its goods, then its study; Pick research when nothing is picked", () => {
    const p = Progress.fresh();
    // No school, nothing picked: no pill.
    expect(pillView(p, false)).toBeNull();
    expect(pillText(pillView(p, false))).toBe("");
    expect(pillText(pillView(p, true))).toBe("📘 Pick research");
    expect(pillView(p, true)?.idle).toBe(true);
    pick(p, "bridges");
    deliver(p, "planks", 6);
    expect(pillText(pillView(p, true))).toBe("📘 Bridges \uE0006/10");
    expect(pillView(p, true)).toMatchObject({ name: "Bridges", fill: 0.6, idle: false });
    deliver(p, "planks", 4);
    expect(pillText(pillView(p, true))).toBe("📘 Bridges ⏱ 20 s");
    tick(p, 20);
    expect(pillText(pillView(p, true))).toBe("📘 Pick research");
  });

  it("a research with two goods shows both, one all in ticked; one waiting for coins shows them", () => {
    const p = Progress.fresh();
    p.learned.add("farming");
    p.coins = 40;
    pick(p, "mills");
    // (Its 40 coins paid as it started: not shown.)
    expect(pillText(pillView(p, true))).toBe("📘 Mills \uE0000/6 🌾0/6");
    deliver(p, "planks", 12);
    expect(pillText(pillView(p, true))).toBe("📘 Mills \uE000✓ 🌾0/6");
    const q = Progress.fresh();
    q.learned.add("switches");
    q.coins = 5;
    pick(q, "routes");
    expect(pillText(pillView(q, true))).toBe("📘 Train routes 🪙5/40");
  });

  describe("the count with 1, 2 and 3 goods, and shortened to fit a phone (pillCount)", () => {
    it("1 good: got of needed; the study once it's in", () => {
      const p = Progress.fresh();
      pick(p, "switches");
      deliver(p, "planks", 2);
      const v = pillView(p, true)!;
      expect(pillText(v)).toBe("📘 Switches \uE0002/3");
      expect([0, 1, 2].map((f) => pillCount(v, f as 0 | 1 | 2))).toEqual(["\uE0002/3", "\uE0002/3", "\uE0002/3"]);
      expect(v.words).toBe("2 of 3 \uE000 planks");
      deliver(p, "planks", 1);
      expect(pillCount(pillView(p, true)!, 2)).toMatch(/^⏱ \d+ s$/);
    });

    it("2 goods: both; then the one still lacking; never one cut off unsaid", () => {
      const p = Progress.fresh();
      p.learned.add("farming");
      p.coins = 40;
      pick(p, "mills");
      deliver(p, "grain", 2);
      const v = pillView(p, true)!;
      expect(pillText(v)).toBe("📘 Mills \uE0000/6 🌾2/6");
      expect(v.words).toBe("0 of 6 \uE000 planks, 2 of 6 🌾 grain");
      expect(pillCount(v, 1)).toBe("\uE0000/6 🌾2/6");
      // The most lacking (all 6 planks still to come) and one more.
      expect(pillCount(v, 2)).toBe("\uE0000/6 +1");
      deliver(p, "planks", 6);
      const w = pillView(p, true)!;
      expect(pillCount(w, 0)).toBe("\uE000✓ 🌾2/6");
      // The planks all in: left out when short of room, so no "+".
      expect(pillCount(w, 1)).toBe("🌾2/6");
      expect(pillCount(w, 2)).toBe("🌾2/6");
    });

    it("3 goods: all three, ticked when in; short: the ones lacking, then the most lacking +N", () => {
      // (No blueprint needs three goods yet: Mills is given iron as well, for this test only.)
      const goods = costOf("mills").goods as Record<string, number>;
      goods.iron = 10;
      try {
        const p = Progress.fresh();
        p.learned.add("farming");
        p.coins = 40;
        pick(p, "mills");
        deliver(p, "planks", 3);
        deliver(p, "grain", 1);
        const v = pillView(p, true)!;
        expect(v.parts).toHaveLength(3);
        expect(pillText(v)).toBe("📘 Mills \uE0003/6 🌾1/6 🔩0/10");
        expect(v.words).toBe("3 of 6 \uE000 planks, 1 of 6 🌾 grain, 0 of 10 🔩 iron");
        expect(pillCount(v, 2)).toBe("🔩0/10 +2");
        deliver(p, "iron", 10);
        deliver(p, "planks", 3);
        const w = pillView(p, true)!;
        expect(pillCount(w, 0)).toBe("\uE000✓ 🌾1/6 🔩✓");
        expect(pillCount(w, 1)).toBe("🌾1/6");
        expect(pillCount(w, 2)).toBe("🌾1/6");
        deliver(p, "grain", 5);
        expect(pillText(pillView(p, true))).toMatch(/^📘 Mills ⏱ \d+ s$/);
      } finally {
        delete goods.iron;
      }
    });

    it("unpaid coins shown (the one up next waits for them), paid ones not", () => {
      const p = Progress.fresh();
      p.learned.add("farming");
      p.coins = 10;
      pick(p, "mills");
      const v = pillView(p, true)!;
      expect(pillText(v)).toBe("📘 Mills 🪙10/40");
      expect(v.words).toContain("6 \uE000 planks, 6 🌾 grain");
      p.coins = 40;
      tick(p, 1);
      expect(p.research.current).toBe("mills");
      expect(pillText(pillView(p, true))).toBe("📘 Mills \uE0000/6 🌾0/6");
    });
  });

  it("a tap opens the picker on the research it shows: the one under way, or the one up next waiting for coins (QA P5)", () => {
    const p = Progress.fresh();
    expect(pillResearch(p)).toBeNull();
    p.learned.add("switches");
    p.coins = 10;
    pick(p, "routes");
    expect(pillText(pillView(p, true))).toBe("📘 Train routes 🪙10/40");
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
    expect(schoolCard(p)).toEqual({ piles: [{ label: "\uE000", count: 2, cap: 3 }], note: "Researching Switches", idle: false });
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

describe("the full cost and what it unlocks, in words (#11)", () => {
  it("every good with its amount, icon and name, then the coins; paid coins say so", () => {
    const p = Progress.fresh();
    p.learned.add("farming");
    expect(costWords(p, "switches")).toBe("3 \uE000 planks");
    expect(costWords(p, "mills")).toBe("6 \uE000 planks, 6 🌾 grain, 40 🪙 coins");
    p.coins = 100;
    pick(p, "mills");
    expect(costWords(p, "mills")).toBe("6 \uE000 planks, 6 🌾 grain, 40 🪙 coins (paid)");
    // Its chips drop the paid coins; the full cost still shows them.
    expect(chipsText(researchChips(p, "mills"))).toBe("\uE000 0/6 · 🌾 0/6");
    expect(costWords(p, "no-such-thing")).toBe("nothing");
  });

  it("chips say what they are: got of needed, and whether the coins are in hand", () => {
    const p = Progress.fresh();
    p.learned.add("farming");
    expect(researchChips(p, "mills").map((c) => c.title)).toEqual(["Planks: 0 of 6 brought", "Grain: 0 of 6 brought", "Coins: 40, not enough yet"]);
  });

  it("what it unlocks: the things it lets you make by their tray names, else what it lets you do", () => {
    expect(unlocksWords("switches")).toMatch(/^Switch, Y switch/);
    expect(unlocksWords("routes")).toBe("Routes on the engine card");
    expect(unlocksWords("tank")).toBe("Tank engine (Trains tab)");
    expect(unlocksWords("no-such-thing")).toBe("");
  });
});


describe("the research queue in words (#14)", () => {
  it("cards say where each waits; the pill counts the rest; the school's card too", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    p.coins = 10;
    toggleQueue(p, "bridges");
    toggleQueue(p, "signals");
    toggleQueue(p, "routes"); // 40 coins, 10 in hand
    expect(researchCard(p, "signals", SCHOOL)).toMatchObject({ why: "Next up, after Bridges", action: "Research now", remove: true });
    expect(researchCard(p, "routes", SCHOOL)).toMatchObject({ why: "2nd in line, after Signals · 30🪙 short", action: "Research now", blocked: true, remove: true });
    expect(researchCard(p, "junctions", SCHOOL)).toEqual({ chips: [{ text: "\uE000 0/" + costOf("junctions").goods.planks, title: `Planks: 0 of ${costOf("junctions").goods.planks} brought` }], study: "20 s study", action: "Add to queue" });
    expect(cardState(p, "routes")).toBe("next");
    expect(pillView(p, true)?.more).toBe(2);
    expect(pillText(pillView(p, true))).toBe("📘 Bridges \uE0000/10 +2");
    expect(schoolCard(p).note).toBe("Researching Bridges and ramps · 2 in queue");
    // Full: Add to queue is held back and says why.
    for (const id of ["junctions", "tank", "cranes1"]) toggleQueue(p, id);
    expect(researchCard(p, "farming", SCHOOL)).toMatchObject({ why: "The queue is full (5)", action: "Add to queue", blocked: true });
    // Taken out: back to ready.
    toggleQueue(p, "signals");
    expect(cardState(p, "signals")).toBe("ready");
    expect(researchCard(p, "routes", SCHOOL)?.why).toBe("Next up, after Bridges · 30🪙 short");
  });
});

describe("a locked tray tile says how to unlock it (unlockHow)", () => {
  it("one to research now: its name, and the picker opens on it", () => {
    const p = Progress.fresh();
    expect(text.unlockHow(p, "switches")).toEqual({ text: "Research Switches to unlock", jump: "switches" });
  });
  it("what it needs first, then it; the picker opens on the nearest one it shows", () => {
    const p = Progress.fresh();
    const how = text.unlockHow(p, "signals");
    expect(how.text).toBe("Research Switches, then Signals");
    // Signals is a key blueprint: its card shows already.
    expect(how.jump).toBe("signals");
  });
  it("a town to reach first, in the player's words", () => {
    const p = Progress.fresh();
    for (const id of ["switches", "stations"]) p.learned.add(id);
    expect(text.unlockHow(p, "big-stations").text).toBe("Reach a town, then research Big stations");
    p.bestLevel = 2;
    expect(text.unlockHow(p, "big-stations").text).toBe("Research Big stations to unlock");
  });
  it("under way, or up next, says so", () => {
    const p = Progress.fresh();
    pick(p, "switches");
    pick(p, "bridges");
    expect(text.unlockHow(p, "switches").text).toBe("Researching Switches now: it unlocks then");
    expect(text.unlockHow(p, "bridges").text).toBe("Bridges is next in Research: it unlocks then");
  });
  it("a jump only to a card the picker shows (never a ? or one not found yet)", () => {
    const p = Progress.fresh();
    for (const t of TECHS) {
      const how = text.unlockHow(p, t.id);
      expect(how.text.length, t.id).toBeGreaterThan(0);
      expect(how.text.length, `${t.id}: ${how.text}`).toBeLessThanOrEqual(110);
      if (how.jump) expect(seenOf(p).get(how.jump), t.id).toBe("shown");
    }
  });
});

describe("cards for chains in the queue", () => {
  it("a locked card that needs blueprints: Research Farming now when idle, Queue Farming, then Mills otherwise", () => {
    const p = Progress.fresh();
    p.coins = 500;
    expect(researchCard(p, "mills", SCHOOL)).toMatchObject({ action: "Research Farming now", why: "Then Mills" });
    expect(researchCard(p, "engine-shed", SCHOOL)).toMatchObject({ action: "Research Switches now", why: "Then Junctions, then Engine shed" });
    toggleQueue(p, "bridges");
    expect(researchCard(p, "mills", SCHOOL)).toEqual({ chips: [{ text: "\uE000 0/6", title: "Planks: 0 of 6 brought" }, { text: "🌾 0/6", title: "Grain: 0 of 6 brought" }, { text: "🪙 40", title: "Coins: 40, paid when it starts" }], study: "45 s study", action: "Queue Farming, then Mills" });
    expect(researchCard(p, "engine-shed", SCHOOL)).toMatchObject({ action: "Queue Switches and 2 more", why: "Switches, then Junctions, then Engine shed" });
    expect(researchCard(p, "engine-shed", SCHOOL)?.blocked).toBeUndefined();
    // Farming queued: Mills simply joins after it.
    toggleQueue(p, "farming");
    expect(researchCard(p, "mills", SCHOOL)).toMatchObject({ action: "Add to queue", why: "After Farming" });
    // No school: held back.
    expect(researchCard(p, "engine-shed", null)).toMatchObject({ why: "Needs a school", blocked: true });
  });

  it("held back saying why: a blueprint in the chain that can't be researched, or no room in the queue", () => {
    const p = Progress.fresh();
    // (No button: nothing to press till the planks are in. QA 2026-11-05 #4.)
    const stuck = researchCard(p, "scenery", SCHOOL);
    expect(stuck).toMatchObject({ why: "Carpenter's bench needs 50 planks delivered first" });
    expect(stuck?.action).toBeUndefined();
    // A town to grow first (Jam kitchen needs Sugar beet, which needs a city): it says the step.
    const q = Progress.fresh();
    for (const id of ["farming", "orchard", "juice"]) q.learned.add(id);
    const jam = researchCard(q, "jam", SCHOOL);
    expect(jam?.why).toBe("Sugar beet needs a city first: grow a town into one");
    expect(jam?.action).toBeUndefined();
    for (const id of ["bridges", "tank", "farming", "switches", "signals"]) toggleQueue(p, id);
    expect(researchCard(p, "engine-shed", SCHOOL)).toMatchObject({ action: "Queue Junctions, then Engine shed", why: "Needs 2 places in the queue (1 left)", blocked: true });
    toggleQueue(p, "junctions");
    expect(researchCard(p, "mills", SCHOOL)).toMatchObject({ why: "The queue is full (5)", blocked: true });
  });

  it("queued, needing blueprints: never Research now; Research X now, or only Remove while X is under way", () => {
    const p = Progress.fresh();
    p.coins = 500;
    toggleQueue(p, "bridges");
    toggleQueue(p, "engine-shed");
    expect(researchCard(p, "engine-shed", SCHOOL)).toMatchObject({ action: "Research Switches now", why: "3rd in line, after Junctions", remove: true });
    expect(researchCard(p, "junctions", SCHOOL)).toMatchObject({ action: "Research Switches now", remove: true });
    expect(researchCard(p, "switches", SCHOOL)).toMatchObject({ action: "Research now", why: "Next up, after Bridges", remove: true });
    startNow(p, "engine-shed");
    expect(p.research.current).toBe("switches");
    const v = researchCard(p, "junctions", SCHOOL);
    expect(v).toMatchObject({ why: "2nd in line, after Bridges", remove: true });
    expect(v?.action).toBeUndefined();
    // Learned: the plain Research now.
    deliver(p, "planks", 3);
    tick(p, 20);
    expect(researchCard(p, "junctions", SCHOOL)).toMatchObject({ action: "Research now" });
  });

  it("the toast names what else left the queue", () => {
    expect(removedText(["mills"])).toBe("Removed Mills too");
    // (Short names: "Junctions", not "Junctions and loops and …".)
    expect(removedText(["junctions", "engine-shed"])).toBe("Removed Junctions and Engine shed too");
    expect(removedText(["switches", "junctions", "engine-shed"])).toBe("Removed Switches, Junctions and Engine shed too");
  });
});

describe("a research learned, said once", () => {
  it("one toast with what's next, the name as the board writes it", async () => {
    const { learnedText } = await import("./research-text");
    const a = learnedText({ label: "Switches", makes: "Make a switch or a Y switch at the workshop", blurb: "", goal: "New goal: Lay a switch", next: "Tank engine" });
    expect(a.line).toBe("Learned Switches! Make a switch or a Y switch at the workshop");
    expect(a.toast).toBe("Learned Switches! Make a switch or a Y switch at the workshop · New goal: Lay a switch · Next: Tank engine");
    // A feature says how to use it, once.
    const b = learnedText({ label: "Train routes", makes: "", how: "Tap a train, then Plan a route", blurb: "Routes", next: "Signals" });
    expect(b.toast).toBe("Learned Train routes! Tap a train, then Plan a route · Next: Signals");
    expect(b.toast.match(/Learned/g)).toHaveLength(1);
  });
  it("main.ts makes no second Learned toast", async () => {
    const main = (await import("../main.ts?raw")).default;
    expect(main.match(/`Learned /g) ?? []).toHaveLength(0);
  });
});
