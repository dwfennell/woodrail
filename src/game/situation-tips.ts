import type { ExplainerId } from "../ui/explainer-keys";
import { ROAD_MARGIN, topologyOf } from "../economy/sections";
import { CAR_SPECS, type Train } from "../sim";
import { trainLength } from "../sim/train-cars";
import { connectorRef, getPieceDef, indexOfRef, offersChoice, pathLength, pieceOfRef, type Layout } from "../track";
import { next } from "../routing/graph";
import { trainState } from "./engine-status";
import type { World } from "./world";

/**
 * Situation help (docs/superpowers/specs/2026-11-18-situation-help.md): a 💡 tip when the player is stuck in a way the
 * game can see (trains queuing for a whole stretch a signal could split, and later more), in the feature tips' row
 * under the goals. Not a goal and never a modal: one at a time, never in the tutorial, toasted once a kind a game, and
 * gone for good with Got it.
 *
 * Detectors read what the sim keeps anyway (sections' waits, the stall classifier), each on its own interval of game
 * time, from the goals' check (about once a game second, never per frame, nothing while paused).
 */

/** A situation found on the map: what to say, and where. */
export interface Situation {
  /** The detector's id (its kind): "jam-follow". */
  readonly id: string;
  /** What it's about (a line, a depot), so the same one isn't taken for a new one. */
  readonly key: string;
  /** The row's title: "Trains queuing on the Red line". */
  readonly title: string;
  /** The chip's, short: "Trains queuing". */
  readonly short: string;
  /** What's wrong and the fix, a line or two. */
  readonly text: string;
  /** The toast, one short line. */
  readonly toast: string;
  /** Its "Learn more" sheet, if it has one. */
  readonly more?: ExplainerId;
  /** The words of its ✓ toast when the player's fix clears it. */
  readonly fixed: string;
  /** Where Show where goes: a signal spot (a joint end) and the train it's for. */
  readonly signalAt?: number;
  readonly engine?: number;
  /** A placed signal whose card Show where opens (its block tinted, "Too short for a train to wait here"). */
  readonly markId?: number;
  /** Track pieces Show where frames (a short block, a short loop). */
  readonly pieces?: readonly number[];
}

/** What a detector may ask beyond the world. */
export interface SituationContext {
  /** Blueprints learned (null: Sandbox, everything at hand). */
  learned: ReadonlySet<string> | null;
  /** A depot's name as a stop says it ("the sawmill", "Elder"). */
  nameOf(depotId: number): string;
  /** The game's clock (s), for a detector that times a wait itself. */
  now?: number;
}

export interface Detector {
  readonly id: string;
  /** How often it looks (game s). */
  readonly every: number;
  /** How long it must be found, looked for each time, before it's said (game s). */
  readonly hold: number;
  /**
   * How long a tip showing stays after it was last found (game s): a situation that comes and goes (a queue that
   * forms on each trip) stays said between times, so the player can act on it.
   */
  readonly linger?: number;
  look(w: World, ctx: SituationContext): Situation | null;
}

/** Queuing, a signal helps (detector #1): a line's trains waiting for the whole stretch, going the same way. */
export const JAM_FOLLOW: Detector = {
  id: "jam-follow",
  // (Sections' own hint holds the wait 20 s first, and the queue clears a moment later, so it's looked for each game
  // second, as the follow toast was, and said when first found. Then it stays while trains keep queuing.)
  every: 1,
  hold: 0,
  linger: 120,
  look(w, ctx) {
    // (Signals come with "Signals and routes", whose id is "routes": an old save's "signals" is renamed to it.)
    if (ctx.learned && !ctx.learned.has("routes")) return null;
    const f = w.economy.sections.followWait();
    if (!f) return null;
    // (Keyed on the stall classifier: a train said stuck is another situation, whose fix is not a signal.)
    if (w.economy.stalls.stuckOf(f.engine) || w.economy.stalls.stuckOf(f.lead)) return null;
    const lineId = w.economy.lineIdOf.get(f.engine);
    const line = lineId === undefined ? undefined : w.economy.lines.get(lineId);
    if (!line) return null;
    // (Signals too close together near it: another signal isn't the fix, spacing them is: that tip, `SHORT_BLOCKS`.)
    if (shortNear(w, lineId!, f.engine)) return null;
    const route = w.economy.routeOf(f.engine);
    const next = route && route.stops.length > 0 ? route.stops[route.next % route.stops.length].depotId : -1;
    const to = next >= 0 ? ctx.nameOf(next) : "";
    return {
      id: "jam-follow",
      key: `line:${line.id}`,
      title: `Trains queuing on the ${line.name}`,
      short: "Trains queuing",
      text: `Each train waits until the one ahead ${to ? `reaches ${to}` : "is through"}. A signal halfway lets the next one start sooner.`,
      toast: `${line.name} trains are stuck in a queue`,
      more: "signals",
      fixed: "✓ They follow now",
      signalAt: f.at,
      engine: f.engine,
    };
  },
};

