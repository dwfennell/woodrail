import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";

/**
 * The game's car carrier (the `carrier` car kind, Game mode's Car carrier blueprint): a yellow wagon with two open
 * decks, after the catalogue's train-car-transporter, cut to the van's length. Its cars are its load (drawn by the
 * depot view as cargo, three on the lower deck and, with the smithy's heavy wagons, two more up top), so the model is
 * the empty frame. A code model (no Blender one), small and self-contained as the cold van is.
 */

/** Its length, buffer to buffer, couplers left out (mm): the van's. */
export const CAR_CARRIER_LENGTH = 84;

/** Its bogies' node (its four wheels, each turning about z). */
export const CAR_CARRIER_BOGIES = "bogies";

/** The lower deck's top, in the model's own frame (the timber wagon's deck once it's lifted onto the rails). */
export const CARRIER_DECK = 19.5;
/** How far above the lower deck the upper deck's runways are (their top). */
export const CARRIER_UPPER = 13;

/** The wagon, facing +x, centred, standing on y = 0 (its wheels' feet), with its bogies and couplers. */
export function buildCarCarrier(k: Kit): Group {
  const len = CAR_CARRIER_LENGTH;
  const bogies = k.bogies(len);
  bogies.name = CAR_CARRIER_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const yellow = k.paint(TOY.yellow);
  const red = k.paint(TOY.red);
  // The chassis and the lower deck, a beech plank between yellow side sills.
  g.add(k.box(k.wood, len - 4, 5, 30, 1.5, 0, 12, 0));
  g.add(k.box(yellow, len - 6, 2.5, 32, 0.6, 0, CARRIER_DECK - 2.5, 0));
  // Posts at the corners and between, and the upper deck: two runways (one per side of a car's wheels), so you can
  // see the cars below from above.
  const up = CARRIER_DECK + CARRIER_UPPER;
  for (const x of [-38, -13, 13, 38]) for (const z of [-15, 15]) g.add(k.box(yellow, 2.5, CARRIER_UPPER, 2.5, 0.6, x, CARRIER_DECK, z));
  for (const z of [-9, 9]) g.add(k.box(yellow, len - 8, 2, 7, 0.6, 0, up - 2, z));
  for (const x of [-38, -13, 13, 38]) g.add(k.box(yellow, 2.5, 2, 32, 0.6, x, up - 2, 0));
  // A red guard rail along each side of the upper deck.
  for (const z of [-15.3, 15.3]) g.add(k.box(red, len - 10, 1.6, 1.6, 0.4, 0, up + 4, z));
  for (const x of [-36, -12, 12, 36]) for (const z of [-15.3, 15.3]) g.add(k.box(red, 1.4, 4, 1.4, 0.3, x, up, z));
  return g;
}

/** Its bogies (its four wheels). */
export function carCarrierBogies(root: Object3D): Object3D {
  return root.getObjectByName(CAR_CARRIER_BOGIES)!;
}
