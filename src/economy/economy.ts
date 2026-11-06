import { getPieceDef, isKit, isSecretKit, LOOKOUT_KIT, METRO_KIT, MAX_CONNECTORS, OBSERVATORY_KIT, pathLength, pieceOfRef, pointsWayFrom, type Layout } from "../track";
import { ACCELERATION, SIM_DT, type Cursor, type Sim, type Train } from "../sim";
import { CARGO, CARGO_KINDS, CARGO_SLOTS, canCarry, POSTAL, type CargoKind } from "./cargo";
import { ticks, CRANE_TICKS, CRAWL_SPEED, PILE_CAP, WAGON_CAPACITY } from "./constants";
import { Spacing } from "./spacing";
import type { Bag } from "./goods";
import { KitStops } from "./kit-stops";
import type { BoatState, YardOrder } from "./boats";
import { Sections, type BlockWait } from "./sections";
import { Stalls } from "./stalls";
import { Breakdown } from "./breakdown";
import { next as nextPiece, SEARCH, waysFrom } from "../routing/graph";
import { Router } from "../routing/router";
import { aimOf, lapAims, passVias, ranOnto, resetVias, skipVias, viaDone } from "../routing/via";
import { RoadVehicles } from "../roads/vehicles";

const NONE = 0;
const CRAWLING = 1;
const HALTED = 2;
/** A wagon centre this close to the crane point (mm) counts as under the crane. */
const AT_CRANE = 0.5;
/** A train crawling through a depot that has stood still this long is held up short of the crane. */
const STUCK_TICKS = ticks(1);
/** A rider gets on or off a coach in this time. */
const RIDER_TICKS = ticks(0.3);

/** One train's visit to a depot. Allocated once per train and reused. */
interface Service {
  readonly trainId: number;
  phase: number;
  depotId: number;
  /**
   * The depot (or the depot's road: `addRoad`) whose crane serves it: the same id as `depotId`, but a road of a depot
   * with several tracks is its own object (its own piece and crane), so two trains are worked at once. Null: none.
   */
  depot: DepotState | null;
  /** The car under the crane while halted. */
  carId: number;
  /** Ticks into the current crane move. */
  ticks: number;
  /** Ticks it has stood still while crawling (held up short of the crane). */
  still: number;
  /** Cars already served (or sent on) during this visit. */
  readonly done: Set<number>;
  /** Has it halted at the depot this visit (a "halted" station event said so, and a "left" one is owed)? */
  halted?: boolean;
  /**
   * At a depot of several tracks (one crane for them all): the tick it last had the crane, or halted for it. The crane
   * goes to the train waiting longest (`craneTurn`), so it serves each track's train in turn.
   */
  turnAt?: number;
}

export type DepotRole = "forest" | "sawmill" | "town" | "workshop" | "farm" | "mill" | "quarry" | "warehouse" | "mine" | "foundry" | "carpenter" | "smithy" | "power" | "harbour" | "school" | "dairy" | "bakery" | "orchard" | "juicer" | "creamery" | "icecream" | "brickworks" | "carworks" | "oilwell" | "waterpump" | "beetfield" | "jamworks" | "chocworks" | "flowerfield" | "dyeworks" | "toyworks" | "postoffice" | "landing" | "slip" | "boatyard" | "shipyard" | "airport" | "mast" | KitDepotRole;

/** Most riders waiting in an airport's lounge for a plane (Game mode: src/game/airports.ts). Full, coaches keep them. */
export const AIRPORT_LOUNGE = 12;
/** Seats on the airship at a mooring mast (Game mode: src/game/airship.ts): riders board till it's full. */
export const AIRSHIP_SEATS = 8;

/** How many riders can wait at an airport or a mast (0: anything else). */
export function loungeCap(d: Pick<DepotState, "role">): number {
  return d.role === "airport" ? AIRPORT_LOUNGE : d.role === "mast" ? AIRSHIP_SEATS : 0;
}

/**
 * Sandbox's cargo machines (kit pieces with a `depot`: src/track/kits.ts): a loader with an endless heap of one good,
 * and an unloader whose goods vanish into it. Sandbox has no industries to feed, so one of each makes a goods line.
 */
export type KitDepotRole = "loader-log" | "loader-grain" | "loader-coal" | "loader-planks" | "unloader";

/** The kit depot roles (for saves, and to tell them from industries'). */
export const KIT_DEPOT_ROLES: readonly KitDepotRole[] = ["loader-log", "loader-grain", "loader-coal", "loader-planks", "unloader"];

/**
 * What a kind of depot does: the goods trains bring it (unloaded onto its piles), the goods it gives them, and what it
 * makes by itself, a cycle at a time. One row per kind of industry: a new one is a row here (and a model).
 */
export interface Recipe {
  readonly takes: readonly CargoKind[];
  /**
   * Goods it takes only while the mode says some are owed (`Economy.owes`), and only as many: a workshop's stone, for
   * a harbour's price. It keeps a pile of each. None owed (or no mode to say: Sandbox), trains keep them.
   */
  readonly owed?: readonly CargoKind[];
  readonly gives: readonly CargoKind[];
  /**
   * One cycle every `seconds` (at rate 1): uses `uses` from its piles, adds `makes` to them. Runs while it has what it
   * uses and room for what it makes. `eats`: uses one of whatever it has of `takes` (a town using up its goods).
   */
  readonly cycle?: { readonly uses: Bag; readonly makes: Bag; readonly seconds: number; readonly eats?: boolean };
  /** Most units each pile holds (default `PILE_CAP`). */
  readonly cap?: number;
  /** Serves only routed trains, at their stops (it takes and gives the same goods: a train must say which). */
  readonly routedOnly?: boolean;
  /** Its piles of what it gives never run down (a Sandbox loader's endless heap): kept full. */
  readonly endless?: boolean;
  /** What it takes vanishes into it (a Sandbox unloader): its piles stay empty, so it always has room. */
  readonly sink?: boolean;
}

/**
 * Most planks (and iron) a workshop's yard holds: enough for the dearest blueprint or building (30 planks), so one
 * workshop can pay for any of them. (At 12, a blueprint of 14 planks or more could never be paid, and the planks kept
 * for it starved the towns.)
 */
export const WORKSHOP_CAP = 30;

/**
 * The share of a train's load of a good (as it left the last depot it loaded that good at) a school may take on that
 * pass while a town on its way wants the good too, and so the most a town leaves on the train for a school. QA (P4):
 * while research ran, the school took every plank; with a research short of a whole trainload or more (Bridges, 10),
 * towns got none for minutes and coins froze. Three fifths (6 of a 9-plank load): the research still fills, a pass at a
 * time, and towns earn. (Half made Cities come before minute 60 on two seeds of the balance run; spec §5.)
 */
export const SCHOOL_SHARE = 0.6;

/** Ticks between looks at the towns' mail (a second's worth). */
const MAIL_LOOK = Math.round(1 / SIM_DT);
/**
 * Seconds of running a sorting van takes per sack of mail on it (Game mode's Sorting van): its whole load turns to post
 * once it has run that long for each sack. Slower than a post office (10 s a sack, `RECIPES.postoffice`), and only while
 * its train is moving, so the van saves the stop but not the time.
 */
export const SORT_SECONDS = 15;

export const RECIPES: Record<DepotRole, Recipe> = {
  forest: { takes: [], gives: ["log"], cycle: { uses: {}, makes: { log: 1 }, seconds: 15 } },
  sawmill: { takes: ["log"], gives: ["planks"], cycle: { uses: { log: 1 }, makes: { planks: 1 }, seconds: 8 } },
  // A town also posts mail (Game mode, once Post office is learned: `Economy.mailEvery`) and takes the sorted post.
  town: { takes: ["planks", "flour", "stone", "iron", "furniture", "tools", "milk", "bread", "fruit", "juice", "cheese", "icecream", "bricks", "autos", "fish", "oil", "water", "sugar", "jam", "chocolate", "flowers", "paint", "toys", "post"], gives: ["mail"], cycle: { uses: {}, makes: {}, seconds: 30, eats: true } },
  // Takes goods in to make things from (Game mode's crafting draws on its pile; it makes nothing by itself).
  // Stone only while a harbour's price still needs some at the workshop (`owed`, `Economy.owes`): it isn't a building
  // good, so it isn't kept for its own sake, and doesn't take the towns' stone.
  // (And paint for your own colours on trains, once Paint your trains is learned: `owed`, game/crafting.ts's `shopOwes`.)
  workshop: { takes: ["planks", "iron"], owed: ["stone", "paint"], gives: [], cap: WORKSHOP_CAP },
  // The farm chain (Game mode): a farm yard by the fields fills hoppers with grain; a mill grinds it into flour.
  farm: { takes: [], gives: ["grain"], cycle: { uses: {}, makes: { grain: 1 }, seconds: 12 } },
  mill: { takes: ["grain"], gives: ["flour"], cycle: { uses: { grain: 1 }, makes: { flour: 1 }, seconds: 8 } },
  // The dairy chain (tech-tree I3, I4): a dairy farm's cows give milk; a bakery bakes bread of flour and milk, the
  // first recipe of two goods brought from two chains. An orchard's trees give fruit. Towns take all three.
  dairy: { takes: [], gives: ["milk"], cycle: { uses: {}, makes: { milk: 1 }, seconds: 12 } },
  bakery: { takes: ["flour", "milk"], gives: ["bread"], cycle: { uses: { flour: 1, milk: 1 }, makes: { bread: 1 }, seconds: 10 } },
  orchard: { takes: [], gives: ["fruit"], cycle: { uses: {}, makes: { fruit: 1 }, seconds: 14 } },
  // The next nodes (tech-tree spec, 2026-11-02): a juice works presses an orchard's fruit into juice.
  juicer: { takes: ["fruit"], gives: ["juice"], cycle: { uses: { fruit: 1 }, makes: { juice: 1 }, seconds: 10 } },
  // A creamery makes cheese of a dairy's milk.
  creamery: { takes: ["milk"], gives: ["cheese"], cycle: { uses: { milk: 1 }, makes: { cheese: 1 }, seconds: 12 } },
  // An ice cream factory: milk and fruit, from two chains, make ice cream (carried only in cold vans).
  icecream: { takes: ["milk", "fruit"], gives: ["icecream"], cycle: { uses: { milk: 1, fruit: 1 }, makes: { icecream: 1 }, seconds: 12 } },
  // A post office sorts the towns' mail into post for towns (the post: mail vans carry both). One every 10 s: two
  // big cities' mail, so one office isn't worth 80 coins a minute (docs/balance-2026-11-05.md).
  postoffice: { takes: ["mail"], gives: ["post"], cycle: { uses: { mail: 1 }, makes: { post: 1 }, seconds: 10 } },
  // Stone cut from a hillside (Game mode's quarries).
  quarry: { takes: [], gives: ["stone"], cycle: { uses: {}, makes: { stone: 1 }, seconds: 14 } },
  // Mining and iron (Phase C): a mine in the hills brings up coal and ore; a foundry makes iron of them.
  mine: { takes: [], gives: ["coal", "ore"], cycle: { uses: {}, makes: { coal: 1, ore: 1 }, seconds: 18 } },
  foundry: { takes: ["coal", "ore"], gives: ["iron"], cycle: { uses: { coal: 1, ore: 1 }, makes: { iron: 1 }, seconds: 10 } },
  // A brickworks fires bricks of a quarry's stone and a mine's coal (the next nodes, 2026-11-02).
  brickworks: { takes: ["stone", "coal"], gives: ["bricks"], cycle: { uses: { stone: 1, coal: 1 }, makes: { bricks: 1 }, seconds: 12 } },
  // A car factory builds cars of a foundry's iron and a sawmill's planks (tech tree 3): they leave on a car carrier.
  carworks: { takes: ["iron", "planks"], gives: ["autos"], cycle: { uses: { iron: 1, planks: 1 }, makes: { autos: 1 }, seconds: 14 } },
  // Tank wagons' wells: an oil well pumps oil, a water pump water from the river or lake beside it.
  oilwell: { takes: [], gives: ["oil"], cycle: { uses: {}, makes: { oil: 1 }, seconds: 14 } },
  waterpump: { takes: [], gives: ["water"], cycle: { uses: {}, makes: { water: 1 }, seconds: 10 } },
  // The goods chains (2026-11-04), each ending (A + B) -> C as the bakery does: a sugar beet field's sugar and an
  // orchard's fruit make jam; cocoa (landed at harbours) and a dairy's milk make chocolate; a flower field's flowers
  // make paint at a dye works, and a toy workshop makes toys of paint and planks.
  beetfield: { takes: [], gives: ["sugar"], cycle: { uses: {}, makes: { sugar: 1 }, seconds: 12 } },
  jamworks: { takes: ["fruit", "sugar"], gives: ["jam"], cycle: { uses: { fruit: 1, sugar: 1 }, makes: { jam: 1 }, seconds: 12 } },
  chocworks: { takes: ["cocoa", "milk"], gives: ["chocolate"], cycle: { uses: { cocoa: 1, milk: 1 }, makes: { chocolate: 1 }, seconds: 14 } },
  flowerfield: { takes: [], gives: ["flowers"], cycle: { uses: {}, makes: { flowers: 1 }, seconds: 12 } },
  dyeworks: { takes: ["flowers"], gives: ["paint"], cycle: { uses: { flowers: 1 }, makes: { paint: 1 }, seconds: 10 } },
  toyworks: { takes: ["planks", "paint"], gives: ["toys"], cycle: { uses: { planks: 1, paint: 1 }, makes: { toys: 1 }, seconds: 14 } },
  // Made goods: a carpenter's yard makes furniture of planks, a smithy tools of iron.
  carpenter: { takes: ["planks"], gives: ["furniture"], cycle: { uses: { planks: 3 }, makes: { furniture: 1 }, seconds: 12 } },
  smithy: { takes: ["iron"], gives: ["tools"], cycle: { uses: { iron: 2 }, makes: { tools: 1 }, seconds: 14 } },
  // A power station burns coal; while it has some, electric engines run.
  power: { takes: ["coal"], gives: [], cycle: { uses: { coal: 1 }, makes: {}, seconds: 60 } },
  // A harbour (Game mode) takes any good onto its quay for the boats that call by themselves (`src/game/harbours.ts`).
  harbour: { takes: CARGO_KINDS.filter((k) => !POSTAL.has(k)), gives: [] },
  // An airport (Game mode): a passenger stop, no goods. Riders brought there wait in its lounge for a plane; planes
  // leave visitors there for a train to take on (`src/game/airports.ts`).
  airport: { takes: [], gives: [] },
  // A mooring mast (Game mode): riders brought there board the airship for a tour (`src/game/airship.ts`).
  mast: { takes: [], gives: [] },
  // A school (Game mode's research): goods go into the research, not onto piles. What it takes is the mode's say
  // (`accepts`: only what the research still lacks); each unit is handed to `intoSink` as it lands.
  school: { takes: CARGO_KINDS.filter((k) => k !== "log" && !POSTAL.has(k)), gives: [], cap: WORKSHOP_CAP, sink: true },
  // Keeps goods for later: everything, more of it. Routed trains drop or pick up there as their stops say.
  // (Not the post: mail goes to a post office, the post to towns.)
  warehouse: { takes: CARGO_KINDS.filter((k) => !POSTAL.has(k)), gives: CARGO_KINDS.filter((k) => !POSTAL.has(k)), cap: 24, routedOnly: true },
  // A river landing (Game mode's River barges, src/game/boats.ts): a warehouse with a jetty. Routed trains drop or pick
  // up there as their stops say, and so do the barges the player routes on the river.
  landing: { takes: CARGO_KINDS.filter((k) => !POSTAL.has(k)), gives: CARGO_KINDS.filter((k) => !POSTAL.has(k)), cap: 24, routedOnly: true },
  // A ferry slip (Game mode's Train ferry, src/game/ferry.ts): a train routed there rides the ferry abroad and back.
  // Nothing is craned on or off: the ferry sells its load abroad and brings goods back in its wagons.
  slip: { takes: [], gives: [] },
  // Yards (src/game/yards.ts): trains bring a boatyard planks and iron for tugs and barges, a shipyard iron, planks and
  // tools for cargo ships and ferries; the yard's order uses them up.
  boatyard: { takes: ["planks", "iron"], gives: [], cap: 24 },
  shipyard: { takes: ["planks", "iron", "tools"], gives: [], cap: 40 },
  // Sandbox's cargo machines: an endless heap of one good, and somewhere goods vanish.
  "loader-log": { takes: [], gives: ["log"], endless: true },
  "loader-grain": { takes: [], gives: ["grain"], endless: true },
  "loader-coal": { takes: [], gives: ["coal"], endless: true },
  "loader-planks": { takes: [], gives: ["planks"], endless: true },
  unloader: { takes: [...CARGO_KINDS], gives: [], sink: true },
};

/** A store: keeps goods for routed trains, its Takes set on its card (a warehouse, a river landing). */
export const isStore = (role: DepotRole): boolean => role === "warehouse" || role === "landing";

/** The piles a kind of depot keeps: what it takes and what it gives. */
/** Most units a pile of this kind of depot holds. */
export function capOf(role: DepotRole): number {
  return RECIPES[role].cap ?? PILE_CAP;
}

/** What a harbour's dock shed adds to each of its piles (Game mode; up to `MAX_SHEDS`). */
export const SHED_CAP = 12;
export const MAX_SHEDS = 3;

/** How much each pile of this depot holds: its kind's, and its dock sheds' (a harbour's). */
export function capAt(d: DepotState): number {
  return capOf(d.role) * (d.stack ?? 1) + d.sheds * SHED_CAP;
}

/** Lift and load (Game mode): a warehouse's piles stack this many times as high, and its crane lifts `LIFT_LOADS` a move. */
export const LIFT_STACK = 3;
export const LIFT_LOADS = 2;

export function pilesOf(role: DepotRole): CargoKind[] {
  const r = RECIPES[role];
  return CARGO_KINDS.filter((k) => r.takes.includes(k) || r.gives.includes(k) || !!r.owed?.includes(k));
}

/**
 * What a warehouse lets trains do with a good (its card: a row per good, and one for any other): take it in and give it
 * out ("both", the default), only take it in ("in"), only give it out ("out"), or neither ("off"). It applies to every
 * train, beside a route stop's own Only drop / Only pick up: the stricter wins (`Economy.dropsAt` and `picksAt` say what
 * the route wants; the depot's mode is checked as the crane works: `takesNow`, `loadKind`).
 */
export type StoreMode = "both" | "in" | "out" | "off";

/** The store modes, in the order the card shows them. */
export const STORE_MODES: readonly StoreMode[] = ["both", "in", "out", "off"];

/** A depot's mode for this good: its own row's, or (not listed) its "Any other goods". */
export function storeModeOf(d: DepotState, kind: CargoKind): StoreMode {
  return d.modes[CARGO[kind].index] ?? d.others;
}

