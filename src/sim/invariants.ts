/**
 * The train invariants (architecture review §3.1), run against any `Sim` with its `Sections`, `Router` and `Stalls`:
 * the routing harness, the fuzz, sections QA, the play-throughs (an `Economy`) and dev builds of the game (`?dev`, or
 * the dev server; see src/game/dev-checks.ts). A production build runs none of it without `?dev`.
 *
 * - **wrongRoad:** a routed train's front comes onto facing points with a choice and takes a way that isn't its way to
 *   its stop (the way sections granted it, else one whose plan costs no more than the best).
 * - **split:** a train's axles don't join along the track (by pieces and paths: loose joints open a few mm).
 * - **underTrain:** points thrown with a car on or over them (seen at the throw: `watchThrows`).
 * - **pinned:** pinned points thrown, or found moved while pinned.
 * - **restore:** points nobody holds or stands on for a second not at their default (opt-in: the harness).
 * - **deadlock:** a lever-on train standing `maxStill` s with nothing to say why (stuck sanity); a wait (sections',
 *   the router's, a stall's) naming a train that isn't there; sections' safety net letting a wait go.
 * - **lockRun:** a train's front runs onto points locked for other trains only.
 *
 * Checks read state only: running them never changes how a train moves (trajectory hashes identical with them on).
 */
import { SIM_HZ, type Sim, type Train } from "./sim";
import type { Cursor } from "./cursor";
import { getPieceDef, type Layout } from "../track";
import type { Sections } from "../economy/sections";
import type { Stalls } from "../economy/stalls";
import type { Router } from "../routing/router";
import { next, waysFrom } from "../routing/graph";
import { planChoice, ROUTE_COSTS } from "../routing/plan";

export const INVARIANTS = ["wrongRoad", "split", "underTrain", "pinned", "restore", "deadlock", "lockRun"] as const;
export type Invariant = (typeof INVARIANTS)[number];

/** What the checks run on. Read afresh each check (a harness's save round-trip swaps the sim and its services). */
export interface InvariantWorld {
  readonly layout: Layout;
  readonly sim: Sim;
  readonly sections: Sections;
  readonly router: Router;
  readonly stalls: Stalls;
  /** Has this engine a route (the router steers it)? */
  routed(engine: number): boolean;
  /** Where a routed engine is going: its next stop's piece (standing at it, the next different one); −1: none. */
  target(engine: number): number;
  /** A train's net drive toward its front (as `Economy.drive`). */
  drive(train: Train): number;
}

/** A broken invariant, as told to `onBreak`. */
export interface Break {
  invariant: Invariant;
  /** A short description: the train (by its name) or the piece, and what happened. */
  what: string;
  /** Sim tick it was seen. */
  tick: number;
  /** The engine (or first car) of the train it's about, if one. */
  engine?: number;
  pieceId?: number;
}

export interface InvariantOptions {
  /** Check every this many calls to `check` (default 1: every tick). Fronts are followed every call regardless. */
  every?: number;
  /** The longest a lever-on train may stand with nothing to say why (s; default 60). */
  maxStill?: number;
  /** Check restore (points back to their default): the harness's layouts, where nothing else moves points. */
  restore?: boolean;
  /**
   * The trains to check: each a key (per-train state is kept by it) and its engine. Default: every train on the sim,
   * by its routed engine (else its first engine, else its first car), keyed by that car's id.
   */
  trains?: () => Iterable<{ key: number; engine: number }>;
  /** How a train is named in a description (default "train <engine id>"). */
  name?: (key: number, engine: number) => string;
  /**
   * Is this standing, lever-on train's stand said (on its card, or by a hold the host knows)? Default: stalls say it's
   * stuck, sections hold it for room, or a pinned switch is against its way (the harness's rule).
   */
  excused?: (train: Train, engine: number) => boolean;
  /** Told of every break (after it's counted). */
  onBreak?: (b: Break) => void;
  /** The time in ticks (default the sim's): a harness's own clock, which runs on over a save round-trip's new sim. */
  now?: () => number;
}

