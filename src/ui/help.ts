import { wikiData, type Cost, type GoodData, type IndustryData, type Ref, type RowData, type Section, type VehicleData, type WikiData } from "../wiki/data";
import { costWords, cycleWords, goodWord, plural, times } from "../wiki/words";
import { EXPLAINERS, type ExplainerSection } from "./explainers";
import { HELP_HOME } from "./help-link";

/**
 * The in-game help: a page for every industry, research row, good, engine and wagon, and the explainers (Signals,
 * Routes), drawn in the "Learn more" sheet (explainer-sheet.ts). Made from the same model of the game's tables as the
 * web wiki (`src/wiki/data.ts`, `words.ts`), so the two say the same; but plain data, not HTML, and every link is to
 * another help page, never out of the game. Loaded with the sheet, the first time help is opened.
 *
 * A page's ref: an explainer's id ("signals"), a section ("industries"), a thing in one ("industries/sawmill"), or
 * `HELP_HOME` ("help").
 */

/** A link to another help page (or plain words, with no ref). */
export interface HelpLink {
  readonly name: string;
  readonly ref?: string;
  /** A good's glyph, before its name. */
  readonly icon?: string;
  /** A line under it, in a list ("From Forest · in a flatbed wagon"). */
  readonly line?: string;
}

/** A term and what it is: words, links, or both. */
export interface HelpFact {
  readonly term: string;
  readonly text?: string;
  readonly links?: readonly HelpLink[];
}

export type HelpBlock =
  | { readonly kind: "facts"; readonly heading?: string; readonly facts: readonly HelpFact[] }
  | { readonly kind: "list"; readonly heading?: string; readonly links: readonly HelpLink[] }
  | { readonly kind: "section"; readonly section: ExplainerSection };

export interface HelpPage {
  readonly ref: string;
  readonly title: string;
  /** A line under the title. */
  readonly intro?: string;
  /** Its research branch's colour, for a band under the title. */
  readonly band?: string;
  readonly blocks: readonly HelpBlock[];
  /** "More about …" links at its foot (an explainer's see-also). */
  readonly more?: readonly HelpLink[];
}

const SECTIONS: Readonly<Record<Section, { readonly title: string; readonly blurb: string }>> = {
  guides: { title: "How things work", blurb: "Signals, routes and more, with pictures." },
  industries: { title: "Industries", blurb: "What each one makes, from what, and where its goods go." },
  research: { title: "Research", blurb: "What each blueprint costs, needs and unlocks." },
  goods: { title: "Goods", blurb: "Where each good is made, who wants it and which wagon carries it." },
  engines: { title: "Engines", blurb: "How many cars each one pulls, and how fast." },
  wagons: { title: "Wagons and coaches", blurb: "What each one carries, and what it takes to have one." },
};
const ORDER: readonly Section[] = ["guides", "industries", "research", "goods", "engines", "wagons"];

/** A wiki ref as a help page's ref ("industries/sawmill"; a guide by its explainer's id). */
export const refOf = (r: Pick<Ref, "section" | "slug">): string => (r.section === "guides" ? r.slug : `${r.section}/${r.slug}`);
const linkTo = (r: Ref, line?: string, icon?: string): HelpLink => ({ name: r.name, ref: refOf(r), line, icon });

const fact = (term: string, text?: string, links?: readonly HelpLink[]): HelpFact => ({ term, text, links: links?.length ? links : undefined });
const facts = (xs: readonly (HelpFact | null | false | "" | undefined)[], heading?: string): HelpBlock => ({ kind: "facts", heading, facts: xs.filter((x): x is HelpFact => !!x) });
const list = (links: readonly HelpLink[], heading?: string): HelpBlock => ({ kind: "list", heading, links });

const costText = (c: Cost): string => {
  const w = costWords(c);
  return w === "free" ? "Free" : w;
};

// ---- pages -------------------------------------------------------------------------------------------------------

