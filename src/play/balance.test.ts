import { beforeAll, describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { CARGO, canCarry, type CargoKind } from "../economy/cargo";
import { capAt, RECIPES, type RouteStopDef } from "../economy/economy";
import { describe as describeGoods, total, type Bag } from "../economy/goods";
import { HarbourTrade } from "../game/harbours";
import { craftNow, craftShort, Crafting, keepsForOrder, lacking, shopOwes, shopOwing, shopSpare, WORKSHOP_SPARE, workshops, workshopStock, yardKeeps } from "../game/crafting";
import { attachEngines } from "../game/engines";
import { GOALS, GoalTracker } from "../game/goals";
import { plotPrice } from "../game/towns";
import { rateFor, resourceAt, siteWhy, SITE_RULES, updateRates, yardMiddle } from "../game/industries";
import { landmarksAt, researchSpeed, townLandmarks } from "../game/landmarks";
import { editLine, joinLine, startLine, trainsOn } from "../game/lines";
import { attachPassengers, peopleArrive } from "../game/passengers";
import { engineStatus } from "../game/engine-status";
import { inUse, Progress } from "../game/progress";
import { cardView, firstTimeGift, learnGift, offerOnGrowth, payDelivery, takeCard } from "../game/rewards";
import { built, techOf, TECHS, unlocksOf } from "../game/tech";
import { attachResearch, canResearch, costOf as researchCost, lacking as researchLacking, pick as pickResearch, setSpeed, studying, tick as researchTick } from "../game/research";
import { isFree, pieceThing, ruleOf, THING_RULES, thingsFor, type ThingId } from "../game/things";
import { receivedBy, TownLife, type TownLifeHost } from "../game/town-life";
import { applyCranes, boostOf, Counters } from "../game/upgrades";
import { buildStarterWorld, plotsForSale, unlockPlot, haltTown, haltWhy, INDUSTRY_ROLE, syncIndustries, type World, fixedPieces } from "../game/world";
import { FEAT_FIELD, FEAT_TREE, isWater, looseHeight, type SiteRole } from "../landscape";
import { gamePayment, nearestRuin, restoreRuin } from "../game/restore";
import { restorePrice, restoredType } from "../game/map-sites";
import { LandEditor } from "../landscape/edit";
import { loadFootprints } from "../props/footprints-testing";
import { propsInRect, type Footprint } from "../props/placement";
import { fieldPrice, fieldSpot, plantField } from "../game/fields";
import { rng } from "../lib/rng";
import { CAR_SPECS, COUPLER_GAP, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, indexOfRef, pieceOfRef, type PieceTypeId, type Pose } from "../track";
import { legFromCursor, lineLegs, runsLength } from "../game/route-path";
import { topologyOf, trainLength } from "../economy/sections";
import { play, type Blocked } from "./player";
import { pathLength } from "../track/path";
import { endOn, rulesFor, schoolOn } from "./rules";

/**
 * A balance and pacing play-through of Game mode, on the game's own rules and none of the tours' shortcuts: every
 * blueprint is researched at a school (goods brought by train, coins from tier 2), every piece, car and industry that
 * costs anything is made from the workshop's yard (as the tray does), a growing town offers three cards (never a
 * blueprint) and the player takes one of those that make sense now (at random, seeded per run), and passengers come
 * and pay. A simulated new player follows the goals, joins towns, runs trains, places its school beside a town as
 * soon as it has one, builds what the blueprints allow, and picks research in its wish order (what its railway can
 * bring the goods for, keeping a few planks in the workshop to build with; past Quarries, toward the industry that makes
 * a good its railway lacks first, `towardChains`, and the rest it can feed once its wishes run out, building the
 * foundry once Foundry is learned). When cargo is stuck it does what a player
 * can on the engine and depot cards: picks a good up only on the way to where it's taken, if its cars come to another
 * good's full pile loaded with it (`unstick`), and switches the workshop's crane off while a town past it starves
 * (`shopThrough`). The log is a timeline in minutes of play;
 * the SUMMARY research line has the first research's minute, how many were done by minutes 60, 120 and 180, and the
 * longest wait for a research's goods.
 *
 * Slow (minutes of play are simulated tick by tick), so skipped unless asked for:
 *   BALANCE=1 npx vitest run src/play/balance.test.ts
 * BALANCE_TRAINS_PER_LINE=n puts up to n trains on the line once routes are learned (default 1). BALANCE_JSON=1 also
 * prints the timeline as one line of JSON; BALANCE_MINUTES caps the play (default 180). BALANCE_CARGO=a-b logs the
 * trains' loads from minute a to b (`cargoTrace`). For comparison, BALANCE_NOUNSTICK=1 leaves stuck cargo be
 * (`unstick`, `shopThrough`), BALANCE_NOFILL=1 leaves a goods engine's spare pull empty, and BALANCE_NORUINS=1 never
 * restores an old industry's ruin (`restoreOld`: map sites step 2), building new ones as before. BALANCE_SPUR=1 (an A/B,
 * off by default) also lays a short spur to a ruin no line end reaches, its switch set by hand before Routes (`tendSpur`);
 * BALANCE_SPUR=routes, the same spur with Routes learned before Mills instead. The people train (the second train, two
 * coaches) joins the line once routes are learned, and the player lays it a passing loop (`peopleLine`; picked up when
 * stuck, it's put back on that loop once laid); BALANCE_PEOPLE_OWN=1 gives it a line of its own through the towns
 * instead, BALANCE_PEOPLE_HAND=1 runs it by hand (lever on, no route) as before. Two lines' trains stuck with no loop to
 * meet at, the card says "Add a passing loop here" and the player lays one there.
 *
 * At 180 min with 1 train a line, the run checks spec §5's bands (`checkBands`): each miss is listed, and any fails it.
 *
 * The goals play-through (the same player, working down the goals' list) runs in two parts (see `GOALS_RUN_MINUTES`):
 * the fast one in plain `npm test` (to minute 175, about 47 s), and a long one, skipped unless asked for:
 *   GOALS_LONG=1 npx vitest run src/play/balance.test.ts -t "long goals"
 * which plays on to minute 440 (about 130 s) and checks the mine, "Connect every town" and the harbour too.
 */

/** The environment (Node's, under Vitest), without Node's types. */
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * The game's own prop footprints (`Game.footprintOf`: `PropLibrary.footprint`, measured from the models), so the
 * harness keeps towns' lots and fields clear of props just as the game does. (Its props are towns' buildings.)
 */
let footprintOf: (asset: string) => Footprint | undefined = () => {
  throw new Error("footprints not loaded yet (see beforeAll)");
};
beforeAll(async () => {
  footprintOf = await loadFootprints(["bldg"]);
}, 60_000);
const RUN = !!ENV.BALANCE;
const MAX_MINUTES = Number(ENV.BALANCE_MINUTES ?? 180);
/** Most trains on the line once routes are learned (1: only the goods train). */
const PER_LINE = Number(ENV.BALANCE_TRAINS_PER_LINE ?? 1);
/** Passing loops laid on the line once it's to have more than one train (default: one per extra train; BALANCE_NOLOOP=1: none). */
const LOOPS = ENV.BALANCE_NOLOOP ? 0 : Number(ENV.BALANCE_LOOPS ?? Math.max(0, PER_LINE - 1));
/** The target: a town that's a City ★★ (the sixth rung: hamlet, village, town, city, city ★, city ★★). */
const TARGET_LEVEL = 5;

const minutes = (ticks: number) => ticks / SIM_HZ / 60;
const peg = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" as const };

/** Paid pieces the simulated layer may reach for (ramps up hills, bridges over rivers). */
const PAID_TRACK: readonly PieceTypeId[] = ["ramp", "bridge", "bridge-curve"];

/**
 * The order a sensible new player wants blueprints in: the goals' first, then what the towns want next. (Signals early:
 * the goal "Run two trains at once" waits for them, and a second train is what carries people.)
 */
const WISH: readonly string[] = [
  "switches",
  "bridges",
  "farming",
  "mills",
  "passengers",
  "routes",
  "halts",
  "signals",
  "quarries",
  "cranes1",
  "carpentry",
  "tank",
  "goods-engine",
  "mines",
  "foundry",
  "warehouses",
  "harvesters",
  "sawmills",
  "junctions",
  "college",
];

/**
 * The goals play-through's player works down the goals' list (`GOALS_WISH`): Quarries first of what's left ("Open a
 * quarry"), as `WISH` has it; once Quarries is learned, what "Open a mine" needs (the Tank engine, the Goods engine,
 * Mines) and Warehouses (which `WISH` leaves for later: "Open a harbour" needs it, and it fills the research's wait
 * for the Goods engine's flour and Mines' stone), and once Mines is, Harbours (which `WISH` hasn't); then the rest of
 * `WISH`, Foundry first, only once the harbour stands (`decide`).
 */
const GOALS_NEXT: readonly string[] = ["tank", "goods-engine", "mines", "warehouses", "harbours"];
/** Each of `GOALS_NEXT`, picked only once this blueprint is learned (the goal's before it, or Quarries). */
const GOALS_AFTER: Readonly<Record<string, string>> = { tank: "quarries", "goods-engine": "quarries", mines: "quarries", warehouses: "quarries", harbours: "mines" };
const GOALS_WISH: readonly string[] = [...WISH.slice(0, WISH.indexOf("quarries") + 1), ...GOALS_NEXT, ...WISH.slice(WISH.indexOf("quarries") + 1).filter((id) => !GOALS_NEXT.includes(id))];

/**
 * Map sites step 2: the player restores an old industry's ruin within this reach (mm) of its line when that's cheaper
 * than a new one (`restoreOld`); BALANCE_NORUINS=1 never does, to compare.
 */
const NORUINS = !!ENV.BALANCE_NORUINS;
const RUIN_REACH = Number(ENV.BALANCE_RUIN_REACH ?? 1500);
/**
 * BALANCE_SPUR (an A/B, off by default: the CoS's choice, spec §7): an old industry no line end can be run on to is
 * restored on a short spur (`spurTo`). Off, it's restored only from a line end (step 2's rule), which on the starter
 * map never reaches the old farm: a new farm yard is built. (On, the nine seeds all restore the old farm, at minute 15
 * to 23. Seeds 5 and 9 once missed the City's band, at 109 and 98: the workshop's yard sat one plank short of the
 * mill for most of an hour. The player now orders the mill at the workshop (`orderMill`), and all nine pass. The
 * goals play-through, which must see the old farm restored, has it on.)
 */
const SPUR = !!ENV.BALANCE_SPUR;
/**
 * How the player gets the grain of an old farm restored on a spur before Routes: BALANCE_SPUR=1 (or anything else),
 * setting the spur's switch for the farm by hand when the train should call there (`tendSpur`); `routes`, learning
 * Routes before Mills instead (Mills waits for it).
 */
const ROUTES_FIRST = ENV.BALANCE_SPUR === "routes";

/**
 * The goals play-through, in two parts: the same player on the starter map (picking research in the goals' order,
 * `GOALS_WISH`), and every goal of GOALS must be met by the part's last minute but those its list allows, each with why.
 * A goal listed that is met fails too, so the lists only ever shrink.
 *
 * - The fast part is part of `npm test` (not only BALANCE=1): `GOALS_RUN_MINUTES` of play, about 47 s on a laptop
 *   (BALANCE_GOALS_MINUTES to try others). The minutes are what fits the time `npm test` gives it: the quarry is built
 *   at minute 157, its stone in a city by 170.
 * - The long part, opt-in: GOALS_LONG=1 npx vitest run src/play/balance.test.ts -t "long goals"
 *   The same play on to `GOALS_LONG_MINUTES` (about 130 s; BALANCE_GOALS_LONG_MINUTES to try others): the mine opened
 *   the player's way, its coal or ore made and carried, the last two towns joined, then Harbours learned, its stone
 *   brought by train to the workshop and a harbour built by the sea and joined to the line, and a boat trading there.
 *   Skipped without the flag.
 *
 * BALANCE_GOALS_LOG=1 prints either part's log; BALANCE_JOIN_TRACE=1 logs each try at joining a town, BALANCE_STOPS=1
 * the line's stops each time they're set.
 */
const GOALS_RUN_MINUTES = Number(ENV.BALANCE_GOALS_MINUTES ?? 175);
const GOALS_LONG = !!ENV.GOALS_LONG;
/**
 * The long part's minutes: the mine stands at 220; Harbours is studied from 270 (30 planks and 20 stone, on the one
 * goods train) and learned at 354, the last town joined at 355; the harbour is ordered at the workshop then, its 15
 * planks and 10 stone come to the yard and it's built at 397. The mine's ore waits for a taker (the harbour: Foundry
 * comes after it): the quarry's visit before the mine is set to Only drop then (`roomForMine`), the ore is first on a
 * train at 405, and a boat takes goods off the quay at 412 (stone, then the ore).
 */
const GOALS_LONG_MINUTES = Number(ENV.BALANCE_GOALS_LONG_MINUTES ?? 440);
/** The goals the fast part doesn't reach by `GOALS_RUN_MINUTES`, with why. */
export const GOALS_NOT_REACHED: Readonly<Record<string, string>> = {
  "open-mine": "Mines wants 20 stone delivered, 10 more at the school and the Goods engine, which this one goods train brings only at about minute 195; the mine stands at about 220: the long part's (GOALS_LONG=1)",
  "open-harbour": "Harbours needs Mines learned (about minute 219), then 30 planks and 20 stone at the school, and the harbour 15 planks and 10 stone at the workshop, all on the one goods train: it stands at about 397, a boat trades at 412: the long part's (GOALS_LONG=1)",
  "join-all": "the player joins Ashcombe and Brambleton once the mine is open (the goals' order), past this part's minutes: the long part's (GOALS_LONG=1)",
  "buy-land": "the player buys land once every town is joined (the goals' order: more land, more towns), past this part's minutes: the long part's (GOALS_LONG=1)",
};
/** The goals the long part doesn't reach by `GOALS_LONG_MINUTES`, with why: each must be allowed in the fast part too. */
export const GOALS_LONG_NOT_REACHED: Readonly<Record<string, string>> = {};

/** The goals neither met nor listed in `allowed` (with why), and those listed but met or not goals at all. */
export function goalsMissed(isDone: (id: string) => boolean, allowed: Readonly<Record<string, string>>, goals: readonly { id: string; title: string }[] = GOALS): { missed: string[]; stale: string[] } {
  return {
    missed: goals.filter((g) => !isDone(g.id) && !(g.id in allowed)).map((g) => `${g.title} (${g.id})`),
    stale: Object.keys(allowed).filter((id) => isDone(id) || !goals.some((g) => g.id === id)),
  };
}

/** Planks a player keeps in the workshop's yard before picking another research (BALANCE_SPARE to try others). */
const RESEARCH_SPARE = Number(ENV.BALANCE_SPARE ?? 10);

/**
 * Planks the workshop's yard takes with no order while a town on the line wants them (the game's `WORKSHOP_SPARE`;
 * BALANCE_YARD_SPARE to try others, -1 for the old rule: the yard takes all it has room for).
 */
const YARD_SPARE = Number(ENV.BALANCE_YARD_SPARE ?? WORKSHOP_SPARE);
/**
 * The yard's spare covers the industry the current goal points at or research waits on, if dearer than `YARD_SPARE`
 * (the game's `shopSpare`: a mine's 10 for "Open a mine", a mill's 8 while Quarries waits for flour).
 * BALANCE_SPARE_COVERS=off for the old rule, `YARD_SPARE` alone.
 */
const SPARE_COVERS = ENV.BALANCE_SPARE_COVERS !== "off";
/**
 * Planks in the yard that are planks to spare for picking research: `RESEARCH_SPARE`, or what the yard holds while a
 * town on the line wants planks (`YARD_SPARE`) if fewer, since it fills no further then (with the old rule the player
 * waited for 10 that never came, and research sat idle for the rest of the game).
 */
/**
 * Every workshop set to Takes all planks (`takesAll`: BALANCE_WORKSHOP=greedy), filling its yard though a town ahead
 * wants them, for comparing with the default (Shares with towns).
 */
const GREEDY_WORKSHOP = ENV.BALANCE_WORKSHOP === "greedy";
/**
 * Which of the sensible reward cards the player takes (BALANCE_CARD, a robustness check): "first" or "last" of those on
 * offer, in place of the seeded random pick (the default). For showing a play-through doesn't hang on one lucky card.
 */
const CARD_PICK = ENV.BALANCE_CARD === "first" || ENV.BALANCE_CARD === "last" ? ENV.BALANCE_CARD : null;
const PICK_SPARE = GREEDY_WORKSHOP ? RESEARCH_SPARE : YARD_SPARE < 0 ? RESEARCH_SPARE : Math.min(RESEARCH_SPARE, YARD_SPARE);

/** Wished for, but of no use to this player till much later: bought only with planks and coins to spare. */
const LATER: ReadonlySet<string> = new Set(["warehouses", "sawmills", "junctions", "college"]);

/** The goods the industries a blueprint lets you build make (Quarries: stone; Mines: coal and ore; Foundry: iron). */
export function goodsUnlocked(id: string): CargoKind[] {
  return unlocksOf(id).flatMap((t) => {
    const role = t.startsWith("piece:") ? INDUSTRY_ROLE[t.slice("piece:".length) as PieceTypeId] : undefined;
    // (What its cycle makes: a warehouse gives every good, but only what it was brought.)
    return role ? (Object.keys(RECIPES[role].cycle?.makes ?? {}) as CargoKind[]) : [];
  });
}

/**
 * Research toward a goods chain, as a player looks past what the railway can feed now: the goods a blueprint still to
 * learn asks of a school that no industry on the line makes (`made`), taken in the order those blueprints come in
 * `order` (the wish list, then the rest), and for each the blueprint whose industry makes it (Quarries' stone, Mines'
 * coal and ore, Foundry's iron), or, while that one can't be researched yet, what it needs first (the Tank engine and
 * the Goods engine, before Mines). Only blueprints `ok` allows (researchable now and fed), each once. A good whose
 * industry's blueprint is learned already is the builder's to open (`openIndustry`), not research's.
 */
export function towardChains(learned: ReadonlySet<string>, made: ReadonlySet<CargoKind>, ok: (id: string) => boolean, order: readonly string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id) || learned.has(id)) return;
    seen.add(id);
    if (ok(id)) out.push(id);
    else for (const n of techOf(id)?.needs ?? []) walk(n);
  };
  const ids = [...order, ...TECHS.map((t) => t.id).filter((id) => !order.includes(id))];
  const lacking: CargoKind[] = [];
  for (const id of ids) {
    const t = techOf(id);
    if (!t || !built(t) || learned.has(id)) continue;
    for (const k of Object.keys(t.research.goods) as CargoKind[]) if (!made.has(k) && !lacking.includes(k)) lacking.push(k);
  }
  for (const k of lacking) for (const t of TECHS) if (built(t) && !learned.has(t.id) && goodsUnlocked(t.id).includes(k)) walk(t.id);
  return out;
}

/**
 * Main's figures before research (17dbc6f; main at 5add1ea gives the same), by seed: the minute of the first City (the
 * guard: never more than 20% later) and how many blueprints it researched by 180 (the floor; its other 13-15 came free
 * from growth, riders and landmarks, which research now earns). Other seeds: the lowest, 7.
 */
const MAIN_BY_SEED: Readonly<Record<number, { city: number; researched: number }>> = {
  2027: { city: 73, researched: 9 },
  1: { city: 112, researched: 9 },
  2: { city: 92, researched: 8 },
  3: { city: 110, researched: 11 },
  4: { city: 84, researched: 7 },
  5: { city: 87, researched: 8 },
};
/** The City's band on every seed (spec §5, the CoS's of 2026-10-20), in minutes. */
const CITY_BAND = [60, 90] as const;

/**
 * The research-stall guard's one exemption (spec §5): the plank famine of one goods train on a long line. A research
 * waiting on planks while the only goods train saws a few a pass on a line of this many stops or more (seed 2027's
 * Carpenter's bench, 22 stops) is the harness's one train, not the research's costs. Told by its cause, not its seed.
 */
const FAMINE_STOPS = 20;
/**
 * P5 (h), off unless asked for (BALANCE_SECOND_GOODS=15): a line of this many stops (there and back) or more gets a
 * passing loop and a second goods train once Signals are learned and its one goods train can't keep up with a good
 * (`goodsShort`), since one train brings only so much a pass round it. The loop's switches are left unpinned, so the sections count it as a passing place (pinned, with
 * BALANCE_LOOP_PIN=1, they don't, and the line deadlocks: spec §5 REPRO). Off by default (spec §5).
 */
const SECOND_GOODS_STOPS = Number(ENV.BALANCE_SECOND_GOODS ?? 0) || Infinity;
/**
 * With the second goods train on, the line is jammed (and it is picked up) when one of its goods trains has made no
 * progress (not moved, nor loaded at a stop, nor had its wait change) for this many minutes (BALANCE_JAM_MINUTES).
 */
const JAM_MINUTES = Number(ENV.BALANCE_JAM_MINUTES ?? 4);
/**
 * With the second goods train asked for, it goes on only once a good has been short this many minutes in a row while
 * its source's pile on the line is full (`goodsShort`: the one goods train can't keep up; BALANCE_SECOND_SATURATED).
 */
const SECOND_GOODS_SATURATED = Number(ENV.BALANCE_SECOND_SATURATED ?? 5);
/** The second goods train's cars, for what's short (flatbeds for planks, a hopper and a van for flour, a hopper for stone), up to 4. */
function secondGoodsCars(short: readonly CargoKind[]): CarKind[] {
  const each: Partial<Record<CargoKind, CarKind[]>> = { planks: ["timber", "timber"], flour: ["hopper", "van"], stone: ["hopper"] };
  const cars: CarKind[] = [];
  // (As many as a plain engine pulls, 4: the goods short in turn, so a lap brings more of each.)
  for (let k = 0; cars.length < 4 && k < 4; k++) for (const g of short) for (const c of each[g] ?? []) if (cars.length < 4) cars.push(c);
  return cars;
}
/** A town wanting planks that has had none for this many minutes is starved (see `Playthrough.shopThrough`). */
const STARVED = 15;
/** Planks in the workshop's yard that are plenty to build with: past this, a starved town's come first. */
const SHOP_FULL = 20;
/** Cars that carry goods: a train with one is a goods train (the passenger train has only coaches). */
const GOODS_CARS: ReadonlySet<CarKind> = new Set<CarKind>(["timber", "hopper", "van"]);

interface Row {
  minute: number;
  coins: number;
  planks: number;
  goals: number;
  blueprints: number;
  learned: string[];
  levels: number[];
  trains: number;
  riders: number;
}

class Player {
  w!: World;
  editor!: Editor;
  progress = Progress.fresh();
  crafting = new Crafting(this.progress);
  goals = new GoalTracker();
  town!: TownLife;
  counters = new Counters();
  tick = 0;
  readonly random = rng(Number(ENV.BALANCE_SEED ?? 2027));
  /**
   * The player's own pick among the cards that make sense (seeded per run, apart from the offers' draws).
   * BALANCE_CARD_SEED seeds it on its own, a robustness check: the same map and offers, another player's picks.
   */
  readonly picks = rng(ENV.BALANCE_CARD_SEED !== undefined ? Number(ENV.BALANCE_CARD_SEED) * 7919 + 1 : Number(ENV.BALANCE_SEED ?? 2027) * 7919 + 1);
  readonly people = new Map<number, number>();
  readonly lastDelivered = new Map<number, number>();
  fixed = new Set<number>();
  /** Done each second of play, as a player watching the trains does it (a spur's switch set by hand: `tendSpur`). */
  everySecond: (() => void) | null = null;
  /** The boats of the harbours (`HarbourTrade`), and what they took: loads and coins. */
  readonly harbours = new HarbourTrade();
  readonly boatTook = { loads: 0, coins: 0 };
  /** The minute a boat first took goods off a harbour's quay (−1: none yet). */
  boatFirst = -1;
  /** Stone trains unloaded into a workshop's yard (the crane's own events: no pile is written to by hand). */
  shopStoneIn = 0;
  readonly log: string[] = [];
  readonly rows: Row[] = [];
  readonly findings: string[] = [];
  /** What happened in the minute being played (for idle stretches). */
  happened = 0;
  /** Town growths, and how long each `TownLife.update` that grew one took (ms). */
  /** Train-seconds held at stops by auto-spacing. */
  heldSeconds = 0;
  /** Train-seconds held by sections (waiting for a section or slot; held for want of a loop: `roomSeconds`). */
  sectionSeconds = 0;
  /** Seconds each engine stood with a sections wait (for another train, at a slot's end). */
  readonly stoodWaiting = new Map<number, number>();
  roomSeconds = 0;
  /** Head-on meetings (a train held nose to nose by another, each meeting once), and arrivals of line trains at their stops. */
  headOn = 0;
  /** Of them, meetings of two trains of one line (each pair once). */
  headOnLine = 0;
  /** Stalls begun (economy/stalls.ts: a ring of waits, or a line's held train in the way), and train-seconds stuck. */
  stuckSeconds = 0;
  arrivals = 0;
  private readonly noseAt = new Map<number, number>();
  private readonly atStop = new Map<number, boolean>();
  private readonly lastAt = new Map<number, number>();
  /**
   * Each line train's last progress (`tick`): moving, at a stop with no section wait (loading), or its section wait
   * changed; and the wait it last had (JSON). A train with none for minutes is jammed (`Playthrough.decide`).
   */
  readonly progressAt = new Map<number, number>();
  readonly waitKey = new Map<number, string>();
  /** The longest (minutes) a train on a line went without being at a stop. */
  lineStall = 0;
  readonly growths: { minute: number; town: string; level: string; ms: number; built: number }[] = [];
  private growing: { town: string; level: string; built: number } | null = null;
  /** Each blueprint learned: when, how, and what it cost. */
  readonly learnedAt: { minute: number; id: string; how: string; price: string }[] = [];
  /** Coins and planks spent on what (for the report). */
  readonly spent = { blueprintsCoins: 0, blueprintsPlanks: 0, buildCoins: 0, buildPlanks: 0 };