/** The first few breaks of an invariant are kept in words (the rest only counted). */
const KEEP = 4;
/** A switch nobody holds or stands on this long is at its default. */
const RESTORE_TICKS = SIM_HZ;
/** How long a wait may name a train that isn't there before it's a break (a check's lag: stalls look every 30 ticks). */
const GHOST_TICKS = SIM_HZ;
/** How far (pieces) behind an axle the next one may be. */
const SPLIT_DEPTH = 6;

interface TrainMemo {
  /** wrongRoad: the train id, drive sign and piece its front was last on. */
  roadTrain: number;
  roadSign: number;
  roadPiece: number;
  /** lockRun: the piece its front was last on. */
  lockPiece: number;
  /** Ticks stood still unexplained. */
  still: number;
  /** Since when (tick) a wait of its has named a train that isn't there (−1: none does); said once a wait. */
  ghostFrom: number;
  ghostSaid: boolean;
  /** The tick it was last checked (forgotten when not seen for a while). */
  seen: number;
}

export class Invariants {
  readonly broke: Record<Invariant, { count: number; first: string[] }>;
  /** Fronts come onto a new piece while routed (wrongRoad looks): for the harness's per-piece cost. */
  pieces = 0;
  private readonly every: number;
  private readonly maxStill: number;
  private readonly memo = new Map<number, TrainMemo>();
  private calls = 0;
  private switches: number[] = [];
  private switchesAt = -1;
  private readonly pinnedAt = new Map<number, number>();
  private readonly freeSince = new Map<number, number>();
  private readonly restoreBroken = new Set<number>();
  private net = 0;

  constructor(
    private readonly world: InvariantWorld,
    private readonly opts: InvariantOptions = {},
  ) {
    this.every = Math.max(1, opts.every ?? 1);
    this.maxStill = Math.round((opts.maxStill ?? 60) * SIM_HZ);
    this.broke = Object.fromEntries(INVARIANTS.map((k) => [k, { count: 0, first: [] as string[] }])) as Invariants["broke"];
  }

  /** How many breaks in all. */
  get count(): number {
    let n = 0;
    for (const k of INVARIANTS) n += this.broke[k].count;
    return n;
  }

  /** Each broken invariant's first description (for a test's message): "" when none broke. */
  summary(): string {
    return INVARIANTS.filter((k) => this.broke[k].count > 0)
      .map((k) => `${k} ×${this.broke[k].count}: ${this.broke[k].first.join(" | ")}`)
      .join("; ");
  }

  /**
   * Every switch throw is watched from now on (through `layout.setSwitchState`): never under a train, never a pinned
   * one. `counted` is told of each throw that changes the points. Returns the undo.
   */
  watchThrows(counted?: () => void): () => void {
    const layout = this.world.layout;
    const set = layout.setSwitchState;
    const bound = set.bind(layout);
    layout.setSwitchState = (pieceId: number, state: number) => {
      if (state !== layout.switchState(pieceId)) {
        counted?.();
        if (this.world.sim.pointsHeld(pieceId)) this.break("underTrain", `points ${pieceId} thrown to ${state} under a train`, undefined, pieceId);
        if (layout.isPinned(pieceId)) this.break("pinned", `pinned points ${pieceId} thrown to ${state}`, undefined, pieceId);
      }
      bound(pieceId, state);
    };
    return () => {
      layout.setSwitchState = set;
    };
  }

  /** Points pinned (or unpinned) by the player: from now on they must not move (a harness's `pin`). */
  pinned(pieceId: number, on: boolean): void {
    if (on) this.pinnedAt.set(pieceId, this.world.layout.switchState(pieceId));
    else this.pinnedAt.delete(pieceId);
  }

  /** A train's per-train state forgotten (a harness's reload: its front starts afresh). */
  forget(key: number): void {
    const m = this.memo.get(key);
    if (m) m.roadTrain = -1;
  }

