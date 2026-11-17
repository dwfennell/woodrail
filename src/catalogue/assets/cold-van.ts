import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import { archedRoof, buffers, doorStep, endRails, underBox } from "./wagon-parts";

/**
 * The game's cold van (the `reefer` car kind, Game mode's Cold van blueprint): a white insulated van with a blue
 * stripe and a curved blue roof with ice hatches, thick hinged doors in the middle of each side, snowflakes either side
 * of them and a cooling unit with a fan on its end, after the catalogue's
 * train-refrigerated-van. A code model (no Blender one), small and self-contained as the milk tank wagon is.
 */

/** Its length, buffer to buffer, couplers left out (mm): the van's. */
export const COLD_VAN_LENGTH = 84;

/** Its bogies' node (its four wheels, each turning about z). */
export const COLD_VAN_BOGIES = "bogies";

/** The van, facing +x, centred, standing on y = 0 (its wheels' feet), with its bogies and couplers. */
export function buildColdVan(k: Kit): Group {
  const len = COLD_VAN_LENGTH;
  const bogies = k.bogies(len);
  bogies.name = COLD_VAN_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const deck = 12;
  const h = 26;
  const white = k.paint(TOY.white);
  const blue = k.paint(TOY.blue);
  const sky = k.paint(TOY.sky);
  const floor = deck + 4;
  const grey = k.paint(TOY.grey);
  // The chassis, a beech deck with buffers; the white body under a blue roof curved across it, an ice hatch at each end.
  g.add(k.box(k.wood, len - 4, 5, 30, 1.5, 0, deck, 0));
  g.add(buffers(k, len, 1, deck + 2.5), buffers(k, len, -1, deck + 2.5), underBox(k));
  g.add(k.box(white, len - 12, h, 30, 2.5, 0, floor, 0));
  g.add(archedRoof(k, blue, len - 7, 34, 6.5, floor + h - 0.6));
  for (const x of [-26, 26]) g.add(k.box(sky, 9, 1.4, 12, 0.5, x, floor + h + 4.9, 0));
  for (const side of [-1, 1]) {
    const z = side * 15.3;
    const out = side * 0.25;
    // A blue stripe along each side, and a snowflake of three crossed arms at either end of it.
    g.add(k.box(blue, len - 14, 3, 0.8, 0, 0, floor + h - 6, z));
    for (const x of [-25, 25])
      for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        const arm = k.box(sky, 10, 1.5, 0.8, 0, 0, 0, 0);
        arm.position.set(x, floor + 9.5, z);
        arm.rotation.z = a;
        g.add(arm);
      }
    // The insulated doors in the middle: two thick leaves in a grey frame, three hinges on each, a locking bar down
    // each and a step below.
    g.add(k.box(grey, 25, 22.5, 0.8, 0, 0, floor + 0.8, z));
    for (const x of [-5.9, 5.9]) {
      g.add(k.box(white, 11, 20.6, 1.2, 0, x, floor + 1.7, z + out));
      for (const y of [4, 11.5, 19]) g.add(k.box(grey, 4, 1.1, 1.2, 0, x + Math.sign(x) * 4.2, floor + y, z + 2 * out));
      g.add(k.box(k.metal, 0.8, 17, 1.2, 0, x - Math.sign(x) * 3.4, floor + 3.5, z + 2 * out));
    }
    g.add(doorStep(k, side, deck));
  }
  g.add(endRails(k, 36.4, floor + 5));
  // The cooling unit on its back end, a black fan on it.
  const ux = -len / 2 + 5;
  g.add(k.box(k.paint(TOY.grey), 4, 16, 22, 1, ux, deck + 7, 0));
  g.add(k.cylX(k.paint(TOY.black), 6, 0.8, ux - 2.2, deck + 15, 0, 20));
  return g;
}

/** Its bogies (its four wheels). */
export function coldVanBogies(root: Object3D): Object3D {
  return root.getObjectByName(COLD_VAN_BOGIES)!;
}
