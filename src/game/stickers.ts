import { townLinks } from "../roads/graph";
import { statusOf } from "./town-life";
import { MAX_SMILES, townPlaces, townSmiles } from "./places";
import { fixedPieces, type World } from "./world";
import { largestNetwork, running } from "./goals";
import type { DepotRole } from "../economy";
import { TOURIST_COUNT, TOURIST_TIERS } from "./secrets";

/**
 * Stickers: the open-ended layer on top of the goals (spec 2026-10-31-achievements.md). Broad, optional, collected in
 * any order. Earned quietly from the start; the Journal shows them once the core goals are done. Looks only: a sticker
 * gives nothing a goal or research needs.
 */

/** What a sticker's check reads beyond the world: the player's progress, and the goals done. */
export interface StickerContext {
  coins: number;
  /** `Progress.counts` ("loadsMoved", "planksSawn"…). */
  counts: ReadonlyMap<string, number>;
  learned: ReadonlySet<string>;
  goalsDone: (id: string) => boolean;
}

/**
 * What a check depends on: it's run again only when one of these has changed since the last check (see
 * `depKeys`). "pieces": the track (`Layout.piecesVersion`, `jointsVersion`); "towns": what the towns have received; "coins"; "counts";
 * "learned"; "goals" (how many are done); "land": the squares, roads among them (the grid's revision); "sea": goods
 * sold to and bought from harbour boats (the counts "exported" and "imported", which change only when a boat trades);
 * "trains": how many are running.
 */
export type StickerDep = "pieces" | "towns" | "coins" | "counts" | "learned" | "goals" | "land" | "sea" | "trains";

export type StickerTheme = "building" | "trains" | "towns" | "economy";

export interface Sticker {
  readonly id: string;
  readonly title: string;
  /** How to earn it, in a line. */
  readonly how: string;
  readonly icon: string;
  readonly theme: StickerTheme;
  /** Hidden till earned: shown as "???" with `hint` in place of its title and how. */
  readonly hidden?: boolean;
  /** For a hidden one: a nudge that doesn't give it away. */
  readonly hint?: string;
  readonly deps: readonly StickerDep[];
  check(world: World, ctx: StickerContext): boolean;
}

/** Track pieces the player has laid (not stations, depots or ruins). */
export function ownTrack(w: World): number {
  const fixed = fixedPieces(w);
  let n = 0;
  for (const id of w.layout.pieceIds()) if (!fixed.has(id)) n++;
  return n;
}

/** Every town's level (0 a hamlet, 1 a village, 2 a town, 3 a city, 4 City ★…). */
export function townLevels(w: World): number[] {
  return w.landscape.towns.map((t) => statusOf(w, t.id).level);
}

const count = (ctx: StickerContext, key: string) => ctx.counts.get(key) ?? 0;

/** Goods delivered to the towns on this map (the economy's totals, saved with the world), of every kind. */
export function deliveredTotal(w: World): number {
  // (Planks from `delivered`, as `receivedBy` reads them: saves from before goods were counted by kind have only that.)
  let n = 0;
  for (const v of w.economy.delivered.values()) n += v;
  for (const bag of w.economy.deliveredGoods.values()) for (const [k, v] of Object.entries(bag)) if (k !== "planks") n += v ?? 0;
  return n;
}

/** The industries that make goods, every one built by the player's path (the starter map has a forest and a sawmill). */
export const INDUSTRY_KINDS: readonly DepotRole[] = ["forest", "sawmill", "farm", "mill", "quarry", "mine", "foundry", "carpenter", "smithy"];

/** The kinds of industry on the map now (built, restored, or the map's own). */
export function industryKinds(w: World): Set<DepotRole> {
  const kinds = new Set<DepotRole>();
  for (const d of w.economy.allDepots()) if (INDUSTRY_KINDS.includes(d.role)) kinds.add(d.role);
  return kinds;
}

