import { CARGO, type CargoKind } from "../economy/cargo";
import { RECIPES, type DepotRole } from "../economy/economy";
import { kindsOf, minus, total } from "../economy/goods";
import { CELL, FEAT_NONE, FEAT_RUIN, plotSlotOf, SURF_GRASS, SURF_LANE, SURF_RIVER, SURF_ROAD, SURF_SAND, type Landscape, type MapSite, type SiteRole } from "../landscape";
import { getPieceDef, pathLength } from "../track";
import type { Footprint } from "../props/placement";
import type { Editor } from "../editor/editor";
import { costTag } from "../ui/cost-tag";
import { takeFromWorkshops, workshops, workshopStock } from "./crafting";
import { checkYard, yardMessage } from "./depot-footprint";
import { siteWhy } from "./industries";
import { CLEAR_PRICE, harbourStranded, restorePrice, restoredType, SITE_NAMES } from "./map-sites";
import type { Progress } from "./progress";
import { pieceThing } from "./things";
import { DEPOT_NAMES, type World } from "./world";

/**
 * Restoring an old industry's ruin (map sites, step 2: spec 2026-10-21-map-sites-design.md §7): its stub of track
 * becomes its industry's piece, in place, as one undoable edit. From then on it's an ordinary industry of the player's
 * (an economy depot, its rate from what's around it, its card and crane), bought as one is (`restoreRuin`).
 */

/**
 * How a restore is paid for, and given back on undo: Game mode's (`gamePayment`); Sandbox's is nothing at all. `short`
 * says what's missing (null: it can be paid now).
 */
export interface RestorePayment {
  short(): string | null;
  pay(): void;
  refund(): void;
}

/**
 * Game mode: paid as a new industry is (made at the workshop, then placed): its planks (and stone) from the workshops'
 * yards, its coins from hand, and the industry is the player's own (one more owned, so picking it up later puts it in
 * the toy box). Undone, all of it is given back: the goods to the (first) workshop's yard, the coins, the one owned.
 */
export function gamePayment(world: World, progress: Progress, role: SiteRole): RestorePayment {
  const price = restorePrice(role);
  const thing = pieceThing(restoredType(role));
  return {
    short: () => {
      if (total(price.goods) > 0 && workshops(world).length === 0) return RESTORE_NO_WORKSHOP;
      const goods = minus(price.goods, workshopStock(world));
      const coins = Math.max(0, price.coins - progress.coins);
      if (total(goods) === 0 && coins === 0) return null;
      const parts = [total(goods) > 0 ? `${costTag(goods)} more at the workshop` : "", coins > 0 ? `${costTag({}, coins)} more` : ""].filter(Boolean);
      return `Restoring needs ${parts.join(" and ")}`;
    },
    pay: () => {
      takeFromWorkshops(world, price.goods);
      progress.coins -= price.coins;
      progress.add(thing, 1);
    },
    refund: () => {
      const d = workshops(world)[0];
      if (d) for (const k of kindsOf(price.goods)) d.piles[CARGO[k].index] += price.goods[k]!;
      progress.coins += price.coins;
      progress.add(thing, -1);
    },
  };
}

/** Said when restoring wants planks and there's no workshop to take them from. */
export const RESTORE_NO_WORKSHOP = "Restoring takes planks from your workshop. Place it first";

/** Said when a train stands on the ruin's stub. */
export const RESTORE_TRAIN = "A train is on its track";

/** What a restore check needs beyond the world: a payment (none: free, as in Sandbox), and props' footprints. */
export interface RestoreOptions {
  pay?: RestorePayment;
  /** Footprints of props' models built so far (a prop whose model isn't built yet doesn't block): `checkYard`'s. */
  footprint?: (asset: string) => Footprint | undefined;
  /** Told after the restore is done, undone or redone (inside its undo step): redraw the ruins. */
  changed?: () => void;
}

/**
 * How far across its track (mm, the yard's side) a ruin's yard is: its one row of yard squares beside the stub's row
 * (`siteSquares`: square middles 72 mm out), to that row's far edge. An industry's pad reaches a few mm further (to
 * 112 mm: its 84 mm depth round 72), onto the next row, which a site doesn't keep clear: a farm's fields are planted
 * against its yard, a quarry's hillside rises there, a harbour's water lies there. Restoring checks the ground only
 * this far, so a ruin isn't refused for what it was made beside (it was, for 146 of 175 ruins round 8 starts).
 */
