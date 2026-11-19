/**
 * The dispatcher's grant/hold model in shadow (dispatcher spec §8 step 1, the second half;
 * docs/superpowers/specs/2026-11-18-dispatcher.md): beside today's rules, deciding but never acting. At each waiting
 * point a train stands at, the per-stretch search (`stretch.ts`) says whether the dispatcher would let it go now
 * (grant) or hold it, and where that differs from what today's rules do, it's counted by kind (`DKIND`):
 *
 * - **grant-held:** the dispatcher would grant, but today the train stands on `HELD_S` (not busy at a stop). By what
 *   holds it today (its card's kind).
 * - **hold-granted:** today's rules let a standing train go, but the dispatcher's last decision held it: `blocked` (its
 *   next move runs onto a piece a standing train is on, as the model sees it), `follow` (the train in its way was moving
 *   off: today follows close behind within a piece, the model a whole piece back; granularity, not a danger), or
 *   `order` (its move is free, but it costs the most trains delivering: another goes first).
 * - **reroute:** the dispatcher would grant it its move by a loop's other road, not its booked one.
 * - **reroute-stuck:** no order keeps its stretch going, but its detour does (§2.2 step 4: another way to its next
 *   stop, off the track the trains in its way stand on, however far round): it would be sent round.
 * - **fair-turn:** held `FAIR_TURNS` decisions in a row with its move free (another went first each time), it's granted
 *   anyway, if that costs at most one other train's delivery and leaves some delivering (fair turns, §2.2, §6).
 * - **backup:** no order keeps the stretch going; one with a back-up does (whose).
 * - **no-order:** a jam today (stuck `JAM_S`) where the dispatcher finds no order either: expected (the layout).
 * - **order-found:** a jam today where the dispatcher finds an order that keeps every train in the stretch delivering
 *   (with a detour: `order-found-detour`; with a back-up: `order-found-backup`): the payoff.
 *
 * Event-driven, as the dispatcher would be (§5): a decision is made only when something it reads changed (a train came
 * onto another piece, stopped or started, reached a stop or left it, its lever moved), and then only for trains standing
 * waiting. Nothing changed: nothing done. Each train's booked way is built once and moved along (`relocate`), rebuilt
 * only when its route moves on or it leaves its way.
 *
 * Test and script only: nothing in the game imports it.
 */
import type { Layout } from "../track";
import { SIM_HZ, type Sim, type Train } from "../sim";
import { FAIR_TURNS, REROUTE_AFTER_S, whyBlocked, withDetours, statsLast, blockerOf, bodyOf, buildTrain, DISPATCH_STATES, judgeStretch, relocate, search, snapsOf, stretchOf, type DTrain, type RouteView, type Snap } from "./stretch";

export const DKINDS = ["grant-held", "hold-granted:blocked", "hold-granted:follow", "hold-granted:order", "reroute", "reroute-stuck", "fair-turn", "backup", "no-order", "order-found", "order-found-detour", "order-found-backup"] as const;
export type DKind = (typeof DKINDS)[number];

/** How often (ticks) it looks for events: sections' asks' rate (10 a second). */
const LOOK_TICKS = 12;
/** A train standing this long (s), granted, is a grant-held. */
export const HELD_S = 5;
/** A train stuck (today's stalls) this long (s) is a jam. */
export const JAM_S = 30;

export interface DispatchWorld {
  readonly layout: Layout;
  readonly sim: Sim;
  route: RouteView;
  /** Busy where it stands by its own choice (at a stop, turning back): not waiting. */
  busy(train: Train, engine: number): boolean;
  /** Today's stall detector says it's stuck. */
  stuck(engine: number): boolean;
  /** What holds it today, in a word (its card's kind). */
  why?(train: Train, engine: number): string;
}

type Decision = "grant" | "hold-blocked" | "hold-order";

interface Memo {
  sig: string;
  /** Standing waiting since (tick; −1: not standing). */
  stood: number;
  decision: Decision | null;
  /** Decisions in a row it was held with its move free (another going first). */
  passed: number;
  /** Held, blocked: the train in its way was moving then; and why it can't close up behind it. */
  behindMoving: boolean;
  blockWhy?: string;
  said: Set<DKind>;
  stuckSince: number;
  jamSaid: boolean;
}