/** Does this depot's store mode let trains leave `kind` here? */
export function storeLetsIn(d: DepotState, kind: CargoKind): boolean {
  const m = storeModeOf(d, kind);
  return m === "both" || m === "in";
}

/** Does this depot's store mode let trains take `kind` away? */
export function storeLetsOut(d: DepotState, kind: CargoKind): boolean {
  const m = storeModeOf(d, kind);
  return m === "both" || m === "out";
}

/**
 * An industry that gives more than one good (the mine: coal and ore): its card lets the player say which of them trains
 * load there ("both": Gives, the default; "off": Doesn't give), in its depot's `modes`. What it takes stays automatic.
 */
export function givesChoice(role: DepotRole): boolean {
  const r = RECIPES[role];
  return r.gives.length > 1 && !r.routedOnly && !r.endless;
}

/** A good on a warehouse's own list (its card shows a row for it even while it holds none). */
export function storeListed(d: DepotState, kind: CargoKind): boolean {
  return d.modes[CARGO[kind].index] !== null;
}

/**
 * What a train does at a stop on its route: only drop goods off, only pick goods up, or ("auto", a line's default)
 * what the line's stops call for: it drops what this stop takes and picks up what a later stop takes (the intent
 * rules: `Economy.dropsAt`, `picksAt`). "both" (older routes) is "auto", as the engine card shows it.
 */
export type StopAction = "auto" | "both" | "drop" | "pick";

/**
 * Why a wagon keeps its goods at a depot it's beside (`Economy.keepWhy`): it has nothing the depot takes ("nothing"),
 * the depot doesn't want it now ("unwanted": a town that has all it needs, a school whose research doesn't lack it),
 * its yard is full ("full"), it's set to share with towns and has its part ("shares"), the train's route has no stop
 * there ("not-stop") or drops it there on another visit ("route"), a town leaves it for the workshop's waiting order
 * ("order"), or a town or the workshop leaves it for a school set to Research first ("school").
 */
export type KeepWhy = "nothing" | "unwanted" | "full" | "shares" | "not-stop" | "route" | "order" | "school";

/** A stop on a route: the depot, what the train does there, and (lines) whether it waits there to fill. */
export interface RouteStopDef {
  depotId: number;
  action: StopAction;
  waitFill?: boolean;
  /**
   * Via points: pieces (track, a station's or a halt's) its trains pass on the way from this stop to the next, in order,
   * without stopping there (the routing spec §3.5).
   */
  via?: number[];
}

/**
 * A line: a route with a colour and a name, run by a train (Phase 2: several). Its `stops` are the very array its
 * trains' routes hold, so an edit to the line is the trains' route at once. Kept by the economy (`lines`, and which
 * engine runs which: `lineIdOf`); made and edited through src/game/lines.ts.
 */
export interface Line {
  readonly id: number;
  colour: string;
  name: string;
  readonly stops: RouteStopDef[];
}

/** What the economy's intent rules read of a car's line (see `lineOfCar`). */
export interface LineView {
  stops: { depot: number; intent: "auto" | "drop" | "pick"; waitFill: boolean }[];
}

/**
 * A train's route: the depots it stops at, in order, and what it does at each. A routed train is served only at the
 * stop it's heading for, `next` (stops in a row at one depot are one visit), and the switches ahead of it are set
 * toward it (see `steer`); passing that stop moves `next` on.
 */
export interface Route {
  stops: RouteStopDef[];
  /** The stop it's heading for (an index into `stops`). */
  next: number;
  /** It's at its next stop now (it moves on to the one after when it leaves). */
  at?: boolean;
  /** Via points passed on the way into stop `viaFor` (see routing/via.ts). */
  viaFor?: number;
  viaDone?: number;
}

const NO_ROADS: readonly DepotState[] = [];
const NO_ENGINES: number[] = [];

/** Has this train a sorting van (Sorting van: its mail is post by the next stop)? */
const sortsMail = (train: Train): boolean => train.cars.some((c) => c.kind === "sortvan");

/** A depot's further tracks: see `Economy.setTracks`. */
export interface DepotTracks {
  readonly roads: readonly DepotState[];
  readonly ends: readonly number[];
  readonly ladder: readonly number[];
}

export interface DepotState {
  readonly id: number;
  readonly pieceId: number;
  readonly role: DepotRole;
  /**
   * The town a station depot belongs to (−1 for goods depots); a halt's, the town nearest it (set again when it moves:
   * `syncHalts`).
   */
  townId: number;
  /** Load and unload trains by itself. */
  auto: boolean;
  /** Trains wait under the crane until each wagon is full. */
  waitFull: boolean;
  /**
   * A workshop that takes all the planks a train brings, up to its yard's cap, though a town further on wants them
   * ("Takes all planks"); false (the default), it shares: `shopKeeps` says how many it keeps. A school the same way:
   * set to Research first: trains keep what its research lacks for it past towns and workshops (`keptForSchool`), and
   * it takes all of it; or (the default) its share of a load while a town ahead wants it, nothing kept for it.
   */
  takesAll: boolean;
  /** Units on each pile, by cargo index. */
  readonly piles: Int32Array;
  /** Ticks into the current production (forest, sawmill) or use (town) cycle. */
  timer: number;
  /** How fast it makes things, against its recipe (an industry near fewer of its resource is slower; 0 stops it). */
  rate: number;
  /** Its piles stack this many times as high (a warehouse with Lift and load: `LIFT_STACK`); 1 or unset otherwise. */
  stack?: number;
  /** Where wagons stop for the crane: distance (mm) from the depot path's `from` end. */
  readonly craneAt: number;
  /**
   * Game mode's power (src/game/power.ts): 0, or this yard was asked to be powered, the nth ask (sparks go to yards in
   * the order asked).
   */
  powerAsk: number;
  /** People waiting at a town's station for a coach (Game mode's passengers); an airport's: visitors off its planes. */
  waiting: number;
  /** Riders in an airport's lounge, waiting for a plane (at most `AIRPORT_LOUNGE`); 0 for anything else. */
  flyers: number;
  /** Dock sheds beside a harbour's quay (Game mode): each holds more of every good (see `capAt`). */
  sheds: number;
  /**
   * A warehouse's goods the player has listed, and what it lets trains do with each (`StoreMode`), by cargo index; null:
   * not listed (it follows `others`). Set with `Economy.setStoreMode`; every other depot keeps them all null.
   */
  readonly modes: (StoreMode | null)[];
  /** What it does with goods not listed ("Any other goods"): "both" by default; "off" keeps only the listed goods. */
  others: StoreMode;
  /**
   * A workshop's keep amounts, set on its card, by cargo index: how many of each good its yard takes while set to share
   * and a town (or a sharing school) the train goes on to wants it (`shopKeeps` is passed the depot and reads them);
   * null: the game's own amount (planks: a few for the next thing to make, `yardKeeps`; others: all). Set with
   * `Economy.setKeep`; every other depot keeps them all null.
   */
  readonly keeps: (number | null)[];
}

/** People riding a coach: how many, and the station (depot id) they got on at. */
export interface Riders {
  count: number;
  from: number;
  /** They've been over a bridge or along a hilltop on this ride (an observation car's riders pay more: `markScenic`). */
  scenic?: boolean;
}

export interface CarCargo {
  kind: CargoKind | null;
  count: number;
}

/** A crane move in progress (filled in by `Economy.craneMove`; allocate one per caller and reuse it). */
export interface CraneMove {
  kind: CargoKind;
  /** From the wagon to a pile (true), or the other way. */
  toPile: boolean;
  carId: number;
  /** 0–1 through the move. */
  phase: number;
}

/** Something the crane did this tick (for sounds and small effects). */
export interface EconomyEvent {
  readonly kind: "loaded" | "unloaded";
  readonly depotId: number;
  readonly cargo: CargoKind;
}

/**
 * What happens at a stop, for the station's little touches (people turning to the train, stepping on and off, the
 * guard's flag, `StationTouches`): a train halted at a depot or a kit's stop, someone got on or off a coach there, the
 * train set off (its work there done, or it went). `pieceId` is the stop's piece; `carId` the coach (−1: none).
 */
export interface StationEvent {
  readonly kind: "halted" | "on" | "off" | "left";
  readonly pieceId: number;
  readonly trainId: number;
  readonly carId: number;
}

/** Most station events kept undrained (nothing drains them in tests or headless runs: the oldest go). */
const STATION_LOG_MAX = 64;

export type CargoSlot = { readonly kind: "pile"; readonly depotId: number; readonly cargo: CargoKind } | { readonly kind: "car"; readonly carId: number };

/**
 * What a line's later stops take, seen from one of its stops: the line's other stops, round the line from it, leaving
 * out every stop at its own depot (a line doesn't pick up at A what only A takes). Cargo bitmasks by cargo index.
 * Only stops that may drop (not "pick") at automatic depots still on the map count. See `Economy.laterOf`.
 */
interface Later {
  /** Goods some later stop takes, a warehouse counting (it keeps whatever it's given). */
  takes: number;
  /** Goods some later stop other than a warehouse takes: somewhere they're used. */
  uses: number;
  /** Goods a later workshop takes (it has the first claim on them while they're `reserved`). */
  shop: number;
  /**
   * Goods a later school set to Research first (`takesAll`) takes (what its research still lacks) before any later stop
   * but a town's or a workshop's does: a town or a workshop leaves them on the train for it (`keptForSchool`).
   */
  school: number;
  /** A later stop is a town's station (riders have somewhere to get off). */
  town: boolean;
  /** Goods some later town takes (it wants them): a school takes only its share of them (`SCHOOL_SHARE`). */
  towns: number;
  /**
   * Goods some later town takes, or a later school left sharing (not `takesAll`) whose research lacks them: a workshop
   * set to share keeps only its part of them (`shopKeeps`) and leaves the rest on the train.
   */
  sharers: number;
}

/** `Later` for each stop of one stop list, and what it was worked out from (see `Economy.laterOf`). */
interface LaterCache {
  stamp: number;
  wants: number;
  accepts: Economy["accepts"];
  pieces: number;
  readonly at: Later[];
}

const EMPTY: CarCargo = { kind: null, count: 0 };
const NO_RIDERS: Riders = { count: 0, from: -1 };

/**
 * Depots, their piles and the cargo riding on wagons. Pure and deterministic: everything advances in whole sim
 * ticks from `tick()`, called once after every `Sim.tick()`.
 */
export class Economy {
  private readonly depots: DepotState[] = [];
  private readonly byPiece = new Map<number, DepotState>();
  private readonly cargo = new Map<number, CarCargo>();
  /** Coach car id → the people riding it. */
  private readonly riders = new Map<number, Riders>();
  /** Engine car id → its train's route (see `Route`). Trains with none are served at any depot they pass. */
  private readonly routes = new Map<number, Route>();
  /** Lines by id (see `Line`), and the line each engine runs. */
  readonly lines = new Map<number, Line>();
  /** The player's boats, by id (Game mode's River barges: src/game/boats.ts). */
  readonly boats = new Map<number, BoatState>();
  /** Loads boats have dropped at a dock other than where they picked them up (the goal "Float goods down the river"). */
  boatDelivered = 0;
  /** Cars whose trains are held still where they stand, whatever else says (a train on the ferry abroad). */
  readonly held = new Set<number>();
  /** What each yard is building (by its depot id), saved with the map: src/game/yards.ts. */
  readonly yardOrders = new Map<number, YardOrder>();
  /** Cargo ships and train ferries built at shipyards (they call at harbours, sail from slips). */
  shipsBuilt = 0;
  ferriesBuilt = 0;
  /** Loads cargo ships have taken from harbours (the goal "Send a ship abroad"). */
  shipLoads = 0;
  readonly lineIdOf = new Map<number, number>();
  /** Town id → plank bundles delivered there (by train or by hand). */
  readonly delivered = new Map<number, number>();
  /** Town id → everything delivered there, by kind (planks are counted in `delivered` too). */
  readonly deliveredGoods = new Map<number, Bag>();
  /**
   * Town id → what was delivered there while it was joined by road to another town (roads spec D2), by kind: a part
   * of it counts again toward the town's growth (`roadBonus`, town-life.ts). Only ever goes up, so a road taken up
   * later never takes a level away.
   */
  readonly roadGot = new Map<number, Bag>();
  /** Is this town joined by road to another now (Game mode's towns: `TownLife`; null: never)? Asked per delivery. */
  joinedByRoad: ((townId: number) => boolean) | null = null;
  /**
   * Station depot id → goods in its yard for its delivery van (roads spec D5), those riding the van counted too until
   * they're handed over. Saved (`vanYard`).
   */
  readonly vanYard = new Map<number, Bag>();
  /**
   * Does this unit, landing at a town's station, go on the van yard (for a town off the line) rather than to the town
   * (Game mode: `TownLife`, with `DeliveryVans`; null: never)? Asked per unit as the crane lands it.
   */
  toVan: ((d: DepotState, kind: CargoKind) => boolean) | null = null;
  /** A unit went on a station's van yard (the van loads up and goes). */
  onVanYard: ((d: DepotState) => void) | null = null;
  /**
   * Town id → the place under way there (Game mode's civic and leisure places, game/places.ts): its id and the goods it
   * has had so far, by kind. Saved (`placePlans`).
   */
  readonly placePlans = new Map<number, { id: string; got: Bag }>();
  /**
   * How many more of `kind` town `townId`'s place under way wants (Game mode: `TownLife`; null: none). Such a unit,
   * landing at the town's station, goes into the place (unpaid, not toward growth) before anything else.
   */
  placeWants: ((townId: number, kind: CargoKind) => number) | null = null;
  /** A unit went into a town's place under way. */
  onPlaceGoods: ((d: DepotState) => void) | null = null;
  private readonly services = new Map<number, Service>();
  /** Each stop list's `Later`s (see `laterOf`), and the counters they're keyed on. */
  private readonly laterCache = new WeakMap<readonly RouteStopDef[], LaterCache>();
  /** Bumped when a route is set (a line edited) or a depot's Automatic changes. */
  private stopsStamp = 0;
  /** Bumped when a routed train's next stop changes (a route set, a stop left or skipped): departure boards redraw then. */
  private nextStamp = 0;
  /** Changes whenever a routed train's next stop may have: what a departure board shows (never read per frame). */
  get nextVersion(): number {
    return this.nextStamp + this.stopsStamp;
  }
  /** Bumped when goods reach a town (what it still wants may change). */
  private wantsStamp = 0;
  private events: EconomyEvent[] = [];
  /** The other half of the event double buffer (no new array each drain). */
  private drained: EconomyEvent[] = [];
  /** Station events since the last drain (see `StationEvent`), and the other half of their double buffer. */
  private stationLog: StationEvent[] = [];
  private stationDrained: StationEvent[] = [];
  /** Trains stopping at kit pieces' stops (a platform's dwell: see `KitStops`). */
  readonly kitStops: KitStops;
  /**
   * Road vehicles (roads spec §3: vans and buses), ticked here with the trains' work so a headless run moves them too.
   * Nothing at all while they're all parked.
   */
  readonly roadVehicles = new RoadVehicles();

  constructor(
    readonly layout: Layout,
    readonly sim: Sim,
  ) {
    // A kit with a depot on it (Game mode's halts) stops trains as the depot does, for its work: not for its dwell too.
    this.kitStops = new KitStops(layout, sim, (pieceId) => this.byPiece.has(pieceId));
    this.kitStops.onStop = (kind, pieceId, trainId) => this.stationNote(kind, pieceId, trainId, -1);
    sim.speedCap = (train) => this.capFor(train);
    // (A train the router holds short of points claims nothing there: routing spec §13 step 7.)
    sim.waitsAt = (train) => this.router.waitsAt(train);
    this.sections = new Sections(layout, sim, {
      lineOf: (engine) => {
        const id = this.lineIdOf.get(engine);
        return id !== undefined && this.lines.has(id) && this.routes.has(engine) ? id : -1;
      },
      live: (lineId) => {
        const live: number[] = [];
        for (const [engine, id] of this.lineIdOf) {
          if (id !== lineId || !this.routes.has(engine)) continue;
          const found = this.sim.findCar(engine);
          if (found && !found.train.derailed) live.push(engine);
        }
        return live;
      },
      target: (engine) => this.headingFor(engine),
      lap: (engine) => this.lapOf(engine),
      stopPieces: (lineId) => {
        const line = this.lines.get(lineId);
        const out: number[] = [];
        for (const st of line?.stops ?? []) {
          const d = this.depots[st.depotId];
          if (d && this.onMap(d) && out[out.length - 1] !== d.pieceId) out.push(d.pieceId);
        }
        if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
        return out;
      },
      drive: (train) => this.drive(train),
      skipStops: (engine, pieces) => {
        const r = this.routes.get(engine);
        if (!r || r.stops.length === 0 || r.at) return;
        // (Aimed at via points on those pieces: they're passed, this time.)
        if (skipVias(r, r.stops.length, (k) => r.stops[k].via, pieces)) return;
        // (On to the first stop not on those pieces; all of them on it: as it was.)
        let i = r.next % r.stops.length;
        for (let k = 0; k < r.stops.length; k++) {
          const d = this.depots[r.stops[i].depotId];
          if (!d || !pieces.has(d.pieceId)) {
            if (r.next !== i) this.nextStamp++;
            r.next = i;
            return;
          }
          i = (i + 1) % r.stops.length;
        }
      },
      restsAt: (pieceId) => this.router.defaultOf(pieceId),
      sameDepot: (a, b) => this.sameDepot(a, b),
      keep: (engine) => this.router.ways.of(this.ownerOf(engine)),
    });
    this.router = new Router({
      layout,
      sim,
      routed: this.routes,
      // (Where it's heading: at a stop, the one after, as sections have it, or a via point on the way there. Not the stop
      // it's at: leaving a stop right before points, it would ask for nothing and run over them as they lie, set for the
      // train ahead.)
      goal: (engine) => this.goalOf(engine, 0),
      then: (engine) => this.goalOf(engine, 1),
      owner: (engine) => this.ownerOf(engine),
      drive: (train) => this.drive(train),
      granted: (engine) => this.sections.steerHint(engine),
      awaitingGrant: (engine) => this.sections.awaitingGrant(engine),
      soon: this.sections.steerSoon,
      fullAt: (engine) => this.fullAt(engine),
    });
    // (Path signals read the router's locks: signals spec §3.1.)
    const router = this.router;
    sim.pathLocks = { locks: (t, points, choice) => router.pathLocks(t, points, choice), way: (t, id, entry) => router.pathWay(t, id, entry), version: () => router.locksVersion };
    // (And sections' waiting points: a mark shows clear for a line's train only once its move past it is granted.)
    const sections = this.sections;
    sim.signalGate = { at: (ref) => sections.gateAt(ref), version: () => sections.gateVersion() };
    this.stalls = new Stalls(sim, this.sections, {
      lineOf: (engine) => this.lineIdOf.get(engine) ?? -1,
      routeWait: (engine) => this.router.waitingOn(engine),
      // (A train with no stops goes anywhere: it gives way first.)
      routed: (engine) => (this.routes.get(engine)?.stops.length ?? 0) > 0,
      goal: (engine) => this.goalOf(engine, 0),
      otherRoad: (id, by) => {
        const t = sim.getTrain(id);
        return !!t && this.router.giveWayRoad(t, sim.piecesUnder(by));
      },
    });
    this.breakdown = new Breakdown(layout, sim, {
      onLine: (engine) => this.lineIdOf.has(engine),
      locked: (pieceId) => this.router.locked(pieceId),
      thrown: (pieceId) => this.router.onSwitch?.(pieceId),
      removed: () => this.prune(),
    });
  }

