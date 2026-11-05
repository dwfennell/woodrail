import { CylinderGeometry, Group, Mesh, type Object3D } from "three";
import { TOY, type Kit } from "../kit";

/**
 * The game's breakdown crane (the `crane` car kind, Game mode's Breakdown crane), after the catalogue's
 * train-crane-wagon: a red wagon with outriggers, a yellow cab and jib on a turntable, and a hook on a rope. Its turret
 * slews round (`CRANE_TURRET`, about y) and its hook drops on a rope that pays out (`CRANE_ROPE`, `CRANE_HOOK`) while it
 * lifts a train: the game poses them (`poseCrane`). A code model (no Blender one), as the milk tank wagon.
 */

/** Its length, buffer to buffer, couplers left out (mm). */
export const CRANE_LENGTH = 88;
export const CRANE_BOGIES = "bogies";
export const CRANE_TURRET = "crane-turret";
export const CRANE_ROPE = "crane-rope";
export const CRANE_HOOK = "crane-hook";
/** Where the jib's tip is in the turret's frame (the rope hangs from it), and the rope's length at rest. */
const JIB_ANGLE = 0.55;
const JIB_LEN = 50;
const JIB_FOOT = { x: 4, y: 12 };
export const CRANE_TIP = { x: JIB_FOOT.x + JIB_LEN * Math.cos(JIB_ANGLE), y: JIB_FOOT.y + JIB_LEN * Math.sin(JIB_ANGLE) };
export const CRANE_ROPE_REST = 12;
const DECK = 17;

/** The wagon, facing +x, centred, standing on y = 0 (its wheels' feet), with its bogies and couplers. */
export function buildBreakdownCrane(k: Kit): Group {
  const L = CRANE_LENGTH;
  const bogies = k.bogies(L);
  bogies.name = CRANE_BOGIES;
  const g = k.group(bogies, k.coupler(L, 1), k.coupler(L, -1));
  const red = k.paint(TOY.red);
  const yellow = k.paint(TOY.yellow);
  // A heavy red chassis, and a grey deck with four yellow outrigger pads.
  g.add(k.box(red, L - 4, 6, 30, 1.5, 0, 11, 0));
  g.add(k.box(k.paint(TOY.grey), L - 8, 2, 30, 0.6, 0, DECK - 2, 0));
  for (const x of [-30, 30]) for (const z of [-17, 17]) g.add(k.box(yellow, 6, 3, 4, 0.8, x, 12, z));
  // A jib rest at the far end (the jib lies on it when the turret is stowed facing it).
  g.add(k.box(k.wood, 4, 14, 10, 1, 34, DECK, 0));
  const turret = new Group();
  turret.name = CRANE_TURRET;
  turret.position.set(-14, DECK, 0);
  turret.add(k.cyl(k.wood, 13, 3, 0, 0, 0, 13, 32));
  turret.add(k.box(yellow, 20, 18, 22, 2, -4, 3, 0));
  turret.add(k.box(k.paint("#a9cfe6"), 8, 7, 22.6, 0.3, 0, 11, 0));
  turret.add(k.box(k.paint(TOY.black), 24, 2.5, 26, 1, -4, 21, 0));
  // A counterweight at its back.
  turret.add(k.box(k.paint(TOY.grey), 8, 10, 20, 1.5, -15, 3, 0));
  const jib = new Group();
  jib.position.set(JIB_FOOT.x, JIB_FOOT.y, 0);
  jib.rotation.z = JIB_ANGLE;
  for (const z of [-3.5, 3.5]) jib.add(k.box(yellow, JIB_LEN, 3, 2, 0.6, JIB_LEN / 2, -1.5, z));
  for (let i = 0; i < 5; i++) jib.add(k.cylZ(yellow, 0.7, 7, 6 + i * 9, 0, 0, 8));
  turret.add(jib);
  turret.add(k.cylZ(k.metal, 2, 8, CRANE_TIP.x, CRANE_TIP.y, 0, 12));
  // The rope: a unit-long cylinder hanging down from the tip, scaled to its length (`poseCrane`).
  const rope = new Mesh(new CylinderGeometry(0.5, 0.5, 1, 6).translate(0, -0.5, 0), k.paint(TOY.black));
  rope.name = CRANE_ROPE;
  rope.position.set(CRANE_TIP.x, CRANE_TIP.y, 0);
  rope.scale.y = CRANE_ROPE_REST;
  turret.add(rope);
  const hook = new Group();
  hook.name = CRANE_HOOK;
  hook.position.set(CRANE_TIP.x, CRANE_TIP.y - CRANE_ROPE_REST, 0);
  hook.add(k.box(red, 5, 4, 4, 1, 0, -4, 0));
  hook.add(k.ring(k.metal, 2.2, 0.8, 0, -6.5, 0, true, Math.PI * 1.4));
  turret.add(hook);
  g.add(turret);
  return g;
}

/** Its bogies (its four wheels). */
export function breakdownCraneBogies(root: Object3D): Object3D {
  return root.getObjectByName(CRANE_BOGIES)!;
}

/**
 * Pose a crane model: its turret slewed `slew` (radians, about y; 0 its jib along the wagon), its rope paid out to
 * `rope` mm. Cheap: three numbers set on three objects, found once and kept on the root.
 */
export function poseCrane(root: Object3D, slew: number, rope: number): void {
  let parts = root.userData.craneParts as { turret: Object3D; rope: Object3D; hook: Object3D } | undefined;
  if (!parts) {
    const turret = root.getObjectByName(CRANE_TURRET);
    const r = root.getObjectByName(CRANE_ROPE);
    const hook = root.getObjectByName(CRANE_HOOK);
    if (!turret || !r || !hook) return;
    parts = { turret, rope: r, hook };
    root.userData.craneParts = parts;
  }
  parts.turret.rotation.y = slew;
  parts.rope.scale.y = Math.max(1, rope);
  parts.hook.position.y = CRANE_TIP.y - Math.max(1, rope);
}
