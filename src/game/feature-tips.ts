import type { LandscapeGrid } from "../landscape";
import { TRACK_ROLES, TRACKS_TECH } from "./depot-tracks";
import { guideTrains, type GoalGuide } from "./goals";
import { TELEGRAPH_POLE } from "./lineside";
import type { DepotRole } from "../economy/economy";
import type { World } from "./world";

/**
 * Light onboarding for the systems that came after the core goals (tunnels, sidings, the goods chains, tank wagons, the
 * breakdown crane, the reading room and telegraph, the workshop's keep stepper, Leave now, Reverse on a ring line).
 *
 * Not goals: they don't count on the Goals card, never hold the player up, and go once used (or tapped away). One at a
 * time shows as a 💡 row on the Goals tab (and, with every goal done, folded on the chip), with its own Show me. A
 * blueprint's tip is said once more on its "Learned …" toast; a tip with no blueprint (a moment in play, as a train
 * waiting for a full load) is toasted once, the first time it shows.
 */

/** What a tip may ask beyond the world. */
export interface TipContext {
  learned: ReadonlySet<string>;
  /** Is this core goal done? (A tip may wait for one: the keep stepper till routes.) */
  goalDone(id: string): boolean;
  /** Research waiting in the queue (next and later). */
  queued: number;
  /** A train waiting under a crane for a full load (its engine's car id), or null. Main's once-a-second look. */
  waitingEngine: number | null;
  /** A ring line with a train on it (its id), or null. */
  ringLine: number | null;
}

/** Where a tip's Show me goes: a goal's guide, or the research board, an engine's card, a line's sheet. */
export interface TipGuide extends GoalGuide {
  /** Open the research board (on this blueprint, if given). */
  board?: string | true;
  /** Open this engine's card (a car id). */
  engine?: number;
  /** Open this line's sheet with its ⋯ menu open (Reverse, Copy, Show, Delete there). */
  line?: number;
}

export interface FeatureTip {
  readonly id: string;
  /** The blueprint that brings it (none: always there, it shows when `useful` says). */
  readonly tech?: string;
  /** Its name on the row: "Sidings". */
  readonly title: string;
  /** What to do, a line: "Tap an industry, then Second track". */
  readonly text: string;
  /** Is it worth saying now (beyond its blueprint learned)? Default: yes. */
  useful?(w: World, ctx: TipContext): boolean;
  /** Has the player used it? Then the tip goes for good. */
  used(w: World, ctx: TipContext): boolean;
  guide(w: World, ctx: TipContext): TipGuide;
}

type Point = { x: number; z: number };
const piecePoint = (w: World, id: number): Point => w.layout.getPiece(id)!.pose;

/** The industries on the map of these roles (in the order given). */
function placed(w: World, roles: readonly DepotRole[]) {
  const all = w.economy.allDepots().filter((d) => w.economy.onMap(d) && roles.includes(d.role));
  return all.sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role));
}

/** Any car of this kind on the map. */
const hasCar = (w: World, kind: string) => w.sim.trainIds().some((id) => w.sim.getTrain(id)?.cars.some((c) => c.kind === kind));

/** Any piece whose type passes the test. */
const hasPieceType = (w: World, test: (type: string) => boolean) => {
  for (const id of w.layout.pieceIds()) if (test(w.layout.getPiece(id)!.type)) return true;
  return false;
};

/** An industry's card, framed and marked; else the Industries tab. */
function guideCard(w: World, roles: readonly DepotRole[]): TipGuide {
  const d = placed(w, roles)[0];
  if (!d) return { ...guideTrains(w), tab: "industries", shelf: "Industries" };
  const at = piecePoint(w, d.pieceId);
  return { points: [at], towns: [], marks: [at], card: d.id };
}

/** Hill squares (a level or more up) by grid, kept while the grid is the same. */
const hillCache = new WeakMap<LandscapeGrid, { revision: number; points: Point[] }>();
function hillPoints(grid: LandscapeGrid): Point[] {
  const hit = hillCache.get(grid);
  if (hit && hit.revision === grid.revision) return hit.points;
  const points: Point[] = [];
  grid.forEachCell((i, col, row) => {
    if (grid.height[i] > 0) points.push({ x: grid.centreX(col), z: grid.centreZ(row) });
  });
  hillCache.set(grid, { revision: grid.revision, points });
  return points;
}

