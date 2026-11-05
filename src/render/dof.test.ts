import { describe, expect, it } from "vitest";
import { DOF_LEVEL, DOF_LOOKS, dofLook } from "./dof";

describe("dofLook", () => {
  it("is half of what it was: half the aperture, half the most blur, near and far alike", () => {
    expect(DOF_LEVEL).toBe("half");
    expect(dofLook()).toEqual({ aperture: 0.5, maxblur: DOF_LOOKS.today.maxblur / 2, near: 1, dead: 0 });
  });
});