function industryPage(d: WikiData, i: IndustryData): HelpPage {
  const r = i.recipe;
  const cycle = cycleWords(r);
  const takes = r?.takes ?? [];
  const gives = r?.gives ?? [];
  // A place that takes almost every good (a warehouse, a harbour) lists none: the list would be every good.
  const many = takes.length > 12;
  const good = (k: string) => d.goods.find((g) => g.kind === k)!;
  const wagons = (g: GoodData) => (g.wagons.length ? `in a ${g.wagons.map((w) => w.name.toLowerCase()).join(" or ")}` : "no wagon carries it");
  const names = (rs: readonly Ref[]) => rs.filter((x) => x.slug !== i.slug).map((x) => x.name);
  const goodsIn = takes.map((k) => {
    const g = good(k);
    const from = names(g.madeAt);
    return linkTo(g, `${from.length ? `From ${from.join(", ")}` : "Comes another way"} · ${wagons(g)}`, g.icon);
  });
  const goodsOut = gives.map((k) => {
    const g = good(k);
    const to = [...names(g.takenBy), ...(g.towns ? ["towns"] : [])];
    return linkTo(g, `${to.length ? `To ${to.join(", ")}` : "To a warehouse or a school"} · ${wagons(g)}`, g.icon);
  });
  return {
    ref: refOf(i),
    title: i.name,
    intro: i.blurb ?? (cycle ? `Makes ${cycle}.` : undefined),
    blocks: [
      facts([
        cycle && fact("Makes", cycle),
        i.near && fact("Must stand near", i.near),
        fact("Build it for", costText(i.price)),
        i.row ? fact("Unlocked by", undefined, [linkTo(i.row)]) : fact("Unlocked by", "Known from the start"),
        many && fact("Takes", `Almost any good (${takes.length} kinds)`),
      ]),
      ...(!many && goodsIn.length ? [list(goodsIn, "Goods in")] : []),
      ...(!many && goodsOut.length ? [list(goodsOut, "Goods out")] : []),
    ],
  };
}

function rowPage(r: RowData): HelpPage {
  const unlocks = r.unlocks.map((u) => (u.ref ? linkTo(u.ref) : { name: u.name }));
  return {
    ref: refOf(r),
    title: r.name,
    intro: r.row.blurb,
    band: r.branch.color,
    blocks: [
      facts([
        fact("Branch", `${r.branch.label} · tier ${r.tier}`),
        r.row.how && fact("How to use it", `${r.row.how}.`),
      ]),
      facts(
        [
          fact("Bring to a school", r.research.goods.length ? costWords({ goods: r.research.goods, coins: 0 }) : "Nothing"),
          r.research.coins ? fact("Coins", `${r.research.coins} coins, paid when it starts`) : null,
          fact("Study time", `${r.studySeconds} seconds once its goods are in (half at a College)`),
          r.needs.length ? fact("Learn first", undefined, r.needs.map((n) => linkTo(n))) : fact("Learn first", "Nothing: you can research it from the start"),
          r.requires.length ? fact("You also need", r.requires.join(", ")) : null,
        ],
        "Researching it",
      ),
      unlocks.length ? list(unlocks, "What it unlocks") : facts([fact("What it unlocks", r.row.brings)]),
      ...(r.leadsTo.length ? [list(r.leadsTo.map((x) => linkTo(x)), "Leads to")] : []),
    ],
  };
}

function goodPage(g: GoodData): HelpPage {
  const many = g.name.endsWith("s");
  const a = (name: string): string => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
  const from = g.madeAt.length ? `${many ? "come" : "comes"} from ${g.madeAt.map((m) => a(m.name)).join(" or ")}` : g.fromTowns ? "is posted by towns" : "doesn't come from an industry of yours";
  const takenText = g.towns ? `Towns${g.takenBy.length ? " too" : ""}: deliver ${many ? "them" : "it"} to a town's station and get paid.` : g.takenBy.length ? undefined : "None";
  return {
    ref: refOf(g),
    title: g.name,
    intro: `${g.name} ${from}${g.towns ? `, and towns pay for ${many ? "them" : "it"}` : ""}.`,
    blocks: [
      facts([
        g.madeAt.length ? fact("Made at", undefined, g.madeAt.map((x) => linkTo(x))) : fact("Made at", g.fromTowns ? "Towns post it: a train picks it up at their stations" : "None of your industries: it comes another way"),
        fact("Taken by", takenText, g.takenBy.map((x) => linkTo(x))),
        g.wagons.length ? fact("Carried in", undefined, g.wagons.map((x) => linkTo(x))) : fact("Carried in", "No wagon carries it"),
        g.researchedWith.length ? fact("Research that asks for it", undefined, g.researchedWith.map((x) => linkTo(x))) : null,
      ]),
    ],
  };
}

function vehiclePage(d: WikiData, v: VehicleData): HelpPage {
  const e = v.engine;
  const carries = v.carries.map((k) => {
    const g = d.goods.find((x) => x.kind === k)!;
    return linkTo(g, undefined, g.icon);
  });
  return {
    ref: refOf(v),
    title: v.name,
    intro: v.blurb ?? (v.detail ? `${v.detail}.` : undefined),
    blocks: [
      facts([
        v.blurb && v.detail ? fact("What it does", `${v.detail}.`) : null,
        e && fact("Pulls", plural(e.pulls, "car")),
        e && fact("Top speed", times(e.speed)),
        e && fact("Gets going and stops", e.quick === 1 ? "as quickly as the classic engine" : `${e.quick}× as quickly as the classic engine`),
        e?.electric && fact("Power", "Electric: needs a spark from a power station, or runs at steam speed"),
        e?.rack && fact("Rack", "Climbs a rack railway, where other trains stop"),
        carries.length ? fact("Carries", undefined, carries) : !e ? fact("Carries", v.car === "passenger" ? "People: coaches carry riders between towns, who pay by how far they ride" : "No goods") : null,
        fact("Made at the workshop for", v.gift ? "A gift: it can't be made at the workshop" : costText(v.price)),
        v.row ? fact("Unlocked by", undefined, [linkTo(v.row)]) : fact("Unlocked by", "Known from the start"),
      ]),
    ],
  };
}

