import type { CargoKind } from "../economy/cargo";
import { addInto, type Bag, kindsOf, total } from "../economy/goods";
import type { Landscape, Town } from "../landscape";
import { checkProp, TrackIndex, type Footprint } from "../props/placement";
import type { PropPose } from "../props/store";
import { coinsShort } from "./research";
import type { Progress } from "./progress";
import type { World } from "./world";

/**
 * Grand projects (spec 2026-11-05-character-and-goals.md, "Grand projects are achievements with a reward"): map-wide
 * builds you work towards once a town is a City ★. Each is an achievement in the Journal: started from a City ★'s card
 * (its coins paid), it goes up on a site beside the city in stages, each stage's goods brought by train to the city's
 * station (as a town's places are: game/places.ts). Finishing it gives its day (a celebration) and a lasting reward.
 *
 * - One of each per map, one under way per city at a time. Nothing before City ★, so the early game is as it was.
 * - The map is the record: `Economy.grandPlans` holds each project started (its city, stages done, goods so far, its
 *   site's prop), saved with the world. A project with all its stages done is earned, and its reward holds from then
 *   on: rewards are read from the plans (never taken away), but the Exhibition's growth, given once, is saved as a
 *   bag per town (`Economy.grandGift`).
 * - The site is a prop (`grand-<id>-<stage>`: the catalogue's model for that stage, `stage` 0 a fenced plot), its
 *   asset swapped as each stage is done.
 */

export type GrandId = "exhibition" | "cathedral" | "royal-train" | "central" | "ferris-wheel";

export interface GrandStage {
  /** What this stage builds ("The iron hall"). */
  readonly name: string;
  /** The goods it takes, brought by train to its city's station. */
  readonly goods: Bag;
  /** Riders carried through its city's station (getting on or off there) it takes too (Grand Central's last stage). */
  readonly riders?: number;
}

export interface Grand {
  readonly id: GrandId;
  readonly name: string;
  readonly icon: string;
  /** The catalogue models' id stem: `grand-exhibition` → `grand-exhibition-0` … `-4`. */
  readonly asset: string;
  readonly stages: readonly GrandStage[];
  /** Coins, paid as it's started. */
  readonly coins: number;
  /** The reward, in a line, said before you start (🎁). */
  readonly reward: string;
  /** The reward in a few words, on its row on a city's card ("Every town grows a step"). */
  readonly short: string;
  /** Its day: the toast when it's done. */
  readonly day: string;
  /** Drawn at this share of its model's size on the map (the models are big: a city's biggest thing). */
  readonly scale: number;
  /**
   * Built as a station of its own (Grand Central): a kit given into the toy box as it's started, put on a line by its
   * city as one of its stops; `kits[stage]` is its kit with `stage` of its stages done (the one placed is retyped).
   */
  readonly kits?: readonly (typeof GRAND_CENTRAL_KITS)[number][];
}

/** A town's level a grand project needs: City ★ (0 a hamlet, 1 a village, 2 a town, 3 a city). */
export const GRAND_LEVEL = 4;

/** The Exhibition's reward: a city's next star this share filled (towns below a city grow a whole level). */
export const EXHIBITION_SHARE = 0.25;
/** The Cathedral's reward: every town needs this share fewer of each good to grow. */
export const CATHEDRAL_CUT = 0.1;
/** The Cathedral's pilgrims: people come to its city's stations this many times as often. */
export const PILGRIMS = 1.5;
/** Grand Central's kits, one per build stage (platforms laid, half built, finished): the same three roads in each. */
export const GRAND_CENTRAL_KITS = ["kit-grand-central-1", "kit-grand-central-2", "kit-grand-central-3"] as const;
export const isGrandCentral = (type: string | undefined): boolean => !!type && type.startsWith("kit-grand-central-");

