import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";

/**
 * The track cleaning wagon: a short yellow wagon with a little cab and two brushes underneath. Shared by its catalogue
 * model (mech-track-cleaner) and the game's car of the same name (the `cleaner` car kind: `buildCarModel`), which spins
 * the brushes as it runs, as it does the wheels.
 */

/** The cleaner's length, buffer to buffer, couplers left out (mm). */
export const TRACK_CLEANER_LENGTH = 80;

/** Its brushes' nodes, each turning about z (across the track). */
export const TRACK_CLEANER_BRUSHES = ["brushA", "brushB"] as const;

/** Its bogies' node (its four wheels, each turning about z). */
export const TRACK_CLEANER_BOGIES = "bogies";

/** Its beacon's node (an amber light on the cab). */
export const TRACK_CLEANER_BEACON = "beacon";

/** The wagon, facing +x, centred, standing on y = 0 (its wheels' feet), with its bogies and couplers. */
export function buildTrackCleaner(k: Kit): Group {
  const len = TRACK_CLEANER_LENGTH;
  const bogies = k.bogies(len);
  bogies.name = TRACK_CLEANER_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  g.add(k.box(k.paint(TOY.yellow), len - 6, 8, 30, 2, 0, 12, 0));
  g.add(k.box(k.paint(TOY.yellow), 28, 22, 28, 3, -18, 20, 0), k.box(k.glass, 29, 8, 20, 1, -18, 30, 0), k.box(k.paint(TOY.black), 30, 3, 30, 1, -18, 42, 0));
  const beacon = k.ball(k.paint("#ffc23a"), 2.4, -18, 50, 0);
  beacon.name = TRACK_CLEANER_BEACON;
  g.add(k.cyl(k.paint(TOY.orange), 3, 3, -18, 45, 0, 3, 12), beacon);
  g.add(k.cylX(k.paint(TOY.teal), 9, 28, 16, 29, 0, 20), k.box(k.paint(TOY.grey), 30, 3, 22, 1, 16, 20, 0));
  TRACK_CLEANER_BRUSHES.forEach((name, i) => {
    const b = new Group();
    b.name = name;
    b.position.set(i ? 4 : -4, 9, 0);
    b.add(k.cylZ(k.paint(TOY.red), 3, 26, 0, 0, 0, 12));
    for (let j = 0; j < 6; j++) b.add(k.box(k.paint(TOY.black), 1, 3, 24, 0.3, Math.cos(j) * 3.5, Math.sin(j) * 3.5 - 1.5, 0).rotateZ(j));
    g.add(b);
  });
  return g;
}

/** Its bogies (a group of its wheels). */
export function trackCleanerBogies(root: Object3D): Object3D {
  return root.getObjectByName(TRACK_CLEANER_BOGIES)!;
}

/** Its brushes, as nodes to turn. */
export function trackCleanerBrushes(root: Object3D): Object3D[] {
  return TRACK_CLEANER_BRUSHES.map((n) => root.getObjectByName(n)).filter((o): o is Object3D => !!o);
}