/**
 * A signal's block, or a passing loop's road, too short for a train to wait in clear of the points: no waiting point
 * for it. `markId`: the signal (−1 for a loop); `pieces`: its track; `length`: the block's, or the loop's shorter road.
 */
export interface ShortBlock {
  readonly kind: "signal" | "loop";
  readonly markId: number;
  readonly pieces: readonly number[];
  readonly length: number;
}

/** The shortest loop looked at: an engine alone fits in it (shorter isn't a passing loop at all). */
const LOOP_MIN = CAR_SPECS.engine.length;

const shortCache = new WeakMap<Layout, Map<string, ShortBlock[]>>();

/**
 * The layout's signal blocks and passing loops too short for trains `length` mm long, by sections' own topology (as
 * the signal card's "Too short for a train to wait here" sees it): a placed signal whose waiting point is shorter than
 * the train and its margin, and a loop sections find for an engine but not for this train. Cached per track and
 * signals revision and length (the topology is cached the same way), so a check is a lookup.
 */
export function shortBlocks(layout: Layout, length: number): ShortBlock[] {
  const need = length + ROAD_MARGIN;
  const key = `${layout.revision}|${layout.signalsVersion}|${Math.ceil(need / 16)}`;
  let byKey = shortCache.get(layout);
  if (!byKey) shortCache.set(layout, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const out: ShortBlock[] = [];
  const topo = topologyOf(layout, length);
  const seen = new Set<string>();
  const marked = new Set<number>();
  for (const m of layout.signals()) {
    marked.add(m.at);
    const o = layout.joinedConnector(m.at);
    if (o !== -1) marked.add(o);
  }
  for (const m of layout.signals()) {
    // Its waiting point, as sections made it; or, for one sections made none of (shorter than an engine, or over
    // another signal's track: "a block boundary only"), its stretch back to the last signal or points.
    const slot = topo.slots.find((x) => x.kind === "signal" && !!x.ways?.some((w) => w.mark === m.at));
    const stretch = slot ? { pieces: [...slot.pieces], length: slot.length } : markStretch(layout, m.at, marked, topo.slotOf);
    if (!stretch || stretch.length >= need) continue;
    const k = [...stretch.pieces].sort((a, b) => a - b).join(",");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: "signal", markId: m.id, pieces: stretch.pieces, length: stretch.length });
  }
  // (A loop is one only if both roads fit the train: one found for an engine alone, and not for this train, is short.)
  const small = topologyOf(layout, LOOP_MIN);
  const fits = new Set(topo.loops.map((l) => `${l.a}:${l.b}`));
  for (const l of small.loops) {
    if (fits.has(`${l.a}:${l.b}`)) continue;
    const roads = l.roads.map((r) => small.slots[r]);
    out.push({ kind: "loop", markId: -1, pieces: roads.flatMap((r) => [...r.pieces]), length: Math.min(...roads.map((r) => r.length)) });
  }
  if (byKey.size > 8) byKey.clear();
  byKey.set(key, out);
  return out;
}

/**
 * The plain track a signal at joint end `at` guards trains into, back from it to the next signal or points (as
 * sections' `signalSlots` walks it): its pieces and length, or null if it runs to a line's end (a buffer, track that
 * stops: a line end's, no question of waiting between signals).
 */
