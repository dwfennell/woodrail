/**
 * The frame every secret site is built in (`assets/secrets.ts`), kept out of that file so the game can place and find
 * sites without loading their models' chunk: the halt's track, the shipwreck's seaward edge, and how far a site reaches.
 *
 * Every site is laid out round the same halt: a siding along x on the site's +z side, a straight and a buffer as real
 * track pieces that join the network at the straight's open (−x) end, its platform and nameboard in the model.
 */

/** The siding's centre line (z, in the site's frame). */
export const HALT_Z = 170;

/** A piece of track of the site's halt, in the site's frame (its pose: where the piece starts, heading along it). */
export interface HaltPiece {
  type: "straight-216" | "buffer";
  x: number;
  z: number;
  heading: number;
}

/**
 * A secret site's halt as track: a straight beside the platform and a buffer, laid as real pieces (turned and moved
 * with the site). The straight's open end at x −108 joins the network. Once the site is found it's a passenger stop
 * like the Lookout halt (`LOOKOUT_KIT`): no one lives there, riders from any town get off for a day out. `stop` is
 * where a train's front halts, by the buffer.
 */
export const SECRET_HALT: { readonly pieces: readonly HaltPiece[]; readonly stop: { x: number; z: number }; readonly joins: { x: number; z: number; heading: number } } = {
  pieces: [
    { type: "straight-216", x: -108, z: HALT_Z, heading: 0 },
    { type: "buffer", x: 108, z: HALT_Z, heading: 0 },
  ],
  stop: { x: 100, z: HALT_Z },
  joins: { x: -108, z: HALT_Z, heading: Math.PI },
};

/**
 * The shipwreck's seaward edge (z in its frame): it's placed only on a beach at the sea's edge, this side on the line
 * where the sand meets the sea, its sand running all the way to it.
 */
export const SHIPWRECK_SEA_Z = -144;

/**
 * How far a site reaches in its frame (mm): every model, hidden or found, its halt and buffer, stands inside this
 * (checked by `design-assets.test.ts`). The halt's track runs along z = `HALT_Z`, 20 either side.
 */
export const SITE_BOUNDS = { x0: -158, x1: 158, z0: -176, z1: 192 } as const;
