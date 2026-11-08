import { describe, expect, it } from "vitest";
import { TECHS, built } from "../game/tech";
import { CARGO_KINDS } from "../economy/cargo";
import { INDUSTRY_GROUPS } from "../ui/tray-catalogue";
import { EXPLAINERS } from "../ui/explainers";
import { slugOf, wikiData } from "./data";
import { buildWiki, PLAY_URL, WIKI_BASE } from "./pages";

const data = wikiData();
const wiki = buildWiki(data);
const paths = new Set(wiki.pages.map((p) => p.path));

/** Resolve a relative href against a page's folder, as a wiki path ("research/junctions/"). */
function resolve(from: string, href: string): string {
  const parts = from.split("/").filter(Boolean);
  for (const seg of href.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  const out = parts.join("/");
  return out && !out.endsWith(".css") ? `${out}/` : out;
}

describe("wiki", () => {
  it("has a page for every built research row, and none for a planned one", () => {
    for (const t of TECHS.filter(built)) expect(paths.has(`research/${slugOf(t.id)}/`), t.id).toBe(true);
    const planned = TECHS.filter((t) => !built(t));
    expect(planned.length).toBeGreaterThan(0);
    for (const t of planned) expect(paths.has(`research/${slugOf(t.id)}/`), t.id).toBe(false);
  });

  it("names no planned row anywhere (no promises the game doesn't keep yet)", () => {
    const builtLabels = new Set(TECHS.filter(built).map((t) => t.label));
    // A planned row's label that isn't also the name of something built (a row, an industry, a wagon).
    const names = new Set([...builtLabels, ...data.industries.map((i) => i.name), ...data.engines.map((v) => v.name), ...data.wagons.map((v) => v.name)]);
    const planned = TECHS.filter((t) => !built(t) && !names.has(t.label)).map((t) => t.label);
    for (const p of wiki.pages) for (const label of planned) expect(p.html.includes(`>${label}<`), `${p.path} names ${label}`).toBe(false);
  });

  it("has a page for every industry on the Industries shelf", () => {
    const items = INDUSTRY_GROUPS.flatMap((g) => g.items);
    expect(data.industries.length).toBe(items.length);
    for (const i of data.industries) expect(paths.has(`industries/${i.slug}/`), i.name).toBe(true);
  });

  it("has a page for every good and every explainer, and some engines and wagons", () => {
    for (const k of CARGO_KINDS) expect(paths.has(`goods/${slugOf(k)}/`), k).toBe(true);
    for (const id of Object.keys(EXPLAINERS)) expect(paths.has(`guides/${slugOf(id)}/`), id).toBe(true);
    expect(data.engines.map((e) => e.name)).toEqual(expect.arrayContaining(["Engine", "Tank engine", "Diesel", "Electric"]));
    expect(data.wagons.map((e) => e.name)).toEqual(expect.arrayContaining(["Hopper", "Flatbed wagon", "Goods van", "Coach"]));
  });

  it("gives every page a unique path, a title and a short description", () => {
    expect(paths.size).toBe(wiki.pages.length);
    const titles = new Set<string>();
    for (const p of wiki.pages) {
      expect(p.title.length, p.path).toBeGreaterThan(5);
      expect(p.description.length, p.path).toBeGreaterThan(40);
      expect(p.description.length, p.path).toBeLessThanOrEqual(160);
      expect(titles.has(p.title), `duplicate title ${p.title}`).toBe(false);
      titles.add(p.title);
    }
  });

  it("links only to pages that exist, and every page to itch with ?ref=wiki", () => {
    for (const p of wiki.pages) {
      expect(p.html.includes(`href="${PLAY_URL}"`), p.path).toBe(true);
      for (const [, href] of p.html.matchAll(/href="([^"]+)"/g)) {
        if (/^https?:/.test(href)) {
          expect(href === PLAY_URL || href.startsWith(WIKI_BASE), `${p.path} → ${href}`).toBe(true);
          continue;
        }
        const to = resolve(p.path, href);
        expect(to === "style.css" || paths.has(to), `${p.path} → ${href}`).toBe(true);
      }
    }
  });

  it("escapes names (Carpenter's yard) and keeps scripts out", () => {
    const page = wiki.pages.find((p) => p.path === "industries/carpenter/")!;
    expect(page.html).toContain("<title>Carpenter's yard (industry) · Woodrail wiki</title>");
    for (const p of wiki.pages) expect(p.html.includes("<script"), p.path).toBe(false);
  });

  it("says what an industry makes, from what, and how fast", () => {
    const sawmill = wiki.pages.find((p) => p.path === "industries/sawmill/")!;
    expect(sawmill.html).toContain("1 load of planks every 8 seconds, from 1 load of logs");
    expect(sawmill.html).toContain('href="../../research/sawmills/"');
    const planks = wiki.pages.find((p) => p.path === "goods/planks/")!;
    expect(planks.html).toContain('href="../../industries/sawmill/"');
    expect(planks.html).toContain('href="../../wagons/flatbed-wagon/"');
  });

  it("lists every page in the sitemap", () => {
    for (const p of wiki.pages) expect(wiki.sitemap).toContain(`<loc>${WIKI_BASE}${p.path}</loc>`);
  });
});