  constructor(w: World) {
    this.attach(w);
  }

  attach(w: World): void {
    this.w = w;
    this.fixed = fixedPieces(w);
    this.editor = new Editor(w.layout, w.sim, () => {}, (id) => this.fixed.has(id));
    const host: TownLifeHost = Object.assign(w, { footprintOf: (asset: string) => footprintOf(asset), editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
    this.town = new TownLife(host, {
      knows: (id) => this.progress.learned.has(id),
      school: (kind) => researchLacking(this.progress, kind) > 0,
      received: (t, kind, n, before) => {
        this.lastDelivered.set(t.id, this.tick);
        payDelivery(this.progress, kind, n, before, t);
      },
      grew: (t, status, built) => {
        this.happened++;
        const before = new Set(this.progress.landmarks);
        this.syncLandmarks();
        const raised = [...this.progress.landmarks].filter((id) => !before.has(id));
        this.note(`${t.name} grew into a ${status.name.toLowerCase()} (+${built.length} buildings${raised.length ? `; new ${raised.join(", ")}` : ""}; ${townLandmarks(t).size} landmarks)`);
        if (built.length === 0) this.findings.push(`${t.name} grew to ${status.name} with no room to build (minute ${this.minute.toFixed(1)}).`);
        const gift = firstTimeGift(this.progress, status.level);
        if (gift.length > 0) this.note(`  present: ${gift.map(([id, n]) => `${n} ${ruleOf(id)!.label}`).join(", ")}`);
        const offer = offerOnGrowth(this.progress, this.w, t.name, status.level, this.random);
        this.note(`  offers ${offer ? offer.cards.map((c) => cardView(this.progress, this.w, c).amount).join(" or ") : "nothing"}`);
        this.growing = { town: t.name, level: status.name, built: built.length };
      },
    });
    this.town.reset();
    this.syncLandmarks();
    this.counters.reset(w.economy);
    applyCranes(w.economy, this.progress);
    // BALANCE_SECTIONS=off: trains of a line don't wait for each other (main as it was, for comparison).
    w.economy.sections.enabled = ENV.BALANCE_SECTIONS !== "off";
    w.economy.sections.timing = !!ENV.BALANCE_TIMING;
    attachEngines(w);
    attachPassengers(w, () => this.progress, () => {});
    w.economy.reserved = (kind) => kind === "planks" && this.planksKept;
    w.economy.shopKeeps = YARD_SPARE < 0 ? null : (kind) => (kind === "planks" ? yardKeeps(this.progress, this.yardSpare) : null);
    // Stone into the workshop only while a harbour's price needs it there (as the game does).
    w.economy.owes = (kind) => shopOwes(w, this.progress, kind);
    // Goods into a school go into the research (as the game does).
    attachResearch(w.economy, () => this.progress, () => (this.researchFed = this.tick));
    this.progress.coverMap(w);
  }

  /** When goods last went into the research, or a research started (ticks); the longest wait for goods (s). */
  researchFed = 0;
  researchStall = 0;
  /** The research the longest wait was on, and when it began. */
  researchStallOn = "-";
  /** At the longest wait's end: goods trains on the map, the most stops on a line, and whether the research lacked planks. */
  researchStallCause = { goodsTrains: 0, stops: 0, planks: false };
  /** Growth cards taken, by kind. */
  readonly cardsTaken: Record<string, number> = {};
  /** Researches finished, by minute. */
  readonly researchedAt: number[] = [];

  get minute(): number {
    return minutes(this.tick);
  }

  note(s: string): void {
    this.log.push(`${this.minute.toFixed(1).padStart(6)} min  ${s}`);
  }

  /** A boat took `goods` off a harbour's quay and paid `coins` (the progress has them already). */
  boatSold(goods: Bag, coins: number): void {
    if (this.boatFirst < 0) this.boatFirst = +this.minute.toFixed(1);
    this.boatTook.loads += total(goods);
    this.boatTook.coins += coins;
    this.happened++;
    this.note(`a boat took ${describeGoods(goods)}: +${coins} coins`);
  }

  learned(id: string, how: string, price: string): void {
    this.happened++;
    this.learnedAt.push({ minute: +this.minute.toFixed(1), id, how, price });
    this.note(`BLUEPRINT ${techOf(id)!.label} (${how}${price ? `, ${price}` : ""})`);
    // (As the game does: Signals bring a second engine.)
    for (const [thing, n] of learnGift(this.progress, id)) this.note(`present: ${n} ${thing}`);
    applyCranes(this.w.economy, this.progress);
    // (College: the schools in towns study twice as fast.)
    this.syncLandmarks();
  }

  /** What the map gives research (as the game does): a school beside a city for tier 3, and the schools' speed. */
  syncLandmarks(): void {
    this.progress.landmarks.clear();
    for (const id of landmarksAt(this.w)) this.progress.landmarks.add(id);
    setSpeed(this.progress, researchSpeed(this.w, this.progress.learned));
  }

  /** The workshop keeps planks only for a tray order waiting to be made (as the game does: never for blueprints). */
  planksKept = false;
  /** Planks the yard keeps with no order while a town ahead wants them (as the game works it out once a second: `shopSpare`). */
  yardSpare = YARD_SPARE;
  /** Was stone owed at the workshop at the last look (routed lines plan again when it changes, as the game's do). */
  owing = false;
  updatePlanksKept(): void {
    if (GREEDY_WORKSHOP) for (const d of workshops(this.w)) d.takesAll = true;
    const owing = shopOwing(this.w, this.progress);
    if (owing !== this.owing) {
      this.owing = owing;
      this.w.economy.acceptsChanged();
    }
    if (workshops(this.w).length === 0) {
      this.planksKept = false;
      return;
    }
    this.planksKept = keepsForOrder(this.progress, workshopStock(this.w).planks ?? 0);
    this.yardSpare = SPARE_COVERS ? shopSpare(this.progress, this.w, this.goals.current()?.id ?? null, YARD_SPARE).planks : YARD_SPARE;
  }

  /** The research's clock (a second of play), as the game's workshop clock runs it; counts its waits for goods. */
  research(): void {
    const s = this.progress;
    const was = s.research.current;
    const coins = s.coins;
    const done = researchTick(s, 1);
    this.spent.blueprintsCoins += coins - s.coins;
    if (done) {
      this.researchedAt.push(+this.minute.toFixed(1));
      this.learned(done, "researched", describeGoods(researchCost(done).goods));
    }
    if (s.research.current !== was) {
      this.w.economy.acceptsChanged();
      this.researchFed = this.tick;
    }
    // A wait for goods: something picked, its goods not all in, and none coming into a school.
    if (s.research.current !== null && !studying(s)) {
      const wait = (this.tick - this.researchFed) / SIM_HZ;
      if (wait > this.researchStall) {
        this.researchStall = wait;
        this.researchStallOn = `${s.research.current} (from ${minutes(this.researchFed).toFixed(1)})`;
        // (Only as the longest grows: a look over the trains and lines, not every second.)
        this.researchStallCause = { goodsTrains: this.goodsTrains(), stops: Math.max(0, ...[...this.w.economy.lines.values()].map((l) => l.stops.length)), planks: researchLacking(s, "planks") > 0 };
      }
    } else this.researchFed = this.tick;
  }

  /** Trains on the map with a goods car (a timber wagon, a hopper, a van). */
  goodsTrains(): number {
    let n = 0;
    for (const id of this.w.sim.trainIds()) if (this.w.sim.getTrain(id)?.cars.some((c) => GOODS_CARS.has(c.kind))) n++;
    return n;
  }

  /** Is the longest research stall the one-goods-train plank famine on a long line (`FAMINE_STOPS`)? */
  plankFamine(): boolean {
    const c = this.researchStallCause;
    return c.goodsTrains === 1 && c.stops >= FAMINE_STOPS && c.planks;
  }

  /** Seconds planks were kept for the workshop; the longest stretch (s) with no planks into any town, after the first. */
  keptSeconds = 0;
  townGap = 0;
  private toTowns = 0;
  private toTownsAt = 0;
  private townsFed(): void {
    let n = 0;
    for (const v of this.w.economy.delivered.values()) n += v;
    if (n !== this.toTowns) {
      this.toTowns = n;
      this.toTownsAt = this.tick;
    } else if (n > 0) this.townGap = Math.max(this.townGap, (this.tick - this.toTownsAt) / SIM_HZ);
  }

  level(i: number): number {
    return this.town.status(this.w.landscape.towns[i].id).level;
  }

  bestLevel(): number {
    return Math.max(...this.w.landscape.towns.map((t) => this.town.status(t.id).level));
  }

  planks(): number {
    return workshopStock(this.w).planks ?? 0;
  }

  /**
   * Sections trace (BALANCE_XTRACE=from-to, minutes): each line train's pieces (and switch states), speed, drive, route,
   * slot or section, move and wait every game second. For root-causing jams; off by default.
   */
  xtrace(): void {
    const [from, to] = ENV.BALANCE_XTRACE!.split("-").map(Number);
    if (this.minute < from || this.minute > to) return;
    const ec = this.w.economy;
    for (const engine of ec.lineIdOf.keys()) {
      const f = this.w.sim.findCar(engine);
      if (!f) continue;
      const t = f.train;
      const r = ec.routeOf(engine);
      const L = this.w.layout;
      const sw = (id: number) => (L.getPiece(id) && getPieceDef(L.getPiece(id)!.type, L.getPiece(id)!.flipped).isSwitch ? `/${L.switchState(id)}` : "");
      const pcs = [...new Set(t.bogies.map((b) => `${b.pieceId}${sw(b.pieceId)}`))].join(",");
      this.note(`X e${engine} t${t.id} [${pcs}] v${t.speed.toFixed(0)} ${r ? `${r.at ? "AT" : "->"}${r.next}` : ""} ${JSON.stringify(ec.sections.stateOf(engine))} ${JSON.stringify(ec.sectionWait(engine))}${t.lastTurn ? ` turn ${t.lastTurn.cause}@${t.lastTurn.tick}` : ""}`);
    }
  }

  /** Play `secs` seconds: the sim and economy each tick; what the game does each second (towns, workshop, schools, people, goals). */
  run(secs: number): void {
    const end = this.tick + secs * SIM_HZ;
    while (this.tick < end) {
      this.w.sim.tick();
      this.w.economy.tick();
      this.tick++;
      if (this.tick % SIM_HZ !== 0) continue;
      this.updatePlanksKept();
      if (ENV.BALANCE_CARGO) this.cargoTrace();
      if (this.planksKept) this.keptSeconds++;
      this.townsFed();
      const t0 = performance.now();
      this.town.update();
      if (this.growing) {
        this.growths.push({ minute: +this.minute.toFixed(1), ...this.growing, ms: +(performance.now() - t0).toFixed(1) });
        this.growing = null;
      }
      const coins = this.progress.coins;
      const made = this.crafting.tick(this.w, 1);
      this.spent.buildCoins += coins - this.progress.coins;
      this.research();
      this.everySecond?.();
      // (Boats call at the harbours by themselves, as the game's clock has them: once a second of play.)
      for (const e of this.harbours.update(this.w, this.progress, 1)) if (e.kind === "sold") this.boatSold(e.goods, e.coins);
      if (made) this.note(`workshop made a ${ruleOf(made)!.label.toLowerCase()}`);
      // (What the cranes did this second: stone off a train into the workshop's yard, for a harbour's price.)
      for (const e of this.w.economy.drainEvents()) if (e.kind === "unloaded" && e.cargo === "stone" && this.w.economy.depot(e.depotId)?.role === "workshop") this.shopStoneIn++;
      this.counters.collect(this.w.economy, this.progress);
      peopleArrive(this.w, this.progress, 1, this.people);
      for (const engine of this.w.economy.lineIdOf.keys()) if (this.w.economy.spacing.holding(engine)) this.heldSeconds++;
      if (ENV.BALANCE_XTRACE) this.xtrace();
      for (const engine of this.w.economy.lineIdOf.keys()) {
        const sw = this.w.economy.sectionWait(engine);
        if (sw) this.sectionSeconds++;
        if (sw && (this.w.sim.findCar(engine)?.train.speed ?? 0) < 1) this.stoodWaiting.set(engine, (this.stoodWaiting.get(engine) ?? 0) + 1);
        if (sw?.kind === "room") this.roomSeconds++;
        const at = !!this.w.economy.routeOf(engine)?.at;
        const key = JSON.stringify(sw);
        if ((this.w.sim.findCar(engine)?.train.speed ?? 0) > 1 || (at && !sw) || key !== this.waitKey.get(engine) || !this.progressAt.has(engine)) this.progressAt.set(engine, this.tick);
        this.waitKey.set(engine, key);
        if (at && this.atStop.get(engine) === false) this.arrivals++;
        this.atStop.set(engine, at);
        // (The longest any train on a line went without coming to a stop: a lock-up shows here.)
        if (!this.w.sim.findCar(engine) || !this.w.economy.routeOf(engine)) {
          this.lastAt.delete(engine);
          continue;
        }
        if (at || !this.lastAt.has(engine)) this.lastAt.set(engine, this.tick);
        this.lineStall = Math.max(this.lineStall, (this.tick - this.lastAt.get(engine)!) / SIM_HZ / 60);
      }
      for (const id of this.w.sim.trainIds()) {
        const t = this.w.sim.getTrain(id)!;
        // (Met head on: held nose to nose by another train, from this second on; counted once a meeting.)
        const by = this.w.sim.heldHow(id) === "nose" ? this.w.sim.heldBy(id) : null;
        const was = this.noseAt.get(id);
        if (by !== null) this.noseAt.set(id, this.tick);
        if (by === null || (was !== undefined && this.tick - was <= SIM_HZ)) continue;
        this.headOn++;
        // (Two trains of one line meeting: each pair once.)
        const mine = t.cars.find((c) => this.w.economy.lineIdOf.has(c.id));
        const other = this.w.sim.getTrain(by)?.cars.find((c) => this.w.economy.lineIdOf.has(c.id));
        if (mine && other && this.w.economy.lineIdOf.get(mine.id) === this.w.economy.lineIdOf.get(other.id) && id < by) this.headOnLine++;
        if (ENV.BALANCE_HEADON) this.note(`head-on: engine ${t.cars.find((c) => c.kind === "engine")?.id} on ${this.w.layout.getPiece(t.bogies[0].pieceId)?.type} (piece ${t.bogies[0].pieceId})`);
      }
      this.stuckSeconds += this.w.economy.stalls.count;
      for (const g of this.goals.update(this.w, { learned: this.progress.learned, owned: this.progress.owned, orders: this.progress.orders })) {
        this.happened++;
        this.note(`GOAL ${this.goals.doneCount}/${GOALS.length} ✓ ${g.title}`);
      }
      if (this.tick % (SIM_HZ * 30) === 0) updateRates(this.w, (role) => boostOf(this.progress, role));
    }
  }

  /**
   * BALANCE_CARGO=a-b (minutes): each second from a to b, a log line (`C`) for every train whose cars' loads or the
   * depots under it changed: its cars and loads, the depots under it with their piles, its next stop, its speed. What
   * showed the hoppers full of grain at the quarry (spec §5, P5's fourth pass).
   */
  cargoTrace(): void {
    const [from, to] = ENV.BALANCE_CARGO!.split("-").map(Number);
    if (this.minute < from || this.minute > to) return;
    const e = this.w.economy;
    for (const id of this.w.sim.trainIds()) {
      const t = this.w.sim.getTrain(id)!;
      const engine = t.cars.find((c) => c.kind === "engine");
      const r = engine && e.routeOf(engine.id);
      const under = [...new Set(t.bogies.map((b) => e.depotAtPiece(b.pieceId)).filter((d) => !!d))];
      const loads = t.cars
        .map((c) => {
          const g = e.cargoOf(c.id);
          return `${c.kind}${g.kind ? `:${g.count}${g.kind}` : ""}`;
        })
        .join(",");
      const key = `${under.map((d) => d!.id).join("+")}|${loads}`;
      if (this.traced.get(id) === key) continue;
      this.traced.set(id, key);
      const piles = under.map((d) => `${d!.role}#${d!.id}[${Object.entries(CARGO).filter(([, c]) => d!.piles[c.index] > 0).map(([k, c]) => `${d!.piles[c.index]}${k}`).join(" ")}]`);
      this.note(`  C ${loads} @ ${piles.join(" ") || "-"} next ${r ? `${r.next}:${e.depot(r.stops[r.next].depotId)?.role}` : "-"} v${Math.round(t.speed)}`);
    }
  }
  private readonly traced = new Map<number, string>();

  /** Where each train is and what it carries, and the depots' piles (for the log). */
  trains(): void {
    for (const id of this.w.sim.trainIds()) {
      const t = this.w.sim.getTrain(id)!;
      const engine = t.cars.find((c) => c.kind === "engine");
      const r = engine && this.w.economy.routeOf(engine.id);
      const loads = t.cars.map((c) => {
        const g = this.w.economy.cargoOf(c.id);
        const people = c.kind === "passenger" ? this.w.economy.ridersOf(c.id).count : 0;
        return `${c.kind}${g.kind ? `:${g.count} ${g.kind}` : ""}${people ? `:${people} people` : ""}`;
      });
      const on = this.w.layout.getPiece(t.bogies[0].pieceId)?.type;
      this.note(`  train ${id}: ${loads.join(", ")}; speed ${Math.round(t.speed)}${t.derailed ? " DERAILED" : ""}; on ${on}${r ? `; route next ${r.next} (${this.w.economy.depot(r.stops[r.next].depotId)?.role})` : ""}`);
    }
    const piles = this.w.economy
      .allDepots()
      .filter((d) => this.w.layout.getPiece(d.pieceId) && d.role !== "town")
      .map((d) => `${d.role} ${describeGoods(Object.fromEntries(Object.entries(CARGO).map(([k, c]) => [k, d.piles[c.index]]).filter(([, n]) => (n as number) > 0)))}`);
    this.note(`  piles: ${piles.join("; ")}`);
  }

  // --- the toy box, as the tray does it ---

  /** Things on the map beyond what's owned: made now from the workshop's yard (as the tray makes them as they go down). */
  settle(): boolean {
    const lack = new Map<ThingId, number>();
    for (const id of Object.keys(THING_RULES) as ThingId[]) {
      if (isFree(id)) continue;
      const n = inUse(this.w, id) - (this.progress.owned.get(id) ?? 0);
      if (n > 0) lack.set(id, n);
    }
    if (lack.size === 0) return true;
    const before = { coins: this.progress.coins, planks: this.planks() };
    const why = craftNow(this.w, this.progress, lack);
    if (why) {
      this.findings.push(`OVERDRAWN at ${this.minute.toFixed(1)}: ${[...lack].map(([id, n]) => `${n} ${id}`).join(", ")}`);
      for (const [id, n] of lack) this.progress.add(id, n);
      return false;
    }
    this.spent.buildCoins += before.coins - this.progress.coins;
    this.spent.buildPlanks += before.planks - this.planks();
    return true;
  }

  /** Make whatever of `needs` isn't in the toy box, from the workshop (null) or why not. */
  make(needs: Map<ThingId, number>): string | null {
    for (const id of needs.keys()) if (!this.progress.knows(id)) return `${ruleOf(id)?.label ?? id} not learned`;
    const lack = lacking(this.w, this.progress, needs);
    if (lack.size === 0) return null;
    const before = { coins: this.progress.coins, planks: this.planks() };
    const why = craftNow(this.w, this.progress, lack);
    if (why === "no-workshop") return "no workshop";
    if (why) return `needs ${describeGoods(why.goods)}${why.coins ? ` + ${why.coins} coins` : ""}`;
    this.spent.buildCoins += before.coins - this.progress.coins;
    this.spent.buildPlanks += before.planks - this.planks();
    return null;
  }

  canMake(needs: Map<ThingId, number>): boolean {
    for (const id of needs.keys()) if (!this.progress.knows(id)) return false;
    const lack = lacking(this.w, this.progress, needs);
    return lack.size === 0 || craftShort(this.w, this.progress, lack) === null;
  }

  /** The placement rules, with the toy box: an unlearned piece is refused; a paid one only if the workshop could make it. */
  rules(): Blocked {
    const rules = rulesFor(this.w);
    return (type, flipped, pose, y, ignoreId) => {
      const id = pieceThing(type);
      if (!this.progress.knows(id)) return "toy box";
      if (!isFree(id)) {
        const lack = new Map<ThingId, number>();
        for (const t of PAID_TRACK) {
          const tid = pieceThing(t);
          const n = inUse(this.w, tid) - (this.progress.owned.get(tid) ?? 0);
          if (n > 0) lack.set(tid, n);
        }
        if (lack.size > 0 && craftShort(this.w, this.progress, lack) !== null) return "toy box";
      }
      return rules(type, flipped, pose, y, ignoreId);
    };
  }

  /** A train out of the box onto piece `pieceId` and set going; its engine's id, or why not. */
  train(cars: CarKind[], pieceId: number, lever: 1 | -1 = 1): number | string {
    const why = this.make(thingsFor({ kind: "train", cars }));
    if (why) return why;
    // On that piece, else on any free long straight of the player's (a long train needs room).
    const others = [...this.w.layout.pieceIds()].filter((id) => id !== pieceId && !this.fixed.has(id) && this.w.layout.getPiece(id)!.type === "straight-216" && !this.w.sim.pieceOccupied(id));
    for (const on of [...(this.w.layout.getPiece(pieceId) ? [pieceId] : []), ...others])
      for (const s of [100, 60, 140, 30]) {
        const r = this.w.sim.addTrain(cars, { pieceId: on, pathIndex: 0, reversed: false, s });
        if (r.kind !== "placed") continue;
        const engine = this.w.sim.getTrain(r.trainId)!.cars.find((c) => c.kind === "engine")!;
        this.w.sim.setLever(engine.id, lever);
        this.happened++;
        return engine.id;
      }
    return "no room on the track";
  }

  lift(engine: number): void {
    const found = this.w.sim.findCar(engine);
    if (found) this.w.sim.removeTrain(found.train.id);
    // (As the game's Remove does: the engine off its line, so `lineIdOf` keeps no train that's gone.)
    this.w.economy.prune();
  }
}

// --- laying track (from the tours) ---

function* sitesNear(P: Player, type: PieceTypeId, cells: number[], after?: PieceTypeId): Generator<{ pose: Pose; y: number }> {
  const w = P.w;
  const g = w.landscape.grid;
  const rules = rulesFor(w);
  for (const f of cells) {
    for (let dc = -5; dc <= 5; dc++) {
      for (let dr = -5; dr <= 5; dr++) {
        for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const x = g.centreX(g.colOf(f) + dc);
          const z = g.centreZ(g.rowOf(f) + dr);
          const cell = g.cellAtWorld(x, z);
          if (cell === -1) continue;
          const pose = { x: x - Math.cos(heading) * 108, z: z - Math.sin(heading) * 108, heading };
          const y = g.groundY(cell);
          if (siteWhy(w.landscape, type, pose) || rules(type, false, pose, y, -1)) continue;
          if (after) {
            const id = w.layout.addPiece(type, pose, y);
            const end = w.layout.worldConnector(connectorRef(id, 1), peg);
            const via = getPieceDef(after, false).connectors.findIndex((c) => c.kind !== end.kind);
            const next = appendPiece(w.layout, after, false, connectorRef(id, 1), via);
            const p = w.layout.getPiece(next)!;
            const ok = !rules(after, false, p.pose, p.y, next) && !siteWhy(w.landscape, after, p.pose);
            w.layout.removePiece(next);
            w.layout.removePiece(id);
            if (!ok) continue;
          }
          yield { pose, y };
        }
      }
    }
  }
}

function placeOn(P: Player, ref: number, type: PieceTypeId): number {
  const end = P.w.layout.worldConnector(ref, peg);
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  const tmp = appendPiece(P.w.layout, type, false, ref, via);
  const p = P.w.layout.getPiece(tmp)!;
  P.w.layout.removePiece(tmp);
  return P.editor.place(type, p.pose, p.y, false);
}

/** A passing loop's main road (switch to switch, mm): room for a long goods train, and not much more. */
const LOOP_MIN = 520;
const LOOP_MAX = 1600;
/**
 * The longest goods train a line runs: a goods engine and the 8 cars it pulls (the longest car, a coach). The second
 * goods train's loop is laid with room for it, so the goods train made up later still passes there (P5 (h): a loop
 * for a plain engine's 4 cars no longer counts for the line once the goods train has 8, and the line has no room).
 */
const LONGEST_GOODS = CAR_SPECS.engine.length + 8 * CAR_SPECS.passenger.length + 8 * COUPLER_GAP;
/** The people train (an engine, two coaches): the passing loop laid for it holds it. */
const LONGEST_PEOPLE = CAR_SPECS.engine.length + 2 * CAR_SPECS.passenger.length + 2 * COUPLER_GAP;

/**
 * A passing loop on the line (P5 (h)), as a player lays one for two trains on a line: two straights of the line a
 * train's length or more apart, with no stop, switch or crossing between them, each made a switch (and a short
 * straight: a straight's length in all), and a side road laid from one switch's branch to the other's. The line between
 * them is the main road. The switch at the end trains running down the line come in by (from piece `a`'s side) is
 * pinned to the main road and the other to the side road, so trains running down the line keep to the main road and
 * trains running back to the side road (a switch run through from a branch is passed whichever way it's set), and they
 * pass there. The switches' ids, or null if no two straights take one (the pieces as they were). Straights nearest
 * `near` are tried first.
 */
function passingLoop(P: Player, near: { x: number; z: number }, room = 0, stopPieces: readonly number[] = []): [number, number] | null {
  const w = P.w;
  const L = w.layout;
  const plain = (id: number) => {
    const p = L.getPiece(id);
    return !!p && p.type === "straight-216" && !P.fixed.has(id) && !w.sim.pieceOccupied(id);
  };
  const len = (id: number) => {
    const p = L.getPiece(id)!;
    return pathLength(getPieceDef(p.type, p.flipped).paths[0].geom);
  };
  // Pairs of straights: from `a`, out of its peg end (connector 1) along plain two-ended track (no stop: a stop on the
  // main road would be out of reach of trains on the side road) to a straight `b` entered by its hole end.
  const pairs: { a: number; b: number; d: number }[] = [];
  for (const a of L.pieceIds()) {
    if (!plain(a) || L.joinedConnector(connectorRef(a, 0)) === -1) continue;
    let ref = connectorRef(a, 1);
    let d = 0;
    for (let k = 0; k < 12 && d < LOOP_MAX; k++) {
      const j = L.joinedConnector(ref);
      if (j === -1) break;
      const id = pieceOfRef(j);
      const p = L.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      if (def.connectors.length !== 2 || w.economy.depotAtPiece(id) || w.stations.size === 0 || [...w.stations.values()].includes(id) || p.type.startsWith("kit-")) break;
      if (d >= Math.max(LOOP_MIN, room) - 216 && plain(id) && indexOfRef(j) === 0 && L.joinedConnector(connectorRef(id, 1)) !== -1) pairs.push({ a, b: id, d });
      d += len(id);
      ref = connectorRef(id, 1 - indexOfRef(j));
    }
  }
  const at = (id: number) => L.getPiece(id)!.pose;
  const far = (q: { a: number; b: number }) => Math.hypot((at(q.a).x + at(q.b).x) / 2 - near.x, (at(q.a).z + at(q.b).z) / 2 - near.z);
  pairs.sort((x, y) => far(x) - far(y));
  if (ENV.BALANCE_LOOP_TRACE) P.note(`loop pairs: ${pairs.length}`);
  /** The track as it is (each piece's type, pose and height, by id): a failed try must leave it just so. */
  const snapshot = () => [...L.pieceIds()].sort((x, y) => x - y).map((id) => {
    const q = L.getPiece(id)!;
    return `${id}:${q.type}:${q.flipped}:${q.pose.x.toFixed(3)},${q.pose.z.toFixed(3)},${q.pose.heading.toFixed(5)},${q.y.toFixed(3)}`;
  }).join(" ");
  for (const pair of pairs.slice(0, 10)) {
    const { a, b } = pair;
    for (const side of [false, true]) {
      // (`b`'s neighbour beyond is taken up while the side road is laid, and put back after: the track layer joins a
      // piece with no other joints.)
      const nj = L.getPiece(a) && L.getPiece(b) ? L.joinedConnector(connectorRef(b, 1)) : -1;
      const nb = nj === -1 ? -1 : pieceOfRef(nj);
      const pn = nb === -1 ? undefined : L.getPiece(nb);
      if (!pn || getPieceDef(pn.type, pn.flipped).connectors.length !== 2 || w.economy.depotAtPiece(nb) || [...w.stations.values()].includes(nb) || pn.type.startsWith("kit-") || w.sim.pieceOccupied(nb) || P.fixed.has(nb)) break;
      const pa = L.getPiece(a)!;
      const pb = L.getPiece(b)!;
      const [poseA, yA, poseB, yB] = [{ ...pa.pose }, pa.y, { ...pb.pose }, pb.y];
      const nbWas = { type: pn.type, pose: { ...pn.pose }, y: pn.y, flipped: pn.flipped };
      const before = snapshot();
      // The try is one edit (the editor's group), so a failed one is undone as one: every piece back as it was, under
      // its own id. (Put back piece by piece, each was shifted to take up the play left by the ones not yet back, and
      // the line could come back open: a lone goods train then turned back at the gap for good, seeds 1, 2 and 10.)
      let sa = -1;
      let sb = -1;
      let ok = false;
      const edited = P.editor.group(() => {
        P.editor.remove(a);
        P.editor.remove(b);
        P.editor.remove(nb);
        // `a`'s switch: its trunk where `a`'s hole end was. `b`'s: its trunk where `b`'s peg end was, facing back.
        sa = P.editor.place("switch", poseA, yA, side);
        placeOn(P, connectorRef(sa, 1), "straight-72");
        const endB = { x: poseB.x + Math.cos(poseB.heading) * 216, z: poseB.z + Math.sin(poseB.heading) * 216, heading: poseB.heading + Math.PI };
        sb = P.editor.place("switch", endB, yB, !side);
        const r = play(L, P.editor, connectorRef(sa, 2), connectorRef(sb, 2), { blocked: P.rules(), maxPieces: 24, fiddle: 3 });
        const road = r.ok && L.joinedConnector(connectorRef(sb, 2)) !== -1;
        if (road) {
          placeOn(P, connectorRef(sb, 1), "straight-72");
          P.editor.place(nbWas.type, nbWas.pose, nbWas.y, nbWas.flipped);
        }
        const joined = [0, 1, 2].every((c) => L.joinedConnector(connectorRef(sa, c)) !== -1 && L.joinedConnector(connectorRef(sb, c)) !== -1);
        if (ENV.BALANCE_LOOP_TRACE) P.note(`loop try ${a}→${b} ${side ? "right" : "left"}: side road ${r.how} (${r.pieces} pieces), all joined ${joined}`);
        // (With `room`: the sections count it as a passing place for a train that long, both roads long enough.)
        const fits = room === 0 || topologyOf(L, room).loops.some((l) => (l.a === sa && l.b === sb) || (l.a === sb && l.b === sa));
        // (And every way between the line's stops still joined.)
        const whole = lineLegs(L, stopPieces).every((leg) => leg !== null);
        ok = road && joined && fits && whole;
      });
      if (ok && P.settle()) {
        // (Unpinned, the sections count it as a passing place; BALANCE_LOOP_PIN=1 pins its switches one way each, as
        // first laid: a repro of the line deadlock, spec §5 REPRO.)
        L.setSwitchState(sa, 0);
        if (ENV.BALANCE_LOOP_PIN) L.setPinned(sa, true);
        L.setSwitchState(sb, 1);
        if (ENV.BALANCE_LOOP_PIN) L.setPinned(sb, true);
        w.sim.trackChanged();
        return [sa, sb];
      }
      // Back as it was, as one edit; and it must be: the track just as before, the line closed.
      const undone = !edited || P.editor.undo();
      expect(undone, "a failed passing loop try is undone").toBe(true);
      expect(snapshot() === before, "a failed passing loop try leaves the track as it was").toBe(true);
      expect(lineLegs(L, stopPieces).every((leg) => leg !== null), "a failed passing loop try leaves the line closed").toBe(true);
    }
  }
  return null;
}

function freeEnd(P: Player, id: number): number {
  const p = P.w.layout.getPiece(id)!;
  const n = getPieceDef(p.type, p.flipped).connectors.length;
  for (let c = 0; c < n; c++) if (P.w.layout.joinedConnector(connectorRef(id, c)) === -1) return connectorRef(id, c);
  return -1;
}

/** The line's ends: each turnback, and the free end it stands on. */
function lineEnds(P: Player): { buffer: number; ref: number }[] {
  const out: { buffer: number; ref: number }[] = [];
  for (const id of P.w.layout.pieceIds()) {
    if (P.w.layout.getPiece(id)!.type !== "buffer-turnback") continue;
    const ref = P.w.layout.joinedConnector(connectorRef(id, 0));
    if (ref !== -1) out.push({ buffer: id, ref });
  }
  return out;
}

/**
 * The track's open ends on the line (a connector joined to nothing on a piece of the railway): as `lineEnds`, with no
 * buffer (`buffer` −1) and `ref` the piece's own end, so a walk from `ref`'s piece starts there.
 */
function openEnds(P: Player): { buffer: number; ref: number }[] {
  const out: { buffer: number; ref: number }[] = [];
  const L = P.w.layout;
  const station = st(P, 0);
  for (const id of L.pieceIds()) {
    const p = L.getPiece(id)!;
    const def = getPieceDef(p.type, p.flipped);
    for (let c = 0; c < def.connectors.length; c++) if (L.joinedConnector(connectorRef(id, c)) === -1) out.push({ buffer: -1, ref: connectorRef(id, c) });
  }
  // (The railway's own: joined to Larkfield's station.)
  const reach = new Set<number>();
  const stack = [station];
  while (stack.length > 0) {
    const at = stack.pop()!;
    if (reach.has(at)) continue;
    reach.add(at);
    const p = L.getPiece(at)!;
    for (let c = 0; c < getPieceDef(p.type, p.flipped).connectors.length; c++) {
      const j = L.joinedConnector(connectorRef(at, c));
      if (j !== -1) stack.push(pieceOfRef(j));
    }
  }
  return out.filter((e) => reach.has(pieceOfRef(e.ref)));
}

/** Is a line end (a buffer, or track that stops) within `n` pieces of piece `id`, either way? */
function nearEnd(P: Player, id: number, n: number): boolean {
  for (let c = 0; c < 2; c++) {
    let at = id;
    let exit = c;
    for (let k = 0; k < n; k++) {
      const j = P.w.layout.joinedConnector(connectorRef(at, exit));
      if (j === -1) return true;
      at = pieceOfRef(j);
      const p = P.w.layout.getPiece(at)!;
      const ends = getPieceDef(p.type, p.flipped).connectors.length;
      if (ends === 1) return true;
      if (ends !== 2) break;
      exit = 1 - indexOfRef(j);
    }
  }
  return false;
}

/**
 * An industry on a new branch (from the grand tour): a straight of the line becomes a switch (made at the workshop)
 * and a short straight, and track runs from the switch to a site for `type` near `cells` (with room for `after`). The
 * industry's piece must be in the box. Its piece and its free end, or null with everything put back.
 */
function branchOff(P: Player, type: PieceTypeId, cells: number[], after?: PieceTypeId): { id: number; beyond: number } | null {
  const w = P.w;
  const g = w.landscape.grid;
  if (!P.canMake(new Map([["piece:switch", 1]]))) return null;
  const line = [...w.layout.pieceIds()].filter((id) => !P.fixed.has(id) && w.layout.getPiece(id)!.type === "straight-216" && !nearEnd(P, id, 4));
  let tries = 0;
  for (const s of line) {
    if (++tries > 12) break;
    const p = w.layout.getPiece(s)!;
    const ends = [0, 1].map((c) => w.layout.joinedConnector(connectorRef(s, c)));
    if (ends.some((e) => e === -1) || w.sim.pieceOccupied(s)) continue;
    let straight = s;
    for (const flipped of [false, true]) {
      P.editor.remove(straight);
      const sw = P.editor.place("switch", p.pose, p.y, flipped);
      const short = placeOn(P, connectorRef(sw, 1), "straight-72");
      const joined = w.layout.joinedConnector(connectorRef(sw, 0)) !== -1 && freeEnd(P, short) === -1;
      if (joined) {
        const at = w.layout.worldConnector(connectorRef(sw, 2), peg);
        const near = cells.filter((i) => Math.hypot(g.centreX(g.colOf(i)) - at.x, g.centreZ(g.rowOf(i)) - at.z) < 1200);
        let n = 0;
        for (const site of sitesNear(P, type, near.filter((_, k) => k % 2 === 0).slice(0, 40), after)) {
          if (++n > 20) break;
          const q = P.editor.place(type, site.pose, site.y, false);
          const had = new Set(w.layout.pieceIds());
          for (const c of [1, 0]) {
            const r = play(w.layout, P.editor, connectorRef(sw, 2), connectorRef(q, c), { blocked: P.rules(), maxPieces: 60, fiddle: 3 });
            if (r.ok && P.settle()) return { id: q, beyond: connectorRef(q, 1 - c) };
            for (const id of [...w.layout.pieceIds()]) if (!had.has(id)) P.editor.remove(id);
          }
          P.editor.remove(q);
        }
      }
      P.editor.remove(short);
      P.editor.remove(sw);
      straight = P.editor.place("straight-216", p.pose, p.y, false);
    }
  }
  return null;
}

/** The most pieces a spur to an old industry's stub may take: a short one, as a player lays to a ruin by the line. */
const SPUR_PIECES = Number(ENV.BALANCE_SPUR_PIECES ?? 24);

/**
 * A short spur from the line to a free end (an old industry's stub): a straight of the line, nearest the stub first,
 * becomes a switch (made at the workshop) and a short straight, as `branchOff` does, and track runs from the switch's
 * branch to `targets` (the stub's free ends), at most `maxPieces` pieces, from a straight within `reach` of `at`. (A
 * town's station, joined by `joinTowns`, takes a longer one.) `trace`: each try logged. The switch, or null with
 * everything put back.
 */
function spurTo(P: Player, at: { x: number; z: number }, targets: () => number[], maxPieces = SPUR_PIECES, reach = RUIN_REACH, trace = ENV.BALANCE_RUIN_TRACE): number | null {
  const w = P.w;
  if (!P.canMake(new Map([["piece:switch", 1]]))) return null;
  const away = (id: number) => Math.hypot(w.layout.getPiece(id)!.pose.x - at.x, w.layout.getPiece(id)!.pose.z - at.z);
  const line = [...w.layout.pieceIds()]
    .filter((id) => !P.fixed.has(id) && w.layout.getPiece(id)!.type === "straight-216" && !nearEnd(P, id, 2))
    .filter((id) => away(id) < reach)
    .sort((a, b) => away(a) - away(b));
  for (const s of line.slice(0, 8)) {
    const p = w.layout.getPiece(s)!;
    if ([0, 1].some((c) => w.layout.joinedConnector(connectorRef(s, c)) === -1) || w.sim.pieceOccupied(s)) continue;
    let straight = s;
    for (const flipped of [false, true]) {
      P.editor.remove(straight);
      const sw = P.editor.place("switch", p.pose, p.y, flipped);
      const short = placeOn(P, connectorRef(sw, 1), "straight-72");
      if (w.layout.joinedConnector(connectorRef(sw, 0)) !== -1 && freeEnd(P, short) === -1) {
        for (const ref of targets()) {
          const had = new Set(w.layout.pieceIds());
          const r = play(w.layout, P.editor, connectorRef(sw, 2), ref, { blocked: P.rules(), maxPieces, fiddle: 3 });
          if (trace) P.note(`  spur trace: from ${Math.round(p.pose.x)},${Math.round(p.pose.z)} ${flipped ? "right" : "left"}: ${r.how} (${r.pieces} pieces${r.miss ? `, miss ${r.miss.d} mm ${r.miss.angle}°` : ""}${r.blockedBy ? `, blocked by ${r.blockedBy}` : ""})`);
          if (r.ok && P.settle()) return sw;
          for (const id of [...w.layout.pieceIds()]) if (!had.has(id)) P.editor.remove(id);
        }
      }
      P.editor.remove(short);
      P.editor.remove(sw);
      straight = P.editor.place("straight-216", p.pose, p.y, false);
    }
  }
  return null;
}

/**
 * A passing loop spliced into the line mid-way between two of its stops, as a player would lay one for a second train
 * (routes Phase 3b: trains of the line cross there): four (or three) straights in a row on the way between the stops
 * become a switch, the main road (straights), the other road round beside it (a curve, straights, a curve) and a
 * switch, made at the workshop. The loop's pieces, or null with everything put back.
 */
function spliceLoop(P: Player, stopPieces: readonly number[], longest = 0, avoid: ReadonlySet<number> = new Set(), near?: { x: number; z: number }): number[] | null {
  const w = P.w;
  const L = w.layout;
  if (!P.canMake(new Map([["piece:switch", 2]]))) return null;
  /** The main road and the other road's straights for a run of n straight-216s (the loop's switches are 144 long). */
  const ROADS: Record<number, { main: PieceTypeId[]; side: PieceTypeId[] }> = {
    4: { main: ["straight-216", "straight-216", "straight-144"], side: ["straight-216", "straight-144"] },
    3: { main: ["straight-216", "straight-144"], side: ["straight-144"] },
  };
  // Runs of straights on the line's ways between stops: first where the main road holds the line's longest train
  // (`longest`, mm) clear of both switches, then clear of the stops, then longest, then nearest the middle.
  const runs: { ids: number[]; mid: number; clear: boolean; fits: boolean; off: number }[] = [];
  for (const n of [4, 3])
    for (const leg of lineLegs(L, stopPieces)) {
      const ids: number[] = [];
      for (const r of leg ?? []) if (ids.at(-1) !== r.pieceId) ids.push(r.pieceId);
      for (let k = 0; k + n <= ids.length; k++) {
        const run = ids.slice(k, k + n);
        if (run.some((id) => P.fixed.has(id) || avoid.has(id) || L.getPiece(id)!.type !== "straight-216" || w.sim.pieceOccupied(id))) continue;
        // (Clear of the stops at either end by two pieces: a long train worked at a stop creeps on past it.)
        const q = L.getPiece(run[Math.floor(n / 2)])!.pose;
        runs.push({ ids: run, mid: Math.abs(k + n / 2 - ids.length / 2), clear: k >= 3 && k + n <= ids.length - 3, fits: (n === 4 ? 576 : 360) >= longest + 12, off: near ? Math.hypot(q.x - near.x, q.z - near.z) : 0 });
      }
    }
  // (`near`: where trains are stuck, the card saying "Add a passing loop here": the nearest run there that holds them.)
  runs.sort((a, b) => Number(b.fits) - Number(a.fits) || (near ? a.off - b.off : 0) || Number(b.clear) - Number(a.clear) || b.ids.length - a.ids.length || a.mid - b.mid);
  const rules = P.rules();
  /** The end joined to piece `id` other than by piece `not`. */
  const outer = (id: number, not: number): number => {
    for (const c of [0, 1]) {
      const j = L.joinedConnector(connectorRef(id, c));
      if (j !== -1 && pieceOfRef(j) !== not) return j;
    }
    return -1;
  };
  /** Straights put back after a try, under new ids: runs found before it that share them follow. */
  const renamed = new Map<number, number>();
  for (const run of runs.slice(0, 12)) {
    const ids = run.ids.map((id) => {
      while (renamed.has(id)) id = renamed.get(id)!;
      return id;
    });
    const n = ids.length;
    const before = outer(ids[0], ids[1]);
    const after = outer(ids[n - 1], ids[n - 2]);
    if (before === -1 || after === -1) continue;
    const was = ids.map((id) => ({ ...L.getPiece(id)! }));
    for (const side of [false, true]) {
      for (const id of ids) P.editor.remove(id);
      const placed: number[] = [];
      const put = (type: PieceTypeId, flipped: boolean, ref: number, via?: number): number => {
        const tmp = appendPiece(L, type, flipped, ref, via);
        const p = L.getPiece(tmp)!;
        L.removePiece(tmp);
        const id = P.editor.place(type, p.pose, p.y, flipped);
        placed.push(id);
        return id;
      };
      const s1 = put("switch", side, before, 0);
      let at = s1;
      for (const t of ROADS[n].main) at = put(t, false, connectorRef(at, 1));
      const mainEnd = at;
      at = put("curve-large", !side, connectorRef(s1, 2));
      for (const t of ROADS[n].side) at = put(t, false, connectorRef(at, 1));
      at = put("curve-large", !side, connectorRef(at, 1));
      const s2 = put("switch", !side, connectorRef(at, 1), 2);
      const closes =
        L.joinedConnector(connectorRef(s2, 1)) === connectorRef(mainEnd, 1) &&
        L.joinedConnector(connectorRef(s2, 0)) === after &&
        L.joinedConnector(connectorRef(s1, 0)) === before;
      const allowed = placed.every((id) => {
        const p = L.getPiece(id)!;
        return !rules(p.type, p.flipped, p.pose, p.y, id);
      });
      if (closes && allowed && P.settle()) return placed;
      for (const id of placed) P.editor.remove(id);
      // The straights back as they were, as one edit: put back one by one, each was shifted to take up the play left
      // by the ones not yet back (Editor's takeUpPlay), and the run came back bent, open in the middle.
      const back = P.editor.placeRun(was.map((p) => ({ type: p.type, pose: p.pose, y: p.y, flipped: p.flipped })));
      for (let k = 0; k < n; k++) renamed.set(ids[k], back[k]);
      ids.splice(0, n, ...back);
    }
  }
  return null;
}

function industryAt(P: Player, type: PieceTypeId, ref: number): number {
  const id = placeOn(P, ref, type);
  const p = P.w.layout.getPiece(id)!;
  if (!rulesFor(P.w)(type, false, p.pose, p.y, id) && !siteWhy(P.w.landscape, type, p.pose)) return id;
  P.editor.remove(id);
  return -1;
}

/**
 * Run the line on from one of its ends (its turnback taken up) to an industry site for `type` near `cells` (with room
 * for `after` beyond it), or to `target` (a free end). The pieces it takes are made from the workshop as they go down.
 * The industry's piece is placed (it must already be in the toy box). Returns the new piece (or the target's piece),
 * and the free end beyond it; or null, with everything put back.
 */
function extend(P: Player, to: { type: PieceTypeId; cells: number[]; after?: PieceTypeId } | { target: () => number[] }, maxSites = 30): { id: number; beyond: number } | null {
  for (const end of lineEnds(P).sort((a, b) => 0 * a.ref - 0 * b.ref)) {
    if (P.w.sim.pieceOccupied(end.buffer)) continue;
    const bufPose = P.w.layout.getPiece(end.buffer)!;
    P.editor.remove(end.buffer);
    const from = end.ref;
    const at = P.w.layout.worldConnector(from, peg);
    if ("target" in to) {
      for (const ref of to.target()) {
        const had = new Set(P.w.layout.pieceIds());
        const r = play(P.w.layout, P.editor, from, ref, { blocked: P.rules(), maxPieces: 90, fiddle: 3 });
        const settled = r.ok && P.settle();
        if (ENV.BALANCE_JOIN_TRACE) {
          const e = { ...P.w.layout.worldConnector(from, peg) };
          const t = { ...P.w.layout.worldConnector(ref, peg) };
          const near = P.w.layout.getPiece(pieceOfRef(from))!;
          P.note(`  join trace: end ${Math.round(e.x)},${Math.round(e.z)} h${Math.round((e.heading * 180) / Math.PI)} (${near.type}, y ${near.y}) → ${Math.round(t.x)},${Math.round(t.z)} h${Math.round((t.heading * 180) / Math.PI)}: ${r.how} (${r.pieces} pieces${r.miss ? `, miss ${r.miss.d} mm ${r.miss.angle}°` : ""}${r.blockedBy ? `, blocked by ${r.blockedBy}` : ""})${r.ok && !settled ? " but didn't settle" : ""}`);
        }
        if (settled) return { id: pieceOfRef(ref), beyond: -1 };
        for (const id of [...P.w.layout.pieceIds()]) if (!had.has(id)) P.editor.remove(id);
      }
    } else {
      const g = P.w.landscape.grid;
      const away = (i: number) => Math.hypot(g.centreX(g.colOf(i)) - at.x, g.centreZ(g.rowOf(i)) - at.z);
      const near = to.cells.filter((i) => away(i) < 1400).sort((a, b) => away(a) - away(b));
      // Straight on the end, if it can stand there.
      const straight = to.after ? -1 : industryAt(P, to.type, from);
      if (straight !== -1) return { id: straight, beyond: freeEnd(P, straight) };
      let n = 0;
      for (const site of sitesNear(P, to.type, near.filter((_, k) => k % 2 === 0).slice(0, 50), to.after)) {
        if (++n > maxSites) break;
        const q = P.editor.place(to.type, site.pose, site.y, false);
        const had = new Set(P.w.layout.pieceIds());
        for (const c of [0, 1]) {
          const r = play(P.w.layout, P.editor, from, connectorRef(q, c), { blocked: P.rules(), maxPieces: 90, fiddle: 3 });
          if (r.ok && P.settle()) return { id: q, beyond: connectorRef(q, 1 - c) };
          for (const id of [...P.w.layout.pieceIds()]) if (!had.has(id)) P.editor.remove(id);
        }
        P.editor.remove(q);
      }
    }
    // Back as it was.
    P.editor.place("buffer-turnback", bufPose.pose, bufPose.y, bufPose.flipped);
  }
  return null;
}

/** A turnback on a free end (one is made at the workshop if the box has none). */
function capEnd(P: Player, ref: number): boolean {
  if (ref === -1) return true;
  const r = endOn(P.w, P.editor, ref);
  if ("why" in r) {
    P.note(`couldn't put a turnback on the end (${r.why})`);
    return false;
  }
  P.settle();
  return true;
}

const st = (P: Player, i: number) => P.w.stations.get(P.w.landscape.towns[i].id)!;
const depotPiece = (P: Player, kind: string) => [...P.w.depots.values()].find((id) => P.w.layout.getPiece(id)!.type === `depot-${kind}`)!;

/** The towns on the railway (joined to Larkfield's station). */
function townsOnLine(P: Player): number[] {
  const seen = new Set<number>();
  const start = st(P, 0);
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = P.w.layout.getPiece(id)!;
    const n = getPieceDef(p.type, p.flipped).connectors.length;
    for (let c = 0; c < n; c++) {
      const j = P.w.layout.joinedConnector(connectorRef(id, c));
      if (j !== -1) stack.push(pieceOfRef(j));
    }
  }
  return P.w.landscape.towns.map((t, i) => (seen.has(P.w.stations.get(t.id)!) ? i : -1)).filter((i) => i >= 0);
}