  /** One check: call once a sim tick, after the sim and its services have ticked. */
  check(): void {
    const { sim } = this.world;
    const full = this.calls++ % this.every === 0;
    const tick = this.now();
    for (const { key, engine } of this.opts.trains?.() ?? this.allTrains()) {
      const found = sim.findCar(engine);
      if (!found) continue;
      const t = found.train;
      if (t.derailed) continue;
      let m = this.memo.get(key);
      if (!m) {
        m = { roadTrain: -1, roadSign: 0, roadPiece: -1, lockPiece: -1, still: 0, ghostFrom: -1, ghostSaid: false, seen: tick };
        this.memo.set(key, m);
      }
      m.seen = tick;
      // (Fronts every call: a front coming onto a piece is seen on the tick it does.)
      if (full) this.checkSplit(t, key, engine);
      this.checkLockRun(t, key, engine, m);
      if (this.world.routed(engine)) this.checkRoad(t, key, engine, m);
      if (full) this.checkStill(t, key, engine, m);
    }
    if (!full) return;
    const { sections, layout } = this.world;
    if (sections.released > this.net) {
      this.net = sections.released;
      this.break("deadlock", `sections' safety net let a wait go (${sections.released})`);
    }
    this.refreshSwitches();
    for (const id of this.switches) {
      const pinned = layout.isPinned(id);
      const at = this.pinnedAt.get(id);
      if (!pinned) {
        if (at !== undefined) this.pinnedAt.delete(id);
        continue;
      }
      if (at === undefined) this.pinnedAt.set(id, layout.switchState(id));
      else if (layout.switchState(id) !== at) {
        this.break("pinned", `pinned points ${id} moved to ${layout.switchState(id)}`, undefined, id);
        this.pinnedAt.set(id, layout.switchState(id));
      }
    }
    if (this.opts.restore) this.checkRestore(tick);
    // (Trains gone a while: their memo goes, so a long game doesn't keep every engine it ever had.)
    if (this.memo.size > 64) for (const [k, m] of this.memo) if (tick - m.seen > 10 * SIM_HZ) this.memo.delete(k);
  }

  private *allTrains(): Iterable<{ key: number; engine: number }> {
    const { sim } = this.world;
    for (const id of sim.trainIds()) {
      const t = sim.getTrain(id)!;
      let engine = -1;
      for (const c of t.cars) {
        if (c.kind !== "engine") continue;
        if (this.world.routed(c.id)) {
          engine = c.id;
          break;
        }
        if (engine === -1) engine = c.id;
      }
      if (engine === -1) engine = t.cars[0].id;
      yield { key: engine, engine };
    }
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : this.world.sim.ticks;
  }

  private name(key: number, engine: number): string {
    return this.opts.name ? this.opts.name(key, engine) : `train ${engine}`;
  }

  private break(k: Invariant, what: string, engine?: number, pieceId?: number): void {
    const b = this.broke[k];
    const tick = this.now();
    if (b.count++ < KEEP) b.first.push(`${(tick / SIM_HZ).toFixed(1)} s: ${what}`);
    this.opts.onBreak?.({ invariant: k, what, tick, engine, pieceId });
  }

  private refreshSwitches(): void {
    const layout = this.world.layout;
    if (this.switchesAt === layout.piecesVersion) return;
    this.switchesAt = layout.piecesVersion;
    this.switches = [];
    for (const id of layout.pieceIds()) {
      const p = layout.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      if (def.isSwitch && !def.gated && !def.signal) this.switches.push(id);
    }
    for (const id of this.pinnedAt.keys()) if (!layout.getPiece(id)) this.pinnedAt.delete(id);
  }

