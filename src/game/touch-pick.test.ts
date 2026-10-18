import { describe, expect, it } from "vitest";
import { carNearTap, deckTapWins } from "./touch-pick";

// Two short cars end to end along y = 100 (a train 10–20 px a car, as at the default zoom on a phone).
const cars = [
  { id: 1, ax: 100, ay: 100, bx: 115, by: 100 },
  { id: 2, ax: 118, ay: 100, bx: 133, by: 100 },
];

describe("a fingertip's slack for cars", () => {
  it("a tap right on a car takes it", () => {
    expect(carNearTap(108, 100, cars, 22)).toBe(1);
    expect(carNearTap(125, 101, cars, 22)).toBe(2);
  });

  it("a tap that misses by a finger's width still takes the nearest car", () => {
    expect(carNearTap(110, 120, cars, 22)).toBe(1);
    expect(carNearTap(130, 82, cars, 22)).toBe(2);
    // Off its end, along the line.
    expect(carNearTap(150, 100, cars, 22)).toBe(2);
  });

  it("further than the slack: no car (the track or the floor under the tap has it)", () => {
    expect(carNearTap(110, 123, cars, 22)).toBe(-1);
    expect(carNearTap(60, 100, cars, 22)).toBe(-1);
  });

  it("no slack (a mouse): only a tap on the line itself", () => {
    expect(carNearTap(110, 101, cars, 0)).toBe(-1);
    expect(carNearTap(110, 100, cars, 0)).toBe(1);
  });

  it("no cars, none taken", () => {
    expect(carNearTap(0, 0, [], 22)).toBe(-1);
  });
});

import { nearCarWins } from "./touch-pick";

describe("what a car near a tap wins over", () => {
  it("track, a road, a town's footprint and bare floor: the train near the tap wins", () => {
    for (const under of ["piece", "road", "station", null] as const) expect(nearCarWins(under)).toBe(true);
  });
  it("something solid tapped exactly keeps the tap (and a car tapped exactly is that car)", () => {
    for (const under of ["car", "depot", "cargo", "prop", "lever"] as const) expect(nearCarWins(under)).toBe(false);
  });
});

describe("a tap on a turntable's deck with a train standing on it", () => {
  const DECK = 7;
  const deckHit = { kind: "piece", pieceId: DECK, deck: true };
  const carHit = { kind: "car", carId: 3 };
  it("is the deck's when the tap is exactly on the deck (the car came by a fingertip's slack)", () => {
    expect(deckTapWins(DECK, deckHit, -1)).toBe(DECK);
    expect(deckTapWins(DECK, deckHit, DECK)).toBe(DECK);
  });
  it("is the deck's on the train itself with the turntable selected", () => {
    expect(deckTapWins(DECK, carHit, DECK)).toBe(DECK);
  });
  it("is the train's on the train with the turntable not selected (its card, to drive it off)", () => {
    expect(deckTapWins(DECK, carHit, -1)).toBe(-1);
    expect(deckTapWins(DECK, carHit, 12)).toBe(-1);
  });
  it("is the train's when it isn't standing still wholly on a deck, or the tap is on other track", () => {
    expect(deckTapWins(-1, deckHit, DECK)).toBe(-1);
    expect(deckTapWins(-1, carHit, DECK)).toBe(-1);
    expect(deckTapWins(DECK, { kind: "piece", pieceId: DECK }, DECK)).toBe(-1);
    expect(deckTapWins(DECK, { kind: "piece", pieceId: 9, deck: true }, DECK)).toBe(-1);
    expect(deckTapWins(DECK, null, DECK)).toBe(-1);
  });
});