/** The depots along the line, in order from one end to the other (an unbranched line). */
function lineOrder(P: Player): number[] {
  // Depth first from one end: on a branched line the branch's depots come together, as a train would visit them.
  // (A line end with no turnback counts too: a depot built at a line end, where no turnback could go on, leaves the
  // track just stopping there. With none found the goods train, made up again, was left off its line.)
  const ends = lineEnds(P);
  if (ends.length === 0) ends.push(...openEnds(P));
  if (ends.length === 0) return [];
  const out: number[] = [];
  const seen = new Set<number>([ends[0].buffer]);
  const visit = (at: number): void => {
    if (seen.has(at)) return;
    seen.add(at);
    const d = P.w.economy.depotAtPiece(at);
    if (d) out.push(d.id);
    const p = P.w.layout.getPiece(at)!;
    const n = getPieceDef(p.type, p.flipped).connectors.length;
    for (let c = 0; c < n; c++) {
      const j = P.w.layout.joinedConnector(connectorRef(at, c));
      if (j !== -1) visit(pieceOfRef(j));
    }
  };
  visit(pieceOfRef(ends[0].ref));
  return out;
}

/**
 * The depots of a line in the order that makes the shortest lap there and back (`routeGoods`), as a player orders a
 * branched line's stops: the depth-first `order` leaves a branch's depots after the far end of the line, and a train,
 * which turns back only at a line's end, crosses the map to reach them. Each way between two stops is the way a routed
 * train goes from the first, heading as it came in (`legFromCursor`), so a spur that must be run into from the far side
 * costs what it does. Improved from `order` by moving one depot, or turning a run of them round, while that's shorter.
 */
