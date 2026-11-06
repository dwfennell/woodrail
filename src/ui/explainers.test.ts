import { describe, expect, it } from "vitest";
import { EXPLAINERS, explainer, SECTIONS_MAX, SECTIONS_MIN, TEXT_MAX, type ExplainerId } from "./explainers";
import { EXPLAINER_TITLES, explainedKeys, explainerIdFor } from "./explainer-keys";
import { SIGNAL_ITEM, trayKey, type TrayItem } from "./tray-catalogue";

const all = Object.values(EXPLAINERS);

describe("explainers", () => {
  it("the HUD's small list has every explainer, with its title, and nothing more", () => {
    expect(Object.keys(EXPLAINER_TITLES).sort()).toEqual(Object.keys(EXPLAINERS).sort());
    for (const [id, title] of Object.entries(EXPLAINER_TITLES)) expect(EXPLAINERS[id as ExplainerId].title).toBe(title);
  });

  it("each is keyed by its own id, with a title, an intro and 2–4 short sections", () => {
    for (const [id, x] of Object.entries(EXPLAINERS)) {
      expect(x.id).toBe(id);
      expect(x.title.length).toBeGreaterThan(0);
      expect(x.intro.length).toBeGreaterThan(0);
      expect(x.sections.length).toBeGreaterThanOrEqual(SECTIONS_MIN);
      expect(x.sections.length).toBeLessThanOrEqual(SECTIONS_MAX);
      for (const s of x.sections) {
        expect(s.heading.length).toBeGreaterThan(0);
        expect(s.text.length, `${id}: ${s.heading}`).toBeLessThanOrEqual(TEXT_MAX);
        expect(s.alt.length).toBeGreaterThan(0);
      }
    }
  });

  it("each section has a picture: one inline SVG, nothing loaded from outside, no script", () => {
    for (const x of all)
      for (const s of x.sections) {
        expect(s.picture.startsWith("<svg ")).toBe(true);
        expect(s.picture.endsWith("</svg>")).toBe(true);
        expect(s.picture.match(/<svg /g)?.length).toBe(1);
        expect(s.picture).not.toMatch(/<script|on\w+=|href=|url\(|<image/i);
      }
  });

  it("see-also links point at other explainers that exist", () => {
    for (const x of all)
      for (const id of x.seeAlso ?? []) {
        expect(id).not.toBe(x.id);
        expect(EXPLAINERS[id as ExplainerId]).toBeDefined();
      }
  });

  it("Signals covers blocks, pairs, where to put them, the three modes and routes", () => {
    const s = explainer("signals");
    const words = s.sections.map((x) => `${x.heading} ${x.text}`).join(" ");
    for (const w of ["block", "pairs", "loop", "passing", "Auto", "Always red", "Always green", "crash", "route"]) expect(words).toContain(w);
    expect(s.seeAlso).toContain("routes");
  });

  it("the Signal on the tray has one, and the old signal piece too", () => {
    expect(explainerIdFor(SIGNAL_ITEM)).toBe("signals");
    expect(explainerIdFor({ kind: "piece", type: "signal" } as TrayItem)).toBe("signals");
  });

  it("items without an entry have none (no Learn more)", () => {
    expect(explainerIdFor({ kind: "piece", type: "straight-144" } as TrayItem)).toBeNull();
    expect(explainerIdFor({ kind: "tool", tool: "raise", label: "Raise" } as TrayItem)).toBeNull();
  });

  it("every tray key it lists is a real key shape, and leads to an explainer", () => {
    expect(explainedKeys()).toContain(trayKey(SIGNAL_ITEM));
    for (const k of explainedKeys()) expect(k).toMatch(/^(signal|piece:[\w-]+|tool:\w+|road:[\w-]+|prop:[\w-]+|train:.+)$/);
  });
});
