import type { DepotState } from "../economy";
import type { Footprint } from "../props/placement";
import { checkProp, TrackIndex } from "../props/placement";
import type { PropPose } from "../props/store";
import type { Train } from "../sim";
import { MONTH_S } from "./calendar";
import type { Progress } from "./progress";
import type { World } from "./world";

/**
 * The touring circus (late-game spec K1: docs/superpowers/specs/2026-11-04-late-game-design.md). Learning Circus gives
 * two cage wagons (a gift: `learnGift`; never made). Any train with a cage in it is the circus train: when it comes to
 * a town's station (or halt), stopping or passing through, the big top goes up beside it for `CIRCUS_SECONDS` of play. While it stands, riders a
 * coach brings to that town pay `CIRCUS_FARE` times the fare, and the town's people come to its station
 * `CIRCUS_RIDERS` times as often. When the show closes, the big top comes down and the town offers a reward card (as
 * growing does). The circus moves on: it doesn't show in the same town twice running.
 *
 * Counted once a second of play (`circusTick`), never per frame. Its state is the progress's (saved), the big top a
 * prop on the map (saved with the props).
 */

/** How long a show runs: three months of the game's calendar. */
export const CIRCUS_SECONDS = 3 * MONTH_S;
/** Riders to the circus's town pay this many times the fare. */
export const CIRCUS_FARE = 2;
/** People come to the circus's town's station this many times as often. */
export const CIRCUS_RIDERS = 2;
/** The big top's catalogue model. */
export const BIG_TOP = "scene-big-top";

/** Is this train the circus (a cage wagon in it)? */
export const isCircus = (t: Train): boolean => t.cars.some((c) => c.kind === "cage");

/**
 * The town's stop a circus train is at now: the depot whose crane works it, or a town's stop under it (stopping or
 * passing through: a cage train with nothing to load stops for no crane). Null if none.
 */
export function circusStop(world: Pick<World, "sim" | "economy">): DepotState | null {
  for (const id of world.sim.trainIds()) {
    const t = world.sim.getTrain(id)!;
    if (!isCircus(t)) continue;
    const serving = world.economy.servingDepot(id);
    if (serving?.role === "town") return serving;
    for (const b of t.bogies) {
      const d = world.economy.depotAtPiece(b.pieceId);
      if (d?.role === "town") return d;
    }
  }
  return null;
}

export type CircusEvent = { kind: "opened"; town: number } | { kind: "closed"; town: number };

/**
 * `seconds` of play: a show runs down (and closes: `takeDown` its big top), or the circus train stands at a town it
 * didn't show in last and the show opens there (`putUp` its big top: its prop's id, or −1 if there's no room for one;
 * the show goes on without it). The events, for toasts and the reward.
 */
export function circusTick(world: Pick<World, "sim" | "economy">, p: Progress, seconds: number, putUp: (townId: number) => number, takeDown: (prop: number) => void): CircusEvent[] {
  if (p.circus) {
    p.circus.left -= seconds;
    if (p.circus.left > 0) return [];
    const town = p.circus.town;
    if (p.circus.prop >= 0) takeDown(p.circus.prop);
    p.circusLast = town;
    p.circus = null;
    return [{ kind: "closed", town }];
  }
  const stop = circusStop(world);
  if (!stop || stop.townId < 0 || stop.townId === p.circusLast) return [];
  p.circus = { town: stop.townId, left: CIRCUS_SECONDS, prop: putUp(stop.townId) };
  p.circusTowns.add(stop.townId);
  return [{ kind: "opened", town: stop.townId }];
}

/** A rider getting off at `to`: the fare's factor (the circus's town pays double). */
export function circusFare(p: Progress, to: Pick<DepotState, "role" | "townId">): number {
  return p.circus && to.role === "town" && to.townId === p.circus.town ? CIRCUS_FARE : 1;
}

/** How much more often people come to town `townId`'s station (the circus is there). */
export function circusRiders(p: Progress, townId: number): number {
  return p.circus?.town === townId ? CIRCUS_RIDERS : 1;
}

/**
 * Where the big top can stand by a town's station (`station` its piece's pose): clear land in rings round it, the
 * nearest first, by the props' own rule (`checkProp`). Null if there's no room near.
 */
export function bigTopSpot(world: Pick<World, "landscape" | "layout" | "props">, at: { x: number; z: number }, fp: Footprint, footprint: (asset: string) => Footprint | undefined): PropPose | null {
  const ctx = { land: world.landscape, track: new TrackIndex(world.layout), props: world.props, footprint };
  for (let ring = 2; ring <= 10; ring++)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const pose = { x: Math.round(at.x + Math.cos(a) * ring * 60), z: Math.round(at.z + Math.sin(a) * ring * 60), heading: 0 };
      const c = checkProp(ctx, fp, pose, "land");
      if (c.kind === "clear") return { ...pose, y: c.y };
    }
  return null;
}

/** "Months" left of a show, for its card: "2 months", "1 month", "a few days". */
export function monthsLeft(seconds: number): string {
  const m = Math.ceil(seconds / MONTH_S);
  return seconds < MONTH_S / 3 ? "a few days" : `${m} month${m === 1 ? "" : "s"}`;
}