function shortestLap(w: World, order: readonly number[]): { order: number[]; was: number; lap: number } {
  const n = order.length;
  if (n < 3) return { order: [...order], was: 0, lap: 0 };
  const L = w.layout;
  const piece = order.map((d) => w.economy.depot(d)!.pieceId);
  // The way from stop i (heading `rev`) to stop j: its length and the heading it comes in with, worked out once each.
  const legs = new Map<number, { len: number; rev: boolean }>();
  const leg = (i: number, rev: boolean, j: number): { len: number; rev: boolean } => {
    const key = (i * n + j) * 2 + (rev ? 1 : 0);
    let r = legs.get(key);
    if (!r) {
      const from = L.getPiece(piece[i])!;
      const len = pathLength(getPieceDef(from.type, from.flipped).paths[0].geom);
      const runs = piece[i] === piece[j] ? [] : legFromCursor(L, { pieceId: piece[i], pathIndex: 0, reversed: rev, s: len / 2 }, piece[j]);
      const last = runs?.at(-1);
      r = runs ? { len: runsLength(runs), rev: last ? last.s1 < last.s0 : rev } : { len: Infinity, rev };
      legs.set(key, r);
    }
    return r;
  };
  // A lap of the line there and back (stops as indices into `order`): the second of two, from whichever heading is shorter.
  const lap = (seq: readonly number[]): number => {
    const stops = [...seq, ...seq.slice(1, -1).reverse()];
    let best = Infinity;
    for (const start of [false, true]) {
      let rev = start;
      let total = 0;
      for (let k = 0; k < stops.length * 2; k++) {
        const r = leg(stops[k % stops.length], rev, stops[(k + 1) % stops.length]);
        if (k >= stops.length) total += r.len;
        rev = r.rev;
      }
      best = Math.min(best, total);
    }
    return best;
  };
  let seq = order.map((_, i) => i);
  let cost = lap(seq);
  const was = cost;
  for (let pass = 0; pass < 20; pass++) {
    let better = false;
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) {
        if (a === b) continue;
        // One depot moved to another place in the order, or the run between two turned round.
        const moved = [...seq];
        moved.splice(b, 0, ...moved.splice(a, 1));
        const turned = a < b ? [...seq.slice(0, a), ...seq.slice(a, b + 1).reverse(), ...seq.slice(b + 1)] : null;
        for (const t of turned ? [moved, turned] : [moved]) {
          const c = lap(t);
          if (c < cost - 1) {
            seq = t;
            cost = c;
            better = true;
          }
        }
      }
    if (!better) break;
  }
  return { order: seq.map((i) => order[i]), was, lap: cost };
}

/**
 * On a line's stops, `kind` picked up only at the visits to a depot giving it that come nearest before a stop that
 * takes it (fewest stops on); that depot's other visits become "Only drop" (they still drop, but pick nothing up). On a
 * line there and back: the farm on the way to the mill, not on the way out.
 */
function onlyNearestPickup(w: World, stops: RouteStopDef[], kind: CargoKind): void {
  const n = stops.length;
  const role = (i: number) => w.economy.depot(stops[i].depotId)?.role;
  const gives = stops.map((_, i) => !!role(i) && RECIPES[role(i)!].gives.includes(kind));
  const ahead = stops.map((_, i) => {
    if (!gives[i]) return Infinity;
    for (let k = 1; k < n; k++) {
      // (A town or the school that takes it only if it wants it now: stone isn't taken by a town short of a city.)
      const d = w.economy.depot(stops[(i + k) % n].depotId);
      if (d && RECIPES[d.role].takes.includes(kind) && (!w.economy.accepts || w.economy.accepts(d, kind))) return k;
    }
    return Infinity;
  });
  for (let i = 0; i < n; i++) {
    if (!gives[i]) continue;
    const best = Math.min(...ahead.filter((_, j) => stops[j].depotId === stops[i].depotId));
    if (ahead[i] > best && stops[i].action !== "pick") stops[i].action = "drop";
  }
}

describe("the harness's footprints", () => {
  it("are the game's: every prop on the starter map has one, measured from its model (none left out as the game wouldn't)", () => {
    const w = buildStarterWorld();
    const props = [...w.props.all()];
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      const fp = footprintOf(p.asset);
      expect(fp, p.asset).toBeDefined();
      expect(fp!.hw * fp!.hd, p.asset).toBeGreaterThan(16);
    }
  });
});

describe("the goals guard", () => {
  it("names a goal neither met nor allowed, and an allowance for a goal met or gone", () => {
    const goals = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ];
    expect(goalsMissed((id) => id === "a", { c: "later" }, goals)).toEqual({ missed: ["B (b)"], stale: [] });
    expect(goalsMissed((id) => id !== "b", { c: "later", x: "gone" }, goals)).toEqual({ missed: ["B (b)"], stale: ["c", "x"] });
    expect(goalsMissed(() => true, {}, goals)).toEqual({ missed: [], stale: [] });
    // (Every allowance of either part is a goal still, with why; the long part plays on from the fast one, so what it
    // doesn't reach the fast part doesn't either.)
    for (const allowed of [GOALS_NOT_REACHED, GOALS_LONG_NOT_REACHED])
      for (const [id, why] of Object.entries(allowed)) {
        expect(GOALS.some((g) => g.id === id), id).toBe(true);
        expect(why.length, `why ${id}`).toBeGreaterThan(0);
      }
    for (const id of Object.keys(GOALS_LONG_NOT_REACHED)) expect(id in GOALS_NOT_REACHED, `${id}: allowed in the long part, met in the fast one`).toBe(true);
  });
});

/**
 * The goals play-through to `minutes` (the old farm restored on a spur, as a player does on the starter map: no line
 * end reaches it; past Quarries, the player picks research in the goals' order: `GOALS_WISH`), its goals checked
 * against `allowed`, and what both parts check. The play-through, for the part's own checks.
 */
function goalsPlay(minutes: number, allowed: Readonly<Record<string, string>>, part: string): Playthrough {
  const P = new Playthrough(true, true);
  const t0 = performance.now();
  try {
    P.play(minutes);
  } catch (e) {
    P.report();
    throw e;
  }
  const seconds = (performance.now() - t0) / 1000;
  console.log(`${part} goals play-through: ${minutes} min of play in ${seconds.toFixed(1)} s; goals ${P.p.goals.doneCount}/${GOALS.length}`);
  const { missed, stale } = goalsMissed((id) => P.p.goals.isDone(id), allowed);
  if (missed.length > 0 || stale.length > 0 || ENV.BALANCE_GOALS_LOG) P.report();
  expect(missed, "goals neither met nor allowed").toEqual([]);
  expect(stale, "allowed but met (take them off the part's list), or not goals").toEqual([]);
  // The old farm, restored (its Restore, paid for), not a new farm yard; its grain made, and carried to the mill.
  const w = P.p.w;
  const farm = w.layout.getPiece(P.farm);
  expect(P.firsts["farm restored"], "the old farm restored").toBeDefined();
  expect(w.landscape.sites!.find((x) => x.role === "farm")?.restored).toBe(true);
  expect(farm?.type).toBe("depot-farm");
  expect(w.economy.made[CARGO.grain.index], "grain made").toBeGreaterThan(0);
  expect(w.economy.made[CARGO.flour.index], "flour milled of its grain").toBeGreaterThan(0);
  // The quarry, on the line and working: its stone cut, and taken to a city that wants it.
  expect(w.layout.getPiece(P.quarry)?.type, "the quarry on the map").toBe("depot-quarry");
  expect(w.economy.made[CARGO.stone.index], "stone cut").toBeGreaterThan(0);
  expect(P.p.progress.counts.get("delivered:stone") ?? 0, "stone delivered to a town").toBeGreaterThan(0);
  return P;
}

describe("research toward a goods chain (towardChains)", () => {
  const all = (id: string) => !!techOf(id);
  it("finds the industry's blueprint for a good nothing makes, or what it needs first", () => {
    expect(goodsUnlocked("quarries")).toEqual(["stone"]);
    expect(goodsUnlocked("mines").sort()).toEqual(["coal", "ore"]);
    expect(goodsUnlocked("foundry")).toEqual(["iron"]);
    // (A warehouse keeps goods, it makes none.)
    expect(goodsUnlocked("warehouses")).toEqual([]);
    const learned = new Set(["farming", "mills", "quarries"]);
    const made = new Set<CargoKind>(["log", "planks", "grain", "flour", "stone"]);
    // Coal for Foundry and Electricity: Mines, which needs the Goods engine, which needs the Tank engine first.
    expect(towardChains(learned, made, (id) => id === "tank")).toEqual(["tank"]);
    expect(towardChains(new Set([...learned, "tank"]), made, (id) => id === "goods-engine")).toEqual(["goods-engine"]);
    expect(towardChains(new Set([...learned, "tank", "goods-engine"]), made, all)).toContain("mines");
    // Mines learned: its coal is the builder's to open, and Foundry's iron is next.
    expect(towardChains(new Set([...learned, "tank", "goods-engine", "mines"]), new Set([...made, "coal", "ore"]), all)).toEqual(["foundry"]);
    // Every good made: nothing to open.
    expect(towardChains(learned, new Set<CargoKind>(["planks", "grain", "flour", "stone", "coal", "ore", "iron"]), all)).toEqual([]);
  });
});

describe.skipIf(RUN)("the goals play-through", () => {
  it(`meets every goal by minute ${GOALS_RUN_MINUTES} but those allowed (GOALS_NOT_REACHED), the old farm restored the player's way, its grain made and milled, a quarry's stone in a city`, () => {
    goalsPlay(GOALS_RUN_MINUTES, GOALS_NOT_REACHED, "fast");
  }, 180_000);
});

describe.skipIf(RUN || !GOALS_LONG)("the long goals play-through (GOALS_LONG=1)", () => {
  it(`meets every goal by minute ${GOALS_LONG_MINUTES} but those allowed (GOALS_LONG_NOT_REACHED), as the fast part does and on: the mine opened and working, every town joined`, () => {
    const P = goalsPlay(GOALS_LONG_MINUTES, GOALS_LONG_NOT_REACHED, "long");
    const w = P.p.w;
    // The mine, on the line and working: coal or ore brought up, and carried on a train.
    expect(w.layout.getPiece(P.mine)?.type, "the mine on the map").toBe("depot-mine");
    expect(P.firsts["mine built"] ?? P.firsts["mine restored"], "the mine built or restored").toBeDefined();
    expect(w.economy.made[CARGO.coal.index] + w.economy.made[CARGO.ore.index], "coal or ore brought up").toBeGreaterThan(0);
    expect(P.firsts["mine's goods carried"], "the mine's coal or ore on a train").toBeDefined();
    // A plot bought (its price paid, by the land card's way), and "Buy some land" ticked.
    expect(P.firsts["land bought"], "a plot bought").toBeDefined();
    expect(P.p.goals.isDone("buy-land"), "Buy some land ticked").toBe(true);
    // Every town on the railway, joined to Larkfield's station.
    // (Those the map had when "Connect every town" was met: the plot bought after brings its own, not joined.)
    const had = w.landscape.towns.slice(0, P.townsBeforeLand < 0 ? undefined : P.townsBeforeLand);
    expect(townsOnLine(P.p).filter((i) => i < had.length).map((i) => w.landscape.towns[i].name), "every town joined").toEqual(had.map((t) => t.name));
    // The harbour, built (or an old one restored) by the sea, on the line: Harbours researched, the stone of its price
    // brought to the workshop by train (the cranes' own unloads: no pile written to), and a boat trading there.
    expect(P.p.learnedAt.find((b) => b.id === "harbours")?.how, "Harbours researched").toBe("researched");
    expect(w.layout.getPiece(P.harbour)?.type, "the harbour on the map").toBe("depot-harbour");
    expect(P.firsts["harbour built"] ?? P.firsts["harbour restored"], "the harbour built or restored").toBeDefined();
    expect(w.economy.lines.get(P.lineId)?.stops.map((x) => x.depotId), "the harbour a stop on the line").toContain(w.economy.depotAtPiece(P.harbour)!.id);
    expect(P.harbourStone, "stone the workshop had from trains when the harbour was paid for").toBeGreaterThanOrEqual(P.firsts["harbour restored"] !== undefined ? restorePrice("harbour").goods.stone ?? 0 : (ruleOf(pieceThing("depot-harbour"))!.cost.stone ?? 0));
    expect(P.p.boatTook.loads, "goods a boat took off the harbour's quay").toBeGreaterThan(0);
  }, 600_000);
});

describe.skipIf(!RUN)("balance play-through", () => {
  it("a new player's Game-mode game, from the start to a city ★★", () => {
    const P = new Playthrough();
    try {
      P.play();
    } finally {
      P.report();
    }
    expect(P.p.rows.length).toBeGreaterThan(0);
    if (MAX_MINUTES === 180 && PER_LINE === 1) P.checkBands();
  }, 3_600_000);
});

/** The new player's decisions, a minute at a time. */
class Playthrough {
  /** `spur`: an old industry no line end reaches is restored on a short spur (BALANCE_SPUR's rule). */
  /** `goalsFirst`: past Quarries, the blueprints the goals still to come need first (`GOALS_WISH`). */
  constructor(
    readonly spur = SPUR,
    readonly goalsFirst = false,
  ) {}
  readonly p = new Player(buildStarterWorld());
  shop = -1;
  /** The school's piece (−1: not placed yet). */
  school = -1;
  millTry = -99;
  timber = -1;
  /** The trains on the line: an engine id each, with what it's for. */
  trains = new Map<number, string>();
  farm = -1;
  mill = -1;
  quarry = -1;
  mine = -1;
  /** The foundry (the default run: built once Foundry is learned, for the iron Smithy and Electricity ask). */
  foundry = -1;
  harbour = -1;
  halt = -1;
  switchLaid = false;
  joinedThird = false;
  lines = false;
  sawn = 0;
  sawnAt = 0;
  /** The goods train waits on cars to be made at the workshop. */
  carsWait = false;
  /** Where the longest plank stall began: its minute, the trains on the map, the line's stops. */
  stallFrom = "-";
  /** Trains picked up after a jam (the second train isn't put back on the same line while it would jam again). */
  lifted = 0;
  /** The line every train runs once routes are learned, the most trains it had, and trains taken off it for a jam. */
  lineId = -1;
  perLine = 0;
  jamCut = 0;
  /** The second goods train (P5 (h)): when it was set going, and how often it was picked up for a jam. */
  goods2At = -1;
  goods2Cut = 0;
  /** What the second goods train went on for (`goodsShort`), and minutes in a row each good has been short so. */
  goods2For = "-";
  /** When the second goods train was last made up (minutes). */
  goods2Made = -99;
  readonly shortFor = new Map<CargoKind, number>();
  /** The passing loop's switches (west, east), once laid; when it was last tried. */
  loop: [number, number] | null = null;
  loopTry = -99;
  extraAt = -99;
  /** When each passing loop was laid on the line for its extra trains (minutes), and when one was last tried. */
  readonly loopsAt: number[] = [];
  readonly loopPieces = new Set<number>();
  loopsTry = -99;
  /** Passing loops laid because a stuck card said to (minutes), and when one was last tried. */
  readonly stuckLoops: number[] = [];
  stuckLoopTry = -99;
  /** A stuck card said to add a loop and none could be laid then: the train was picked up, the loop's still to lay. */
  loopOwed = false;
  /** Passing loops laid for the people train before it was put down (minutes). */
  readonly peopleLoops: number[] = [];
  /** People trains put back on once a loop for them was laid. */
  peopleBack = 0;
  /** The pieces of the last passing loop laid for a stuck card (the people train is put back on it). */
  stuckLoop: number[] = [];
  /** When the goods train's waiting was last looked at (minutes), and its seconds stood waiting then. */
  waitLookAt = -99;
  stoodAt = 0;
  /** Where trains were last stuck, the card saying to add a loop there. */
  stuckAt: { x: number; z: number } | null = null;
  recomposed = -99;
  /** Minutes in a row with nothing new. */
  idle = 0;
  readonly idleStretches: { from: number; to: number; why: string }[] = [];
  why = "";
  idleWhy = "";
  farmTry = -99;
  harvester = -1;
  harvesterTry = -99;
  /** When things first came within reach (a blueprint offered or on the board), and each town level first reached. */
  readonly firsts: Record<string, number> = {};
  /** Minutes a farm yard or a quarry waited on coins alone (learned, planks in the yard). */
  readonly coinWait = { farm: 0, quarry: 0, mine: 0, harbour: 0, foundry: 0 };
  /** The longest stretch with no planks sawn (whole minutes). */
  stall = 0;
  /** The longest stretch with no planks sawn while two trains share the line (they turn each other back). */
  jamStall = 0;
  /**
   * Goods the player picks up only at the visit nearest before where they're taken (`onlyNearestPickup`), since the
   * cars carrying them kept another good from loading (P5: hoppers full of grain at the quarry); and how many minutes
   * in a row cargo has been stuck so (`unstick`).
   */
  readonly nearestPickup = new Set<CargoKind>();
  stuckFor = 0;

  play(minutes = MAX_MINUTES): void {
    const P = this.p;
    const w = () => P.w;
    P.note(`new game: towns ${w().landscape.towns.map((t) => t.name).join(", ")}; box ${[...P.progress.owned].map(([id, n]) => `${n} ${id}`).join(", ")}`);

    // 1. The starter line, as the tutorial goals lead: Larkfield to Elderwick, Larkfield to the sawmill, Elderwick to
    // the forest yard; turnbacks on the ends. (The workshop comes later, when its goal asks.)
    for (const [name, a, b] of [
      ["Larkfield → Elderwick", connectorRef(st(P, 0), 1), connectorRef(st(P, 1), 0)],
      ["Larkfield → sawmill", connectorRef(st(P, 0), 0), connectorRef(depotPiece(P, "sawmill"), 1)],
      ["Elderwick → forest yard", connectorRef(st(P, 1), 1), connectorRef(depotPiece(P, "forest"), 0)],
    ] as const) {
      const r = play(w().layout, P.editor, a, b, { blocked: P.rules(), maxPieces: 60, fiddle: 3 });
      P.note(`${name}: ${r.ok ? `joined (${r.pieces} pieces)` : `NOT JOINED (${r.how})`}`);
      expect(r.ok, name).toBe(true);
    }
    capEnd(P, connectorRef(depotPiece(P, "sawmill"), 0));
    capEnd(P, connectorRef(depotPiece(P, "forest"), 1));
    const middle = () => [...w().layout.pieceIds()].find((id) => !P.fixed.has(id) && w().layout.getPiece(id)!.type.startsWith("straight") && Math.abs(w().layout.getPiece(id)!.pose.x) < 300 && !w().sim.pieceOccupied(id))!;
    const t = P.train(["engine", "timber", "timber", "timber"], middle(), -1);
    if (typeof t === "string") throw new Error(t);
    this.timber = t;
    this.trains.set(t, "timber");
    P.note("timber train (engine, 3 flatbeds) out of the box and set going");

    for (let minute = 1; minute <= minutes; minute++) {
      P.happened = 0;
      P.run(60);
      if (ENV.BALANCE_TRACE && minute >= Number(ENV.BALANCE_TRACE.split("-")[0]) && minute <= Number(ENV.BALANCE_TRACE.split("-")[1])) P.trains();
      this.decide();
      const s = P.progress;
      P.rows.push({
        minute,
        coins: s.coins,
        planks: P.planks(),
        goals: P.goals.doneCount,
        blueprints: [...s.learned].length,
        learned: [...s.learned],
        levels: w().landscape.towns.map((t) => P.town.status(t.id).level),
        trains: w().sim.trainIds().length,
        riders: s.riders,
      });
      if (minute % 5 === 0) {
        const towns = w()
          .landscape.towns.map((t, i) => [t, i] as const)
          .filter(([, i]) => P.level(i) > 0 || townsOnLine(P).includes(i))
          .map(([t]) => {
            const st2 = P.town.status(t.id);
            return `${t.name} ${st2.name.toLowerCase()} (${Object.entries(st2.wants).map(([k, n]) => `${st2.got[k as keyof typeof st2.got] ?? 0}/${n} ${k}`).join(", ")})`;
          });
        if (minute % 10 === 0) P.trains();
        P.note(`status: ${s.coins} coins; workshop ${describeGoods(workshopStock(w()))}; goal ${P.goals.current()?.title ?? "all done"}; research ${s.research.current ?? "none"} ${describeGoods(s.research.got)}, next ${s.research.next ?? "none"}; ${towns.join("; ")}`);
      }
      if (P.happened === 0) {
        if (this.idle === 0) this.idleWhy = this.why;
        this.idle++;
      } else {
        if (this.idle >= 5) this.idleStretches.push({ from: minute - this.idle, to: minute - 1, why: this.idleWhy });
        this.idle = 0;
      }
      if (P.bestLevel() >= TARGET_LEVEL) {
        P.note(`TARGET: a city ★★ at minute ${minute}`);
        break;
      }
    }
    const last = P.rows.at(-1)?.minute ?? 0;
    if (this.idle >= 5) this.idleStretches.push({ from: last - this.idle + 1, to: last, why: this.idleWhy });
  }

