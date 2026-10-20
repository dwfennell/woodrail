import { describe, expect, it } from "vitest";
import rewardsSrc from "./rewards.ts?raw";
import mainSrc from "../main.ts?raw";
import { CARGO } from "../economy/cargo";
import { capOf } from "../economy/economy";
import { workshopStock } from "./crafting";
import { CARD_KINDS, type GrowthCard } from "./growth-cards";
import { Progress } from "./progress";
import { deliver, pick, tick } from "./research";
import { boostGoods, carIcon, cardFor, cardView, crateFor, describeThings, firstTimeGift, learnGift, offerOnGrowth, plankRoom, takeCard } from "./rewards";
import { TECHS } from "./tech";
import { THING_RULES } from "./things";
import { buildStarterWorld, syncIndustries, type World } from "./world";
import { rng } from "../lib/rng";
import { trainIcon } from "../ui/icons";

/** A starter world with a workshop (its yard empty) and, if asked, a school (both placed straight on the layout). */
function world(opts: { school?: boolean; farm?: boolean } = {}): World {
  const w = buildStarterWorld();
  w.layout.addPiece("depot-workshop", { x: 3000, z: 3000, heading: 0 });
  if (opts.school) w.layout.addPiece("depot-school", { x: 3000, z: 3600, heading: 0 });
  if (opts.farm) w.layout.addPiece("depot-farm", { x: 3600, z: 3000, heading: 0 });
  syncIndustries(w, true);
  return w;
}

/** A player researching Mills (12 planks and 6 grain), with coins to spare. */
function researching(id = "mills"): Progress {
  const p = Progress.fresh();
  p.learned.add("farming");
  p.coins = 500;
  expect(pick(p, id)).toBe("current");
  return p;
}

const planks = (w: World) => workshopStock(w).planks ?? 0;

describe("the growth menu: pick one of three", () => {
  it("an offer is three cards of different kinds, never a blueprint", () => {
    for (let seed = 1; seed < 40; seed++) {
      for (const level of [1, 2, 3, 5]) {
        const p = researching();
        const w = world({ school: true });
        const offer = offerOnGrowth(p, w, "Larkfield", level, rng(seed))!;
        expect(offer.cards).toHaveLength(3);
        expect(new Set(offer.cards.map((c) => c.kind)).size).toBe(3);
        for (const c of offer.cards) expect(CARD_KINDS).toContain(c.kind);
        expect(p.offers).toEqual([offer]);
        expect(offer).toMatchObject({ from: "Larkfield", level });
      }
    }
  });

  it("amounts scale by level: village, town, city and up", () => {
    const p = researching();
    // With Signals (so a city's wagon card is an engine, and crates may hold one).
    p.learned.add("switches");
    p.learned.add("signals");
    const w = world({ school: true });
    const amount = (kind: GrowthCard["kind"], level: number) => {
      const c = cardFor(p, w, kind, level, rng(1));
      if (!c) return null;
      if (c.kind === "planks" || c.kind === "coins" || c.kind === "rare") return c.n;
      if (c.kind === "crate") return c.things.length;
      if (c.kind === "boost") return c.share;
      return c.id;
    };
    const by = (kind: GrowthCard["kind"]) => [1, 2, 3, 4].map((l) => amount(kind, l));
    expect(by("planks")).toEqual([8, 16, 30, 30]);
    expect(by("coins")).toEqual([30, 80, 200, 200]);
    expect(by("crate")).toEqual([2, 3, 4, 4]);
    expect(by("boost")).toEqual([0.25, 0.4, 0.6, 0.6]);
    expect(by("rare")).toEqual([null, 6, 12, 12]);
    // A wagon you know (only the flatbed so far: hoppers come with Farming, learned here), and an engine for a city
    // once Signals are learned (learned above).
    const wagon = by("wagon");
    expect(["car:timber", "car:hopper"]).toContain(wagon[0]);
    expect(["car:timber", "car:hopper"]).toContain(wagon[1]);
    expect(wagon.slice(2)).toEqual(["car:engine", "car:engine"]);
  });

  it("a city's wagon card is an engine only once Signals are learned; before, a wagon as a smaller town's", () => {
    const w = world({ school: true });
    for (let seed = 1; seed < 20; seed++) {
      for (const level of [3, 4]) {
        const p = researching();
        const card = cardFor(p, w, "wagon", level, rng(seed));
        expect(card?.kind).toBe("wagon");
        expect(["car:timber", "car:hopper"]).toContain(card?.kind === "wagon" ? card.id : null);
        p.learned.add("switches");
        p.learned.add("signals");
        expect(cardFor(p, w, "wagon", level, rng(seed))).toEqual({ kind: "wagon", id: "car:engine" });
      }
    }
    // A village or town never offers the engine, Signals or not.
    const q = researching();
    q.learned.add("switches");
    q.learned.add("signals");
    for (const level of [1, 2]) expect(cardFor(q, w, "wagon", level, rng(3))).not.toEqual({ kind: "wagon", id: "car:engine" });
  });

  it("the planks card offers only what fits in the yard; none with no workshop or a full yard", () => {
    const p = Progress.fresh();
    const w = world();
    w.economy.allDepots().find((d) => d.role === "workshop")!.piles[CARGO.planks.index] = capOf("workshop") - 5;
    expect(plankRoom(w)).toBe(5);
    expect(cardFor(p, w, "planks", 3, rng(1))).toEqual({ kind: "planks", n: 5 });
    w.economy.allDepots().find((d) => d.role === "workshop")!.piles[CARGO.planks.index] = capOf("workshop");
    expect(cardFor(p, w, "planks", 3, rng(1))).toBeNull();
    expect(cardFor(p, buildStarterWorld(), "planks", 1, rng(1))).toBeNull();
  });
});

