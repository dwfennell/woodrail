/**
 * The train invariants (architecture review §3.1), run against any `Sim` with its `Sections`, `Router` and `Stalls`:
 * the routing harness, the fuzz, sections QA, the play-throughs (an `Economy`) and dev builds of the game (`?dev`, or
 * the dev server; see src/game/dev-checks.ts). A production build runs none of it without `?dev`.
 *
 * - **wrongRoad:** a routed train's front comes onto facing points with a choice and takes a way that isn't its way to
 *   its stop (the way sections granted it, else one whose plan costs no more than the best).
 * - **split:** a train's axles don't join along the track (by pieces and paths: loose joints open a few mm).
 * - **underTrain:** points thrown with a car on or over them (seen at the throw: `watchThrows`).
 * - **pinned:** pinned points thrown (but by the player's lever tap: a pin keeps routes off them), or found moved.
 * - **restore:** points nobody holds or stands on for a second not at their default (opt-in: the harness).
 * - **deadlock:** a lever-on train standing `maxStill` s with nothing to say why (stuck sanity); a wait (sections',
 *   the router's, a stall's) naming a train that isn't there; sections' safety net letting a wait go.
 * - **lockRun:** a train's front runs onto points locked for other trains only.
 * - **redRun:** a train's front axle crosses a signal's joint while it's red, unless it was past braking for it when it
 *   turned red (counted in `redLate`, not a break).
 * - **blockOne:** a plain signal's block has two trains in it that came in through its signal (not one set Always green).
 * - **oneOwner:** two trains on one set of points or crossing at once, on paths that meet (routing redesign §4 step 0:
 *   one owner per piece where ways meet; a crossover's two straights don't meet).
 * - **greenHeld:** a lever-on train standing `GREEN_HELD_S` at a signal it faces that shows clear, not busy at a stop
 *   (issue #31: "the signal ahead of it is green"). Said once a stand.
 * - **midTurn:** a train turned round not at the end of its line (`Sim.onTurn`: `turnNow` with track ahead), nor by
 *   the player's Reverse on a ring line (the firm rule: trains turn only at the end of their line).
 * - **heldFree:** a lever-on train standing `HELD_FREE_S` (5 s), not busy at a stop, held although the booking core in
 *   shadow would book it a way on to a waiting point (routing redesign §6 F6: a lost wake, or a hold too big). Opt-in
 *   (`heldFree`). Said once a stand.
 * - **netActed:** a train sections granted a move (and the router holds nothing against) stood `NET_S` held by
 *   another train nose to nose, against its side, or short of points or a crossing it's on (`Sim.heldBy`): the
 *   physical guards caught what the grant let through. Said once a stand.
 *
 * Checks read state only: running them never changes how a train moves (trajectory hashes identical with them on).
 */
import { SIM_HZ, type Sim, type Train, type TurnSeen } from "./sim";
import { CAR_SPECS } from "./cars";
import type { Cursor } from "./cursor";
import { connectorRef, doubleTrack, getPieceDef, pathsFoul, pathExitConnector, pathLength, pieceOfRef, type Layout } from "../track";
import type { Sections } from "../economy/sections";
import type { Stalls } from "../economy/stalls";
import type { Router } from "../routing/router";
import { next, waysFrom } from "../routing/graph";
import { planChoice, planWay, ROUTE_COSTS } from "../routing/plan";
import { ReservationShadow } from "../routing/shadow";

export const INVARIANTS = ["wrongRoad", "split", "underTrain", "pinned", "restore", "deadlock", "lockRun", "redRun", "blockOne", "oneOwner", "greenHeld", "midTurn", "netActed", "heldFree"] as const;

/**
 * The invariants added by the routing redesign's step 0 (docs/superpowers/specs/2026-11-07-routing-redesign.md §4):
 * known to break on some maps and seeds today, each such listed beside its test with why (`KNOWN_NEW` lists), so the
 * gates stay green and the lists shrink as the reservation core lands.
 */
export const NEW_INVARIANTS: readonly Invariant[] = ["oneOwner", "greenHeld", "midTurn", "netActed", "heldFree"];
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
  /** Whose kept ways (stickiness) a routed engine's plan keeps, as the router's `owner` (none: no stickiness allowed). */
  owner?(engine: number): number;
  /** A train's net drive toward its front (as `Economy.drive`). */
  drive(train: Train): number;
  /**
   * Is this standing train busy where it is by its own choice (at a stop: loading, its dwell, spacing; turning back),
   * not held? (`greenHeld`; default: never.)
   */
  busy?(train: Train, engine: number): boolean;
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
  /**
   * Check heldFree (routing redesign §6 F6): the booking core in shadow (`routing/shadow.ts`) run beside the checks.
   * Off by default (it books every train ten times a second); the fuzz and the bug maps turn it on.
   */
  heldFree?: boolean;
}