export class DispatchShadow {
  readonly counts: Record<DKind, number> = Object.fromEntries(DKINDS.map((k) => [k, 0])) as Record<DKind, number>;
  readonly first: Record<DKind, string[]> = Object.fromEntries(DKINDS.map((k) => [k, [] as string[]])) as Record<DKind, string[]>;
  /** grant-held by what held the train today. */
  readonly heldBy = new Map<string, number>();
  /** Departures today that matched the dispatcher's grant, and stands it agreed to hold. */
  agreeGo = 0;
  agreeHold = 0;
  /** Events seen (a look that found a change), decisions made, and each decision's cost (ms). */
  events = 0;
  decisions = 0;
  readonly decisionMs: number[] = [];
  readonly decisionStates: number[] = [];
  readonly plainStates: number[] = [];
  readonly stretchSizes: number[] = [];
  capped = 0;
  /** Booked ways built (each a few plans) and moved along, and their cost (ms). */
  builds = 0;
  relocations = 0;
  buildMs = 0;
  private readonly memo = new Map<number, Memo>();
  private readonly ways = new Map<number, { sig: string; t: DTrain }>();

  /**
   * With `probe`: each decision also searched the hardest way (back-ups always, `DISPATCH_STATES`), timed apart, for
   * the cost of a decision that runs to the cap (§5's budget).
   */
  readonly probeMs: number[] = [];
  readonly probeStates: number[] = [];
  probeCapped = 0;
  readonly probeWarm: [number, number][] = [];
  /** hold-granted:blocked and follow, by why the model couldn't close it up (diagnostic). */
  readonly blockWhy = new Map<string, number>();
  /** Time spent planning detours (ms), inside decisions. */
  detourMs = 0;

  constructor(
    private readonly world: DispatchWorld,
    private readonly probe = false,
  ) {}

