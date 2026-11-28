import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { AmbientEye } from "../render/ambient";
import { CROSSING_BELL_MIN_VOLUME } from "./crossing-bell";
import { HEAR_GAIN, HEAR_PX, audibility, hear } from "./hearing";

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

describe("audibility: how loud a source is from its size on screen", () => {
  it("silent at and under the silent size, full at and over the clear size", () => {
    expect(audibility(0)).toBe(0);
    expect(audibility(HEAR_PX.silent)).toBe(0);
    expect(audibility(HEAR_PX.clear)).toBe(1);
    expect(audibility(100)).toBe(1);
  });

  it("linear between", () => {
    expect(audibility((HEAR_PX.silent + HEAR_PX.clear) / 2)).toBeCloseTo(0.5, 10);
  });
});

describe("hear: a source in view is heard by its size on screen", () => {
  it("a car close up is HEAR_GAIN (less than full), zoomed out silent", () => {
    expect(HEAR_GAIN).toBe(0.6);
    expect(hear(eyeAt(400), "car", 0, 0, 0)).toBe(HEAR_GAIN);
    // (A 60 mm car is 7.6 px at 8000 mm, audibility 0.36; it is under HEAR_PX.silent only from about 15 m.)
    expect(hear(eyeAt(20000), "car", 0, 0, 0)).toBe(0);
  });

  it("off to the side, out of view: silent", () => {
    expect(hear(eyeAt(400), "car", 3000, 0, 0)).toBe(0);
  });

  it("a clear crossing is loud enough for its bell (HEAR_GAIN >= the bell's minimum); one barely visible is not", () => {
    expect(HEAR_GAIN).toBeGreaterThanOrEqual(CROSSING_BELL_MIN_VOLUME);
    expect(hear(eyeAt(400), "crossing", 0, 0, 0)).toBeGreaterThanOrEqual(CROSSING_BELL_MIN_VOLUME);
    // (A crossing drawn barely drawn: quiet enough to leave unrung.)
    const far = hear(eyeAt(16000), "crossing", 0, 0, 0);
    expect(far).toBeLessThan(CROSSING_BELL_MIN_VOLUME);
  });

  it("an eye not set yet hears nothing", () => {
    expect(hear(new AmbientEye(), "car", 0, 0, 0)).toBe(0);
  });
});
