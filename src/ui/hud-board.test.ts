import { describe, expect, it, vi } from "vitest";
import hudSrc from "./hud.ts?raw";
import { workshopStock } from "../game/crafting";
import { Progress } from "../game/progress";
import { cardView, takeCard } from "../game/rewards";
import { buildStarterWorld, syncIndustries } from "../game/world";
import { GrowthSheet, growthSheetHtml, sheetTitle } from "./growth-sheet";
import { deliver, pick } from "../game/research";
import { pillView } from "../game/research-text";
import { Hud } from "./hud";

/** A Hud with only its Research button (a stand-in with a class list). */
function boardHud(): { hud: Hud; lit: () => boolean } {
  const classes = new Set<string>();
  const list = { toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)) };
  const hud = Object.create(Hud.prototype) as Hud;
  Object.assign(hud, { boardBtn: { classList: list }, researchPill: { classList: { toggle: () => {} } } });
  return { hud, lit: () => classes.has("active") };
}

describe("the Research button", () => {
  it("is lit while the picker is open, and never pulses for a town's reward (those are the growth sheet's now)", () => {
    const { hud, lit } = boardHud();
    hud.setBoardButton(true);
    expect(lit()).toBe(true);
    hud.setBoardButton(false);
    expect(lit()).toBe(false);
    expect(hudSrc).not.toMatch(/rewardsSeen|board-new/);
  });
});

/** A stand-in DOM element: enough for the growth sheet (its listeners can be fired by hand). */
function fakeElement() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const attrs = new Map<string, string>();
  return {
    className: "",
    hidden: false,
    type: "",
    title: "",
    innerHTML: "",
    kids: [] as unknown[],
    appendChild(k: unknown) {
      this.kids.push(k);
    },
    addEventListener(t: string, f: (e: unknown) => void) {
      listeners.set(t, [...(listeners.get(t) ?? []), f]);
    },
    setAttribute(k: string, v: string) {
      attrs.set(k, v);
    },
    getAttribute(k: string) {
      return attrs.get(k) ?? null;
    },
    fire(t: string, e: unknown) {
      for (const f of listeners.get(t) ?? []) f(e);
    },
  };
}

/** A tap on the sheet: on card `card`, on its close button, or on the shade around it. */
const tapOn = (sheet: GrowthSheet, on: { card?: number; close?: boolean; held?: boolean; shade?: boolean }) => {
  const root = sheet.root as unknown as ReturnType<typeof fakeElement>;
  const target = on.shade
    ? root
    : {
        closest: (sel: string) =>
          sel === "[data-close]" ? (on.close ? {} : null) : sel === "[data-card]" && on.card !== undefined ? { dataset: { card: String(on.card) }, getAttribute: () => (on.held ? "true" : null) } : null,
      };
  root.fire("click", { target, stopPropagation: () => {} });
};