  /** Call after each sim tick. */
  tick(): void {
    const { sim } = this.world;
    if (sim.ticks % LOOK_TICKS) return;
    // (Signatures: what the dispatcher reads. Unchanged everywhere: no event, nothing to do.)
    let changed = false;
    const live = new Set<number>();
    const trains = [...sim.trains()].filter((t) => !t.derailed);
    for (const t of trains) {
      const engine = t.cars.find((c) => c.kind === "engine");
      const key = (engine ?? t.cars[0]).id;
      live.add(key);
      const r = engine ? this.world.route(engine.id) : null;
      const front = (t.speed >= 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1]).pieceId;
      const tail = t.bogies[t.bogies.length - 1].pieceId;
      const sig = `${front}.${tail}.${t.speed > 0 ? 1 : 0}.${r ? `${r.next}.${r.at ? 1 : 0}` : "-"}.${engine?.lever ?? 0}`;
      let m = this.memo.get(key);
      if (!m) this.memo.set(key, (m = { sig: "", stood: -1, decision: null, passed: 0, behindMoving: false, said: new Set(), stuckSince: -1, jamSaid: false }));
      if (m.sig !== sig) {
        m.sig = sig;
        changed = true;
      }
    }
    for (const k of [...this.memo.keys()])
      if (!live.has(k)) {
        this.memo.delete(k);
        this.ways.delete(k);
        changed = true;
      }
    // Who stands waiting, and who has just gone (today's rules let it) since the last look.
    const standing: number[] = [];
    const departed: number[] = [];
    const byKey = new Map<number, Train>();
    for (const t of trains) {
      const engine = t.cars.find((c) => c.kind === "engine");
      if (!engine) continue;
      byKey.set(engine.id, t);
      const m = this.memo.get(engine.id)!;
      const r = this.world.route(engine.id);
      const waiting = !!r && engine.lever !== 0 && t.speed === 0 && t.turnback < 0 && !this.world.busy(t, engine.id);
      if (waiting) {
        if (m.stood < 0) {
          m.stood = sim.ticks;
          m.said.clear();
          m.decision = null;
        }
        standing.push(engine.id);
      } else if (m.stood >= 0 && t.speed > 0) departed.push(engine.id);
      else if (m.stood >= 0) {
        m.stood = -1;
        m.decision = null;
      }
    }
    // The event: each standing waiter decided afresh, longest waiter first; and each that has just gone, from where things
    // stand now (it has moved less than a look's worth), so it's compared with what the dispatcher would say at the moment
    // its way cleared, not before.
    if (changed && standing.length + departed.length > 0) {
      this.events++;
      const snaps = this.snaps();
      const ts = this.trainsOf(snaps);
      const asking = [...departed, ...standing].sort((a, b) => this.memo.get(a)!.stood - this.memo.get(b)!.stood || a - b);
      const moving = new Set(snaps.filter((x) => x.speed > 0 && !departed.includes(x.key)).map((x) => x.key));
      for (const e of asking) this.decide(ts, e, moving, snaps);
    }
    for (const e of departed) {
      const m = this.memo.get(e)!;
      if (m.decision === "hold-blocked") this.blockWhy.set(m.blockWhy ?? "?", (this.blockWhy.get(m.blockWhy ?? "?") ?? 0) + 1);
      if (m.decision === "hold-blocked" && m.behindMoving) this.say("hold-granted:follow", m, `train ${e} went close behind a train moving off; the dispatcher held it a piece back`);
      else if (m.decision === "hold-blocked") this.say("hold-granted:blocked", m, `train ${e} went; the dispatcher held it (its move's way is taken by a standing train)`);
      else if (m.decision === "hold-order") this.say("hold-granted:order", m, `train ${e} went; the dispatcher held it (another goes first)`);
      else if (m.decision === "grant") this.agreeGo++;
      m.stood = -1;
      m.decision = null;
      m.passed = 0;
    }
    for (const e of standing) {
      const m = this.memo.get(e)!;
      if (m.decision === "grant" && sim.ticks - m.stood >= HELD_S * SIM_HZ && !m.said.has("grant-held")) {
        const why = this.world.why?.(byKey.get(e)!, e) ?? "standing";
        this.heldBy.set(why, (this.heldBy.get(why) ?? 0) + 1);
        this.say("grant-held", m, `train ${e} stood ${HELD_S} s (${why}); the dispatcher grants it`);
      }
    }
    // Jams, today's.
    for (const t of trains) {
      const engine = t.cars.find((c) => c.kind === "engine");
      if (!engine) continue;
      const m = this.memo.get(engine.id)!;
      if (this.world.stuck(engine.id)) {
        if (m.stuckSince < 0) m.stuckSince = sim.ticks;
        if (!m.jamSaid && sim.ticks - m.stuckSince >= JAM_S * SIM_HZ) {
          m.jamSaid = true;
          const j = judgeStretch(this.world.layout, this.snaps(), engine.id);
          if (j) {
            const kind: DKind = j.plain >= j.of ? "order-found" : j.value >= j.of ? "order-found-detour" : j.backUp && j.backUp.value >= j.of ? "order-found-backup" : "no-order";
            this.say(kind, m, `train ${engine.id} stuck ${JAM_S} s: ${j.value}/${j.of} of its stretch keep delivering${j.backUp ? `, ${j.backUp.value} with a back-up` : ""}${j.capped ? " (capped)" : ""}`);
          }
        }
      } else {
        m.stuckSince = -1;
        m.jamSaid = false;
      }
    }
  }

  private snaps(): Snap[] {
    return snapsOf(this.world.layout, this.world.sim, this.world.route);
  }

  /** Each train's booked way, moved along from the last, or built afresh. */
  private trainsOf(snaps: Snap[]): DTrain[] {
    const t0 = performance.now();
    const out = snaps.map((s) => {
      const sig = `${s.stops?.join(",") ?? "-"}.${s.next}.${s.at ? 1 : 0}.${s.lever ? 1 : 0}`;
      const had = this.ways.get(s.key);
      if (had && had.sig === sig) {
        const moved = relocate(had.t, bodyOf(this.world.layout, s));
        if (moved) {
          this.relocations++;
          had.t = moved;
          return moved;
        }
      }
      this.builds++;
      const t = buildTrain(this.world.layout, s);
      this.ways.set(s.key, { sig, t });
      return t;
    });
    this.buildMs += performance.now() - t0;
    return out;
  }

  private decide(ts: DTrain[], engine: number, moving: ReadonlySet<number>, snaps: Snap[]): void {
    const k = ts.findIndex((t) => t.key === engine);
    const m = this.memo.get(engine)!;
    if (k < 0 || ts[k].fixed) {
      m.decision = null;
      return;
    }
    const t0 = performance.now();
    const members = stretchOf(ts, k);
    // (Fair turns: it first (the one asking), then the others by how long they've waited.)
    const order = members.map((_, i) => i).sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : (this.memo.get(ts[members[a]].key)?.stood ?? Infinity) - (this.memo.get(ts[members[b]].key)?.stood ?? Infinity)));
    let r = search(ts, members, { cap: DISPATCH_STATES, backUps: "standstill", order });
    // (Stuck: no order keeps them all going. With detours.)
    let sent = false;
    const without = r.plain;
    if (r.plain < r.of && this.world.sim.ticks - m.stood >= REROUTE_AFTER_S * SIM_HZ) {
      const d0 = performance.now();
      const dt = withDetours(this.world.layout, snaps, ts, members);
      this.detourMs += performance.now() - d0;
      // (One decision's states, both searches together.)
      if (dt && r.states < DISPATCH_STATES) {
        const rd = search(dt, members, { cap: DISPATCH_STATES - r.states, backUps: "standstill", order });
        if (rd.detourValue > r.plain) {
          sent = rd.firstD[0] >= rd.detourValue && rd.firstToD[0] >= 0 && dt[k].detour[rd.firstToD[0]] === 1;
          r = { ...rd, first: rd.firstD, firstTo: rd.firstToD, plain: rd.detourValue };
        }
      }
    }
    const ms = performance.now() - t0;
    this.decisions++;
    this.decisionMs.push(ms);
    this.decisionStates.push(r.states);
    this.plainStates.push(statsLast.plainStates);
    this.stretchSizes.push(members.length);
    if (r.capped) this.capped++;
    if (this.probe) {
      const p0 = performance.now();
      const pr = search(ts, members, { cap: DISPATCH_STATES, backUps: true, order });
      this.probeMs.push(performance.now() - p0);
      if (pr.states >= 500) {
        // (Warm: the same search again, the fastest of five.)
        let best = Infinity;
        for (let x = 0; x < 5; x++) {
          const w0 = performance.now();
          search(ts, members, { cap: DISPATCH_STATES, backUps: true, order });
          best = Math.min(best, performance.now() - w0);
        }
        this.probeWarm.push([pr.states, best]);
      }
      this.probeStates.push(pr.states);
      if (pr.capped) this.probeCapped++;
    }
    const was = m.decision;
    m.decision = r.first[0] < 0 ? "hold-blocked" : r.first[0] >= r.plain ? "grant" : "hold-order";
    // (Fair turns: passed over `FAIR_TURNS` times in a row, it goes, if that costs at most one train's delivery.)
    if (m.decision === "hold-order") {
      m.passed++;
      if (m.passed >= FAIR_TURNS && r.first[0] >= r.plain - 1 && r.first[0] > 0) {
        m.decision = "grant";
        this.say("fair-turn", m, `train ${engine}: passed over ${m.passed} times; its turn (${r.first[0]}/${r.of} keep delivering, ${r.plain} if it waited)`);
        m.passed = 0;
      }
    } else if (m.decision === "grant") m.passed = 0;
    m.behindMoving = m.decision === "hold-blocked" && moving.has(blockerOf(ts, k));
    if (m.decision === "hold-blocked") m.blockWhy = whyBlocked(ts, k);
    if (m.decision !== "grant" && was === null) this.agreeHold++;
    if (sent) this.say("reroute-stuck", m, `train ${engine}: stuck; sent round by another way (${r.value}/${r.of} of its stretch keep going, ${without} without)`);
    else if (m.decision === "grant" && r.firstTo[0] >= ts[k].main && !ts[k].half[r.firstTo[0]] && !ts[k].detour[r.firstTo[0]]) this.say("reroute", m, `train ${engine}: granted by a loop's other road`);
    if (r.backUp >= 0 && r.value > r.plain) this.say("backup", m, `train ${engine}'s stretch: no order keeps ${r.of} going (${r.plain}); with train ${ts[members[r.backUp]].key} backing up, ${r.value}`);
  }

  private say(kind: DKind, m: Memo, what: string): void {
    if (m.said.has(kind)) return;
    m.said.add(kind);
    this.counts[kind]++;
    if (this.first[kind].length < 3) this.first[kind].push(`${(this.world.sim.ticks / SIM_HZ).toFixed(0)} s: ${what}`);
  }

  /** The numbers, for a report line. */
  summary() {
    const pct = (a: number[], p: number) => {
      if (a.length === 0) return 0;
      const s = [...a].sort((x, y) => x - y);
      return Number(s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(3));
    };
    return {
      counts: this.counts,
      heldBy: Object.fromEntries(this.heldBy),
      agreeGo: this.agreeGo,
      agreeHold: this.agreeHold,
      events: this.events,
      decisions: this.decisions,
      ms: { p50: pct(this.decisionMs, 0.5), p98: pct(this.decisionMs, 0.98), max: pct(this.decisionMs, 1) },
      states: { p50: pct(this.decisionStates, 0.5), p98: pct(this.decisionStates, 0.98), max: pct(this.decisionStates, 1) },
      sizes: { p50: pct(this.stretchSizes, 0.5), max: pct(this.stretchSizes, 1) },
      capped: this.capped,
      builds: this.builds,
      relocations: this.relocations,
      buildMs: Number(this.buildMs.toFixed(1)),
      detourMs: Number(this.detourMs.toFixed(1)),
      blockWhy: Object.fromEntries(this.blockWhy),
      first: this.first,
    };
  }
}