/** Grand Central's reward: riders on a line through it (or getting on or off there) pay this many times the fare. */
export const HUB_FARE = 1.25;
/** The World's Fair wheel's fair week: in July, people come to its city's stations this many times as often. */
export const FAIR_RIDERS = 3;
/** The month of the fair (0 = January). */
export const FAIR_MONTH = 6;
/** The wheel's tickets: coins it takes each game month. */
export const WHEEL_COINS = 60;

export const GRANDS: readonly Grand[] = [
  {
    id: "exhibition",
    name: "Great Exhibition",
    icon: "🏛️",
    asset: "grand-exhibition",
    stages: [
      { name: "The foundations", goods: { stone: 20, planks: 20 } },
      { name: "The iron hall", goods: { iron: 16, bricks: 10 } },
      { name: "The stands", goods: { furniture: 10, tools: 6 } },
      { name: "Opening day", goods: { paint: 8, bread: 10 } },
    ],
    coins: 400,
    reward: "Every town grows a step: a level, or a quarter of a city's next star",
    short: "Every town grows a step",
    day: "The Great Exhibition opens! Flags and bunting in every town, and every town grows",
    scale: 0.8,
  },
  {
    id: "cathedral",
    name: "Cathedral",
    icon: "⛪",
    asset: "grand-cathedral",
    stages: [
      { name: "The nave", goods: { stone: 30 } },
      { name: "The walls and aisles", goods: { bricks: 14, stone: 10 } },
      { name: "The roofs", goods: { planks: 20, tools: 8 } },
      { name: "Stained glass", goods: { glass: 16, paint: 8 } },
    ],
    coins: 450,
    reward: "Every town grows on a tenth fewer goods, and pilgrims come to its city (1.5× riders)",
    short: "Every town grows on fewer goods",
    day: "The Cathedral's bells ring! A wedding at its door, bunting in every town, and every town needs a tenth fewer goods to grow",
    scale: 0.7,
  },
  {
    id: "royal-train",
    name: "Royal Train",
    icon: "👑",
    asset: "grand-royal-train",
    stages: [
      { name: "The frames", goods: { iron: 12, tools: 8 } },
      { name: "The saloons", goods: { planks: 16, furniture: 10 } },
      { name: "Claret and gold", goods: { paint: 12 } },
    ],
    coins: 300,
    reward: "The Royal Train is yours: an engine and two saloons in the toy box. Its riders pay double",
    short: "A royal train for your toy box",
    day: "The Royal Train is finished! Claret and gold, in your toy box now: its riders pay double",
    scale: 1,
  },
  {
    id: "central",
    name: "Grand Central",
    icon: "🚉",
    asset: "grand-central",
    stages: [
      { name: "The platforms and shed", goods: { bricks: 16, iron: 12 } },
      { name: "The clock tower", goods: { stone: 24 } },
      { name: "Every line meets", goods: {}, riders: 60 },
    ],
    coins: 500,
    reward: "A hub: its three roads stop three trains at once, and riders on lines through it pay a quarter more",
    short: "A hub station: riders pay more",
    day: "Grand Central opens! Every line's trains meet under its clock, and riders through it pay a quarter more",
    scale: 1,
    kits: ["kit-grand-central-1", "kit-grand-central-2", "kit-grand-central-3", "kit-grand-central-3"],
  },
  {
    id: "ferris-wheel",
    name: "World's Fair wheel",
    icon: "🎡",
    asset: "grand-ferris-wheel",
    stages: [
      { name: "The legs", goods: { iron: 14, tools: 8 } },
      { name: "The wheel", goods: { planks: 16, paint: 8 } },
      { name: "The fair", goods: { icecream: 8, juice: 8, fish: 8 } },
    ],
    coins: 350,
    reward: `Fair week every July (3× riders to its city), and ${WHEEL_COINS} coins a month in tickets`,
    short: "A fair each July, and tickets",
    day: "The World's Fair wheel turns! Fair week every July, and its tickets pay every month",
    scale: 0.85,
  },
];

const BY_ID = new Map<string, Grand>(GRANDS.map((g) => [g.id, g]));
export const grandOf = (id: string): Grand | undefined => BY_ID.get(id);