/** The hill square nearest the player's track (or trains), with that bit of track, for Tunnels' Show me. */
function guideHill(w: World): TipGuide {
  const base: TipGuide = { ...guideTrains(w, "track", "Straight") };
  const hills = hillPoints(w.landscape.grid);
  if (hills.length === 0 || base.points.length === 0) return base;
  let best: [Point, Point] | null = null;
  let d = Infinity;
  // (Thinned: a long railway against every hill square is a lot of pairs for a tap.)
  const step = Math.max(1, Math.ceil(base.points.length / 60));
  for (let i = 0; i < base.points.length; i += step)
    for (const h of hills) {
      const e = Math.hypot(h.x - base.points[i].x, h.z - base.points[i].z);
      if (e < d) [best, d] = [[h, base.points[i]], e];
    }
  return best ? { ...base, points: best, marks: [best[0]] } : base;
}

/** A goods chain's maker: placed, the tip goes. */
const chain = (id: string, tech: string, title: string, role: DepotRole, text: string): FeatureTip => ({
  id,
  tech,
  title,
  text,
  used: (w) => placed(w, [role]).length > 0,
  guide: (w) => ({ ...guideTrains(w), tab: "industries", shelf: "Industries" }),
});

export const SIDINGS_TIP = "Tap an industry, then Second track: the next train waits beside it";
export const TUNNELS_TIP = "Lay a Long straight up to a hill's side, or Draw across a hill: the line goes under";
export const LEAVE_NOW_TIP = "A train is waiting for a full load: tap its engine, then Leave now to go with what it has";
export const KEEPS_TIP = "Tap your workshop: − and + set how many planks it keeps while it shares with towns";
export const RING_TIP = "A ring line: Reverse, in the line's ⋯ menu, sends its trains the other way round";

export const FEATURE_TIPS: readonly FeatureTip[] = [
  {
    id: "sidings",
    tech: TRACKS_TECH,
    title: "Sidings",
    text: SIDINGS_TIP,
    useful: (w) => placed(w, [...TRACK_ROLES]).length > 0,
    used: (w) => w.economy.allDepots().some((d) => w.economy.trackCount(d.id) > 1),
    // The forest first (its trains queue for logs), then the sawmill, then any.
    guide: (w) => guideCard(w, ["forest", "sawmill", ...[...TRACK_ROLES].filter((r) => r !== "forest" && r !== "sawmill" && r !== "workshop")]),
  },
  {
    id: "tunnels",
    tech: "tunnels",
    title: "Tunnels",
    text: TUNNELS_TIP,
    used: (w) => hasPieceType(w, (t) => t.startsWith("tunnel-mouth")),
    guide: guideHill,
  },
  {
    id: "tankers",
    tech: "tankers",
    title: "Tank wagons",
    text: "Place an oil well or water pump (Industries tab), then couple tank wagons to carry it to towns",
    used: (w) => hasCar(w, "oiltank"),
    guide: (w) => (placed(w, ["oilwell", "waterpump"]).length > 0 ? guideTrains(w, "trains", "Wagons") : { ...guideTrains(w), tab: "industries", shelf: "Industries" }),
  },
  {
    id: "breakdown",
    tech: "breakdown",
    title: "Breakdown crane",
    text: "Put the breakdown crane on your track: it drives out to a derailed train by itself",
    used: (w) => hasCar(w, "crane"),
    guide: (w) => guideTrains(w, "trains", "Wagons"),
  },
  chain("jam", "jam", "Jam kitchen", "jamworks", "Place a Jam kitchen (Industries tab) and bring it fruit and sugar"),
  chain("chocolate", "chocolate", "Chocolate factory", "chocworks", "Place a Chocolate factory: boats bring cocoa to your harbours, and it needs milk too"),
  chain("toys", "toys", "Toy workshop", "toyworks", "Place a Toy workshop (Industries tab) and bring it planks and paint"),
  {
    id: "reading-room",
    tech: "reading-room",
    title: "Reading room",
    // (The blueprint's own `how`: the Learned toast says it once.)
    text: "Queue two researches: schools collect for the second once the first one's goods are in",
    used: (_w, ctx) => ctx.queued > 0,
    guide: () => ({ points: [], towns: [], marks: [], board: true }),
  },
  {
    id: "telegraph",
    tech: "telegraph",
    title: "Telegraph",
    text: "Put telegraph poles in a chain from a signal box to far points, then tap the box",
    used: (w) => {
      for (const p of w.props.all()) if (p.asset === TELEGRAPH_POLE) return true;
      return false;
    },
    guide: (w) => ({ ...guideTrains(w), tab: "industries", shelf: "Lineside" }),
  },
  {
    // The workshop's keep stepper: worth saying once trains run routes past it (before, the tutorial's say is enough).
    id: "keeps",
    title: "Workshop keeps",
    text: KEEPS_TIP,
    useful: (w, ctx) => ctx.goalDone("give-route") && placed(w, ["workshop"]).some((d) => !d.takesAll),
    used: (w) => placed(w, ["workshop"]).some((d) => d.keeps.some((k) => k !== null)),
    guide: (w) => guideCard(w, ["workshop"]),
  },
  {
    // Leave now, on the engine card: the moment is a train standing under a crane for a full load.
    id: "leave-now",
    title: "Leave now",
    text: LEAVE_NOW_TIP,
    useful: (_w, ctx) => ctx.waitingEngine !== null,
    // (Used: main marks it when Leave now is tapped.)
    used: () => false,
    guide: (w, ctx) => {
      const found = ctx.waitingEngine === null ? undefined : w.sim.findCar(ctx.waitingEngine);
      const b = found?.train.bogies[0];
      if (!found || !b) return guideTrains(w);
      const at = piecePoint(w, b.pieceId);
      return { points: [at], towns: [], marks: [at], engine: ctx.waitingEngine! };
    },
  },
  {
    // Reverse on a ring line turns its trains round (not just its stops).
    id: "ring-reverse",
    title: "Ring lines",
    text: RING_TIP,
    useful: (_w, ctx) => ctx.ringLine !== null,
    // (Used: main marks it when Reverse is tapped on a ring.)
    used: () => false,
    guide: (_w, ctx) => ({ points: [], towns: [], marks: [], line: ctx.ringLine ?? undefined }),
  },
];

