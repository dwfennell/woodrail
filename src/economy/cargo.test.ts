import { describe, expect, it } from "vitest";
import { CAR_KINDS, CAR_SPECS } from "../sim";
import { CARGO, CARGO_KINDS, canCarry } from "./cargo";

describe("cargo", () => {
  it("a kind of wagon per kind of goods: timber wagons take logs and planks, hoppers grain", () => {
    for (const k of CAR_KINDS) expect(canCarry(k), k).toBe(k === "timber" || k === "hopper");
    expect(canCarry("timber", "planks")).toBe(true);
    expect(canCarry("timber", "grain")).toBe(false);
    expect(canCarry("hopper", "grain")).toBe(true);
    expect(canCarry("hopper", "log")).toBe(false);
  });

  it("cargo kinds and car kinds are indexed in snapshot order", () => {
    CARGO_KINDS.forEach((k, i) => expect(CARGO[k].index).toBe(i));
    CAR_KINDS.forEach((k, i) => expect(CAR_SPECS[k].index).toBe(i));
  });
});