function guidePage(id: keyof typeof EXPLAINERS): HelpPage {
  const x = EXPLAINERS[id];
  return {
    ref: x.id,
    title: x.title,
    intro: x.intro,
    blocks: x.sections.map((section) => ({ kind: "section", section })),
    more: (x.seeAlso ?? []).map((o) => ({ name: `More about ${EXPLAINERS[o].title.toLowerCase()}`, ref: o })),
  };
}

function sectionPage(d: WikiData, s: Section): HelpPage {
  const { title, blurb } = SECTIONS[s];
  let blocks: HelpBlock[];
  if (s === "research") {
    const branches = [...new Map(d.rows.map((r) => [r.branch.id, r.branch])).values()];
    blocks = branches.map((b) => list(d.rows.filter((r) => r.branch.id === b.id).map((r) => linkTo(r, r.row.blurb)), b.label));
  } else if (s === "industries") {
    blocks = [list(d.industries.map((i) => linkTo(i, cycleWords(i.recipe) ?? i.blurb)))];
  } else if (s === "goods") {
    blocks = [list(d.goods.map((g) => linkTo(g, g.madeAt.length ? `Made at ${g.madeAt.map((m) => m.name).join(", ")}` : "Comes another way", g.icon)))];
  } else if (s === "engines" || s === "wagons") {
    const xs = s === "engines" ? d.engines : d.wagons;
    blocks = [list(xs.map((v) => linkTo(v, v.engine ? `Pulls ${plural(v.engine.pulls, "car")}, ${times(v.engine.speed)} speed` : v.carries.length ? `Carries ${v.carries.map(goodWord).join(", ")}` : (v.detail ?? v.blurb))))];
  } else {
    blocks = [list(d.guides.map((g) => linkTo(g, g.explainer.intro)))];
  }
  return { ref: s, title, intro: blurb, blocks };
}

function homePage(d: WikiData): HelpPage {
  const count: Record<Section, number> = { research: d.rows.length, industries: d.industries.length, goods: d.goods.length, engines: d.engines.length, wagons: d.wagons.length, guides: d.guides.length };
  return {
    ref: HELP_HOME,
    title: "Help",
    intro: "How everything in Woodrail works: tap a topic.",
    blocks: [list(d.guides.map((g) => linkTo(g, g.explainer.intro)), "How things work"), list(ORDER.filter((s) => s !== "guides").map((s) => ({ name: `${SECTIONS[s].title} (${count[s]})`, ref: s, line: SECTIONS[s].blurb })), "Everything in the game")],
  };
}

// ---- lookup ------------------------------------------------------------------------------------------------------

let pages: Map<string, HelpPage> | null = null;

/** Every help page, by ref (worked out once, the first time help is opened). */
export function helpPages(): ReadonlyMap<string, HelpPage> {
  if (pages) return pages;
  const d = wikiData();
  const all: HelpPage[] = [
    homePage(d),
    ...ORDER.filter((s) => s !== "guides").map((s) => sectionPage(d, s)),
    ...(Object.keys(EXPLAINERS) as (keyof typeof EXPLAINERS)[]).map(guidePage),
    ...d.industries.map((i) => industryPage(d, i)),
    ...d.rows.map(rowPage),
    ...d.goods.map(goodPage),
    ...d.engines.map((v) => vehiclePage(d, v)),
    ...d.wagons.map((v) => vehiclePage(d, v)),
  ];
  pages = new Map(all.map((p) => [p.ref, p]));
  return pages;
}

/** The help page `ref`, or the front page if there's none by that ref. */
export const helpPage = (ref: string): HelpPage => helpPages().get(ref) ?? helpPages().get(HELP_HOME)!;

/** A page's words, all of them, as one string (for tests: what a player can read on it). */
export function helpText(p: HelpPage): string {
  const link = (l: HelpLink) => [l.name, l.line].filter(Boolean).join(" ");
  const parts: string[] = [p.title, p.intro ?? ""];
  for (const b of p.blocks) {
    if (b.kind === "section") parts.push(b.section.heading, b.section.text);
    else if (b.kind === "list") parts.push(b.heading ?? "", ...b.links.map(link));
    else parts.push(b.heading ?? "", ...b.facts.flatMap((f) => [f.term, f.text ?? "", ...(f.links ?? []).map(link)]));
  }
  parts.push(...(p.more ?? []).map(link));
  return parts.filter(Boolean).join("\n");
}
