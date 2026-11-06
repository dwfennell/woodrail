/**
 * Goods chains, as the player sees them (Sandbox's chain hints): what an industry makes and from what, where on the map
 * its goods come from and where they can go, and whether it's working or waiting. Pure: read off the recipes and the
 * depots on the map, asked when a card opens or its piles change, or when an industry is picked up (never per frame).
 */
import { CARGO, CARRIES, type CargoKind } from "../economy/cargo";
import { needsWagonText, wagonWords } from "../economy/wagons";
import { capAt, RECIPES, storeLetsOut, type DepotRole, type DepotState } from "../economy/economy";
import type { CarKind } from "../sim";

/** The industries on Sandbox's Industries tab, by the tray's names (what "place one" points at). */
export const MAKER_LABEL: Partial<Record<DepotRole, string>> = {
  forest: "Harvester",
  sawmill: "Sawmill",
  farm: "Farm yard",
  mill: "Mill",
  dairy: "Dairy farm",
  oilwell: "Oil well",
  waterpump: "Water pump",
  bakery: "Bakery",
  orchard: "Orchard",
  beetfield: "Sugar beet field",
  jamworks: "Jam kitchen",
  flowerfield: "Flower field",
  dyeworks: "Dye works",
  glassworks: "Glassworks",
  toyworks: "Toy workshop",
  quarry: "Quarry",
  mine: "Mine",
  foundry: "Foundry",
  carpenter: "Carpenter's yard",
  smithy: "Smithy",
  power: "Power station",
  warehouse: "Warehouse",
};

/**
 * Places that pass goods along without a chain of their own (a warehouse keeps everything, a harbour's boats take
 * anything, a school or workshop is Game mode's): never named as where a good comes from or goes.
 */
const NOT_CHAIN: ReadonlySet<DepotRole> = new Set<DepotRole>(["warehouse", "harbour", "school", "workshop"]);

/** Does a depot of `role` give `kind` to trains (it makes it, or a loader's endless heap of it)? */
export function gives(role: DepotRole, kind: CargoKind): boolean {
  return !NOT_CHAIN.has(role) && RECIPES[role].gives.includes(kind);
}

/** Does a depot of `role` take `kind` from trains (to use it, or a town to grow; an unloader swallows anything)? */
export function takes(role: DepotRole, kind: CargoKind): boolean {
  return !NOT_CHAIN.has(role) && RECIPES[role].takes.includes(kind);
}

/** The Industries tab's industry that makes `kind` (for "Place a Sawmill"), or null if none does. */
export function makerOf(kind: CargoKind): string | null {
  for (const [role, label] of Object.entries(MAKER_LABEL) as [DepotRole, string][]) if (gives(role, kind) && RECIPES[role].cycle) return label;
  return null;
}

/** The wagon (the tray's name) that carries `kind`, in a sentence: "a flatbed" for logs, "a goods van or cold van". */
export function wagonFor(kind: CargoKind): string {
  const w = wagonWords(kind).toLowerCase();
  return w ? `${/^[aeiou]/.test(w) ? "an" : "a"} ${w}` : "a wagon";
}

/** A good's name in a sentence ("logs", "milk"). */
export const goodsWord = (kind: CargoKind): string => CARGO[kind].label.toLowerCase();
/** Is a good's name a plural ("logs", "planks", "tools"), for "go"/"goes" and "them"/"it"? */
const plural = (kind: CargoKind): boolean => CARGO[kind].label.endsWith("s");

/** One good in or out of a place: the nearest place on the map it comes from (or goes to), and how many others. */
export interface ChainLink {
  readonly kind: CargoKind;
  /** The nearest such place (null: none on the map). */
  readonly place: DepotState | null;
  /** How many more places besides it. */
  readonly more: number;
}

/** Working, waiting for what it uses, or full of what it makes (a train should take it). */
export type ChainState = "working" | "waiting" | "full";

export interface ChainView {
  /** Its goods in: per good it uses (a town: per good something on the map makes for it). */
  readonly inputs: readonly ChainLink[];
  /** Its goods out: per good it gives. */
  readonly outputs: readonly ChainLink[];
  /** An industry that makes something: how it's doing (null for a town, a loader, a sink). */
  readonly state: ChainState | null;
  /** The goods it's waiting for (state "waiting"), or full of (state "full"). */
  readonly short: readonly CargoKind[];
}

/** Where a depot is on the map (its piece's middle), or null if it isn't (taken up). */
export type PlaceOf = (d: DepotState) => { x: number; z: number } | null;