describe("the research boost", () => {
  it("only appears while a research is picked and short of goods", () => {
    const w = world({ school: true });
    // Nothing picked: no boost, in any offer.
    for (let seed = 1; seed < 30; seed++) {
      const idle = Progress.fresh();
      expect(offerOnGrowth(idle, w, "Larkfield", 2, rng(seed))!.cards.map((c) => c.kind)).not.toContain("boost");
    }
    // Its goods all in (studying): none either.
    const p = Progress.fresh();
    pick(p, "switches");
    expect(cardFor(p, w, "boost", 1, rng(1))).toEqual({ kind: "boost", share: 0.25 });
    deliver(p, "planks", 4);
    expect(cardFor(p, w, "boost", 1, rng(1))).toBeNull();
  });

  it("fills its share of each good the research still lacks, and only those", () => {
    const w = world({ school: true });
    // Bridges: 10 planks, 4 in: a village's 25% of the 6 left is 2 (rounded up).
    const p = Progress.fresh();
    pick(p, "bridges");
    deliver(p, "planks", 4);
    expect(boostGoods(p, 0.25)).toEqual({ planks: 2 });
    p.offers.push({ from: "Larkfield", level: 1, cards: [{ kind: "boost", share: 0.25 }] });
    expect(cardView(p, w, p.offers[0].cards[0])).toMatchObject({ ok: true, amount: "+2🪵" });
    // The toast says where the goods went (QA: "+3🪵" alone didn't).
    expect(takeCard(p, w, 0, 0)).toMatchObject({ amount: "+2🪵", taken: "+2🪵 to Bridges and ramps" });
    expect(p.research.got).toEqual({ planks: 6 });
    expect(p.offers).toEqual([]);
    // Mills: 6 planks and 6 grain: a town's 40% is 3 planks and 3 grain (rounded up).
    const q = researching();
    q.offers.push({ from: "Elderwick", level: 2, cards: [{ kind: "boost", share: 0.4 }] });
    expect(takeCard(q, w, 0, 0)).toMatchObject({ taken: "+3🪵 3🌾 to Mills" });
    expect(q.research.got).toEqual({ planks: 3, grain: 3 });
    expect(q.research.current).toBe("mills");
  });

  it("an offer kept till the research is done can't boost (the card says why), and keeps waiting", () => {
    const w = world({ school: true });
    const p = Progress.fresh();
    pick(p, "switches");
    p.offers.push({ from: "Larkfield", level: 1, cards: [{ kind: "boost", share: 0.25 }, { kind: "coins", n: 30 }] });
    deliver(p, "planks", 4);
    expect(cardView(p, w, p.offers[0].cards[0])).toMatchObject({ ok: false, why: "Pick a research that needs goods" });
    expect(takeCard(p, w, 0, 0)).toBeNull();
    expect(p.offers).toHaveLength(1);
  });
});