  /**
   * Where a routed train is aimed on its way into stop `i`: its next via point not passed, else the stop's piece (`skip`:
   * aims on, see `aimOf`); −1 while there's none on the map.
   */
  private aim(r: Route, i: number, skip = 0, engine = -1): number {
    const d = this.depots[r.stops[i].depotId];
    const stop = d && this.onMap(d) ? (skip === 0 && engine !== -1 && this.tracks.has(d.id) ? this.trackFor(engine, d) : d.pieceId) : -1;
    if (!r.stops.some((s) => s.via && s.via.length > 0)) return skip === 0 ? stop : -1;
    return aimOf(r, r.stops.length, i, (k) => r.stops[k].via, (p) => !!this.layout.getPiece(p), stop, skip);
  }

  /**
   * Where a routed engine is heading (the router's goal, sections' target): its next stop's piece, or standing at it
   * (`at`) the stop after (a different depot), or a via point on the way there (`skip`: aims on, see `aimOf`). −1: none.
   */
  private goalOf(engine: number, skip: number): number {
    const r = this.routes.get(engine);
    if (!r || r.stops.length === 0) return -1;
    let i = r.next % r.stops.length;
    // (At its stop: the stop after, a different depot; past any it has run onto already, between its front and this
    // one: it comes to them as soon as it's off this one. Aimed at one behind its front, the router would ask for
    // nothing, or for the way back round to it, and it would run over the points ahead as they lie.)
    if (r.at) {
      const here = r.stops[i].depotId;
      const hereAt = this.depots[here]?.pieceId ?? -1;
      const train = this.sim.findCar(engine)?.train;
      for (let k = 0; k < r.stops.length; k++) {
        const id = r.stops[i].depotId;
        if (id !== here) {
          const d = this.depots[id];
          if (!train || !d || !this.onMap(d) || !ranOnto(train.bogies, this.drive(train), hereAt, d.pieceId)) break;
        }
        i = (i + 1) % r.stops.length;
      }
    }
    if (skip === 0) this.full.delete(engine);
    return this.aim(r, i, skip, engine);
  }

  /**
   * Which of depot `d`'s tracks routed engine `engine` is sent to (it has several): the one its train is on already;
   * else the one it was given, while no other train is on it; else the first free one, in order (the depot's own track,
   * then track 2, then 3): no train on it and none given it. All taken: the depot's own track, and it's marked to wait
   * short of the ladder (`fullAt`). Every train of a line comes to the same answer in the same state.
   */
  private trackFor(engine: number, d: DepotState): number {
    const found = this.sim.findCar(engine);
    if (!found) return d.pieceId;
    const mine = this.sim.piecesUnder(found.train.id);
    const tracks = [d.pieceId, ...this.roadsOf(d.id).map((r) => r.pieceId)];
    const on = tracks.find((p) => mine.has(p));
    if (on !== undefined) {
      this.trackOf.set(engine, { depotId: d.id, pieceId: on });
      return on;
    }
    const taken = (p: number) => {
      if (this.sim.pieceOccupied(p)) return true;
      for (const [e, t] of this.trackOf) {
        if (e === engine || t.pieceId !== p) continue;
        // (Given to a train still heading there: its route's next stop is this depot.)
        const r = this.routes.get(e);
        if (r && r.stops.length > 0 && r.stops[r.next % r.stops.length].depotId === t.depotId && this.sim.findCar(e)) return true;
      }
      return false;
    };
    const had = this.trackOf.get(engine);
    if (had && had.depotId === d.id && tracks.includes(had.pieceId) && !taken(had.pieceId)) return had.pieceId;
    const free = tracks.find((p) => !taken(p));
    if (free !== undefined) {
      this.trackOf.set(engine, { depotId: d.id, pieceId: free });
      return free;
    }
    this.trackOf.delete(engine);
    this.full.set(engine, d.id);
    return d.pieceId;
  }

  /**
   * A routed train whose next stop's tracks are all taken: where it waits (the router stands it short of the first of
   * these points on its way: the stop's ladder), and for whom (an engine standing on one of the tracks; −1 if none is).
   */
  fullAt(engine: number): { ladder: ReadonlySet<number>; by: number } | null {
    const id = this.full.get(engine);
    if (id === undefined) return null;
    const t = this.tracks.get(id);
    const d = this.depots[id];
    if (!t || !d) return null;
    const tracks = new Set([d.pieceId, ...t.roads.map((r) => r.pieceId)]);
    let by = -1;
    for (const tid of this.sim.trainIds()) {
      const tr = this.sim.getTrain(tid);
      if (!tr || !tr.bogies.some((b) => tracks.has(b.pieceId))) continue;
      by = tr.cars.find((c) => c.kind === "engine")?.id ?? -1;
      if (by !== -1) break;
    }
    if (by === -1) for (const [e, g] of this.trackOf) if (g.depotId === id && e !== engine) by = e;
    return { ladder: new Set(t.ladder), by };
  }

  /** Are pieces `a` and `b` tracks of the same depot (a depot of several tracks: any two of them)? */
  sameDepot(a: number, b: number): boolean {
    const da = this.byPiece.get(a);
    return !!da && da.id === this.byPiece.get(b)?.id;
  }

  /** Its aims round one lap from the one it has now (`lapAims`: sections' `circling`). */
  private lapOf(engine: number): number[] {
    const r = this.routes.get(engine);
    if (!r || r.stops.length === 0) return [];
    let i = r.next % r.stops.length;
    if (r.at) {
      const here = r.stops[i].depotId;
      for (let k = 0; k < r.stops.length && r.stops[i].depotId === here; k++) i = (i + 1) % r.stops.length;
    }
    const onMap = (p: number) => !!this.layout.getPiece(p);
    const stop = (k: number) => {
      const d = this.depots[r.stops[k].depotId];
      return d && this.onMap(d) ? d.pieceId : -1;
    };
    return lapAims(r.stops.length, i, viaDone(r, i), (k) => r.stops[k].via, onMap, stop);
  }

  /** Where a routed engine is aimed now, for the map: its next stop's piece (at it, that stop), or a via point on the way; −1: none. */
  aimOf(engine: number): number {
    const r = this.routes.get(engine);
    if (!r || r.stops.length === 0) return -1;
    // (Standing at a stop: that stop, for the map's ribbon, which draws the legs on from it.)
    if (r.at) {
      const d = this.depots[r.stops[r.next % r.stops.length].depotId];
      return d && this.onMap(d) ? d.pieceId : -1;
    }
    return this.goalOf(engine, 0);
  }

  /** Whose kept ways (stickiness) a routed engine's plan keeps: its line's, else its own (as a negative number). */
  ownerOf(engine: number): number {
    return this.lineIdOf.get(engine) ?? -(engine + 1);
  }

  /**
   * Trains of a line that wait for each other (see sections.ts): a train in a slot (a passing loop's road, a line end)
   * goes on into the single track ahead only holding it and a slot at its far end.
   */
  readonly sections: Sections;
  /** Which way routed trains go, and the points set for them (and lever taps on points): see routing/router.ts. */
  readonly router: Router;
  /** Trains stuck for good (a ring of waits, or a line's held train in the way), for their cards: see stalls.ts. */
  readonly stalls: Stalls;
  /** Breakdown cranes at work (Game mode's Breakdown crane: src/economy/breakdown.ts). */
  readonly breakdown: Breakdown;

  /**
   * Where a routed engine is going: its next stop's piece, or (standing at it) the next different depot's; −1: no
   * route, or that stop isn't on the map.
   */
  routeTarget(engine: number): number {
    return this.headingFor(engine);
  }


  /**
   * Checks run after every tick (the train invariants, src/sim/invariants.ts: dev builds, QA, the play-throughs).
   * Null in a production build: nothing is checked.
   */
  checker: { check(): void } | null = null;

  /** Why a routed engine is held by sections (null: it isn't). */
  sectionWait(engine: number): BlockWait | null {
    return this.sections.waitOf(engine);
  }

  /** Register a depot on a piece. `craneAt` defaults to the middle of the piece's track. */
  addDepot(role: DepotRole, pieceId: number, townId = -1, craneAt?: number): DepotState {
    const p = this.layout.getPiece(pieceId);
    const len = p ? pathLength(getPieceDef(p.type, p.flipped).paths[0].geom) : 216;
    const d: DepotState = { id: this.depots.length, pieceId, role, townId, auto: true, waitFull: false, takesAll: false, piles: new Int32Array(CARGO_SLOTS), timer: 0, rate: 1, powerAsk: 0, craneAt: craneAt ?? len / 2, waiting: 0, flyers: 0, sheds: 0, modes: Array.from({ length: CARGO_SLOTS }, () => null), others: "both", keeps: Array.from({ length: CARGO_SLOTS }, () => null) };
    if (role === "warehouse" && this.liftLoad) d.stack = LIFT_STACK;
    // An endless heap is full from the start.
    if (RECIPES[role].endless) for (const k of RECIPES[role].gives) d.piles[CARGO[k].index] = capAt(d);
    this.depots.push(d);
    this.byPiece.set(pieceId, d);
    return d;
  }

  depot(id: number): DepotState | undefined {
    return this.depots[id];
  }

  /**
   * A depot's further tracks (depot tracks, docs/superpowers/specs/2026-11-04-depot-tracks.md): `roads` are the pieces
   * its crane stands over on each further track (its own is track 1), `ends` the rest of those tracks (kept as they are
   * when another is added), `ladder` the crossovers, straights and buffers joining them to the line. Each road is the
   * depot to everything else (same id, piles, settings and modes: it reads them through to the depot), so a route's
   * stop at the depot is called at on any track; only its piece and crane point are its own. One crane serves them all,
   * a train at a time (`craneTurn`). Roads aren't among `allDepots` (they make nothing and aren't counted).
   */
  setTracks(depot: DepotState, roads: readonly number[], ends: readonly number[], ladder: readonly number[]): void {
    const states = roads.map((pieceId) => {
      const known = this.byPiece.get(pieceId);
      if (known && known.id === depot.id) return known;
      const p = this.layout.getPiece(pieceId);
      const len = p ? pathLength(getPieceDef(p.type, p.flipped).paths[0].geom) : 216;
      const road = Object.create(depot, { pieceId: { value: pieceId, enumerable: true }, craneAt: { value: Math.min(depot.craneAt, len), enumerable: true } }) as DepotState;
      this.byPiece.set(pieceId, road);
      return road;
    });
    if (states.length === 0 && ends.length === 0 && ladder.length === 0) this.tracks.delete(depot.id);
    else this.tracks.set(depot.id, { roads: states, ends: [...ends], ladder: [...ladder] });
    this.tracksVersion++;
  }

  /** A depot's further tracks as laid (`setTracks`), on the map or not; undefined: it has one track. */
  tracksOf(depotId: number): DepotTracks | undefined {
    return this.tracks.get(depotId);
  }

  /** A depot's further tracks on the map now (its roads, in order: track 2, track 3). */
  roadsOf(depotId: number): readonly DepotState[] {
    const t = this.tracks.get(depotId);
    return t ? t.roads.filter((r) => this.onMap(r)) : NO_ROADS;
  }

  /** How many tracks a depot has now: its own, and its roads on the map. */
  trackCount(depotId: number): number {
    return 1 + this.roadsOf(depotId).length;
  }

  /** Changes when any depot's tracks are set (for views drawn from them). */
  tracksVersion = 0;
  private readonly tracks = new Map<number, DepotTracks>();
  /** Depot id → the train whose wagon its one crane is moving a unit for now (a depot of several tracks). */
  private readonly craneBy = new Map<number, number>();
  /** Routed engine → the track (a piece of a depot's) it's sent to at its next stop, a depot of several tracks. */
  private readonly trackOf = new Map<number, { depotId: number; pieceId: number }>();
  /** Routed engines whose next stop's tracks are all taken: they wait short of its ladder (`fullAt`). */
  private readonly full = new Map<number, number>();

  depotAtPiece(pieceId: number): DepotState | undefined {
    return this.byPiece.get(pieceId);
  }

  /**
   * The depots on the map: those whose piece is on the layout. A depot whose piece is taken up (its placement undone,
   * the piece removed) is kept, piles and all, under its id and piece, and is back here when the piece is (redo); while
   * it's gone it makes nothing, no train is served or steered there, and nothing counts it (QA: an undone Harvester
   * stayed listed). Worked out again only when pieces come or go.
   */
  allDepots(): readonly DepotState[] {
    if (this.liveVersion !== this.layout.piecesVersion || this.liveOf !== this.depots.length) {
      this.liveVersion = this.layout.piecesVersion;
      this.liveOf = this.depots.length;
      this.live = this.depots.filter((d) => this.layout.getPiece(d.pieceId));
    }
    return this.live;
  }
  private live: DepotState[] = [];
  private liveVersion = -1;
  private liveOf = -1;

  /**
   * Does this car's train keep its `kind` on board for a school set to Research first (`takesAll` on a school), at a
   * town or a workshop? While the research lacks some (`sinkWants`), a train keeps as many as it lacks (a routed one at
   * most one wagon's worth: `schoolHold`, issue #20), and a town or workshop takes the rest. A routed train keeps them while its line comes to such a school that takes them before
   * anywhere else but a town or workshop that does (`Later.school`); an unrouted one while it comes to one, the points
   * as they lie (`reachOf`: one on joined track it never comes to kept a workshop's planks on the train for good). Only
   * by the school's own visible setting: a school left sharing (its default) holds nothing back (the 2026-11-01 report).
   * A workshop still gets what it keeps for its waiting tray order (`reserved`). Cheap: lookups and the train's cars,
   * only at a town or workshop and only while the research lacks this good.
   */
  private keptForSchool(carId: number, kind: CargoKind, route: Route | null): boolean {
    const want = this.sinkWants?.(kind) ?? 0;
    if (want <= 0) return false;
    const found = this.sim.findCar(carId);
    if (!found) return false;
    if (route) {
      if (!(this.laterOf(route.stops, route.next % route.stops.length).school & (1 << CARGO[kind].index))) return false;
    } else {
      const all = this.allDepots();
      if (this.schoolsOf !== all) {
        this.schoolsOf = all;
        this.schools = all.filter((d) => d.role === "school");
      }
      const first = (d: DepotState) => d.takesAll && d.auto && (!this.accepts || this.accepts(d, kind));
      if (!this.schools.some(first)) return false;
      const reach = this.reachOf(found.train);
      if (!this.schools.some((d) => first(d) && reach.has(d.pieceId))) return false;
    }
    // A hand-run train keeps all the research lacks; a routed one at most one wagon's worth (`schoolHold`). (Issue #20:
    // capping hand-run trains too failed 6 of the 9 balance seeds, not 3, and the goals play-through: holding all
    // carried planks past the first town to the towns beyond the school while the line was still hand-run.)
    if (!route) return this.onBoard(found.train, kind) <= want;
    return this.schoolHold(found.train, kind, want, carId).keeps;
  }

  /**
   * What a train on a route holds of `kind` for a school set to Research first, at most `want` (what the research
   * lacks) and at most `schoolHoldCap`, so the other wagons stay free to drop at towns and the workshop and to load other goods (issue
   * #20: planks held for the school filled both timber wagons, so at the forest they took no logs and a city starved).
   * Its cars of `kind` front to back: the first is held (trimmed to the limit as it drops the rest), later ones only
   * while they fit whole in what's left. `keeps`: `carId` is one held. `held`: how many are held. Cheap: the train's cars.
   */
  private schoolHold(train: Train, kind: CargoKind, want: number, carId: number): { keeps: boolean; held: number } {
    const limit = Math.min(want, this.schoolHoldCap);
    let room = limit;
    let held = 0;
    let first = true;
    let keeps = false;
    for (const car of train.cars) {
      const c = this.cargo.get(car.id);
      if (c?.kind !== kind || c.count <= 0) continue;
      const fits = first ? limit > 0 : c.count <= room;
      if (car.id === carId) keeps = fits && c.count <= room;
      if (fits) {
        const h = Math.min(c.count, room);
        held += h;
        room -= h;
      }
      first = false;
    }
    return { keeps, held };
  }

  /**
   * The most a train on a route holds for a school set to Research first: one wagon's worth (`wagonCapacity`: more with heavy
   * wagons). (Issue #20's balance runs also tried a third of the train's capacity for the good: the same on the nine
   * seeds, and harder to say.)
   */
  get schoolHoldCap(): number {
    return this.wagonCapacity;
  }

  /**
   * How many of `kind` a train holds for a school set to Research first, for its engine card: a routed one's
   * `schoolHold`, a hand-run one's all the research lacks. 0: none.
   */
  heldForSchool(trainId: number, kind: CargoKind): number {
    const train = this.sim.getTrain(trainId);
    const want = this.sinkWants?.(kind) ?? 0;
    if (!train || want <= 0) return 0;
    if (!this.routeOfTrain(train)) return Math.min(want, this.onBoard(train, kind));
    return this.schoolHold(train, kind, want, -1).held;
  }
  private schools: DepotState[] = [];
  private schoolsOf: readonly DepotState[] | null = null;

