import { townStatus } from "./towns";
import { receivedBy } from "./town-life";
import { fixedPieces, type World } from "./world";

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
 * `depKeys`). "pieces": the track (`Layout.piecesVersion`); "towns": what the towns have received; "coins"; "counts";
 * "learned"; "goals" (how many are done).
 */
export type StickerDep = "pieces" | "towns" | "coins" | "counts" | "learned" | "goals";

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
  return w.landscape.towns.map((t) => townStatus(receivedBy(w, t.id)).level);
}

const count = (ctx: StickerContext, key: string) => ctx.counts.get(key) ?? 0;

/** Laid track for this sticker. */
export const TRACK_LAYER = 40;
export const RICH = 1000;
export const BUSY_LOADS = 500;
export const SCHOLAR = 25;
export const SAWDUST = 1000;

export const STICKERS: readonly Sticker[] = [
  { id: "track-layer", title: "Track layer", how: `Lay ${TRACK_LAYER} pieces of track`, icon: "🛤️", theme: "building", deps: ["pieces"], check: (w) => ownTrack(w) >= TRACK_LAYER },
  { id: "all-towns", title: "Every town", how: "Join every town on the map by rail", icon: "🗺️", theme: "building", deps: ["goals"], check: (_w, c) => c.goalsDone("join-all") },
  { id: "all-villages", title: "Villages everywhere", how: "Grow every town into a village or more", icon: "🏡", theme: "towns", deps: ["towns"], check: (w) => townLevels(w).every((l) => l >= 1) },
  { id: "first-city", title: "A city", how: "Grow a town into a city", icon: "🏙️", theme: "towns", deps: ["towns"], check: (w) => townLevels(w).some((l) => l >= 3) },
  { id: "city-star", title: "City ★", how: "Grow a city into a City ★", icon: "🌟", theme: "towns", deps: ["towns"], check: (w) => townLevels(w).some((l) => l >= 4) },
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
  { id: "scholar", title: "Scholar", how: `Learn ${SCHOLAR} blueprints`, icon: "🎓", theme: "economy", deps: ["learned"], check: (_w, c) => c.learned.size >= SCHOLAR },
];

/** The inputs each dep reads, as a key: a check whose deps' keys are all as last time is skipped. */
export function depKeys(w: World, ctx: StickerContext, goalsDone: number): Record<StickerDep, string> {
  // (What the towns have received: a sum over a few towns and kinds, cheaper than their levels.)
  let towns = 0;
  for (const n of w.economy.delivered.values()) towns += n;
  for (const bag of w.economy.deliveredGoods.values()) for (const n of Object.values(bag)) towns += n ?? 0;
  return {
    pieces: String(w.layout.piecesVersion),
    towns: `${w.landscape.towns.length}:${towns}`,
    coins: String(ctx.coins),
    counts: `${count(ctx, "loadsMoved")}:${count(ctx, "planksSawn")}`,
    learned: String(ctx.learned.size),
    goals: String(goalsDone),
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