describe("rare cargo", () => {
  it("only from a town up, with a school, for a good the research lacks that you can't make", () => {
    const p = researching();
    expect(cardFor(p, world({ school: true }), "rare", 1, rng(1))).toBeNull();
    expect(cardFor(p, world(), "rare", 2, rng(1))).toBeNull();
    expect(cardFor(p, world({ school: true }), "rare", 2, rng(1))).toEqual({ kind: "rare", good: "grain", n: 6 });
    expect(cardFor(p, world({ school: true }), "rare", 3, rng(1))).toEqual({ kind: "rare", good: "grain", n: 12 });
    // A farm yard makes grain: not rare any more.
    expect(cardFor(p, world({ school: true, farm: true }), "rare", 2, rng(1))).toBeNull();
    // Nothing picked: no rare cargo either.
    expect(cardFor(Progress.fresh(), world({ school: true }), "rare", 3, rng(1))).toBeNull();
  });

  it("counts only toward what the research lacks", () => {
    const w = world({ school: true });
    const p = researching();
    deliver(p, "grain", 2);
    p.offers.push({ from: "Larkfield", level: 3, cards: [{ kind: "rare", good: "grain", n: 12 }] });
    expect(cardView(p, w, p.offers[0].cards[0])).toMatchObject({ ok: true, amount: "+4 grain" });
    expect(takeCard(p, w, 0, 0)).toMatchObject({ taken: "+4 grain to Mills" });
    expect(p.research.got).toEqual({ grain: 6 });
  });
});

describe("the wagon card's picture", () => {
  it("is the car it gives, as the toy box draws it (QA: always 🚃)", () => {
    const p = Progress.fresh();
    const w = world();
    const icons = new Set<string>();
    for (const id of ["car:timber", "car:hopper", "car:passenger", "car:van", "car:caboose", "car:engine"] as const) {
      const v = cardView(p, w, { kind: "wagon", id });
      expect(v.icon, id).toBe(carIcon(id));
      expect(v.icon, id).toContain(trainIcon([id.slice(4) as "timber"]));
      expect(v.icon, id).not.toMatch(/🚃|🚂/);
      icons.add(v.icon);
    }
    expect(icons.size).toBe(6);
  });
});

describe("taking a card", () => {
  it("applies it, in one go, and the offer is done", () => {
    const take = (card: GrowthCard, p = Progress.fresh(), w = world({ school: true })) => {
      p.offers.push({ from: "Larkfield", level: 2, cards: [card, { kind: "coins", n: 1 }] });
      const view = takeCard(p, w, 0, 0);
      expect(view, card.kind).not.toBeNull();
      expect(p.offers).toEqual([]);
      return { p, w };
    };
    const yard = take({ kind: "planks", n: 16 });
    expect(planks(yard.w)).toBe(16);
    expect(take({ kind: "coins", n: 80 }).p.coins).toBe(80);
    const crate = take({ kind: "crate", things: [["piece:buffer-turnback", 2], ["car:timber", 1]] }).p;
    expect([crate.owned.get("piece:buffer-turnback"), crate.owned.get("car:timber")]).toEqual([2 + 2, 3 + 1]);
    expect(take({ kind: "wagon", id: "car:engine" }).p.owned.get("car:engine")).toBe(2);
    expect(take({ kind: "boost", share: 0.6 }, researching()).p.research.got).toEqual({ planks: 4, grain: 4 });
    expect(take({ kind: "rare", good: "grain", n: 6 }, researching()).p.research.got).toEqual({ grain: 6 });
  });

  it("the planks card gives only what fits now: nothing lost", () => {
    const p = Progress.fresh();
    const w = world();
    const yard = w.economy.allDepots().find((d) => d.role === "workshop")!;
    p.offers.push({ from: "Larkfield", level: 3, cards: [{ kind: "planks", n: 30 }] });
    yard.piles[CARGO.planks.index] = capOf("workshop") - 4;
    expect(cardView(p, w, p.offers[0].cards[0])).toMatchObject({ ok: true, amount: "+4 planks" });
    takeCard(p, w, 0, 0);
    expect(yard.piles[CARGO.planks.index]).toBe(capOf("workshop"));
  });

  it("an offer closed without taking a card is still waiting, and comes back from a save", () => {
    const p = researching();
    const w = world({ school: true });
    const offer = offerOnGrowth(p, w, "Larkfield", 2, rng(4))!;
    offerOnGrowth(p, w, "Elderwick", 1, rng(5));
    // (Closing the sheet takes nothing: the offers are as they were.)
    const back = Progress.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    expect(back.offers).toEqual(p.offers);
    expect(back.offers[0]).toEqual(offer);
    const coins = back.coins;
    const i = back.offers[0].cards.findIndex((c) => c.kind !== "boost" && c.kind !== "rare");
    expect(takeCard(back, w, 0, i)).not.toBeNull();
    expect(back.offers.map((o) => o.from)).toEqual(["Elderwick"]);
    expect(back.coins).toBeGreaterThanOrEqual(coins);
  });
});

