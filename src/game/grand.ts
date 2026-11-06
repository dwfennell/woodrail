import type { CargoKind } from "../economy/cargo";
import { kindsOf, total, type Bag } from "../economy/goods";
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
  /** Its day: the toast when it's done. */
  readonly day: string;
  /** Drawn at this share of its model's size on the map (the models are big: a city's biggest thing). */
  readonly scale: number;
}

/** A town's level a grand project needs: City ★ (0 a hamlet, 1 a village, 2 a town, 3 a city). */
export const GRAND_LEVEL = 4;

/** The Exhibition's reward: a city's next star this share filled (towns below a city grow a whole level). */
export const EXHIBITION_SHARE = 0.25;
/** The Cathedral's reward: every town needs this share fewer of each good to grow. */
export const CATHEDRAL_CUT = 0.1;
/** The Cathedral's pilgrims: people come to its city's stations this many times as often. */
export const PILGRIMS = 1.5;

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
    day: "The Great Exhibition opens! Flags and bunting in every town, and every town grows",
    scale: 0.8,
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
  /** Its site's prop id (−1: none, on a save from before it had one). */
  prop: number;
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
  return !!stage && kindsOf(stage.goods).every((k) => stageLacks(id, plan, k) === 0);
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

/** How much more often people come to town `townId`'s stations, from the projects (the Cathedral's pilgrims): 1, none. */
export function grandRiders(world: Pick<World, "economy">, townId: number): number {
  const c = world.economy.grandPlans.get("cathedral");
  return c && c.townId === townId && grandDone("cathedral", c) ? PILGRIMS : 1;
}

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
  state: GrandState;
  coins: number;
  /** What its button or note says. */
  note: string;
  /** Under way here: the stage's name, its number and goods, and what it's had. */
  stage?: { n: number; of: number; name: string; goods: Bag; got: Bag };
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
  earned: () => "🏆 Earned",
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
    const tile: GrandTile = { id: g.id, name: g.name, icon: g.icon, reward: g.reward, state, coins: g.coins, note: NOTES[state](g) };
    if (state === "building" && plan) {
      const s = g.stages[plan.stage];
      tile.stage = { n: plan.stage + 1, of: g.stages.length, name: s.name, goods: s.goods, got: { ...plan.got } };
    }
    return tile;
  });
}

/** A key that changes whenever the row would say something new (the card draws it again only then). */
export function grandRowKey(world: Pick<World, "economy">, p: Progress, townId: number): number {
  let k = coinsShort(p) > 0 ? 1 : 0;
  for (const g of GRANDS) k = Math.imul(k, 31) + (p.coins >= g.coins ? 1 : 0);
  for (const [id, plan] of world.economy.grandPlans) {
    k = Math.imul(k, 31) + id.length + plan.townId * 7 + plan.stage * 131 + (plan.townId === townId ? 1 : 0);
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
      if (plan.prop >= 0) swap(plan.prop, siteAsset(g, plan.stage));
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
    for (const k of kindsOf(gift)) bag[k] = (bag[k] ?? 0) + gift[k]!;
    world.economy.grandGift.set(t.id, bag);
    given.push(t.id);
  }
  return given;
}

// ---- the Journal's Achievements tab ------------------------------------------------------------------------------

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
  /** What's next: "Stage 2 of 4: The iron hall", "Build it in a City ★" … */
  line: string;
}

/** The Achievements tab: every grand project, its stages done, and where it's built. */
export function achievements(world: Pick<World, "economy" | "landscape">, anyCityStar: boolean): AchievementView[] {
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
          ? "Start it from a City ★'s card"
          : "Grow a town into a City ★ to start it";
    return { id: g.id, name: g.name, icon: g.icon, reward: g.reward, done, of: g.stages.length, earned: isEarned, town, line };
  });
}

/** How many grand projects are earned on this map. */
export function earnedCount(world: Pick<World, "economy">): number {
  let n = 0;
  for (const g of GRANDS) if (earned(world, g.id)) n++;
  return n;
}