/**
 * Towns joined in one network for the Connected … towns stickers (in place of the goal "Connect every town", gone since
 * 2026-11-04). The start has 4 towns (`STARTER_TOWNS`), so 5 means a town on bought land joined; each plot brings 0–2
 * towns, so 8 is a few plots joined up and 12 a big railway. Every town (`all-towns`) tops them, once the map has 5.
 */
export const TOWN_TIERS = [5, 8, 12] as const;
/** Their icons, from the game's icon font: a station, a bridge, a medal. */
const TIER_ICONS = ["🚉", "🌉", "🥇"] as const;

/** Towns in the largest network of track (0 when no two are joined): once a check for the four stickers that ask. */
export function joinedTowns(w: World): number {
  const key = `${w.layout.piecesVersion}|${w.layout.jointsVersion}|${w.stations.size}`;
  const hit = joinedCache.get(w);
  if (hit?.key === key) return hit.n;
  const n = largestNetwork(w).length;
  joinedCache.set(w, { key, n });
  return n;
}
const joinedCache = new WeakMap<World, { key: string; n: number }>();

/** Laid track for this sticker. */
export const TRACK_LAYER = 40;
export const LONG_LINE = 200;
export const DELIVERED_SOME = 100;
export const DELIVERED_LOTS = 1000;
export const BUSY_TRAINS = 5;
export const RUSH_HOUR = 10;
/** A town's level for City ★★ (3 a city, 4 City ★). */
export const TWO_STARS = 5;
export const RICH = 1000;
export const BUSY_LOADS = 500;
export const SCHOLAR = 25;
export const SAWDUST = 1000;
/** Goods traded with harbour boats, sold and bought, for Sea trader. */
export const SEA_TRADER = 100;

/** Goods sold to harbour boats (`HarbourTrade`, on a "sold" event). */
export const exported = (ctx: StickerContext) => count(ctx, "exported");
/** Goods bought from harbour boats and landed on a quay (`HarbourTrade`, on a "bought" event with goods). */
export const imported = (ctx: StickerContext) => count(ctx, "imported");

/** The Exploring sticker's tiers, by `TOURIST_TIERS`: a ticket, the guide's flag, a suitcase with labels. */
export const EXPLORING = [
  { id: "day-tripper", title: "Day tripper", icon: "🎫" },
  { id: "tour-guide", title: "Tour guide", icon: "🚩" },
  { id: "grand-tourist", title: "Grand tourist", icon: "🧳" },
] as const;

