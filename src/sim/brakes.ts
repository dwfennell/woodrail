// How trains get up to speed and stop: the braking look-ahead's one home. The sim, the router, sections and the kit
// stops all ask how far a train at speed v needs to stop (`stopDistance`), each adding its own margin at the call.

/** A train's top speed on the level (mm/s), unless a mode's faster engines say otherwise (`Sim.topSpeed`). */
export const ENGINE_SPEED = 120;
/** How quickly (mm/s²) a train gets up to speed, or stops: half a second either way. */
export const ACCELERATION = ENGINE_SPEED * 2;

/** How far (mm) a train at speed `v` (mm/s) runs while it brakes at `ACCELERATION` to a stand: v²/2a. */
export const stopDistance = (v: number): number => (v * v) / (2 * ACCELERATION);

/** How fast a train may go to stop within `d` mm (as at a red signal): `stopDistance`'s inverse, half a mm short. */
export const brakeTo = (d: number): number => (d < 0.5 ? 0 : Math.sqrt(2 * ACCELERATION * (d - 0.5)));
