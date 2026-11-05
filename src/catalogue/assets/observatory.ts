import { Group } from "three";
import { TOY, type Kit } from "../kit";

/**
 * The observatory (Game mode's Observatory: a halt on a hilltop where stargazers ride to): a white round tower under
 * a silver dome, its shutter open and a brass telescope looking out, a gold star on a pole, and a platform along the
 * track. A code model, in the kit piece's frame (src/track/kits.ts `kit-observatory`): x along the track (its middle at
 * 0, 216 long), z away from the track (the platform's edge at z = 0), y = 0 the track's base.
 */
export const OBSERVATORY_DOME_Z = 62;
export const OBSERVATORY_DOME_R = 24;

export function buildObservatory(k: Kit): Group {
  const g = new Group();
  const white = k.paint(TOY.white);
  const silver = k.paint("#c9ccd2");
  const dark = k.paint("#27304a");
  const brass = k.paint(TOY.yellow);
  // The platform: a beech deck along the track, a cream edge line, and a little shelter's bench.
  g.add(k.box(k.wood, 216, 7, 24, 1.5, 0, 0, 12));
  g.add(k.box(k.paint(TOY.cream), 216, 1, 3, 0.4, 0, 7, 1.8));
  g.add(k.box(k.paint(TOY.blue), 26, 4, 8, 1, -60, 7, 18));
  // A path up to the tower.
  g.add(k.box(k.paint("#b9b2a6"), 14, 3, 26, 1, 0, 0, 34));
  // The tower, a door toward the track, and two round windows.
  const z = OBSERVATORY_DOME_Z;
  const r = OBSERVATORY_DOME_R;
  g.add(k.cyl(white, r, 34, 0, 0, z, r, 32));
  g.add(k.box(k.paint(TOY.red), 10, 16, 2, 1, 0, 0, z - r + 0.5));
  for (const x of [-12, 12]) g.add(k.cylZ(dark, 3, 1.6, x, 22, z - r + 2.2, 14));
  g.add(k.cyl(k.paint(TOY.blue), r + 1.5, 3, 0, 34, z, r + 1.5, 32));
  // The dome: a silver half ball, its shutter a dark band over the top, opened toward the sky.
  const dome = k.ball(silver, r, 0, 37, z, 1);
  dome.scale.y = 1;
  g.add(dome);
  // (The lower half of the ball is inside the tower: hidden.)
  const slit = k.box(dark, 9, 3, r * 2 + 1, 1, 0, 37 + r - 2, z);
  g.add(slit);
  // The telescope: a brass tube tilted up out of the shutter, its eyepiece end inside.
  const scope = k.cylX(brass, 4, 34, 0, 0, 0, 16);
  scope.position.set(4, 37 + r - 2, z - 6);
  scope.rotation.set(0, Math.PI / 2, 0.75);
  g.add(scope);
  // A gold star on a pole at the platform's end.
  g.add(k.cyl(k.paint(TOY.grey), 1.2, 34, 92, 7, 16, 1.2, 8));
  const star = new Group();
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const arm = k.box(brass, 12, 2.6, 2.4, 0.5, 0, 0, 0);
    arm.rotation.z = a;
    star.add(arm);
  }
  star.position.set(92, 46, 16);
  g.add(star);
  return g;
}