  /**
   * The goods the one goods train can't keep up with (P5 (h)), as a player sees them on the depot and town cards: a
   * good some town on the line or the research wants, while its source on the line has a full pile (logs at a forest
   * or planks at the sawmill, for planks; grain at a farm or flour at the mill, for flour; stone at a quarry), for
   * `SECOND_GOODS_SATURATED` minutes in a row (called once a minute). Planks only while the workshop's yard is short
   * of them too: a full yard means the planks are coming.
   */
  goodsShort(): CargoKind[] {
    const P = this.p;
    const w = P.w;
    const line = w.economy.lines.get(this.lineId);
    const depots = line ? [...new Set(line.stops.map((st) => st.depotId))].map((id) => w.economy.depot(id)).filter((d) => !!d) : [];
    const towns = depots.filter((d) => d!.role === "town").map((d) => d!.townId);
    const full = (k: CargoKind) => depots.some((d) => RECIPES[d!.role].gives.includes(k) && d!.piles[CARGO[k].index] >= capAt(d!));
    const sources: Record<"planks" | "flour" | "stone", CargoKind[]> = { planks: ["log", "planks"], flour: ["grain", "flour"], stone: ["stone"] };
    const out: CargoKind[] = [];
    for (const k of ["planks", "flour", "stone"] as const) {
      const wanted = researchLacking(P.progress, k) > 0 || towns.some((t) => P.town.wants(t, k));
      const yardShort = k !== "planks" || P.planks() < RESEARCH_SPARE;
      const n = wanted && yardShort && sources[k].some(full) ? (this.shortFor.get(k) ?? 0) + 1 : 0;
      this.shortFor.set(k, n);
      if (n >= SECOND_GOODS_SATURATED) out.push(k);
    }
    return out;
  }

  /** The second goods train is on the line (its jams are judged by the trains: `decide`). */
  goods2On(): boolean {
    return [...this.trains.values()].includes("goods 2");
  }

  /** A minute's decisions. */
  decide(): void {
    const P = this.p;
    const w = P.w;
    const s = P.progress;
    this.why = "";
    // A derailed train: Re-rail, and set it going.
    for (const id of w.sim.trainIds()) {
      if (!w.sim.getTrain(id)?.derailed) continue;
      const back = w.sim.rerail(id);
      P.note(`a train derailed: ${back !== -1 ? "re-railed" : "COULDN'T re-rail"}`);
      if (back !== -1) for (const car of w.sim.getTrain(back)?.cars ?? []) if (car.kind === "engine") w.sim.setLever(car.id, 1);
    }
    // Two trains on one line turn each other back, and the goods train may never reach one end: with no planks sawn
    // for a few minutes, a player sees it and picks the other train up (it can come back on a line of its own).
    const sawn = w.economy.made[CARGO.planks.index];
    // (Where the longest stall began, for the summary.)
    if (sawn === this.sawn && Math.round(P.minute - this.sawnAt) > this.stall) this.stallFrom = `${this.sawnAt.toFixed(0)}, ${this.trains.size} train(s), ${Math.max(0, 2 * lineOrder(P).length - 2)} stops`;
    // A train of the player's stuck (stalls.ts: nothing turns a train back now, routing §16 Q3), its card saying so and
    // "Put one away": looked at once a minute, the player does, the newest first (as for a jam, below).
    const stuck = [...this.trains.keys()].find((e) => w.economy.stalls.stuckOf(e));
    // (The card says "Add a passing loop here" (two lines' trains, or one on no line, with no loop to meet at): the
    // player lays one on the line, as for a second train (`spliceLoop`), once the switches can be made, rather than
    // picking a train up. Still stuck with a loop there, the card says "Put one away", and the player does, below.)
    const fix = stuck === undefined ? null : w.economy.stalls.stuckOf(stuck);
    let laidFor = false;
    const owed = this.loopOwed && P.minute - this.stuckLoopTry >= 3;
    if (((fix?.kind === "in-way" && fix.loop && P.minute - this.stuckLoopTry >= 3) || owed) && this.keepsPeople() && this.lines && this.lineId >= 0 && !ENV.BALANCE_NOJAMCUT) {
      this.stuckLoopTry = P.minute;
      const line = w.economy.lines.get(this.lineId);
      const stops = line ? [...new Set(line.stops.map((st) => w.economy.depot(st.depotId)!.pieceId))] : [];
      const longest = Math.max(450, LONGEST_PEOPLE, ...[...this.trains.keys()].map((e) => (w.sim.findCar(e) ? trainLength(w.sim.findCar(e)!.train) : 0)));
      const said = stuck === undefined ? "" : engineStatus(w.sim, w.economy, stuck, () => "");
      // ("Here": between the stuck train and the one in its way. Owed, where they stood.)
      if (stuck !== undefined && fix?.kind === "in-way") {
        const a = w.sim.findCar(stuck)?.train.world[0];
        const b = w.sim.findCar(fix.by)?.train.world[0];
        if (a && b) this.stuckAt = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      }
      const loop = spliceLoop(P, stops, longest, this.loopPieces, this.stuckAt ?? undefined);
      if (loop) {
        P.happened++;
        laidFor = stuck !== undefined;
        this.loopOwed = false;
        this.stuckLoops.push(Math.round(P.minute));
        this.stuckLoop = loop;
        for (const id of loop) this.loopPieces.add(id);
        P.findings.push(`Minute ${P.minute.toFixed(0)}: ${owed ? "the passing loop a stuck card asked for" : `trains stuck ("${said}")`}. Laid a passing loop on the line.`);
        P.note(`${owed ? "the passing loop the stuck card asked for" : `STUCK TRAINS: "${said}"`}; laid a passing loop on the line (${loop.length} pieces)`);
        this.sawnAt = P.minute;
      } else if (!owed) {
        // (No room, or the switches can't be made yet: the train is picked up meanwhile (below), the loop laid later.)
        this.loopOwed = true;
        P.note(`STUCK TRAINS: "${said}"; COULDN'T lay a passing loop yet (no room, or 2 switches to make)`);
      }
    }
    if (stuck !== undefined && !laidFor && this.trains.size >= 2 && !ENV.BALANCE_NOJAMCUT && !this.goods2On()) {
      const [e, kind] = [...this.trains].find(([, k]) => k === "goods 2") ?? [...this.trains].find(([id]) => id !== this.timber) ?? [];
      if (e !== undefined) {
        const said = engineStatus(w.sim, w.economy, stuck, () => "");
        P.lift(e);
        this.trains.delete(e);
        if (kind === "goods 2") this.goods2Cut++;
        else this.lifted++;
        if (this.lines) this.jamCut++;
        P.findings.push(`Minute ${P.minute.toFixed(0)}: trains stuck ("${said}"). Picked the ${kind} train up.`);
        P.note(`STUCK TRAINS: "${said}"; picked the ${kind} train up`);
        this.sawnAt = P.minute;
      }
    }
    if (sawn !== this.sawn) {
      this.sawn = sawn;
      this.sawnAt = P.minute;
    } else if ((this.stall = Math.max(this.stall, Math.round(P.minute - this.sawnAt))) && (this.trains.size < 2 || (this.jamStall = Math.max(this.jamStall, Math.round(P.minute - this.sawnAt)))) && P.minute - this.sawnAt >= 4 && this.trains.size >= 2 && !ENV.BALANCE_NOJAMCUT && !this.goods2On()) {
      // (The newest first: a second goods train before the people train, which came before it. Not the people train
      // on a line of its own with nothing stuck: the two lines wait for each other at the passing loop, by the rules,
      // and the stuck rule above sees to a jam.)
      const own = (id: number) => this.keepsPeople() && this.trains.get(id) === "people" && this.peopleLoops.length + this.stuckLoops.length > 0 && w.economy.stalls.count === 0;
      const [e, kind] = [...this.trains].find(([, k]) => k === "goods 2") ?? [...this.trains].find(([id]) => id !== this.timber && !own(id)) ?? [];
      if (e !== undefined) {
        P.lift(e);
        this.trains.delete(e);
        if (kind === "goods 2") this.goods2Cut++;
        else this.lifted++;
        if (this.lines) this.jamCut++;
        P.findings.push(`Minute ${P.minute.toFixed(0)}: no planks sawn for 4 minutes with ${this.trains.size + 1} trains on one line (they turn each other back; the goods train never reached the forest). Picked the ${kind} train up.`);
        P.note(`JAM: no planks sawn for 4 min; picked the ${kind} train up`);
        this.sawnAt = P.minute;
      }
    }
    // With a second goods train on the line, a jam is judged by the trains, not the planks (a long line saws none for
    // minutes while both run): one of the line's goods trains has made no progress (not moved, or waited on the same
    // thing) for `JAM_MINUTES`. Then the second is picked up, and the waits are logged (the repro: spec §5).
    if (this.goods2On() && !ENV.BALANCE_NOJAMCUT) {
      const goods = trainsOn(w.economy, this.lineId).filter((e) => w.sim.findCar(e)?.train.cars.some((c) => GOODS_CARS.has(c.kind)));
      const still = (e: number) => (P.tick - (P.progressAt.get(e) ?? P.tick)) / SIM_HZ / 60;
      const stuck = goods.find((e) => still(e) >= JAM_MINUTES);
      if (stuck !== undefined) {
        // (Every engine on the map, on a line or not, since a wait can name any: the chain, for the repro.)
        const waits = w.sim.trainIds().flatMap((id) => {
          const t = w.sim.getTrain(id)!;
          const e = t.cars.find((c) => c.kind === "engine")?.id;
          if (e === undefined) return [];
          const l = w.economy.lineIdOf.get(e);
          const on = `${t.speed > 1 ? "moving" : "stopped"} on ${w.layout.getPiece(t.bogies[0].pieceId)?.type}`;
          return [`${this.trains.get(e) ?? "train"} ${e} ${l === undefined ? `(no line) ${on}` : `(line ${l}) still ${still(e).toFixed(1)}min ${on} wait ${P.waitKey.get(e) ?? "null"}`}`];
        });
        const who = `${this.trains.get(stuck) ?? "train"} ${stuck}`;
        const [e2] = [...this.trains].find(([, k]) => k === "goods 2")!;
        P.lift(e2);
        this.trains.delete(e2);
        this.goods2Cut++;
        this.jamCut++;
        P.findings.push(`Minute ${P.minute.toFixed(0)}: ${who} made no progress for ${JAM_MINUTES} minutes with two goods trains on the line (${waits.join("; ")}). Picked the goods 2 train up.`);
        P.note(`JAM: ${who} made no progress for ${JAM_MINUTES} min; picked the goods 2 train up`);
        for (const line of waits) P.note(`JAM wait: ${line}`);
        this.sawnAt = P.minute;
      }
    }
    if (Math.round(P.minute - this.sawnAt) === 5) {
      P.note("STALL: no planks sawn for 5 minutes");
      P.trains();
    }
    // Rewards: one of the cards that make sense now, picked at random (seeded per run: spec §5, P5), as a player who
    // likes more than one of them would: a research boost or rare cargo while a research waits on goods; planks before
    // Farming, or with the workshop short of planks to spare; coins; a crate while there's no workshop to make things;
    // a wagon while the goods train waits on cars. Nothing sensible on offer: coins, else whatever can be taken.
    while (s.offers.length > 0) {
      const o = s.offers[0];
      const ok = o.cards.map((c) => cardView(s, w, c).ok);
      const waiting = s.research.current !== null && !studying(s);
      const sensible: Record<string, boolean> = {
        boost: waiting,
        rare: waiting,
        planks: !s.learned.has("farming") || P.planks() < RESEARCH_SPARE,
        coins: true,
        crate: this.shop === -1,
        wagon: this.carsWait,
      };
      const choices = o.cards.map((_, k) => k).filter((k) => ok[k] && sensible[o.cards[k].kind]);
      // (The seeded pick drawn as before, also under BALANCE_CARD, so the draws after it stay the same.)
      let i = choices.length > 0 ? choices[((k) => (CARD_PICK === "first" ? 0 : CARD_PICK === "last" ? choices.length - 1 : k))(Math.floor(P.picks() * choices.length))] : -1;
      if (i === -1) i = o.cards.findIndex((c, k) => c.kind === "coins" && ok[k]);
      if (i === -1) i = ok.indexOf(true);
      const card = o.cards[i];
      const took = i === -1 ? null : takeCard(s, w, 0, i);
      if (!took) {
        s.offers.shift();
        continue;
      }
      P.happened++;
      P.cardsTaken[card.kind] = (P.cardsTaken[card.kind] ?? 0) + 1;
      if (card.kind === "boost" || card.kind === "rare") {
        // Goods into the research: schools take less now.
        w.economy.acceptsChanged();
        P.researchFed = P.tick;
      }
      P.note(`took ${o.from}'s ${card.kind} card: ${took.amount} (of ${o.cards.map((c) => c.kind).join(", ")})`);
    }
    // Research (once there's a school): the most wanted blueprint first, and the next most wanted up next. (A sensible
    // player waits for the most wanted one rather than starting lesser ones.) Others, and the wished-for ones with no
    // use yet, only with coins to spare.
    // (Past the first, not while the workshop is short of planks to build with: research takes planks off the line
    // before the workshop sees them, so a player keeps a few for track and buildings first.)
    // (Nor while what the line needs next waits on the workshop's planks: cars for the goods train, or a farm yard, mill or
    // quarry learned and not yet built. A new research would take the planks at the school first.)
    // (In the goals play-through, the harbour too: its stone at the workshop before another research's at the school.)
    const building = this.carsWait || (s.learned.has("farming") && this.farm === -1) || (s.learned.has("mills") && this.farm >= 0 && this.mill < 0) || (s.learned.has("quarries") && this.quarry === -1) || (s.learned.has("mines") && this.mine === -1) || (!this.goalsFirst && s.learned.has("foundry") && this.foundry === -1) || (this.goalsFirst && s.learned.has("harbours") && this.harbour === -1);
    if (this.school !== -1 && (P.researchedAt.length === 0 || P.planks() >= PICK_SPARE) && !building) {
      // (As before research: planks and coins to spare, 24 and 150.)
      const rich = P.planks() >= 24 && s.coins >= 150;
      // (Only what the railway can bring the goods for: Mills once there's a farm yard for its grain.)
      const made = new Set(w.economy.allDepots().flatMap((d) => RECIPES[d.role].gives));
      const feedable = (id: string) => Object.keys(researchCost(id).goods).every((k) => made.has(k as CargoKind));
      // (BALANCE_SPUR=routes: a farm on a spur, before Routes, sends no grain to the school, so Routes first, Mills after.)
      if (this.spurFarm && s.learned.has("routes")) this.spurFarm = false;
      const held = (id: string) => ROUTES_FIRST && this.spurFarm && id === "mills" && s.research.current !== "routes";
      const wish = this.goalsFirst ? GOALS_WISH : WISH;
      const wished = (ROUTES_FIRST && this.spurFarm ? ["routes", ...wish.filter((id) => id !== "routes")] : wish).filter((id) => (this.goalsFirst && id in GOALS_AFTER ? s.learned.has(GOALS_AFTER[id]) : !LATER.has(id)) && canResearch(s, id) && feedable(id));
      const others = TECHS.filter((t) => canResearch(s, t.id) && feedable(t.id) && (!wish.includes(t.id) || (LATER.has(t.id) && !wished.includes(t.id)))).map((t) => t.id);
      const r = s.research;
      // (In the goals' order, nothing past `GOALS_NEXT` is picked while one of them is still to learn: a goal's blueprint
      // not yet open to research, its own needs still being studied, keeps the slot it will take. Else Foundry, past
      // Harbours in the goals' order, took the slot up next while Warehouses was studied, its 10 stone and 10 coal before
      // Harbours' 20 stone, and the hoppers came by full of coal no stop took: Foundry stuck at 9 stone from minute 285
      // to 400 and more, Harbours never started.)
      const waiting = this.goalsFirst && GOALS_NEXT.some((id) => s.learned.has(GOALS_AFTER[id]) && !s.learned.has(id));
      // (The default run's player, past Quarries, also looks past what it can feed now (`towardChains`): what opens the
      // goods no industry on the line makes yet first (the Tank engine and the Goods engine toward Mines' coal, then
      // Mines, then Foundry's iron), even if not rich; and once none of its wishes is left to pick, the rest it can feed,
      // rich or not, rather than leave the school idle with coins in hand. Before Quarries the wish list's order stands:
      // the first city's growth comes first. The goals play-through keeps its own order.)
      const toward = !this.goalsFirst && s.learned.has("quarries") ? towardChains(s.learned, made, (id) => canResearch(s, id) && feedable(id) && !held(id), wish) : [];
      const idle = !this.goalsFirst && s.learned.has("quarries") && wished.every((id) => id === r.current || id === r.next);
      // (Of the rest, picked idle, a new goods chain's first: what opens a good no industry on the line makes (Smithy's
      // tools, once the foundry's iron comes: on seed 1, played on to 400, the iron from minute 225 went only to the
      // workshop's yard and Smithy was never picked); the rest in the blueprints' order, as before. Not what asks a good
      // of a chain the line has (ranked so, Diesel was picked on 8 of 9 seeds and on 4 still waited on its 8 flour at
      // minute 180), nor what such a one needs (Warehouses, College): either way fewer were researched by 180.)
      const rank = (id: string) => (goodsUnlocked(id).some((k) => !made.has(k)) ? 0 : 1);
      const rest = idle ? [...others].sort((a, b) => rank(a) - rank(b)) : others;
      const order = [...new Set([...toward, ...wished, ...(rich || idle ? rest : [])])];
      // (A filler, picked only as nothing wanted was left, gives way once a wanted one opens (a chain's or a wish's): the
      // wanted one up next, then swapped in ahead, the filler keeping what it had got. Else Junctions, picked idle at
      // 139 on seed 9, starved for planks while Mines, open at 155, waited behind it to 180.)
      const wanted = [...toward, ...wished].find((id) => !held(id));
      if (!this.goalsFirst && s.learned.has("quarries") && wanted !== undefined && r.current !== null && r.current !== wanted && !toward.includes(r.current) && !wished.includes(r.current)) {
        const coins = s.coins;
        if (r.next !== wanted) pickResearch(s, wanted);
        const where = r.next === wanted ? pickResearch(s, wanted) : null;
        P.spent.blueprintsCoins += coins - s.coins;
        if (where === "current") {
          P.happened++;
          P.w.economy.acceptsChanged();
          P.researchFed = P.tick;
          P.note(`research: ${techOf(wanted)!.label} swapped in ahead of ${techOf(r.next!)!.label} (${describeGoods(researchCost(wanted).goods)}${researchCost(wanted).coins ? ` + ${researchCost(wanted).coins} coins` : ""})`);
        }
      }
      for (const id of waiting ? wished.filter((x) => GOALS_NEXT.includes(x)) : order) {
        if (r.current !== null && r.next !== null) break;
        if (id === r.current || id === r.next || held(id)) continue;
        const coins = s.coins;
        const where = pickResearch(s, id);
        P.spent.blueprintsCoins += coins - s.coins;
        if (!where) continue;
        P.happened++;
        P.w.economy.acceptsChanged();
        P.researchFed = P.tick;
        P.note(`research: ${techOf(id)!.label} ${where === "current" ? "started" : "up next"} (${describeGoods(researchCost(id).goods)}${researchCost(id).coins ? ` + ${researchCost(id).coins} coins` : ""})`);
      }
      if (r.current === null && r.next !== null) this.why = `saving for ${techOf(r.next)!.label}'s research (${researchCost(r.next).coins} coins; have ${s.coins})`;
    }
    this.build();
    this.unstick();
    this.roomForMine();
    if (!this.why) {
      // Nothing to save for: say what's in the way (an empty board, what the towns want).
      const wants = w.landscape.towns
        .filter((t) => P.town.status(t.id).level > 0)
        .map((t) => {
          const st2 = P.town.status(t.id);
          const left = Object.entries(st2.wants).filter(([k, n]) => (st2.got[k as keyof typeof st2.got] ?? 0) < n!).map(([k]) => k);
          return `${t.name} wants ${left.join("+") || "nothing"}`;
        });
      this.why = `nothing to do (research: ${s.research.current ?? "none"}, next ${s.research.next ?? "none"}); ${wants.join("; ")}`;
    }
    // Key moments, for the summary.
    for (const id of ["farming", "mills", "quarries", "routes", "passengers", "halts", "carpentry", "mines", "foundry"])
      if (!(id in this.firsts) && (canResearch(s, id) || s.learned.has(id))) this.firsts[id] = Math.round(P.minute);
    const best = P.bestLevel();
    for (let l = 1; l <= best; l++) if (!(`level ${l}` in this.firsts)) this.firsts[`level ${l}`] = Math.round(P.minute);
  }