/** A grand project started on this map: its city, how many of its stages are done, its goods so far, its site. */
export interface GrandPlan {
  townId: number;
  /** Stages done (0 to `stages.length`: all done, it's earned). */
  stage: number;
  /** The goods the stage under way has had, by kind. */
  got: Bag;
  /** Its site's prop id (−1: none: Grand Central, built as its city's station). */
  prop: number;
  /** Riders through its city's station since its stage that counts them began (Grand Central's last). */
  riders?: number;
}

/** Is this plan's project finished (every stage done)? */
export function grandDone(id: string, plan: GrandPlan | undefined): boolean {
  const g = grandOf(id);
  return !!g && !!plan && plan.stage >= g.stages.length;
}

/** Is project `id` finished on this map? */
export const earned = (world: Pick<World, "economy">, id: GrandId): boolean => grandDone(id, world.economy.grandPlans.get(id));

/** The project under way in town `townId` (not finished), or null. */
export function grandUnderWay(world: Pick<World, "economy">, townId: number): { id: GrandId; plan: GrandPlan } | null {
  for (const [id, plan] of world.economy.grandPlans) if (plan.townId === townId && !grandDone(id, plan)) return { id: id as GrandId, plan };
  return null;
}

/** How many more of `kind` the stage under way of `plan` wants (0: none, or it's finished). */
export function stageLacks(id: string, plan: GrandPlan, kind: CargoKind): number {
  const g = grandOf(id);
  const stage = g?.stages[plan.stage];
  return stage ? Math.max(0, (stage.goods[kind] ?? 0) - (plan.got[kind] ?? 0)) : 0;
}

/** Has the stage under way had every good it wants? */
export function stageFilled(id: string, plan: GrandPlan): boolean {
  const stage = grandOf(id)?.stages[plan.stage];
  return !!stage && kindsOf(stage.goods).every((k) => stageLacks(id, plan, k) === 0) && (plan.riders ?? 0) >= (stage.riders ?? 0);
}

/** Riders the stage under way of town `townId`'s project still wants through its station (0: none, or not that kind). */
export function ridersLack(world: Pick<World, "economy">, townId: number): number {
  for (const [id, plan] of world.economy.grandPlans) {
    if (plan.townId !== townId || grandDone(id, plan)) continue;
    const want = grandOf(id)?.stages[plan.stage]?.riders ?? 0;
    if (want > (plan.riders ?? 0)) return want - (plan.riders ?? 0);
  }
  return 0;
}

/**
 * A rider got off at `to`, having got on at `from` (town ids): one carried through a city whose project's stage counts
 * riders (Grand Central's) counts toward it. Returns whether one was counted (its stage may be done: `advanceGrands`).
 */
export function countRider(world: Pick<World, "economy">, fromTown: number, toTown: number): boolean {
  for (const [id, plan] of world.economy.grandPlans) {
    if (plan.townId !== fromTown && plan.townId !== toTown) continue;
    const want = grandOf(id)?.stages[plan.stage]?.riders ?? 0;
    if (grandDone(id, plan) || (plan.riders ?? 0) >= want) continue;
    plan.riders = (plan.riders ?? 0) + 1;
    return true;
  }
  return false;
}

/**
 * Grand Central's fare bonus (`HUB_FARE`), once it's finished: for a rider on a train whose line stops at its station,
 * or who got on or off there. `engine` is the rider's train's engine (its line: `Economy.lineIdOf`); 1: no bonus.
 */
export function hubFare(world: Pick<World, "economy" | "layout">, from: { pieceId: number }, to: { pieceId: number }, engine: number | undefined): number {
  const c = world.economy.grandPlans.get("central");
  if (!c || !grandDone("central", c)) return 1;
  const at = (pieceId: number) => isGrandCentral(world.layout.getPiece(pieceId)?.type);
  if (at(from.pieceId) || at(to.pieceId)) return HUB_FARE;
  const line = engine === undefined ? undefined : world.economy.lines.get(world.economy.lineIdOf.get(engine) ?? -1);
  if (!line) return 1;
  for (const s of line.stops) {
    const d = world.economy.depot(s.depotId);
    if (d && at(d.pieceId)) return HUB_FARE;
  }
  return 1;
}

