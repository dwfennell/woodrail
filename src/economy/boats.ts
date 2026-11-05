import type { CargoKind } from "./cargo";

/**
 * The player's boats (Game mode's River barges: docs/superpowers/specs/2026-11-04-water-transport.md): a tug and its
 * barges, routed between docks (river landings, harbours) on the same water. Kept by the economy, as its depots are
 * (`Economy.boats`), so a save keeps them with the depots they call at; what they do is src/game/boats.ts.
 */

/** What a boat does at a stop: drop and pick up, only pick up, or only drop. */
export type BoatStopAction = "both" | "pick" | "drop";

export interface BoatStop {
  depotId: number;
  action: BoatStopAction;
}

export interface BoatState {
  readonly id: number;
  name: string;
  /** Barges towed (1 to `MAX_BARGES`): each holds `BARGE_LOADS`. */
  barges: number;
  /** What it carries, by good. */
  load: Partial<Record<CargoKind, number>>;
  /** Its route: the docks it calls at, in order. */
  stops: BoatStop[];
  /** The stop it's at, or the one it left for the next (an index into `stops`). */
  from: number;
  /** Tied up at stop `from`'s dock (true), or sailing from it to the next stop (false). */
  docked: boolean;
  /** Sailing: seconds out from its last stop. Docked: seconds it has been tied up there. */
  t: number;
  /** Set going (Go) or stopped (Stop) on its card. */
  going: boolean;
  /** Where it was bought: it waits there till it has a route. */
  home: number;
  /** Where its goods were picked up, by good (a delivery is a drop somewhere else: the goal "Float goods down the river"). */
  loadedAt: Partial<Record<CargoKind, number>>;
}
