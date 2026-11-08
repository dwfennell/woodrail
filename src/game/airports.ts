import { AIRPORT_LOUNGE, type DepotState } from "../economy";
import type { Pose } from "../track";
import { depotPoint } from "./harbours";
import type { Progress } from "./progress";
import type { World } from "./world";

/**
 * Airports (late-game spec A1: docs/superpowers/specs/2026-11-04-late-game-design.md). An airport is a passenger stop
 * of its own (a depot of role "airport"): riders a train brings there get off into its lounge (at most
 * `AIRPORT_LOUNGE`) and wait for a plane. Planes call by themselves, every `PLANE_EVERY` seconds of game time: each
 * flies in from far off, lands, takes up to `PLANE_SEATS` from the lounge (each pays `AIRPORT_FARE`, more than any
 * train ride), leaves up to `PLANE_VISITORS` visitors on the platform, and flies off again. Visitors wait like a
 * town's riders; a train takes them on, and each pays `VISITOR_BONUS` times the fare where they get off.
 *
 * So the airport does nothing without trains both ways. Nothing is steered: a plane comes in along the airport's
 * line, straight, and leaves the same way. Each airport's clock is game time, from the session (not saved: a reload
 * starts it at `FIRST_PLANE` from a plane).
 */

/** Seconds of game time from one plane landing to the next. */
export const PLANE_EVERY = 150;
/** A new airport's (or a reloaded game's) first plane lands this soon. */
export const FIRST_PLANE = 40;
/** Seconds a plane takes to fly in (or out). */
export const PLANE_FLIGHT = 12;
/** Seconds a plane stands on the apron between landing and taking off. */
export const PLANE_PARKED = 30;
/** Riders a plane takes from the lounge. */
export const PLANE_SEATS = 8;
/** Visitors a plane leaves (while the platform has room: at most `VISITORS_CAP` waiting). */
export const PLANE_VISITORS = 6;
export const VISITORS_CAP = 12;
/** What each rider who flies pays (coins), when the plane takes them. */
export const AIRPORT_FARE = 12;
/** A visitor off a plane pays this many times the fare where a train lets them off. */
export const VISITOR_BONUS = 1.5;

/** Where a plane stands on the apron: past the yard's far side (depot coordinates t, l). */
// (Its wings, 110 mm across, clear of the yard: the pad and the terminal reach 114 mm out. QA shot: at 150 a wing lay
// over the terminal's roof.)
export const APRON = { t: 150, l: 180 };
/** How far off a plane comes in from (mm along the airport's line), and how high it flies there. */
export const FLIGHT_FROM = 3200;
export const FLIGHT_HEIGHT = 520;

/** A plane's visit: how many flew off with it (and paid), and how many visitors it left. */
export interface PlaneVisit {
  depotId: number;
  flew: number;
  paid: number;
  visitors: number;
}

/** Where an airport's plane is in its visit, by the airport's clock. */
export type PlanePhase = { kind: "away" } | { kind: "in"; u: number } | { kind: "parked" } | { kind: "out"; u: number };

/** A plane's phase `t` seconds after the last landing (or, `t` < 0, before the next). */
export function phaseAt(t: number): PlanePhase {
  // (A frame's time past the clock's last update may run past a landing.)
  if (t >= PLANE_EVERY) t -= PLANE_EVERY;
  // (The plane lands at t = 0: it flies in over the PLANE_FLIGHT seconds before.)
  const before = PLANE_EVERY - t;
  if (t < 0 || before <= PLANE_FLIGHT) {
    const left = t < 0 ? -t : before;
    return left <= PLANE_FLIGHT ? { kind: "in", u: 1 - left / PLANE_FLIGHT } : { kind: "away" };
  }
  if (t < PLANE_PARKED) return { kind: "parked" };
  if (t < PLANE_PARKED + PLANE_FLIGHT) return { kind: "out", u: (t - PLANE_PARKED) / PLANE_FLIGHT };
  return { kind: "away" };
}

/** Airports on the map. */
export function airportsOf(world: Pick<World, "economy" | "layout">): DepotState[] {
  return world.economy.allDepots().filter((d) => d.role === "airport");
}

/**
 * Every airport's planes. `update` is called with the game's clock (its seconds of play); a plane lands when an
 * airport's clock comes round (`PLANE_EVERY`), and the visit is paid and counted there.
 */
export class Airports {
  /** Each airport's seconds since its last landing (negative: its first plane is still coming), by depot id. */
  private readonly clocks = new Map<number, number>();
  /** The game's clock at the last `update`. */
  private last = -1;