export const RUIN_YARD_REACH = 1.5 * CELL;

/**
 * Why this ruin can't be restored now, or null: it's gone, a train is on its stub, its industry's yard is blocked
 * (`checkYard`, its own ruin not counted) or its resource is short (`siteWhy`), or the payment is (`short`).
 */
export function restoreWhy(world: World, siteId: number, opt: RestoreOptions = {}): string | null {
  const site = world.landscape.sites?.[siteId];
  const stub = world.ruins.get(siteId);
  if (!site || site.cleared || stub === undefined) return "It's gone already";
  if (world.sim.pieceOccupied(stub)) return RESTORE_TRAIN;
  const piece = world.layout.getPiece(stub);
  if (!piece) return "It's gone already";
  const type = restoredType(site.role);
  // (The ruin's own old yard is where the new one goes: it isn't in the way of itself. Nor is what lies just past it,
  // under the few mm the industry's pad reaches beyond the ruin's row of squares: a farm's own fields, a quarry's or
  // mine's hillside, a harbour's water, which the site was made beside: `RUIN_YARD_REACH`.)
  site.cleared = true;
  let yard: string | null = null;
  try {
    const out = { what: null as string | null };
    const why = checkYard({ land: world.landscape, layout: world.layout, props: world.props, footprint: opt.footprint ?? (() => undefined) }, type, piece.pose, piece.y, stub, out, RUIN_YARD_REACH);
    if (why) yard = yardMessage(type, why, out.what);
  } finally {
    site.cleared = undefined;
  }
  if (yard) return yard;
  const site2 = siteWhy(world.landscape, type, piece.pose);
  if (site2) return site2;
  return opt.pay?.short() ?? null;
}

/**
 * Restore a ruin (its card's Restore): its stub becomes its industry's piece in place, by `editor` as one undo step
 * (`Editor.swap`). Its squares are open ground again, the site is marked restored, and it's paid for (`opt.pay`).
 * Undone: the stub and the ruin come back and the payment is given back; redone, paid again (refused if it can't be,
 * by `restoreWhy`'s payment). Returns the industry's piece, or why not.
 */
export function restoreRuin(world: World, editor: Editor, siteId: number, opt: RestoreOptions = {}): { pieceId: number } | { why: string } {
  const why = restoreWhy(world, siteId, opt);
  if (why) return { why };
  const site = world.landscape.sites![siteId];
  const stub = world.ruins.get(siteId)!;
  const g = world.landscape.grid;
  const cells: number[] = [];
  g.forEachCell((i) => {
    if (g.feature[i] === FEAT_RUIN && g.owner[i] === siteId) cells.push(i);
  });
  const slots = [...new Set(cells.map(plotSlotOf))];
  const set = (restored: boolean) => {
    site.cleared = restored ? true : undefined;
    site.restored = restored ? true : undefined;
    for (const i of cells) {
      g.feature[i] = restored ? FEAT_NONE : FEAT_RUIN;
      g.owner[i] = restored ? -1 : siteId;
    }
    if (restored) world.ruins.delete(siteId);
    else world.ruins.set(siteId, stub);
    for (const s of slots) g.touch(s);
    opt.changed?.();
  };
  const id = editor.swap(stub, restoredType(site.role), {
    done: () => {
      opt.pay?.pay();
      set(true);
    },
    undone: () => {
      opt.pay?.refund();
      set(false);
    },
    // (Redone: paid again, if it can be.)
    // (Redone onto a ruin that's gone meanwhile can't happen, as clearing is an undo step too; refused if it ever does.)
    refuse: (way) => (way !== "redo" ? null : site.cleared ? "It's gone already" : (opt.pay?.short() ?? null)),
  });
  return id === -1 ? { why: "It can't be restored now" } : { pieceId: id };
}

/** Said when undoing a clear would put the ruin back onto ground that's been used since (a field planted there). */
export const CLEAR_UNDO_USED = "Something is on that ground now";

/**
 * How clearing a ruin is paid for (Game mode: `CLEAR_PRICE` coins from hand), and given back on undo. Sandbox: free
 * (no payment).
 */