function markStretch(layout: Layout, at: number, marked: ReadonlySet<number>, slotOf: ReadonlyMap<number, number>): { pieces: number[]; length: number } | null {
  const pieces: number[] = [];
  let length = 0;
  let id = pieceOfRef(at);
  let exit = indexOfRef(at);
  for (let k = 0; k < 200; k++) {
    const p = layout.getPiece(id);
    if (!p) return null;
    const def = getPieceDef(p.type, p.flipped);
    if (slotOf.has(id) || pieces.includes(id) || offersChoice(def)) return pieces.length > 0 ? { pieces, length } : null;
    const path = def.paths.find((x) => x.to === exit || (x.from === exit && x.to !== null));
    if (!path || path.to === null) return null;
    const entry = path.to === exit ? path.from : path.to;
    pieces.push(id);
    length += pathLength(path.geom);
    const back = connectorRef(id, entry);
    if (marked.has(back)) return { pieces, length };
    const n = next(layout, id, entry);
    if (!n) return null;
    id = n.pieceId;
    exit = n.entry;
  }
  return { pieces, length };
}

/**
 * How long a line's train must have stood waiting (game s) for its short blocks to be said. Short: by close signals a
 * follower edges on a block at a time, a few seconds each, and the block is too short whatever the wait (the wait only
 * says it matters now).
 */
const WAIT_S = 10;
/** When each train began its wait, as the detector last saw it (its looks are a few game seconds apart). */
const waitingSince = new WeakMap<Train, number>();

/** The line's longest train (mm). */
function longestOn(w: World, lineId: number): number {
  let longest = 0;
  for (const t of w.sim.trains()) {
    const engine = t.cars.find((c) => c.kind === "engine");
    if (engine && w.economy.lineIdOf.get(engine.id) === lineId) longest = Math.max(longest, trainLength(t));
  }
  return longest;
}

/** The short block (signal or loop) nearest this train's front, within `NEAR_MM`, for its line's longest train; or null. */
function shortNear(w: World, lineId: number, engineId: number): ShortBlock | null {
  const t = w.sim.findCar(engineId)?.train;
  const front = t?.bogies[0] && w.layout.getPiece(t.bogies[0].pieceId)?.pose;
  if (!front) return null;
  const blocks = shortBlocks(w.layout, longestOn(w, lineId));
  let best: ShortBlock | null = null;
  let bestD = NEAR_MM;
  for (const b of blocks)
    for (const id of b.pieces) {
      const q = w.layout.getPiece(id)?.pose;
      if (!q) continue;
      const d = Math.hypot(q.x - front.x, q.z - front.z);
      if (d < bestD) [best, bestD] = [b, d];
    }
  return best;
}

/** A train's state a waiting one: kept by sections, the router or a signal, or said stuck (but not by the player's hand). */
const WAITING = new Set(["red-signal", "line-wait", "line-wait-for", "needs-loop", "full-wait", "points-wait", "stuck", "held-up"]);
/** How near a waiting train (mm) a short block must be to be its trouble. */
const NEAR_MM = 4000;

/** Signals too close together (detector #4a): a line's train waiting, with a block or loop too short for its trains near it. */
export const SHORT_BLOCKS: Detector = {
  id: "short-blocks",
  // (Its own wait timing, `WAIT_S`, as the follow hint's: then said at once, and kept a while between the waits.)
  every: 2,
  hold: 0,
  linger: 120,
  look(w, ctx) {
    if (ctx.learned && !ctx.learned.has("routes") && !ctx.learned.has("switches")) return null;
    const now = ctx.now ?? 0;
    const e = w.economy;
    let found: Situation | null = null;
    for (const t of w.sim.trains()) {
      const engine = t.cars.find((c) => c.kind === "engine");
      const lineId = engine ? e.lineIdOf.get(engine.id) : undefined;
      const line = lineId === undefined ? undefined : e.lines.get(lineId);
      if (!engine || !line) continue;
      const st = trainState(w.sim, e, t, engine.lever);
      const waiting = WAITING.has(st.kind) && !(st.kind === "red-signal" && st.holding) && !(st.kind === "stuck" && st.why === "parked");
      if (!waiting) {
        waitingSince.delete(t);
        continue;
      }
      const since = waitingSince.get(t) ?? now;
      waitingSince.set(t, since);
      if (found || now - since < WAIT_S) continue;
      const best = shortNear(w, lineId!, engine.id);
      if (!best) continue;
      const mm = Math.round(longestOn(w, lineId!));
      const loop = best.kind === "loop";
      found = {
        id: "short-blocks",
        key: `${best.kind}:${best.markId}:${best.pieces[0]}`,
        title: loop ? "A passing loop too short" : "Signals too close together",
        short: loop ? "Loop too short" : "Signals too close",
        text: loop
          ? `This passing loop is shorter than the ${line.name}'s trains (${mm} mm). Lengthen it so a train fits.`
          : `This stretch between signals is shorter than the ${line.name}'s trains (${mm} mm), so they can't wait there. Space signals at least a train apart.`,
        toast: loop ? `${line.name} trains don't fit the passing loop` : `${line.name} trains have nowhere to wait between these signals`,
        more: "signals",
        fixed: "✓ They have room to wait now",
        markId: best.markId >= 0 ? best.markId : undefined,
        pieces: best.pieces,
        engine: engine.id,
      };
    }
    return found;
  },
};