/** The places of `all` (on the map, not `d`) that `match`, nearest to `d` first. */
function nearest(d: DepotState, all: readonly DepotState[], placeOf: PlaceOf, match: (o: DepotState) => boolean): DepotState[] {
  const at = placeOf(d);
  if (!at) return [];
  const found: { o: DepotState; dist: number }[] = [];
  for (const o of all) {
    if (o === d || !match(o)) continue;
    const p = placeOf(o);
    if (p) found.push({ o, dist: Math.hypot(p.x - at.x, p.z - at.z) });
  }
  found.sort((a, b) => a.dist - b.dist || a.o.id - b.o.id);
  return found.map((f) => f.o);
}

const link = (kind: CargoKind, places: DepotState[]): ChainLink => ({ kind, place: places[0] ?? null, more: Math.max(0, places.length - 1) });

/**
 * The chain round depot `d`, among `all` the depots (those not on the map are skipped by `placeOf`). An industry's
 * inputs are what its recipe uses; a town's, only the goods something on the map makes (a town takes nine kinds: a
 * row for each good nobody makes would only be noise).
 */
export function chainOf(d: DepotState, all: readonly DepotState[], placeOf: PlaceOf): ChainView {
  const r = RECIPES[d.role];
  const uses = r.cycle ? (Object.keys(r.cycle.uses) as CargoKind[]) : [];
  const inputs: ChainLink[] = [];
  if (d.role === "town") {
    for (const kind of r.takes) {
      const from = nearest(d, all, placeOf, (o) => gives(o.role, kind));
      if (from.length > 0) inputs.push(link(kind, from));
    }
  } else if (!NOT_CHAIN.has(d.role)) for (const kind of uses) inputs.push(link(kind, nearest(d, all, placeOf, (o) => gives(o.role, kind))));
  // (A town's mail only once something on the map takes it: a post office.)
  const outputs = NOT_CHAIN.has(d.role) ? [] : r.gives.map((kind) => link(kind, nearest(d, all, placeOf, (o) => takes(o.role, kind)))).filter((l) => d.role !== "town" || l.place !== null);
  let state: ChainState | null = null;
  let short: CargoKind[] = [];
  const makes = r.cycle ? (Object.keys(r.cycle.makes) as CargoKind[]) : [];
  if (r.cycle && makes.length > 0 && !r.endless) {
    const cap = capAt(d);
    const full = makes.filter((k) => d.piles[CARGO[k].index] >= cap);
    const lacking = uses.filter((k) => d.piles[CARGO[k].index] < (r.cycle!.uses[k] ?? 0));
    if (lacking.length > 0) [state, short] = ["waiting", lacking];
    else if (full.length > 0) [state, short] = ["full", full];
    else state = "working";
  }
  return { inputs, outputs, state, short };
}

/** "logs", "flour and milk", "coal, ore and iron". */
export function goodsList(kinds: readonly CargoKind[]): string {
  const w = kinds.map(goodsWord);
  return w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
}

/** The status line: "Working", "Waiting for logs", "Full of planks: a train can take them". */
export function stateWords(view: ChainView): string {
  switch (view.state) {
    case "working":
      return "Working";
    case "waiting":
      return `Waiting for ${goodsList(view.short)}`;
    case "full":
      return `Full of ${goodsList(view.short)}: a train can take ${view.short.length > 1 || plural(view.short[0]) ? "them" : "it"}`;
    default:
      return "";
  }
}

/** A row of the card: its words, and the place its Show button frames (−1: no button). */
export interface ChainRow {
  readonly text: string;
  readonly show: number;
}

/**
 * The card's rows for a chain: one per good in ("🪵 Logs from the Forest yard", or "🪵 Logs: none made on the map yet.
 * Place a Harvester (Industries tab)") and per good out ("Planks go to Ashby and 4 more"). `nameOf` names a place.
 */
export function chainRows(view: ChainView, nameOf: (d: DepotState) => string, icon: (kind: CargoKind) => string): ChainRow[] {
  const rows: ChainRow[] = [];
  const more = (n: number) => (n > 0 ? ` and ${n} more` : "");
  const the = (d: DepotState) => (d.role === "town" ? nameOf(d) : `the ${nameOf(d)}`);
  for (const l of view.inputs) {
    const good = `${icon(l.kind)} ${CARGO[l.kind].label}`;
    if (l.place) rows.push({ text: `${good} from ${the(l.place)}${more(l.more)}`, show: l.place.id });
    else {
      const maker = makerOf(l.kind);
      rows.push({ text: `${good}: none made on the map yet.${maker ? ` Place a ${maker} (Industries tab)` : ""}`, show: -1 });
    }
  }
  for (const l of view.outputs) {
    const good = `${icon(l.kind)} ${CARGO[l.kind].label}`;
    if (l.place) rows.push({ text: `${good} ${plural(l.kind) ? "go" : "goes"} to ${the(l.place)}${more(l.more)}`, show: l.place.id });
    else rows.push({ text: `${good}: nothing on the map takes ${plural(l.kind) ? "them" : "it"} yet`, show: -1 });
  }
  return rows;
}