  /**
   * The pieces a hand-run train comes to from where it is, the way it's driven: the points as they lie (facing ones as
   * set, trailing ones whichever way), turning back at the end of a line (a buffer, or track that just stops) as trains
   * do, until it would go round the same way again. Kept per train till its front is on another piece, it's driven the
   * other way, or pieces, joints or points change.
   */
  private reachOf(train: Train): ReadonlySet<number> {
    const l = this.layout;
    const forward = this.drive(train) >= 0;
    const b = forward ? train.bogies[0] : train.bogies[train.bogies.length - 1];
    const key = `${b.pieceId}:${b.pathIndex}:${b.reversed !== !forward}:${l.piecesVersion}:${l.jointsVersion}:${l.switchesVersion}`;
    const kept = this.reaches.get(train.id);
    if (kept && kept.key === key) return kept.pieces;
    const pieces = new Set<number>([b.pieceId]);
    const piece = l.getPiece(b.pieceId);
    if (piece) {
      const path = getPieceDef(piece.type, piece.flipped).paths[b.pathIndex];
      // Leaving the piece: by `to` heading along its path, by `from` heading back (flipped when driven backward).
      const back = b.reversed === forward;
      let at = b.pieceId;
      let entry = back ? (path.to ?? -1) : path.from;
      let exit = back ? path.from : (path.to ?? -1);
      const seen = new Set<number>();
      for (let k = 0; k < SEARCH; k++) {
        const n = nextPiece(l, at, exit);
        if (!n) {
          // The end of the line: it turns back, out the way it came onto this piece.
          const turn = ~(at * MAX_CONNECTORS + exit + 1);
          if (entry < 0 || seen.has(turn)) break;
          seen.add(turn);
          [entry, exit] = [exit, entry];
          continue;
        }
        const state = n.pieceId * MAX_CONNECTORS + n.entry;
        if (seen.has(state)) break;
        seen.add(state);
        pieces.add(n.pieceId);
        const ways = waysFrom(l, n.pieceId, n.entry);
        if (ways.length === 0) break;
        const w = ways[ways.length > 1 ? pointsWayFrom(l, n.pieceId, n.entry, ways.length) : 0] ?? ways[0];
        at = n.pieceId;
        entry = n.entry;
        exit = w.exit;
      }
    }
    this.reaches.set(train.id, { key, pieces });
    return pieces;
  }
  private readonly reaches = new Map<number, { key: string; pieces: Set<number> }>();

  /** How many of `kind` a train has on board. */
  private onBoard(train: Train, kind: CargoKind): number {
    let on = 0;
    for (const car of train.cars) {
      const c = this.cargo.get(car.id);
      if (c?.kind === kind) on += c.count;
    }
    return on;
  }

  /**
   * Per train, by cargo index: how many it had on board as it last loaded that good (its pass's load), and how many of
   * them schools have taken since. Not saved: after a load it starts from what's on board.
   */
  private readonly passes = new Map<number, { loaded: Int32Array; school: Int32Array }>();

  private passOf(train: Train, kind: CargoKind): { loaded: Int32Array; school: Int32Array } {
    let p = this.passes.get(train.id);
    if (!p) {
      p = { loaded: new Int32Array(CARGO_SLOTS).fill(-1), school: new Int32Array(CARGO_SLOTS) };
      this.passes.set(train.id, p);
    }
    const i = CARGO[kind].index;
    if (p.loaded[i] < 0) p.loaded[i] = this.onBoard(train, kind);
    return p;
  }

  /** What's left of a school's share (`SCHOOL_SHARE`) of this train's `kind` on this pass. */
  private schoolShareLeft(train: Train, kind: CargoKind): number {
    const p = this.passOf(train, kind);
    const i = CARGO[kind].index;
    return Math.max(0, Math.ceil(p.loaded[i] * SCHOOL_SHARE) - p.school[i]);
  }

  /**
   * Does a town this car's train goes on to want `kind`? A routed train: a later stop of its line is a town taking it;
   * an unrouted one: an automatic town on its track (joined to it) takes it. Asked at a school, while its research
   * lacks the good, and at a workshop whose yard holds what it keeps (`shopKeeps`). `schools`: a school left sharing
   * whose research lacks it counts as a town (the workshop shares with it too).
   */
  private townWantsAhead(carId: number, kind: CargoKind, route: Route | null, schools = false): boolean {
    const found = this.sim.findCar(carId);
    if (!found) return false;
    if (route) {
      const later = this.laterOf(route.stops, route.next % route.stops.length);
      return !!((schools ? later.sharers : later.towns) & (1 << CARGO[kind].index));
    }
    const net = this.networkOf(found.train.bogies[0].pieceId);
    return this.allDepots().some((d) => (d.role === "town" || (schools && d.role === "school" && !d.takesAll)) && d.auto && this.networkOf(d.pieceId) === net && (!this.accepts || this.accepts(d, kind)));
  }

  /**
   * Which track network (pieces joined to one another) a piece is on: a number shared by every piece of it. Worked out
   * again only when joints are made or parted, or pieces come or go.
   */
  private networkOf(pieceId: number): number {
    const l = this.layout;
    if (this.netJoints !== l.jointsVersion || this.netPieces !== l.piecesVersion) {
      this.netJoints = l.jointsVersion;
      this.netPieces = l.piecesVersion;
      const up = new Map<number, number>();
      const root = (id: number): number => {
        if (!up.has(id)) up.set(id, id);
        let r = id;
        while (up.get(r) !== r) r = up.get(r)!;
        // Point the way there straight at the root, so a long line stays quick.
        let c = id;
        while (c !== r) {
          const u = up.get(c)!;
          up.set(c, r);
          c = u;
        }
        return r;
      };
      for (const id of l.pieceIds()) up.set(id, id);
      for (const j of l.joints()) {
        const a = root(pieceOfRef(j.a));
        const b = root(pieceOfRef(j.b));
        if (a !== b) up.set(a, b);
      }
      this.nets.clear();
      for (const id of l.pieceIds()) this.nets.set(id, root(id));
    }
    return this.nets.get(pieceId) ?? -1;
  }
  private readonly nets = new Map<number, number>();
  private netJoints = -1;
  private netPieces = -1;

  /** Is this depot on the map (its piece on the layout), not one whose piece was taken up? */
  onMap(d: DepotState): boolean {
    return this.layout.getPiece(d.pieceId) !== undefined;
  }

  cargoOf(carId: number): Readonly<CarCargo> {
    return this.cargo.get(carId) ?? EMPTY;
  }

  /** Put cargo straight onto a car (saves, tests). */
  /** Bumped whenever a wagon's goods or a coach's riders change: what shows loads redraws only then. */
  loadsVersion = 0;

  setCargo(carId: number, kind: CargoKind | null, count: number): void {
    this.loadsVersion++;
    if (count <= 0 || kind === null) {
      this.cargo.delete(carId);
      this.landedFrom.delete(carId);
    } else this.cargo.set(carId, { kind, count: Math.min(count, this.wagonCapacity) });
  }

  /**
   * Why Empty (tip a wagon's goods out, thrown away) would be refused now: "moving" (its train isn't standing),
   * "empty" (no goods on it: a coach's riders aren't goods, and stay), "none" (no such car, or off the rails), or null.
   */
  dumpRefusal(carId: number): "moving" | "empty" | "none" | null {
    const found = this.sim.findCar(carId);
    if (!found || found.train.derailed) return "none";
    if (this.cargoOf(carId).count <= 0) return "empty";
    return this.sim.standing(found.train) ? null : "moving";
  }

  /**
   * Empty: tip a standing wagon's goods out, thrown away (onto no pile, so no town or school is credited). What it
   * held, or null (nothing done: see `dumpRefusal`). What's held for a school is worked out from what's on board
   * (`heldForSchool`), so nothing else is kept to clear but the pass's count of that good, which starts afresh at the
   * next load once none is left on board.
   */
  dump(carId: number): { kind: CargoKind; count: number } | null {
    if (this.dumpRefusal(carId) !== null) return null;
    const train = this.sim.findCar(carId)!.train;
    const c = this.cargoOf(carId);
    const out = { kind: c.kind!, count: c.count };
    this.setCargo(carId, null, 0);
    const p = this.passes.get(train.id);
    const i = CARGO[out.kind].index;
    if (p && p.loaded[i] >= 0) {
      if (this.onBoard(train, out.kind) === 0) {
        p.loaded[i] = -1;
        p.school[i] = 0;
      } else p.loaded[i] = Math.max(0, p.loaded[i] - out.count);
    }
    return out;
  }

  /** A depot on the map that takes `kind` from trains (for Empty's hint: "The Mill takes 🌾"), or null. */
  takerOf(kind: CargoKind): DepotState | null {
    for (const d of this.depots) {
      if (!d.auto || !this.onMap(d) || RECIPES[d.role].routedOnly) continue;
      if (this.takesNow(d, kind) && (!this.accepts || this.accepts(d, kind))) return d;
    }
    return null;
  }

  ridersOf(carId: number): Readonly<Riders> {
    return this.riders.get(carId) ?? NO_RIDERS;
  }

  /** Put people straight onto a coach (saves, tests): `count` who got on at depot `from`. */
  setRiders(carId: number, count: number, from: number): void {
    this.loadsVersion++;
    if (count <= 0) this.riders.delete(carId);
    else {
      // (Riders getting off or on keep the view the coach has had: not saved, a load starts the ride's view afresh.)
      const scenic = this.riders.get(carId)?.scenic;
      this.riders.set(carId, scenic ? { count, from, scenic } : { count, from });
    }
  }

  /** The people on this coach have had a view (over a bridge, along a hilltop): see `Riders.scenic`. */
  markScenic(carId: number): void {
    const r = this.riders.get(carId);
    if (r && !r.scenic) r.scenic = true;
  }

  /**
   * Seats in a car (Game mode sets it: coaches by their look). Null, or 0 seats: it carries no one, and trains don't
   * stop at stations for it (Sandbox).
   */
  seatsOf: ((carId: number) => number) | null = null;

  /** Someone got off a coach at station `to`, having got on at `from` (Game mode pays their fare). */
  onAlight: ((from: DepotState, to: DepotState, carId: number) => void) | null = null;

  /**
   * Would someone on this coach get off here: a town's station other than where they got on (a stop to drop at), or
   * an airport (where they wait for a plane) with room in its lounge?
   */
  private canAlight(d: DepotState, carId: number): boolean {
    const r = this.riders.get(carId);
    if (!r || !riderStop(d)) return false;
    if ((d.role === "airport" || d.role === "mast") && d.flyers >= loungeCap(d)) return false;
    // (A lookout takes riders from any town, its own too, for the view; none got on at a lookout. Else, a town's halts
    // are its stops too: no one gets off in the town they got on in. An airport is a "town" of its own: `stopTown`.)
    if (this.isLookout(d)) {
      if (this.isLookout(this.depots[r.from])) return false;
    } else if (this.quarterOf(r.from) === this.quarterOf(d.id)) return false;
    const route = this.routeOfCar(carId);
    return !route || this.dropsAt(route, d, null);
  }

  /** Would someone waiting here get on this coach: a free seat, and no one aboard bound from another town? */
  private canBoard(d: DepotState, carId: number): boolean {
    if (!riderStop(d) || d.waiting <= 0 || !this.seatsOf) return false;
    const r = this.riders.get(carId);
    if (r && (this.quarterOf(r.from) !== this.quarterOf(d.id) || r.count >= this.seatsOf(carId))) return false;
    if (!r && this.seatsOf(carId) <= 0) return false;
    const route = this.routeOfCar(carId);
    return !route || this.picksAt(route, d, null);
  }

  /**
   * Is this a lookout halt's stop (`LOOKOUT_KIT`), or an observatory's (`OBSERVATORY_KIT`): a destination for riders
   * from anywhere, where no one lives?
   */
  isLookout(d: DepotState | undefined): boolean {
    if (!d || d.role !== "town") return false;
    const type = this.layout.getPiece(d.pieceId)?.type;
    // (And a found secret's halt: the lookout's kind of stop, for tourists. src/game/secrets.ts.)
    return type === LOOKOUT_KIT || type === OBSERVATORY_KIT || (!!type && isSecretKit(type));
  }

  /** Is this a metro stop's depot (`METRO_KIT`): a quarter of its town of its own? */
  isMetro(d: DepotState | undefined): boolean {
    return !!d && d.role === "town" && this.layout.getPiece(d.pieceId)?.type === METRO_KIT;
  }

  /**
   * The part of a town a passenger stop serves, by its depot id: its town's id for its station and halts; a metro stop
   * its own quarter (−2 − its id). Riders get off only in another quarter: across a city by metro pays a fare.
   */
  private quarterOf(depotId: number): number {
    const d = this.depots[depotId];
    if (!d) return -1;
    // (An airport's riders are no town's: its own, as `stopTown`.)
    return this.isMetro(d) ? -2 - d.id : stopTown(d);
  }



  /**
   * Is this a halt: a town's passenger stop on a kit piece (Game mode's halts and small stations, `HALT_KITS`), not
   * its station? People get on and off there as at the station, but it takes no goods.
   */
  isHalt(d: DepotState): boolean {
    if (d.role !== "town" || this.stationPieces.has(d.pieceId)) return false;
    const p = this.layout.getPiece(d.pieceId);
    return !!p && isKit(p.type);
  }

  /**
   * The pieces that are towns' own stations (the map's: `World.stations`): never a halt, even upgraded to a big
   * station's kit (src/game/station-upgrade.ts). Filled as the stations' depots are added.
   */
  readonly stationPieces = new Set<number>();

  setAuto(depotId: number, on: boolean): void {
    const d = this.depots[depotId];
    if (d && d.auto !== on) {
      d.auto = on;
      this.stopsStamp++;
    }
  }

  /**
   * A warehouse's mode for one good (listing it on its card), or with `kind` null for any other good; or an industry's
   * Gives / Doesn't give for one of its goods (`givesChoice`). What routed lines plan there may change: `wantsStamp` (so `laterOf` and `plansVersion`).
   */
  setStoreMode(depotId: number, kind: CargoKind | null, mode: StoreMode): void {
    const d = this.depots[depotId];
    if (!d) return;
    // An industry giving several goods: only Gives / Doesn't give, of each good it gives (`givesChoice`).
    if (!isStore(d.role) && !(givesChoice(d.role) && kind !== null && RECIPES[d.role].gives.includes(kind) && (mode === "both" || mode === "off"))) return;
    if (kind === null) d.others = mode;
    else d.modes[CARGO[kind].index] = mode;
    this.wantsStamp++;
  }

  /** Take a good off a warehouse's list: it follows "Any other goods" again. */
  unlistStore(depotId: number, kind: CargoKind): void {
    const d = this.depots[depotId];
    if (!d || d.modes[CARGO[kind].index] === null) return;
    d.modes[CARGO[kind].index] = null;
    this.wantsStamp++;
  }

  setWaitFull(depotId: number, on: boolean): void {
    const d = this.depots[depotId];
    if (d) d.waitFull = on;
  }

  /**
   * A workshop takes all the planks trains bring, or a school is set to Research first (true), or it shares them with
   * towns further on (`takesAll`).
   */
  setTakesAll(depotId: number, on: boolean): void {
    const d = this.depots[depotId];
    if (!d || d.takesAll === on) return;
    d.takesAll = on;
    // (A school's Research first changes what routed lines keep for it: `Later.school`.)
    if (d.role === "school") this.stopsStamp++;
  }

  /** Set how many of `kind` a workshop's yard keeps while it shares (null: the game's own amount; see `DepotState.keeps`). */
  setKeep(depotId: number, kind: CargoKind, n: number | null): void {
    const d = this.depots[depotId];
    if (!d || d.role !== "workshop") return;
    d.keeps[CARGO[kind].index] = n === null ? null : Math.max(0, Math.min(capAt(d), Math.round(n)));
  }

  /** Can a pile hold this cargo (it is the depot's input or output) and is there room? */
  pileAccepts(d: DepotState, kind: CargoKind): boolean {
    const r = RECIPES[d.role];
    // A sink the mode has a say in (a school) takes by hand only what it would take from a train: nothing is lost in it.
    if (r.sink && this.intoSink && this.accepts && !this.accepts(d, kind)) return false;
    return (this.takesNow(d, kind) || r.gives.includes(kind)) && d.piles[CARGO[kind].index] < capAt(d);
  }

  /** Can this car take one more unit of `kind`? */
  carAccepts(carId: number, kind: CargoKind): boolean {
    const found = this.sim.findCar(carId);
    if (!found || !canCarry(found.train.cars[found.index].kind, kind) || !this.carTakes(carId, kind)) return false;
    const c = this.cargoOf(carId);
    return c.count < this.wagonCapacity && (c.kind === null || c.kind === kind);
  }

  /**
   * Where a unit tapped (not dragged) goes: from a depot's pile onto a wagon standing beside it (one already part
   * filled with it first, then the nearest the crane), or from a wagon onto the pile of a depot it stands at. Null
   * when there's nowhere it can go.
   */
  tapTarget(from: CargoSlot): CargoSlot | null {
    if (from.kind === "pile") {
      const d = this.depots[from.depotId];
      if (!d || d.piles[CARGO[from.cargo].index] <= 0) return null;
      const kind = from.cargo;
      let best: { carId: number; score: number } | null = null;
      for (const id of this.sim.trainIds()) {
        const train = this.sim.getTrain(id);
        if (!train || train.derailed) continue;
        for (let c = 0; c < train.cars.length; c++) {
          const car = train.cars[c];
          const front = train.bogies[2 * c];
          const rear = train.bogies[2 * c + 1];
          if (front.pieceId !== d.pieceId && rear.pieceId !== d.pieceId) continue;
          if (!this.carAccepts(car.id, kind)) continue;
          // Top up a part-filled wagon before starting another; then the one nearest the crane.
          const started = this.cargoOf(car.id).count > 0 ? 0 : 1000;
          const len = this.depotLength(d);
          const at = front.pieceId === d.pieceId && rear.pieceId === d.pieceId ? (along(front, len) + along(rear, len)) / 2 : front.pieceId === d.pieceId ? along(front, len) : along(rear, len);
          const score = started + Math.abs(at - d.craneAt);
          if (!best || score < best.score) best = { carId: car.id, score };
        }
      }
      return best ? { kind: "car", carId: best.carId } : null;
    }
    const c = this.cargoOf(from.carId);
    const found = this.sim.findCar(from.carId);
    if (c.kind === null || c.count <= 0 || !found) return null;
    const kind = c.kind;
    const train = found.train;
    // A depot under this wagon, else under the rest of its train.
    const under = [train.bogies[2 * found.index], train.bogies[2 * found.index + 1], ...train.bogies];
    for (const b of under) {
      const d = this.byPiece.get(b.pieceId);
      if (d && this.pileAccepts(d, kind)) return { kind: "pile", depotId: d.id, cargo: kind };
    }
    return null;
  }

  /** Move one unit by hand between a pile and a wagon (or two of either). False, changing nothing, if not allowed. */
  moveCargo(from: CargoSlot, to: CargoSlot): boolean {
    let kind: CargoKind;
    if (from.kind === "pile") {
      const d = this.depots[from.depotId];
      if (!d || d.piles[CARGO[from.cargo].index] <= 0) return false;
      kind = from.cargo;
    } else {
      const c = this.cargoOf(from.carId);
      if (c.kind === null || c.count <= 0) return false;
      kind = c.kind;
    }
    if (to.kind === "pile") {
      const d = this.depots[to.depotId];
      if (!d || to.cargo !== kind || !this.pileAccepts(d, kind)) return false;
    } else if (!this.carAccepts(to.carId, kind)) return false;
    if (from.kind === "car" && to.kind === "car" && from.carId === to.carId) return false;

    this.take(from, kind);
    this.put(to, kind);
    return true;
  }

