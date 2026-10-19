import { describe, expect, it } from "vitest";
import { Progress } from "../game/progress";
import { deliver, pick } from "../game/research";
import { pillView } from "../game/research-text";
import { Hud } from "./hud";

/** A Hud with only its Blueprints button (a stand-in with a class list). */
function boardHud(): { hud: Hud; pulsing: () => boolean } {
  const classes = new Set<string>();
  const boardBtn = { classList: { toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)) } };
  const hud = Object.create(Hud.prototype) as Hud;
  Object.assign(hud, { boardBtn, researchPill: { classList: { toggle: () => {} } }, rewardsSeen: 0 });
  return { hud, pulsing: () => classes.has("board-new") };
}

describe("the Research button", () => {
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

/** A Hud with only its research pill (a stand-in counting what's written to it). */
function pillHud() {
  const writes: string[] = [];
  const part = (name: string) => ({ set textContent(t: string) { writes.push(`${name}=${t}`); } });
  const parts: Record<string, ReturnType<typeof part>> = { ".rp-name": part("name"), ".rp-count": part("count") };
  const classes = new Set<string>();
  const pill = {
    hidden: true,
    title: "",
    querySelector: (sel: string) => parts[sel],
    style: { setProperty: (k: string, v: string) => writes.push(`${k}=${v}`) },
    classList: { toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)) },
    setAttribute: () => {},
  };
  const hud = Object.create(Hud.prototype) as Hud;
  Object.assign(hud, { researchPill: pill, pillShown: "" });
  return { hud, pill, writes, idle: () => classes.has("idle") };
}

describe("the research pill", () => {
  it("shows the research and its count, says Pick research when idle, and hides with none", () => {
    const { hud, pill, writes, idle } = pillHud();
    const p = Progress.fresh();
    hud.setResearchPill(pillView(p, true));
    expect(pill.hidden).toBe(false);
    expect(idle()).toBe(true);
    expect(writes).toContain("name=Pick");
    pick(p, "bridges");
    deliver(p, "planks", 6);
    hud.setResearchPill(pillView(p, true));
    expect(writes).toContain("name=Bridges");
    expect(writes).toContain("count=6/10🪵");
    expect(writes).toContain("--fill=60%");
    expect(idle()).toBe(false);
    hud.setResearchPill(null);
    expect(pill.hidden).toBe(true);
  });

  it("isn't redrawn when what it shows hasn't changed", () => {
    const { hud, writes } = pillHud();
    const p = Progress.fresh();
    pick(p, "bridges");
    hud.setResearchPill(pillView(p, true));
    const n = writes.length;
    hud.setResearchPill(pillView(p, true));
    // (Grain isn't wanted: nothing changes.)
    deliver(p, "grain", 2);
    hud.setResearchPill(pillView(p, true));
    expect(writes.length).toBe(n);
    deliver(p, "planks", 1);
    hud.setResearchPill(pillView(p, true));
    expect(writes.length).toBeGreaterThan(n);
  });
});
