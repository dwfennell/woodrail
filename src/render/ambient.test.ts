import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { AMBIENT_MIN_PX, AmbientEye } from "./ambient";

/** A 390×844 phone's view, looking down -z from `distance` mm above the ground's origin at a slant. */
function eyeAt(distance: number, viewH = 844): AmbientEye {
  const camera = new PerspectiveCamera(45, 390 / 844, 1, 100000);
  camera.position.set(0, distance * Math.SQRT1_2, distance * Math.SQRT1_2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const eye = new AmbientEye();
  eye.set(camera, viewH);
  return eye;
}

describe("AmbientEye: ambient motion asks for frames only on screen and big enough to see", () => {
  it("a 16 mm axe close up is seen; zoomed out it's under the size and isn't", () => {
    expect(eyeAt(400).sees(0, 0, 0, 16, AMBIENT_MIN_PX.mote)).toBe(true);
    expect(eyeAt(8000).sees(0, 0, 0, 16, AMBIENT_MIN_PX.mote)).toBe(false);
  });

  it("its size on screen: half as big at twice the distance", () => {
    const near = eyeAt(1000).pixels(0, 0, 0, 100);
    const far = eyeAt(2000).pixels(0, 0, 0, 100);
    expect(near / far).toBeCloseTo(2, 5);
    // (About 1.02 px per mm at 1 m on a 844 px tall view with a 45° field: 844 / (2 tan 22.5°) / 1000.)
    expect(near).toBeCloseTo((100 * 844) / (2 * Math.tan(Math.PI / 8)) / 1000, 3);
  });

  it("big enough but off screen: not seen", () => {
    const eye = eyeAt(400);
    expect(eye.sees(3000, 0, 0, 200, AMBIENT_MIN_PX.blade)).toBe(false);
    expect(eye.sees(0, 0, 0, 200, AMBIENT_MIN_PX.blade)).toBe(true);
  });

  it("not set yet: nothing is seen", () => {
    expect(new AmbientEye().sees(0, 0, 0, 1000, 1)).toBe(false);
  });
});