  build(): void {
    const P = this.p;
    const w = P.w;
    const s = P.progress;
    // The goal the player works on, in the goals' order, "Open a farm" and the other old industries' too: those come by
    // their own rules below (the old farm restored, a quarry built), and the goals after them wait for them, as a
    // player's do.
    const goal = GOALS.find((x) => !P.goals.isDone(x.id) && (x.needs ?? []).every((id) => s.learned.has(id)))?.id;
    const g = w.landscape.grid;

    // The school (the first village's present), as soon as it's in the box: on the straight of the line beside a
    // town that its Show me points at (spliced into the line, as the drop does).
    if (this.school === -1 && s.available(w, "piece:depot-school") > 0) {
      const id = schoolOn(w, P.editor, P.fixed);
      if (typeof id === "number") {
        this.school = id;
        P.settle();
        // (The school blueprint comes with it: towns don't build schools.)
        P.syncLandmarks();
        P.happened++;
        const d = w.economy.depotAtPiece(id)!;
        P.note(`placed the school on the line beside ${w.landscape.towns.find((t) => t.id === d.townId)?.name ?? "?"}`);
        this.firsts["school"] = Math.round(P.minute);
        if (this.lines) this.routeGoods();
      } else this.why = `the school: ${id.why}`;
    }

    // The workshop goal: dropped on the straight its guide points at (spliced into the line, as the drop does).
    if (this.shop === -1 && goal === "place-workshop") {
      const spot = GOALS.find((x) => x.id === "place-workshop")!.guide(w).marks[0];
      const straight =
        spot &&
        [...w.layout.pieceIds()].find((id) => {
          const p = w.layout.getPiece(id)!;
          return p.type === "straight-216" && Math.hypot(p.pose.x + 108 * Math.cos(p.pose.heading) - spot.x, p.pose.z + 108 * Math.sin(p.pose.heading) - spot.z) < 2 && !w.sim.pieceOccupied(id);
        });
      if (straight) {
        const p = w.layout.getPiece(straight)!;
        const pose = { ...p.pose };
        const y = p.y;
        P.editor.remove(straight);
        let id = P.editor.place("depot-workshop", pose, y, false);
        if (rulesFor(w)("depot-workshop", false, pose, y, id)) {
          P.editor.remove(id);
          const back = { x: pose.x + 216 * Math.cos(pose.heading), z: pose.z + 216 * Math.sin(pose.heading), heading: pose.heading + Math.PI };
          id = P.editor.place("depot-workshop", back, y, false);
        }
        this.shop = id;
        syncIndustries(w, true);
        P.settle();
        P.happened++;
        const d = (k: number) => Math.round(Math.hypot(pose.x - w.layout.getPiece(k)!.pose.x, pose.z - w.layout.getPiece(k)!.pose.z));
        P.note(`dropped the workshop on the line where its goal points (${d(st(P, 0))} mm from Larkfield's station, ${d(depotPiece(P, "sawmill"))} mm from the sawmill)`);
      } else this.why = "no spot for the workshop";
    }

    // The goal "Make a switch": ordered at the workshop's card (its planks are kept for it from then on, as the game does).
    if (goal === "make-switch" && s.learned.has("switches") && !s.orders.includes("piece:switch") && (s.owned.get("piece:switch") ?? 0) === 0) {
      P.crafting.order("piece:switch");
      P.happened++;
      P.note("ordered a switch at the workshop for the goal");
    }

    // The switch goal: a switch on the map (there's nothing to branch to yet: it goes down beside the line).
    if (!this.switchLaid && s.learned.has("switches") && goal === "lay-switch") {
      const why = P.make(new Map([["piece:switch", 1]]));
      if (!why) {
        const c = w.landscape.towns[1].centre;
        let ok = false;
        for (let r = 1; r < 12 && !ok; r++)
          for (let k = 0; k < 8 && !ok; k++) {
            const a = (k / 8) * Math.PI * 2;
            const pose = { x: Math.round((c.x + Math.cos(a) * r * 72) / 18) * 18, z: Math.round((c.z + 400 + Math.sin(a) * r * 72) / 18) * 18, heading: 0 };
            const cell = g.cellAtWorld(pose.x, pose.z);
            if (cell === -1) continue;
            const y = g.groundY(cell);
            if (rulesFor(w)("switch", false, pose, y, -1)) continue;
            P.editor.place("switch", pose, y, false);
            ok = true;
          }
        this.switchLaid = ok;
        P.note(ok ? "laid a switch beside the line for the goal (nothing to branch to yet)" : "COULDN'T lay a switch");
        if (ok) P.happened++;
      } else this.why = `a switch: ${why}`;
    }

    // Join a third town (and the bridge goal, if the way crosses a river): from a line end, once bridges are known
    // (a river may be in the way) or the goal asks for it.
    if (!this.joinedThird && (s.learned.has("bridges") || goal === "join-three") && P.goals.isDone("lay-switch")) {
      const on = townsOnLine(P);
      const others = w.landscape.towns.map((_, i) => i).filter((i) => !on.includes(i));
      const ends = lineEnds(P).map((e) => w.layout.worldConnector(e.ref, peg));
      const dist = (i: number) => Math.min(...ends.map((e) => Math.hypot(w.landscape.towns[i].centre.x - e.x, w.landscape.towns[i].centre.z - e.z)));
      others.sort((a, b) => dist(a) - dist(b));
      // The next nearest only with planks to spare: with few in the workshop's yard the nearest may just be short of
      // its ramps, and a farther town's line can leave the farm a branch an unrouted train never takes (seen once
      // "Make a switch" took the yard's planks: Mills waited on grain all game).
      for (const i of others.slice(0, P.planks() >= PICK_SPARE ? 2 : 1)) {
        const station = st(P, i);
        const r = extend(P, { target: () => [connectorRef(station, 0), connectorRef(station, 1)] });
        if (r) {
          const far = freeEnd(P, station);
          capEnd(P, far);
          this.joinedThird = true;
          P.happened++;
          P.note(`ran the line on to ${w.landscape.towns[i].name} (third town); ${[...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id)!.type.startsWith("bridge")).length} bridges, ${[...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id)!.type.startsWith("ramp")).length} ramps on the line`);
          break;
        }
      }
      if (!this.joinedThird) this.why = "couldn't join a third town yet";
    }
    // The bridge goal, if joining towns didn't need one: a bridge by itself.
    if (goal === "build-bridge" && s.learned.has("bridges") && (this.joinedThird || this.idle > 3)) {
      const why = P.make(new Map([["piece:bridge", 1]]));
      if (!why) {
        // Beside the line near Larkfield, at the height the game gives a bridge dropped there (up on its arches).
        const c = w.landscape.towns[0].centre;
        let laid = false;
        for (let r = 2; r < 14 && !laid; r++)
          for (let k = 0; k < 8 && !laid; k++) {
            const a = (k / 8) * Math.PI * 2;
            const pose = { x: Math.round((c.x + Math.cos(a) * r * 72) / 18) * 18, z: Math.round((c.z - 400 + Math.sin(a) * r * 72) / 18) * 18, heading: 0 };
            const y = looseHeight(w.landscape, w.layout, "bridge", false, pose, -1);
            const id = w.layout.addPiece("bridge", pose, y, false);
            const bad = rulesFor(w)("bridge", false, pose, y, id);
            w.layout.removePiece(id);
            if (bad) continue;
            P.editor.place("bridge", pose, y, false);
            laid = true;
          }
        P.note(laid ? "put a bridge down by itself for the goal (the line didn't cross a river)" : "COULDN'T put a bridge down");
        if (laid) P.happened++;
      } else this.why = `a bridge for the goal: ${why}`;
    }

    // The second train: when the box has an engine again (Signals' present), on the far half of the line.
    const engines = (s.owned.get("car:engine") ?? 0) - inUse(w, "car:engine");
    if (this.trains.size < 2 && engines > 0 && this.lifted === 0 && goal === "two-trains") {
      const cars: CarKind[] = s.learned.has("passengers") ? ["engine", "passenger", "passenger"] : ["engine", "timber"];
      // (The people train, once routes are learned: its passing loop laid on the line first, and the train put down on
      // it, out of the goods train's way, as a player who knows two trains need a place to pass does. With no loop to be
      // had (no room, or the switches can't be made yet), put down as before, run by hand.)
      const loop = cars.includes("passenger") ? this.peopleLoop() : null;
      const spot = loop ? this.onLoop(loop) : [...w.layout.pieceIds()].find((id) => !P.fixed.has(id) && w.layout.getPiece(id)!.type.startsWith("straight") && w.layout.getPiece(id)!.pose.x > 700 && !w.sim.pieceOccupied(id));
      if (spot !== undefined) {
        const e = P.train(cars, spot, 1);
        if (typeof e === "number") {
          this.trains.set(e, cars.includes("passenger") ? "people" : "timber 2");
          P.note(`second train (${cars.join(", ")}) set going${loop ? `, on its passing loop${this.peopleLine(e)}` : ""}`);
        }
      }
    }
    // The goods train standing a good while waiting for the people train (its card: "Waiting for the train on the Blue
    // line"): looked at every 10 minutes, 2 minutes of waiting or more, the player lays another passing loop where it
    // waits (up to 4 for the two lines).
    if (P.minute - this.waitLookAt >= 10) {
      this.waitLookAt = P.minute;
      const stood = P.stoodWaiting.get(this.timber) ?? 0;
      const found = w.sim.findCar(this.timber);
      if (stood - this.stoodAt >= 120 && this.peopleLoops.length + this.stuckLoops.length > 0 && this.peopleLoops.length + this.stuckLoops.length < 4 && found && [...this.trains.values()].includes("people") && this.lineId >= 0) {
        const line = w.economy.lines.get(this.lineId);
        const stops = line ? [...new Set(line.stops.map((st) => w.economy.depot(st.depotId)!.pieceId))] : [];
        const longest = Math.max(450, LONGEST_PEOPLE, ...[...this.trains.keys()].map((e) => (w.sim.findCar(e) ? trainLength(w.sim.findCar(e)!.train) : 0)));
        const at = found.train.world[0];
        const loop = spliceLoop(P, stops, longest, this.loopPieces, { x: at.x, z: at.z });
        if (loop) {
          P.happened++;
          this.stuckLoops.push(Math.round(P.minute));
          for (const id of loop) this.loopPieces.add(id);
          P.note(`the goods train stood ${((stood - this.stoodAt) / 60).toFixed(1)} min in 10 waiting for the people train: laid another passing loop where it waits (${loop.length} pieces)`);
        } else P.note(`the goods train stood ${((stood - this.stoodAt) / 60).toFixed(1)} min in 10 waiting for the people train: COULDN'T lay another passing loop (no room, or 2 switches to make)`);
      }
      this.stoodAt = stood;
    }
    // The people train picked up when stuck, put back on once a passing loop for it is laid (once a loop).
    if (this.peopleLoops.length + this.stuckLoops.length > this.peopleBack && this.trains.size < 2 && engines > 0 && s.learned.has("passengers") && ![...this.trains.values()].includes("people")) {
      const cars: CarKind[] = ["engine", "passenger", "passenger"];
      // (On the passing loop, out of the goods train's way: where two trains wait for each other to pass.)
      const spot = this.onLoop(this.stuckLoop);
      if (spot !== undefined && P.canMake(thingsFor({ kind: "train", cars }))) {
        const e = P.train(cars, spot, 1);
        if (typeof e === "number") {
          this.peopleBack++;
          this.trains.set(e, "people");
          P.note(`the people train put back on, the line's passing loop laid${this.peopleLine(e)}`);
        }
      }
    }
    // Passengers learned: the second train carries people (two coaches).
    if (s.learned.has("passengers") && ![...this.trains.values()].includes("people") && this.trains.size >= 2) {
      const [e] = [...this.trains].find(([, k]) => k === "timber 2") ?? [];
      if (e !== undefined && P.canMake(new Map<ThingId, number>([["car:passenger", 2]]))) {
        const found = w.sim.findCar(e);
        const on = found ? found.train.bogies[0].pieceId : -1;
        P.lift(e);
        this.trains.delete(e);
        // (Its passing loop first, once routes are learned, and the train put down on it: as for the second train.)
        const loop = this.peopleLoop();
        const n = P.train(["engine", "passenger", "passenger"], (loop && this.onLoop(loop)) ?? on, 1);
        if (typeof n === "number") {
          this.trains.set(n, "people");
          P.note(`the second train is now a passenger train (engine, 2 coaches)${loop ? `, on its passing loop${this.peopleLine(n)}` : ""}`);
        } else P.note(`passenger train: ${n}`);
      }
    }

    // The farm: the old farm restored when it's near the line (map sites step 2: cheaper than a new one), else a farm
    // yard by the fields at a line end, with room for a mill after it.
    if (this.farm === -1 && s.learned.has("farming") && P.minute - this.farmTry >= 10) {
      const old = this.restoreOld("farm");
      if (old === "wait") {
        if (s.coins < restorePrice("farm").coins) this.coinWait.farm++;
        this.why = `restoring the old farm (${describeGoods(restorePrice("farm").goods)} + ${restorePrice("farm").coins} coins; have ${P.planks()} planks, ${s.coins} coins)`;
      } else if (old) {
        this.farmTry = P.minute;
        this.farm = old.id;
        capEnd(P, old.beyond);
        syncIndustries(w, true);
        updateRates(w, (role) => boostOf(s, role));
        P.happened++;
        P.note(`restored the old farm, the line run on to it or a spur laid (rate ${w.economy.depotAtPiece(old.id)!.rate.toFixed(2)})`);
        this.firsts["farm built"] = Math.round(P.minute);
        this.firsts["farm restored"] = Math.round(P.minute);
        if (this.lines) this.routeGoods();
      } else if (P.canMake(new Map([["piece:depot-farm", 1]]))) {
        this.farmTry = P.minute;
        // (The map's own fields: not an old farm's, whose ruin stands by them. A farm yard by the ruin's fields on a
        // branch from the line was a branch the unrouted goods train never took (4 of 9 seeds, step 1): the old farm is
        // restored instead (its stub the line's end, or on a spur whose switch the player sets by hand) when it's within
        // reach; this is for when it isn't.)
        const fields: number[] = [];
        const ruins = new Set((w.landscape.sites ?? []).flatMap((x) => x.fields));
        g.forEachCell((i) => {
          if (g.feature[i] === FEAT_FIELD && !ruins.has(g.owner[i])) fields.push(i);
        });
        P.make(new Map([["piece:depot-farm", 1]]));
        const r = extend(P, { type: "depot-farm", cells: fields, after: "depot-mill" }) ?? (s.learned.has("switches") ? branchOff(P, "depot-farm", fields, "depot-mill") : null);
        if (r) {
          this.farm = r.id;
          capEnd(P, r.beyond);
          syncIndustries(w, true);
          updateRates(w, (role) => boostOf(s, role));
          P.happened++;
          P.note(`built a farm yard at the line's end (rate ${w.economy.depotAtPiece(r.id)!.rate.toFixed(2)})`);
          this.firsts["farm built"] = Math.round(P.minute);
          if (this.lines) this.routeGoods();
        } else {
          P.note("COULDN'T reach a farm site from the line's ends (or a branch)");
          s.add("piece:depot-farm", 0);
        }
      } else {
        // Waiting on coins alone (the planks are there): counted, for the summary.
        if (s.coins < ruleOf("piece:depot-farm")!.coins! && P.planks() >= (ruleOf("piece:depot-farm")!.cost.planks ?? 0)) this.coinWait.farm++;
        this.why = `a farm yard (${describeGoods(ruleOf("piece:depot-farm")!.cost)} + ${ruleOf("piece:depot-farm")!.coins} coins; have ${P.planks()} planks, ${s.coins} coins)`;
      }
    }
    // The mill ordered at the workshop's card while it can't be made yet (`orderMill`), so the yard keeps its planks.
    this.orderMill();
    // The mill, after the farm yard.
    if (this.farm >= 0 && this.mill === -1 && s.learned.has("mills")) {
      if (P.canMake(new Map([["piece:depot-mill", 1]]))) {
        const end = freeEnd(P, this.farm);
        const buf = end === -1 ? lineEnds(P).find((e) => pieceOfRef(e.ref) === this.farm) : { buffer: -1, ref: end };
        if (buf && (buf.buffer === -1 || !w.sim.pieceOccupied(buf.buffer))) {
          P.crafting.cancel("piece:depot-mill");
          P.make(new Map([["piece:depot-mill", 1]]));
          if (buf.buffer !== -1) P.editor.remove(buf.buffer);
          const id = industryAt(P, "depot-mill", buf.ref);
          if (id !== -1) {
            this.mill = id;
            capEnd(P, freeEnd(P, id));
            syncIndustries(w, true);
            P.happened++;
            P.note("built a mill after the farm yard");
            if (this.lines) this.routeGoods();
          } else {
            capEnd(P, buf.ref);
            P.note("the mill won't go after the farm yard");
            this.mill = -2;
          }
        }
      } else this.why = `a mill (${describeGoods(ruleOf("piece:depot-mill")!.cost)} + ${ruleOf("piece:depot-mill")!.coins} coins; have ${P.planks()} planks, ${s.coins} coins)`;
    }
    // A mill that won't go after the farm yard goes at another line end, or on a branch, near the farm or a town.
    if (this.mill === -2 && s.learned.has("mills") && P.minute - this.millTry >= 10) {
      if (P.canMake(new Map([["piece:depot-mill", 1]]))) {
        this.millTry = P.minute;
        const near = [this.farm, ...w.stations.values()].map((id) => w.layout.getPiece(id)).filter((p) => !!p).map((p) => g.cellAtWorld(p!.pose.x, p!.pose.z)).filter((i) => i !== -1);
        P.crafting.cancel("piece:depot-mill");
        P.make(new Map([["piece:depot-mill", 1]]));
        const r = extend(P, { type: "depot-mill", cells: near }) ?? (s.learned.has("switches") ? branchOff(P, "depot-mill", near) : null);
        if (r) {
          this.mill = r.id;
          capEnd(P, r.beyond);
          syncIndustries(w, true);
          P.happened++;
          P.note("built a mill at another line end");
          if (this.lines) this.routeGoods();
        } else P.note("COULDN'T find a place for the mill");
      } else this.why = `a mill (${describeGoods(ruleOf("piece:depot-mill")!.cost)} + ${ruleOf("piece:depot-mill")!.coins} coins; have ${P.planks()} planks, ${s.coins} coins)`;
    }
    // The goods train carries what the line makes (a hopper once there's a farm, a van once there's a mill, another
    // hopper for stone, coaches once people ride), as many cars as its engine pulls: a goods engine's 8 once learned.
    // One train for everything: a second on the single line only turns the first back.
    const goodsLook = s.learned.has("goods-engine");
    const pulls = goodsLook ? 8 : 4;
    const want: CarKind[] = ["timber", "timber"];
    if (this.farm >= 0) want.push("hopper");
    if (this.mill >= 0) want.push("van");
    if (this.quarry >= 0) want.push("hopper");
    // (In the goals play-through, once the mine stands, a third hopper for the stone Harbours and the harbour want, in
    // place of the second coach: the two hoppers came by full of grain or the mine's coal, and stone came 4 a lap.)
    if (s.learned.has("passengers")) want.push("passenger", this.goalsFirst && this.mine >= 0 ? "hopper" : "passenger");
    if (this.farm < 0 && !s.learned.has("passengers")) want.push("timber");
    // (A goods engine's spare pull, once it has one: a third flatbed, for more logs a lap. P5: the one train saws only
    // what its flatbeds bring, round a line of 20 stops or more.)
    if (!ENV.BALANCE_NOFILL && goodsLook && want.length < pulls) want.push("timber");    const kinds: CarKind[] = ["engine", ...want.slice(0, pulls)];
    const found = w.sim.findCar(this.timber);
    const current = found?.train.cars.map((c) => c.kind).sort().join(",");
    const look = found ? w.sim.lookOf(this.timber) : "classic";
    if (found && (current !== [...kinds].sort().join(",") || (goodsLook && look !== "goods")) && P.minute - this.recomposed >= 3) {
      // (Its own cars come back to the box as it's picked up: only what's short beyond them is made.)
      const on = found.train.bogies[0].pieceId;
      const had = found.train.cars.map((c) => c.kind);
      const short = new Map<ThingId, number>();
      for (const [id, n] of thingsFor({ kind: "train", cars: kinds })) {
        const back = had.filter((k) => `car:${k}` === id).length;
        const k = n - P.progress.available(w, id) - back;
        if (k > 0) short.set(id, k);
      }
      if (short.size === 0 || craftShort(w, s, short) === null) {
        this.recomposed = P.minute;
        P.lift(this.timber);
        this.trains.delete(this.timber);
        const e = P.train(kinds, on, -1);
        if (typeof e === "number") {
          this.timber = e;
          this.trains.set(e, "goods");
          if (goodsLook) w.sim.setLook(e, "goods");
          P.note(`the goods train is now ${goodsLook ? "a goods engine" : "an engine"} with ${kinds.slice(1).join(", ")}`);
          if (this.lines) this.routeGoods();
        } else {
          const back = P.train(had, on, -1);
          if (typeof back === "number") {
            this.timber = back;
            this.trains.set(back, "goods");
            if (look !== "classic") w.sim.setLook(back, look);
          }
          P.note(`couldn't make the new goods train: ${e}`);
        }
      } else {
        this.why = `cars for the goods train: ${[...short].map(([id, n]) => `${n} ${id}`).join(", ")}`;
        this.carsWait = true;
      }
    } else if (found && current === [...kinds].sort().join(",")) this.carsWait = false;

    // Routes: each train runs a line of the depots along the track, in order, "auto" at each (the intent rules).
    if (!this.lines && s.learned.has("routes") && !ENV.BALANCE_NOLINES) {
      this.lines = true;
      this.routeGoods();
      P.happened++;
    }
    // With more than one train for the line, passing loops on it first (one per extra train, mid-way between two
    // stops), once switches are learned and can be made (BALANCE_NOLOOP=1: none; BALANCE_LOOPS=n: n).
    if (this.lines && this.lineId >= 0 && PER_LINE > 1 && this.loopsAt.length < LOOPS && P.progress.knows("piece:switch") && P.minute - this.loopsTry >= 3) {
      this.loopsTry = P.minute;
      const line = w.economy.lines.get(this.lineId);
      const stops = line ? [...new Set(line.stops.map((st) => w.economy.depot(st.depotId)!.pieceId))] : [];
      const longest = Math.max(0, ...[...w.economy.lineIdOf].filter(([, id]) => id === this.lineId).map(([e]) => (w.sim.findCar(e) ? trainLength(w.sim.findCar(e)!.train) : 0)));
      const loop = spliceLoop(P, stops, Math.max(longest, 450), this.loopPieces);
      // (A splice must leave every way between the line's stops joined: one left open strands the line's trains.)
      if (loop && lineLegs(w.layout, stops).some((leg) => leg === null)) P.findings.push(`Minute ${P.minute.toFixed(0)}: a passing loop left the line open (a way between its stops is broken).`);
      if (loop) {
        P.happened++;
        this.loopsAt.push(Math.round(P.minute));
        for (const id of loop) this.loopPieces.add(id);
        P.note(`laid a passing loop on the line (${loop.length} pieces): ${this.loopsAt.length} now`);
      } else this.why ||= "a passing loop for the line (no room, or 2 switches to make)";
    }
    // More trains on the line as they become affordable (an engine and two flatbeds), up to BALANCE_TRAINS_PER_LINE,
    // a few minutes apart; one fewer for each that jammed the line. (With loops scripted, the next train waits for its
    // loop, as a player who knows the line needs one would.)
    const loopFirst = this.loopsAt.length < Math.min(LOOPS, this.trains.size);
    if (loopFirst && this.lines && this.trains.size < PER_LINE - this.jamCut) this.why ||= "another train for the line, once it has a passing loop";
    if (!loopFirst && this.lines && this.lineId >= 0 && this.trains.size < PER_LINE - this.jamCut && P.minute - this.extraAt >= 3) {
      const cars: CarKind[] = ["engine", "timber", "timber"];
      if (P.canMake(thingsFor({ kind: "train", cars }))) {
        const e = P.train(cars, -1, 1);
        if (typeof e === "number") {
          this.trains.set(e, `line train ${this.trains.size + 1}`);
          joinLine(w.economy, e, this.lineId);
          this.extraAt = P.minute;
          P.note(`another train (engine, 2 flatbeds) on the line: ${trainsOn(w.economy, this.lineId).length} now`);
        }
      } else this.why ||= `another train for the line (engine 6🪵 + 2 flatbeds 6🪵; have ${P.planks()} planks)`;
    }
    // A second goods train on a long line (P5 (h), only with BALANCE_SECOND_GOODS: see `SECOND_GOODS_STOPS`): one
    // train hauls only so much a pass round 15 stops or more, and the research and the towns wait on it. As the game
    // has it, only with Signals learned (the goal "Run two trains at once" waits for them, and their present is the
    // second engine) and a passing loop on the line, where trains running opposite ways can pass (laid first, halfway
    // along the line: two trains spaced half a lap apart on a line there and back meet about halfway); not again once
    // it has jammed the line. A sensible player adds it only when the one goods train can't keep up (`goodsShort`: a
    // good wanted on the line for `SECOND_GOODS_SATURATED` minutes in a row while its source's pile is full), with
    // cars for what's short (`secondGoodsCars`), and only once the line runs nothing but its goods train (the people
    // train, on no line, is in the way of both).
    const stops = this.lineId >= 0 ? (w.economy.lines.get(this.lineId)?.stops.length ?? 0) : 0;
    const longLine = this.lines && stops >= SECOND_GOODS_STOPS && s.learned.has("signals");
    const short = longLine ? this.goodsShort() : [];
    const wantsSecond = longLine && this.goods2At < 0 && this.goods2Cut === 0 && this.trains.size === 1 && short.length > 0;
    if (wantsSecond && !this.loop && P.minute - this.loopTry >= 10) {
      this.loopTry = P.minute;
      if (P.canMake(new Map<ThingId, number>([["piece:switch", 2]]))) {
        const order = lineOrder(P);
        const half = w.economy.depot(order[Math.floor(order.length / 2)]);
        const at = half && w.layout.getPiece(half.pieceId)?.pose;
        // (With room for the longest goods train: the goods train made up later still passes there.)
        const stopPieces = [...new Set(order.map((d) => w.economy.depot(d)?.pieceId ?? -1))].filter((id) => id !== -1);
        this.loop = at ? passingLoop(P, at, LONGEST_GOODS, stopPieces) : null;
        if (this.loop) {
          P.happened++;
          P.note(`laid a passing loop (2 switches${ENV.BALANCE_LOOP_PIN ? ", pinned" : ""}) halfway along the ${stops}-stop line`);
        } else P.note("COULDN'T lay a passing loop on the line");
      } else this.why ||= `a passing loop (2 switches; have ${P.planks()} planks)`;
    }
    if (wantsSecond && this.loop) {
      const cars: CarKind[] = ["engine", ...secondGoodsCars(short)];
      if (P.canMake(thingsFor({ kind: "train", cars }))) {
        const e = P.train(cars, -1, 1);
        if (typeof e === "number") {
          this.trains.set(e, "goods 2");
          joinLine(w.economy, e, this.lineId);
          this.goods2At = P.minute;
          this.goods2Made = P.minute;
          this.goods2For = short.join("+");
          P.note(`second goods train (${cars.slice(1).join(", ")}) for ${this.goods2For} on the ${stops}-stop line: ${trainsOn(w.economy, this.lineId).length} trains on it now`);
        }
      } else this.why ||= `a second goods train for the ${stops}-stop line (${cars.join(", ")}; have ${P.planks()} planks)`;
    }
    // What it went on for no longer short, and something else short (the planks in, the flour not): the second goods
    // train made up again for that, as the goods train is (its cars back to the box first), at most every 15 minutes
    // (BALANCE_SECOND_FIXED=1: never).
    const [e2] = [...this.trains].find(([, k]) => k === "goods 2") ?? [];
    const found2 = e2 === undefined ? undefined : w.sim.findCar(e2);
    const stillShort = this.goods2For.split("+").some((k) => (this.shortFor.get(k as CargoKind) ?? 0) > 0);
    if (found2 && short.length > 0 && !stillShort && !ENV.BALANCE_SECOND_FIXED && P.minute - this.goods2Made >= 15) {
      const want = ["engine", ...secondGoodsCars(short)] as CarKind[];
      const had = found2.train.cars.map((c) => c.kind);
      // (Only if what's needed beyond its own cars, back in the box, can be made: else it runs on as it is.)
      const lack = new Map<ThingId, number>();
      for (const [id, n] of thingsFor({ kind: "train", cars: want })) {
        const k = n - P.progress.available(w, id) - had.filter((c) => `car:${c}` === id).length;
        if (k > 0) lack.set(id, k);
      }
      if ([...want].sort().join(",") !== [...had].sort().join(",") && (lack.size === 0 || craftShort(w, s, lack) === null)) {
        this.goods2Made = P.minute;
        const on = found2.train.bogies[0].pieceId;
        P.lift(e2!);
        this.trains.delete(e2!);
        let e = P.train(want, on, 1);
        const made = typeof e === "number";
        if (!made) e = P.train(had, on, 1);
        if (typeof e === "number") {
          this.trains.set(e, "goods 2");
          joinLine(w.economy, e, this.lineId);
        }
        if (made) this.goods2For = short.join("+");
        P.note(made ? `the second goods train is now ${want.slice(1).join(", ")} for ${this.goods2For}` : `couldn't make the second goods train up again for ${short.join("+")}`);
      }
    }
    if (this.lineId >= 0) this.perLine = Math.max(this.perLine, trainsOn(w.economy, this.lineId).filter((e) => w.sim.findCar(e)).length);

    // A harvester (a forest yard of the player's own) by trees at a line end, for more logs.
    if (this.harvester === -1 && s.learned.has("harvesters") && P.minute - this.harvesterTry >= 10) {
      if (P.canMake(new Map([["piece:depot-forest", 1]]))) {
        this.harvesterTry = P.minute;
        const trees: number[] = [];
        g.forEachCell((i) => {
          if (g.feature[i] === FEAT_TREE) trees.push(i);
        });
        P.make(new Map([["piece:depot-forest", 1]]));
        const r = extend(P, { type: "depot-forest", cells: trees }) ?? (s.learned.has("switches") ? branchOff(P, "depot-forest", trees) : null);
        if (r) {
          this.harvester = r.id;
          capEnd(P, r.beyond);
          syncIndustries(w, true);
          updateRates(w, (role) => boostOf(s, role));
          P.happened++;
          P.note(`built a harvester (rate ${w.economy.depotAtPiece(r.id)!.rate.toFixed(2)})`);
          if (this.lines) this.routeGoods();
        } else P.note("COULDN'T reach a harvester site");
      } else this.why ||= `a harvester (${describeGoods(ruleOf("piece:depot-forest")!.cost)} + ${ruleOf("piece:depot-forest")!.coins} coins; have ${P.planks()} planks, ${s.coins} coins)`;
    }
    // Fields for the farm yard while it works below full speed, with coins to spare (its card's "Plant a field").
    if (this.farm >= 0 && s.coins >= fieldPrice(s.fieldsPlanted) + 60) {
      const piece = w.layout.getPiece(this.farm);
      const r = piece && resourceAt(w.landscape, "farm", piece.pose);
      if (piece && r && r.count < r.need) {
        const editor = new LandEditor(w.landscape, w.layout, { inRect: (x0, z0, x1, z1) => propsInRect(w.props, footprintOf, x0, z0, x1, z1) });
        const cells = fieldSpot(w.landscape, editor, yardMiddle(piece.pose), SITE_RULES.farm!.reach);
        if (cells) {
          const price = fieldPrice(s.fieldsPlanted);
          s.coins -= price;
          s.fieldsPlanted++;
          P.spent.buildCoins += price;
          plantField(w.landscape, cells);
          updateRates(w, (role) => boostOf(s, role));
          P.happened++;
          P.note(`planted a field for ${price} coins (farm yard at ${Math.round(rateFor(r.count + 4, r.need) * 100)}%)`);
        }
      }
    }

    // Halts: a country halt in the line near a town (its people share the town's).
    if (this.halt === -1 && s.learned.has("halts") && P.canMake(new Map([["piece:kit-country-halt", 1]]))) {
      const on = townsOnLine(P);
      const station = (i: number) => w.layout.getPiece(st(P, i))!.pose;
      const candidates = [...w.layout.pieceIds()].filter((id) => {
        const p = w.layout.getPiece(id)!;
        if (P.fixed.has(id) || p.type !== "straight-216" || w.sim.pieceOccupied(id)) return false;
        const town = haltTown(w.landscape, p.pose);
        if (!town) return false;
        const i = w.landscape.towns.indexOf(town);
        return on.includes(i) && Math.hypot(p.pose.x - station(i).x, p.pose.z - station(i).z) > 400;
      });
      for (const id of candidates) {
        const p = w.layout.getPiece(id)!;
        const pose = { ...p.pose };
        const y = p.y;
        const joined = [0, 1].map((c) => w.layout.joinedConnector(connectorRef(id, c)));
        P.editor.remove(id);
        const ok = !rulesFor(w)("kit-country-halt", p.flipped, pose, y, -1) && !haltWhy(w.landscape, "kit-country-halt", pose);
        if (ok) {
          const h = P.editor.place("kit-country-halt", pose, y, p.flipped);
          const both = [0, 1].every((c) => w.layout.joinedConnector(connectorRef(h, c)) !== -1);
          if (both) {
            P.make(new Map([["piece:kit-country-halt", 1]]));
            syncIndustries(w, true);
            this.halt = h;
            P.happened++;
            P.note(`a country halt in the line near ${haltTown(w.landscape, pose)!.name} (joined: ${joined.every((j) => j !== -1)})`);
            if (this.lines) this.routeGoods();
            break;
          }
          P.editor.remove(h);
        }
        P.editor.place("straight-216", pose, y, p.flipped);
      }
      if (this.halt === -1) {
        this.halt = -2;
        P.note("no straight near a town for a halt");
      }
    }

    // The quarry (a city's library opens it), then the mine (Mines), then the harbour (Harbours): each an old one
    // restored where one is in reach, else a new one at a line end or on a branch, by its resource (`openIndustry`).
    this.openIndustry("quarry");
    this.openIndustry("mine");
    this.openIndustry("harbour");
    // (The default run: a foundry once Foundry is learned, for the iron Smithy, Electricity and the electric engine ask.)
    if (!this.goalsFirst) this.openIndustry("foundry");
    // (The mine's coal or ore on a train, the first minute it's seen: for the long goals play-through's check.)
    if (this.mine >= 0 && this.firsts["mine's goods carried"] === undefined)
      for (const id of w.sim.trainIds())
        if (w.sim.getTrain(id)!.cars.some((c) => ["coal", "ore"].includes(w.economy.cargoOf(c.id).kind ?? ""))) {
          this.firsts["mine's goods carried"] = Math.round(P.minute);
          P.note("the mine's goods on a train");
          break;
        }
    // Every town on the railway (the goal "Connect every town"): `joinTowns`.
    this.joinTowns();
    this.buyLand();
  }