  /**
   * Stuck sanity: a lever-on train standing `maxStill` with nothing said of why (`excused`); and every wait it's in
   * names a train that's there.
   */
  private checkStill(t: Train, key: number, engine: number, m: TrainMemo): void {
    const { sim, sections, router, stalls } = this.world;
    const net = this.world.drive(t);
    const stuck = stalls.stuckOf(engine);
    const excused = this.opts.excused ? this.opts.excused(t, engine) : !!stuck || sections.heldForRoom(engine) || router.waitOf(engine)?.kind === "pinned";
    if (net !== 0 && t.speed === 0 && !excused) {
      const was = m.still;
      m.still += this.every;
      if (was < this.maxStill && m.still >= this.maxStill) this.break("deadlock", `${this.name(key, engine)} still for ${this.maxStill / SIM_HZ} s on piece ${t.bogies[0].pieceId}`, engine, t.bogies[0].pieceId);
    } else m.still = 0;
    // (A wait naming a train that isn't there: said once it has lasted `GHOST_TICKS`, once a wait. Stalls look every
    // `CHECK_TICKS`, so theirs may name a train put away since for that long.)
    const wait = sections.waitOf(engine);
    const rw = router.waitOf(engine);
    let ghost: string | null = null;
    let at: number | undefined;
    if (wait && "engine" in wait && !sim.findCar(wait.engine)) ghost = `waits (${wait.kind}) for a train that isn't there`;
    else if (rw?.kind === "points" && !sim.findCar(rw.by)) {
      ghost = `waits at points ${rw.pieceId} for a train that isn't there`;
      at = rw.pieceId;
    } else if (stuck && "by" in stuck && !sim.findCar(stuck.by)) ghost = `said stuck (${stuck.kind}) behind a train that isn't there`;
    if (!ghost) {
      m.ghostFrom = -1;
      m.ghostSaid = false;
      return;
    }
    const now = this.now();
    if (m.ghostFrom < 0) m.ghostFrom = now;
    if (!m.ghostSaid && now - m.ghostFrom >= GHOST_TICKS) {
      m.ghostSaid = true;
      this.break("deadlock", `${this.name(key, engine)} ${ghost}`, engine, at);
    }
  }

  /**
   * Restore: a switch nobody holds or stands on for `RESTORE_TICKS` is at its default. Held: a car on or over it
   * (`pointsHeld`), or a route lock (a train it's set for).
   */
  private checkRestore(tick: number): void {
    const { sim, router, layout } = this.world;
    for (const id of this.switches) {
      if (sim.pointsHeld(id) || router.locked(id)) {
        this.freeSince.delete(id);
        continue;
      }
      const state = layout.switchState(id);
      if (state === router.defaultOf(id)) {
        this.freeSince.delete(id);
        this.restoreBroken.delete(id);
        continue;
      }
      const since = this.freeSince.get(id);
      if (since === undefined) this.freeSince.set(id, tick);
      else if (tick - since >= RESTORE_TICKS && !this.restoreBroken.has(id)) {
        this.restoreBroken.add(id);
        this.break("restore", `points ${id} left at ${state} (default ${router.defaultOf(id)}), no train on them`, undefined, id);
      }
    }
  }