  private take(slot: CargoSlot, kind: CargoKind): void {
    if (slot.kind === "pile") {
      const d = this.depots[slot.depotId];
      if (!RECIPES[d.role].endless) d.piles[CARGO[kind].index]--;
      // (A warehouse's last of a good gone: lines' plans change, `plansVersion`.)
      if (RECIPES[d.role].routedOnly && d.piles[CARGO[kind].index] === 0) this.storeStamp++;
    } else this.setCargo(slot.carId, kind, this.cargoOf(slot.carId).count - 1);
  }

  private put(slot: CargoSlot, kind: CargoKind): void {
    if (slot.kind === "pile") {
      const d = this.depots[slot.depotId];
      // Goods for the town's place under way (game/places.ts): into the place, not onto the pile or toward growth.
      if (d.role === "town" && this.placeWants && this.placeWants(d.townId, kind) > 0) {
        const plan = this.placePlans.get(d.townId);
        if (plan) {
          plan.got[kind] = (plan.got[kind] ?? 0) + 1;
          this.wantsStamp++;
          this.onPlaceGoods?.(d);
          return;
        }
      }
      // Goods for a station's delivery van (roads spec D5): onto its yard, for a town off the line (not this one).
      if (d.role === "town" && this.toVan?.(d, kind)) {
        const yard = this.vanYard.get(d.id) ?? {};
        yard[kind] = (yard[kind] ?? 0) + 1;
        this.vanYard.set(d.id, yard);
        this.wantsStamp++;
        this.onVanYard?.(d);
        return;
      }
      if (RECIPES[d.role].sink) {
        if (this.intoSink) {
          this.intoSink(d, kind);
          // What it takes next may have changed (a school's research needs one fewer).
          this.wantsStamp++;
        }
        return;
      }
      // (A warehouse's first of a good: lines' plans change, `plansVersion`.)
      if (RECIPES[d.role].routedOnly && d.piles[CARGO[kind].index] === 0) this.storeStamp++;
      d.piles[CARGO[kind].index] = Math.min(capAt(d), d.piles[CARGO[kind].index] + 1);
      // Less is owed now: what routed lines plan to bring here may have changed.
      if (RECIPES[d.role].owed?.includes(kind)) this.wantsStamp++;
      if (d.role === "town") this.receive(d.townId, kind);
    } else this.setCargo(slot.carId, kind, this.cargoOf(slot.carId).count + 1);
  }

  /**
   * A unit of `kind` reaches town `townId` (by train at its station, or by van): counted toward its growth, and (joined
   * by road to another town) toward its road's bonus.
   */
  receive(townId: number, kind: CargoKind): void {
    if (kind === "planks") this.delivered.set(townId, (this.delivered.get(townId) ?? 0) + 1);
    this.wantsStamp++;
    const got = this.deliveredGoods.get(townId) ?? {};
    got[kind] = (got[kind] ?? 0) + 1;
    this.deliveredGoods.set(townId, got);
    if (this.joinedByRoad?.(townId)) {
      const road = this.roadGot.get(townId) ?? {};
      road[kind] = (road[kind] ?? 0) + 1;
      this.roadGot.set(townId, road);
    }
  }

  /** How many of each good wait in station `depotId`'s van yard (or ride its van), as a bag (empty: none). */
  vanGoods(depotId: number): Bag {
    return this.vanYard.get(depotId) ?? {};
  }

  /** Unload one unit from a car onto a depot's input pile (crane work). */
  protected unloadOne(d: DepotState, carId: number): void {
    const kind = this.cargoOf(carId).kind!;
    if (d.role === "school") {
      const found = this.sim.findCar(carId);
      if (found) this.passOf(found.train, kind).school[CARGO[kind].index]++;
    }
    this.take({ kind: "car", carId }, kind);
    this.put({ kind: "pile", depotId: d.id, cargo: kind }, kind);
  }

  /** Load one unit from a depot's output pile onto a car (crane work). */
  protected loadOne(d: DepotState, carId: number): void {
    const kind = this.loadKind(d, carId)!;
    const landed = this.landed.get(d.id);
    if (landed && landed[CARGO[kind].index] > 0) {
      landed[CARGO[kind].index]--;
      // The car carries landed goods away: it doesn't hand them back here.
      this.landedFrom.set(carId, d.id);
    }
    this.take({ kind: "pile", depotId: d.id, cargo: kind }, kind);
    this.put({ kind: "car", carId }, kind);
    // A new pass for this good: its load is what's on board now, and no school has had any of it.
    const found = this.sim.findCar(carId);
    if (found) {
      const p = this.passOf(found.train, kind);
      p.loaded[CARGO[kind].index] = this.onBoard(found.train, kind);
      p.school[CARGO[kind].index] = 0;
    }
  }

  /**
   * Is this depot making (or using) something now: it has what its cycle uses and room for what it makes? (A
   * sawmill's saw spins while true.)
   */
  working(d: DepotState): boolean {
    const cycle = RECIPES[d.role].cycle;
    if (!cycle || d.rate <= 0) return false;
    if (cycle.eats) return RECIPES[d.role].takes.some((k) => d.piles[CARGO[k].index] > 0);
    for (const k in cycle.uses) if (d.piles[CARGO[k as CargoKind].index] < cycle.uses[k as CargoKind]!) return false;
    for (const k in cycle.makes) if (d.piles[CARGO[k as CargoKind].index] + cycle.makes[k as CargoKind]! > capAt(d)) return false;
    return true;
  }

  /** Would the crane do anything for this car at this depot? */
  needsService(d: DepotState, carId: number): boolean {
    const found = this.sim.findCar(carId);
    if (!found) return false;
    if (found.train.cars[found.index].kind === "passenger") return this.canAlight(d, carId) || this.canBoard(d, carId);
    if (!canCarry(found.train.cars[found.index].kind)) return false;
    return this.canUnload(d, carId) || this.loadKind(d, carId) !== null || this.waitsForLoad(d, carId);
  }

  /** Does this depot take `kind` now: its recipe's goods, or one it takes only while some is owed (`owes`)? */
  private takesNow(d: DepotState, kind: CargoKind): boolean {
    const r = RECIPES[d.role];
    return (r.takes.includes(kind) || (!!r.owed?.includes(kind) && !!this.owes && this.owes(kind) > 0)) && storeLetsIn(d, kind);
  }

  private canUnload(d: DepotState, carId: number): boolean {
    return this.keepWhy(d, carId) === null;
  }

  /**
   * Why this car keeps its goods at this depot (null: it drops them here). Each stop takes goods in the order the train
   * comes to it, by its own setting: a town what it wants, a workshop what it keeps or (Takes all) up to its cap, a
   * school what its research lacks (Shares with towns: its share of the load while a town ahead wants it). Nothing is
   * held back for a stop further on but by a setting the player can see: a school set to Research first
   * (`keptForSchool`), and a workshop's waiting tray order (`reserved`). A constant per reason, so
   * asking every tick costs nothing more than the answer did.
   */
  private keepWhy(d: DepotState, carId: number): KeepWhy | null {
    const c = this.cargoOf(carId);
    if (c.kind === null || c.count <= 0 || !this.takesNow(d, c.kind)) return "nothing";
    // A halt is for people only: goods trains run through.
    if (this.isHalt(d)) return "nothing";
    // Goods landed here for trains to take away aren't taken back (from any car, nor a car that took them here).
    if ((this.landed.get(d.id)?.[CARGO[c.kind].index] ?? 0) > 0 || this.landedFrom.get(carId) === d.id) return "nothing";
    // A routed train drops goods only at the stop it's heading for, as it says (or as its line calls for).
    const route = this.routeOfCar(carId);
    if (route && !route.stops.some((s) => s.depotId === d.id)) return "not-stop";
    if (this.accepts) {
      if (!this.accepts(d, c.kind)) return "unwanted";
      // What a town still wants it takes in even with its platform's pile full (it's counted, not stacked).
      if (d.role !== "town" && d.piles[CARGO[c.kind].index] >= capAt(d)) return "full";
    } else if (d.piles[CARGO[c.kind].index] >= capAt(d)) return "full";
    // What a school set to Research first lacks rides on past a town or a workshop for it (a workshop's tray order first).
    if ((d.role === "town" || (d.role === "workshop" && !this.reserved?.(c.kind))) && this.keptForSchool(carId, c.kind, route)) return "school";
    // A workshop's yard takes no more than it keeps (its tray order's, or a few) while a town the train goes on to wants
    // them too, or a school left sharing whose research lacks them (Dustin's playthrough, 2026-11-04: a sharing school
    // after the workshop got none) (QA P5: with research idle, the yard filled 1 → 16 with no order and the next town starved). Not one set
    // to take all (`takesAll`), nor at a stop set to Only drop (QA N3: it still shared): it fills its yard.
    if (d.role === "workshop" && !d.takesAll && this.shopKeeps && d.piles[CARGO[c.kind].index] >= (this.shopKeeps(c.kind, d) ?? Infinity) && !(route && this.onlyDropsAt(route, d.id)) && this.townWantsAhead(carId, c.kind, route, true)) return "shares";
    // A school set to share (its default) takes only its share of a pass's load while a town the train goes on to wants
    // the good too; set to take all (`takesAll`), or at an Only drop stop, all its research lacks.
    if (d.role === "school" && !d.takesAll && !(route && this.onlyDropsAt(route, d.id)) && this.townWantsAhead(carId, c.kind, route)) {
      const found = this.sim.findCar(carId);
      if (found && this.schoolShareLeft(found.train, c.kind) <= 0) return "shares";
    }
    if (route) {
      if (this.dropsAt(route, d, c.kind)) return null;
      return d.role === "town" && this.reserved?.(c.kind) ? "order" : "route";
    }
    // Goods kept for a workshop: an unrouted train carries them on past the towns.
    if (d.role === "town" && this.reserved?.(c.kind)) return "order";
    return RECIPES[d.role].routedOnly ? "nothing" : null;
  }

  /**
   * Why a train beside a depot (its crane on) passes it keeping goods the depot takes, and which good: for its engine
   * card (src/game/kept-text.ts). Null: it drops something there, or it carries nothing the depot takes, or its route
   * drops them there on a later visit. A warehouse has its own words (`storeItSkips`). Cheap: a lookup per bogie and
   * the train's cars, asked while its card is open and once a second for the workshop's toast.
   */
  keptAt(trainId: number): { depot: DepotState; kind: CargoKind; why: Exclude<KeepWhy, "nothing" | "route"> } | null {
    const train = this.sim.getTrain(trainId);
    if (!train) return null;
    let asked: DepotState | undefined;
    for (const b of train.bogies) {
      const d = this.byPiece.get(b.pieceId);
      if (!d || d === asked || !d.auto || RECIPES[d.role].routedOnly) continue;
      asked = d;
      let kept: { kind: CargoKind; why: Exclude<KeepWhy, "nothing" | "route"> } | null = null;
      for (const car of train.cars) {
        if (!canCarry(car.kind)) continue;
        const why = this.keepWhy(d, car.id);
        if (why === null) return null;
        if (why !== "nothing" && why !== "route" && !kept) kept = { kind: this.cargoOf(car.id).kind!, why };
      }
      if (kept) return { depot: d, ...kept };
    }
    return null;
  }

  /** Give this engine's train a route (null or no stops: none; it's served wherever it goes). */
  setRoute(engineCarId: number, route: Route | null): void {
    this.stopsStamp++;
    if (!route || route.stops.length === 0) this.routes.delete(engineCarId);
    else this.routes.set(engineCarId, route);
  }

  /**
   * The line the train with this car runs, as the intent rules read it: its stops, what to do at each, and whether to
   * wait there to fill. Null if it runs none (or its route has no stops left on the map).
   */
  lineOfCar(carId: number): LineView | null {
    const route = this.routeOfCar(carId);
    if (!route) return null;
    return { stops: route.stops.map((s) => ({ depot: s.depotId, intent: s.action === "both" ? "auto" : s.action, waitFill: !!s.waitFill })) };
  }

  /**
   * The stops on this engine's line whose depot isn't on the map now (its piece taken up: undo brings it back). They
   * stay on the line, and the train runs on past them (`advanceRoutes`); the card says which (never a silent "?").
   */
  lostStops(engineCarId: number): RouteStopDef[] {
    const r = this.routes.get(engineCarId);
    if (!r) return [];
    return r.stops.filter((s) => {
      const d = this.depots[s.depotId];
      return !d || !this.layout.getPiece(d.pieceId);
    });
  }

  /**
   * The piece this routed engine is heading for: its next stop (standing at it, the stop after, a different depot), or a
   * via point on the way there. −1: none, or not on the map. What sections and the router both steer for.
   */
  private headingFor(engine: number): number {
    return this.goalOf(engine, 0);
  }

  /** This engine's route, if it has one. */
  routeOf(engineCarId: number): Route | undefined {
    return this.routes.get(engineCarId);
  }

  /** The route of the train this car is in: its first engine's (with stops still on the map), or null. */
  routeOfCar(carId: number): Route | null {
    if (this.routes.size === 0) return null;
    const found = this.sim.findCar(carId);
    return found ? this.routeOfTrain(found.train) : null;
  }

  routeOfTrain(train: Train): Route | null {
    if (this.routes.size === 0) return null;
    for (const car of train.cars) {
      const r = this.routes.get(car.id);
      if (r && r.stops.some((s) => this.depots[s.depotId] && this.layout.getPiece(this.depots[s.depotId].pieceId))) return r;
    }
    return null;
  }

  /**
   * May a train (with this route, or none) pick up `kind` at this depot? A routed train only at the stop it's heading
   * for, as it says (`picksAt`); an unrouted one anywhere but a warehouse.
   */
  private picksUpAt(d: DepotState, route: Route | null, kind: CargoKind, train: Train | null = null): boolean {
    return route ? this.picksAt(route, d, kind, train) : !RECIPES[d.role].routedOnly;
  }

  /**
   * The intent rules: does a routed train drop `kind` (null: riders getting off) at depot `d` now? Only at the stop
   * it's heading for, with any stops right after it at the same depot (one visit), so goods for a later stop aren't
   * dropped at another on the way. "drop" drops everything; "pick" nothing. "auto" (and "both", which the engine card
   * shows as Automatic; see `Later`):
   * - at a warehouse (`routedOnly`) or a harbour (they take everything), only goods no later stop other than a
   *   warehouse uses (the rest ride on to where they're wanted: planks for a later town aren't sold at the quay);
   * - elsewhere, whatever the depot takes (`canUnload` has checked), but not, at a town, goods a later workshop takes
   *   while they're `reserved` (the workshop's first claim);
   * - riders get off at any town's station.
   */
  private dropsAt(route: Route, d: DepotState, kind: CargoKind | null): boolean {
    const n = route.stops.length;
    for (let k = 0; k < n; k++) {
      const i = (route.next + k) % n;
      const s = route.stops[i];
      if (s.depotId !== d.id) return false;
      if (s.action === "drop") return true;
      if (s.action === "pick") continue;
      if (kind === null) return true;
      const bit = 1 << CARGO[kind].index;
      const later = this.laterOf(route.stops, i);
      if (RECIPES[d.role].routedOnly || d.role === "harbour") {
        if (!(later.uses & bit)) return true;
      } else if (!(d.role === "town" && later.shop & bit && this.reserved?.(kind))) return true;
    }
    return false;
  }

  /**
   * The intent rules: does a routed train pick up `kind` (null: riders getting on) at depot `d` now? As `dropsAt`,
   * only on its visit to the stop it's heading for. "pick" picks up everything (but at a warehouse, not where it
   * drops too: it would take back what it left); "drop" nothing. "auto" (and "both"): only what a later stop takes (at
   * a warehouse, what a later stop other than a warehouse uses, so two warehouses don't hand goods back and forth; a
   * harbour's landed goods by the normal rule); riders only with a town's station later on. Given the train, an "auto"
   * stop picks up a good only while those later stops have room for more of it than the train has on board
   * (`roomAhead`): grain isn't carried round for a mill that's full (it waits at the farm for the next lap).
   */
  private picksAt(route: Route, d: DepotState, kind: CargoKind | null, train: Train | null = null, sorts = !!train && sortsMail(train)): boolean {
    const routedOnly = RECIPES[d.role].routedOnly;
    // (A train with a sorting van takes mail where a later stop takes post: it's post by the time it gets there.)
    if (kind === "mail" && sorts) kind = "post";
    const n = route.stops.length;
    let pick = false;
    let drop = false;
    for (let k = 0; k < n; k++) {
      const i = (route.next + k) % n;
      const s = route.stops[i];
      if (s.depotId !== d.id) break;
      if (s.action === "pick") pick = true;
      if (s.action === "drop") drop = true;
      if (s.action === "pick" || s.action === "drop") continue;
      const later = this.laterOf(route.stops, i);
      if (kind === null ? later.town : (routedOnly ? later.uses : later.takes) & (1 << CARGO[kind].index) && (!train || this.roomAhead(route.stops, i, kind, train))) return true;
    }
    return pick && !(routedOnly && drop);
  }

  /**
   * Have the stops after stop `i` of a line (round it, as `laterOf` counts them) room now for more of `kind` than this
   * train has on board? Each depot that would take it from the train there is counted once, at the moment of loading:
   * a town (or a school) the mode says still wants it counts as room (it takes what it wants even with its platform's
   * pile full); any other depot its pile's room (`capAt` less the pile), and for a good it takes only while owed, no
   * more than is owed (`owes`). A halt, or a depot with that good landed on it, counts none; from a warehouse, only
   * depots that use it count (as `picksAt` has it). A warehouse or a harbour counts only where the train would drop it
   * there (`dropsAt`: no stop after it uses it but this one, which gave it): grain isn't loaded for a harbour's quay
   * while the mill on the way back is full (QA, the goals play-through: the hoppers rode round with it).
   * Other trains on the line aren't counted. Cheap: one pass over the stops, run only as a crane would load (at a
   * stop, a unit at a time), with `laterOf` cached (a second pass only past a warehouse or a harbour).
   */
  private roomAhead(stops: readonly RouteStopDef[], i: number, kind: CargoKind, train: Train): boolean {
    const n = stops.length;
    const index = CARGO[kind].index;
    const fromStore = RECIPES[this.depots[stops[i].depotId]?.role ?? "town"].routedOnly;
    if (this.roomMark.length < this.depots.length) this.roomMark = new Int32Array(this.depots.length + 8);
    const mark = ++this.roomStamp;
    const need = this.onBoard(train, kind);
    let room = 0;
    for (let k = 1; k < n; k++) {
      const j = (i + k) % n;
      const s = stops[j];
      if (s.depotId === stops[i].depotId || s.action === "pick") continue;
      const d = this.depots[s.depotId];
      if (!d || !d.auto || this.roomMark[d.id] === mark || !this.takesNow(d, kind) || !this.layout.getPiece(d.pieceId)) continue;
      if (fromStore && RECIPES[d.role].routedOnly) continue;
      if (this.isHalt(d) || (this.landed.get(d.id)?.[index] ?? 0) > 0) continue;
      if (this.accepts && !this.accepts(d, kind)) continue;
      if ((RECIPES[d.role].routedOnly || d.role === "harbour") && s.action !== "drop" && this.laterOf(stops, j).uses & (1 << index) && this.usedAfter(stops, j, kind, stops[i].depotId)) continue;
      this.roomMark[d.id] = mark;
      if (this.accepts && (d.role === "town" || d.role === "school")) return true;
      let here = capAt(d) - d.piles[index];
      if (!RECIPES[d.role].takes.includes(kind) && this.owes) here = Math.min(here, this.owes(kind));
      if (here > 0) room += here;
      if (room > need) return true;
    }
    return false;
  }

