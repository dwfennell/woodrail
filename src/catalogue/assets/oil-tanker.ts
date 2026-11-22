import { Group, type Object3D } from "three";
import { mapBoardGrain } from "../../render/wood-grain";
import { TOY, type Kit } from "../kit";
import { buffers, endRails } from "./wagon-parts";

/**
 * The game's tank wagon (the `oiltank` car kind, Game mode's Tank wagons): a black barrel with a yellow band, a hazard
 * diamond on each side, a ladder and a walkway on top, straps, an outlet each side, buffers and end rails, after the catalogue's train-fuel-tanker. It carries oil or water
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
  const chassis = k.box(k.wood, len - 4, 5.8, 30, 2.5, 0, deck - 0.8, 0);
  mapBoardGrain(chassis.geometry);
  g.add(chassis);
  const black = k.paint(TOY.black);
  const yellow = k.paint(TOY.yellow);
  const r = 12;
  const barrel = len - 24;
  const y = deck + 3 + r;
  for (const x of [-barrel / 3, barrel / 3]) g.add(k.box(yellow, 6, 6, 26, 1, x, deck + 3, 0));
  // A turned blank: charcoal lacquer over the middle, with its rounded
  // shoulders and the circular cut faces left in clear beech.
  const half = barrel / 2;
  const shell = k.lathe(k.paint("#353c43"), [
    [r - 0.5, -half], [r, -half + 2], [r, half - 2], [r - 0.5, half],
  ], 0, y, 0, 56);
  shell.rotation.z = -Math.PI / 2;
  g.add(shell);
  for (const end of [-1, 1]) {
    const head = k.lathe(k.wood, [
      [r - 0.5, 0], [r - 0.8, 1.4], [r - 1.6, 2.8], [r - 3.1, 4.1], [r - 5, 4.8], [0, 5.1],
    ], end * half, y, 0, 56);
    head.geometry.rotateZ(-end * Math.PI / 2);
    mapBoardGrain(head.geometry);
    g.add(head);
  }
  // The yellow band and the straps follow the barrel's round section.
  g.add(k.cylX(yellow, r + 0.3, 6, 0, y, 0, 56));
  for (const z of [-1, 1]) {
    const d = k.box(k.paint(TOY.orange), 6, 6, 0.8, 0.3, 0, 0, 0);
    d.position.set(barrel / 4, y, z * (r - 0.2));
    d.rotation.z = Math.PI / 4;
    g.add(d);
  }
  // A dome with a lid, a ladder up its side and a beech walkway along the top.
  g.add(k.cyl(yellow, 4.5, 4, -barrel / 4, y + r - 1, 0, 4.5, 20));
  g.add(k.lathe(black, [[5, 0], [5.4, 0.5], [5.2, 1.2], [3.5, 1.8], [0, 2]], -barrel / 4, y + r + 3, 0, 32));
  for (const x of [6, 10]) g.add(k.box(k.paint(TOY.grey), 1, 22, 1, 0.3, x, deck + 3, 13));
  for (let i = 0; i < 5; i++) g.add(k.cylX(k.paint(TOY.grey), 0.5, 4, 8, deck + 6 + i * 4, 13, 6));
  g.add(k.box(k.wood, barrel * 0.6, 1.2, 6, 0.4, barrel / 8, y + r - 0.6, 0));
  // A strap round the barrel over each cradle, an outlet each side at its foot with a red wheel, buffers and end rails.
  for (const x of [-barrel / 3, barrel / 3]) g.add(k.cylX(k.paint(TOY.grey), r + 0.25, 1.4, x, y, 0, 56));
  for (const s of [-1, 1]) {
    g.add(k.cylZ(k.metal, 1.4, 4, -8, deck + 6.5, s * 12.5, 10));
    g.add(k.cylZ(k.paint(TOY.red), 2.4, 0.8, -8, deck + 6.5, s * 14.8, 12));
  }
  g.add(buffers(k, len, 1, deck + 2.5), buffers(k, len, -1, deck + 2.5));
  g.add(endRails(k, -len / 2 + 2.6, deck + 5, 9, 13.6), endRails(k, len / 2 - 2.6, deck + 5, 9, 13.6));
  g.add(k.box(k.metal, 0.8, 0.8, 28, 0, -len / 2 + 2.6, deck + 13.6, 0), k.box(k.metal, 0.8, 0.8, 28, 0, len / 2 - 2.6, deck + 13.6, 0));
  return g;
}

/** Its bogies (its four wheels). */
export function oilTankerBogies(root: Object3D): Object3D {
  return root.getObjectByName(OIL_TANKER_BOGIES)!;
}