/** What a train beside a place needs to know to load there (see `loadHint`). */
export interface LoadHint {
  readonly depot: DepotState;
  readonly kind: CargoKind;
  /**
   * "wagon": none of its cars carries what's there; "off": some could, but each is switched Off for it on its card;
   * "not-stop": it's routed, with no stop there.
   */
  readonly why: "wagon" | "off" | "not-stop";
}

/**
 * A train beside a place with goods for trains that it won't load (Sandbox's chain hints, for its engine card): none of
 * its wagons carries them, or (a routed train) the place isn't one of its stops. Null if it can load something there,
 * or it's beside nowhere with goods. Cheap: a lookup per bogie, asked while its card is open.
 */
export function loadHint(
  train: { readonly cars: readonly { readonly id: number; readonly kind: CarKind }[]; readonly bogies: readonly { readonly pieceId: number }[] },
  depotAt: (pieceId: number) => DepotState | undefined,
  stops: readonly number[] | null,
  carTakes: (carId: number, kind: CargoKind) => boolean = () => true,
): LoadHint | null {
  let asked: DepotState | undefined;
  for (const b of train.bogies) {
    const d = depotAt(b.pieceId);
    if (!d || d === asked || !d.auto || NOT_CHAIN.has(d.role) || RECIPES[d.role].routedOnly) continue;
    asked = d;
    const r = RECIPES[d.role];
    // (A good the place is set not to give, on its card, isn't there for trains: its own setting says why.)
    const there = r.gives.filter((k) => (r.endless || d.piles[CARGO[k].index] > 0) && storeLetsOut(d, k));
    if (there.length === 0) continue;
    const fits = there.filter((k) => train.cars.some((c) => CARRIES[c.kind]?.includes(k)));
    if (fits.length === 0) return { depot: d, kind: there[0], why: "wagon" };
    const carried = fits.filter((k) => train.cars.some((c) => CARRIES[c.kind]?.includes(k) && carTakes(c.id, k)));
    if (carried.length === 0) return { depot: d, kind: fits[0], why: "off" };
    if (stops && !stops.includes(d.id)) return { depot: d, kind: carried[0], why: "not-stop" };
    return null;
  }
  return null;
}

/** The engine card's words for a `loadHint`: "Needs a flatbed for logs: add one to this train". */
export function loadHintText(h: LoadHint, name: string): string {
  const good = goodsWord(h.kind);
  // (`name` as the engine card names places: "the forest yard", "Ashby".)
  const the = name;
  // (Game mode's "Not dropping…" and the plan's "Not picking up…" words, turned round.)
  if (h.why === "not-stop") return `Not picking up ${good}: ${the} isn't on this route. Edit the route to add a stop here`;
  if (h.why === "off") return `Not picking up ${good}: its wagons are set to Off for ${good}. Switch them on in a wagon's card`;
  // (Wrong wagons, plainly: "Needs a flatbed for logs". Said in both modes, on the engine card and the place's card.)
  return `${needsWagonText(h.kind)}: add one to this train`;
}

/**
 * Where an industry of `role` would get its goods and send them (while one is held, to place it): every place of `all`
 * that gives what it uses, and every place that takes what it makes. `skip`: a depot to leave out (the one being moved).
 */
export function partnersOf(role: DepotRole, all: readonly DepotState[], onMap: (d: DepotState) => boolean, skip = -1): { from: DepotState[]; to: DepotState[] } {
  const r = RECIPES[role];
  if (NOT_CHAIN.has(role)) return { from: [], to: [] };
  const uses = r.cycle ? (Object.keys(r.cycle.uses) as CargoKind[]) : [];
  const from = all.filter((o) => o.id !== skip && onMap(o) && uses.some((k) => gives(o.role, k)));
  const to = all.filter((o) => o.id !== skip && onMap(o) && r.gives.some((k) => takes(o.role, k)));
  return { from, to };
}