  /** Move the clocks on to `simSeconds`: the visits of planes that landed meanwhile, paid into `p`. */
  update(world: Pick<World, "economy" | "layout">, p: Progress, simSeconds: number): PlaneVisit[] {
    const dt = this.last < 0 ? 0 : Math.max(0, simSeconds - this.last);
    this.last = simSeconds;
    const visits: PlaneVisit[] = [];
    const here = new Set<number>();
    for (const d of airportsOf(world)) {
      here.add(d.id);
      let t = this.clocks.get(d.id);
      if (t === undefined) t = -FIRST_PLANE;
      else t += dt;
      // (A plane lands each time the clock comes round past 0.)
      if (t >= PLANE_EVERY) t -= PLANE_EVERY;
      const before = this.clocks.get(d.id);
      if (before !== undefined && (before < 0 || before > t) && t >= 0) visits.push(land(d, p));
      this.clocks.set(d.id, t);
    }
    for (const id of [...this.clocks.keys()]) if (!here.has(id)) this.clocks.delete(id);
    return visits;
  }

  /** Where depot `depotId`'s plane is, `extra` seconds after the last `update` (a frame between two). */
  phase(depotId: number, extra = 0): PlanePhase {
    const t = this.clocks.get(depotId);
    return t === undefined ? { kind: "away" } : phaseAt(t + extra);
  }

  /** Seconds till depot `depotId`'s next plane lands (null: no such airport yet). */
  nextIn(depotId: number): number | null {
    const t = this.clocks.get(depotId);
    if (t === undefined) return null;
    return t < 0 ? -t : PLANE_EVERY - t;
  }

  /** The game's clock at the last update (for a view between updates). */
  get lastUpdate(): number {
    return this.last;
  }

  /**
   * Test and e2e hook (a setup shortcut, never the player's path): set depot `depotId`'s next plane to land in
   * `seconds`.
   */
  landIn(depotId: number, seconds: number): void {
    this.clocks.set(depotId, seconds >= PLANE_EVERY ? 0 : -seconds);
  }

  /** A new map: no planes. */
  clear(): void {
    this.clocks.clear();
    this.last = -1;
  }
}

/** A plane lands at airport `d`: the lounge flies off with it (paying), and its visitors get off. */
export function land(d: DepotState, p: Progress): PlaneVisit {
  const flew = Math.min(d.flyers, PLANE_SEATS);
  d.flyers -= flew;
  const paid = flew * AIRPORT_FARE;
  p.coins += paid;
  const visitors = Math.max(0, Math.min(PLANE_VISITORS, VISITORS_CAP - d.waiting));
  d.waiting += visitors;
  return { depotId: d.id, flew, paid, visitors };
}

/** Where a plane is in the world, by its phase at an airport at `pose` (ground height `y`): position and heading. */
export function planePose(pose: Pose, y: number, phase: PlanePhase): { x: number; y: number; z: number; heading: number; pitch: number } | null {
  if (phase.kind === "away") return null;
  const apron = depotPoint(pose, APRON.t, APRON.l);
  if (phase.kind === "parked") return { ...apron, y, heading: pose.heading, pitch: 0 };
  // In along the airport's line from far off past its far end (descending, easing to a stop), out the same way
  // (climbing away, getting going).
  const u = phase.u;
  const off = phase.kind === "in" ? (1 - u) * (1 - u) : u * u;
  const far = depotPoint(pose, APRON.t + FLIGHT_FROM * off, APRON.l);
  const heading = phase.kind === "in" ? pose.heading + Math.PI : pose.heading;
  return { x: far.x, y: y + FLIGHT_HEIGHT * off, z: far.z, heading, pitch: phase.kind === "in" ? 0.12 * off : -0.18 * Math.min(1, off * 3) };
}

/** What an airport's card says, in a few short lines. */
export function airportLines(d: DepotState, next: number | null): string[] {
  const lines: string[] = [];
  lines.push(next === null ? "⏱ A plane is on its way" : `⏱ Next plane in ${Math.floor(next / 60)}:${String(Math.floor(next % 60)).padStart(2, "0")}`);
  lines.push(`🧑 Waiting to fly: ${d.flyers} of ${AIRPORT_LOUNGE} · each pays ${AIRPORT_FARE} coins`);
  lines.push(d.waiting > 0 ? `🧑 Visitors for a train: ${d.waiting} · they pay ${VISITOR_BONUS}× fares` : "🧑 Each plane leaves visitors for your trains");
  return lines;
}