/** Grand Central's piece on the map (its kit placed), or −1. */
export function centralPiece(world: Pick<World, "layout">): number {
  for (const id of world.layout.pieceIds()) if (isGrandCentral(world.layout.getPiece(id)!.type)) return id;
  return -1;
}

/**
 * Grand Central's stage done: its kit moves on to `kit` (the stage's), the placed one retyped with its trains and joints,
 * or the one in the toy box swapped; the toy box's count moves along either way, so it's still one, never made.
 */
export function moveCentralKit(world: Pick<World, "layout">, p: Pick<Progress, "owned">, kit: (typeof GRAND_CENTRAL_KITS)[number]): void {
  const id = centralPiece(world);
  const from = id >= 0 ? (world.layout.getPiece(id)!.type as (typeof GRAND_CENTRAL_KITS)[number]) : GRAND_CENTRAL_KITS.find((k) => (p.owned.get(`piece:${k}`) ?? 0) > 0);
  if (!from || from === kit) return;
  if (id >= 0 && !world.layout.retype(id, kit)) return;
  p.owned.set(`piece:${from}`, Math.max(0, (p.owned.get(`piece:${from}`) ?? 0) - 1));
  p.owned.set(`piece:${kit}`, (p.owned.get(`piece:${kit}`) ?? 0) + 1);
}

/** Game mode's rule for Grand Central's place: by its own city (the halt's town), or why not (null: fine). */
export function centralWhy(world: Pick<World, "economy" | "landscape">, type: string, town: { id: number } | null): string | null {
  if (!isGrandCentral(type)) return null;
  const c = world.economy.grandPlans.get("central");
  const city = c && world.landscape.towns.find((t) => t.id === c.townId);
  if (!city) return null;
  return town?.id === city.id ? null : `Grand Central is ${city.name}'s: put it on a line by ${city.name}`;
}

/** How many of `kind` town `townId`'s project under way still wants for its stage (0: none). A lookup, per unit. */
export function grandLacks(world: Pick<World, "economy">, townId: number, kind: CargoKind): number {
  // (A few plans at most: no map made.)
  for (const [id, plan] of world.economy.grandPlans) if (plan.townId === townId) {
    const n = stageLacks(id, plan, kind);
    if (n > 0) return n;
  }
  return 0;
}

/** The asset a project's site shows with `stage` of its stages done (0: the fenced plot). */
export const siteAsset = (g: Grand, stage: number): string => `${g.asset}-${Math.max(0, Math.min(g.stages.length, stage))}`;

/** The stage under way's share done, 0–1 (1: finished). */
export function stageFill(id: string, plan: GrandPlan): number {
  const g = grandOf(id);
  const stage = g?.stages[plan.stage];
  if (!stage) return 1;
  let got = 0;
  for (const k of kindsOf(stage.goods)) got += Math.min(stage.goods[k]!, plan.got[k] ?? 0);
  return got / Math.max(1, total(stage.goods));
}

// ---- rewards -------------------------------------------------------------------------------------------------

/** The share of every good fewer that towns need to grow, from the projects finished (the Cathedral's tenth). */
export function growthCut(world: Pick<World, "economy">): number {
  return earned(world, "cathedral") ? CATHEDRAL_CUT : 0;
}

/**
 * What the Exhibition gives a town as it opens, toward its growth (game/town-life.ts, `growthOf`): below a city, all it
 * still lacks for its next level (it grows a level); a city or bigger, a quarter of each good its next star wants (what
 * it lacks, at most). `wants` and `got` are its status now.
 */