export function clearPayment(progress: Progress): RestorePayment {
  return {
    short: () => (progress.coins < CLEAR_PRICE ? `Clearing it costs ${CLEAR_PRICE} coins: you have ${progress.coins}` : null),
    pay: () => {
      progress.coins -= CLEAR_PRICE;
    },
    refund: () => {
      progress.coins += CLEAR_PRICE;
    },
  };
}

/**
 * Clear a ruin away (its card's Clear the ruin), by `editor` as one undo step (`Editor.takeUp`): its stub taken up,
 * its squares open ground, the site marked cleared, and it's paid for (`opt.pay`). Undone: the stub (the same piece)
 * and the ruin come back and the price is given back; redone, paid again (refused if it can't be). One step of the
 * history as a restore is, so Restore, Undo, Clear can't be followed by a Redo of the restore onto cleared ground.
 * The plots it changed, or why not.
 */
export function clearRuinEdit(world: World, editor: Editor, siteId: number, opt: Pick<RestoreOptions, "pay" | "changed"> = {}): { slots: number[] } | { why: string } {
  const site = world.landscape.sites?.[siteId];
  const stub = world.ruins.get(siteId);
  if (!site || site.cleared || stub === undefined || !world.layout.getPiece(stub)) return { why: "It's gone already" };
  if (world.sim.pieceOccupied(stub)) return { why: RESTORE_TRAIN };
  const short = opt.pay?.short();
  if (short) return { why: short };
  const g = world.landscape.grid;
  const cells: number[] = [];
  g.forEachCell((i) => {
    if (g.feature[i] === FEAT_RUIN && g.owner[i] === siteId) cells.push(i);
  });
  const slots = [...new Set(cells.map(plotSlotOf))];
  const set = (cleared: boolean) => {
    site.cleared = cleared ? true : undefined;
    for (const i of cells) {
      g.feature[i] = cleared ? FEAT_NONE : FEAT_RUIN;
      g.owner[i] = cleared ? -1 : siteId;
    }
    if (cleared) world.ruins.delete(siteId);
    else world.ruins.set(siteId, stub);
    for (const s of slots) g.touch(s);
    opt.changed?.();
  };
  const ok = editor.takeUp(stub, {
    done: () => {
      opt.pay?.pay();
      set(true);
    },
    undone: () => {
      opt.pay?.refund();
      set(false);
    },
    // (Undone onto ground that's been used meanwhile, by what isn't an undo step, a field planted there: refused.)
    refuse: (way) => (way === "redo" ? (opt.pay?.short() ?? null) : cells.some((i) => g.feature[i] !== FEAT_NONE || g.road[i] !== 0) ? CLEAR_UNDO_USED : null),
  });
  return ok ? { slots } : { why: "It can't be cleared now" };
}

/** "Old farm by Larkfield": a ruin by the town nearest it (just "Old farm" on a map without towns). */
export function ruinName(land: Landscape, site: MapSite): string {
  let best: string | null = null;
  let d = Infinity;
  for (const t of land.towns) {
    const e = Math.hypot(t.centre.x - site.centre.x, t.centre.z - site.centre.z);
    if (e < d) [best, d] = [t.name, e];
  }
  const name = `Old ${SITE_NAMES[site.role]}`;
  return best ? `${name} by ${best}` : name;
}

/**
 * The standing ruin of `role` nearest any of `from` (the player's line), on the land (the sites of plots the player
 * owns: the land around's are its own), restorable or locked; null if none. A harbour its boats can't reach
 * (`harbourStranded`) is passed over: it can never be restored. A few sites: cheap (only a harbour's water searched).
 */
export function nearestRuin(land: Landscape, role: SiteRole, from: readonly { x: number; z: number }[]): MapSite | null {
  let best: MapSite | null = null;
  let d = Infinity;
  for (const site of land.sites ?? []) {
    if (site.cleared || site.role !== role || harbourStranded(land, site)) continue;
    let e = from.length === 0 ? 0 : Infinity;
    for (const p of from) e = Math.min(e, Math.hypot(p.x - site.centre.x, p.z - site.centre.z));
    if (e < d) [best, d] = [site, e];
  }
  return best;
}

/** What each kind of old industry does, in a word for its payoff line ("It grows grain"). */
const MAKES: Record<SiteRole, string> = { farm: "grows", quarry: "cuts", mine: "digs up", harbour: "ships" };

