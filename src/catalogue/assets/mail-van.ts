import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import { archedRoof, buffers, doorStep, endRails, underBox } from "./wagon-parts";

/**
 * The game's mail van (the `mailvan` car kind, Game mode's Post office blueprint): a red van with sliding doors in the middle
 * of each side, small barred windows, a yellow letter slot and a post horn, under a black roof curved across it with
 * two ventilators, buffers on its ends; after the catalogue's train-mail-van. A code model (no Blender
 * one), small and self-contained as the cold van is.
 */

/** Its length, buffer to buffer, couplers left out (mm): the van's. */
export const MAIL_VAN_LENGTH = 84;

/** Its bogies' node (its four wheels, each turning about z). */
export const MAIL_VAN_BOGIES = "bogies";

/** The van, facing +x, centred, standing on y = 0 (its wheels' feet), with its bogies and couplers. */
export function buildMailVan(k: Kit): Group {
  const len = MAIL_VAN_LENGTH;
  const bogies = k.bogies(len);
  bogies.name = MAIL_VAN_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const deck = 12;
  const h = 26;
  const floor = deck + 4;
  const red = k.paint(TOY.red);
  const black = k.paint(TOY.black);
  const yellow = k.paint(TOY.yellow);
  const cream = k.paint("#f3e7cb");
  const pane = k.paint("#2b3644");
  // The chassis: a beech deck with a buffer each side of each end, and a black box slung between the wheels.
  g.add(k.box(k.wood, len - 4, 5, 30, 1.5, 0, deck, 0));
  g.add(buffers(k, len, 1, deck + 2.5), buffers(k, len, -1, deck + 2.5));
  g.add(underBox(k));
  // The red body under a black roof curved across it, two ventilators on its ridge.
  g.add(k.box(red, len - 12, h, 30, 2.5, 0, floor, 0));
  g.add(archedRoof(k, black, len - 7, 34, 6.5, floor + h - 0.6));
  for (const x of [-18, 18]) g.add(k.cyl(k.metal, 2, 1.6, x, floor + h + 5.4, 0, 2.6, 12));
  for (const side of [-1, 1]) {
    const z = side * 15.3;
    const out = side * 0.25;
    // A yellow lining along the body's foot.
    g.add(k.box(yellow, len - 14, 1, 0.8, 0, 0, floor + 3, z));
    // The sliding doors in the middle: two leaves in a cream frame under their rail, a handle on each, a step below.
    g.add(k.box(cream, 25, 21.5, 0.8, 0, 0, floor + 1.2, z));
    for (const x of [-5.9, 5.9]) {
      g.add(k.box(red, 11, 19.4, 0.9, 0, x, floor + 2.2, z + out));
      g.add(k.box(k.metal, 0.9, 4, 0.8, 0, x - Math.sign(x) * 3.6, floor + 9.5, z + 2 * out));
    }
    g.add(k.box(black, 29, 1.2, 1.4, 0, 0, floor + 22.8, z + out));
    g.add(k.box(black, 16, 1.2, 4, 0, 0, deck - 3.4, side * 16.4));
    // A small barred window high in each end of the side.
    for (const x of [-25, 25]) {
      g.add(k.box(cream, 10, 7.4, 0.8, 0, x, floor + 15.4, z));
      g.add(k.box(pane, 8.2, 5.6, 0.9, 0, x, floor + 16.3, z + out));
      for (const dx of [-2, 2]) g.add(k.box(cream, 0.7, 5.2, 0.8, 0, x + dx, floor + 16.5, z + 2 * out));
    }
    // A yellow letter slot under one window, and a yellow post horn under the other.
    g.add(k.box(yellow, 12, 4, 0.8, 0, -25, floor + 8, z + out));
    g.add(k.box(k.cut, 8.6, 1.3, 0.9, 0, -25, floor + 9.4, z + 2 * out));
    g.add(k.ring(yellow, 3, 0.8, 23.6, floor + 9.6, z + out, true, Math.PI * 1.5));
    g.add(k.cone(yellow, 1.7, 3.6, 26.6, floor + 7.3, z + out));
  }
  // A handrail up each end.
  g.add(endRails(k, -36.4, floor + 5), endRails(k, 36.4, floor + 5));
  return g;
}