  /**
   * Does a stop after stop `j` (round the line, as `Later.uses` counts them) use `kind`, other than at `j`'s depot, at
   * warehouses, and at depot `but` (where the train got it: it isn't taken back there)?
   */
  private usedAfter(stops: readonly RouteStopDef[], j: number, kind: CargoKind, but: number): boolean {
    const n = stops.length;
    for (let k = 1; k < n; k++) {
      const s = stops[(j + k) % n];
      if (s.depotId === stops[j].depotId || s.depotId === but || s.action === "pick") continue;
      const d = this.depots[s.depotId];
      if (!d || !d.auto || RECIPES[d.role].routedOnly || !this.layout.getPiece(d.pieceId)) continue;
      if (this.takesNow(d, kind) && (!this.accepts || this.accepts(d, kind))) return true;
    }
    return false;
  }
  /**
   * A line's plan, stop by stop: the goods a train on it picks up and drops there, as the intent rules have it
   * (`picksAt`, `dropsAt`; what each depot takes and gives, the stop's Only drop or Only pick up, what later stops take
   * or use, warehouses keeping what no later stop uses). Drops list only goods picked up somewhere on the line. Not
   * counted: room (`roomAhead`: an Automatic stop picks up only while a later stop has room) and the workshop's claim
   * on planks at a town; nor riders. For the route card (built when `plansVersion` changes, never per frame).
   * `notDrops` / `notPicks`: goods the stop would drop or pick up but for a warehouse's own setting (`StoreMode`: the
   * stricter rule wins), for the card to say so: drops of goods picked up on the line; picks of goods it holds or lists.
   */
  routePlan(stops: readonly RouteStopDef[]): { picks: CargoKind[]; drops: CargoKind[]; notPicks: CargoKind[]; notDrops: CargoKind[] }[] {
    const n = stops.length;
    const picks: number[] = [];
    const drops: number[] = [];
    const notPicks: number[] = [];
    const notDrops: number[] = [];
    const mask = (ks: readonly CargoKind[]) => ks.reduce((m, k) => m | (1 << CARGO[k].index), 0);
    for (let i = 0; i < n; i++) {
      const s = stops[i];
      const d = this.depots[s.depotId];
      if (!d || !d.auto || !this.layout.getPiece(d.pieceId)) {
        picks.push(0);
        drops.push(0);
        notPicks.push(0);
        notDrops.push(0);
        continue;
      }
      const r = RECIPES[d.role];
      // What it takes and gives by its recipe and the mode (`raw`), and what its own store setting lets in and out.
      let rawTakes = 0;
      for (const k of r.takes) if (!this.accepts || this.accepts(d, k)) rawTakes |= 1 << CARGO[k].index;
      for (const k of r.owed ?? []) if (this.owes && this.owes(k) > 0) rawTakes |= 1 << CARGO[k].index;
      let rawGives = mask(this.givesAt(d));
      let lets = 0;
      let letsOut = 0;
      for (const k of CARGO_KINDS) {
        if (storeLetsIn(d, k)) lets |= 1 << CARGO[k].index;
        if (storeLetsOut(d, k)) letsOut |= 1 << CARGO[k].index;
      }
      // (A warehouse gives every good: only what it holds now; and, to say it's held back, what it lists.)
      let listed = 0;
      if (r.routedOnly) {
        rawGives &= mask(CARGO_KINDS.filter((k) => d.piles[CARGO[k].index] > 0));
        listed = mask(CARGO_KINDS.filter((k) => storeListed(d, k)));
      }
      const later = this.laterOf(stops, i);
      const keeps = r.routedOnly || d.role === "harbour";
      let pick: number;
      let drop: number;
      if (s.action === "drop") {
        pick = 0;
        drop = rawTakes;
      } else if (s.action === "pick") {
        // (Only pick up takes everything there.)
        pick = rawGives | listed;
        drop = 0;
      } else {
        pick = (rawGives | listed) & (r.routedOnly ? later.uses : later.takes);
        drop = keeps ? rawTakes & ~later.uses : rawTakes;
      }
      picks.push(pick & rawGives & letsOut);
      drops.push(drop & lets);
      notPicks.push(pick & ~letsOut);
      notDrops.push(drop & ~lets);
    }
    const carried = picks.reduce((m, p) => m | p, 0);
    const kinds = (m: number) => CARGO_KINDS.filter((k) => m & (1 << CARGO[k].index));
    return stops.map((_, i) => ({ picks: kinds(picks[i]), drops: kinds(drops[i] & carried), notPicks: kinds(notPicks[i]), notDrops: kinds(notDrops[i] & carried) }));
  }

  /**
   * Changes whenever a line's plan (`routePlan`) may: a route set, a depot's Automatic, what's wanted, pieces, a
   * warehouse's first or last of a good.
   */
  get plansVersion(): string {
    return `${this.stopsStamp}.${this.wantsStamp}.${this.storeStamp}.${this.layout.pieceCount}`;
  }
  /** Bumped when a warehouse gets its first of a good, or its last goes (see `plansVersion`). */
  private storeStamp = 0;

  /** Which depots `roomAhead` has counted this call (by depot id: its stamp), so one twice on a line counts once. */
  private roomMark = new Int32Array(0);
  private roomStamp = 0;

  /** Is the stop a routed train is heading for (this visit) at this depot set to Only drop? */
  private onlyDropsAt(route: Route, depotId: number): boolean {
    const n = route.stops.length;
    for (let k = 0; k < n; k++) {
      const s = route.stops[(route.next + k) % n];
      if (s.depotId !== depotId) return false;
      if (s.action === "drop") return true;
    }
    return false;
  }

  /** Does a routed train wait to fill at this depot: is the stop it's heading for (this visit) "Wait here till full"? */
  private waitFillAt(route: Route, depotId: number): boolean {
    const n = route.stops.length;
    for (let k = 0; k < n; k++) {
      const s = route.stops[(route.next + k) % n];
      if (s.depotId !== depotId) return false;
      if (s.waitFill) return true;
    }
    return false;
  }

  /**
   * What a stop list's later stops take, from stop `i` (see `Later`). Worked out for the whole list at once and kept
   * until a route is set (a line edited), a depot's Automatic changes, a town is given goods (what it wants may
   * change), the mode's `accepts` changes, or pieces are added or taken up: otherwise a lookup.
   */
  private laterOf(stops: readonly RouteStopDef[], i: number): Later {
    let c = this.laterCache.get(stops);
    if (!c || c.stamp !== this.stopsStamp || c.wants !== this.wantsStamp || c.accepts !== this.accepts || c.pieces !== this.layout.pieceCount || c.at.length !== stops.length) {
      c = { stamp: this.stopsStamp, wants: this.wantsStamp, accepts: this.accepts, pieces: this.layout.pieceCount, at: this.laterStops(stops) };
      this.laterCache.set(stops, c);
    }
    return c.at[i];
  }

  /** `Later` for every stop of a list: what each stop takes (stops × goods), then each stop's others (stops²). */
  private laterStops(stops: readonly RouteStopDef[]): Later[] {
    const n = stops.length;
    const takes: number[] = [];
    const town: boolean[] = [];
    for (const s of stops) {
      const d = this.depots[s.depotId];
      let mask = 0;
      const on = !!d && d.auto && s.action !== "pick" && !!this.layout.getPiece(d.pieceId);
      if (on) for (const k of RECIPES[d.role].takes) if ((!this.accepts || this.accepts(d, k)) && storeLetsIn(d, k)) mask |= 1 << CARGO[k].index;
      if (on && RECIPES[d.role].owed) for (const k of RECIPES[d.role].owed!) if (this.takesNow(d, k)) mask |= 1 << CARGO[k].index;
      takes.push(mask);
      town.push(on && riderStop(d));
    }
    const at: Later[] = [];
    for (let i = 0; i < n; i++) {
      const later: Later = { takes: 0, uses: 0, shop: 0, school: 0, town: false, towns: 0, sharers: 0 };
      /** Goods some later stop other than a town's or a workshop's takes, so far round the line. */
      let taken = 0;
      for (let k = 1; k < n; k++) {
        const j = (i + k) % n;
        if (stops[j].depotId === stops[i].depotId) continue;
        const role = this.depots[stops[j].depotId]?.role;
        later.takes |= takes[j];
        if (role && !RECIPES[role].routedOnly) later.uses |= takes[j];
        if (role === "workshop") later.shop |= takes[j];
        if (role === "school" && this.depots[stops[j].depotId].takesAll) later.school |= takes[j] & ~taken;
        if (role && role !== "town" && role !== "workshop") taken |= takes[j];
        later.town ||= town[j];
        if (role === "town") later.towns |= takes[j];
        if (role === "town" || (role === "school" && !this.depots[stops[j].depotId].takesAll)) later.sharers |= takes[j];
      }
      at.push(later);
    }
    return at;
  }

  /** What the crane would load onto this car here: goods the depot gives, the car carries and has room for, or null. */
  private loadKind(d: DepotState, carId: number): CargoKind | null {
    const c = this.cargoOf(carId);
    if (c.count >= this.wagonCapacity) return null;
    const found = this.sim.findCar(carId);
    if (!found) return null;
    const route = this.routeOfTrain(found.train);
    if (!route && RECIPES[d.role].routedOnly) return null;
    const car = found.train.cars[found.index].kind;
    let best: CargoKind | null = null;
    let fewest = Infinity;
    for (const k of this.givesAt(d)) {
      if ((c.kind !== null && c.kind !== k) || !canCarry(car, k) || d.piles[CARGO[k].index] <= 0 || !storeLetsOut(d, k) || !this.carTakes(carId, k) || !this.picksUpAt(d, route, k, found.train)) continue;
      if (c.kind !== null) return k;
      // An empty wagon takes the good its train carries least of (of those it is switched on for): a train of hoppers at a mine takes coal and ore both.
      let n = 0;
      for (const other of found.train.cars) if (this.cargo.get(other.id)?.kind === k) n++;
      if (n < fewest) {
        best = k;
        fewest = n;
      }
    }
    return best;
  }

  /**
   * With "wait for a full load", a wagon that could take more of the depot's goods waits for them, but only while
   * more are coming: goods on the pile, or the depot making them. (A sawmill out of logs isn't, so a train never waits
   * there for planks that would need the logs on its own later wagons.) Not while another wagon still has goods to
   * unload here: that goes first (the wagon waits its turn again once the crane is done with the others). Nor where
   * its train may not pick up those goods (a routed train's Drop stop, a depot that isn't the stop it's heading for,
   * or goods no later stop on its line takes).
   *
   * Which wait: a routed train's is its stop's ("Wait here till full", `waitFill`); an unrouted train's the depot's
   * (`waitFull`).
   */
  private waitsForLoad(d: DepotState, carId: number): boolean {
    const c = this.cargoOf(carId);
    if (c.count >= this.wagonCapacity) return false;
    const found = this.sim.findCar(carId);
    if (!found) return false;
    const route = this.routeOfTrain(found.train);
    if (!(route ? this.waitFillAt(route, d.id) : d.waitFull) || this.canUnload(d, carId)) return false;
    const done = this.services.get(found.train.id)?.done;
    if (found.train.cars.some((o) => o.id !== carId && !done?.has(o.id) && this.canUnload(d, o.id))) return false;
    const car = found.train.cars[found.index].kind;
    const kind = RECIPES[d.role].gives.find((k) => (c.kind === null || c.kind === k) && canCarry(car, k) && storeLetsOut(d, k) && this.carTakes(carId, k) && this.picksUpAt(d, route, k, found.train));
    if (kind === undefined) return false;
    return d.piles[CARGO[kind].index] > 0 || this.working(d);
  }

  /** The car under the crane at a depot right now, or −1. */
  servicedCar(depotId: number, pieceId = -1): number {
    for (const s of this.services.values()) if (s.phase === HALTED && s.depotId === depotId && (pieceId === -1 || s.depot?.pieceId === pieceId)) return s.carId;
    return -1;
  }

  /** Progress (0–1) of the crane's current move at a depot, or −1 when idle. */
  cranePhase(depotId: number, pieceId = -1): number {
    for (const s of this.services.values()) if (s.phase === HALTED && s.depotId === depotId && (pieceId === -1 || s.depot?.pieceId === pieceId)) return s.ticks / this.craneTicks;
    return -1;
  }

  /**
   * What the crane at a depot is carrying right now: the cargo, which way (from the wagon to a pile, or the other
   * way), the car, and progress 0–1, written into `out`. False when the crane is idle or waiting.
   */
  craneMove(depotId: number, out: CraneMove, pieceId?: number): boolean {
    // (A depot of several tracks: its one crane, at whichever track it's working; `pieceId`: only at that track.)
    for (const s of this.services.values()) {
      if (s.phase !== HALTED || s.depotId !== depotId || s.ticks === 0 || (pieceId !== undefined && s.depot?.pieceId !== pieceId)) continue;
      const d = s.depot;
      if (!d) continue;
      out.carId = s.carId;
      out.phase = s.ticks / this.craneTicks;
      if (this.canUnload(d, s.carId)) {
        out.kind = this.cargoOf(s.carId).kind!;
        out.toPile = true;
        return true;
      }
      const load = this.loadKind(d, s.carId);
      if (load !== null) {
        out.kind = load;
        out.toPile = false;
        return true;
      }
    }
    return false;
  }

  /**
   * Counts trains halting, at a depot's crane or a kit's stop: it changes when one halts (a train standing still
   * changes nothing the frame loop sees otherwise; a kit's moving parts start then).
   */
  get halts(): number {
    return this.depotHalts + this.kitStops.halts;
  }
  private depotHalts = 0;

  /** Is a train standing at this piece now: at its depot's crane (working on it), or at its kit's stop? */
  standingAt(pieceId: number): boolean {
    if (this.kitStops.haltedAt(pieceId)) return true;
    const d = this.byPiece.get(pieceId);
    return !!d && this.cranePhase(d.id, pieceId) >= 0;
  }

  /** The depot whose crane is working this train now (it's crawling to, or halted at, the crane), if any. */
  servingDepot(trainId: number): DepotState | undefined {
    const s = this.services.get(trainId);
    return s && s.phase !== NONE && s.depotId !== -1 ? (this.depots[s.depotId] ?? undefined) : undefined;
  }

  /**
   * A warehouse (a `routedOnly` depot, its crane on) this train is beside but can't trade with, or null: a train with
   * wagons and no route, or one whose route has no stop there. The engine card and a once-per-warehouse toast say why
   * (warehouse-text.ts). Cheap: a lookup per bogie, asked once a second and while the card is open.
   */
  storeItSkips(trainId: number): DepotState | null {
    const train = this.sim.getTrain(trainId);
    if (!train || !train.cars.some((c) => canCarry(c.kind))) return null;
    for (const b of train.bogies) {
      const d = this.byPiece.get(b.pieceId);
      if (!d || !d.auto || !RECIPES[d.role].routedOnly) continue;
      const route = this.routeOfTrain(train);
      return route && route.stops.some((s) => s.depotId === d.id) ? null : d;
    }
    return null;
  }

  /**
   * The depot where this train stands waiting for a full load (its stop's "Wait here till full", `waitFill`, or, hand
   * run, the depot's `waitFull`): a wagon not yet done this visit waits for goods there (`waitsForLoad`). Null if it
   * isn't. For its engine card's Leave now. Cheap: its service and its cars, asked while the card is open.
   */
  waitingToFill(trainId: number): DepotState | null {
    const s = this.services.get(trainId);
    if (!s || s.phase !== HALTED) return null;
    const d = this.depots[s.depotId];
    const train = this.sim.getTrain(trainId);
    if (!d || !train || !d.auto) return null;
    const route = this.routeOfTrain(train);
    if (!(route ? this.waitFillAt(route, d.id) : d.waitFull)) return null;
    for (const car of train.cars) if (!s.done.has(car.id) && canCarry(car.kind) && this.waitsForLoad(d, car.id)) return d;
    return null;
  }

  /**
   * Leave now (its engine's card): a train waiting for a full load (`waitingToFill`) goes with what it has. Only this
   * visit is let off (`skipVisit`): at its next stop that stop's own settings apply again, waiting to fill included.
   * Nothing is saved or undone: a train reloaded mid-wait waits again, as it would have. False if it wasn't waiting.
   */
  leaveNow(trainId: number): boolean {
    const train = this.sim.getTrain(trainId);
    if (!train || !this.waitingToFill(trainId)) return false;
    // (As `skipVisit`, at the depot it's waiting at: every car done there, the crane lets it go.)
    const s = this.service(trainId);
    s.phase = NONE;
    for (const car of train.cars) s.done.add(car.id);
    return true;
  }

  /**
   * Nothing more for this train at the depot it's beside, this visit (Continue, on its engine's card): the crane lets
   * it go, and it runs on. False if it's beside none.
   */
  skipVisit(trainId: number): boolean {
    const train = this.sim.getTrain(trainId);
    const d = train && this.depotUnder(train);
    if (!train || !d) return false;
    const s = this.service(trainId);
    if (s.depot !== d) this.endVisit(s);
    s.depotId = d.id;
    s.depot = d;
    s.phase = NONE;
    for (const car of train.cars) s.done.add(car.id);
    return true;
  }

  /**
   * What the crane is doing for this train at this depot, as far as its cars still need: unloading (goods it takes,
   * riders getting off) and/or loading (goods it may pick up, riders getting on). With nothing left to do (a moment
   * as it finishes), what the depot does that this train may have done: a Drop stop only unloads.
   */
  workFor(trainId: number, d: DepotState): { load: boolean; unload: boolean } | null {
    const train = this.sim.getTrain(trainId);
    if (!train) return null;
    const left = this.workLeft(train, d);
    if (left.load || left.unload) return left;
    // A routed train: what its stop's intent lets it do here (an "auto" stop: goods the depot gives that a later stop
    // takes, goods it takes that the train would drop here).
    const route = this.routeOfTrain(train);
    const r = RECIPES[d.role];
    return {
      // (A town gives only mail: loading there only for a train with a mail van.)
      load: route ? r.gives.some((k) => storeLetsOut(d, k) && this.picksAt(route, d, k, null, sortsMail(train))) : r.gives.length > 0 && !r.routedOnly && (d.role !== "town" || train.cars.some((c) => canCarry(c.kind, "mail"))),
      unload: route ? r.takes.some((k) => storeLetsIn(d, k) && this.dropsAt(route, d, k)) || !!r.owed?.some((k) => this.takesNow(d, k) && this.dropsAt(route, d, k)) : r.takes.length > 0,
    };
  }