export function exhibitionGift(level: number, wants: Bag, got: Bag): Bag {
  const out: Bag = {};
  for (const k of kindsOf(wants)) {
    const lack = Math.max(0, wants[k]! - (got[k] ?? 0));
    const give = level < 3 ? lack : Math.min(lack, Math.ceil(wants[k]! * EXHIBITION_SHARE));
    if (give > 0) out[k] = give;
  }
  return out;
}

/**
 * How much more often people come to town `townId`'s stations from the projects, over plain (0: none): the Cathedral's
 * pilgrims, and the wheel's fair week in July (`month`, 0 = January). Each adds to the base, as other boosts do: they
 * don't multiply.
 */
export function grandRiders(world: Pick<World, "economy">, townId: number, month?: number): number {
  let extra = 0;
  const c = world.economy.grandPlans.get("cathedral");
  if (c && c.townId === townId && grandDone("cathedral", c)) extra += PILGRIMS - 1;
  const w = world.economy.grandPlans.get("ferris-wheel");
  if (w && w.townId === townId && month === FAIR_MONTH && grandDone("ferris-wheel", w)) extra += FAIR_RIDERS - 1;
  return extra;
}

/** Is it fair week at the wheel's city now (July, the wheel finished)? Its town's id, or −1. */
export function fairTown(world: Pick<World, "economy">, month: number): number {
  const w = world.economy.grandPlans.get("ferris-wheel");
  return w && month === FAIR_MONTH && grandDone("ferris-wheel", w) ? w.townId : -1;
}

/**
 * The wheel's tickets for months gone by: `WHEEL_COINS` for each month from `paidTo` (the last month paid, counted
 * from the game's start; −1: none yet) to `month`, once the wheel's finished. Returns the coins and the month paid to.
 */
export function wheelTickets(world: Pick<World, "economy">, paidTo: number, month: number): { coins: number; paidTo: number } {
  if (!earned(world, "ferris-wheel")) return { coins: 0, paidTo: month };
  if (paidTo < 0 || month <= paidTo) return { coins: 0, paidTo: Math.max(paidTo, month) };
  return { coins: WHEEL_COINS * (month - paidTo), paidTo: month };
}

/** The Royal Train's cars, given into the toy box when it's finished: its look (one train) and its engine and saloons. */
export const ROYAL_GIFT: readonly [`look:royal` | "car:engine" | "car:passenger", number][] = [
  ["look:royal", 1],
  ["car:engine", 1],
  ["car:passenger", 2],
];

// ---- the town card's row -------------------------------------------------------------------------------------

export type GrandState =
  /** Finished here. */
  | "earned"
  /** Under way here. */
  | "building"
  | "build"
  /** Not enough coins. */
  | "short"
  /** Research is waiting for coins: it comes first. */
  | "saving"
  /** Another project is under way here. */
  | "busy"
  /** Started or finished in another town (one of each per map). */
  | "elsewhere"
  /** This town isn't a City ★ yet. */
  | "level";

export interface GrandTile {
  id: GrandId;
  name: string;
  icon: string;
  reward: string;
  short: string;
  state: GrandState;
  coins: number;
  /** What its button or note says. */
  note: string;
  /** Under way here: the stage's name, its number and goods, and what it's had. */
  stage?: { n: number; of: number; name: string; goods: Bag; got: Bag; riders?: { want: number; got: number } };
}

/** One project's state for town `town` at `level`. */
export function grandState(world: Pick<World, "economy">, p: Progress, town: Town, level: number, g: Grand): GrandState {
  const plan = world.economy.grandPlans.get(g.id);
  if (plan) return plan.townId !== town.id ? "elsewhere" : grandDone(g.id, plan) ? "earned" : "building";
  if (level < GRAND_LEVEL) return "level";
  if (grandUnderWay(world, town.id)) return "busy";
  if (coinsShort(p) > 0) return "saving";
  if (p.coins < g.coins) return "short";
  return "build";
}

