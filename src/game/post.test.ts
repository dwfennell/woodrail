import { describe, expect, it } from "vitest";
import { canCarry, CARGO, CARGO_KINDS, CARGO_SLOTS, Economy, RECIPES } from "../economy";
import { CAR_BY_INDEX, CAR_KINDS, CAR_SPECS, Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { mailSeconds, MAIL_SECONDS, POST_TECH, POST_VANS_EVERY, POST_VANS_PER_TOWN, postLine, postVansFor } from "./post";
import { chainOf } from "./chains";
import { THING_RULES } from "./things";
import { TownCars, type CarTrip } from "./town-cars";
import { buysText } from "./town-ledger";
import { TownLife, type TownLifeHost } from "./town-life";
import { FULL_PAY, LUXURIES, payFor, PRICES, townStatus } from "./towns";
import { Vans } from "./vans";
import { buildStarterWorld, INDUSTRY_ROLE } from "./world";
import { deserializeWorld, serializeWorld } from "../persist/save";

const bp = (id: string) => BLUEPRINTS.find((b) => b.id === id)!;

/**
 * The post by train: a closed oval of the game's own pieces, a post office on one side and a town's station on the
 * other, one hand-run train going round. Nothing is written into a pile: the town posts its mail as the economy says
 * (`mailEvery`, set here as Game mode's TownLife sets it once Post office is learned: the shortcut, named), the train
 * takes it to the post office, which sorts it, and the post comes back to the town.
 */
function loop(cars: CarKind[], every: number | null = mailSeconds(2)) {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  const sequence: PieceTypeId[] = [...half, "depot-postoffice", ...half, "station"];
  const ids: number[] = [];
  let last = -1;
  for (const type of sequence) {
    last = last === -1 ? layout.addPiece(type, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, type, false, connectorRef(last, 1));
    ids.push(last);
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const office = economy.addDepot(INDUSTRY_ROLE["depot-postoffice"]!, ids[sequence.indexOf("depot-postoffice")]);
  const town = economy.addDepot("town", ids[sequence.indexOf("station")], 0);
  if (every !== null) economy.mailEvery = (d) => (d.role === "town" ? every : 0);
  const placed = sim.addTrain(cars, { pieceId: ids[ids.length - 1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, 1);
  const run = (minutes: number) => {
    for (let i = 0; i < minutes * 60 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
    expect(sim.getTrain(placed.trainId)!.derailed).toBe(false);
  };
  const got = (k: "post" | "mail") => economy.deliveredGoods.get(0)?.[k] ?? 0;
  return { economy, office, town, run, got, closed: [...layout.joints()].length === sequence.length };
}

describe("Post office: the blueprint, its things and its goods", () => {
  it("is built: tier 2 after Train routes, a town first; it brings the post office and the mail van", () => {
    expect(bp(POST_TECH).plan).toBeUndefined();
    expect(bp(POST_TECH)).toMatchObject({ needs: ["routes"], tier: 2, research: { goods: { planks: 10 }, coins: 120 } });
    expect(bp(POST_TECH).requires).toEqual([{ kind: "level", level: 2 }]);
    expect(THING_RULES["piece:depot-postoffice"]).toMatchObject({ tech: POST_TECH, cost: { planks: 8 }, coins: 180 });
    expect(THING_RULES["car:mailvan"]).toMatchObject({ tech: POST_TECH, cost: { planks: 3 } });
    // The Sorting van stays planned, after it.
    expect(bp("mail")).toMatchObject({ plan: "soon", needs: [POST_TECH] });
  });

  it("a town gives mail and takes post; a post office sorts mail into post; only a mail van carries either", () => {
    expect(RECIPES.town.gives).toEqual(["mail"]);
    expect(RECIPES.town.takes).toContain("post");
    expect(RECIPES.town.takes).not.toContain("mail");
    expect(RECIPES.postoffice).toMatchObject({ takes: ["mail"], gives: ["post"], cycle: { uses: { mail: 1 }, makes: { post: 1 } } });
    expect(CAR_KINDS.filter((k) => canCarry(k, "mail"))).toEqual(["mailvan"]);
    expect(CAR_KINDS.filter((k) => canCarry(k, "post"))).toEqual(["mailvan"]);
    expect(CAR_SPECS.mailvan).toMatchObject({ length: 84, powered: false });
    // Their own index ranges (goods from 30, wagons from 15: other branches take 19-29 and 10-14), so old saves' indices
    // stay and branches don't clash; arrays by index are `CARGO_SLOTS` long, a snapshot's wagon read by `CAR_BY_INDEX`.
    expect([CARGO.mail.index, CARGO.post.index]).toEqual([30, 31]);
    expect(CARGO_SLOTS).toBe(32);
    expect(CAR_SPECS.mailvan.index).toBe(15);
    expect(CAR_BY_INDEX[15]).toBe("mailvan");
    for (const k of CAR_KINDS) expect(CAR_BY_INDEX[CAR_SPECS[k].index]).toBe(k);
    expect(new Set(CARGO_KINDS.map((k) => CARGO[k].index)).size).toBe(CARGO_KINDS.length);
    // A school or a harbour's quay takes neither.
    expect(RECIPES.school.takes).not.toContain("mail");
    expect(RECIPES.harbour.takes).not.toContain("post");
  });

  it("towns buy post at full pay, at any level, but never need it to grow", () => {
    expect(FULL_PAY.has("post")).toBe(true);
    expect(LUXURIES.has("post")).toBe(true);
    expect(payFor("post", townStatus({}))).toBe(PRICES.post);
    for (let level = 0; level < 6; level++) expect(townStatus({}).wants.post ?? 0).toBe(0);
    expect(buysText(new Set([POST_TECH]))).toBe("Always buys 📮 post at full pay");
  });

  it("bigger towns post more often; post vans come with post, two at most", () => {
    expect(mailSeconds(0)).toBe(MAIL_SECONDS[0]);
    expect(mailSeconds(99)).toBe(MAIL_SECONDS[MAIL_SECONDS.length - 1]);
    for (let l = 1; l < MAIL_SECONDS.length; l++) expect(MAIL_SECONDS[l]).toBeLessThan(MAIL_SECONDS[l - 1]);
    expect([0, 1, POST_VANS_EVERY, POST_VANS_EVERY + 1, 1000].map(postVansFor)).toEqual([0, 1, 1, 2, POST_VANS_PER_TOWN]);
    expect(postLine(false, 3, 0)).toBeNull();
    expect(postLine(true, 0, 0)).toBe("Posts ✉️ mail · a mail van takes it to a post office");
    expect(postLine(true, 2, 1)).toBe("2 ✉️ mail to send · a post van on its streets");
  });
});

describe("the post by train", () => {
  it("town → mail van → post office → post back to the town, paid", () => {
    const { closed, run, economy, got } = loop(["engine", "mailvan", "mailvan"]);
    expect(closed).toBe(true);
    run(12);
    expect(economy.made[CARGO.mail.index]).toBeGreaterThan(0);
    expect(economy.made[CARGO.post.index]).toBeGreaterThan(0);
    expect(got("post")).toBeGreaterThan(0);
    // The mail itself never goes back into a town.
    expect(got("mail")).toBe(0);
  }, 120_000);

  it("a goods van takes no mail: it waits on the town's pile", () => {
    const { run, economy, town } = loop(["engine", "van"]);
    run(4);
    expect(town.piles[CARGO.mail.index]).toBeGreaterThan(0);
    expect(economy.made[CARGO.post.index]).toBe(0);
  }, 60_000);

  it("no mail at all where the mode says none (Sandbox, or before Post office is learned): old games play as before", () => {
    const { run, economy, town } = loop(["engine", "mailvan"], null);
    run(3);
    expect(economy.made[CARGO.mail.index]).toBe(0);
    expect(town.piles[CARGO.mail.index]).toBe(0);
  }, 60_000);

  it("a town's mail pile stops at its cap", () => {
    const { run, town } = loop(["engine", "van"], 1);
    run(3);
    expect(town.piles[CARGO.mail.index]).toBe(12);
  }, 60_000);
});

/** The starter map, its towns alive (TownLife), what's learned a set the test changes. */
function starter() {
  const w = buildStarterWorld();
  const learned = new Set<string>();
  const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
  const life = new TownLife(host, { grew: () => {}, received: () => {}, knows: (id) => learned.has(id) });
  life.reset();
  return { w, learned, life };
}

describe("towns post mail once Post office is learned (TownLife)", () => {
  it("none before; then at each town's station, by its level", () => {
    const { w, learned } = starter();
    const stations = w.economy.allDepots().filter((d) => d.role === "town" && w.stations.get(d.townId) === d.pieceId);
    expect(stations.length).toBeGreaterThan(0);
    for (const d of stations) expect(w.economy.mailEvery!(d)).toBe(0);
    learned.add(POST_TECH);
    for (const d of stations) expect(w.economy.mailEvery!(d)).toBe(mailSeconds(townStatus(w.economy.deliveredGoods.get(d.townId) ?? {}).level));
    // Played on, each station's pile fills (no train comes for it here).
    for (let k = 0; k < 120 * SIM_HZ; k++) w.economy.tick();
    for (const d of stations) expect(d.piles[CARGO.mail.index]).toBeGreaterThan(0);
  });

  it("a town's chain shows its mail only once a post office could take it", () => {
    const { w } = starter();
    const d = w.economy.allDepots().find((x) => x.role === "town")!;
    const placeOf = (x: { pieceId: number }) => w.layout.getPiece(x.pieceId)?.pose ?? null;
    expect(chainOf(d, w.economy.allDepots(), placeOf as never).outputs).toEqual([]);
  });
});

describe("post vans on a town's streets", () => {
  it("none till a town has had post; then a red post van drives its streets, another with more", () => {
    const w = buildStarterWorld();
    const town = w.landscape.towns.find((t) => t.name === "Larkfield")!;
    const vans = new Vans(() => w, () => ({ version: 0, has: () => false }));
    const cars = new TownCars({ world: w, vans, knows: () => true });
    const run = (seconds: number) => {
      for (let s = 0; s < seconds; s++) {
        for (let k = 0; k < SIM_HZ; k++) w.economy.tick();
        cars.sync();
      }
    };
    run(2);
    expect(vans.vehicles.list).toHaveLength(0);
    w.economy.deliveredGoods.set(town.id, { post: 1 });
    run(1);
    const [van] = cars.carsOf(town.id, "post");
    expect(van?.kind).toBe("post");
    expect(van.leg).not.toBe("home");
    const cells = new Set(town.cells);
    for (const i of van.path!.squares) expect(cells.has(i)).toBe(true);
    // No car came with it: a town's cars come only with cars.
    expect(cars.carsOf(town.id, "car")).toHaveLength(0);
    w.economy.deliveredGoods.set(town.id, { post: POST_VANS_EVERY + 1 });
    run(1);
    expect(cars.carsOf(town.id, "post")).toHaveLength(2);
    expect(new Set(cars.carsOf(town.id, "post").map((v) => (v.data as CarTrip).k))).toEqual(new Set([0, 1]));
  });
});

describe("saves", () => {
  it("an old save (19 goods a pile, before the post) loads; a town's mail is kept", () => {
    const w = buildStarterWorld();
    const old = JSON.parse(JSON.stringify(serializeWorld(w)));
    for (const d of old.depots) d.piles = d.piles.slice(0, 19);
    const r = deserializeWorld(old);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const d of r.value.economy.allDepots()) expect(d.piles[CARGO.mail.index]).toBe(0);
    // Saved now and loaded again: mail on a town's pile stays.
    const town = w.economy.allDepots().find((d) => d.role === "town")!;
    town.piles[CARGO.mail.index] = 3;
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value.economy.allDepots().find((d) => d.pieceId === town.pieceId)!.piles[CARGO.mail.index]).toBe(3);
  });
});

describe("balance: the post against the food chains it sits beside", () => {
  /** Coins a blueprint and its building cost (planks at a town's plank price: what they'd have sold for). */
  const outlay = (tech: string, building: string) => {
    const r = bp(tech).research;
    const t = THING_RULES[building as keyof typeof THING_RULES]!;
    const planks = (r.goods.planks ?? 0) + (t.cost?.planks ?? 0);
    return (r.coins ?? 0) + (t.coins ?? 0) + planks * PRICES.planks!;
  };
  /** Minutes to earn the outlay back at `perMinute` coins. */
  const payback = (coins: number, perMinute: number) => coins / perMinute;

  it("two towns' post pays back about as soon as an orchard's fruit or a juice works' juice", () => {
    // The post: a post office (and its blueprint) and two mail vans, two towns at town level (2) posting.
    const post = payback(outlay(POST_TECH, "piece:depot-postoffice") + 2 * 3 * PRICES.planks!, 2 * (60 / mailSeconds(2)) * PRICES.post!);
    // An orchard: 1 fruit / 14 s, sold at full pay. A juice works on one orchard's fruit: 1 juice / 14 s.
    const orchard = payback(outlay("orchard", "piece:depot-orchard"), (60 / RECIPES.orchard.cycle!.seconds) * PRICES.fruit!);
    const juice = payback(outlay("juice", "piece:depot-juicer"), (60 / RECIPES.orchard.cycle!.seconds) * (PRICES.juice! - PRICES.fruit!));
    const lo = Math.min(orchard, juice);
    const hi = Math.max(orchard, juice);
    expect(post).toBeGreaterThan(lo * 0.75);
    expect(post).toBeLessThan(hi * 1.25);
  });

  it("a city posts more than a hamlet, and one post office sorts the post of three big cities", () => {
    expect(60 / mailSeconds(3)).toBeGreaterThan(60 / mailSeconds(0));
    expect(3 * (1 / mailSeconds(99))).toBeLessThanOrEqual(1 / RECIPES.postoffice.cycle!.seconds);
  });
});