/** The tip for a blueprint, if it has one. */
export const tipFor = (tech: string): FeatureTip | undefined => FEATURE_TIPS.find((t) => t.tech === tech);

/**
 * Which tip shows, and which are done (used or tapped away: saved, so they don't come back). Checked with the goals
 * (once a second, or on a change), never per frame; the tips' own checks run only for those learned and not done.
 */
export class TipTracker {
  private readonly done: Set<string>;
  /** Tips with no blueprint that have shown (each is toasted once, the first time). */
  private readonly shown: Set<string>;
  private currentTip: FeatureTip | null = null;

  constructor(done: Iterable<string> = [], shown: Iterable<string> = []) {
    const known = new Set(FEATURE_TIPS.map((t) => t.id));
    this.done = new Set([...done].filter((id) => known.has(id)));
    this.shown = new Set([...shown].filter((id) => known.has(id)));
  }

  /** Is this tip open to show (its blueprint learned, not done)? */
  private open(t: FeatureTip, ctx: TipContext): boolean {
    return !this.done.has(t.id) && (!t.tech || ctx.learned.has(t.tech));
  }

  /**
   * Check the tips: those used are done; the first left that's useful now shows. Returns a tip with no blueprint that
   * shows for the first time (to toast once), else null. `changed` says whether done or the one shown moved on.
   */
  update(w: World, ctx: TipContext): { first: FeatureTip | null; changed: boolean } {
    let changed = false;
    let now: FeatureTip | null = null;
    for (const t of FEATURE_TIPS) {
      if (!this.open(t, ctx)) continue;
      if (t.used(w, ctx)) {
        this.done.add(t.id);
        changed = true;
        continue;
      }
      if (!now && (!t.useful || t.useful(w, ctx))) now = t;
    }
    if (now !== this.currentTip) changed = true;
    this.currentTip = now;
    let first: FeatureTip | null = null;
    if (now && !now.tech && !this.shown.has(now.id)) {
      this.shown.add(now.id);
      first = now;
      changed = true;
    }
    return { first, changed };
  }

  /** The tip showing now (null: none). */
  current(): FeatureTip | null {
    return this.currentTip;
  }

  /** The player used it (Leave now tapped, Reverse on a ring) or tapped it away: it goes for good. */
  finish(id: string): void {
    this.done.add(id);
    if (this.currentTip?.id === id) this.currentTip = null;
  }

  isDone(id: string): boolean {
    return this.done.has(id);
  }

  /** To save: the tips done, and those toasted. */
  toJSON(): { done: string[]; shown: string[] } {
    return { done: [...this.done], shown: [...this.shown] };
  }
}