/** Its bogies (its four wheels). */
export function mailVanBogies(root: Object3D): Object3D {
  return root.getObjectByName(MAIL_VAN_BOGIES)!;
}

/**
 * The game's sorting van (the `sortvan` car kind, Game mode's Sorting van blueprint): a travelling post office. The mail
 * van's body in green, a row of lit, barred windows where the sorters work, a yellow letter slot, the sorters' door,
 * and a mail-bag arm at one end (the catcher that took bags on the move). Same length and bogies as the mail van.
 */
export function buildSortingVan(k: Kit): Group {
  const len = MAIL_VAN_LENGTH;
  const bogies = k.bogies(len);
  bogies.name = MAIL_VAN_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const deck = 12;
  const h = 26;
  const floor = deck + 4;
  const green = k.paint(TOY.green);
  const black = k.paint(TOY.black);
  const yellow = k.paint(TOY.yellow);
  const cream = k.paint("#f3e7cb");
  const lit = k.paint("#f3d27a");
  const canvas = k.paint("#e9e1cf");
  // The chassis, as the mail van's; the green body under a black roof curved across it, three ventilators on its ridge.
  g.add(k.box(k.wood, len - 4, 5, 30, 1.5, 0, deck, 0));
  g.add(buffers(k, len, 1, deck + 2.5), buffers(k, len, -1, deck + 2.5), underBox(k));
  g.add(k.box(green, len - 12, h, 30, 2.5, 0, floor, 0));
  g.add(archedRoof(k, black, len - 7, 34, 6.5, floor + h - 0.6));
  for (const x of [-22, -6, 10]) g.add(k.cyl(k.metal, 2, 1.6, x, floor + h + 5.4, 0, 2.6, 12));
  for (const side of [-1, 1]) {
    const z = side * 15.3;
    const out = side * 0.25;
    g.add(k.box(yellow, len - 14, 1, 0.8, 0, 0, floor + 3, z));
    // Three lit windows where the sorters work, each framed and barred, and a letter slot under the middle one.
    for (const x of [-22, -8, 6]) {
      g.add(k.box(cream, 11.6, 9.6, 0.8, 0, x, floor + 12.2, z));
      g.add(k.box(lit, 10, 8, 0.9, 0, x, floor + 13, z + out));
      g.add(k.box(cream, 0.7, 7.6, 0.8, 0, x, floor + 13.2, z + 2 * out));
    }
    g.add(k.box(yellow, 10, 2.4, 0.8, 0, -8, floor + 6.4, z + out));
    g.add(k.box(k.cut, 7, 0.9, 0.9, 0, -8, floor + 7.2, z + 2 * out));
    // The sorters' door toward the other end: one leaf in a cream frame under its rail, a step below.
    g.add(k.box(cream, 13, 21.5, 0.8, 0, 23, floor + 1.2, z));
    g.add(k.box(green, 11, 19.4, 0.9, 0, 23, floor + 2.2, z + out));
    g.add(k.box(k.metal, 0.9, 4, 0.8, 0, 19.6, floor + 9.5, z + 2 * out));
    g.add(k.box(black, 17, 1.2, 1.4, 0, 23, floor + 22.8, z + out));
    g.add(doorStep(k, side, deck, 23, 12));
  }
  g.add(endRails(k, -36.4, floor + 5), endRails(k, 36.4, floor + 5));
  // The mail-bag arm at one end, on the near side: a yellow post with a sack hung from its arm.
  g.add(k.box(yellow, 2.4, 20, 2.4, 0.4, 33.4, deck + 12, 16.8));
  g.add(k.box(yellow, 2, 2, 4, 0.4, 33.4, deck + 30, 18.2));
  g.add(k.box(canvas, 6, 8, 3.6, 1.6, 33.4, deck + 21, 19.2));
  return g;
}
