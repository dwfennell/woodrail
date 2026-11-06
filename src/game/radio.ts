import type { PowerPlan } from "./power";
import { RADIO_MAST } from "./power";
import type { World } from "./world";

/**
 * The radio (late-game spec, radio kept simple, the user's pick of 2026-11-05): a radio mast in a town, with a spark
 * of power (src/game/power.ts: masts take theirs after the electric engines, before the yards), tells the town about
 * the trains, and `RADIO_RIDERS` times as many people come to its stations (they come that much more often; the
 * platform's cap is as before). One mast is enough for a town; more add nothing. Without a spark, it's quiet.
 *
 * Worked out from the props and the power plan (both versioned), never per frame.
 */

/** People come to a town with a powered mast this many times as often. */
export const RADIO_RIDERS = 1.5;
/** How near a town's middle (mm) a mast must stand to be that town's. */
export const RADIO_REACH = 700;

/** The town a mast at (x, z) is in: the nearest town's id within `RADIO_REACH`, or −1. */
export function townOfMast(world: Pick<World, "landscape">, x: number, z: number): number {
  let best = -1;
  let near = RADIO_REACH;
  for (const t of world.landscape.towns) {
    const d = Math.hypot(t.centre.x - x, t.centre.z - z);
    if (d <= near) {
      near = d;
      best = t.id;
    }
  }
  return best;
}

/** The towns with a powered radio mast: town id → the mast's prop id. */
export function radioTowns(world: Pick<World, "landscape" | "props">, plan: Pick<PowerPlan, "mastsOn">): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of world.props.all()) {
    if (p.asset !== RADIO_MAST || !plan.mastsOn.has(p.id)) continue;
    const town = townOfMast(world, p.x, p.z);
    if (town >= 0 && !out.has(town)) out.set(town, p.id);
  }
  return out;
}

/** How much more often people come to town `townId`'s stations. */
export function radioRiders(towns: ReadonlyMap<number, number>, townId: number): number {
  return towns.has(townId) ? RADIO_RIDERS : 1;
}
