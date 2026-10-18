import { describe, expect, it } from "vitest";
import { carNearTap, deckTapWins, liftTap } from "./touch-pick";

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

describe("a tap on a train lift (`liftTap`, piece-local t, l, y)", () => {
  const L = 288;
  const RISE = 48;
  it("down: anywhere on its platform sends it, at the felt-level track's own height too (130 and 190 from the low end)", () => {
    for (const t of [10, 130, 144, 190, 280]) {
      // The rails' tops and the unseen track it's picked by (0 to 12 high), on the centreline and across.
      for (const y of [0, 6, 12]) expect(liftTap(t, 0, y, 0, L), `t ${t} y ${y}`).toBe("send");
      expect(liftTap(t, 18, 6, 0, L)).toBe("send");
      // Its guard rails.
      expect(liftTap(t, -25, 34, 0, L)).toBe("send");
    }
  });
  it("up, or between: its platform where it stands now sends it; the felt-level track under it is the frame's", () => {
    expect(liftTap(130, 0, RISE + 4, RISE, L)).toBe("send");
    expect(liftTap(190, 10, RISE + 30, RISE, L)).toBe("send");
    expect(liftTap(130, 0, 6, RISE, L)).toBe("select");
    expect(liftTap(130, 0, 30, 24, L)).toBe("send");
  });
  it("its tower, counterweights, gear and base: its piece's card", () => {
    // A post, a counterweight, the top beam and the winding gear over the line.
    expect(liftTap(4, 32, 80, 0, L)).toBe("select");
    expect(liftTap(216, 38, 100, 0, L)).toBe("select");
    expect(liftTap(130, 32, 152, 0, L)).toBe("select");
    expect(liftTap(144, 0, 170, 0, L)).toBe("select");
    expect(liftTap(130, 0, 1, RISE, L)).toBe("select");
  });
  it("past its ends (where its unseen track runs on under the next piece's): neither, the tap goes through", () => {
    expect(liftTap(-20, 0, 6, 0, L)).toBe("pass");
    expect(liftTap(L + 20, 0, RISE + 6, RISE, L)).toBe("pass");
  });
});