  /** Has the crane anything left to do for this train at this depot (this visit)? */
  hasWorkAt(trainId: number, d: DepotState): boolean {
    const train = this.sim.getTrain(trainId);
    if (!train) return false;
    const left = this.workLeft(train, d);
    return left.load || left.unload;
  }

  /** What the crane has left to do for this train's cars at this depot (this visit). */
  private workLeft(train: Train, d: DepotState): { load: boolean; unload: boolean } {
    const done = this.services.get(train.id)?.done;
    let load = false;
    let unload = false;
    for (const car of train.cars) {
      if (done?.has(car.id)) continue;
      if (car.kind === "passenger") {
        unload ||= this.canAlight(d, car.id);
        load ||= this.canBoard(d, car.id);
      } else if (canCarry(car.kind)) {
        unload ||= this.canUnload(d, car.id);
        load ||= this.loadKind(d, car.id) !== null || this.waitsForLoad(d, car.id);
      }
    }
    return { load, unload };
  }

  private service(trainId: number): Service {
    let s = this.services.get(trainId);
    if (!s) this.services.set(trainId, (s = { trainId, phase: NONE, depotId: -1, depot: null, carId: -1, ticks: 0, still: 0, done: new Set() }));
    return s;
  }

  /**
   * The automatic depot under this train's axles, if any. A train beside two (industries end to end) is served where
   * a wagon has work: the one whose crane is working on it, else the first where a wagon standing on it has work
   * there (so a school just before a station isn't passed by for the station ahead, where the engine is), else the
   * first where any of its wagons has work (it's coming up to the crane), else the first.
   */
  private depotUnder(train: Train): DepotState | undefined {
    const s = this.services.get(train.id);
    let first: DepotState | undefined;
    let here: DepotState | undefined;
    let work: DepotState | undefined;
    /** The depot last asked whether any wagon has work there (bogies on one depot come together: asked once). */
    let asked: DepotState | undefined;
    const undone = (d: DepotState, carId: number) => !(s && s.depot === d && s.done.has(carId)) && this.needsService(d, carId);
    for (let k = 0; k < train.bogies.length; k++) {
      const d = this.byPiece.get(train.bogies[k].pieceId);
      if (!d || !d.auto) continue;
      if (s && s.phase === HALTED && s.depot === d) return d;
      first ??= d;
      if (!here && undone(d, train.cars[k >> 1].id)) here = d;
      if (!work && d !== asked) {
        asked = d;
        if (train.cars.some((c) => undone(d, c.id))) work = d;
      }
    }
    return here ?? work ?? first;
  }

  /**
   * The sim's speed limit for a powered train: a depot's (see `depotCap`), and a kit's stop's (a platform: see
   * `KitStops`), whichever is lower.
   */
  private capFor(train: Train): number {
    // Held where it stands (a train gone abroad on the ferry: src/game/ferry.ts): by any of its cars, so it stays held
    // through turning round.
    if (this.held.size > 0 && train.cars.some((c) => this.held.has(c.id))) return 0;
    const depot = this.depotCap(train);
    if (depot === 0) return 0;
    const kit = this.kitStops.cap(train);
    if (kit === 0) return 0;
    return Math.min(depot, kit, this.sections.cap(train), this.router.speedCap(train));
  }

  /**
   * The speed limit a depot puts on a powered train: on an automatic depot where one of its wagons has work, crawl,
   * and slow so the next wagon needing the crane stops exactly under it, then hold it there (0) while the crane works.
   * A train with nothing to do there runs through at full speed.
   */
  private depotCap(train: Train): number {
    const d = this.depotUnder(train);
    const s = this.service(train.id);
    if (!d) {
      if (s.phase !== NONE || s.done.size > 0) this.endVisit(s);
      return Infinity;
    }
    if (s.depot !== d) {
      this.endVisit(s);
      s.depotId = d.id;
      s.depot = d;
      s.phase = CRAWLING;
    }
    // Reversing the lever sends the train on: nothing more for it here this visit (and it isn't being worked).
    if (this.drive(train) < 0) {
      for (const car of train.cars) s.done.add(car.id);
      s.phase = NONE;
      return Infinity;
    }
    if (s.phase === HALTED) return 0;
    // Nothing for the crane in this train (this visit): it won't stop, so it needn't slow (nor is it being worked:
    // `servingDepot`).
    // (A routed train's stop where it would neither drop nor pick up anything is run through: "skip if nothing to do",
    // decided afresh each tick as it comes up to the stop, so a pile that fills meanwhile is seen.)
    if (!train.cars.some((car) => !s.done.has(car.id) && this.needsService(d, car.id))) {
      // But a routed train's "Wait here till full" stop never is: it crawls in (goods may yet come, and a wagon that can
      // take them stops under the crane), while a wagon could take some.
      if (!this.waitsHere(train, d)) {
        // Its work here done after a halt: it sets off (the guard's flag).
        if (s.halted) this.departed(s);
        s.phase = NONE;
        // Its work here done (or none): it waits a moment longer if another train of its line left here just now.
        return this.spacingCap(train, d);
      }
    }
    s.phase = CRAWLING;
    let cap = CRAWL_SPEED;
    const len = this.depotLength(d);
    const crane = d.craneAt;
    // A wagon the crane can't stop under (rolled past it, or off the depot's track on a long train): served where it
    // stands, once no other wagon is still coming up to the crane.
    // The train runs front first (its cars in order): cars after the last one on the depot are still to come.
    let lastOn = -1;
    for (let c = 0; c < train.cars.length; c++) if (train.bogies[2 * c].pieceId === d.pieceId || train.bogies[2 * c + 1].pieceId === d.pieceId) lastOn = c;
    // Stopped short of the crane (a buffer, a train ahead): the ones still to come won't, so they're reached for too.
    s.still = train.speed === 0 ? s.still + 1 : 0;
    const stuck = s.still > STUCK_TICKS;
    let reach = -1;
    let coming = false;
    for (let c = 0; c < train.cars.length; c++) {
      const car = train.cars[c];
      if (s.done.has(car.id) || !this.needsService(d, car.id)) continue;
      const front = train.bogies[2 * c];
      const rear = train.bogies[2 * c + 1];
      if (front.pieceId !== d.pieceId || rear.pieceId !== d.pieceId) {
        // Running onto the depot (its leading end on it), or not there yet: it will come up to the crane.
        const arriving = front.pieceId === d.pieceId || (rear.pieceId !== d.pieceId && c > lastOn);
        if (arriving && !stuck) coming = true;
        else if (reach === -1) reach = car.id;
        continue;
      }
      // Distance still to go before the car's centre is under the crane.
      const centre = (along(front, len) + along(rear, len)) / 2;
      const ahead = (crane - centre) * (front.reversed ? -1 : 1);
      if (ahead < -AT_CRANE) {
        if (reach === -1) reach = car.id;
        continue;
      }
      if (ahead <= AT_CRANE) return this.halt(s, car.id);
      if (stuck) {
        if (reach === -1) reach = car.id;
        continue;
      }
      coming = true;
      if (ahead / SIM_DT < cap) cap = ahead / SIM_DT;
    }
    // Beside the depot at all, every wagon gets its turn: the train stops for the ones the crane must reach to.
    if (!coming && reach !== -1) return this.halt(s, reach);
    return cap;
  }

  /**
   * Is depot `d` a routed train's "Wait here till full" stop (the one it's heading for), with a wagon (not yet done
   * this visit) that has room for a good it would pick up here?
   */
  private waitsHere(train: Train, d: DepotState): boolean {
    const route = this.routeOfTrain(train);
    if (!route || !this.waitFillAt(route, d.id)) return false;
    const done = this.services.get(train.id)?.done;
    for (const car of train.cars) {
      if (done?.has(car.id) || !canCarry(car.kind)) continue;
      const c = this.cargoOf(car.id);
      if (c.count >= this.wagonCapacity) continue;
      for (const k of RECIPES[d.role].gives) if ((c.kind === null || c.kind === k) && canCarry(car.kind, k) && storeLetsOut(d, k) && this.carTakes(car.id, k) && this.picksAt(route, d, k, null, sortsMail(train))) return true;
    }
    return false;
  }

  /**
   * Auto-spacing: is this routed train, at the stop it's heading for with nothing (more) to do there, held a moment so
   * its line's trains spread out (see spacing.ts)? Its speed limit if so, else Infinity. Stopped there (its work done)
   * it stays where it is (0); running in with nothing to do it brakes as for a signal, to stop by the stop's far end,
   * but only where it can stop cleanly in that room (else it runs through, and is spaced at a stop where it stops).
   * Its line's trains are counted live: those on the track and not derailed. Its lever set (the player sends it on)
   * lets it go.
   */
  private spacingCap(train: Train, d: DepotState): number {
    let cap = 0;
    let clean = true;
    if (train.speed > CRAWL_SPEED + 1e-6) {
      const front = train.bogies[0];
      if (front.pieceId !== d.pieceId) return Infinity;
      const len = this.depotLength(d);
      const room = (front.reversed ? along(front, len) : len - along(front, len)) - STOP_SHORT;
      cap = room > 0 ? Math.sqrt(2 * ACCELERATION * room) : 0;
      clean = train.speed <= cap + 1e-6;
    }
    for (const car of train.cars) {
      const lineId = this.lineIdOf.get(car.id);
      const r = lineId === undefined ? undefined : this.routes.get(car.id);
      const line = lineId === undefined ? undefined : this.lines.get(lineId);
      if (!r || !line) continue;
      const index = r.next % r.stops.length;
      if (r.stops[index].depotId !== d.id) return Infinity;
      // (Braking for a hold already begun, it carries on: only a new hold needs room to stop in.)
      if (!clean && !this.spacing.holding(car.id)) return Infinity;
      const live: number[] = [];
      for (const [engine, id] of this.lineIdOf) {
        if (id !== line.id) continue;
        const found = this.sim.findCar(engine);
        if (found && !found.train.derailed) live.push(engine);
      }
      return this.spacing.holds(line.id, stopsKey(line), car.id, index, live, this.ticksRun, train.leverTick ?? 0) ? cap : Infinity;
    }
    return Infinity;
  }

  /** Stop the train for the crane to work on this car. */
  private halt(s: Service, carId: number): number {
    if (s.phase !== HALTED) this.depotHalts++;
    s.turnAt ??= this.ticksRun;
    if (!s.halted) {
      s.halted = true;
      const d = s.depot;
      if (d) this.stationNote("halted", d.pieceId, s.trainId, carId);
    }
    s.phase = HALTED;
    s.carId = carId;
    s.ticks = 0;
    return 0;
  }

  /** Net drive of a train's engines toward its front (sign only matters). */
  drive(train: Train): number {
    let net = 0;
    for (const car of train.cars) if (car.kind === "engine") net += car.lever * car.facing;
    return net;
  }

  private depotLength(d: DepotState): number {
    const p = this.layout.getPiece(d.pieceId);
    return p ? pathLength(getPieceDef(p.type, p.flipped).paths[0].geom) : 216;
  }

  private endVisit(s: Service): void {
    if (s.halted) this.departed(s);
    if (s.depotId !== -1 && this.craneBy.get(s.depotId) === s.trainId) this.craneBy.delete(s.depotId);
    s.phase = NONE;
    s.depotId = -1;
    s.depot = null;
    s.turnAt = undefined;
    s.carId = -1;
    s.ticks = 0;
    s.still = 0;
    s.done.clear();
  }

  /** Crane work for every halted train: one unit per move, unloading before loading. */
  private work(): void {
    for (const s of this.services.values()) {
      if (s.phase !== HALTED) continue;
      const train = this.sim.getTrain(s.trainId);
      const d = s.depot;
      if (!train) {
        // Gone (coupled into another train, or removed): forget its visit.
        if (s.halted) this.departed(s);
        this.services.delete(s.trainId);
        continue;
      }
      if (train.derailed || !d || !d.auto || !this.onMap(d) || !this.sim.findCar(s.carId)) {
        this.endVisit(s);
        continue;
      }
      // Lever off: the train stays put and the crane stops; it carries on when the train is set going again.
      if (this.drive(train) === 0) {
        s.phase = CRAWLING;
        s.ticks = 0;
        this.letCraneGo(s);
        continue;
      }
      // People get off a coach, then on, by themselves (no crane).
      const alight = this.canAlight(d, s.carId);
      if (alight || this.canBoard(d, s.carId)) {
        if (++s.ticks < RIDER_TICKS) continue;
        s.ticks = 0;
        const r = this.riders.get(s.carId);
        if (alight) {
          const from = this.depots[r!.from];
          // (Paid while still aboard: the fare reads what the coach's riders have had, `Riders.scenic`.)
          // (At an airport they wait in its lounge for a plane.)
          if (d.role === "airport" || d.role === "mast") d.flyers++;
          if (from) this.onAlight?.(from, d, s.carId);
          this.setRiders(s.carId, r!.count - 1, r!.from);
          this.stationNote("off", d.pieceId, s.trainId, s.carId);
        } else {
          d.waiting--;
          this.setRiders(s.carId, (r?.count ?? 0) + 1, r?.from ?? d.id);
          this.stationNote("on", d.pieceId, s.trainId, s.carId);
        }
        continue;
      }
      if (!this.canUnload(d, s.carId) && this.loadKind(d, s.carId) === null) {
        // A wagon passed over while the pile was full can drop its goods once the depot has used some: back to it
        // before waiting for a load (feedback #26: a last log stayed aboard while the mill had room).
        for (const car of train.cars) if (car.id !== s.carId && s.done.has(car.id) && this.canUnload(d, car.id)) s.done.delete(car.id);
        if (this.waitsForLoad(d, s.carId)) continue;
        s.done.add(s.carId);
        // Unloading done: the wagons that stood aside for it can wait for their load now.
        for (const car of train.cars) if (car.id !== s.carId && s.done.has(car.id) && this.waitsForLoad(d, car.id)) s.done.delete(car.id);
        s.phase = CRAWLING;
        s.ticks = 0;
        this.letCraneGo(s);
        continue;
      }
      if (s.ticks === 0) {
        // A train ahead on the same track still being served goes first, so it can leave and this one move up. While
        // it only waits for a load, this one may unload (that may be what it waits for), not load.
        const ahead = this.queuedBehind(s, train, d);
        if (ahead === BEHIND || (ahead === UNLOAD_ONLY && !this.canUnload(d, s.carId))) continue;
        // (One crane for a depot's several tracks: it moves a unit for one train at a time, each in turn.)
        if (this.tracks.has(d.id) && !this.craneTurn(s)) continue;
      }
      if (++s.ticks < this.craneTicks) continue;
      s.ticks = 0;
      if (this.craneBy.get(d.id) === s.trainId) {
        this.craneBy.delete(d.id);
        s.turnAt = this.ticksRun;
      }
      // A grab crane lifts more than one load a move (while there's more to move).
      const loads = this.craneLoads * (this.liftLoad && d.role === "warehouse" ? LIFT_LOADS : 1);
      for (let n = 0; n < loads; n++) {
        if (this.canUnload(d, s.carId)) {
          this.events.push({ kind: "unloaded", depotId: d.id, cargo: this.cargoOf(s.carId).kind! });
          this.unloadOne(d, s.carId);
        } else if (this.loadKind(d, s.carId) !== null) {
          this.events.push({ kind: "loaded", depotId: d.id, cargo: this.loadKind(d, s.carId)! });
          this.loadOne(d, s.carId);
        } else break;
        this.loadsMoved++;
      }
    }
  }

  /** One sim tick of production, use and crane work (and trains' dwells at kits' stops). */
  tick(): void {
    this.ticksRun++;
    this.work();
    this.kitStops.tick();
    if (this.routes.size > 0) this.advanceRoutes();
    // Switches ahead of routed trains (routing/router.ts; nothing with none).
    this.router.tick();
    // Trains stuck for good, for their cards (every CHECK_TICKS, with two trains or more).
    this.stalls.tick();
    // Breakdown cranes driving out and lifting trains (a look every half second with none at work).
    this.breakdown.tick();
    // (The invariants, where they're on: they only read.)
    this.checker?.check();
    this.roadVehicles.tick(SIM_DT);
    // (Only depots on the map: one whose piece was taken up makes nothing till it's back.)
    for (const d of this.allDepots()) {
      if (!this.working(d)) {
        d.timer = 0;
        continue;
      }
      d.timer++;
      const cycle = RECIPES[d.role].cycle!;
      if (d.timer < cycleTicks(cycle.seconds, d.rate)) continue;
      d.timer = 0;
      if (cycle.eats) {
        for (const k of RECIPES[d.role].takes) if (d.piles[CARGO[k].index] > 0) d.piles[CARGO[k].index]--;
        continue;
      }
      for (const k in cycle.uses) d.piles[CARGO[k as CargoKind].index] -= cycle.uses[k as CargoKind]!;
      for (const k in cycle.makes) {
        d.piles[CARGO[k as CargoKind].index] += cycle.makes[k as CargoKind]!;
        this.made[CARGO[k as CargoKind].index] += cycle.makes[k as CargoKind]!;
      }
    }
    // Towns post mail (Game mode's Post office), looked at once a second.
    if (this.mailEvery && this.ticksRun % MAIL_LOOK === 0) this.postMail(this.mailEvery);
    // Sorting vans sort their mail on the move (Sorting van), looked at once a second.
    if (this.ticksRun % MAIL_LOOK === 0 && this.cargo.size > 0) this.sortOnTheMove();
  }

  /**
   * Seconds between a town's sacks of mail (Game mode: once Post office is learned, quicker the bigger the town); 0:
   * it posts none. Asked once a second per town. Null: towns post none (Sandbox).
   */
  mailEvery: ((d: DepotState) => number) | null = null;
  /** Each town depot's mail so far toward its next sack (0–1). Not saved: a fraction of a sack at most is lost. */
  private readonly mailDue = new Map<number, number>();

  /** Each sorting van's running so far toward its load being sorted (s). Not saved: a load's sorting starts again. */
  private readonly sortRun = new Map<number, number>();