/** The front piece of the train with this car, or −1. */
function frontPiece(w: World, carId: number): number {
  const t = w.sim.findCar(carId)?.train;
  return t?.bogies[0]?.pieceId ?? -1;
}

/** Each lever-on engine with a line, and what the stall classifier says of it (null: not stuck). */
function* stuckEngines(w: World) {
  for (const t of w.sim.trains()) {
    const engine = t.cars.find((c) => c.kind === "engine");
    if (!engine || engine.lever === 0) continue;
    const why = w.economy.stalls.stuckOf(engine.id);
    yield { t, engine, why, lineId: w.economy.lineIdOf.get(engine.id) };
  }
}

/** A line's name, or "a" train's words for one on none. */
const lineWords = (w: World, lineId: number | undefined): string => {
  const line = lineId === undefined ? undefined : w.economy.lines.get(lineId);
  return line ? `the ${line.name}` : "two lines";
};

/**
 * No passing place (detector #4): trains nose to nose on single track where a passing loop is the fix (the stall
 * classifier's `in-way` with `loop`, `too-many`, or `signals` head on with `loop`), or a train kept waiting on a long single
 * track lines share (sections' `single-track`, `STARVED_S`). Keyed on the classifier: its stalls hold `STUCK_S` first.
 */
export const JAM_LOOP: Detector = {
  id: "jam-loop",
  every: 3,
  hold: 6,
  linger: 60,
  look(w, ctx) {
    for (const { engine, why, lineId } of stuckEngines(w)) {
      if (!why) continue;
      // (Starved on a long single track lines share: the classifier's `in-way`, sections naming the stretch.)
      const single = why.kind === "in-way" ? w.economy.sections.singleTrack(engine.id) : null;
      const headOn = (why.kind === "in-way" && (why.loop || !!single)) || (why.kind === "signals" && !!why.headOn?.loop);
      // (A line over room because a parked train or a pinned loop takes a place: moving it, or unpinning, is the fix.)
      const full = why.kind === "too-many" ? w.economy.sections.fullness(engine.id) : null;
      const tooMany = why.kind === "too-many" && !(full && (full.spare || full.parked || full.pinned));
      if (!headOn && !tooMany) continue;
      const by = "by" in why ? why.by : -1;
      const pieces = [frontPiece(w, engine.id), ...(by >= 0 ? [frontPiece(w, by)] : []), ...(single?.pieces ?? [])].filter((p) => p >= 0);
      // (No switches yet: learning them comes first, as the old head-on toast said.)
      const canLoop = !ctx.learned || ctx.learned.has("switches");
      const fix = canLoop ? "A passing loop in the middle lets them pass." : "Learn Switches, so they can pass on a loop.";
      return {
        id: "jam-loop",
        key: `${tooMany ? "many" : "meet"}:${lineId ?? engine.id}`,
        title: tooMany ? "More trains than passing places" : "Trains can't pass",
        short: tooMany ? "Too many trains" : "Trains can't pass",
        text: tooMany
          ? `${lineWords(w, lineId).replace(/^t/, "T")} has more trains than passing loops. Add a passing loop, or take a train off.`
          : `Trains of ${lineWords(w, lineId)} meet on single track and stop nose to nose. ${fix}`,
        toast: tooMany ? "A line has more trains than passing places" : "Trains are stuck nose to nose",
        more: "loops",
        fixed: "✓ They pass now",
        pieces,
        engine: engine.id,
      };
    }
    return null;
  },
};

