/**
 * The wiki's data (docs/superpowers/specs/2026-11-07-wiki-design.md): the game's own tables, read into one plain model
 * for the web pages (`pages.ts`) and the in-game help (`src/ui/help.ts`, loaded the first time help is opened, never
 * with the game). Only built research rows are in it (a planned one is a promise the game doesn't keep yet), and
 * nothing links to a planned one.
 */
import { BRANCHES, describeNeed, type Blueprint, type Branch } from "../game/blueprints";
import { costOf, STUDY_SECONDS } from "../game/research";
import { built, TECHS, unlocksOf } from "../game/tech";
import { LOOK_TECH, THING_RULES, type ThingId, type ThingRule } from "../game/things";
import { ENGINES, type EngineKind } from "../game/engines";
import { gives, takes } from "../game/chains";
import { SITE_RULES } from "../game/industries";
import { INDUSTRY_ROLE } from "../game/world";
import { CARGO, CARGO_KINDS, CARRIES, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { RECIPES, type DepotRole, type Recipe } from "../economy/economy";
import { WAGON_NAME } from "../economy/wagons";
import { INDUSTRY_GROUPS, TRAIN_ITEMS, trayKey, type TrayItem } from "../ui/tray-catalogue";
import { EXPLAINERS, type Explainer } from "../ui/explainers";
import type { CarKind, CarLook } from "../sim";
import type { PieceTypeId } from "../track";

export type Section = "research" | "industries" | "goods" | "engines" | "wagons" | "guides";

/** A page's place: its section and its slug (`research/junctions`). */
export interface Ref {
  readonly section: Section;
  readonly slug: string;
  readonly name: string;
}

/** What something costs: goods by kind, and coins. */
export interface Cost {
  readonly goods: readonly { readonly kind: CargoKind | string; readonly n: number }[];
  readonly coins: number;
}

export interface RowData extends Ref {
  readonly section: "research";
  readonly row: Blueprint;
  readonly branch: Branch;
  readonly tier: 1 | 2 | 3;
  /** What researching it takes at a school. */
  readonly research: Cost;
  readonly studySeconds: number;
  readonly needs: readonly Ref[];
  /** Achievements it asks for beyond other rows, in words ("a town", "200 loads moved"). */
  readonly requires: readonly string[];
  /** Rows that need it. */
  readonly leadsTo: readonly Ref[];
  /** What it lets you make, by name, linked where there's a page. */
  readonly unlocks: readonly { readonly name: string; readonly ref?: Ref }[];
}

export interface IndustryData extends Ref {
  readonly section: "industries";
  /** Its depot kind (none: a prop, as the wind turbine). */
  readonly role?: DepotRole;
  readonly recipe?: Recipe;
  /** What it must stand near ("trees"), if anything. */
  readonly near?: string;
  readonly price: Cost;
  readonly row?: Ref;
  /** The research row's blurb, as its description, if a row unlocks it. */
  readonly blurb?: string;
  /** Its tray picture's key (`trayKey`): `npm run wiki:pictures` saves it as `pictures/<pictureFile>`. */
  readonly picture: string;
}

export interface GoodData extends Ref {
  readonly section: "goods";
  readonly kind: CargoKind;
  readonly icon: string;
  readonly madeAt: readonly Ref[];
  readonly takenBy: readonly Ref[];
  /** Towns take it. */
  readonly towns: boolean;
  /** Towns give it (their mail). */
  readonly fromTowns: boolean;
  readonly wagons: readonly Ref[];
  /** Research rows whose cost asks for it. */
  readonly researchedWith: readonly Ref[];
}

export interface VehicleData extends Ref {
  readonly section: "engines" | "wagons";
  readonly car: CarKind;
  readonly look?: CarLook;
  /** An engine's numbers. */
  readonly engine?: EngineKind;
  /** What a wagon carries. */
  readonly carries: readonly CargoKind[];
  readonly price: Cost;
  /** Given once, never made at the workshop. */
  readonly gift: boolean;
  readonly row?: Ref;
  readonly detail?: string;
  readonly blurb?: string;
  /** Its tray picture's key, as an industry's. */
  readonly picture: string;
}

export interface GuideData extends Ref {
  readonly section: "guides";
  readonly explainer: Explainer;
  readonly seeAlso: readonly Ref[];
}

export interface WikiData {
  readonly rows: readonly RowData[];
  readonly industries: readonly IndustryData[];
  readonly goods: readonly GoodData[];
  readonly engines: readonly VehicleData[];
  readonly wagons: readonly VehicleData[];
  readonly guides: readonly GuideData[];
}

/** A slug from a game id: lower case, letters, digits and dashes. */
export const slugOf = (id: string): string => id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A page's picture's file name, in `src/wiki/pictures/` and the wiki's `pictures/` ("industries-sawmill.webp"). */
export const pictureFile = (r: Pick<Ref, "section" | "slug">): string => `${r.section}-${r.slug}.webp`;

const costFrom = (goods: Readonly<Record<string, number>>, coins = 0): Cost => ({ goods: Object.entries(goods).map(([kind, n]) => ({ kind, n })), coins });
const priceOf = (rule: ThingRule | undefined): Cost => costFrom(rule?.cost ?? {}, rule?.coins ?? 0);

/** Industries by the tray's order: depot pieces and the two props on the Industries shelf. */
const industryItems = (): { item: TrayItem & { label: string }; thing: ThingId; slug: string }[] =>
  INDUSTRY_GROUPS.flatMap((g) => g.items).flatMap((item): { item: TrayItem & { label: string }; thing: ThingId; slug: string }[] => {
    if (item.kind === "piece") return [{ item, thing: `piece:${item.type}` as ThingId, slug: slugOf(item.type.replace(/^depot-/, "")) }];
    if (item.kind === "prop") return [{ item, thing: `prop:${item.asset}` as ThingId, slug: slugOf(item.asset.replace(/^mech-/, "")) }];
    return [];
  });

/** Engines and wagons by the tray's order: single cars (a whole train, "Full train", isn't one). */
function vehicleItems(): { item: TrayItem; car: CarKind; look?: CarLook; label: string; detail?: string; engine: boolean; slug: string }[] {
  const out: { item: TrayItem; car: CarKind; look?: CarLook; label: string; detail?: string; engine: boolean; slug: string }[] = [];
  for (const item of TRAIN_ITEMS) {
    if (item.kind !== "train") continue;
    const looks = new Set(item.looks ?? []);
    // One kind of car: a single car, or the metro and Royal trains (a motor car and its cars, in one look).
    if (item.cars.length > 1 && !(looks.size === 1 && item.cars[0] === "engine")) continue;
    const car = item.cars[0];
    const look = [...looks][0];
    const engine = car === "engine";
    out.push({ item, car, look, label: item.label, detail: item.gameDetail, engine, slug: slugOf(item.label) });
  }
  return out;
}

export function wikiData(): WikiData {
  const rowsBuilt = TECHS.filter(built);
  const builtIds = new Set(rowsBuilt.map((t) => t.id));
  const rowRef = (id: string | undefined): Ref | undefined => {
    if (!id || !builtIds.has(id)) return undefined;
    const t = TECHS.find((x) => x.id === id)!;
    return { section: "research", slug: slugOf(t.id), name: t.label };
  };

  // Industries first: rows and goods link to them.
  const industries: IndustryData[] = industryItems().map(({ item, thing, slug }) => {
    const rule = THING_RULES[thing];
    const role = item.kind === "piece" ? INDUSTRY_ROLE[item.type as PieceTypeId] : undefined;
    const row = rowRef(rule?.tech);
    return {
      section: "industries",
      slug,
      name: item.label,
      role,
      recipe: role ? RECIPES[role] : undefined,
      near: role ? SITE_RULES[role]?.what : undefined,
      price: priceOf(rule),
      row,
      blurb: row ? TECHS.find((t) => t.id === rule!.tech)!.blurb : undefined,
      picture: trayKey(item),
    };
  });
  const industryByThing = new Map<ThingId, Ref>(industryItems().map(({ thing }, i) => [thing, industries[i]]));
  const industryRefs = (pick: (role: DepotRole) => boolean): Ref[] => industries.filter((d) => d.role && pick(d.role)).map(({ section, slug, name }) => ({ section, slug, name }));

  const vehicles: VehicleData[] = vehicleItems().map((v) => {
    const lookRule = v.look ? THING_RULES[`look:${v.look}` as ThingId] : undefined;
    const carRule = THING_RULES[`car:${v.car}` as ThingId];
    const rule = lookRule ?? carRule;
    const tech = (v.look ? LOOK_TECH[v.look] : undefined) ?? lookRule?.tech ?? carRule?.tech;
    const row = rowRef(tech);
    return {
      section: v.engine ? "engines" : "wagons",
      slug: v.slug,
      name: v.label,
      car: v.car,
      look: v.look,
      engine: v.engine ? (ENGINES[v.look ?? "classic"] ?? ENGINES.classic) : undefined,
      carries: [...(CARRIES[v.car] ?? [])],
      price: priceOf(rule),
      gift: rule?.gift === true,
      row,
      detail: v.detail,
      blurb: row ? TECHS.find((t) => t.id === tech)!.blurb : undefined,
      picture: trayKey(v.item),
    };
  });
  const engines = vehicles.filter((v) => v.section === "engines");
  const wagons = vehicles.filter((v) => v.section === "wagons");
  const vehicleRef = (car: CarKind, look?: CarLook): Ref | undefined => vehicles.find((v) => v.car === car && v.look === look);

  const rows: RowData[] = rowsBuilt.map((t) => {
    const cost = costOf(t.id);
    const tier = t.tier ?? 1;
    const unlocks = unlocksOf(t.id).map((thing): { name: string; ref?: Ref } => {
      const name = THING_RULES[thing]!.label;
      const ref = industryByThing.get(thing) ?? (thing.startsWith("car:") ? vehicleRef(thing.slice(4) as CarKind) : thing.startsWith("look:") ? vehicleRef("engine", thing.slice(5) as CarLook) : undefined);
      return { name, ref };
    });
    // Looks that need it (the tank engine, the dining car), which `THING_RULES` doesn't list.
    for (const [look, tech] of Object.entries(LOOK_TECH) as [CarLook, string][]) {
      if (tech !== t.id) continue;
      const ref = vehicles.find((v) => v.look === look);
      if (ref && !unlocks.some((u) => u.ref === ref)) unlocks.push({ name: ref.name, ref });
    }
    if (t.feature) unlocks.push({ name: t.feature.label });
    return {
      section: "research",
      slug: slugOf(t.id),
      name: t.label,
      row: t,
      branch: BRANCHES.find((b) => b.id === t.branch)!,
      tier,
      research: costFrom(cost.goods, cost.coins ?? 0),
      studySeconds: STUDY_SECONDS[tier],
      needs: t.needs.map(rowRef).filter((r): r is Ref => !!r),
      requires: t.requires.map(describeNeed),
      leadsTo: rowsBuilt.filter((x) => x.needs.includes(t.id)).map((x) => rowRef(x.id)!),
      unlocks,
    };
  });

  const goods: GoodData[] = CARGO_KINDS.map((kind) => ({
    section: "goods",
    slug: slugOf(kind),
    name: CARGO[kind].label,
    kind,
    icon: GOODS_ICON[kind],
    madeAt: industryRefs((role) => gives(role, kind)),
    takenBy: industryRefs((role) => role !== "town" && takes(role, kind)),
    towns: RECIPES.town.takes.includes(kind),
    fromTowns: RECIPES.town.gives.includes(kind),
    wagons: (Object.keys(CARRIES) as CarKind[]).filter((car) => CARRIES[car]!.includes(kind) && WAGON_NAME[car]).map((car) => vehicleRef(car)).filter((r): r is Ref => !!r),
    researchedWith: rows.filter((r) => r.research.goods.some((g) => g.kind === kind)),
  }));

  const guideRef = (e: Explainer): Ref => ({ section: "guides", slug: slugOf(e.id), name: e.title });
  const guides: GuideData[] = Object.values(EXPLAINERS).map((e) => ({ ...guideRef(e), section: "guides", explainer: e, seeAlso: (e.seeAlso ?? []).map((id) => guideRef(EXPLAINERS[id])) }));

  return { rows, industries, goods, engines, wagons, guides };
}

/** The tray items whose pictures the wiki shows, by file (for `npm run wiki:pictures`, which draws them in the game). */
export function wikiPictureItems(): { file: string; key: string; item: TrayItem }[] {
  const industries = industryItems().map(({ item, slug }) => ({ file: pictureFile({ section: "industries", slug }), key: trayKey(item), item }));
  const vehicles = vehicleItems().map((v) => ({ file: pictureFile({ section: v.engine ? "engines" : "wagons", slug: v.slug }), key: trayKey(v.item), item: v.item }));
  return [...industries, ...vehicles];
}