/** The first few breaks of an invariant are kept in words (the rest only counted). */
const KEEP = 4;
/** A switch nobody holds or stands on this long is at its default. */
const RESTORE_TICKS = SIM_HZ;
/**
 * How long a sections or router wait may name a train that isn't there before it's a break (a check's lag: the router
 * steers every 8 ticks). A stall's may not at all.
 */
const GHOST_TICKS = SIM_HZ;
/** How far (pieces) behind an axle the next one may be. */
const SPLIT_DEPTH = 6;
/** greenHeld: how long (s) a train may stand at a clear signal it faces before it's a break. */
export const GREEN_HELD_S = 5;
/** greenHeld: how far past a mark's stop point (mm, front axle to the joint) a train still stands "at" it. */
const GREEN_NEAR = 30;
/** netActed: how long (s) a granted train may stand held by another train's guards before it's a break. */
export const NET_S = 1;

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
  /** greenHeld: ticks stood at a clear signal (and said, once a stand); netActed: ticks stood held so (and said). */
  green: number;
  greenSaid: boolean;
  netHeld: number;
  netSaid: boolean;
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
  /**
   * Signals (signals spec §10.1): fronts that crossed a red signal's joint having been past braking for it when it
   * turned red (not a break of `redRun`, but counted), and fronts that crossed a joint guarded by a signal at all.
   */
  redLate = 0;
  signalPasses = 0;
  /** Signals: each train's front axle as of the tick before (by train id), and each signal's aspect then (by key). */
  private readonly leadWas = new Map<number, { pieceId: number; pathIndex: number; reversed: boolean }>();
  private aspectsWas = new Map<number, boolean>();
  /** Each signal's aspect as of the last check (for one held or let go between ticks). */
  private aspectsSeen = new Map<number, boolean>();
  /** Trains past braking for a signal when it turned red (`${key}:${trainId}`): crossing it is late, not a run. */
  private readonly excused = new Set<string>();
  /** Per signal (key): the trains that came into its block through it, still on it. */
  private readonly entered = new Map<number, Set<number>>();
  private blocks = new Map<number, Set<number>>();
  private blocksAt = "";
  /** Has `beforeTick` been called since the last check (else the last check's note stands for it)? */
  private noted = false;
  /** midTurn: the sim whose turns are watched (`Sim.onTurn`; again after a save round-trip swaps it), and turns seen. */
  private turnSim: Sim | null = null;
  private readonly turnsSeen: TurnSeen[] = [];
  private detached = false;
  /** Turns round seen, by how (the harness's and the disagreement script's counts). */
  readonly turns = { lineEnd: 0, now: 0, lift: 0, midLine: 0 };

  constructor(
    private readonly world: InvariantWorld,
    private readonly opts: InvariantOptions = {},
  ) {
    this.every = Math.max(1, opts.every ?? 1);
    this.maxStill = Math.round((opts.maxStill ?? 60) * SIM_HZ);
    this.broke = Object.fromEntries(INVARIANTS.map((k) => [k, { count: 0, first: [] as string[] }])) as Invariants["broke"];
  }

  private shadow: ReservationShadow | null = null;

  /** heldFree: the shadow books every `CHECK_TICKS`; each held-free it finds is a break. */
  private checkHeldFree(): void {
    this.shadow ??= new ReservationShadow(this.world, {
      trains: this.opts.trains,
      onDisagree: (d) => {
        if (d.kind !== "held-free") return;
        const engine = this.opts.trains ? undefined : d.key;
        this.break("heldFree", `${d.what}`, engine);
      },
    });
    this.shadow.tick();
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
        // (A lever tap is the player's own throw: a pin keeps routes off the points, not the player.)
        if (layout.isPinned(pieceId) && this.world.router.tapping !== pieceId) this.break("pinned", `pinned points ${pieceId} thrown to ${state}`, undefined, pieceId);
      }
      bound(pieceId, state);
      if (this.world.router.tapping === pieceId && this.pinnedAt.has(pieceId)) this.pinnedAt.set(pieceId, layout.switchState(pieceId));
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

  /**
   * Before a sim tick: each train's front axle and each signal's aspect, for `redRun` and `blockOne`. A host that may
   * change signals between ticks (the harness's scripted holds) calls it; otherwise the last check's note stands for it.
   */
  beforeTick(): void {
    this.noted = true;
    this.noteSignals();
  }

  /** One check: call once a sim tick, after the sim and its services have ticked. */
  check(): void {
    const { sim } = this.world;
    const full = this.calls++ % this.every === 0;
    const tick = this.now();
    const names = new Map<number, { key: number; engine: number }>();
    for (const { key, engine } of this.opts.trains?.() ?? this.allTrains()) {
      const found = sim.findCar(engine);
      if (!found) continue;
      const t = found.train;
      if (t.derailed) continue;
      let m = this.memo.get(key);
      if (!m) {
        m = { roadTrain: -1, roadSign: 0, roadPiece: -1, lockPiece: -1, still: 0, ghostFrom: -1, ghostSaid: false, seen: tick, green: 0, greenSaid: false, netHeld: 0, netSaid: false };
        this.memo.set(key, m);
      }
      m.seen = tick;
      names.set(t.id, { key, engine });
      // (Fronts every call: a front coming onto a piece is seen on the tick it does.)
      if (full) this.checkSplit(t, key, engine);
      this.checkLockRun(t, key, engine, m);
      if (this.world.routed(engine)) this.checkRoad(t, key, engine, m);
      if (full) this.checkStill(t, key, engine, m);
      if (full) this.checkGreen(t, key, engine, m);
      if (full) this.checkNet(t, key, engine, m);
    }
    this.watchTurns();
    if (this.opts.heldFree) this.checkHeldFree();
    // (Signals every call, as fronts: a front crossing a joint is seen on the tick it does.)
    this.checkSignals(names);
    if (!this.noted) this.noteSignals();
    this.noted = false;
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
    this.checkOwners(names);
    // (Trains gone a while: their memo goes, so a long game doesn't keep every engine it ever had.)
    if (this.memo.size > 64) for (const [k, m] of this.memo) if (tick - m.seen > 10 * SIM_HZ) this.memo.delete(k);
  }

  /** Stop watching the sim's turns (a host's `off()`). */
  detach(): void {
    this.detached = true;
    if (this.turnSim && this.turnSim.onTurn === this.onTurnSeen) this.turnSim.onTurn = null;
    this.turnSim = null;
  }

  private readonly onTurnSeen = (e: TurnSeen): void => {
    if (!this.detached) this.turnsSeen.push(e);
  };

  /**
   * midTurn: the sim's turns, watched from the first check (`Sim.onTurn`; again on a new sim), each judged at the next
   * check: at the end of its line, or the player's own (a lift), or a break.
   */
  private watchTurns(): void {
    const sim = this.world.sim;
    if (this.detached) return;
    if (this.turnSim !== sim) {
      if (this.turnSim && this.turnSim.onTurn === this.onTurnSeen) this.turnSim.onTurn = null;
      this.turnSim = sim;
      sim.onTurn = this.onTurnSeen;
    }
    for (const e of this.turnsSeen) {
      // (Turned, it keeps its id: its front as last seen is its old one, at the other end. Not a front crossing a joint.)
      this.leadWas.delete(e.trainId);
      if (e.how === "line-end") this.turns.lineEnd++;
      else if (e.how === "lift") this.turns.lift++;
      else this.turns.now++;
      if (e.how === "now" && !e.atLineEnd) {
        this.turns.midLine++;
        this.break("midTurn", `train ${e.trainId} turned round mid-line on piece ${e.pieceId} (not at a line end)`, undefined, e.pieceId);
      }
    }
    this.turnsSeen.length = 0;
  }

  /**
   * greenHeld: a lever-on train standing at a signal (a mark) it faces, its front axle within its stop point and
   * `GREEN_NEAR` past it, the signal clear, not busy at a stop, for `GREEN_HELD_S`: said once a stand.
   */
  private checkGreen(t: Train, key: number, engine: number, m: TrainMemo): void {
    const { sim, layout } = this.world;
    const net = this.world.drive(t);
    if (t.speed !== 0 || net === 0 || layout.signalCount === 0 || this.world.busy?.(t, engine)) {
      m.green = 0;
      m.greenSaid = false;
      return;
    }
    const at = this.signalFaced(t, net > 0);
    if (at === null || !sim.signalList().find((g) => g.key === at)?.clear) {
      m.green = 0;
      m.greenSaid = false;
      return;
    }
    m.green += this.every;
    if (!m.greenSaid && m.green >= GREEN_HELD_S * SIM_HZ) {
      m.greenSaid = true;
      this.break("greenHeld", `${this.name(key, engine)} stood ${GREEN_HELD_S} s at signal ${at}, which shows clear (piece ${t.bogies[0].pieceId})`, engine, t.bogies[0].pieceId);
    }
  }

  /** The signal (its key, a mark's) a train's leading axle stands at, facing it (within `GREEN_NEAR` of its stop point); or null. */
  private signalFaced(t: Train, forward: boolean): number | null {
    const { layout } = this.world;
    const b = forward ? t.bogies[0] : t.bogies[t.bogies.length - 1];
    const p = layout.getPiece(b.pieceId);
    if (!p) return null;
    const def = getPieceDef(p.type, p.flipped);
    // (Running engine last, its leading axle heads the other way along its path.)
    const reversed = forward ? b.reversed : !b.reversed;
    const exit = pathExitConnector(def, b.pathIndex, reversed);
    if (exit === -1) return null;
    const mark = layout.signalAt(connectorRef(b.pieceId, exit));
    if (!mark) return null;
    const len = pathLength(def.paths[b.pathIndex].geom);
    const toJoint = forward ? len - b.s : b.s;
    const inset = CAR_SPECS[(forward ? t.cars[0] : t.cars[t.cars.length - 1]).kind].bogieInset;
    // (The mark's stop point: the nose 6 mm short of the joint, its axle the bogie's inset further.)
    return toJoint <= 6 + inset + GREEN_NEAR ? -1 - mark.id : null;
  }

  /**
   * netActed: a train with a move granted by sections (the router holding nothing against it) standing `NET_S` held by
   * another train nose to nose, against its side or short of points or a crossing (`Sim.heldBy`, not "follow": following
   * a train going its way is the rule on circuits): said once a stand.
   */
  private checkNet(t: Train, key: number, engine: number, m: TrainMemo): void {
    const { sim, sections, router } = this.world;
    const how = t.speed === 0 ? sim.heldHow(t.id) : null;
    const granted = how !== null && how !== "follow" && how !== "turn" && how !== "signal" && !!sections.stateOf(engine)?.move && router.waitOf(engine) === null;
    if (!granted) {
      m.netHeld = 0;
      m.netSaid = false;
      return;
    }
    m.netHeld += this.every;
    if (!m.netSaid && m.netHeld >= NET_S * SIM_HZ) {
      m.netSaid = true;
      const by = sim.heldBy(t.id);
      this.break("netActed", `${this.name(key, engine)}, its move granted, held ${how} by train ${by} (piece ${t.bogies[0].pieceId})`, engine, t.bogies[0].pieceId);
    }
  }

  /**
   * oneOwner: no two trains on one set of points or crossing at once on paths that meet (share an end, or cross: a
   * diamond's). A crossover's two straights don't meet; a train with no axle on the piece (under a car only) is taken
   * as on every path. Said once per piece and pair while it lasts.
   */
  private checkOwners(names: ReadonlyMap<number, { key: number; engine: number }>): void {
    const { sim, layout } = this.world;
    if (sim.trainCount < 2) {
      this.owners.clear();
      return;
    }
    const on = new Map<number, number[]>();
    for (const { id } of sim.trains()) {
      for (const pieceId of sim.piecesUnder(id)) {
        const p = layout.getPiece(pieceId);
        if (!p) continue;
        const def = getPieceDef(p.type, p.flipped);
        if (def.paths.length < 2 || def.gated || def.signal || doubleTrack(def)) continue;
        let list = on.get(pieceId);
        if (!list) on.set(pieceId, (list = []));
        list.push(id);
      }
    }
    const now = new Set<string>();
    for (const [pieceId, ids] of on) {
      if (ids.length < 2) continue;
      const p = layout.getPiece(pieceId)!;
      const def = getPieceDef(p.type, p.flipped);
      const pathsOf = (id: number): number[] => {
        const t = sim.getTrain(id)!;
        const ps = [...new Set(t.bogies.filter((b) => b.pieceId === pieceId).map((b) => b.pathIndex))];
        return ps.length > 0 ? ps : def.paths.map((_, i) => i);
      };
      // (Paths that foul, as `track/points.ts` has them: a diamond's cross, a switch's meet by its stem; a crossover's
      // straights lie side by side.)
      const meet = (a: number, b: number): boolean => pathsFoul(def, a, b);
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const pa = pathsOf(ids[i]);
          const pb = pathsOf(ids[j]);
          if (!pa.some((a) => pb.some((b) => meet(a, b)))) continue;
          const k = `${pieceId}:${Math.min(ids[i], ids[j])}:${Math.max(ids[i], ids[j])}`;
          now.add(k);
          if (this.owners.has(k)) continue;
          const name = (id: number) => {
            const n = names.get(id);
            return n ? this.name(n.key, n.engine) : `train ${id}`;
          };
          this.break("oneOwner", `${name(ids[i])} and ${name(ids[j])} both on ${def.isSwitch ? "points" : "crossing"} ${pieceId}`, names.get(ids[i])?.engine, pieceId);
        }
    }
    this.owners = now;
  }

  /** oneOwner: the pieces and pairs said, while they last. */
  private owners = new Set<string>();

  /** Before a tick: each train's front axle and each signal's aspect (for `checkSignals`). */
  private noteSignals(): void {
    const { sim } = this.world;
    const list = sim.signalList();
    if (list.length === 0) {
      this.aspectsWas.clear();
      return;
    }
    // (Held or let go since the last check, by a scripted event.)
    this.excuse(list, this.aspectsSeen);
    this.aspectsWas = new Map(list.map((g) => [g.key, g.clear]));
    this.leadWas.clear();
    for (const t of sim.trains()) {
      if (!t.derailed) this.leadWas.set(t.id, { pieceId: t.bogies[0].pieceId, pathIndex: t.bogies[0].pathIndex, reversed: t.bogies[0].reversed });
    }
  }

  /**
   * `redRun`: no train's front axle crosses a signal's joint while it's red, unless it was past braking for it when it
   * turned red (counted in `redLate`). `blockOne`: a plain block never has two trains in it that came in through its
   * signal. (Old signal pieces are read as marks at their far joint, as the sim reads them.) `names`: the checked
   * trains by train id, for the descriptions.
   */
  private checkSignals(names: ReadonlyMap<number, { key: number; engine: number }>): void {
    const { sim, layout } = this.world;
    const list = sim.signalList();
    if (list.length === 0) return;
    const nameOf = (id: number): string => {
      const n = names.get(id);
      return n ? this.name(n.key, n.engine) : `train ${id}`;
    };
    const byExit = new Map<number, (typeof list)[number]>();
    for (const g of list) if (g.exit >= 0) byExit.set(connectorRef(g.pieceId, g.exit), g);
    this.excuse(list, this.aspectsWas);
    this.aspectsSeen = new Map(list.map((g) => [g.key, g.clear]));
    this.refreshBlocks(list.map((g) => g.key));
    // Trains that have left a block are no longer in it.
    for (const [key, trains] of this.entered) {
      const pieces = this.blocks.get(key);
      for (const id of trains) {
        const t = sim.getTrain(id);
        if (!t || t.derailed || !pieces || !t.bogies.some((b) => pieces.has(b.pieceId))) trains.delete(id);
      }
    }
    for (const t of sim.trains()) {
      const id = t.id;
      const was = this.leadWas.get(id);
      if (t.derailed || !was || was.pieceId === t.bogies[0].pieceId) continue;
      const p = layout.getPiece(was.pieceId);
      if (!p) continue;
      const exit = pathExitConnector(getPieceDef(p.type, p.flipped), was.pathIndex, was.reversed);
      const g = exit === -1 ? undefined : byExit.get(connectorRef(was.pieceId, exit));
      // (Only a front that went on over that joint: a train that turned has a new front somewhere else.)
      if (!g || pieceOfRef(layout.joinedConnector(connectorRef(was.pieceId, exit))) !== t.bogies[0].pieceId) continue;
      this.signalPasses++;
      // (Called on: let past at red into a line end behind a line-mate there, to turn behind it: the user's yes, 2026-11-14.)
      const late = this.excused.delete(`${g.key}:${id}`) || sim.calledOn(g.key, id);
      const n = names.get(id);
      if (this.aspectsWas.get(g.key) === false) {
        if (late) this.redLate++;
        else this.break("redRun", `${nameOf(id)} ran past signal ${g.key} at red (piece ${g.pieceId} end ${g.exit})`, n?.engine, g.pieceId);
      }
      // (A path signal's block may hold two trains on ways that don't meet: `blockOne` is for plain blocks. One set Always
      // green lets a second in on purpose: they keep their distance by `followCap`, which `underTrain` checks.)
      if (g.junction || g.forced) continue;
      let inBlock = this.entered.get(g.key);
      if (!inBlock) this.entered.set(g.key, (inBlock = new Set()));
      if (inBlock.size > 0 && !late) this.break("blockOne", `${nameOf(id)} came into signal ${g.key}'s block with ${[...inBlock].map(nameOf).join(",")} in it`, n?.engine, g.pieceId);
      inBlock.add(id);
    }
  }

  /**
   * Signals that turned red since `before`: trains on their approach, heading for their joint, past braking for them
   * (not braking for them) are let off (`excused`). Signals that turned clear let their trains' excuses go.
   */
  private excuse(list: readonly { key: number; pieceId: number; exit: number; clear: boolean; junction: boolean }[], before: ReadonlyMap<number, boolean>): void {
    const { sim, layout } = this.world;
    for (const g of list) {
      const was = before.get(g.key) ?? true;
      if (g.clear) {
        if (!was) for (const e of this.excused) if (e.startsWith(`${g.key}:`)) this.excused.delete(e);
        continue;
      }
      if (!was) continue;
      for (const t of sim.trains()) {
        const id = t.id;
        const b = t.bogies[0];
        const p = layout.getPiece(b.pieceId);
        if (t.derailed || !p || b.pieceId !== g.pieceId) continue;
        if (pathExitConnector(getPieceDef(p.type, p.flipped), b.pathIndex, b.reversed) !== g.exit) continue;
        if (sim.redSignalKeyAhead(id) !== g.key) this.excused.add(`${g.key}:${id}`);
      }
    }
  }

  /** The signals' blocks (their pieces), found again when the track or the marks change. */
  private refreshBlocks(keys: number[]): void {
    const { layout, sim } = this.world;
    const at = `${layout.revision}:${layout.jointsVersion}:${layout.signalsVersion}`;
    if (at === this.blocksAt) return;
    this.blocksAt = at;
    this.blocks = new Map(keys.map((k) => [k, new Set(sim.signalBlock(k))]));
  }

  private *allTrains(): Iterable<{ key: number; engine: number }> {
    const { sim } = this.world;
    for (const t of sim.trains()) {
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
    // (A wait naming a train that isn't there: said once it has lasted `GHOST_TICKS`, once a wait; a stall's at once
    // (stalls drop a train taken off the track at once, though they look only every `CHECK_TICKS`).)
    const wait = sections.waitOf(engine);
    const rw = router.waitOf(engine);
    let ghost: string | null = null;
    let at: number | undefined;
    let grace = GHOST_TICKS;
    if (wait && "engine" in wait && !sim.findCar(wait.engine)) ghost = `waits (${wait.kind}) for a train that isn't there (${wait.engine})`;
    else if (rw?.kind === "points" && !sim.findCar(rw.by)) {
      ghost = `waits at points ${rw.pieceId} for a train that isn't there`;
      at = rw.pieceId;
    } else if (stuck && "by" in stuck && !sim.findCar(stuck.by)) {
      ghost = `said stuck (${stuck.kind}) behind a train that isn't there`;
      grace = 0;
    }
    if (!ghost) {
      m.ghostFrom = -1;
      m.ghostSaid = false;
      return;
    }
    const now = this.now();
    if (m.ghostFrom < 0) m.ghostFrom = now;
    if (!m.ghostSaid && now - m.ghostFrom >= grace) {
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
      let costs: number[] = [];
      // (Round its line's lap where a way goes so, as the router plans it: sections' `lapRule`.)
      const lap = sections.lapRule?.(engine);
      let best = lap ? planChoice(layout, b.pieceId, true, ways, held?.aim ?? target, ROUTE_COSTS, costs, undefined, lap) : -1;
      if (best === -1) {
        costs = [];
        best = planChoice(layout, b.pieceId, true, ways, held?.aim ?? target, ROUTE_COSTS, costs);
      }
      if (best === -1 || best === taken.option) return;
      // (Or the way its line kept, costing nearly the best: stickiness, via points' §3.5.)
      const aim = held?.aim ?? target;
      // (Kept as `planWay` keeps it: costing nearly the best, or no more than when it was taken, its way still there after
      // a track edit made another shorter.)
      const keep = this.world.owner !== undefined ? this.world.router.ways.get(this.world.owner(engine), b.pieceId, entry, aim) : undefined;
      const kept = keep?.way?.option === taken.option && planWay(layout, b.pieceId, entry, ways, aim, undefined, keep) === taken.option;
      wrong = !(costs[taken.option] <= costs[best]) && !kept;
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