/** Too many trains for the signals (detector #2): a ring of waits through signals, not head on. */
export const JAM_SIGNALS: Detector = {
  id: "jam-signals",
  every: 3,
  hold: 6,
  linger: 60,
  look(w) {
    for (const { engine, why, lineId } of stuckEngines(w)) {
      if (why?.kind !== "signals" || why.headOn) continue;
      return {
        id: "jam-signals",
        key: `signals:${lineId ?? engine.id}`,
        title: "Trains stuck at signals",
        short: "Stuck at signals",
        text: "There are more trains than gaps between signals, so each waits for the next. Add a signal, or take a train off.",
        toast: "Trains are stuck at signals",
        more: "signals",
        fixed: "✓ They're moving again",
        pieces: [frontPiece(w, engine.id), frontPiece(w, why.by)].filter((p) => p >= 0),
        engine: engine.id,
      };
    }
    return null;
  },
};

/** A signal inside a loop (detector #3, issue #31): a train stands at it with its tail over the loop's points. */
export const JAM_LOOP_SIGNAL: Detector = {
  id: "jam-loop-signal",
  every: 3,
  hold: 6,
  linger: 60,
  look(w) {
    for (const { engine, why } of stuckEngines(w)) {
      if (why?.kind !== "loop-signal" || !w.layout.getSignal(why.mark)) continue;
      return {
        id: "jam-loop-signal",
        key: `loop-signal:${why.mark}`,
        title: "A signal is in the way",
        short: "Signal in the way",
        text: "A train waits at a signal inside the passing loop, its tail over the points, so nothing gets in. Move the signal to the loop's end.",
        toast: "A signal inside a loop is holding trains up",
        more: "signals",
        fixed: "✓ The loop is clear now",
        markId: why.mark,
        pieces: [frontPiece(w, why.by)].filter((p) => p >= 0),
        engine: engine.id,
      };
    }
    return null;
  },
};

/** The detectors, first first: the one shown is the first found (and held) of them. */
export const DETECTORS: readonly Detector[] = [SHORT_BLOCKS, JAM_LOOP_SIGNAL, JAM_SIGNALS, JAM_LOOP, JAM_FOLLOW];

/** When the tips may speak at all. */
export interface SituationGate {
  /** The game's clock (s). */
  now: number;
  /** Off by ☰ Tips, in the tutorial, or something else is talking (a card or sheet open, a toast just up). */
  quiet: boolean;
}

/** No tip in a game's first minutes, nor soon after another one went (game s). */
export const FIRST_AFTER_S = 120;
export const GAP_S = 120;
/** A tip that clears by itself waits this long before it may come back (game s). */
export const SNOOZE_S = 600;
/**
 * Cleared, and the player looked at it (Show where, Learn more) no more than this long before it was last found:
 * their fix. Then it's done (game s).
 */
export const FIX_WINDOW_S = 60;
/** Shown this many times in a game, it doesn't come back. */
export const MAX_SHOWS = 3;

export interface SituationSave {
  done: string[];
  toasted: string[];
  snoozed: Record<string, number>;
  shows: Record<string, number>;
}

const known = (detectors: readonly Detector[]) => new Set(detectors.map((d) => d.id));

/**
 * Which situation tip shows (one at a time), and what's done (Got it, fixed, or shown too often), snoozed and toasted:
 * saved with the game's session, so another game starts afresh.
 */
export class SituationTracker {
  private readonly done: Set<string>;
  private readonly toasted: Set<string>;
  private readonly snoozed: Map<string, number>;
  private readonly shows: Map<string, number>;
  /** Each detector's last look: when, what it found, and since when it's been found. */
  private readonly looks = new Map<string, { at: number; found: Situation | null; since: number; lastFound: number }>();
  private shown: Situation | null = null;
  /** When the tip showing was looked at (Show where, Learn more), or −∞. */
  private lookedAt = -Infinity;
  /** When the last tip went (game s). */
  private wentAt = -Infinity;