describe("growth never teaches a blueprint", () => {
  it("whatever is offered and taken, at any level", () => {
    for (let seed = 1; seed < 40; seed++) {
      for (const level of [1, 2, 3, 4, 5]) {
        const p = researching(seed % 2 ? "mills" : "bridges");
        const w = world({ school: true });
        const learned = [...p.learned];
        const offer = offerOnGrowth(p, w, "Larkfield", level, rng(seed))!;
        for (const c of offer.cards) expect(c).not.toHaveProperty("ids");
        takeCard(p, w, 0, seed % offer.cards.length);
        expect([...p.learned]).toEqual(learned);
      }
    }
    // The blueprint offers are gone from the code: no `offerFor`, `choose`, `takeBlueprint` or `refreshOffers`.
    expect(rewardsSrc).not.toMatch(/offerFor|takeBlueprint|refreshOffers|choose\(|schoolIdeas/);
    expect(TECHS.length).toBeGreaterThan(0);
  });

  it("an old save's blueprint offers are dropped", () => {
    const p = Progress.fromJSON({ owned: [], learned: [], offers: [{ from: "Larkfield", ids: ["bridges", "switches"] }, { from: "Elderwick", level: 2, cards: [{ kind: "coins", n: 80 }, { kind: "planks", n: -3 }, { kind: "coins", n: 5 }] }] });
    expect(p.offers).toEqual([{ from: "Elderwick", level: 2, cards: [{ kind: "coins", n: 80 }] }]);
  });
});

describe("three real choices", () => {
  it("a new game's first village offers three cards of different kinds, whatever the seed (QA P4: two, a slot empty)", () => {
    // As it is when the first village grows: no workshop or school placed, nothing researched, the village's present
    // in the box. Only coins, a crate and the flatbed can be offered, and the crate knew only the flatbed and turnbacks.
    const w = buildStarterWorld();
    for (let seed = 1; seed <= 500; seed++) {
      const p = Progress.fresh();
      firstTimeGift(p, 1);
      const offer = offerOnGrowth(p, w, "Larkfield", 1, rng(seed))!;
      expect(offer.cards, `seed ${seed}`).toHaveLength(3);
      expect(new Set(offer.cards.map((c) => c.kind)).size, `seed ${seed}`).toBe(3);
      const wagon = offer.cards.find((c) => c.kind === "wagon");
      const crate = offer.cards.find((c) => c.kind === "crate");
      expect(crate!.things.map(([id]) => id)).not.toContain(wagon!.id);
      for (const card of offer.cards) expect(cardView(p, w, card).ok, `seed ${seed} ${card.kind}`).toBe(true);
    }
    // One thing in the crate reads so.
    expect(cardView(Progress.fresh(), buildStarterWorld(), { kind: "crate", things: [["piece:buffer-turnback", 2]] }).amount).toBe("A crate: 1 thing");
  });

  it("a village with a school placed (Switches picked or not), or a workshop: three cards too", () => {
    const worlds = [buildStarterWorld(), world({ school: true })];
    for (let seed = 1; seed <= 200; seed++) {
      const p = Progress.fresh();
      if (seed % 2) expect(pick(p, "switches")).toBe("current");
      const w = worlds[seed % 3 ? 1 : 0];
      const offer = offerOnGrowth(p, w, "Larkfield", 1, rng(seed))!;
      expect(new Set(offer.cards.map((c) => c.kind)).size, `seed ${seed}`).toBe(3);
    }
  });

  it("a crate never holds the wagon card's car, so neither card is the other and more (QA)", () => {
    let both = 0;
    let crates = 0;
    const w = world();
    for (let seed = 1; seed < 400; seed++) {
      for (const level of [1, 2, 3]) {
        const p = Progress.fresh();
        if (seed % 3 === 0) p.learned.add("farming");
        if (seed % 5 === 0) p.learned.add("passengers");
        const offer = offerOnGrowth(p, w, "Larkfield", level, rng(seed))!;
        const wagon = offer.cards.find((c) => c.kind === "wagon");
        const crate = offer.cards.find((c) => c.kind === "crate");
        // (The crate keeps its size by level, 2, 3, 4 things, or all you know if that's fewer; one fewer when it was
        // drawn again without the wagon card's car, every wagon you know being in it.)
        if (crate) {
          crates++;
          const all = crateFor(p, 99, rng(1)).length;
          expect([Math.min(level + 1, all), Math.min(level + 1, all - 1)], `seed ${seed} level ${level}`).toContain(crate.things.length);
        }
        if (!wagon || !crate) continue;
        both++;
        expect(crate.things.map(([id]) => id), `seed ${seed} level ${level}`).not.toContain(wagon.id);
      }
    }
    // (Both shown together often enough for the check to mean something.)
    expect(both).toBeGreaterThan(50);
    expect(crates).toBeGreaterThan(200);
  });
});

describe("crates and presents", () => {
  it("a crate holds things you know, no buildings; a city's is bigger", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    const crate = crateFor(p, 3, rng(1));
    expect(crate.length).toBe(4);
    for (const [id] of crate) {
      expect(p.knows(id), id).toBe(true);
      expect(id.startsWith("piece:depot-"), id).toBe(false);
    }
    expect(crateFor(p, 1, rng(1)).length).toBe(2);
    const bare = new Progress();
    expect(crateFor(bare, 1, rng(1)).length).toBeGreaterThan(0); // timber wagons, turnbacks need no blueprint
  });

  it("a crate holds no engine till Signals are learned; after, it can", () => {
    let engines = 0;
    for (let seed = 1; seed < 60; seed++) {
      for (const level of [1, 2, 3, 5]) {
        const p = Progress.fresh();
        p.learned.add("switches");
        p.learned.add("farming");
        expect(crateFor(p, level, rng(seed)).map(([id]) => id), `seed ${seed} level ${level}`).not.toContain("car:engine");
        // The crate card too.
        const card = cardFor(p, world(), "crate", level, rng(seed));
        if (card?.kind === "crate") expect(card.things.map(([id]) => id)).not.toContain("car:engine");
        p.learned.add("signals");
        if (crateFor(p, level, rng(seed)).some(([id]) => id === "car:engine")) engines++;
      }
    }
    expect(engines).toBeGreaterThan(0);
  });

  it("first village, town and city each bring a present, once; the first village's includes the school", () => {
    const p = Progress.fresh();
    const engines = p.owned.get("car:engine") ?? 0;
    // The first village: a wagon, and a school to research blueprints at. No second engine (it comes with Signals).
    expect(firstTimeGift(p, 1)).toEqual([["car:timber", 1], ["piece:depot-school", 1]]);
    expect(p.owned.get("car:engine")).toBe(engines);
    expect(p.owned.get("piece:depot-school")).toBe(1);
    expect(firstTimeGift(p, 1)).toEqual([]);
    p.learned.add("farming");
    p.learned.add("harvesters");
    // A town: the cheapest industry you know (a farm yard, 90 coins; a harvester is 150; never the 40-coin school).
    expect(firstTimeGift(p, 2)[0]).toEqual(["piece:depot-farm", 1]);
    // Straight to a city from a village: the town's present too.
    const q = Progress.fresh();
    q.learned.add("farming");
    // (No engine for the city before Signals: two flatbed wagons in its place.)
    expect(firstTimeGift(q, 3).map(([id]) => id)).toEqual(["car:timber", "piece:depot-school", "piece:depot-farm", "piece:buffer-turnback", "car:timber", "piece:depot-farm"]);
    expect(q.bestLevel).toBe(3);
    const r = Progress.fresh();
    r.learned.add("signals");
    r.bestLevel = 2;
    expect(firstTimeGift(r, 3).map(([id]) => id)).toEqual(["car:engine"]);
  });

  it("the first city's present is never empty before Signals: a stand-in worth the engine takes its place (QA)", () => {
    // No industry known and no Signals: the present was empty and the news said only "Pick a reward".
    const p = Progress.fresh();
    p.bestLevel = 2;
    const gift = firstTimeGift(p, 3);
    expect(gift).toEqual([["car:timber", 2]]);
    expect(`Present: ${describeThings(gift)}`).toBe("Present: 2 Flatbed wagons");
    expect(p.owned.get("car:engine")).toBe(1);
    // Switches learned: two switches, toward the passing loop Signals will need (6 planks, as the engine is).
    const q = Progress.fresh();
    q.bestLevel = 2;
    q.learned.add("switches");
    expect(describeThings(firstTimeGift(q, 3))).toBe("2 Switches");
    expect(2 * (THING_RULES["piece:switch"]!.cost.planks ?? 0)).toBe(THING_RULES["car:engine"]!.cost.planks);
    // With an industry known: the stand-in and the industry.
    q.bestLevel = 2;
    q.learned.add("farming");
    expect(firstTimeGift(q, 3)).toEqual([["piece:switch", 2], ["piece:depot-farm", 1]]);
    // With Signals: the engine, no stand-in.
    const r = Progress.fresh();
    r.bestLevel = 2;
    r.learned.add("switches");
    r.learned.add("signals");
    expect(firstTimeGift(r, 3)).toEqual([["car:engine", 1]]);
  });

  it("learning Signals brings a second engine, once, unless you've two", () => {
    const p = Progress.fresh();
    expect(p.owned.get("car:engine")).toBe(1);
    expect(learnGift(p, "switches")).toEqual([]);
    expect(learnGift(p, "signals")).toEqual([["car:engine", 1]]);
    expect(p.owned.get("car:engine")).toBe(2);
    // Two already (an old save's village present, or one made in the workshop): nothing more.
    expect(learnGift(p, "signals")).toEqual([]);
    expect(p.owned.get("car:engine")).toBe(2);
  });

  it("researching Signals at the school brings the engine when the study is done (as the game's `learned` does)", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    p.coins = 100;
    expect(pick(p, "signals")).toBe("current");
    deliver(p, "planks", 8);
    // Not before the study is done.
    expect(tick(p, 1)).toBeNull();
    expect(p.owned.get("car:engine")).toBe(1);
    let done: string | null = null;
    for (let s = 0; s < 120 && !done; s++) done = tick(p, 1);
    expect(done).toBe("signals");
    expect(learnGift(p, done!)).toEqual([["car:engine", 1]]);
    expect(p.owned.get("car:engine")).toBe(2);
    // The game: a finished research goes through `learned`, which gives the present.
    const researched = mainSrc.slice(mainSrc.indexOf("function researched("), mainSrc.indexOf("function researched(") + 400);
    expect(researched).toMatch(/\blearned\(id\)/);
    const learned = mainSrc.slice(mainSrc.indexOf("function learned("), mainSrc.indexOf("function learned(") + 600);
    expect(learned).toMatch(/learnGift\(progress, id\)/);
  });
});
