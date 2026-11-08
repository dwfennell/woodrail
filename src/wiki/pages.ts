/**
 * The wiki's pages (docs/superpowers/specs/2026-11-07-wiki-design.md), from `wikiData()`: plain HTML, one stylesheet, no
 * scripts. Each page sits in its own folder (`research/junctions/index.html`) and links to others relatively, so the
 * same files work under any base. Pure: `npm run wiki` (scripts/wiki.mjs) writes what `buildWiki` returns.
 */
import { CARGO, type CargoKind } from "../economy/cargo";
import { pictureFile, wikiData, type Cost, type GoodData, type GuideData, type IndustryData, type Ref, type RowData, type Section, type VehicleData, type WikiData } from "./data";
import css from "./style.css?raw";

/** Where the wiki is served (canonical URLs and the sitemap). */
export const WIKI_BASE = "https://dwfennell.github.io/woodrail/wiki/";
/** Every link to play: `?ref=wiki` so itch's analytics count the wiki's players. */
export const PLAY_URL = "https://dwfennell.itch.io/woodrail?ref=wiki";

export interface Page {
  /** Its folder under the wiki, "" for the home page ("research/junctions/"). */
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly html: string;
}

const SECTIONS: Readonly<Record<Section, { readonly title: string; readonly blurb: string }>> = {
  research: { title: "Research", blurb: "Every blueprint you can learn at a school: what it costs, what it needs and what it unlocks." },
  industries: { title: "Industries", blurb: "Forests, farms, mills and factories: what each one makes, from what, and where its goods go." },
  goods: { title: "Goods", blurb: "Everything a train can carry: where it's made, who wants it and which wagon takes it." },
  engines: { title: "Engines", blurb: "How many cars each engine pulls, and how fast." },
  wagons: { title: "Wagons and coaches", blurb: "What each wagon carries, and what it takes to have one." },
  guides: { title: "Guides", blurb: "The game's own Learn more sheets: signals, routes and more." },
};
const ORDER: readonly Section[] = ["research", "industries", "goods", "engines", "wagons", "guides"];

// ---- small helpers ---------------------------------------------------------------------------------------------

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pathOf = (r: Pick<Ref, "section" | "slug">): string => `${r.section}/${r.slug}/`;

/** A link from the page at `from` to the folder `to` (both wiki paths). */
function rel(from: string, to: string): string {
  const up = from.split("/").filter(Boolean).length;
  return "../".repeat(up) + to || "./";
}