export const STICKERS: readonly Sticker[] = [
  { id: "track-layer", title: "Track layer", how: `Lay ${TRACK_LAYER} pieces of track`, icon: "🛤️", theme: "building", deps: ["pieces"], check: (w) => ownTrack(w) >= TRACK_LAYER },
  { id: "long-line", title: "Long line", how: `Lay ${LONG_LINE} pieces of track`, icon: "🚞", theme: "building", deps: ["pieces"], check: (w) => ownTrack(w) >= LONG_LINE },
  { id: "all-industries", title: "The whole works", how: "Have every kind of industry on the map: forest to smithy", icon: "🏭", theme: "building", deps: ["pieces"], check: (w) => industryKinds(w).size >= INDUSTRY_KINDS.length },
  ...TOWN_TIERS.map(
    (n, i): Sticker => ({ id: `towns-${n}`, title: `Connected ${n} towns`, how: `Join ${n} towns by rail, in one network`, icon: TIER_ICONS[i], theme: "building", deps: ["pieces", "land"], check: (w) => joinedTowns(w) >= n }),
  ),
  {
    id: "all-towns",
    title: "Every town",
    how: `Join every town on the map by rail, once it has ${TOWN_TIERS[0]} or more`,
    icon: "🗺️",
    theme: "building",
    deps: ["pieces", "land"],
    check: (w) => w.landscape.towns.length >= TOWN_TIERS[0] && joinedTowns(w) >= w.landscape.towns.length,
  },
  { id: "road-link", title: "On the road", how: "Join two towns by road", icon: "🛣️", theme: "building", deps: ["land"], check: (w) => [...townLinks(w.landscape).values()].some((l) => l.length > 0) },
  { id: "all-villages", title: "Villages everywhere", how: "Grow every town into a village or more", icon: "🏡", theme: "towns", deps: ["towns"], check: (w) => townLevels(w).every((l) => l >= 1) },
  { id: "first-city", title: "A city", how: "Grow a town into a city", icon: "🏙️", theme: "towns", deps: ["towns"], check: (w) => townLevels(w).some((l) => l >= 3) },
  { id: "city-star", title: "City ★", how: "Grow a city into a City ★", icon: "🌟", theme: "towns", deps: ["towns"], check: (w) => townLevels(w).some((l) => l >= 4) },
  { id: "city-two-stars", title: "City ★★", how: "Grow a City ★ into a City ★★", icon: "✨", theme: "towns", deps: ["towns"], check: (w) => townLevels(w).some((l) => l >= TWO_STARS) },
  { id: "five-trains", title: "Busy timetable", how: `Have ${BUSY_TRAINS} trains running at once`, icon: "🚂", theme: "trains", deps: ["trains"], check: (w) => running(w).length >= BUSY_TRAINS },
  {
    id: "rush-hour",
    title: "Rush hour",
    how: `Have ${RUSH_HOUR} trains running at once`,
    icon: "🚦",
    theme: "trains",
    hidden: true,
    hint: "Five trains is busy. How many more can your railway run at once?",
    deps: ["trains"],
    check: (w) => running(w).length >= RUSH_HOUR,
  },
  {
    id: "two-cities",
    title: "Twin cities",
    how: "Grow two towns into cities",
    icon: "🌆",
    theme: "towns",
    hidden: true,
    hint: "One city is grand. Could there be another?",
    deps: ["towns"],
    check: (w) => townLevels(w).filter((l) => l >= 3).length >= 2,
  },
  { id: "rich", title: "Piggy bank", how: `Have ${RICH.toLocaleString("en")} coins at once`, icon: "🪙", theme: "economy", deps: ["coins"], check: (_w, c) => c.coins >= RICH },
  { id: "delivered-some", title: "Special delivery", how: `Deliver ${DELIVERED_SOME} goods to the towns`, icon: "📬", theme: "economy", deps: ["towns"], check: (w) => deliveredTotal(w) >= DELIVERED_SOME },
  { id: "delivered-lots", title: "Big deliveries", how: `Deliver ${DELIVERED_LOTS.toLocaleString("en")} goods to the towns`, icon: "🎁", theme: "economy", deps: ["towns"], check: (w) => deliveredTotal(w) >= DELIVERED_LOTS },
  {
    id: "ice-cream-day",
    title: "Ice cream day",
    how: "Bring ice cream to a town",
    icon: "🍦",
    theme: "economy",
    hidden: true,
    hint: "Milk and fruit make something sweet. It needs a cold van.",
    deps: ["towns"],
    check: (w) => [...w.economy.deliveredGoods.values()].some((bag) => (bag.icecream ?? 0) > 0),
  },
  // Tech tree 3's ends of a chain: cars by car carrier, a harbour's catch.
  {
    id: "showroom",
    title: "Showroom",
    how: "Bring new cars to a town",
    icon: "🚗",
    theme: "economy",
    hidden: true,
    hint: "Iron and planks could build something with wheels. It rides on a wagon of its own.",
    deps: ["towns"],
    check: (w) => [...w.economy.deliveredGoods.values()].some((bag) => (bag.autos ?? 0) > 0),
  },
  {
    id: "fish-supper",
    title: "Fish supper",
    how: "Bring fish to a town",
    icon: "🐟",
    theme: "economy",
    hidden: true,
    hint: "The boats at your harbour could bring more than trade.",
    deps: ["towns"],
    check: (w) => [...w.economy.deliveredGoods.values()].some((bag) => (bag.fish ?? 0) > 0),
  },
  // The goods chains' ends (2026-11-04): jam and toys shown (two-input chains a child can aim for), chocolate hidden
  // (its cocoa comes by boat: a surprise).
  {
    id: "jam-today",
    title: "Jam today",
    how: "Bring jam to a town",
    icon: "🫙",
    theme: "economy",
    deps: ["towns"],
    check: (w) => [...w.economy.deliveredGoods.values()].some((bag) => (bag.jam ?? 0) > 0),
  },
  {
    id: "sweet-tooth",
    title: "Sweet tooth",
    how: "Bring chocolate to a town",
    icon: "🍫",
    theme: "economy",
    hidden: true,
    hint: "The boats could bring something from far away. With milk, it makes a treat.",
    deps: ["towns"],
    check: (w) => [...w.economy.deliveredGoods.values()].some((bag) => (bag.chocolate ?? 0) > 0),
  },
  {
    id: "toy-box",
    title: "Toy box",
    how: "Bring toys to a town",
    icon: "🧸",
    theme: "economy",
    deps: ["towns"],
    check: (w) => [...w.economy.deliveredGoods.values()].some((bag) => (bag.toys ?? 0) > 0),
  },
  { id: "busy-loads", title: "Busy railway", how: `Move ${BUSY_LOADS} loads`, icon: "📦", theme: "economy", deps: ["counts"], check: (_w, c) => count(c, "loadsMoved") >= BUSY_LOADS },
  {
    id: "sawdust",
    title: "Sawdust!",
    how: `Saw ${SAWDUST.toLocaleString("en")} planks`,
    icon: "🪚",
    theme: "economy",
    hidden: true,
    hint: "Keep the sawmill busy for a long, long time.",
    deps: ["counts"],
    check: (_w, c) => count(c, "planksSawn") >= SAWDUST,
  },
  { id: "harbour-seller", title: "Ahoy, seller!", how: "Sell goods to a boat at a harbour", icon: "⛵", theme: "economy", deps: ["sea"], check: (_w, c) => exported(c) >= 1 },
  { id: "harbour-buyer", title: "Ahoy, buyer!", how: "Buy goods from a boat at a harbour", icon: "⚓", theme: "economy", deps: ["sea"], check: (_w, c) => imported(c) >= 1 },
  {
    id: "sea-trader",
    title: "Sea trader",
    how: `Trade ${SEA_TRADER} goods with harbour boats, sold or bought`,
    icon: "🚢",
    theme: "economy",
    hidden: true,
    hint: "The boats keep coming. Keep them busy.",
    deps: ["sea"],
    check: (_w, c) => exported(c) + imported(c) >= SEA_TRADER,
  },
  { id: "scholar", title: "Scholar", how: `Learn ${SCHOLAR} blueprints`, icon: "🎓", theme: "economy", deps: ["learned"], check: (_w, c) => c.learned.size >= SCHOLAR },
  // A town's places (game/places.ts).
  { id: "happy-town", title: "Happy town", how: `Give a town ${MAX_SMILES} smiles with its places`, icon: "😊", theme: "towns", deps: ["towns"], check: (w) => w.landscape.towns.some((t) => townSmiles(t) >= MAX_SMILES) },
  { id: "day-out", title: "Day out", how: "Take visitors by coach to a town with a leisure place", icon: "🎟️", theme: "trains", deps: ["counts"], check: (_w, c) => count(c, "visitors") > 0 },
  {
    id: "civic-pride",
    title: "Civic pride",
    how: "A town hall, fire station, police station and hospital in one town",
    icon: "🏛️",
    theme: "towns",
    deps: ["towns"],
    check: (w) => w.landscape.towns.some((t) => CIVIC_PRIDE.every((id) => townPlaces(t).has(id))),
  },
  // Exploring: tourist trips to the secrets found (riders off at their halts, all together: src/game/secrets.ts).
  ...TOURIST_TIERS.map(
    (n, i): Sticker => ({
      id: EXPLORING[i].id,
      title: EXPLORING[i].title,
      how: `${n} tourist trips to secrets you've found`,
      icon: EXPLORING[i].icon,
      theme: "trains",
      deps: ["counts"],
      check: (_w, c) => count(c, TOURIST_COUNT) >= n,
    }),
  ),
];

