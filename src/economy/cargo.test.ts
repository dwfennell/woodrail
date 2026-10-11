import { describe, expect, it } from "vitest";
import { CAR_KINDS, CAR_SPECS } from "../sim";
import { CARGO, CARGO_KINDS, canCarry } from "./cargo";

describe("cargo", () => {
  it("only timber wagons carry cargo", () => {
    for (const k of CAR_KINDS) expect(canCarry(k)).toBe(k === "timber");
  });

  it("cargo kinds and car kinds are indexed in snapshot order", () => {
    CARGO_KINDS.forEach((k, i) => expect(CARGO[k].index).toBe(i));
    CAR_KINDS.forEach((k, i) => expect(CAR_SPECS[k].index).toBe(i));
  });
});
