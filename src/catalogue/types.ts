import type { Object3D } from "three";
import type { Kit } from "./kit";

export type Category = "Track" | "Trains" | "Wagons" | "Stations & buildings" | "Mechanisms" | "Bridges & tunnels" | "Vehicles" | "People & animals" | "Scenery" | "Town & road";

export interface Asset {
  /** Unique, kebab-case. */
  id: string;
  name: string;
  /** A shorter name for the tray, when `name` won't fit a tile in three lines ("Signalman"). */
  trayLabel?: string;
  category: Category;
  /** Short words to search by. */
  tags: string[];
  /** One or two sentences: what it is, and an idea for how it could play in the game. */
  notes: string;
  /** Already in the game (shown for reference)? */
  inGame?: boolean;
  /**
   * Build it (standing on y = 0, facing +x). Parts marked `userData.underlay` (a strip of river under a bridge) are for
   * showing it off in the catalogue, and are left out in the game.
   */
  build(k: Kit): Object3D;
  /**
   * Optional motion for the viewer (a crane turning, a barrier lifting, wheels spinning): called every frame with the
   * object `build` returned and the time in seconds. Find parts by `name` (set `part.name = "arm"` when building).
   */
  animate?(root: Object3D, t: number): void;
}