const NOTES: Record<GrandState, (g: Grand) => string> = {
  earned: () => "🥇 Earned",
  building: () => "Under way",
  build: (g) => `Build · ${g.coins} 🪙`,
  short: (g) => `Needs ${g.coins} 🪙`,
  saving: () => "Research first",
  busy: () => "After the one being built",
  elsewhere: () => "One per map: in another town",
  level: () => "When it's a City ★",
};

/** The Grand projects row on a town's card: shown on a city's card (level 3 up), every project with its state. */
export function grandRow(world: Pick<World, "economy">, p: Progress, town: Town, level: number): GrandTile[] {
  return GRANDS.map((g) => {
    const state = grandState(world, p, town, level, g);
    const plan = world.economy.grandPlans.get(g.id);
    const tile: GrandTile = { id: g.id, name: g.name, icon: g.icon, reward: g.reward, short: g.short, state, coins: g.coins, note: NOTES[state](g) };
    if (state === "building" && plan) {
      const s = g.stages[plan.stage];
      tile.stage = { n: plan.stage + 1, of: g.stages.length, name: s.name, goods: s.goods, got: { ...plan.got }, ...(s.riders ? { riders: { want: s.riders, got: plan.riders ?? 0 } } : {}) };
    }
    return tile;
  });
}

/** A key that changes whenever the row would say something new (the card draws it again only then). */
export function grandRowKey(world: Pick<World, "economy">, p: Progress, townId: number): number {
  let k = coinsShort(p) > 0 ? 1 : 0;
  for (const g of GRANDS) k = Math.imul(k, 31) + (p.coins >= g.coins ? 1 : 0);
  for (const [id, plan] of world.economy.grandPlans) {
    k = Math.imul(k, 31) + id.length + plan.townId * 7 + plan.stage * 131 + (plan.townId === townId ? 1 : 0) + (plan.riders ?? 0) * 977;
    for (const g in plan.got) k = Math.imul(k, 31) + (plan.got[g as CargoKind] ?? 0);
  }
  return k | 0;
}

// ---- the site --------------------------------------------------------------------------------------------------

/** The union of footprints (each scaled by `scale`), in the model's own frame: the site the project takes as it grows. */
export function unionFootprint(fps: readonly (Footprint | undefined)[], scale = 1): Footprint | undefined {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const f of fps) {
    if (!f) continue;
    x0 = Math.min(x0, (f.cx - f.hw) * scale);
    x1 = Math.max(x1, (f.cx + f.hw) * scale);
    z0 = Math.min(z0, (f.cz - f.hd) * scale);
    z1 = Math.max(z1, (f.cz + f.hd) * scale);
  }
  if (!(x1 > x0)) return undefined;
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2 };
}

/** How far from a city's middle (mm) its project's site may be. */
export const SITE_REACH = 900;

/**
 * Where a project's site can stand by town `town` (its whole footprint `fp`, every stage's: `unionFootprint`): clear,
 * level land in rings round the town's station, nearest first, along or across the map, by the props' own rule
 * (`checkProp`). Null if there's no room.
 */
export function siteSpot(world: Pick<World, "landscape" | "layout" | "props" | "stations">, town: Town, fp: Footprint, footprint: (asset: string) => Footprint | undefined): PropPose | null {
  const ctx = { land: world.landscape, track: new TrackIndex(world.layout), props: world.props, footprint };
  const station = world.layout.getPiece(world.stations.get(town.id) ?? -1)?.pose ?? town.centre;
  const reach = Math.hypot(fp.hw, fp.hd);
  // (Rings 36 mm apart, from just clear of the station out to the reach: a few hundred checks, on a tap.)
  for (let r = reach; r <= SITE_REACH + reach; r += 36) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 72));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = Math.round((station.x + Math.cos(a) * r) / 2) * 2;
      const z = Math.round((station.z + Math.sin(a) * r) / 2) * 2;
      if (Math.hypot(x - town.centre.x, z - town.centre.z) > SITE_REACH + reach) continue;
      for (const heading of [0, Math.PI / 2]) {
        const pose = { x, z, heading };
        const c = checkProp(ctx, fp, pose, "land");
        if (c.kind === "clear") return { ...pose, y: c.y };
      }
    }
  }
  return null;
}

