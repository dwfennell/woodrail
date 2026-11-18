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
  /** The first invariant broken, as "name: what" (null: none). */
  firstBreak: string | null;
  /** Each jam: when (s), the train cleared, its line, and the stall's kind. */
  log: { at: number; engine: number; line: number; kind: string }[];
  seconds: number;
}

/** Run `world` for `seconds` with the player's clearing (`JAM_S`, `BACK_S`). */
export function runJams(world: World, seconds: number): JamsRun {
  const { sim, economy } = world;
  const pending: { at: number; kinds: CarKind[]; piece: number; lineId: number; stops: RouteStopDef[] }[] = [];
  const stuckSince = new Map<number, number>();
  const lastStuck = new Map<number, number>();
  const log: JamsRun["log"] = [];
  const r = replayBugMap(world, {
    seconds,
    stopAtFirst: false,
    onTick: () => {
      if (sim.ticks % 120) return;
      const now = Math.round(sim.ticks / 120);
      // (Put back, where there's room: at its line's first stop, on its line, set going.)
      for (let k = pending.length - 1; k >= 0; k--) {
        const q = pending[k];
        if (now < q.at) continue;
        for (const s of [100, 300, 50, 500]) {
          const placed = sim.addTrain(q.kinds, { pieceId: q.piece, pathIndex: 0, reversed: false, s });
          if (placed.kind !== "placed") continue;
          const e = sim.getTrain(placed.trainId)!.cars[0].id;
          if (economy.lines.get(q.lineId)) joinLine(economy, e, q.lineId);
          else editLine(economy, e, (st) => st.push(...q.stops));
          sim.setLever(e, 1);
          pending.splice(k, 1);
          break;
        }
      }
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
  return { jams: log.length, arrivals, longestStand: longest, firstBreak: r.first ? `${r.first.invariant}: ${r.first.what}` : null, log, seconds };
}
