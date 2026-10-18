import { describe, expect, it } from "vitest";
import { Hud } from "./hud";

/** A Hud with only its Blueprints button (a stand-in with a class list). */
function boardHud(): { hud: Hud; pulsing: () => boolean } {
  const classes = new Set<string>();
  const boardBtn = { classList: { toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)) } };
  const hud = Object.create(Hud.prototype) as Hud;
  Object.assign(hud, { boardBtn, rewardsSeen: 0 });
  return { hud, pulsing: () => classes.has("board-new") };
}

describe("the Blueprints button", () => {
  it("pulses for each new reward until the board is opened", () => {
    const { hud, pulsing } = boardHud();
    hud.setBoardButton(false, 0);
    expect(pulsing()).toBe(false);
    hud.setBoardButton(false, 1);
    expect(pulsing()).toBe(true);
    hud.setBoardButton(true, 1);
    expect(pulsing()).toBe(false);
    // Closed with the reward still waiting: no pulse till another comes.
    hud.setBoardButton(false, 1);
    expect(pulsing()).toBe(false);
    hud.setBoardButton(false, 2);
    expect(pulsing()).toBe(true);
    hud.setBoardButton(true, 2);
    hud.setBoardButton(false, 0);
    // Rewards claimed, then a new one: it pulses again.
    hud.setBoardButton(false, 1);
    expect(pulsing()).toBe(true);
  });
});
