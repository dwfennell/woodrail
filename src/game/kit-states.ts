import type { Sim } from "../sim";
import { getPieceDef, type KitDef, type KitStateKind, type Layout } from "../track";

/** What a kit's state is read from: the world as the game has it. */
export interface KitStateWorld {
  readonly sim: Sim;
  readonly layout: Layout;
}

/**
 * How one kind of kit state (`KitDef.state`, for `moves: "state"`) is read. The game asks `version` every frame, and
 * only when it has changed (or the kits were synced) asks each state kit's `level`, so a railway whose states don't
 * change costs nothing.
 */
export interface KitStateSource {
  /**
   * Goes up whenever any kit's state of this kind may have changed (a field read, every frame: `Sim.signalsVersion`).
   * It must only go up, never down (the game sums the kinds' versions).
   */
  version(world: KitStateWorld): number;
  /**
   * Where this kit's moving parts go now: 0 at rest (the model as baked), any other number away from it. Its motion
   * (`KIT_MOTIONS`) poses its parts with `on` easing toward the level (at once with `ease: 0`), then holding there.
   */
  level(world: KitStateWorld, pieceId: number, kit: KitDef): number;
}

/** Each kind of kit state. */
export const KIT_STATES: Readonly<Record<KitStateKind, KitStateSource>> = {
  // A signal skin's aspects: a bit for each of its roads at red (road 0 the 1 bit), so 0, at rest, is all clear.
  signal: {
    version: (w) => w.sim.signalsVersion,
    level: (w, pieceId) => {
      const p = w.layout.getPiece(pieceId);
      if (!p) return 0;
      const roads = getPieceDef(p.type, p.flipped).paths.length;
      let red = 0;
      for (let road = 0; road < roads; road++) if (!w.sim.signalClear(pieceId, road)) red += 2 ** road;
      return red;
    },
  },
};

const KINDS = Object.values(KIT_STATES);

/** One number that goes up whenever any kind of kit state may have changed (the kinds' versions summed). */
export function kitStatesVersion(world: KitStateWorld): number {
  let v = 0;
  for (const k of KINDS) v += k.version(world);
  return v;
}

/** A "state" kit's level now (see `KitStateSource.level`); 0 for a kit with no state. */
export function kitStateLevel(world: KitStateWorld, pieceId: number, kit: KitDef): number {
  return kit.state ? KIT_STATES[kit.state].level(world, pieceId, kit) : 0;
}