/** Civic pride's four places. */
const CIVIC_PRIDE = ["town-hall", "fire-station", "police", "hospital"];

/** The inputs each dep reads, as a key: a check whose deps' keys are all as last time is skipped. */
export function depKeys(w: World, ctx: StickerContext, goalsDone: number): Record<StickerDep, string> {
  // (What the towns have received: a sum over a few towns and kinds, cheaper than their levels.)
  let towns = 0;
  for (const n of w.economy.delivered.values()) towns += n;
  for (const bag of w.economy.deliveredGoods.values()) for (const n of Object.values(bag)) towns += n ?? 0;
  // (And their places: one put up, or a plain building opened as one.)
  let places = 0;
  for (const t of w.landscape.towns) for (const b of t.buildings) if (b.landmark) places++;
  return {
    // (And the joints: a piece dragged into a line joins it without a piece added, for the Connected … towns.)
    pieces: `${w.layout.piecesVersion}:${w.layout.jointsVersion}`,
    towns: `${w.landscape.towns.length}:${towns}:${places}`,
    coins: String(ctx.coins),
    counts: `${count(ctx, "loadsMoved")}:${count(ctx, "planksSawn")}:${count(ctx, "visitors")}:${count(ctx, TOURIST_COUNT)}`,
    learned: String(ctx.learned.size),
    goals: String(goalsDone),
    land: String(w.landscape.grid.revision),
    sea: `${exported(ctx)}:${imported(ctx)}`,
    trains: String(running(w).length),
  };
}

