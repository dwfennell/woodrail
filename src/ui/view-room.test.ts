import { describe, expect, it } from "vitest";
import { viewRoom } from "./view-room";

describe("viewRoom: what of the view shows the map", () => {
  it("a phone upright: below the bar and goals, above the card (and the tray)", () => {
    const room = viewRoom(390, 844, [{ left: 12, top: 10, right: 120, bottom: 54 }, { left: 12, top: 72, right: 300, bottom: 116 }], [
      { left: 10, top: 697, right: 380, bottom: 834 },
      { left: 12, top: 480, right: 378, bottom: 688 },
    ]);
    expect(room).toEqual({ left: 0, top: 116, right: 390, bottom: 480 });
  });

  it("a phone on its side: the engine card docked at the right narrows it from the right, not the bottom (QA B-A)", () => {
    const room = viewRoom(844, 390, [{ left: 12, top: 10, right: 240, bottom: 56 }, { left: 12, top: 72, right: 300, bottom: 116 }], [
      { left: 10, top: 246, right: 834, bottom: 380 },
      { left: 414, top: 66, right: 832, bottom: 231 },
    ]);
    expect(room).toEqual({ left: 0, top: 116, right: 414, bottom: 246 });
  });

  it("nothing worth framing in: none (the caller takes the whole view), never a room turned inside out", () => {
    expect(viewRoom(390, 844, [{ left: 0, top: 0, right: 390, bottom: 200 }], [{ left: 0, top: 240, right: 390, bottom: 844 }])).toBeNull();
    expect(viewRoom(844, 390, [], [{ left: 380, top: 10, right: 844, bottom: 150 }, { left: 0, top: 60, right: 300, bottom: 390 }])).toBeNull();
  });
});
