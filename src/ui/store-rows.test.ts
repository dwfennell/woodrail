import { describe, expect, it } from "vitest";
import { storeHtml } from "./store-rows";

describe("a warehouse's goods rows", () => {
  it("a row per good with its count and its mode in words, four choices each (the set one pressed), Any other goods, + Add a good", () => {
    const html = storeHtml({ rows: [{ kind: "planks", count: 6, cap: 24, mode: "in", listed: true }], others: "both", addable: ["log", "iron"] }, false);
    expect(html).toContain("\uE000 Planks");
    expect(html).toContain("6/24 · Takes only");
    expect(html).toContain("Any other goods");
    expect(html.match(/data-mode=/g)?.length).toBe(8);
    expect(html).toMatch(/data-kind="planks" data-mode="in" aria-pressed="true"/);
    expect(html).toMatch(/data-kind="" data-mode="both" aria-pressed="true"/);
    // Holding some: it can't be taken off the list.
    expect(html).not.toContain("data-unlist");
    expect(html).toContain("+ Add a good");
    expect(html).not.toContain("data-list=");
  });

  it("the picker open lists the goods to add; a listed good holding none can be taken off; nothing to add, no button", () => {
    const open = storeHtml({ rows: [{ kind: "planks", count: 0, cap: 24, mode: "off", listed: true }], others: "off", addable: ["log"] }, true);
    expect(open).toContain('data-list="log"');
    expect(open).toContain('data-unlist="planks"');
    expect(open).toContain("store-row closed");
    expect(storeHtml({ rows: [], others: "both", addable: [] }, false)).not.toContain("Add a good");
  });
});

describe("an industry's goods rows (the mine)", () => {
  it("two choices each, Gives and Doesn't give, no Any other goods and nothing to add", () => {
    const html = storeHtml({ gives: true, others: null, addable: [], rows: [{ kind: "coal", count: 3, cap: 12, mode: "both", listed: true }, { kind: "ore", count: 0, cap: 12, mode: "off", listed: true }] }, false);
    expect(html.match(/data-mode=/g)?.length).toBe(4);
    expect(html).toContain("3/12 · Gives");
    expect(html).toContain("0/12 · Doesn't give");
    expect(html).not.toContain("Any other goods");
    expect(html).not.toContain("Add a good");
    expect(html).not.toContain("data-unlist");
  });
});

describe("a wagon's goods rows", () => {
  it("on or off each, no counts", () => {
    const html = storeHtml({ wagon: true, others: null, addable: [], rows: [{ kind: "coal", count: 0, cap: 0, mode: "both", listed: true }, { kind: "ore", count: 0, cap: 0, mode: "off", listed: true }] }, false);
    expect(html.match(/data-mode=/g)?.length).toBe(4);
    expect(html).toContain('<span class="store-sub">Takes</span>');
    expect(html).toContain('<span class="store-sub">Off</span>');
    expect(html).not.toContain("/0");
  });
});
