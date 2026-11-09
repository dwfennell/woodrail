import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { RECIPES } from "../economy/economy";
import { built, TECHS, unlocksOf } from "../game/tech";
import { THING_RULES } from "../game/things";
import { INDUSTRY_ROLE } from "../game/world";
import type { PieceTypeId } from "../track";
import { EXPLAINERS } from "./explainers";
import { helpPage, helpPages, helpText, type HelpLink } from "./help";
import { HELP_HOME, industryHelpRef, researchHelpRef } from "./help-link";
import { INDUSTRY_GROUPS } from "./tray-catalogue";

const pages = helpPages();
const industryTypes = INDUSTRY_GROUPS.flatMap((g) => g.items).flatMap((i) => (i.kind === "piece" ? [i.type as PieceTypeId] : []));

/** Every link on a page. */
function linksOf(ref: string): HelpLink[] {
  const p = pages.get(ref)!;
  const out: HelpLink[] = [...(p.more ?? [])];
  for (const b of p.blocks) {
    if (b.kind === "list") out.push(...b.links);
    else if (b.kind === "facts") for (const f of b.facts) out.push(...(f.links ?? []));
  }
  return out;
}

describe("in-game help", () => {
  it("an industry card's Help opens that industry's page, naming the goods it really takes and makes", () => {
    expect(industryTypes.length).toBeGreaterThan(20);
    for (const type of industryTypes) {
      const ref = industryHelpRef(type);
      expect(ref && pages.has(ref), type).toBe(true);
      const recipe = RECIPES[INDUSTRY_ROLE[type]!];
      const text = helpText(pages.get(ref!)!);
      // (A warehouse or a harbour takes almost anything: its page says so rather than listing every good.)
      if (recipe.takes.length > 12) expect(text, type).toMatch(/Almost any good/);
      else for (const k of recipe.takes) expect(text, `${type} takes ${k}`).toContain(CARGO[k].label);
      if (recipe.takes.length <= 12) for (const k of recipe.gives) expect(text, `${type} makes ${k}`).toContain(CARGO[k].label);
    }
    // The sawmill, word for word: logs in, planks out, how fast, and where they go.
    const saw = helpPage(industryHelpRef("depot-sawmill")!);
    const text = helpText(saw);
    expect(saw.title).toBe("Sawmill");
    expect(text).toContain("1 load of planks every 8 seconds, from 1 load of logs");
    const goodsIn = saw.blocks.find((b) => b.kind === "list" && b.heading === "Goods in");
    const goodsOut = saw.blocks.find((b) => b.kind === "list" && b.heading === "Goods out");
    expect(goodsIn?.kind === "list" && goodsIn.links.map((l) => l.name)).toEqual(["Logs"]);
    expect(goodsOut?.kind === "list" && goodsOut.links.map((l) => l.name)).toEqual(["Planks"]);
    expect(industryHelpRef("depot-town")).toBe(null);
  });

  it("a research ticket's Learn more opens that row's page, naming what it really unlocks", () => {
    for (const t of TECHS.filter(built)) {
      const ref = researchHelpRef(t.id);
      expect(ref && pages.has(ref), t.id).toBe(true);
      // (A wagon by its page's name: the Van as "Goods van".)
      const text = helpText(pages.get(ref!)!).toLowerCase();
      expect(pages.get(ref!)!.title).toBe(t.label);
      for (const thing of unlocksOf(t.id)) expect(text, `${t.id} unlocks ${thing}`).toContain(THING_RULES[thing]!.label.toLowerCase());
      if (t.feature) expect(text, t.id).toContain(t.feature.label.toLowerCase());
    }
    for (const t of TECHS.filter((t) => !built(t))) expect(researchHelpRef(t.id), t.id).toBe(null);
  });

  it("names no planned row anywhere (no promises the game doesn't keep yet)", () => {
    const names = new Set([...TECHS.filter(built).map((t) => t.label), ...[...pages.values()].map((p) => p.title)]);
    const planned = TECHS.filter((t) => !built(t) && !names.has(t.label));
    for (const p of pages.values()) for (const l of linksOf(p.ref)) for (const t of planned) expect(l.name, p.ref).not.toBe(t.label);
  });

  it("links only to its own pages (never out of the game), and every page is reached from the front page", () => {
    for (const p of pages.values()) for (const l of linksOf(p.ref)) if (l.ref) expect(pages.has(l.ref), `${p.ref} → ${l.ref}`).toBe(true);
    const seen = new Set<string>([HELP_HOME]);
    const todo = [HELP_HOME];
    while (todo.length) for (const l of linksOf(todo.pop()!)) if (l.ref && !seen.has(l.ref)) seen.add(l.ref), todo.push(l.ref);
    for (const ref of pages.keys()) expect(seen.has(ref), ref).toBe(true);
  });

  it("has the explainers as pages, by their ids, with their sections and see-also", () => {
    for (const x of Object.values(EXPLAINERS)) {
      const p = helpPage(x.id);
      expect(p.ref).toBe(x.id);
      expect(p.blocks.filter((b) => b.kind === "section").length).toBe(x.sections.length);
      expect((p.more ?? []).map((l) => l.ref)).toEqual(x.seeAlso ?? []);
    }
  });

  it("gives every page a title and words, and an unknown ref the front page", () => {
    for (const p of pages.values()) {
      expect(p.title.length, p.ref).toBeGreaterThan(1);
      expect(p.blocks.length, p.ref).toBeGreaterThan(0);
    }
    expect(helpPage("industries/no-such-thing").ref).toBe(HELP_HOME);
  });
});
