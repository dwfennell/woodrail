import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";

/**
 * The game's tank wagon (the `oiltank` car kind, Game mode's Tank wagons): a black barrel with a yellow band, a hazard
 * diamond on each side, a ladder and a walkway on top, after the catalogue's train-fuel-tanker. It carries oil or water
 * (a drop on its side says so in the tray picture). A code model (no Blender one), as the milk tank wagon.
 */

/** Its length, buffer to buffer, couplers left out (mm): the van's. */
export const OIL_TANKER_LENGTH = 84;

/** Its bogies' node (its four wheels, each turning about z). */
export const OIL_TANKER_BOGIES = "bogies";

/** The wagon, facing +x, centred, standing on y = 0 (its wheels' feet), with its bogies and couplers. */
export function buildOilTanker(k: Kit): Group {
  const len = OIL_TANKER_LENGTH;
  const bogies = k.bogies(len);
  bogies.name = OIL_TANKER_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const deck = 12;
  g.add(k.box(k.paint(TOY.black), len - 4, 5, 30, 1.5, 0, deck, 0));
  const black = k.paint(TOY.black);
  const yellow = k.paint(TOY.yellow);
  const r = 12;
  const barrel = len - 24;
  const y = deck + 3 + r;
  for (const x of [-barrel / 3, barrel / 3]) g.add(k.box(yellow, 6, 6, 26, 1, x, deck + 3, 0));
  g.add(k.cylX(black, r, barrel, 0, y, 0));
  for (const s of [-1, 1]) {
    const cap = k.ball(black, r, (s * barrel) / 2, y, 0);
    cap.scale.x = 0.45;
    g.add(cap);
  }
  // A yellow band round its middle, and an orange hazard diamond on each side.
  g.add(k.cylX(yellow, r + 0.3, 6, 0, y, 0));
  for (const z of [-1, 1]) {
    const d = k.box(k.paint(TOY.orange), 6, 6, 0.8, 0.3, 0, 0, 0);
    d.position.set(barrel / 4, y, z * (r - 0.2));
    d.rotation.z = Math.PI / 4;
    g.add(d);
  }
  // A dome with a lid, a ladder up its side and a beech walkway along the top.
  g.add(k.cyl(yellow, 4.5, 4, -barrel / 4, y + r - 1, 0, 4.5, 20));
  g.add(k.cyl(black, 5.2, 1.4, -barrel / 4, y + r + 3, 0, 5.2, 20));
  for (const x of [6, 10]) g.add(k.box(k.paint(TOY.grey), 1, 22, 1, 0.3, x, deck + 3, 13));
  for (let i = 0; i < 5; i++) g.add(k.cylX(k.paint(TOY.grey), 0.5, 4, 8, deck + 6 + i * 4, 13, 6));
  g.add(k.box(k.wood, barrel * 0.6, 1.2, 6, 0.4, barrel / 8, y + r - 0.6, 0));
  return g;
}

/** Its bogies (its four wheels). */
export function oilTankerBogies(root: Object3D): Object3D {
  return root.getObjectByName(OIL_TANKER_BOGIES)!;
}
