import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";

/**
 * The game's cold van (the `reefer` car kind, Game mode's Cold van blueprint): a white insulated van with a blue
 * stripe and roof, snowflakes on its sides and a cooling unit with a fan on its end, after the catalogue's
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
  // The chassis, a beech deck; the white body and a blue roof.
  g.add(k.box(k.wood, len - 4, 5, 30, 1.5, 0, deck, 0));
  g.add(k.box(white, len - 12, h, 30, 2.5, 0, deck + 4, 0));
  g.add(k.box(blue, len - 8, 3.5, 34, 1.6, 0, deck + 4 + h, 0));
  for (const z of [-15.3, 15.3]) {
    // A blue stripe along each side, and a snowflake of three crossed arms at either end of it.
    g.add(k.box(blue, len - 14, 3, 0.8, 0.3, 0, deck + 4 + h - 6, z));
    for (const x of [-22, 22])
      for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        const arm = k.box(sky, 11, 1.6, 0.8, 0.3, 0, 0, 0);
        arm.position.set(x, deck + 14, z);
        arm.rotation.z = a;
        g.add(arm);
      }
  }
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