  /**
   * A second of sorting: each sorting van with mail on board, its train moving, runs a second more; once it has run
   * `SORT_SECONDS` for each sack, the whole load is post. A van with no mail forgets its count. Cheap: one pass over the
   * trains' cars, once a second, only while some wagon has goods.
   */
  private sortOnTheMove(): void {
    for (const id of this.sim.trainIds()) {
      const train = this.sim.getTrain(id)!;
      for (const car of train.cars) {
        if (car.kind !== "sortvan") continue;
        const c = this.cargo.get(car.id);
        if (!c || c.kind !== "mail") {
          this.sortRun.delete(car.id);
          continue;
        }
        if (train.derailed || Math.abs(train.speed) < 1) continue;
        const run = (this.sortRun.get(car.id) ?? 0) + MAIL_LOOK * SIM_DT;
        if (run + 1e-6 < SORT_SECONDS * c.count) {
          this.sortRun.set(car.id, run);
          continue;
        }
        this.sortRun.delete(car.id);
        this.cargo.set(car.id, { kind: "post", count: c.count });
        this.made[CARGO.post.index] += c.count;
        this.loadsVersion++;
        this.wantsStamp++;
      }
    }
  }

  /** How far a sorting van's mail is sorted (0 to 1; 0 with no mail on board). */
  sortedShare(carId: number): number {
    const c = this.cargo.get(carId);
    if (!c || c.kind !== "mail") return 0;
    return Math.min(1, (this.sortRun.get(carId) ?? 0) / (SORT_SECONDS * c.count));
  }

  /** A second's mail: each town on the map adds 1/`every` of a sack, and a whole one lands on its pile (while there's room). */
  private postMail(every: (d: DepotState) => number): void {
    const i = CARGO.mail.index;
    for (const d of this.allDepots()) {
      if (d.role !== "town") continue;
      const s = every(d);
      if (s <= 0) continue;
      let due = (this.mailDue.get(d.id) ?? 0) + (MAIL_LOOK * SIM_DT) / s;
      if (due >= 1) {
        due -= 1;
        if (d.piles[i] < capAt(d)) {
          d.piles[i]++;
          this.made[i]++;
        } else due = 0;
      }
      this.mailDue.set(d.id, due);
    }
  }

  /**
   * A mode's say in what a depot takes from trains, beyond its recipe (Game mode: a town takes only what it still
   * wants for its next level, so the rest rides on to the next town). Null: everything its recipe takes.
   */
  accepts: ((d: DepotState, kind: CargoKind) => boolean) | null = null;

  /**
   * A unit landed at a sink depot (Game mode: goods into a school's research, `src/game/research.ts`). Null: it just
   * vanishes (Sandbox's unloader).
   */
  intoSink: ((d: DepotState, kind: CargoKind) => void) | null = null;

  /**
   * How many more of `kind` a sink depot takes (Game mode: what the current research still lacks). A train keeps that
   * many on board past towns and workshops for a school set to Research first (`keptForSchool`). Null: none kept.
   */
  sinkWants: ((kind: CargoKind) => number) | null = null;

  /**
   * What `accepts` says changed without goods reaching a town or a sink (Game mode: a research picked): routed trains'
   * plans are worked out again.
   */
  acceptsChanged(): void {
    this.wantsStamp++;
  }

  /**
   * Goods a mode keeps for a workshop (Game mode: planks, while the workshop holds fewer than its waiting tray order
   * needs: `orderPlanks` in crafting.ts): towns don't take them from unrouted trains, which carry them on to the
   * workshop.
   */
  reserved: ((kind: CargoKind) => boolean) | null = null;

  /**
   * How many of `kind` a workshop's yard takes from a train while a town the train goes on to wants it (Game mode:
   * planks, its waiting tray order's or `WORKSHOP_SPARE`: `yardKeeps` in crafting.ts); beyond that they ride on to the
   * town. Null (or null for a kind): as many as the yard has room for. With no town ahead wanting them, or at a
   * workshop set to take all (`takesAll`), the yard fills. `d`: the workshop, whose card may set its own amounts
   * (`DepotState.keeps`).
   */
  shopKeeps: ((kind: CargoKind, d: DepotState) => number | null) | null = null;

  /**
   * How many more of `kind` (one a recipe takes only while `owed`: a workshop's stone) the workshops take: what's
   * needed there less what they hold (Game mode: `shopOwes` in crafting.ts). Called as trains unload (not each frame),
   * so keep it cheap. When it goes from none to some for any other reason than goods landing here (a blueprint
   * learned, an order, a price paid), call `acceptsChanged` so routed lines plan again. Null: none owed (Sandbox).
   */
  owes: ((kind: CargoKind) => number) | null = null;

  /**
   * Goods landed at a depot for trains to take away (Game mode: what a boat brought to a harbour), by depot id and
   * cargo index. A depot gives these as well as its recipe's goods.
   */
  readonly landed = new Map<number, Int32Array>();
  /** Cars carrying goods landed at a depot, by car id: the depot they came from (they're not unloaded back there). */
  readonly landedFrom = new Map<number, number>();

  /** Land `n` of `kind` on a depot's pile for trains to take away. */
  land(d: DepotState, kind: CargoKind, n: number): void {
    let l = this.landed.get(d.id);
    if (!l) this.landed.set(d.id, (l = new Int32Array(CARGO_SLOTS)));
    l[CARGO[kind].index] += n;
    d.piles[CARGO[kind].index] += n;
  }

  /** The goods a depot gives trains: its recipe's, and any landed there. */
  private givesAt(d: DepotState): readonly CargoKind[] {
    const l = this.landed.get(d.id);
    if (!l) return RECIPES[d.role].gives;
    return [...RECIPES[d.role].gives, ...CARGO_KINDS.filter((k) => l[CARGO[k].index] > 0 && !RECIPES[d.role].gives.includes(k))];
  }

  /** Ticks a crane takes to move a load (Game mode's quicker cranes make it shorter). */
  craneTicks = CRANE_TICKS;
  /** Units a wagon holds (Game mode's heavy wagons, from the smithy: more). */
  wagonCapacity = WAGON_CAPACITY;
  /** Loads a crane moves at once (grab cranes: two). */
  craneLoads = 1;

  /**
   * Lift and load (Game mode): every warehouse, and any built later, stacks its goods `LIFT_STACK` high and lifts
   * `LIFT_LOADS` times as many a crane move: two wagons' worth while the one crane works. Not saved: set again as the
   * game's research is (`applyCranes`).
   */
  get warehouseLift(): boolean {
    return this.liftLoad;
  }
  setWarehouseLift(on: boolean): void {
    if (on === this.liftLoad) return;
    this.liftLoad = on;
    for (const d of this.depots) if (d.role === "warehouse") d.stack = on ? LIFT_STACK : 1;
  }
  private liftLoad = false;
  /** Units of each good made at industries, by cargo index, since this economy began (counters for Game mode). */
  readonly made = new Int32Array(CARGO_SLOTS);
  /** Loads the cranes have moved, since this economy began. */
  loadsMoved = 0;

  /**
   * Is this engine's train held at its stop for spacing (see spacing.ts)? Its line, and how long it has waited and has
   * at most left (s; null while it waits behind another train of the line), for its card.
   */
  spacingWait(engineCarId: number): { line: Line; waited: number; left: number | null } | null {
    const w = this.spacing.waitOf(engineCarId, this.ticksRun);
    const line = w && this.lines.get(w.lineId);
    return w && line ? { line, waited: w.waited, left: w.left } : null;
  }

  /** Ticks run (sim time: a pause stops it), for spacing the trains on a line (`spacing`). */
  private ticksRun = 0;
  /** Auto-spacing of the trains on a line (see spacing.ts). */
  readonly spacing = new Spacing();

  /**
   * Trains called home by a signal box's Telegraph (game/telegraph.ts): engine → its home depot. Each stops there, its
   * levers off, as it comes to it (`advanceRoutes`), and is forgotten. Not saved: after a load it runs on as routed.
   */
  readonly homeCalls = new Map<number, number>();
  /** Engines come home since the last look (`drainCameHome`). */
  private cameHome: number[] = [];

  /** The engines that came home since the last call, for a toast. */
  drainCameHome(): number[] {
    if (this.cameHome.length === 0) return NO_ENGINES;
    const out = this.cameHome;
    this.cameHome = [];
    return out;
  }

  /** A routed train that has been at its next stop and left it heads for the one after. */
  private advanceRoutes(): void {
    for (const [engine, r] of this.routes) {
      const found = this.sim.findCar(engine);
      if (!found) continue;
      const stop = r.stops[r.next % r.stops.length];
      const d = this.depots[stop.depotId];
      if (!d || !this.layout.getPiece(d.pieceId)) {
        // Its stop was taken up: on to the next.
        r.next = (r.next + 1) % r.stops.length;
        this.nextStamp++;
        r.at = false;
        continue;
      }
      const on = found.train.bogies.some((b) => b.pieceId === d.pieceId || this.byPiece.get(b.pieceId)?.id === d.id);
      // (Via points on the way: passed when its leading axle comes to them.)
      if (!on && !r.at) {
        const net = this.drive(found.train);
        const t = found.train;
        if (net !== 0) passVias(r, r.stops.length, (k) => r.stops[k].via, (p) => !!this.layout.getPiece(p), (net > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1]).pieceId);
      }
      const lineId = this.lineIdOf.get(engine);
      const line = lineId === undefined ? undefined : this.lines.get(lineId);
      if (on) {
        // Come to it (for spacing: the first here goes first).
        if (!r.at && line) this.spacing.arrived(line.id, stopsKey(line), engine, r.next % r.stops.length, this.ticksRun);
        // Called home (the Telegraph) and home now: it stops here, its levers off, till the player sends it on.
        if (!r.at && this.homeCalls.get(engine) === stop.depotId) {
          this.homeCalls.delete(engine);
          for (const car of found.train.cars) if (car.kind === "engine") this.sim.setLever(car.id, 0);
          this.cameHome.push(engine);
        }
        r.at = true;
      } else if (r.at) {
        // Left it: on past it, and past any stops after it at the same depot (they were the same visit).
        r.at = false;
        this.nextStamp++;
        if (line) this.spacing.departed(line.id, stopsKey(line), engine, r.next % r.stops.length, this.ticksRun);
        for (let k = 0; k < r.stops.length; k++) {
          r.next = (r.next + 1) % r.stops.length;
          if (r.stops[r.next].depotId !== stop.depotId) break;
        }
        resetVias(r);
      }
    }
  }

  /**
   * May this halted train's wagon have the crane of its depot of several tracks now? Yes if the crane is its already,
   * or free and no other train there that wants it has waited longer (`turnAt`; ties by train id): so the one crane
   * serves each track's train in turn, a unit at a time. Taken, it's this train's till the unit is moved.
   */
  private craneTurn(s: Service): boolean {
    const by = this.craneBy.get(s.depotId);
    if (by === s.trainId) return true;
    if (by !== undefined && this.services.get(by)?.phase === HALTED && this.services.get(by)?.depotId === s.depotId) return false;
    const mine = s.turnAt ?? this.ticksRun;
    for (const o of this.services.values()) {
      if (o === s || o.phase !== HALTED || o.depotId !== s.depotId || !o.depot) continue;
      const at = o.turnAt ?? this.ticksRun;
      if (at > mine || (at === mine && o.trainId > s.trainId)) continue;
      const t = this.sim.getTrain(o.trainId);
      if (!t || this.drive(t) === 0) continue;
      // (Not one queued behind a train on its own track: it isn't asking for the crane yet.)
      const queued = this.queuedBehind(o, t, o.depot);
      if (queued === BEHIND) continue;
      if (this.canUnload(o.depot, o.carId) || (queued === FREE && this.loadKind(o.depot, o.carId) !== null)) return false;
    }
    this.craneBy.set(s.depotId, s.trainId);
    return true;
  }

  /**
   * Is this halted train queued behind another on the same track of the depot (the user's two trains nose to tail at
   * a mill)? The front one (furthest on in its direction of travel) is served first, so it can fill and leave and the
   * one behind move up: `BEHIND` while a train ahead still has its visit going (halted for the crane or crawling up to
   * its next wagon, its lever on); `UNLOAD_ONLY` while the only ones ahead are just waiting for a load (the goods this
   * one brings may be what makes it); else `FREE`. Trains on other tracks of a depot aren't ahead (`craneTurn` shares
   * the crane among those). Cheap: a pass over the services, no allocation, asked only as a crane move would start.
   */
  private queuedBehind(s: Service, train: Train, d: DepotState): number {
    if (this.services.size < 2) return FREE;
    const len = this.depotLength(d);
    const k = leadOn(train, d.pieceId);
    if (k < 0) return FREE;
    const dir = train.bogies[k].reversed ? -1 : 1;
    const mine = along(train.bogies[k], len);
    let out = FREE;
    for (const o of this.services.values()) {
      if (o === s || o.depot !== d || o.phase === NONE) continue;
      const t = this.sim.getTrain(o.trainId);
      if (!t || t.derailed || this.drive(t) <= 0) continue;
      const j = leadOn(t, d.pieceId);
      if (j < 0 || (t.bogies[j].reversed ? -1 : 1) !== dir || (along(t.bogies[j], len) - mine) * dir <= 0) continue;
      // Ahead of this one. Just waiting for goods to come (nothing for the crane to move for it now)?
      if (o.phase === HALTED && !this.canUnload(d, o.carId) && this.loadKind(d, o.carId) === null && this.waitsForLoad(d, o.carId)) out = UNLOAD_ONLY;
      else return BEHIND;
    }
    return out;
  }

  /** This train's wagon no longer has its depot's crane (it moves on to its next wagon, or stops). */
  private letCraneGo(s: Service): void {
    if (s.depotId !== -1 && this.craneBy.get(s.depotId) === s.trainId) {
      this.craneBy.delete(s.depotId);
      s.turnAt = this.ticksRun;
    }
  }

  /** A train halted at a depot sets off: its "left" station event (once a halt). */
  private departed(s: Service): void {
    s.halted = false;
    const d = s.depot;
    if (d) this.stationNote("left", d.pieceId, s.trainId, -1);
  }

  private stationNote(kind: StationEvent["kind"], pieceId: number, trainId: number, carId: number): void {
    if (this.stationLog.length >= STATION_LOG_MAX) this.stationLog.length = 0;
    this.stationLog.push({ kind, pieceId, trainId, carId });
  }

  /** Station events since the last drain (see `StationEvent`). The returned array is reused: read it before the next. */
  drainStationEvents(): readonly StationEvent[] {
    const e = this.stationLog;
    this.stationLog = this.stationDrained;
    this.stationLog.length = 0;
    this.stationDrained = e;
    return e;
  }

  /** Events since the last drain. The returned array is reused: read it before the next drain. */
  drainEvents(): readonly EconomyEvent[] {
    const e = this.events;
    this.events = this.drained;
    this.events.length = 0;
    this.drained = e;
    return e;
  }

  /**
   * Goods a wagon is switched off for (its card: on/off per good it can carry), a cargo bitmask by car id; none (the
   * default): it takes every good it can carry. Saved per car. Among the goods it's on for, an empty wagon still takes
   * the one its train carries least of (`loadKind`).
   */
  private readonly carOff = new Map<number, number>();
  /** Bumped when a wagon's goods are switched (its card is drawn again). */
  carGoodsVersion = 0;

  /** Does this wagon take `kind` (not switched off on its card)? */
  carTakes(carId: number, kind: CargoKind): boolean {
    return !((this.carOff.get(carId) ?? 0) & (1 << CARGO[kind].index));
  }

  /** Switch a good on or off for a wagon. What it has on board stays (it's dropped as usual). */
  setCarTakes(carId: number, kind: CargoKind, on: boolean): void {
    const was = this.carOff.get(carId) ?? 0;
    const off = on ? was & ~(1 << CARGO[kind].index) : was | (1 << CARGO[kind].index);
    if (off === was) return;
    if (off === 0) this.carOff.delete(carId);
    else this.carOff.set(carId, off);
    this.carGoodsVersion++;
  }

  /** The goods a wagon is switched off for (for its save). */
  carOffKinds(carId: number): CargoKind[] {
    const off = this.carOff.get(carId) ?? 0;
    return off === 0 ? [] : CARGO_KINDS.filter((k) => off & (1 << CARGO[k].index));
  }

  /** Forget cargo and destinations on cars, and visits of trains, that no longer exist. */
  prune(): void {
    for (const id of this.carOff.keys()) if (!this.sim.findCar(id)) this.carOff.delete(id);
    for (const id of this.cargo.keys()) if (!this.sim.findCar(id)) this.cargo.delete(id);
    for (const id of this.riders.keys()) if (!this.sim.findCar(id)) this.riders.delete(id);
    for (const id of this.routes.keys()) if (!this.sim.findCar(id)) this.routes.delete(id);
    // An engine gone: off its line; a line no train runs is forgotten.
    for (const id of this.lineIdOf.keys()) if (!this.routes.has(id)) this.lineIdOf.delete(id);
    const run = new Set(this.lineIdOf.values());
    for (const id of this.lines.keys()) if (!run.has(id)) this.lines.delete(id);
    this.spacing.prune(run, new Set(this.lineIdOf.keys()));
    this.sections.prune(new Set(this.lineIdOf.keys()));
    this.stalls.prune();
    for (const id of this.services.keys()) if (!this.sim.getTrain(id)) this.services.delete(id);
    this.kitStops.prune();
    // (Points laid take the way they lie as their default; points taken up lose theirs.)
    this.router.laid();
  }
}


/** Ticks in one cycle of `seconds` at `rate` (whole ticks, so production stays in step with the sim). */
function cycleTicks(seconds: number, rate: number): number {
  return Math.max(1, Math.round(ticks(seconds) / rate));
}

/** A cursor's distance from its path's `from` end. */
/** A train braking to wait at its stop (auto-spacing) stops this far (mm) short of the stop's far end. */
const STOP_SHORT = 6;

/** `queuedBehind`'s answers. */
const FREE = 0;
const BEHIND = 1;
const UNLOAD_ONLY = 2;

/** The first (leading) bogie of a train on this piece, or −1. */
function leadOn(train: Train, pieceId: number): number {
  for (let k = 0; k < train.bogies.length; k++) if (train.bogies[k].pieceId === pieceId) return k;
  return -1;
}

function along(c: Cursor, len: number): number {
  return c.reversed ? len - c.s : c.s;
}

/** A line's stops as a key (spacing starts afresh when they change). */
const stopsKey = (line: Line): string => line.stops.map((s) => s.depotId).join(",");

/** Is this a stop where riders get on and off: a town's station or halt, or an airport? */
export function riderStop(d: Pick<DepotState, "role">): boolean {
  return d.role === "town" || d.role === "airport" || d.role === "mast";
}

/** The "town" a rider stop is for: its town's id, or for an airport its own (no town's: −2 less its depot id). */
function stopTown(d: Pick<DepotState, "role" | "townId" | "id">): number {
  return d.role === "airport" || d.role === "mast" ? -2 - d.id : d.townId;
}