  /** A plot bought (the goal "Buy some land"). */
  boughtLand = false;
  /** The towns the map had before (the land bought brings more: not joined). */
  townsBeforeLand = -1;
  /**
   * The goals play-through only, once every town is joined (the goals' order: more land, more towns to join): the
   * plot for sale nearest the start bought, its price paid, as the land card's "Add this land" does (`unlockPlot`,
   * as `Game.unlockPlot`). (Not in the balance run: its SUMMARY lines stay as they were.)
   */
  buyLand(): void {
    const P = this.p;
    if (!this.goalsFirst || this.boughtLand || !P.goals.isDone("join-all")) return;
    const price = plotPrice(P.w.landscape.grid.plots.length);
    if (P.progress.coins < price) return;
    const plot = plotsForSale(P.w.landscape).sort((a, b) => Math.hypot(a.px + 0.5, a.pz + 0.5) - Math.hypot(b.px + 0.5, b.pz + 0.5))[0];
    const before = P.w.landscape.towns.length;
    if (!plot || !unlockPlot(P.w, plot.px, plot.pz)) return;
    P.progress.coins -= price;
    P.fixed = fixedPieces(P.w);
    this.boughtLand = true;
    // (Every plot for sale has a town: the new ones aren't joined, "Connect every town" was met before and stays.)
    this.townsBeforeLand = before;
    this.firsts["land bought"] = Math.round(P.minute);
    P.note(`bought the plot ${plot.px},${plot.pz} for ${price} coins`);
  }

  /** The farm is an old one restored on a spur, and Routes isn't learned yet: the line's train calls only if sent. */
  spurFarm = false;
  /** The spur's switch (−1: none). */
  spurSwitch = -1;
  /** The line's side of the spur's switch (its trunk's): its pieces, found again each minute of play. */
  private trunkSide = { minute: -1, ids: new Set<number>() };

