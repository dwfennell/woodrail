/**
 * The jams bar (dispatcher spec, docs/superpowers/specs/2026-11-18-dispatcher.md §8 step 0, §9): a reference map run
 * as a player would play it, each jam cleared as a player would clear it, counting the jams and the stops made.
 *
 * A jam: a train stuck (stalls.ts) for `JAM_S` seconds, give or take a flicker (not stuck again within `FLICKER_S`).
 * The player's fix: that train taken off the track (`putAway`), and put back `BACK_S` later at its line's first stop,
 * on its line, set going. (Stalls' "stuck" comes and goes every few seconds on some rings; counted from the first.)
 *
 * Run by `npm run jams` (scripts/jams.mjs) over the maps in src/play/bugmaps/reference/; the numbers each map gave on
 * main are in its baseline.json, the floor a routing change must not fall below.
 */
import type { CarKind } from "../sim";
import type { RouteStopDef } from "../economy/economy";
import type { World } from "../game/world";
import { putAway } from "../game/put-away";
import { editLine, joinLine } from "../game/lines";
import { replayBugMap } from "./bugmap";
import { next } from "../routing/graph";
import { getPieceDef, pathLength } from "../track";

/** A train stuck this long (s) is a jam, and is cleared. */
export const JAM_S = 30;
/** Stuck again within this (s) is the same stuck: the stall's flicker. */
export const FLICKER_S = 5;
/** A cleared train is put back this long (s) after it was taken off. */
export const BACK_S = 60;

export interface JamsRun {
  /** Jams cleared. */
  jams: number;
  /** Stops come to, by all routed trains. */
  arrivals: number;
  /** The longest any lever-on train stood not busy where it was (s): replay's liveness. */
  longestStand: number;
  /**
   * When the first jam was found (s; the run's length if none), and the stuck-train-seconds before it (each second, the
   * trains stalls say are stuck): what a rule avoids or puts off, before the player's clearing reshuffles the trains.
   */
  firstJam: number;
  stuckBefore: number;
  /** The first invariant broken, as "name: what" (null: none). */
  firstBreak: string | null;
  /** Stops come to, by engine. */
  byEngine: Record<number, number>;
  /** Each jam: when (s), the train cleared, its line, and the stall's kind. */
  log: { at: number; engine: number; line: number; kind: string }[];
  seconds: number;
}

/** Hooks for a shadow beside the run (dispatcher spec §8 step 1): each second, and each jam just before it's cleared. */
export interface JamsHooks {
  /** Each sim tick (a shadow's own clock). */
  tick?(): void;
  second?(now: number): void;
  /** `since`: when its train was first found stuck (s). */
  jam?(now: number, engine: number, since: number): void;
}

/** The most a seeded run holds a train back at the start (s): `startsOf`. */
export const STAGGER_S = 10;

/**
 * A seeded run's start (seed 1: none, the map as saved): each routed train set going a few seconds late, as a player
 * sets them going one by one, 0 to `STAGGER_S` − 1 s, by the seed and the train. The bar's dice: the sim itself draws
 * none, so it's what makes seeds' runs differ (`npm run jams -- --seeds 3`).
 */