/**
 * The stickers earned. Checked with the goals (`checkGoals`: about once a second and after changes), never per frame.
 * A sticker is checked only while it isn't earned and only when what it depends on has changed. Earned stays earned.
 */
export class StickerTracker {
  private readonly earned: Set<string>;
  /** The dep keys at the last check (a new world or tracker checks everything once). */
  private last: Partial<Record<StickerDep, string>> = {};
  private lastWorld: World | null = null;

  constructor(earned: Iterable<string> = []) {
    const known = new Set(STICKERS.map((s) => s.id));
    this.earned = new Set([...earned].filter((id) => known.has(id)));
  }

  /**
   * Earn the stickers that hold now; returns those earned by this check, in table order. At most `max` a check (one,
   * when they're toasted, as goals are), the rest wait for the next.
   */
  update(world: World, ctx: StickerContext, goalsDone: number, max = Infinity): Sticker[] {
    if (world !== this.lastWorld) this.last = {};
    this.lastWorld = world;
    const keys = depKeys(world, ctx, goalsDone);
    const changed = new Set<StickerDep>();
    for (const d of Object.keys(keys) as StickerDep[]) if (this.last[d] !== keys[d]) changed.add(d);
    const fresh: Sticker[] = [];
    let held = false;
    for (const s of STICKERS) {
      if (this.earned.has(s.id) || !s.deps.some((d) => changed.has(d))) continue;
      if (!s.check(world, ctx)) continue;
      if (fresh.length >= max) {
        // (Another holds now but waits: check again next time, whatever changes.)
        held = true;
        break;
      }
      this.earned.add(s.id);
      fresh.push(s);
    }
    this.last = held ? {} : keys;
    return fresh;
  }

  has(id: string): boolean {
    return this.earned.has(id);
  }

  get count(): number {
    return this.earned.size;
  }

  get total(): number {
    return STICKERS.length;
  }

  ids(): string[] {
    return STICKERS.filter((s) => this.earned.has(s.id)).map((s) => s.id);
  }
}