export type StartResult = "started" | "no-room" | "not-now";

/**
 * Tap Build on a project's tile: its site found by the city (`spot`, null: no room, nothing paid), its coins paid, its
 * fenced plot put up there (`putUp`: the prop's id), and its first stage's goods awaited at the city's station.
 */
export function startGrand(world: Pick<World, "economy">, p: Progress, town: Town, level: number, id: GrandId, spot: () => PropPose | null, putUp: (asset: string, pose: PropPose, scale: number) => number): StartResult {
  const g = grandOf(id);
  if (!g || grandState(world, p, town, level, g) !== "build") return "not-now";
  const pose = spot();
  if (!pose) return "no-room";
  p.coins -= g.coins;
  const prop = putUp(siteAsset(g, 0), pose, g.scale);
  world.economy.grandPlans.set(id, { townId: town.id, stage: 0, got: {}, prop });
  world.economy.acceptsChanged();
  return "started";
}

export type GrandEvent = { kind: "stage"; id: GrandId; stage: number } | { kind: "earned"; id: GrandId };

/**
 * Goods came in: every plan whose stage under way has all its goods moves on a stage (its site's model swapped by
 * `swap`); a plan with its last stage done is earned. Returns what happened, for toasts and rewards. Cheap: a few plans.
 */
export function advanceGrands(world: Pick<World, "economy">, swap: (prop: number, asset: string) => void): GrandEvent[] {
  const out: GrandEvent[] = [];
  for (const [id, plan] of world.economy.grandPlans) {
    const g = grandOf(id);
    if (!g) continue;
    while (plan.stage < g.stages.length && stageFilled(id, plan)) {
      plan.stage++;
      plan.got = {};
      delete plan.riders;
      if (plan.prop >= 0) swap(plan.prop, siteAsset(g, plan.stage));
      // (Grand Central: its city's station is the site, its kit swapped by the caller on the "stage" event.)
      out.push(plan.stage >= g.stages.length ? { kind: "earned", id: g.id } : { kind: "stage", id: g.id, stage: plan.stage });
    }
  }
  if (out.length > 0) world.economy.acceptsChanged();
  return out;
}

/**
 * The Exhibition opens: every town's gift toward its growth (`exhibitionGift`), added to what it has had
 * (`Economy.grandGift`), from `status` (each town's as it is now). Returns the towns given to.
 */
export function giveExhibition(world: Pick<World, "economy">, land: Landscape, status: (townId: number) => { level: number; wants: Bag; got: Bag }): number[] {
  const given: number[] = [];
  for (const t of land.towns) {
    const s = status(t.id);
    const gift = exhibitionGift(s.level, s.wants, s.got);
    if (kindsOf(gift).length === 0) continue;
    const bag = world.economy.grandGift.get(t.id) ?? {};
    addInto(bag, gift);
    world.economy.grandGift.set(t.id, bag);
    given.push(t.id);
  }
  return given;
}

// ---- the Journal's Achievements tab ------------------------------------------------------------------------------

/** A town as the Achievements tab sees it: its level, and its goods toward the next. */
export interface TownStanding {
  town: Town;
  level: number;
  /** Its level's name ("City ★"). */
  name: string;
  have: number;
  need: number;
}

/** A town a project could be built in, on its achievement's list ("Build it in"): a tap opens its card there. */
export interface AchievementCity {
  townId: number;
  name: string;
  /** Its level's name, stamped ("City ★"). */
  level: string;
  /** What it can do: "Ready: start it for 400 🪙", "Building the Cathedral: one at a time", "41 of 60 goods to City ★". */
  note: string;
  /** It can start it now (a peg, listed first). */
  ready: boolean;
  /** A City ★ (its card opens on Projects; otherwise on Grow). */
  star: boolean;
}