describe("the growth sheet", () => {
  /** A player with a workshop, two towns' offers waiting, and the sheet wired as the game wires it. */
  function setup() {
    vi.stubGlobal("document", { createElement: () => fakeElement() });
    const w = buildStarterWorld();
    w.layout.addPiece("depot-workshop", { x: 3000, z: 3000, heading: 0 });
    syncIndustries(w, true);
    const p = Progress.fresh();
    p.offers.push({ from: "Larkfield", level: 2, cards: [{ kind: "planks", n: 16 }, { kind: "coins", n: 80 }, { kind: "boost", share: 0.4 }] });
    p.offers.push({ from: "Elderwick", level: 1, cards: [{ kind: "coins", n: 30 }, { kind: "wagon", id: "car:timber" }, { kind: "crate", things: [["piece:buffer-turnback", 2]] }] });
    const view = () => (p.offers.length ? { title: sheetTitle(p.offers), cards: p.offers[0].cards.map((c) => cardView(p, w, c)), more: p.offers.length - 1 } : null);
    const sheet: GrowthSheet = new GrowthSheet(fakeElement() as unknown as HTMLElement, {
      take: (i) => {
        if (takeCard(p, w, 0, i)) sheet.show(view());
      },
      close: () => {
        sheet.show(null);
        sheet.setWaiting(p.offers.length);
      },
      reopen: () => sheet.show(view()),
    });
    return { p, w, sheet, view };
  }

  it("renders three large cards, an icon, an amount and one line each, under its town's title", () => {
    try {
      const { sheet, view } = setup();
      sheet.show(view());
      const html = (sheet.root as unknown as { kids: { innerHTML: string }[] }).kids[0].innerHTML;
      expect(html).toContain("<h2>Larkfield grew! Pick one</h2>");
      expect(html.match(/data-card="/g)).toHaveLength(3);
      expect(html.match(/class="gs-icon"/g)).toHaveLength(3);
      expect(html).toContain("+16 planks");
      expect(html).toContain("+80 coins");
      // The boost with nothing being researched: held, saying why.
      expect(html).toMatch(/gs-boost held" data-card="2" aria-disabled="true">.*Pick a research that needs goods/);
      expect(html).toContain("1 more reward waiting");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("one tap takes a card (no confirm) and the next offer shows; a held card does nothing", () => {
    try {
      const { p, w, sheet, view } = setup();
      sheet.show(view());
      tapOn(sheet, { card: 2, held: true });
      expect(p.offers).toHaveLength(2);
      tapOn(sheet, { card: 0 });
      expect(workshopStock(w).planks).toBe(16);
      expect(p.offers.map((o) => o.from)).toEqual(["Elderwick"]);
      expect(sheet.open).toBe(true);
      expect((sheet.root as unknown as { kids: { innerHTML: string }[] }).kids[0].innerHTML).toContain("Elderwick grew! Pick one");
      tapOn(sheet, { card: 0 });
      expect(p.coins).toBe(30);
      expect(p.offers).toEqual([]);
      expect(sheet.open).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closed, the offer keeps waiting (the badge says so), and reopens as it was", () => {
    try {
      const { p, sheet, view } = setup();
      sheet.show(view());
      expect(sheet.badge.hidden).toBe(true);
      tapOn(sheet, { close: true });
      expect(sheet.open).toBe(false);
      expect(p.offers).toHaveLength(2);
      expect(sheet.badge.hidden).toBe(false);
      expect(sheet.badge.innerHTML).toContain("🎁");
      expect(sheet.badge.innerHTML).toContain(">2<");
      // A tap on the shade closes it too; the badge reopens it, on the same offer.
      (sheet.badge as unknown as ReturnType<typeof fakeElement>).fire("click", { stopPropagation: () => {} });
      expect(sheet.open).toBe(true);
      expect((sheet.root as unknown as { kids: { innerHTML: string }[] }).kids[0].innerHTML).toContain("Larkfield grew! Pick one");
      tapOn(sheet, { shade: true });
      expect(sheet.open).toBe(false);
      expect(p.offers).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a second offer from the same town says it grew again", () => {
    expect(sheetTitle([{ from: "Larkfield" }, { from: "Larkfield" }], 1)).toBe("Larkfield grew again! Pick one");
    expect(sheetTitle([{ from: "Elderwick" }, { from: "Larkfield" }], 1)).toBe("Larkfield grew! Pick one");
  });

  it("is written only when what it shows changes", () => {
    const v = { title: "Larkfield grew! Pick one", cards: [{ kind: "coins" as const, icon: "🪙", amount: "+30 coins", line: "To spend as you like", ok: true }], more: 0 };
    expect(growthSheetHtml(v)).toBe(growthSheetHtml({ ...v }));
    try {
      vi.stubGlobal("document", { createElement: () => fakeElement() });
      let writes = 0;
      const sheet = new GrowthSheet(fakeElement() as unknown as HTMLElement, { take: () => {}, close: () => {}, reopen: () => {} });
      const panel = (sheet.root as unknown as { kids: object[] }).kids[0];
      let html = "";
      Object.defineProperty(panel, "innerHTML", { get: () => html, set: (t: string) => ((html = t), writes++) });
      sheet.show(v);
      sheet.show({ ...v });
      expect(writes).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
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