/** One sentence at most this long (a search result's snippet). */
const clip = (s: string, n = 155): string => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`);

/** Each good's own drawing (src/icons, the icon font's sources), by its glyph's code point. */
const ICONS: Readonly<Record<string, string>> = (() => {
  const files = import.meta.glob("../icons/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  const out: Record<string, string> = {};
  for (const [file, svg] of Object.entries(files)) {
    const m = /\/u([0-9A-F]+)-[^/]+\.svg$/i.exec(file);
    if (m) out[m[1].toUpperCase()] = svg;
  }
  return out;
})();

/** A good's picture, inline (its emoji if there's no drawing). Decorative: its name is always beside it. */
function goodIcon(glyph: string): string {
  const cp = glyph.codePointAt(0)?.toString(16).toUpperCase();
  const svg = cp ? ICONS[cp] : undefined;
  if (!svg) return glyph ? `<span class="icon" aria-hidden="true">${esc(glyph)}</span>` : "";
  return `<span class="icon" aria-hidden="true">${svg.replace(/<title>[^<]*<\/title>/, "").replace("<svg ", '<svg focusable="false" ')}</span>`;
}

/** The pictures there are (`npm run wiki:pictures` saves them; `npm run wiki` copies them to `pictures/`). */
const PICTURES: ReadonlySet<string> = new Set(Object.keys(import.meta.glob("./pictures/*.webp")).map((f) => f.slice("./pictures/".length)));

/** A page's picture, as an `<img>` from page `from` (its name as the alt text), or "" if it has none. */
function picture(from: string, r: Ref, cls = "pic"): string {
  const file = pictureFile(r);
  if (!PICTURES.has(file)) return "";
  return `<img class="${cls}" src="${rel(from, `pictures/${file}`).replace(/\/$/, "")}" alt="${esc(r.name)}" width="176" height="144" loading="lazy">`;
}

const goodName = (kind: string): string => (CARGO as Record<string, { label: string } | undefined>)[kind]?.label ?? kind;
const goodWord = (kind: string): string => goodName(kind).toLowerCase();

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A cost in words: "6 planks + 120 coins". */
function costWords(c: Cost): string {
  const parts = c.goods.map((g) => `${g.n} ${goodWord(g.kind)}`);
  if (c.coins) parts.push(`${c.coins} coins`);
  return parts.join(" + ") || "free";
}

/** A list of links, or `none` when empty. */
function links(from: string, refs: readonly Ref[], none = "None"): string {
  if (refs.length === 0) return `<span class="muted">${esc(none)}</span>`;
  return `<ul class="chips">${refs.map((r) => `<li><a href="${rel(from, pathOf(r))}">${esc(r.name)}</a></li>`).join("")}</ul>`;
}

function goodChips(from: string, goods: WikiData["goods"], kinds: readonly string[], n?: Readonly<Record<string, number>>): string {
  return `<ul class="chips">${kinds
    .map((k) => {
      const g = goods.find((x) => x.kind === k);
      const label = `${n?.[k] !== undefined ? `${n[k]} ` : ""}${g ? g.name.toLowerCase() : goodWord(k)}`;
      return `<li>${g ? `<a href="${rel(from, pathOf(g))}">${goodIcon(g.icon)}${esc(label)}</a>` : esc(label)}</li>`;
    })
    .join("")}</ul>`;
}

function costChips(from: string, goods: WikiData["goods"], c: Cost): string {
  if (c.goods.length === 0 && !c.coins) return `<span class="muted">Free</span>`;
  const n = Object.fromEntries(c.goods.map((g) => [g.kind, g.n]));
  const chips = c.goods.length ? goodChips(from, goods, Object.keys(n), n) : "";
  return `${chips}${c.coins ? `<ul class="chips"><li><span class="coin" aria-hidden="true">🪙</span>${c.coins} coins</li></ul>` : ""}`;
}

/** A row of facts: a term and what it is. */
const facts = (rows: readonly (readonly [string, string] | null)[]): string =>
  `<dl class="facts">${rows
    .filter((r): r is readonly [string, string] => !!r)
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
    .join("")}</dl>`;

// ---- the page frame --------------------------------------------------------------------------------------------

function frame(p: { path: string; title: string; description: string; crumbs: readonly Ref[] | null; heading: string; band?: string; body: string; image?: Ref }): Page {
  const from = p.path;
  const crumbs = p.crumbs
    ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="${rel(from, "")}">Wiki</a>${p.crumbs.map((c) => ` <span aria-hidden="true">›</span> <a href="${rel(from, c.slug ? pathOf(c) : `${c.section}/`)}">${esc(c.name)}</a>`).join("")}</nav>`
    : "";
  const fullTitle = p.path === "" ? p.title : `${p.title} · Woodrail wiki`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${WIKI_BASE}${p.path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Woodrail wiki">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(p.description)}">
${p.image && PICTURES.has(pictureFile(p.image)) ? `<meta property="og:image" content="${WIKI_BASE}pictures/${pictureFile(p.image)}">\n` : ""}<meta name="theme-color" content="#cfe3b4">
<link rel="stylesheet" href="${rel(from, "style.css").replace(/\/$/, "")}">
</head>
<body>
<header class="bar"><a class="brand" href="${rel(from, "")}"><span class="brand-mark" aria-hidden="true"></span>Woodrail wiki</a><a class="play" href="${PLAY_URL}">Play free</a></header>
<main>
${crumbs}
<article class="card"${p.band ? ` style="--band:${esc(p.band)}"` : ""}>
<h1>${p.heading}</h1>
${p.body}
</article>
<aside class="card cta"><p><strong>Woodrail</strong> is a wooden toy railway you build on a table: lay track, run trains, carry goods between forests, mills and towns, and research your way up from a single line. Free in your browser, on a phone or a computer.</p><a class="play big" href="${PLAY_URL}">Play Woodrail free</a></aside>
</main>
<footer>Made from the game's own data, so it matches the game. <a href="${PLAY_URL}">Woodrail on itch.io</a></footer>
</body>
</html>
`;
  return { path: p.path, title: fullTitle, description: p.description, html };
}

// ---- pages -----------------------------------------------------------------------------------------------------

function rowPage(d: WikiData, r: RowData): Page {
  const from = pathOf(r);
  const unlocks = r.unlocks.length
    ? `<ul class="chips">${r.unlocks.map((u) => `<li>${u.ref ? `<a href="${rel(from, pathOf(u.ref))}">${picture(from, u.ref, "chip-pic")}${esc(u.name)}</a>` : esc(u.name)}</li>`).join("")}</ul>`
    : `<p>${esc(r.row.brings)}</p>`;
  const body = `<p class="tag" style="background:${esc(r.branch.color)}">${esc(r.branch.label)} · tier ${r.tier}</p>
<p class="lead">${esc(r.row.blurb)}</p>
${r.row.how ? `<p><strong>How to use it:</strong> ${esc(r.row.how)}.</p>` : ""}
<h2>Researching it</h2>
${facts([
  ["Bring to a school", costChips(from, d.goods, { goods: r.research.goods, coins: 0 })],
  r.research.coins ? ["Coins", `${r.research.coins} coins, paid when it starts`] : null,
  ["Study time", `${r.studySeconds} seconds once its goods are in (half at a College)`],
  ["Learn first", links(from, r.needs, "Nothing: you can research it from the start")],
  r.requires.length ? ["You also need", esc(r.requires.join(", "))] : null,
])}
<h2>What it unlocks</h2>
${unlocks}
<h2>Leads to</h2>
${links(from, r.leadsTo, "Nothing yet")}`;
  const desc = clip(`${r.name} in Woodrail: ${r.row.blurb} Research it with ${costWords(r.research)}.`);
  return frame({ path: from, title: `${r.name} (research)`, description: desc, crumbs: [{ section: "research", slug: "", name: SECTIONS.research.title }], heading: esc(r.name), band: r.branch.color, body });
}

/** "1 load of planks every 8 seconds, from 1 load of logs": an industry's recipe in words. */
function cycleWords(i: IndustryData): string | null {
  const c = i.recipe?.cycle;
  if (!c || Object.keys(c.makes).length === 0) return null;
  const bag = (b: Readonly<Record<string, number | undefined>>) =>
    Object.entries(b)
      .map(([k, n]) => `${n} ${n === 1 ? "load" : "loads"} of ${goodWord(k)}`)
      .join(" and ");
  const uses = Object.keys(c.uses).length ? `from ${bag(c.uses)}` : "from nothing but the land around it";
  return `${bag(c.makes)} every ${c.seconds} seconds, ${uses}`;
}

function industryPage(d: WikiData, i: IndustryData): Page {
  const from = pathOf(i);
  const r = i.recipe;
  const made = r?.gives ?? [];
  const takesList = r?.takes ?? [];
  const cycle = cycleWords(i);
  const goodsLines = (kinds: readonly CargoKind[], dir: "in" | "out") =>
    kinds.length === 0
      ? ""
      : `<table class="flow"><thead><tr><th>${dir === "in" ? "Takes" : "Makes"}</th><th>${dir === "in" ? "Comes from" : "Goes to"}</th><th>Carried in</th></tr></thead><tbody>${kinds
          .map((k) => {
            const g = d.goods.find((x) => x.kind === k)!;
            const others = (dir === "in" ? g.madeAt : [...g.takenBy, ...(g.towns ? [{ section: "goods", slug: "", name: "Towns" } as Ref] : [])]).filter((x) => x.slug !== i.slug);
            const where = others.map((o) => (o.slug ? `<a href="${rel(from, pathOf(o))}">${esc(o.name)}</a>` : esc(o.name))).join(", ") || `<span class="muted">${dir === "in" ? "Boats or other ways (see the good)" : "A warehouse or a school"}</span>`;
            const wagons = g.wagons.map((w) => `<a href="${rel(from, pathOf(w))}">${esc(w.name)}</a>`).join(" or ") || `<span class="muted">No wagon</span>`;
            return `<tr><td><a href="${rel(from, pathOf(g))}">${goodIcon(g.icon)}${esc(g.name)}</a></td><td>${where}</td><td>${wagons}</td></tr>`;
          })
          .join("")}</tbody></table>`;
  // A place that takes every good (a warehouse, a harbour, a school) lists none: the table would be every good.
  const many = takesList.length > 12;
  const body = `${picture(from, i, "pic hero")}${i.blurb ? `<p class="lead">${esc(i.blurb)}</p>` : ""}
${facts([
  cycle ? ["Makes", esc(cycle)] : null,
  i.near ? ["Must stand near", esc(i.near)] : null,
  ["Build it for", costChips(from, d.goods, i.price)],
  ["Unlocked by", i.row ? links(from, [i.row]) : `<span class="muted">Known from the start</span>`],
  many ? ["Takes", `Almost any good (${takesList.length} kinds)`] : null,
])}
${!many && takesList.length ? `<h2>Goods in</h2>${goodsLines(takesList, "in")}` : ""}
${made.length && !many ? `<h2>Goods out</h2>${goodsLines(made, "out")}` : ""}`;
  const desc = clip(cycle ? `The ${i.name} in Woodrail makes ${cycle}. What it needs, where its goods go and how to unlock it.` : `The ${i.name} in Woodrail: ${i.blurb ?? "what it does and how to build it"}`);
  return frame({ path: from, title: `${i.name} (industry)`, description: desc, crumbs: [{ section: "industries", slug: "", name: SECTIONS.industries.title }], heading: esc(i.name), body, image: i });
}

function goodPage(g: GoodData): Page {
  const from = pathOf(g);
  const word = g.name.toLowerCase();
  const takers = [...g.takenBy];
  const many = g.name.endsWith("s");
  const a = (name: string): string => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
  const from_ = g.madeAt.length ? `${many ? "come" : "comes"} from ${g.madeAt.map((m) => a(m.name)).join(" or ")}` : g.fromTowns ? "is posted by towns" : "doesn't come from an industry of yours";
  const body = `<p class="lead">${esc(g.name)} ${esc(from_)}${g.towns ? `, and towns pay for ${many ? "them" : "it"}` : ""}.</p>
${facts([
  ["Made at", links(from, g.madeAt, g.fromTowns ? "Towns post it: a train picks it up at their stations" : "None of your industries: it comes another way")],
  ["Taken by", `${links(from, takers, g.towns ? "" : "None")}${g.towns ? `<p>Towns${takers.length ? " too" : ""}: deliver ${many ? "them" : "it"} to a town's station and get paid.</p>` : ""}`],
  ["Carried in", links(from, g.wagons, "No wagon carries it")],
  ["Research that asks for it", links(from, g.researchedWith, "None")],
])}`;
  const desc = clip(`${g.name} in Woodrail: ${g.madeAt.length ? `made at ${g.madeAt.map((m) => m.name).join(", ")}` : "how you get it"}${g.wagons.length ? `, carried in a ${g.wagons.map((w) => w.name.toLowerCase()).join(" or ")}` : ""}${g.towns ? ", and towns pay for it" : ""}. Where ${word} goes and what it's for.`);
  return frame({ path: from, title: `${g.name} (goods)`, description: desc, crumbs: [{ section: "goods", slug: "", name: SECTIONS.goods.title }], heading: `${goodIcon(g.icon)}${esc(g.name)}`, body });
}

const times = (x: number): string => (x === 1 ? "the same as the classic engine" : `${x}× the classic engine's`);

function vehiclePage(d: WikiData, v: VehicleData): Page {
  const from = pathOf(v);
  const e = v.engine;
  const made = v.gift ? `<span class="muted">A gift: it can't be made at the workshop</span>` : costChips(from, d.goods, v.price);
  const body = `${picture(from, v, "pic hero")}${v.blurb ? `<p class="lead">${esc(v.blurb)}</p>` : ""}${v.detail ? `<p>${esc(v.detail)}.</p>` : ""}
${facts([
  e ? ["Pulls", plural(e.pulls, "car")] : null,
  e ? ["Top speed", esc(times(e.speed))] : null,
  e ? ["Gets going and stops", e.quick === 1 ? "as quickly as the classic engine" : `${e.quick}× as quickly as the classic engine`] : null,
  e?.electric ? ["Power", "Electric: needs a spark from a power station, or runs at steam speed"] : null,
  e?.rack ? ["Rack", "Climbs a rack railway, where other trains stop"] : null,
  v.carries.length ? ["Carries", goodChips(from, d.goods, v.carries)] : !e ? ["Carries", v.car === "passenger" ? "People: coaches carry riders between towns, who pay by how far they ride" : `<span class="muted">No goods</span>`] : null,
  ["Made at the workshop for", made],
  ["Unlocked by", v.row ? links(from, [v.row]) : `<span class="muted">Known from the start</span>`],
])}`;
  const what = e ? `pulls ${plural(e.pulls, "car")} at ${e.speed === 1 ? "the classic speed" : `${e.speed}× the classic speed`}` : v.carries.length ? `carries ${v.carries.map(goodWord).join(", ")}` : (v.blurb ?? v.detail ?? "a wagon");
  const desc = clip(`The ${v.name} in Woodrail ${what}. ${v.row ? `Unlocked by ${v.row.name}.` : "Yours from the start."}`);
  return frame({ path: from, title: `${v.name} (${e ? "engine" : "wagon"})`, description: desc, crumbs: [{ section: v.section, slug: "", name: SECTIONS[v.section].title }], heading: esc(v.name), body, image: v });
}

function guidePage(g: GuideData): Page {
  const from = pathOf(g);
  const e = g.explainer;
  const body = `<p class="lead">${esc(e.intro)}</p>
${e.sections.map((s) => `<section class="guide"><h2>${esc(s.heading)}</h2><figure>${s.picture.replace('aria-hidden="true"', `role="img" aria-label="${esc(s.alt)}"`)}</figure><p>${esc(s.text)}</p></section>`).join("\n")}
${g.seeAlso.length ? `<h2>See also</h2>${links(from, g.seeAlso)}` : ""}`;
  return frame({ path: from, title: `${e.title} (guide)`, description: clip(`${e.title} in Woodrail: ${e.intro}`), crumbs: [{ section: "guides", slug: "", name: SECTIONS.guides.title }], heading: esc(e.title), body });
}

// ---- index pages and home ----------------------------------------------------------------------------------------

const cardList = (from: string, items: readonly { ref: Ref; line: string; icon?: string; band?: string }[]): string =>
  `<ul class="cards">${items.map((it) => `<li${it.band ? ` style="--band:${esc(it.band)}"` : ""}><a href="${rel(from, pathOf(it.ref))}">${picture(from, it.ref, "card-pic")}<strong>${it.icon ?? ""}${esc(it.ref.name)}</strong><span>${esc(it.line)}</span></a></li>`).join("")}</ul>`;

function indexPage(d: WikiData, s: Section): Page {
  const from = `${s}/`;
  let body: string;
  if (s === "research") {
    const branches = [...new Map(d.rows.map((r) => [r.branch.id, r.branch])).values()];
    body = branches
      .map((b) => `<h2 class="branch" style="--band:${esc(b.color)}">${esc(b.label)}${b.sub ? ` <small>${esc(b.sub)}</small>` : ""}</h2>${cardList(from, d.rows.filter((r) => r.branch.id === b.id).map((r) => ({ ref: r, line: r.row.blurb, band: b.color })))}`)
      .join("\n");
  } else if (s === "industries") {
    body = cardList(from, d.industries.map((i) => ({ ref: i, line: cycleWords(i) ?? i.blurb ?? "" })));
  } else if (s === "goods") {
    const raw = d.goods.filter((g) => d.industries.some((i) => i.recipe?.gives.includes(g.kind) && i.recipe.cycle && Object.keys(i.recipe.cycle.uses).length === 0));
    const rest = d.goods.filter((g) => !raw.includes(g));
    const line = (g: GoodData) => (g.madeAt.length ? `Made at ${g.madeAt.map((m) => m.name).join(", ")}` : "Comes another way");
    body = `<h2>From the land</h2>${cardList(from, raw.map((g) => ({ ref: g, line: line(g), icon: goodIcon(g.icon) })))}<h2>Made of other goods</h2>${cardList(from, rest.map((g) => ({ ref: g, line: line(g), icon: goodIcon(g.icon) })))}`;
  } else if (s === "engines" || s === "wagons") {
    const list = s === "engines" ? d.engines : d.wagons;
    body = cardList(from, list.map((v) => ({ ref: v, line: v.engine ? `Pulls ${plural(v.engine.pulls, "car")}, ${times(v.engine.speed)} speed` : v.carries.length ? `Carries ${v.carries.map(goodWord).join(", ")}` : (v.detail ?? v.blurb ?? "") })));
  } else {
    body = cardList(from, d.guides.map((g) => ({ ref: g, line: g.explainer.intro })));
  }
  const title = SECTIONS[s].title;
  return frame({ path: from, title: `${title}`, description: clip(`Woodrail ${title.toLowerCase()}: ${SECTIONS[s].blurb}`), crumbs: [], heading: esc(title), body: `<p class="lead">${esc(SECTIONS[s].blurb)}</p>${body}` });
}

function homePage(d: WikiData): Page {
  const counts: Record<Section, number> = { research: d.rows.length, industries: d.industries.length, goods: d.goods.length, engines: d.engines.length, wagons: d.wagons.length, guides: d.guides.length };
  // The goods chains: each industry that makes something of other goods, as "logs → Sawmill → planks".
  const chains = d.industries
    .filter((i) => i.recipe?.cycle && Object.keys(i.recipe.cycle.uses).length && Object.keys(i.recipe.cycle.makes).length)
    .map((i) => {
      const c = i.recipe!.cycle!;
      const g = (kinds: string[]) => goodChips("", d.goods, kinds);
      return `<li>${g(Object.keys(c.uses))}<span class="arrow" aria-hidden="true">→</span><a class="maker" href="${pathOf(i)}">${esc(i.name)}</a><span class="arrow" aria-hidden="true">→</span>${g(Object.keys(c.makes))}</li>`;
    })
    .join("");
  const body = `<p class="lead">Everything in Woodrail, the wooden toy railway game: research, industries, goods, engines and wagons. Every page is made from the game's own data.</p>
<ul class="cards sections">${ORDER.map((s) => `<li><a href="${s}/"><strong>${esc(SECTIONS[s].title)} <small>${counts[s]}</small></strong><span>${esc(SECTIONS[s].blurb)}</span></a></li>`).join("")}</ul>
<h2>Goods chains</h2>
<p>Raw goods come from the land: logs from a forest, grain from a farm, stone from a quarry. Trains carry them to the industries that turn them into something better, and on to the towns that pay for them.</p>
<ul class="chains">${chains}</ul>`;
  return frame({ path: "", title: "Woodrail wiki: research, industries, goods and trains", description: "The Woodrail wiki: every research blueprint, industry, good, engine and wagon in the wooden toy railway game, made from the game's own data.", crumbs: null, heading: "Woodrail wiki", body });
}

// ---- the whole wiki --------------------------------------------------------------------------------------------

export interface Wiki {
  readonly pages: readonly Page[];
  readonly sitemap: string;
  readonly css: string;
}

export function buildWiki(d: WikiData = wikiData()): Wiki {
  const pages: Page[] = [
    homePage(d),
    ...ORDER.map((s) => indexPage(d, s)),
    ...d.rows.map((r) => rowPage(d, r)),
    ...d.industries.map((i) => industryPage(d, i)),
    ...d.goods.map(goodPage),
    ...d.engines.map((v) => vehiclePage(d, v)),
    ...d.wagons.map((v) => vehiclePage(d, v)),
    ...d.guides.map(guidePage),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${WIKI_BASE}${p.path}</loc></url>`).join("\n")}\n</urlset>\n`;
  return { pages, sitemap, css };
}