export interface AchievementView {
  id: GrandId;
  name: string;
  icon: string;
  reward: string;
  /** Stages done, and how many. */
  done: number;
  of: number;
  earned: boolean;
  /** Where it is (its city's name), once started. */
  town: string | null;
  /** What's next: "Stage 2 of 4: The iron hall", "Pick a City ★ to build it in" … */
  line: string;
  /** Not started: the City ★s it could be built in, ready ones first, then the Cities nearly one (with no City ★, the towns nearest to one; at most 4). */
  cities: AchievementCity[];
}

/** How many towns a project's "Build it in" list shows at most. */
export const CITY_ROWS = 4;

/** Each town's row for project `g` (not started): what it can do with it, by `grandState`. */
function cityRows(world: Pick<World, "economy">, p: Progress, g: Grand, towns: readonly TownStanding[]): AchievementCity[] {
  const stars = towns.filter((t) => t.level >= GRAND_LEVEL);
  const rows = stars.map((t): AchievementCity & { order: number } => {
    const state = grandState(world, p, t.town, t.level, g);
    const busy = [...world.economy.grandPlans.entries()].find(([id, plan]) => plan.townId === t.town.id && !grandDone(id, plan));
    const note =
      state === "build"
        ? `Ready: start it for ${g.coins} 🪙`
        : state === "short"
          ? `Needs ${g.coins} 🪙 (you have ${Math.floor(p.coins)})`
          : state === "saving"
            ? "Research first: it's waiting for coins"
            : state === "busy" && busy
              ? `Building the ${grandOf(busy[0])?.name ?? "project"}: one at a time`
              : NOTES[state](g);
    return { townId: t.town.id, name: t.town.name, level: t.name, note, ready: state === "build", star: true, order: state === "build" ? 0 : 1 };
  });
  // Then the Cities nearly City ★; with no City ★ on the map, the towns nearest to one (the biggest, the fullest), so
  // the list is never a dead end.
  const others = towns
    .filter((t) => t.level < GRAND_LEVEL && (t.level >= GRAND_LEVEL - 1 || stars.length === 0))
    .sort((a, b) => b.level - a.level || b.have / Math.max(1, b.need) - a.have / Math.max(1, a.need))
    .map((t) => ({ townId: t.town.id, name: t.town.name, level: t.name, note: `${t.have} of ${t.need} goods to grow`, ready: false, star: false, order: 2 }));
  return [...rows.sort((a, b) => a.order - b.order), ...others].slice(0, CITY_ROWS).map(({ order: _, ...r }) => r);
}

/**
 * The Achievements tab: every grand project, its stages done, and where it's built; one not started lists the towns it
 * could be built in (`towns`: every town's standing, from `statusOf`).
 */
export function achievements(world: Pick<World, "economy" | "landscape">, p: Progress, towns: readonly TownStanding[]): AchievementView[] {
  const anyCityStar = towns.some((t) => t.level >= GRAND_LEVEL);
  return GRANDS.map((g) => {
    const plan = world.economy.grandPlans.get(g.id);
    const town = plan ? (world.landscape.towns.find((t) => t.id === plan.townId)?.name ?? null) : null;
    const done = plan ? Math.min(plan.stage, g.stages.length) : 0;
    const isEarned = done >= g.stages.length;
    const line = isEarned
      ? `Earned in ${town ?? "your railway"}`
      : plan
        ? `Stage ${done + 1} of ${g.stages.length} in ${town}: ${g.stages[done].name.replace(/^The /, "the ")}`
        : anyCityStar
          ? "Pick a City ★ to build it in"
          : "Grow a town into a City ★ to build it";
    const cities = plan ? [] : cityRows(world, p, g, towns);
    return { id: g.id, name: g.name, icon: g.icon, reward: g.reward, done, of: g.stages.length, earned: isEarned, town, line, cities };
  });
}

/** How many grand projects are earned on this map. */
export function earnedCount(world: Pick<World, "economy">): number {
  let n = 0;
  for (const g of GRANDS) if (earned(world, g.id)) n++;
  return n;
}