export function startsOf(engines: readonly number[], seed: number): Map<number, number> {
  const out = new Map<number, number>();
  if (seed <= 1) return out;
  for (const e of engines) {
    let h = (Math.imul(seed, 0x9e3779b1) ^ Math.imul(e + 1, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    out.set(e, h % STAGGER_S);
  }
  return out;
}

/** Run `world` for `seconds` with the player's clearing (`JAM_S`, `BACK_S`); `seed` staggers its start (`startsOf`). */
export function runJams(world: World, seconds: number, hooks: JamsHooks = {}, seed = 1): JamsRun {
  const { sim, economy } = world;
  // (Seeded: its routed trains' levers off, each on again at its start.)
  const starts = startsOf([...economy.lineIdOf.keys()], seed);
  const levers = new Map<number, -1 | 0 | 1>();
  for (const [e, at] of starts) {
    if (at <= 0) continue;
    const t = sim.findCar(e)?.train;
    if (!t) continue;
    for (const c of t.cars)
      if (c.kind === "engine" && c.lever !== 0) {
        levers.set(c.id, c.lever);
        sim.setLever(c.id, 0);
      }
  }
  const pending: { at: number; kinds: CarKind[]; piece: number; lineId: number; stops: RouteStopDef[] }[] = [];
  const stuckSince = new Map<number, number>();
  const lastStuck = new Map<number, number>();
  const log: JamsRun["log"] = [];
  let stuckBefore = 0;
  const r = replayBugMap(world, {
    seed,
    seconds,
    stopAtFirst: false,
    onTick: () => {
      hooks.tick?.();
      if (sim.ticks % 120) return;
      const now = Math.round(sim.ticks / 120);
      if (levers.size > 0)
        for (const [e, at] of starts) {
          if (at !== now) continue;
          const t = sim.findCar(e)?.train;
          for (const c of t?.cars ?? []) {
            const l = levers.get(c.id);
            if (l !== undefined) {
              sim.setLever(c.id, l);
              levers.delete(c.id);
            }
          }
        }
      hooks.second?.(now);
      // (Put back, where there's room: at its line's first stop, on its line, set going.)
      for (let k = pending.length - 1; k >= 0; k--) {
        const q = pending[k];
        if (now < q.at) continue;
        for (const s of [100, 300, 50, 500]) {
          // (On the piece: a spot past its far end left the train's front on a cursor off it.)
          const pc = world.layout.getPiece(q.piece);
          if (!pc || s >= pathLength(getPieceDef(pc.type, pc.flipped).paths[0].geom)) continue;
          const placed = sim.addTrain(q.kinds, { pieceId: q.piece, pathIndex: 0, reversed: false, s });
          if (placed.kind !== "placed") continue;
          // (Not onto a piece another train is on (the sim places it over points another is crossing): off again, the
          // next spot tried, as a player would put it down clear.)
          // (Nor just ahead of a moving train's front: a piece it's on the point of running onto.)
          const mine = new Set(sim.getTrain(placed.trainId)!.bogies.map((b) => b.pieceId));
          const ahead = (o: { speed: number; bogies: { pieceId: number }[] }) => {
            if (o.speed === 0) return false;
            const f = (o.speed > 0 ? o.bogies[0] : o.bogies[o.bogies.length - 1]).pieceId;
            const piece = world.layout.getPiece(f);
            if (!piece) return false;
            const n = getPieceDef(piece.type, piece.flipped).connectors.length;
            for (let c = 0; c < n; c++) if (mine.has(next(world.layout, f, c)?.pieceId ?? -1)) return true;
            return false;
          };
          if ([...sim.trains()].some((o) => o.id !== placed.trainId && (o.bogies.some((b) => mine.has(b.pieceId)) || ahead(o)))) {
            putAway(sim, economy, sim.getTrain(placed.trainId)!.cars[0].id);
            continue;
          }
          const e = sim.getTrain(placed.trainId)!.cars[0].id;
          if (economy.lines.get(q.lineId)) joinLine(economy, e, q.lineId);
          else editLine(economy, e, (st) => st.push(...q.stops));
          sim.setLever(e, 1);
          pending.splice(k, 1);
          break;
        }
      }
      // (Before the first jam: its trains stuck this second.)
      if (log.length === 0) for (const id of sim.trainIds()) if (economy.stalls.stuckOf(sim.getTrain(id)!.cars[0].id)) stuckBefore++;
      // (One cleared a second at most: the first found stuck long enough.)
      for (const id of sim.trainIds()) {
        const t = sim.getTrain(id)!;
        const e = t.cars[0].id;
        const st = economy.stalls.stuckOf(e);
        if (!st) {
          if (now - (lastStuck.get(e) ?? -Infinity) > FLICKER_S) stuckSince.delete(e);
          continue;
        }
        lastStuck.set(e, now);
        if (!stuckSince.has(e)) stuckSince.set(e, now);
        if (now - stuckSince.get(e)! < JAM_S) continue;
        const route = economy.routeOf(e);
        const lineId = economy.lineIdOf.get(e);
        if (!route || route.stops.length === 0 || lineId === undefined) continue;
        const first = economy.depot(route.stops[0].depotId);
        if (!first) continue;
        hooks.jam?.(now, e, stuckSince.get(e)!);
        log.push({ at: now, engine: e, line: lineId, kind: st.kind });
        pending.push({ at: now + BACK_S, kinds: t.cars.map((c) => c.kind), piece: first.pieceId, lineId, stops: route.stops.map((s) => ({ ...s })) });
        putAway(sim, economy, e);
        stuckSince.delete(e);
        break;
      }
    },
  });
  let arrivals = 0;
  for (const n of r.arrivals.values()) arrivals += n;
  let longest = 0;
  for (const s of r.longestStand.values()) longest = Math.max(longest, s);
  return { jams: log.length, arrivals, byEngine: Object.fromEntries(r.arrivals), longestStand: longest, firstJam: log.length > 0 ? log[0].at : seconds, stuckBefore, firstBreak: r.first ? `${r.first.invariant}: ${r.first.what}` : null, log, seconds };
}