  /**
   * Before Routes (unless BALANCE_SPUR=routes), each second: the player sets the spur's switch by hand, as a child does,
   * toward the old farm while grain is wanted (by the research or a mill), the goods train is on the line's side of the
   * switch (it runs up to it from there, at once or after turning back), its hoppers are empty and the farm has a
   * load; back to the line otherwise (so once it's loaded). Never while a train is on the switch.
   */
  tendSpur(): void {
    const P = this.p;
    const w = P.w;
    const L = w.layout;
    const sw = this.spurSwitch;
    if (!this.spurFarm || sw < 0 || !L.getPiece(sw) || P.progress.learned.has("routes")) {
      P.everySecond = null;
      return;
    }
    if (w.sim.pieceOccupied(sw)) return;
    if (this.trunkSide.minute !== Math.floor(P.minute)) {
      const ids = new Set<number>([sw]);
      const stack = [L.joinedConnector(connectorRef(sw, 0))].filter((j) => j !== -1).map(pieceOfRef);
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (ids.has(id)) continue;
        ids.add(id);
        const p = L.getPiece(id)!;
        for (let c = 0; c < getPieceDef(p.type, p.flipped).connectors.length; c++) {
          const j = L.joinedConnector(connectorRef(id, c));
          if (j !== -1) stack.push(pieceOfRef(j));
        }
      }
      ids.delete(sw);
      this.trunkSide = { minute: Math.floor(P.minute), ids };
    }
    const farm = w.economy.depotAtPiece(this.farm);
    const grain = farm ? farm.piles[CARGO.grain.index] : 0;
    // (Only while grain is wanted: by the research (Mills), or a mill. Else the train keeps to the line and its planks.)
    const r = P.progress.research;
    const wanted = [r.current, r.next].some((id) => id !== null && (researchCost(id).goods.grain ?? 0) > 0) || w.economy.allDepots().some((d) => RECIPES[d.role].takes.includes("grain"));
    let want = false;
    if (!wanted) {
      if (L.switchState(sw) === 1) w.sim.toggleSwitch(sw);
      return;
    }
    for (const id of w.sim.trainIds()) {
      const t = w.sim.getTrain(id)!;
      const hoppers = t.cars.filter((c) => c.kind === "hopper");
      if (hoppers.length === 0) continue;
      const empty = hoppers.every((c) => w.economy.cargoOf(c.id).count === 0);
      if (empty && grain >= 3 && this.trunkSide.ids.has(t.bogies[0].pieceId)) want = true;
    }
    if ((L.switchState(sw) === 1) !== want) w.sim.toggleSwitch(sw);
  }
  /**
   * A farm on a spur (`spurSwitch`): the mill ordered at the workshop's card (as the switch is for its goal) once Mills
   * is learned, while the workshop can't make it yet, so the yard keeps the mill's 8 planks (`yardKeeps`: a waiting
   * order's). Without the order the yard keeps only `WORKSHOP_SPARE` (7) while a town on the line wants planks, one
   * short of the mill, and research waits on the mill (`building`). With the farm on the line that wait is short (the
   * planks come round soon); with it on a spur, the routed train's trip down it and back each round leaves the sawmill
   * waiting for logs, and the yard sat at 7 planks, the coins there, for most of an hour (BALANCE_SPUR=1: seed 5, Mills
   * at 33, the mill at 85 and the City at 109; seed 9, 43, 76 and 98). Ordered, the mill came at 46 and 45, the City at
   * 87 and 70; on the other seeds the coins came last and the mill at the same minute. (Not with the farm on the line:
   * there the order moved the mill up enough to put seed 2's City before
   * the band's 60, at 57, and seed 4's research stall past 15 minutes.) A waiting order is taken off when the harness
   * makes the mill itself (`build`), so only one is made. Still needed with the game's `shopSpare`: it raises the
   * spare for the mill only while a research waits for flour, and this player picks no research till the mill is
   * built, so the yard would keep 7 (all 18 runs were the same with it as without).
   */
  orderMill(): void {
    const P = this.p;
    const s = P.progress;
    const id: ThingId = "piece:depot-mill";
    if (this.spurSwitch < 0 || this.farm < 0 || this.mill >= 0 || !s.learned.has("mills") || s.orders.includes(id) || (s.owned.get(id) ?? 0) > 0) return;
    if (P.canMake(new Map([[id, 1]]))) return;
    P.crafting.order(id);
    P.happened++;
    P.note(`ordered a mill at the workshop (have ${P.planks()} planks, ${s.coins} coins): its planks kept in the yard`);
  }

  /** Ruins found out of reach, or that couldn't be restored: not tried again. */
  private readonly ruinsPassed = new Set<number>();
  /** When the line last couldn't be run to a ruin (it's tried again 5 minutes on). */
  private ruinTry = -99;

  /** Stone trains had unloaded at the workshop when the harbour was paid for (`Player.shopStoneIn`; −1: no harbour). */
  harbourStone = -1;
  /** When each "Open a …" industry was last tried (minutes). */
  private readonly industryTry: Record<"quarry" | "mine" | "harbour" | "foundry", number> = { quarry: -99, mine: -99, harbour: -99, foundry: -99 };
  /** A good an industry's price asks of the workshop's yard that the yard never takes, said once. */
  private readonly neverPaid = new Set<string>();

  /**
   * An industry for its "Open a …" goal, once its blueprint is learned (tried every 10 minutes till one stands): the
   * old one restored if one is in reach of the line (`restoreOld`, its price paid), else a new one made at the
   * workshop and placed at a line end, or on a branch off the line (`branchOff`), by its resource (`SITE_RULES`):
   * hillside for a quarry or a mine, water the boats come in on for a harbour.
   */
  openIndustry(role: "quarry" | "mine" | "harbour" | "foundry"): void {
    const P = this.p;
    const w = P.w;
    const s = P.progress;
    const g = w.landscape.grid;
    const type: PieceTypeId = role === "foundry" ? "depot-foundry" : restoredType(role);
    const thing = pieceThing(type);
    if (this[role] !== -1 || !s.knows(thing) || P.minute - this.industryTry[role] < 10) return;
    const opened = (id: number, beyond: number, how: string): void => {
      this[role] = id;
      capEnd(P, beyond);
      syncIndustries(w, true);
      updateRates(w, (r) => boostOf(s, r));
      P.happened++;
      P.note(`${how} (rate ${w.economy.depotAtPiece(id)!.rate.toFixed(2)})`);
      this.firsts[`${role} built`] = Math.round(P.minute);
      if (role === "harbour") {
        this.harbourStone = P.shopStoneIn;
        P.note(`  (the workshop has had ${P.shopStoneIn} stone off trains)`);
      }
      if (this.lines) this.routeGoods();
    };
    // (A foundry has no old one on the map: always a new one.)
    const site = role === "foundry" ? null : role;
    const old = site && this.restoreOld(site);
    if (old === "wait") {
      this.why ||= `restoring the old ${role} (${describeGoods(restorePrice(site!).goods)} + ${restorePrice(site!).coins} coins; have ${describeGoods(workshopStock(w))}, ${s.coins} coins)`;
      return;
    }
    if (old) {
      this.industryTry[role] = P.minute;
      this.firsts[`${role} restored`] = Math.round(P.minute);
      if (role === "harbour") this.harbourStone = P.shopStoneIn;
      opened(old.id, old.beyond, `restored the old ${role}`);
      return;
    }
    const rule = ruleOf(thing)!;
    // (A good of its price that the workshop's yard never takes, not even while owed, can't be paid: said once, as a finding.)
    for (const k of Object.keys(rule.cost) as CargoKind[])
      if (!RECIPES.workshop.takes.includes(k) && !RECIPES.workshop.owed?.includes(k) && !this.neverPaid.has(`${role}:${k}`)) {
        this.neverPaid.add(`${role}:${k}`);
        P.findings.push(`Minute ${P.minute.toFixed(0)}: a ${rule.label.toLowerCase()} costs ${describeGoods({ [k]: rule.cost[k] })} at the workshop, whose yard never takes ${k}: it can't be made.`);
        P.note(`a ${rule.label.toLowerCase()} can't be made: its ${k} must be in the workshop's yard, which never takes ${k}`);
      }
    if (!P.canMake(new Map([[thing, 1]]))) {
      // In the goals play-through, the harbour ordered at the workshop's card while it can't be made yet, as the mill
      // is (`orderMill`), so the yard keeps its 15 planks (`yardKeeps`: a waiting order's). Without the order the yard
      // keeps only `WORKSHOP_SPARE` (7) while a town on the line wants planks: from Harbours (minute 354) the yard sat
      // at 2, then 7, planks to minute 440 with its 10 stone in. The harbour came at 385 only when Brambleton's card
      // offered +8 planks, and when the cards drew otherwise (a new piece type in the tray, origin/curved-ramps) it
      // took the coins and no harbour stood.
      if (role === "harbour" && this.goalsFirst && !s.orders.includes(thing) && (s.owned.get(thing) ?? 0) === 0) {
        P.crafting.order(thing);
        P.happened++;
        P.note(`ordered a harbour at the workshop (have ${describeGoods(workshopStock(w))}, ${s.coins} coins): its planks kept in the yard`);
      }
      // Waiting on coins alone (the planks are there): counted, for the summary.
      if (s.coins < (rule.coins ?? 0) && P.planks() >= (rule.cost.planks ?? 0)) this.coinWait[role]++;
      this.why ||= `a ${rule.label.toLowerCase()} (${describeGoods(rule.cost)} + ${rule.coins} coins; have ${describeGoods(workshopStock(w))}, ${s.coins} coins)`;
      return;
    }
    this.industryTry[role] = P.minute;
    const cells: number[] = [];
    // (A foundry needs no resource: by the mine whose coal and ore it takes, or a town's station, as a mill goes.)
    if (role === "foundry") cells.push(...[this.mine, ...w.stations.values()].map((id) => w.layout.getPiece(id)).filter((p) => !!p).map((p) => g.cellAtWorld(p!.pose.x, p!.pose.z)).filter((i) => i !== -1));
    else
      g.forEachCell((i) => {
        if (role === "harbour" ? isWater(g.surface[i]) : g.height[i] > 0) cells.push(i);
      });
    // (A waiting order taken off when the harness makes it itself, so only one is made.)
    P.crafting.cancel(thing);
    P.make(new Map([[thing, 1]]));
    const r = extend(P, { type, cells }) ?? (s.learned.has("switches") ? branchOff(P, type, cells) : null);
    if (r) opened(r.id, r.beyond, `built a ${rule.label.toLowerCase()} by the line`);
    else P.note(`COULDN'T reach a ${role} site from the line's ends (or a branch)`);
  }

  /** When the line was last run on to another town for "Connect every town" (minutes). */
  private joinTry = -99;

  /**
   * "Connect every town": once the quarry is open (the goals before it done, as a player's are; in the goals
   * play-through, the mine too: "Open a mine" comes first in the goals' list, and the two towns' spurs make the lap
   * half as long again: joined at 157 and 167, Mines was still not learned at minute 285), every 10 minutes with planks
   * to spare, the line run on from one of its ends to the nearest town not on it (as the third town was), the station's
   * far side capped. In the goals play-through, where no end can be run on (on the starter map from minute 157 each
   * ends at a depot, boxed in by headroom, a town or a station: BALANCE_JOIN_TRACE=1 logs each try), a spur to it off a
   * switch in the line instead (`spurTo`), as a player branches off mid-line. (Not in the balance run, to keep its
   * pacing as it was: there an end reaches Ashcombe in the end, at 113 on seed 2027.) The next nearest is tried if the
   * nearest can't be reached.
   */
  joinTowns(): void {
    const P = this.p;
    const w = P.w;
    if (P.goals.isDone("join-all") || this.quarry < 0 || (this.goalsFirst && this.mine < 0) || !this.joinedThird || P.minute - this.joinTry < 10 || P.planks() < PICK_SPARE) return;
    const on = townsOnLine(P);
    const ends = lineEnds(P).map((e) => w.layout.worldConnector(e.ref, peg));
    const dist = (i: number) => Math.min(...ends.map((e) => Math.hypot(w.landscape.towns[i].centre.x - e.x, w.landscape.towns[i].centre.z - e.z)));
    const others = w.landscape.towns
      .map((_, i) => i)
      .filter((i) => !on.includes(i))
      .sort((a, b) => dist(a) - dist(b));
    if (others.length === 0) return;
    this.joinTry = P.minute;
    if (ENV.BALANCE_JOIN_TRACE) {
      const pose = (id: number) => w.layout.getPiece(id)!.pose;
      P.note(`  join trace: towns ${w.landscape.towns.map((t, i) => `${t.name} ${Math.round(t.centre.x)},${Math.round(t.centre.z)} station ${Math.round(pose(st(P, i)).x)},${Math.round(pose(st(P, i)).z)} h${Math.round((pose(st(P, i)).heading * 180) / Math.PI)}`).join("; ")}`);
      P.note(`  join trace: ends ${lineEnds(P).map((e) => { const c = w.layout.worldConnector(e.ref, peg); return `${Math.round(c.x)},${Math.round(c.z)} h${Math.round((c.heading * 180) / Math.PI)} on ${w.layout.getPiece(pieceOfRef(e.ref))!.type}`; }).join("; ")}; open ends ${openEnds(P).length}`);
    }
    for (const i of others.slice(0, 2)) {
      const station = st(P, i);
      const ends = () => [connectorRef(station, 0), connectorRef(station, 1)].filter((ref) => w.layout.joinedConnector(ref) === -1);
      if (!extend(P, { target: ends }) && !(this.goalsFirst && P.progress.learned.has("switches") && spurTo(P, w.landscape.towns[i].centre, ends, 60, 2000, ENV.BALANCE_JOIN_TRACE) !== null)) continue;
      capEnd(P, freeEnd(P, station));
      P.happened++;
      P.note(`ran the line on to ${w.landscape.towns[i].name} (${on.length + 1} of ${w.landscape.towns.length} towns)`);
      if (this.lines) this.routeGoods();
      return;
    }
    P.note(`COULDN'T run the line on to ${others.map((i) => w.landscape.towns[i].name).join(" or ")}`);
  }

  /**
   * Map sites step 2's rule: the standing ruin of `role` nearest the player's line, if it's within `RUIN_REACH` of it
   * and restoring it is cheaper than a new industry (always, unless one's in the toy box already, which costs nothing
   * more): the line run on from one of its ends to the ruin's stub (`extend`), or else (BALANCE_SPUR) a short spur off a
   * switch in the line (`spurTo`, once Switches is learned), then restored there (as its card's Restore does: planks
   * from the workshop's yard, coins). Its piece and its free end; "wait" while it can't be paid for yet; null to build
   * a new one as before (no ruin near, BALANCE_NORUINS, or neither a line end nor a spur reaches it: tried again 5
   * minutes on, while there's still no farm). BALANCE_RUIN_TRACE=1 logs each line end's and spur's try.
   */
  restoreOld(role: SiteRole): { id: number; beyond: number } | "wait" | null {
    const P = this.p;
    const w = P.w;
    const s = P.progress;
    if (NORUINS || s.available(w, pieceThing(restoredType(role))) > 0) return null;
    const line = [...w.layout.pieceIds()].filter((id) => !P.fixed.has(id)).map((id) => w.layout.getPiece(id)!.pose);
    const site = nearestRuin(w.landscape, role, line);
    if (!site || this.ruinsPassed.has(site.id)) return null;
    const away = Math.min(...line.map((q) => Math.hypot(q.x - site.centre.x, q.z - site.centre.z)));
    if (away > RUIN_REACH) {
      this.ruinsPassed.add(site.id);
      P.note(`the old ${role} is ${Math.round(away)} mm from the line: too far to restore`);
      return null;
    }
    if (P.minute - this.ruinTry < 5) return null;
    const pay = gamePayment(w, s, role);
    if (pay.short()) return "wait";
    const stub = w.ruins.get(site.id)!;
    const before = { coins: s.coins, planks: P.planks() };
    if (ENV.BALANCE_RUIN_TRACE) {
      // (Why the line can't reach it: each line end's try, put back.)
      for (const end of lineEnds(P)) {
        const at = w.layout.worldConnector(end.ref, peg);
        const was = { ...w.layout.getPiece(end.buffer)! };
        let buffer = end.buffer;
        for (const c of [0, 1]) {
          const ref = connectorRef(stub, c);
          if (w.layout.joinedConnector(ref) !== -1) continue;
          P.editor.remove(buffer);
          const had = new Set(w.layout.pieceIds());
          const t = play(w.layout, P.editor, end.ref, ref, { blocked: P.rules(), maxPieces: 90, fiddle: 3 });
          for (const id of [...w.layout.pieceIds()]) if (!had.has(id)) P.editor.remove(id);
          buffer = P.editor.place("buffer-turnback", was.pose, was.y, was.flipped);
          P.note(`  ruin trace: end at ${Math.round(at.x)},${Math.round(at.z)} to stub ${c}: ${t.how} (${t.pieces} pieces)`);
        }
      }
    }
    const free = () => [0, 1].map((c) => connectorRef(stub, c)).filter((ref) => w.layout.joinedConnector(ref) === -1);
    let r = extend(P, { target: free });
    // Else (BALANCE_SPUR) a short spur to it off a switch in the line (as its Show me frames it: the ruin and the line).
    // Before Routes the line's train runs end to end with the switch set for the line, so its grain reaches the line
    // only when the player sets the switch for the farm by hand (`tendSpur`; BALANCE_SPUR=routes: Routes learned
    // first instead): the trade-off a player takes for the cheaper farm.
    let spur = -1;
    if (!r && s.learned.has("switches") && this.spur && (role === "farm" || s.learned.has("routes"))) {
      spur = spurTo(P, site.centre, free) ?? -1;
      if (spur !== -1) r = { id: stub, beyond: -1 };
    }
    if (!r) {
      // A new one instead, now (as without ruins: waiting on the ruin held the farm back 10 minutes, and a branch to it
      // is one the unrouted goods train never takes). Tried again 5 minutes on if there's still no farm.
      this.ruinTry = P.minute;
      P.note(`COULDN'T run the line or a spur to the old ${role} (BALANCE_RUIN_TRACE=1 says why)`);
      return null;
    }
    // (The track to it may have taken the yard's planks: restored once they're back.)
    if (pay.short()) return "wait";
    const done = restoreRuin(w, P.editor, site.id, { pay });
    if ("why" in done) {
      this.ruinsPassed.add(site.id);
      P.note(`COULDN'T restore the old ${role}: ${done.why}`);
      return null;
    }
    P.spent.buildCoins += before.coins - s.coins;
    P.spent.buildPlanks += before.planks - P.planks();
    if (spur !== -1) {
      this.spurFarm = !s.learned.has("routes");
      this.spurSwitch = spur;
      if (!ROUTES_FIRST) P.everySecond = () => this.tendSpur();
    }
    P.note(`restored the old ${role} ${Math.round(away)} mm from the line${spur !== -1 ? ", on a spur" : ""} (${describeGoods(restorePrice(role).goods)} + ${restorePrice(role).coins} coins)`);
    return { id: done.pieceId, beyond: freeEnd(P, done.pieceId) };
  }

  /**
   * Spec §5's bands at 180 min with 1 train a line (P5, as the CoS set them on 2026-10-20): first research by minute 8;
   * at least main's researched count by 180 (7 on a seed main has no figure for); the City at minute 60-90; no stretch
   * of 45 min or more with no planks into a town; and the guard: no research stall over 15 min, coins at 180 at least
   * 100, no City more than 20% later than main's. Each miss is listed (soft), and any fails the run. What's only nice
   * to have (a research stall under 10 min, coins at 180 within 150-600) is printed. The stall guard's one exemption:
   * the one-goods-train plank famine on a line of `FAMINE_STOPS` stops or more (`plankFamine`), printed as exempt.
   */
  checkBands(): void {
    const P = this.p;
    const coins = P.rows.at(-1)?.coins ?? 0;
    const stall = P.researchStall / 60;
    const gap = P.townGap / 60;
    const city = this.firsts["level 3"] ?? Infinity;
    const researched = P.researchedAt.filter((m) => m <= 180).length;
    const main = MAIN_BY_SEED[Number(ENV.BALANCE_SEED ?? 2027)];
    const floor = main?.researched ?? 7;
    expect.soft(P.researchedAt[0] ?? Infinity, "first research by minute 8").toBeLessThanOrEqual(8);
    expect.soft(researched, `researched by 180 at least main's ${floor}`).toBeGreaterThanOrEqual(floor);
    expect.soft(city, `City at minute ${CITY_BAND[0]} or later`).toBeGreaterThanOrEqual(CITY_BAND[0]);
    expect.soft(city, `City by minute ${CITY_BAND[1]}`).toBeLessThanOrEqual(CITY_BAND[1]);
    expect.soft(gap, "no planks into a town for 45 min").toBeLessThan(45);
    const famine = P.plankFamine();
    if (!famine) expect.soft(stall, "no research stall over 15 min").toBeLessThanOrEqual(15);
    expect.soft(coins, "coins at 180 at least 100").toBeGreaterThanOrEqual(100);
    if (main) expect.soft(city, `City no more than 20% later than main's ${main.city}`).toBeLessThanOrEqual(main.city * 1.2);
    const nice = [stall >= 10 && `research stall ${stall.toFixed(1)} min (under 10)`, (coins < 150 || coins > 600) && `coins ${coins} (150-600)`].filter(Boolean);
    const c = P.researchStallCause;
    const exempt = famine && stall > 15 ? ` (exempt: plank famine, ${c.goodsTrains} goods train on a ${c.stops}-stop line)` : "";
    console.log(`BANDS researched ${researched} (floor ${floor}), City ${city}, gap ${gap.toFixed(1)} min, stall ${stall.toFixed(1)} min${exempt}, coins ${coins}; nice to have: ${nice.join("; ") || "all met"}`);
  }

  /**
   * Cargo stuck on the goods train, as a player sees it (P5): a depot's pile of a good some stop on the line takes is
   * full (the quarry's stone, for a city that wants only stone), the train has cars that carry it, and every one of
   * them comes by loaded with something else (hoppers of grain). After 3 minutes of that the player edits the line (the
   * engine card's stops, as the game does it): what those cars carry is picked up only on the visit nearest before a
   * stop that takes it (the farm on the way to the mill), its other visits set to "Only drop". The cars then leave the
   * mill empty and reach the quarry with room. Kept when the line is laid out again (`routeGoods`).
   */
  unstick(): void {
    const P = this.p;
    const w = P.w;
    const line = this.lineId >= 0 ? w.economy.lines.get(this.lineId) : undefined;
    const found = w.sim.findCar(this.timber);
    if (!line || !found || ENV.BALANCE_NOUNSTICK) return;
    const takers = line.stops.map((s) => w.economy.depot(s.depotId)).filter((d) => !!d);
    this.shopThrough(takers.filter((d) => d!.role === "town").map((d) => d!.townId));
    // (Wanted by a town or the research, not only by an industry: the stone a city waits on.)
    const wantedHere = (k: CargoKind) => takers.some((d) => (d!.role === "town" || d!.role === "school") && RECIPES[d!.role].takes.includes(k) && (!w.economy.accepts || w.economy.accepts(d!, k)));
    // Or what an industry on the line makes such a good from, while it has none of either (seed 2027 since 03c7711: the
    // mill with no flour for Elderwick or the Goods engine, the farm full, the hopper coming by full of stone). Not when
    // the cars are full of what that industry makes: they're taking it on already (timber cars of planks at the forest).
    const fed = (k: CargoKind) => takers.filter((m) => !!RECIPES[m!.role].cycle?.uses[k] && m!.piles[CARGO[k].index] === 0 && RECIPES[m!.role].gives.some((g) => wantedHere(g) && m!.piles[CARGO[g].index] === 0));
    const blocking = new Set<CargoKind>();
    for (const d of takers) {
      for (const k of RECIPES[d!.role].gives) {
        if (d!.piles[CARGO[k].index] < capAt(d!)) continue;
        const via = wantedHere(k) ? [] : fed(k);
        if (!wantedHere(k) && via.length === 0) continue;
        const loads = found.train.cars.filter((c) => canCarry(c.kind, k)).map((c) => w.economy.cargoOf(c.id).kind);
        if (loads.length === 0 || loads.some((g) => g === null || g === k)) continue;
        if (loads.some((g) => via.some((m) => RECIPES[m!.role].gives.includes(g!)))) continue;
        for (const g of loads) if (g && !this.nearestPickup.has(g)) blocking.add(g);
      }
    }
    if (blocking.size === 0) {
      this.stuckFor = 0;
      return;
    }
    if (++this.stuckFor < 3) return;
    this.stuckFor = 0;
    for (const g of blocking) this.nearestPickup.add(g);
    editLine(w.economy, this.timber, (stops) => {
      for (const g of blocking) onlyNearestPickup(w, stops, g);
    });
    P.happened++;
    P.note(`STUCK: the goods train's cars come by full of ${[...blocking].join(", ")}; now picked up only on the way to where it's taken (its other visits "Only drop")`);
  }

  /**
   * Room for the mine's goods: once the mine stands on the line and another stop takes its coal or ore (the harbour,
   * or the school while Foundry wants coal), the player sets the stop the train calls at just before the mine to pick
   * up only on its other visit (`onlyNearestPickup`, the engine card's stops, as `unstick` does), so the hoppers reach
   * the mine with room. Done once; kept when the line is laid out again (`routeGoods`). (The goals play-through: the
   * mine is a line end with the quarry beside it, and the hoppers left the quarry for the mine full of stone each lap.
   * `unstick` counts only goods a town or the school wants, so the mine's ore, which only the harbour takes, never set
   * it off: the ore first rode a train at 425 or 426, after the harbour at 385 or 397, on the one lap where the
   * hoppers had room, and with origin/curved-ramps' card draws at 448, past the long part's 440. Set so, the ore rode at 405 with or without origin/curved-ramps.)
   */
  roomForMine(): void {
    const P = this.p;
    const w = P.w;
    if (this.mine < 0 || this.mineRoom || ENV.BALANCE_NOUNSTICK) return;
    const line = this.lineId >= 0 ? w.economy.lines.get(this.lineId) : undefined;
    const mine = w.economy.depotAtPiece(this.mine);
    if (!line || !mine || !w.sim.findCar(this.timber)) return;
    const at = line.stops.findIndex((s) => s.depotId === mine.id);
    if (at < 0) return;
    const ore = RECIPES[mine.role].gives;
    const takes = line.stops.some((s) => {
      const d = w.economy.depot(s.depotId);
      return !!d && d.id !== mine.id && ore.some((k) => RECIPES[d.role].takes.includes(k) && (!w.economy.accepts || w.economy.accepts(d, k)));
    });
    if (!takes) return;
    this.mineRoom = true;
    const n = line.stops.length;
    const before = w.economy.depot(line.stops[(at - 1 + n) % n].depotId);
    const goods = (before ? RECIPES[before.role].gives : []).filter((k) => !ore.includes(k) && !this.nearestPickup.has(k));
    if (goods.length === 0) return;
    for (const k of goods) this.nearestPickup.add(k);
    editLine(w.economy, this.timber, (stops) => {
      for (const k of goods) onlyNearestPickup(w, stops, k);
    });
    P.happened++;
    P.note(`ROOM: the mine's goods have a taker; the ${before!.role}'s ${goods.join(", ")} now picked up only on the way to where it's taken (its visit before the mine "Only drop")`);
  }
  /** Has the stop before the mine been set so the hoppers reach it with room (`roomForMine`)? */
  mineRoom = false;

  /**
   * A town on the line that wants planks and has had none for `STARVED` minutes while the workshop's yard holds
   * `SHOP_FULL` or more (P5: Elderwick, past the workshop, starved while the yard filled 4 → 24): the player switches
   * the workshop's crane off (its card's Automatic, as the game does it), so trains run through with the planks for
   * the towns past it. Back on once the yard is down to `RESEARCH_SPARE`, a tray order waits on planks, or no town on
   * the line wants planks.
   */
  shopThrough(towns: number[]): void {
    const P = this.p;
    const w = P.w;
    const shop = w.economy.depotAtPiece(this.shop);
    if (!shop) return;
    for (const t of towns) {
      const n = w.economy.delivered.get(t) ?? 0;
      if (this.planksIn.get(t)?.n !== n) this.planksIn.set(t, { n, at: P.minute });
    }
    const wanting = towns.filter((t) => P.town.wants(t, "planks"));
    const starved = wanting.some((t) => P.minute - (this.planksIn.get(t)?.at ?? P.minute) >= STARVED);
    if (shop.auto && starved && P.planks() >= SHOP_FULL && !P.planksKept) {
      w.economy.setAuto(shop.id, false);
      this.shopShut++;
      P.happened++;
      P.note(`the workshop's yard is full (${P.planks()} planks) and a town past it has had none for ${STARVED} min: crane off, trains run through`);
    } else if (!shop.auto && (P.planks() <= RESEARCH_SPARE || P.planksKept || wanting.length === 0)) {
      w.economy.setAuto(shop.id, true);
      P.happened++;
      P.note(`the workshop's crane on again (${P.planks()} planks in its yard)`);
    }
  }
  /** Each town's planks delivered, and the minute that last changed. */
  private readonly planksIn = new Map<number, { n: number; at: number }>();
  /** Times the workshop's crane was switched off for the towns past it. */
  shopShut = 0;

  /** Minutes from learning a blueprint to building what it brings ("-": not both). */
  wait(blueprint: string, built: string): string {
    const learned = this.p.learnedAt.find((b) => b.id === blueprint)?.minute;
    const at = this.firsts[built];
    return learned === undefined || at === undefined ? "-" : String(Math.round(at - learned));
  }

  /**
   * Does the player keep the people train running, laying it passing loops (`peopleLoop`, the stuck card's "Add a
   * passing loop here")? Not the goals player: its planks go to the goals, and it puts the people train away when it's
   * stuck or the planks stop, as before. Nor with BALANCE_PEOPLE_HAND (run by hand, as before).
   */
  keepsPeople(): boolean {
    return !this.goalsFirst && !ENV.BALANCE_PEOPLE_HAND;
  }

  /** A passing loop on the line for the people train (`spliceLoop`), once routes are learned: its pieces, or null. */
  peopleLoop(): number[] | null {
    const P = this.p;
    const w = P.w;
    if (!this.lines || this.lineId < 0 || !this.keepsPeople() || !P.progress.knows("piece:switch")) return null;
    const line = w.economy.lines.get(this.lineId);
    const stops = line ? [...new Set(line.stops.map((st) => w.economy.depot(st.depotId)!.pieceId))] : [];
    const longest = Math.max(450, LONGEST_PEOPLE, ...[...this.trains.keys()].map((e) => (w.sim.findCar(e) ? trainLength(w.sim.findCar(e)!.train) : 0)));
    const loop = spliceLoop(P, stops, longest, this.loopPieces);
    if (!loop) return null;
    P.happened++;
    this.peopleLoops.push(Math.round(P.minute));
    this.stuckLoop = loop;
    for (const id of loop) this.loopPieces.add(id);
    P.note(`laid a passing loop on the line for the people train (${loop.length} pieces)`);
    return loop;
  }

  /** A straight of a passing loop's (the first free one) to put a train down on. */
  onLoop(loop: readonly number[]): number | undefined {
    const w = this.p.w;
    return loop.find((id) => w.layout.getPiece(id)?.type === "straight-216" && !w.sim.pieceOccupied(id));
  }

  /**
   * The people train's route, once routes are learned: on the line, as a player adds a second train to it (its passing
   * loop laid for it by the loop rule, as the card and the toast say), or (BALANCE_PEOPLE_OWN) a line of its own, the
   * towns' stations along the track there and back. Before routes, or BALANCE_PEOPLE_HAND, it runs by hand (lever on).
   * Returns words for the note.
   */
  peopleLine(e: number): string {
    const P = this.p;
    const w = P.w;
    if (!this.lines || ENV.BALANCE_PEOPLE_HAND) return "";
    if (!ENV.BALANCE_PEOPLE_OWN && this.lineId >= 0 && joinLine(w.economy, e, this.lineId)) return ", on the line";
    const towns = lineOrder(P).filter((d) => w.economy.depot(d)?.role === "town");
    if (towns.length < 2) return "";
    const order = [...towns, ...towns.slice(1, -1).reverse()];
    startLine(w.economy, e, order.map((depotId) => ({ depotId, action: "auto" as const })));
    return `, on a line of its own (${towns.length} towns and back)`;
  }

  /** Give each train a line: the depots along the track in order, there and back, "auto" (the intent rules). */
  routeGoods(): void {
    const P = this.p;
    const w = P.w;
    const t0 = performance.now();
    const dfs = lineOrder(P);
    if (dfs.length < 2) return;
    // (The goals play-through's player orders the line's stops for the shortest lap once the quarry stands, past the
    // line's far end (`shortestLap`): the quarry's stone came by in hoppers full of the farm's grain, the farm a stop
    // before it across the map, and the Mines blueprint's 20 stone never came. Not before: the planks came round to the
    // workshop slower on the shortest lap from the mill on, and the quarry stood at minute 170, not 157.)
    const short = this.goalsFirst && this.quarry >= 0 ? shortestLap(w, dfs) : null;
    const order = short?.order ?? dfs;
    if (ENV.BALANCE_STOPS && short) P.note(`  ordered for a lap of ${Math.round(short.lap)} mm (was ${Math.round(short.was)}), in ${(performance.now() - t0).toFixed(1)} ms`);
    const back = order.slice(1, -1).reverse();
    const stops: RouteStopDef[] = [...order, ...back].map((depotId) => ({ depotId, action: "auto" as const }));
    for (const kind of this.nearestPickup) onlyNearestPickup(w, stops, kind);
    // One line for every train (with routes-lines' auto-spacing to spread them out); its stops follow the track.
    // (Not the people train on a line of its own: `peopleLine`.)
    const live = [...this.trains.keys()].filter((e) => w.sim.findCar(e) && !(this.trains.get(e) === "people" && this.lineId >= 0 && (w.economy.lineIdOf.get(e) ?? this.lineId) !== this.lineId));
    if (live.length === 0) return;
    if (this.lineId < 0 || !w.economy.lines.has(this.lineId)) this.lineId = startLine(w.economy, live[0], stops.map((x) => ({ ...x }))).id;
    for (const e of live) joinLine(w.economy, e, this.lineId);
    editLine(w.economy, live[0], (old) => old.splice(0, old.length, ...stops.map((x) => ({ ...x }))));
    P.note(`${live.length} train(s) on a line of ${stops.length} stops: ${order.map((d) => w.economy.depot(d)!.role).join(" → ")} and back`);
    if (ENV.BALANCE_STOPS)
      P.note(
        `  stops: ${order
          .map((id) => {
            const d = w.economy.depot(id)!;
            const p = w.layout.getPiece(d.pieceId)!;
            const town = w.landscape.towns.find((t) => t.id === d.townId)?.name;
            return `${d.role}#${id}${town ? `(${town}${w.layout.getPiece(d.pieceId)!.type.includes("halt") ? " halt" : ""})` : ""}@${Math.round(p.pose.x)},${Math.round(p.pose.z)}`;
          })
          .join(" ")}`,
      );
  }

  report(): void {
    const P = this.p;
    const w = P.w;
    const pick = P.rows.filter((r) => r.minute <= 10 || r.minute % 5 === 0);
    const table = pick.map((r) => `${String(r.minute).padStart(4)} | ${String(r.coins).padStart(5)} | ${String(r.planks).padStart(3)} | ${String(r.goals).padStart(2)}/17 | ${String(r.blueprints).padStart(2)} | ${r.levels.join(",")} | ${r.trains} | ${r.riders}`);
    const status = w.landscape.towns.map((t) => `${t.name} ${P.town.status(t.id).name.toLowerCase()} [${[...townLandmarks(t)].join(", ")}] had ${describeGoods(receivedBy(w, t.id))}`);
    const out = [
      "balance play-through:",
      ...P.log,
      "",
      "minute | coins | planks | goals | bps | town levels | trains | riders",
      ...table,
      "",
      `towns: ${status.join("; ")}`,
      `blueprints: ${P.learnedAt.map((b) => `${b.minute} ${b.id} (${b.how}; ${b.price})`).join(" · ")}`,
      `spent: ${JSON.stringify(P.spent)}; coins now ${P.progress.coins}`,
      `growths: ${P.growths.map((g) => `${g.minute} ${g.town}→${g.level} ${g.ms} ms (${g.built} lots)`).join(" · ")}`,
      `idle stretches (5+ minutes with nothing new): ${this.idleStretches.map((s) => `${s.from}-${s.to} (${s.why})`).join(" · ") || "none"}`,
      `goals: ${GOALS.map((g) => `${P.goals.isDone(g.id) ? "✓" : "·"} ${g.title}`).join(" | ")}`,
      `counts: ${[...P.progress.counts].map(([k, n]) => `${k} ${n}`).join(", ")}; riders ${P.progress.riders}`,
      `firsts: ${JSON.stringify(this.firsts)}`,
      `SUMMARY coins180 ${P.rows.at(-1)?.coins} planks180 ${P.rows.at(-1)?.planks} stall ${this.stall} (from ${this.stallFrom}) jamStall ${this.jamStall} city ${this.firsts["level 3"] ?? "-"} cityStar ${this.firsts["level 4"] ?? "-"} riders ${P.progress.riders} spentCoins ${P.spent.blueprintsCoins + P.spent.buildCoins} perLine ${this.perLine} loop ${this.loop ? "yes" : "-"} goods2 ${this.goods2At < 0 ? "-" : `${Math.round(this.goods2At)} for ${this.goods2For}`}${this.goods2Cut ? " (jammed)" : ""} held ${(P.heldSeconds / 60).toFixed(1)}min jamCut ${this.jamCut} farmWait ${this.wait("farming", "farm built")} quarryWait ${this.wait("quarries", "quarry built")} farmCoinWait ${this.coinWait.farm} quarryCoinWait ${this.coinWait.quarry} kept ${(P.keptSeconds / 60).toFixed(0)}min onlyNearest ${[...this.nearestPickup].join("+") || "-"} shopOff ${this.shopShut} townGap ${(P.townGap / 60).toFixed(1)}min loops ${this.loopsAt.join("/") || "-"} stuckLoops ${this.stuckLoops.join("/") || "-"} headOn ${P.headOn} lineHeadOn ${P.headOnLine} stalls ${w.economy.stalls.begun} stuck ${(P.stuckSeconds / 60).toFixed(1)}min lineStall ${P.lineStall.toFixed(1)} arrivals ${P.arrivals} sectionWait ${(P.sectionSeconds / 60).toFixed(1)}min roomWait ${(P.roomSeconds / 60).toFixed(1)}min releases ${w.economy.sections.released}${ENV.BALANCE_TIMING ? ` capUs ${w.economy.sections.capCalls ? ((1000 * w.economy.sections.capMs) / w.economy.sections.capCalls).toFixed(2) : "-"} capCalls ${w.economy.sections.capCalls}` : ""}`,
      `SUMMARY research first ${P.researchedAt[0] ?? "-"} at60 ${P.researchedAt.filter((m) => m <= 60).length} at120 ${P.researchedAt.filter((m) => m <= 120).length} at180 ${P.researchedAt.filter((m) => m <= 180).length} stall ${(P.researchStall / 60).toFixed(1)}min on ${P.researchStallOn} (${P.researchStallCause.goodsTrains} goods train(s), ${P.researchStallCause.stops} stops${P.researchStallCause.planks ? ", short of planks" : ""}) school ${this.firsts["school"] ?? "-"} blueprints ${P.progress.learned.size}`,
      `SUMMARY cards ${Object.entries(P.cardsTaken).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`,
      `research: ${P.researchedAt.map((m, k) => `${m} ${P.learnedAt.filter((b) => b.how === "researched")[k]?.id}`).join(" · ")}`,
      `findings:\n- ${P.findings.join("\n- ") || "none"}`,
    ].join("\n");
    console.log(out);
    if (ENV.BALANCE_JSON) console.log(`BALANCE_JSON ${JSON.stringify({ firsts: this.firsts, rows: P.rows, learned: P.learnedAt, growths: P.growths, idle: this.idleStretches, spent: P.spent, findings: P.findings })}`);
  }
}
