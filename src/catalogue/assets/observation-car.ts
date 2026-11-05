import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";

/**
 * The game's observation car (a coach in the `observation` look, Game mode's Observation car blueprint): a cream and
 * green coach with tall windows all down its sides and a glass roof, and a rounded glass end with a brass rail, for
 * riders to watch the line go by. A code model (no Blender one), small and self-contained as the cold van is.
 */

/** Its length, buffer to buffer, couplers left out (mm): the coach's. */
export const OBSERVATION_LENGTH = 88;

/** Its bogies' node (its four wheels, each turning about z). */
export const OBSERVATION_BOGIES = "bogies";

/** The car, facing +x, centred, standing on y = 0 (its wheels' feet), with its bogies and couplers. */
export function buildObservationCar(k: Kit): Group {
  const len = OBSERVATION_LENGTH;
  const bogies = k.bogies(len);
  bogies.name = OBSERVATION_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const deck = 12;
  const green = k.paint(TOY.green);
  const cream = k.paint(TOY.cream);
  const glass = k.paint(TOY.sky);
  const brass = k.paint(TOY.yellow);
  // The chassis, a beech deck; a green lower body to the window sills.
  g.add(k.box(k.wood, len - 4, 5, 30, 1.5, 0, deck, 0));
  g.add(k.box(green, len - 12, 10, 30, 2.5, 0, deck + 4, 0));
  // Tall windows down each side: one long sky-blue pane, cream pillars between them.
  const sill = deck + 14;
  const winH = 14;
  g.add(k.box(glass, len - 14, winH, 28.6, 1, 0, sill, 0));
  for (let i = 0; i <= 5; i++) {
    const x = -(len - 16) / 2 + ((len - 16) * i) / 5;
    g.add(k.box(cream, 2.2, winH, 30.2, 0.4, x, sill, 0));
  }
  // A cream cantrail, then the glass roof: a shallow sky-blue dome on cream hoops.
  g.add(k.box(cream, len - 12, 2.5, 30.4, 0.6, 0, sill + winH, 0));
  const roof = k.cylX(glass, 13, len - 14, 0, sill + winH - 4, 0, 24);
  roof.scale.set(1, 0.55, 1.12);
  g.add(roof);
  for (let i = 0; i <= 4; i++) {
    const hoop = k.ring(cream, 13.4, 0.9, -(len - 18) / 2 + ((len - 18) * i) / 4, sill + winH - 4, 0, true, Math.PI);
    hoop.rotation.y = Math.PI / 2;
    hoop.scale.set(1.12, 0.55, 1);
    g.add(hoop);
  }
  // The rounded observation end (its back, −x): a glass bay and a brass rail round its little balcony.
  const bx = -len / 2 + 6;
  const bay = k.cyl(glass, 13, winH, bx, sill, 0, 13, 20);
  bay.scale.set(0.5, 1, 1);
  g.add(bay);
  g.add(k.box(green, 6, 3, 30, 1, bx - 2, deck + 6, 0));
  for (const z of [-13, 13]) g.add(k.box(brass, 1.2, 8, 1.2, 0.3, bx - 4, deck + 9, z));
  g.add(k.box(brass, 1.2, 1.2, 27, 0.3, bx - 4, deck + 13, 0));
  return g;
}

/** Its bogies (its four wheels). */
export function observationBogies(root: Object3D): Object3D {
  return root.getObjectByName(OBSERVATION_BOGIES)!;
}
