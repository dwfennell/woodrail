import { AIRSHIP_SEATS, type DepotState } from "../economy";
import { getPieceDef } from "../track";
import type { Progress } from "./progress";
import type { World } from "./world";

/**
 * The airship (late-game spec B1: docs/superpowers/specs/2026-11-04-late-game-design.md). A mooring mast is a passenger
 * stop of its own (a depot of role "mast"): riders a train brings there board the airship (up to `AIRSHIP_SEATS`). It
 * takes off when it's full, or `TOUR_WAIT` seconds after its first rider boarded, and flies a slow loop over the railway
 * round the mast (`TOUR_RADIUS`), back after `TOUR_SECONDS`. Each rider pays the tour's fare as it lands: more the more
 * there is to see in the loop (`tourSights`): bridges, towns, trains. So it pays for a beautiful, busy railway, and its
 * riders come by train.
 *
 * Counted once a second of play from the game's clock; the sights once, as it takes off. Not saved: a tour in the air
 * at a reload lands at once (its riders pay then).
 */

/** Seconds a tour takes. */
export const TOUR_SECONDS = 40;
/** Seconds the airship waits for more riders once one has boarded. */
export const TOUR_WAIT = 90;
/** The loop's radius round the mast (mm), and how high it flies. */
export const TOUR_RADIUS = 1400;
export const TOUR_HEIGHT = 420;
/** A tour's fare with nothing to see, and the most it can be. */
export const BASE_FARE = 3;
export const MAX_FARE = 20;

/** What there is to see from a tour round a mast, and what each sight adds to the fare. */
export interface Sights {
  bridges: number;
  towns: number;
  trains: number;
  fare: number;
}

/** The pieces that count as bridges from the air. */
const isBridge = (type: string): boolean => type.startsWith("bridge") || type.startsWith("ramp") || type === "underpass";

/** Sights within the loop round a mast at (x, z): a coin a bridge, two a town, one a train; the fare from them. */
export function tourSights(world: Pick<World, "layout" | "landscape" | "sim">, at: { x: number; z: number }): Sights {
  const near = (x: number, z: number) => Math.hypot(x - at.x, z - at.z) <= TOUR_RADIUS;
  let bridges = 0;
  for (const id of world.layout.pieceIds()) {
    const p = world.layout.getPiece(id)!;
    if (isBridge(p.type) && getPieceDef(p.type, p.flipped) && near(p.pose.x, p.pose.z)) bridges++;
  }
  const towns = world.landscape.towns.filter((t) => near(t.centre.x, t.centre.z)).length;
  let trains = 0;
  for (const id of world.sim.trainIds()) {
    const b = world.sim.getTrain(id)!.bogies[0];
    const p = b && world.layout.getPiece(b.pieceId);
    if (p && near(p.pose.x, p.pose.z)) trains++;
  }
  const fare = Math.min(MAX_FARE, BASE_FARE + bridges + 2 * towns + trains);
  return { bridges, towns, trains, fare };
}

/** A mast's airship: tied up (waiting `waited` seconds with riders aboard), or touring (`t` seconds in). */
type Ship = { kind: "docked"; waited: number } | { kind: "touring"; t: number; aboard: number; fare: number };

/** A tour that landed: how many rode, and what they paid. */
export interface TourLanded {
  depotId: number;
  riders: number;
  paid: number;
}

/** Where a mast's airship is, for the view: tied up, or `u` (0–1) of the way round its loop. */
export type ShipPhase = { kind: "docked" } | { kind: "touring"; u: number };

/** Masts on the map. */
export function mastsOf(world: Pick<World, "economy" | "layout">): DepotState[] {
  return world.economy.allDepots().filter((d) => d.role === "mast" && !!world.layout.getPiece(d.pieceId));
}

export class Airships {
  private readonly ships = new Map<number, Ship>();
  private last = -1;

  /**
   * Move on to `simSeconds` of play: an airship takes off (full, or done waiting), or lands (its riders pay). `sights`:
   * the fare for a mast's tour, asked as it takes off.
   */
  update(world: Pick<World, "economy" | "layout">, p: Progress, simSeconds: number, sights: (d: DepotState) => Sights): TourLanded[] {
    const dt = this.last < 0 ? 0 : Math.max(0, simSeconds - this.last);
    this.last = simSeconds;
    const out: TourLanded[] = [];
    const here = new Set<number>();
    for (const d of mastsOf(world)) {
      here.add(d.id);
      let s = this.ships.get(d.id) ?? { kind: "docked", waited: 0 };
      if (s.kind === "docked") {
        const waited = d.flyers > 0 ? s.waited + dt : 0;
        if (d.flyers >= AIRSHIP_SEATS || (d.flyers > 0 && waited >= TOUR_WAIT)) {
          s = { kind: "touring", t: 0, aboard: d.flyers, fare: sights(d).fare };
          d.flyers = 0;
        } else s = { kind: "docked", waited };
      } else {
        const t = s.t + dt;
        if (t >= TOUR_SECONDS) {
          const paid = s.aboard * s.fare;
          p.coins += paid;
          out.push({ depotId: d.id, riders: s.aboard, paid });
          s = { kind: "docked", waited: 0 };
        } else s = { ...s, t };
      }
      this.ships.set(d.id, s);
    }
    for (const id of [...this.ships.keys()]) if (!here.has(id)) this.ships.delete(id);
    return out;
  }

  /** Where depot `depotId`'s airship is, `extra` seconds after the last update. */
  phase(depotId: number, extra = 0): ShipPhase {
    const s = this.ships.get(depotId);
    if (!s || s.kind === "docked") return { kind: "docked" };
    return { kind: "touring", u: Math.min(1, (s.t + extra) / TOUR_SECONDS) };
  }

  /** A mast's ship, for its card. */
  state(depotId: number): { touring: boolean; left: number; waited: number; aboard: number; fare: number } {
    const s = this.ships.get(depotId);
    if (!s || s.kind === "docked") return { touring: false, left: 0, waited: s?.kind === "docked" ? s.waited : 0, aboard: 0, fare: 0 };
    return { touring: true, left: TOUR_SECONDS - s.t, waited: 0, aboard: s.aboard, fare: s.fare };
  }

  get lastUpdate(): number {
    return this.last;
  }

  clear(): void {
    this.ships.clear();
    this.last = -1;
  }
}

/** What a mast's card says. */
export function mastLines(d: DepotState, ship: ReturnType<Airships["state"]>, sights: Sights): string[] {
  const seen = [sights.bridges && `${sights.bridges} bridge${sights.bridges === 1 ? "" : "s"}`, sights.towns && `${sights.towns} town${sights.towns === 1 ? "" : "s"}`, sights.trains && `${sights.trains} train${sights.trains === 1 ? "" : "s"}`].filter(Boolean).join(", ");
  if (ship.touring) return [`⏱ On a tour: ${ship.aboard} aboard, back in 0:${String(Math.ceil(ship.left)).padStart(2, "0")}`, `✨ Each pays ${ship.fare} coins when it lands`];
  return [`🧑 Aboard: ${d.flyers} of ${AIRSHIP_SEATS} · it leaves when full`, `✨ To see: ${seen || "nothing yet"} · ${sights.fare} coins a rider`];
}