/** "a, b or c" (`last` "or"), "a and b". */
const listed = (items: readonly string[], last: string) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}`);

/**
 * Where a good goes, from the recipes: the industries whose work uses it ("the mill" for grain), and "a town" if towns
 * take it. Not the depots that take anything (a harbour, a warehouse, a school's research, Sandbox's unloader).
 */
export function goodsGoTo(kind: CargoKind): string[] {
  const out: string[] = [];
  for (const role of Object.keys(RECIPES) as DepotRole[]) {
    const r = RECIPES[role];
    if (role === "town" ? r.takes.includes(kind) : (r.cycle?.uses[kind] ?? 0) > 0) out.push(role === "town" ? "a town" : `the ${DEPOT_NAMES[role].toLowerCase()}`);
  }
  return out;
}

/**
 * Said once, as a ruin is restored: what it makes, what to do next and where its goods go, from the recipes ("The farm
 * is working! It grows grain. Lay track to its siding and a train will take it to the mill."). A harbour makes
 * nothing: trains bring it goods and boats take them away.
 */
export function restoredText(role: SiteRole): string {
  const name = SITE_NAMES[role];
  const gives = RECIPES[role].gives;
  if (gives.length === 0) return `The ${name} is working! Lay track to its siding and bring it goods by train. Boats take them away.`;
  const goods = listed(
    gives.map((k) => CARGO[k].label.toLowerCase()),
    "and",
  );
  const to = listed([...new Set(gives.flatMap(goodsGoTo))], "or");
  return `The ${name} is working! It ${MAKES[role]} ${goods}. Lay track to its siding and a train will take ${gives.length > 1 ? "them" : "it"} to ${to}.`;
}

/** Said on a ruin's card when no track can be laid to it from the line (`trackCanReach`). */
export const RUIN_NO_WAY = "🚧 Track can't reach it from your line yet";

/**
 * Can track be laid from the line (any piece on the map: the player's, a station, a depot) to this ruin's stub, over
 * open ground (grass, sand, lanes, roads and rivers, a block up or down a square at most, as the map's own sites are
 * made reachable: `reachable`)? A flood fill from the stub's two ends; true where it can't tell (no stub, or its ends
 * off the land). Once as a ruin's card opens (the caller keys it by the land and the pieces), never per frame or
 * pointer move: a few thousand squares at most.
 */
export function trackCanReach(world: World, siteId: number): boolean {
  const stub = world.ruins.get(siteId);
  const piece = stub === undefined ? undefined : world.layout.getPiece(stub);
  if (!piece) return true;
  const g = world.landscape.grid;
  const stubs = new Set(world.ruins.values());
  const goal = new Set<number>();
  for (const id of world.layout.pieceIds()) {
    if (stubs.has(id)) continue;
    const p = world.layout.getPiece(id)!;
    for (const along of [0, 72]) {
      const i = g.cellAtWorld(p.pose.x + Math.cos(p.pose.heading) * along, p.pose.z + Math.sin(p.pose.heading) * along);
      if (i !== -1) goal.add(i);
    }
  }
  const len = pathLength(getPieceDef(piece.type, piece.flipped).paths[0].geom);
  const c = Math.cos(piece.pose.heading);
  const s = Math.sin(piece.pose.heading);
  const starts = [-40, len + 40].map((t) => g.cellAtWorld(piece.pose.x + c * t, piece.pose.z + s * t)).filter((i) => i !== -1);
  if (starts.length === 0) return true;
  const open = (i: number) => g.feature[i] === FEAT_NONE && (g.surface[i] === SURF_GRASS || g.surface[i] === SURF_RIVER || g.surface[i] === SURF_LANE || g.surface[i] === SURF_SAND || g.surface[i] === SURF_ROAD);
  const near = g.neighbours();
  const seen = new Uint8Array(g.cellCount);
  const stack: number[] = [];
  for (const i of starts) {
    if (goal.has(i)) return true;
    if (open(i) && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const at = stack.pop()!;
    for (let d = 0; d < 4; d++) {
      const n = near[at * 4 + d];
      if (n === -1 || seen[n] || Math.abs(g.height[n] - g.height[at]) > 1) continue;
      if (goal.has(n)) return true;
      if (!open(n)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return false;
}