  constructor(
    save: Partial<SituationSave> | null = null,
    private readonly detectors: readonly Detector[] = DETECTORS,
  ) {
    const ids = known(detectors);
    this.done = new Set((save?.done ?? []).filter((id) => ids.has(id)));
    this.toasted = new Set((save?.toasted ?? []).filter((id) => ids.has(id)));
    this.snoozed = new Map(Object.entries(save?.snoozed ?? {}).filter(([id, t]) => ids.has(id) && Number.isFinite(t)));
    this.shows = new Map(Object.entries(save?.shows ?? {}).filter(([id, n]) => ids.has(id) && Number.isFinite(n)));
  }

  /**
   * Look (each detector when it's due), and say what changed: `first` a tip shown for the first time this game (to
   * toast), `fixed` one the player's fix cleared (its ✓ toast), `changed` if the tip shown or what's saved moved on.
   */
  update(w: World, ctx: SituationContext, gate: SituationGate): { first: Situation | null; fixed: Situation | null; changed: boolean } {
    const now = gate.now;
    let changed = false;
    let fixed: Situation | null = null;
    for (const d of this.detectors) {
      if (this.done.has(d.id)) continue;
      const last = this.looks.get(d.id);
      if (last && now - last.at < d.every && now >= last.at) continue;
      const found = d.look(w, ctx);
      const since = found ? (last?.found ? last.since : now) : now;
      this.looks.set(d.id, { at: now, found, since, lastFound: found ? now : (last?.lastFound ?? -Infinity) });
    }
    // The tip showing: still so, or gone (fixed by the player, or by itself).
    if (this.shown) {
      const look = this.looks.get(this.shown.id);
      const linger = this.detectors.find((d) => d.id === this.shown!.id)?.linger ?? 0;
      if (!look?.found && now - (look?.lastFound ?? -Infinity) >= linger) {
        const id = this.shown.id;
        if (this.lookedAt >= (look?.lastFound ?? -Infinity) - FIX_WINDOW_S) {
          this.done.add(id);
          fixed = this.shown;
        } else if ((this.shows.get(id) ?? 0) >= MAX_SHOWS) this.done.add(id);
        else this.snoozed.set(id, now + SNOOZE_S);
        this.shown = null;
        this.wentAt = now;
        this.lookedAt = -Infinity;
        changed = true;
      } else if (look?.found && (look.found.key !== this.shown.key || look.found.text !== this.shown.text)) {
        // (The same kind, about something else now, or its words moved on: kept, with the new.)
        this.shown = look.found;
        changed = true;
      }
    }
    let first: Situation | null = null;
    if (!this.shown && !gate.quiet && now >= FIRST_AFTER_S && now - this.wentAt >= GAP_S) {
      for (const d of this.detectors) {
        if (this.done.has(d.id) || (this.snoozed.get(d.id) ?? -Infinity) > now) continue;
        const look = this.looks.get(d.id);
        if (!look?.found || now - look.since < d.hold) continue;
        this.shown = look.found;
        this.shows.set(d.id, (this.shows.get(d.id) ?? 0) + 1);
        if (!this.toasted.has(d.id)) {
          this.toasted.add(d.id);
          first = look.found;
        }
        changed = true;
        break;
      }
    }
    return { first, fixed, changed };
  }

  /** The tip showing (null: none). */
  current(): Situation | null {
    return this.shown;
  }

  /** The player looked at it (Show where, Learn more): cleared soon after, it was their fix. */
  looked(now: number): void {
    if (this.shown) this.lookedAt = now;
  }

  /** Got it: that kind is done for this game. */
  dismiss(id: string, now: number): void {
    this.done.add(id);
    if (this.shown?.id === id) {
      this.shown = null;
      this.wentAt = now;
    }
  }

  /** Mark a kind done (an older device-wide "told once" flag, carried into this game). */
  markDone(id: string): void {
    if (known(this.detectors).has(id)) this.done.add(id);
  }

  isDone(id: string): boolean {
    return this.done.has(id);
  }

  /** ☰ Tips back on: the kinds hidden with Got it may show again. */
  showAgain(): void {
    this.done.clear();
    this.snoozed.clear();
    this.shows.clear();
  }

  /** Tips off (☰): the one showing goes, not done. */
  hide(): void {
    this.shown = null;
  }

  toJSON(): SituationSave {
    return { done: [...this.done], toasted: [...this.toasted], snoozed: Object.fromEntries(this.snoozed), shows: Object.fromEntries(this.shows) };
  }
}