  /**
   * No wrong road: when a routed train's front comes onto facing points with a choice, the way it takes is its way to
   * its stop: the way sections granted it (`steerHint`'s follow), else one whose plan costs no more than the best (the
   * plan search, as the router chooses).
   */
  private checkRoad(t: Train, key: number, engine: number, m: TrainMemo): void {
    const { layout, sections } = this.world;
    const sign = Math.sign(this.world.drive(t));
    if (sign === 0) return;
    const b = sign > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1];
    // (A turned train, or one just set going the other way: its front is somewhere else; start afresh.)
    if (m.roadTrain !== t.id || m.roadSign !== sign) {
      m.roadTrain = t.id;
      m.roadSign = sign;
      m.roadPiece = b.pieceId;
      return;
    }
    if (b.pieceId === m.roadPiece) return;
    m.roadPiece = b.pieceId;
    this.pieces++;
    const piece = layout.getPiece(b.pieceId);
    if (!piece) return;
    const path = getPieceDef(piece.type, piece.flipped).paths[b.pathIndex];
    // (The end it came in by: behind it, the way it's going.)
    const back = sign > 0 ? b.reversed : !b.reversed;
    const entry = back ? path.to : path.from;
    if (entry === null || entry === undefined) return;
    const ways = waysFrom(layout, b.pieceId, entry);
    const target = this.world.target(engine);
    if (ways.length < 2 || target === -1 || b.pieceId === target) return;
    this.facing++;
    const taken = ways.find((w) => w.path === b.pathIndex);
    if (!taken) return;
    const held = sections.steerHint(engine);
    const followed = held ? ways.filter((w) => held.follow(b.pieceId, w.path)) : [];
    let wrong: boolean;
    if (followed.length === 1) wrong = followed[0].option !== taken.option;
    else {
      const costs: number[] = [];
      const best = planChoice(layout, b.pieceId, true, ways, held?.aim ?? target, ROUTE_COSTS, costs);
      if (best === -1 || best === taken.option) return;
      wrong = !(costs[taken.option] <= costs[best]);
    }
    if (wrong) this.break("wrongRoad", `${this.name(key, engine)} took road ${taken.option} at points ${b.pieceId} (${followed.length === 1 ? "not the way granted" : `not its way to ${target}`})`, engine, b.pieceId);
  }

  /** Facing points with a choice come onto by routed trains (wrongRoad's looks). */
  facing = 0;

  /** The train's front came onto points locked for other trains only (once per points, while it's on them). */
  private checkLockRun(t: Train, key: number, engine: number, m: TrainMemo): void {
    const { router } = this.world;
    const net = this.world.drive(t);
    if (net === 0) return;
    const b = net > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1];
    if (b.pieceId === m.lockPiece) return;
    m.lockPiece = b.pieceId;
    const holders = router.holdersOf(b.pieceId);
    if (holders.size === 0 || holders.has(engine)) return;
    // (The other end of the train on them already: it came onto them before they were locked.)
    if (t.bogies.some((x) => x !== b && x.pieceId === b.pieceId)) return;
    // (A crossover's other straight, a road that doesn't meet theirs: both may use them.)
    if (router.apartFrom(b.pieceId, engine)) return;
    this.break("lockRun", `${this.name(key, engine)} ran onto points ${b.pieceId} locked for ${[...holders].join(",")}`, engine, b.pieceId);
  }

  /**
   * No split, by the bogies' pieces and paths (not by axle distance: loose joints open a few mm): each axle's place
   * joins the next one's along the track, behind it, with each on a path through the piece it's on.
   */
  private checkSplit(t: Train, key: number, engine: number): void {
    const { layout } = this.world;
    for (let i = 0; i + 1 < t.bogies.length; i++) {
      if (!joinedBehind(layout, t.bogies[i], t.bogies[i + 1])) {
        this.break("split", `${this.name(key, engine)} split between axles ${i} and ${i + 1} (pieces ${t.bogies[i].pieceId}/${t.bogies[i].pathIndex}, ${t.bogies[i + 1].pieceId}/${t.bogies[i + 1].pathIndex})`, engine, t.bogies[i].pieceId);
        return;
      }
    }
  }
}

/** Is axle `b` on track that joins axle `a`'s, behind it (each pointing toward the train's front), within a few pieces? */
export function joinedBehind(layout: Layout, a: Cursor, b: Cursor): boolean {
  if (a.pieceId === b.pieceId) return a.pathIndex === b.pathIndex && a.reversed === b.reversed;
  const pa = layout.getPiece(a.pieceId);
  const pb = layout.getPiece(b.pieceId);
  if (!pa || !pb) return false;
  const pathA = getPieceDef(pa.type, pa.flipped).paths[a.pathIndex];
  const pathB = getPieceDef(pb.type, pb.flipped).paths[b.pathIndex];
  // (b's front end: where it points; it must be where the way from a comes in.)
  const bFront = b.reversed ? pathB.from : pathB.to;
  const search = (pieceId: number, exit: number | null, depth: number): boolean => {
    if (exit === null || exit < 0) return false;
    const n = next(layout, pieceId, exit);
    if (!n) return false;
    if (n.pieceId === b.pieceId) return n.entry === bFront;
    if (depth >= SPLIT_DEPTH) return false;
    const p = layout.getPiece(n.pieceId)!;
    return getPieceDef(p.type, p.flipped).paths.some((q) => (q.from === n.entry ? search(n.pieceId, q.to, depth + 1) : q.to === n.entry && search(n.pieceId, q.from, depth + 1)));
  };
  return search(a.pieceId, a.reversed ? pathA.to : pathA.from, 1);
}
