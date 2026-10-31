import { getPieceDef, isKit, pathLength, pieceOfRef, type Layout } from "../track";
import { ACCELERATION, SIM_DT, type Cursor, type Sim, type Train } from "../sim";
import { CARGO, CARGO_KINDS, canCarry, type CargoKind } from "./cargo";
import { ticks, CRANE_TICKS, CRAWL_SPEED, PILE_CAP, WAGON_CAPACITY } from "./constants";
import { Spacing } from "./spacing";
import type { Bag } from "./goods";
import { KitStops } from "./kit-stops";
import { Sections, type BlockWait } from "./sections";
import { Router } from "../routing/router";

const NONE = 0;
const CRAWLING = 1;
const HALTED = 2;
/** A wagon centre this close to the crane point (mm) counts as under the crane. */
const AT_CRANE = 0.5;
/** A train crawling through a depot that has stood still this long is held up short of the crane. */
const STUCK_TICKS = ticks(1);
/** A rider gets on or off a coach in this time. */
const RIDER_TICKS = ticks(0.3);

/** One train's visit to a depot. Allocated once per train and reused. */
interface Service {
  readonly trainId: number;
  phase: number;
  depotId: number;
  /** The car under the crane while halted. */
  carId: number;
  /** Ticks into the current crane move. */
  ticks: number;
  /** Ticks it has stood still while crawling (held up short of the crane). */
  still: number;
  /** Cars already served (or sent on) during this visit. */
  readonly done: Set<number>;
}

export type DepotRole = "forest" | "sawmill" | "town" | "workshop" | "farm" | "mill" | "quarry" | "warehouse" | "mine" | "foundry" | "carpenter" | "smithy" | "power" | "harbour" | "school" | KitDepotRole;

/**
 * Sandbox's cargo machines (kit pieces with a `depot`: src/track/kits.ts): a loader with an endless heap of one good,
 * and an unloader whose goods vanish into it. Sandbox has no industries to feed, so one of each makes a goods line.
 */
export type KitDepotRole = "loader-log" | "loader-grain" | "loader-coal" | "loader-planks" | "unloader";

/** The kit depot roles (for saves, and to tell them from industries'). */
export const KIT_DEPOT_ROLES: readonly KitDepotRole[] = ["loader-log", "loader-grain", "loader-coal", "loader-planks", "unloader"];

/**
 * What a kind of depot does: the goods trains bring it (unloaded onto its piles), the goods it gives them, and what it
 * makes by itself, a cycle at a time. One row per kind of industry: a new one is a row here (and a model).
 */
export interface Recipe {
  readonly takes: readonly CargoKind[];
  /**
   * Goods it takes only while the mode says some are owed (`Economy.owes`), and only as many: a workshop's stone, for
   * a harbour's price. It keeps a pile of each. None owed (or no mode to say: Sandbox), trains keep them.
   */
  readonly owed?: readonly CargoKind[];
  readonly gives: readonly CargoKind[];
  /**
   * One cycle every `seconds` (at rate 1): uses `uses` from its piles, adds `makes` to them. Runs while it has what it
   * uses and room for what it makes. `eats`: uses one of whatever it has of `takes` (a town using up its goods).
   */
  readonly cycle?: { readonly uses: Bag; readonly makes: Bag; readonly seconds: number; readonly eats?: boolean };
  /** Most units each pile holds (default `PILE_CAP`). */
  readonly cap?: number;
  /** Serves only routed trains, at their stops (it takes and gives the same goods: a train must say which). */
  readonly routedOnly?: boolean;
  /** Its piles of what it gives never run down (a Sandbox loader's endless heap): kept full. */
  readonly endless?: boolean;
  /** What it takes vanishes into it (a Sandbox unloader): its piles stay empty, so it always has room. */
  readonly sink?: boolean;
}

/**
 * Most planks (and iron) a workshop's yard holds: enough for the dearest blueprint or building (30 planks), so one
 * workshop can pay for any of them. (At 12, a blueprint of 14 planks or more could never be paid, and the planks kept
 * for it starved the towns.)
 */
export const WORKSHOP_CAP = 30;

/**
 * The share of a train's load of a good (as it left the last depot it loaded that good at) a school may take on that
 * pass while a town on its way wants the good too, and so the most a town leaves on the train for a school. QA (P4):
 * while research ran, the school took every plank; with a research short of a whole trainload or more (Bridges, 10),
 * towns got none for minutes and coins froze. Three fifths (6 of a 9-plank load): the research still fills, a pass at a
 * time, and towns earn. (Half made Cities come before minute 60 on two seeds of the balance run; spec §5.)
 */
export const SCHOOL_SHARE = 0.6;

export const RECIPES: Record<DepotRole, Recipe> = {
  forest: { takes: [], gives: ["log"], cycle: { uses: {}, makes: { log: 1 }, seconds: 15 } },
  sawmill: { takes: ["log"], gives: ["planks"], cycle: { uses: { log: 1 }, makes: { planks: 1 }, seconds: 8 } },
  town: { takes: ["planks", "flour", "stone", "iron", "furniture", "tools"], gives: [], cycle: { uses: {}, makes: {}, seconds: 30, eats: true } },
  // Takes goods in to make things from (Game mode's crafting draws on its pile; it makes nothing by itself).
  // Stone only while a harbour's price still needs some at the workshop (`owed`, `Economy.owes`): it isn't a building
  // good, so it isn't kept for its own sake, and doesn't take the towns' stone.
  workshop: { takes: ["planks", "iron"], owed: ["stone"], gives: [], cap: WORKSHOP_CAP },
  // The farm chain (Game mode): a farm yard by the fields fills hoppers with grain; a mill grinds it into flour.
  farm: { takes: [], gives: ["grain"], cycle: { uses: {}, makes: { grain: 1 }, seconds: 12 } },
  mill: { takes: ["grain"], gives: ["flour"], cycle: { uses: { grain: 1 }, makes: { flour: 1 }, seconds: 8 } },
  // Stone cut from a hillside (Game mode's quarries).
  quarry: { takes: [], gives: ["stone"], cycle: { uses: {}, makes: { stone: 1 }, seconds: 14 } },
  // Mining and iron (Phase C): a mine in the hills brings up coal and ore; a foundry makes iron of them.
  mine: { takes: [], gives: ["coal", "ore"], cycle: { uses: {}, makes: { coal: 1, ore: 1 }, seconds: 18 } },
  foundry: { takes: ["coal", "ore"], gives: ["iron"], cycle: { uses: { coal: 1, ore: 1 }, makes: { iron: 1 }, seconds: 10 } },
  // Made goods: a carpenter's yard makes furniture of planks, a smithy tools of iron.
  carpenter: { takes: ["planks"], gives: ["furniture"], cycle: { uses: { planks: 3 }, makes: { furniture: 1 }, seconds: 12 } },
  smithy: { takes: ["iron"], gives: ["tools"], cycle: { uses: { iron: 2 }, makes: { tools: 1 }, seconds: 14 } },
  // A power station burns coal; while it has some, electric engines run.
  power: { takes: ["coal"], gives: [], cycle: { uses: { coal: 1 }, makes: {}, seconds: 60 } },
  // A harbour (Game mode) takes any good onto its quay for the boats that call by themselves (`src/game/harbours.ts`).
  harbour: { takes: [...CARGO_KINDS], gives: [] },
  // A school (Game mode's research): goods go into the research, not onto piles. What it takes is the mode's say
  // (`accepts`: only what the research still lacks); each unit is handed to `intoSink` as it lands.
  school: { takes: CARGO_KINDS.filter((k) => k !== "log"), gives: [], cap: WORKSHOP_CAP, sink: true },
  // Keeps goods for later: everything, more of it. Routed trains drop or pick up there as their stops say.
  warehouse: { takes: [...CARGO_KINDS], gives: [...CARGO_KINDS], cap: 24, routedOnly: true },
  // Sandbox's cargo machines: an endless heap of one good, and somewhere goods vanish.
  "loader-log": { takes: [], gives: ["log"], endless: true },
  "loader-grain": { takes: [], gives: ["grain"], endless: true },
  "loader-coal": { takes: [], gives: ["coal"], endless: true },
  "loader-planks": { takes: [], gives: ["planks"], endless: true },
  unloader: { takes: [...CARGO_KINDS], gives: [], sink: true },
};

/** The piles a kind of depot keeps: what it takes and what it gives. */
/** Most units a pile of this kind of depot holds. */
export function capOf(role: DepotRole): number {
  return RECIPES[role].cap ?? PILE_CAP;
}

/** What a harbour's dock shed adds to each of its piles (Game mode; up to `MAX_SHEDS`). */
export const SHED_CAP = 12;
export const MAX_SHEDS = 3;

/** How much each pile of this depot holds: its kind's, and its dock sheds' (a harbour's). */
export function capAt(d: DepotState): number {
  return capOf(d.role) + d.sheds * SHED_CAP;
}

export function pilesOf(role: DepotRole): CargoKind[] {
  const r = RECIPES[role];
  return CARGO_KINDS.filter((k) => r.takes.includes(k) || r.gives.includes(k) || !!r.owed?.includes(k));
}

/**
 * What a train does at a stop on its route: only drop goods off, only pick goods up, or ("auto", a line's default)
 * what the line's stops call for: it drops what this stop takes and picks up what a later stop takes (the intent
 * rules: `Economy.dropsAt`, `picksAt`). "both" (older routes) is "auto", as the engine card shows it.
 */
export type StopAction = "auto" | "both" | "drop" | "pick";

/** A stop on a route: the depot, what the train does there, and (lines) whether it waits there to fill. */
export interface RouteStopDef {
  depotId: number;
  action: StopAction;
  waitFill?: boolean;
}

/**
 * A line: a route with a colour and a name, run by a train (Phase 2: several). Its `stops` are the very array its
 * trains' routes hold, so an edit to the line is the trains' route at once. Kept by the economy (`lines`, and which
 * engine runs which: `lineIdOf`); made and edited through src/game/lines.ts.
 */
export interface Line {
  readonly id: number;
  colour: string;
  name: string;
  readonly stops: RouteStopDef[];
}

/** What the economy's intent rules read of a car's line (see `lineOfCar`). */
export interface LineView {
  stops: { depot: number; intent: "auto" | "drop" | "pick"; waitFill: boolean }[];
}

/**
 * A train's route: the depots it stops at, in order, and what it does at each. A routed train is served only at the
 * stop it's heading for, `next` (stops in a row at one depot are one visit), and the switches ahead of it are set
 * toward it (see `steer`); passing that stop moves `next` on.
 */
export interface Route {
  stops: RouteStopDef[];
  /** The stop it's heading for (an index into `stops`). */
  next: number;
  /** It's at its next stop now (it moves on to the one after when it leaves). */
  at?: boolean;
}

export interface DepotState {
  readonly id: number;
  readonly pieceId: number;
  readonly role: DepotRole;
  /**
   * The town a station depot belongs to (−1 for goods depots); a halt's, the town nearest it (set again when it moves:
   * `syncHalts`).
   */
  townId: number;
  /** Load and unload trains by itself. */
  auto: boolean;
  /** Trains wait under the crane until each wagon is full. */
  waitFull: boolean;
  /**
   * A workshop that takes all the planks a train brings, up to its yard's cap, though a town further on wants them
   * ("Takes all planks"); false (the default), it shares: `shopKeeps` says how many it keeps.
   */
  takesAll: boolean;
  /** Units on each pile, by cargo index. */
  readonly piles: Int32Array;
  /** Ticks into the current production (forest, sawmill) or use (town) cycle. */
  timer: number;
  /** How fast it makes things, against its recipe (an industry near fewer of its resource is slower; 0 stops it). */
  rate: number;
  /** Where wagons stop for the crane: distance (mm) from the depot path's `from` end. */
  readonly craneAt: number;
  /** People waiting at a town's station for a coach (Game mode's passengers). */
  waiting: number;
  /** Dock sheds beside a harbour's quay (Game mode): each holds more of every good (see `capAt`). */
  sheds: number;
}

/** People riding a coach: how many, and the station (depot id) they got on at. */
export interface Riders {
  count: number;
  from: number;
}

export interface CarCargo {
  kind: CargoKind | null;
  count: number;
}

/** A crane move in progress (filled in by `Economy.craneMove`; allocate one per caller and reuse it). */
export interface CraneMove {
  kind: CargoKind;
  /** From the wagon to a pile (true), or the other way. */
  toPile: boolean;
  carId: number;
  /** 0–1 through the move. */
  phase: number;
}

/** Something the crane did this tick (for sounds and small effects). */
export interface EconomyEvent {
  readonly kind: "loaded" | "unloaded";
  readonly depotId: number;
  readonly cargo: CargoKind;
}

export type CargoSlot = { readonly kind: "pile"; readonly depotId: number; readonly cargo: CargoKind } | { readonly kind: "car"; readonly carId: number };

/**
 * What a line's later stops take, seen from one of its stops: the line's other stops, round the line from it, leaving
 * out every stop at its own depot (a line doesn't pick up at A what only A takes). Cargo bitmasks by cargo index.
 * Only stops that may drop (not "pick") at automatic depots still on the map count. See `Economy.laterOf`.
 */
interface Later {
  /** Goods some later stop takes, a warehouse counting (it keeps whatever it's given). */
  takes: number;
  /** Goods some later stop other than a warehouse takes: somewhere they're used. */
  uses: number;
  /** Goods a later workshop takes (it has the first claim on them while they're `reserved`). */
  shop: number;
  /**
   * Goods a later school takes (what its research still lacks) before any later stop but a town's or a workshop's
   * does: a town or a workshop leaves them on the train for it, as much as the research lacks (`keptForSchool`).
   */
  school: number;
  /** A later stop is a town's station (riders have somewhere to get off). */
  town: boolean;
  /** Goods some later town takes (it wants them): a school takes only its share of them (`SCHOOL_SHARE`). */
  towns: number;
}

/** `Later` for each stop of one stop list, and what it was worked out from (see `Economy.laterOf`). */
interface LaterCache {
  stamp: number;
  wants: number;
  accepts: Economy["accepts"];
  pieces: number;
  readonly at: Later[];
}

const EMPTY: CarCargo = { kind: null, count: 0 };
const NO_RIDERS: Riders = { count: 0, from: -1 };

/**
 * Depots, their piles and the cargo riding on wagons. Pure and deterministic: everything advances in whole sim
 * ticks from `tick()`, called once after every `Sim.tick()`.
 */
export class Economy {
  private readonly depots: DepotState[] = [];
  private readonly byPiece = new Map<number, DepotState>();
  private readonly cargo = new Map<number, CarCargo>();
  /** Coach car id → the people riding it. */
  private readonly riders = new Map<number, Riders>();
  /** Engine car id → its train's route (see `Route`). Trains with none are served at any depot they pass. */
  private readonly routes = new Map<number, Route>();
  /** Lines by id (see `Line`), and the line each engine runs. */
  readonly lines = new Map<number, Line>();
  readonly lineIdOf = new Map<number, number>();
  /** Town id → plank bundles delivered there (by train or by hand). */
  readonly delivered = new Map<number, number>();
  /** Town id → everything delivered there, by kind (planks are counted in `delivered` too). */
  readonly deliveredGoods = new Map<number, Bag>();
  private readonly services = new Map<number, Service>();
  /** Each stop list's `Later`s (see `laterOf`), and the counters they're keyed on. */
  private readonly laterCache = new WeakMap<readonly RouteStopDef[], LaterCache>();
  /** Bumped when a route is set (a line edited) or a depot's Automatic changes. */
  private stopsStamp = 0;
  /** Bumped when goods reach a town (what it still wants may change). */
  private wantsStamp = 0;
  private events: EconomyEvent[] = [];
  /** The other half of the event double buffer (no new array each drain). */
  private drained: EconomyEvent[] = [];
  /** Trains stopping at kit pieces' stops (a platform's dwell: see `KitStops`). */
  readonly kitStops: KitStops;

  constructor(
    readonly layout: Layout,
    readonly sim: Sim,
  ) {
    // A kit with a depot on it (Game mode's halts) stops trains as the depot does, for its work: not for its dwell too.
    this.kitStops = new KitStops(layout, sim, (pieceId) => this.byPiece.has(pieceId));
    sim.speedCap = (train) => this.capFor(train);
    this.sections = new Sections(layout, sim, {
      lineOf: (engine) => {
        const id = this.lineIdOf.get(engine);
        return id !== undefined && this.lines.has(id) && this.routes.has(engine) ? id : -1;
      },
      live: (lineId) => {
        const live: number[] = [];
        for (const [engine, id] of this.lineIdOf) {
          if (id !== lineId || !this.routes.has(engine)) continue;
          const found = this.sim.findCar(engine);
          if (found && !found.train.derailed) live.push(engine);
        }
        return live;
      },
      target: (engine) => {
        const r = this.routes.get(engine);
        if (!r || r.stops.length === 0) return -1;
        let i = r.next % r.stops.length;
        // (At its stop: the stop after, a different depot.)
        if (r.at) {
          const here = r.stops[i].depotId;
          for (let k = 0; k < r.stops.length && r.stops[i].depotId === here; k++) i = (i + 1) % r.stops.length;
        }
        const d = this.depots[r.stops[i].depotId];
        return d && this.onMap(d) ? d.pieceId : -1;
      },
      stopPieces: (lineId) => {
        const line = this.lines.get(lineId);
        const out: number[] = [];
        for (const st of line?.stops ?? []) {
          const d = this.depots[st.depotId];
          if (d && this.onMap(d) && out[out.length - 1] !== d.pieceId) out.push(d.pieceId);
        }
        if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
        return out;
      },
      drive: (train) => this.drive(train),
      atStop: (engine) => !!this.routes.get(engine)?.at,
      routeWait: (engine) => this.router.waitingOn(engine),
      skipStops: (engine, pieces) => {
        const r = this.routes.get(engine);
        if (!r || r.stops.length === 0 || r.at) return;
        // (On to the first stop not on those pieces; all of them on it: as it was.)
        let i = r.next % r.stops.length;
        for (let k = 0; k < r.stops.length; k++) {
          const d = this.depots[r.stops[i].depotId];
          if (!d || !pieces.has(d.pieceId)) {
            r.next = i;
            return;
          }
          i = (i + 1) % r.stops.length;
        }
      },
    });
    this.router = new Router({
      layout,
      sim,
      routed: this.routes,
      goal: (engine) => {
        const r = this.routes.get(engine)!;
        const d = this.depots[r.stops[r.next % r.stops.length].depotId];
        return d && this.onMap(d) ? d.pieceId : -1;
      },
      drive: (train) => this.drive(train),
      granted: (engine) => this.sections.steerHint(engine),
      awaitingGrant: (engine) => this.sections.awaitingGrant(engine),
      soon: this.sections.steerSoon,
    });
  }

  /**
   * Trains of a line that wait for each other (see sections.ts): a train in a slot (a passing loop's road, a line end)
   * goes on into the single track ahead only holding it and a slot at its far end.
   */
  readonly sections: Sections;
  /** Which way routed trains go, and the points set for them (and lever taps on points): see routing/router.ts. */
  readonly router: Router;

  /** Why a routed engine is held by sections (null: it isn't). */
  sectionWait(engine: number): BlockWait | null {
    return this.sections.waitOf(engine);
  }

  /** Register a depot on a piece. `craneAt` defaults to the middle of the piece's track. */
  addDepot(role: DepotRole, pieceId: number, townId = -1, craneAt?: number): DepotState {
    const p = this.layout.getPiece(pieceId);
    const len = p ? pathLength(getPieceDef(p.type, p.flipped).paths[0].geom) : 216;
    const d: DepotState = { id: this.depots.length, pieceId, role, townId, auto: true, waitFull: false, takesAll: false, piles: new Int32Array(CARGO_KINDS.length), timer: 0, rate: 1, craneAt: craneAt ?? len / 2, waiting: 0, sheds: 0 };
    // An endless heap is full from the start.
    if (RECIPES[role].endless) for (const k of RECIPES[role].gives) d.piles[CARGO[k].index] = capAt(d);
    this.depots.push(d);
    this.byPiece.set(pieceId, d);
    return d;
  }

  depot(id: number): DepotState | undefined {
    return this.depots[id];
  }

  depotAtPiece(pieceId: number): DepotState | undefined {
    return this.byPiece.get(pieceId);
  }

  /**
   * The depots on the map: those whose piece is on the layout. A depot whose piece is taken up (its placement undone,
   * the piece removed) is kept, piles and all, under its id and piece, and is back here when the piece is (redo); while
   * it's gone it makes nothing, no train is served or steered there, and nothing counts it (QA: an undone Harvester
   * stayed listed). Worked out again only when pieces come or go.
   */
  allDepots(): readonly DepotState[] {
    if (this.liveVersion !== this.layout.piecesVersion || this.liveOf !== this.depots.length) {
      this.liveVersion = this.layout.piecesVersion;
      this.liveOf = this.depots.length;
      this.live = this.depots.filter((d) => this.layout.getPiece(d.pieceId));
    }
    return this.live;
  }
  private live: DepotState[] = [];
  private liveVersion = -1;
  private liveOf = -1;

  /**
   * Does this car's train keep its `kind` on board for a school, at a town or a workshop? While a school takes it from
   * trains (its research lacks some: `sinkWants`), a train keeps as many as the research lacks and a town or workshop
   * takes only the rest (QA: a school past a station got no planks, the town before it taking them all; P5: nor past a
   * workshop, whose yard filled while research waited). A routed train keeps them while its line comes to a school
   * that takes them before anywhere else but a town or workshop that does (`Later.school`); an unrouted one while an
   * automatic school taking them is on its track (joined to it). A workshop still gets what it keeps for its waiting
   * tray order (`reserved`). Cheap: lookups and the train's cars, only at a town or workshop and only while the
   * research lacks this good.
   */
  private keptForSchool(carId: number, kind: CargoKind, route: Route | null, atTown = false): boolean {
    const want = this.sinkWants?.(kind) ?? 0;
    if (want <= 0) return false;
    const found = this.sim.findCar(carId);
    if (!found) return false;
    if (route) {
      if (!(this.laterOf(route.stops, route.next % route.stops.length).school & (1 << CARGO[kind].index))) return false;
    } else {
      const all = this.allDepots();
      if (this.schoolsOf !== all) {
        this.schoolsOf = all;
        this.schools = all.filter((d) => d.role === "school");
      }
      const net = this.networkOf(found.train.bogies[0].pieceId);
      if (!this.schools.some((d) => d.auto && this.networkOf(d.pieceId) === net && (!this.accepts || this.accepts(d, kind)))) return false;
    }
    // At a town (it wants them), no more than what's left of the school's share this pass (`SCHOOL_SHARE`).
    const keep = atTown ? Math.min(want, this.schoolShareLeft(found.train, kind)) : want;
    return this.onBoard(found.train, kind) <= keep;
  }

  /** How many of `kind` a train has on board. */
  private onBoard(train: Train, kind: CargoKind): number {
    let on = 0;
    for (const car of train.cars) {
      const c = this.cargo.get(car.id);
      if (c?.kind === kind) on += c.count;
    }
    return on;
  }

  /**
   * Per train, by cargo index: how many it had on board as it last loaded that good (its pass's load), and how many of
   * them schools have taken since. Not saved: after a load it starts from what's on board.
   */
  private readonly passes = new Map<number, { loaded: Int32Array; school: Int32Array }>();

  private passOf(train: Train, kind: CargoKind): { loaded: Int32Array; school: Int32Array } {
    let p = this.passes.get(train.id);
    if (!p) {
      p = { loaded: new Int32Array(CARGO_KINDS.length).fill(-1), school: new Int32Array(CARGO_KINDS.length) };
      this.passes.set(train.id, p);
    }
    const i = CARGO[kind].index;
    if (p.loaded[i] < 0) p.loaded[i] = this.onBoard(train, kind);
    return p;
  }

  /** What's left of a school's share (`SCHOOL_SHARE`) of this train's `kind` on this pass. */
  private schoolShareLeft(train: Train, kind: CargoKind): number {
    const p = this.passOf(train, kind);
    const i = CARGO[kind].index;
    return Math.max(0, Math.ceil(p.loaded[i] * SCHOOL_SHARE) - p.school[i]);
  }

  /**
   * Does a town this car's train goes on to want `kind`? A routed train: a later stop of its line is a town taking it;
   * an unrouted one: an automatic town on its track (joined to it) takes it. Asked at a school, while its research
   * lacks the good, and at a workshop whose yard holds what it keeps (`shopKeeps`).
   */
  private townWantsAhead(carId: number, kind: CargoKind, route: Route | null): boolean {
    const found = this.sim.findCar(carId);
    if (!found) return false;
    if (route) return !!(this.laterOf(route.stops, route.next % route.stops.length).towns & (1 << CARGO[kind].index));
    const net = this.networkOf(found.train.bogies[0].pieceId);
    return this.allDepots().some((d) => d.role === "town" && d.auto && this.networkOf(d.pieceId) === net && (!this.accepts || this.accepts(d, kind)));
  }
  private schools: DepotState[] = [];
  private schoolsOf: readonly DepotState[] | null = null;

  /**
   * Which track network (pieces joined to one another) a piece is on: a number shared by every piece of it. Worked out
   * again only when joints are made or parted, or pieces come or go.
   */
  private networkOf(pieceId: number): number {
    const l = this.layout;
    if (this.netJoints !== l.jointsVersion || this.netPieces !== l.piecesVersion) {
      this.netJoints = l.jointsVersion;
      this.netPieces = l.piecesVersion;
      const up = new Map<number, number>();
      const root = (id: number): number => {
        if (!up.has(id)) up.set(id, id);
        let r = id;
        while (up.get(r) !== r) r = up.get(r)!;
        // Point the way there straight at the root, so a long line stays quick.
        let c = id;
        while (c !== r) {
          const u = up.get(c)!;
          up.set(c, r);
          c = u;
        }
        return r;
      };
      for (const id of l.pieceIds()) up.set(id, id);
      for (const j of l.joints()) {
        const a = root(pieceOfRef(j.a));
        const b = root(pieceOfRef(j.b));
        if (a !== b) up.set(a, b);
      }
      this.nets.clear();
      for (const id of l.pieceIds()) this.nets.set(id, root(id));
    }
    return this.nets.get(pieceId) ?? -1;
  }
  private readonly nets = new Map<number, number>();
  private netJoints = -1;
  private netPieces = -1;

  /** Is this depot on the map (its piece on the layout), not one whose piece was taken up? */
  onMap(d: DepotState): boolean {
    return this.layout.getPiece(d.pieceId) !== undefined;
  }

  cargoOf(carId: number): Readonly<CarCargo> {
    return this.cargo.get(carId) ?? EMPTY;
  }

  /** Put cargo straight onto a car (saves, tests). */
  /** Bumped whenever a wagon's goods or a coach's riders change: what shows loads redraws only then. */
  loadsVersion = 0;

  setCargo(carId: number, kind: CargoKind | null, count: number): void {
    this.loadsVersion++;
    if (count <= 0 || kind === null) {
      this.cargo.delete(carId);
      this.landedFrom.delete(carId);
    } else this.cargo.set(carId, { kind, count: Math.min(count, this.wagonCapacity) });
  }

  ridersOf(carId: number): Readonly<Riders> {
    return this.riders.get(carId) ?? NO_RIDERS;
  }

  /** Put people straight onto a coach (saves, tests): `count` who got on at depot `from`. */
  setRiders(carId: number, count: number, from: number): void {
    this.loadsVersion++;
    if (count <= 0) this.riders.delete(carId);
    else this.riders.set(carId, { count, from });
  }

  /**
   * Seats in a car (Game mode sets it: coaches by their look). Null, or 0 seats: it carries no one, and trains don't
   * stop at stations for it (Sandbox).
   */
  seatsOf: ((carId: number) => number) | null = null;

  /** Someone got off a coach at station `to`, having got on at `from` (Game mode pays their fare). */
  onAlight: ((from: DepotState, to: DepotState, carId: number) => void) | null = null;

  /** Would someone on this coach get off here: a town's station other than where they got on (a stop to drop at)? */
  private canAlight(d: DepotState, carId: number): boolean {
    const r = this.riders.get(carId);
    // (A town's halts are its stops too: no one gets off in the town they got on in.)
    if (!r || d.role !== "town" || this.townOf(r.from) === d.townId) return false;
    const route = this.routeOfCar(carId);
    return !route || this.dropsAt(route, d, null);
  }

  /** Would someone waiting here get on this coach: a free seat, and no one aboard bound from another town? */
  private canBoard(d: DepotState, carId: number): boolean {
    if (d.role !== "town" || d.waiting <= 0 || !this.seatsOf) return false;
    const r = this.riders.get(carId);
    if (r && (this.townOf(r.from) !== d.townId || r.count >= this.seatsOf(carId))) return false;
    if (!r && this.seatsOf(carId) <= 0) return false;
    const route = this.routeOfCar(carId);
    return !route || this.picksAt(route, d, null);
  }

  /** The town a passenger stop (a station's depot, or a halt's) is for, by its depot id: −1 for none. */
  private townOf(depotId: number): number {
    return this.depots[depotId]?.townId ?? -1;
  }

  /**
   * Is this a halt: a town's passenger stop on a kit piece (Game mode's halts and small stations, `HALT_KITS`), not
   * its station? People get on and off there as at the station, but it takes no goods.
   */
  isHalt(d: DepotState): boolean {
    if (d.role !== "town") return false;
    const p = this.layout.getPiece(d.pieceId);
    return !!p && isKit(p.type);
  }

  setAuto(depotId: number, on: boolean): void {
    const d = this.depots[depotId];
    if (d && d.auto !== on) {
      d.auto = on;
      this.stopsStamp++;
    }
  }

  setWaitFull(depotId: number, on: boolean): void {
    const d = this.depots[depotId];
    if (d) d.waitFull = on;
  }

  /** A workshop takes all the planks trains bring (true), or shares them with towns further on (`takesAll`). */
  setTakesAll(depotId: number, on: boolean): void {
    const d = this.depots[depotId];
    if (d) d.takesAll = on;
  }

  /** Can a pile hold this cargo (it is the depot's input or output) and is there room? */
  pileAccepts(d: DepotState, kind: CargoKind): boolean {
    const r = RECIPES[d.role];
    // A sink the mode has a say in (a school) takes by hand only what it would take from a train: nothing is lost in it.
    if (r.sink && this.intoSink && this.accepts && !this.accepts(d, kind)) return false;
    return (this.takesNow(d, kind) || r.gives.includes(kind)) && d.piles[CARGO[kind].index] < capAt(d);
  }

  /** Can this car take one more unit of `kind`? */
  carAccepts(carId: number, kind: CargoKind): boolean {
    const found = this.sim.findCar(carId);
    if (!found || !canCarry(found.train.cars[found.index].kind, kind)) return false;
    const c = this.cargoOf(carId);
    return c.count < this.wagonCapacity && (c.kind === null || c.kind === kind);
  }

  /**
   * Where a unit tapped (not dragged) goes: from a depot's pile onto a wagon standing beside it (one already part
   * filled with it first, then the nearest the crane), or from a wagon onto the pile of a depot it stands at. Null
   * when there's nowhere it can go.
   */
  tapTarget(from: CargoSlot): CargoSlot | null {
    if (from.kind === "pile") {
      const d = this.depots[from.depotId];
      if (!d || d.piles[CARGO[from.cargo].index] <= 0) return null;
      const kind = from.cargo;
      let best: { carId: number; score: number } | null = null;
      for (const id of this.sim.trainIds()) {
        const train = this.sim.getTrain(id);
        if (!train || train.derailed) continue;
        for (let c = 0; c < train.cars.length; c++) {
          const car = train.cars[c];
          const front = train.bogies[2 * c];
          const rear = train.bogies[2 * c + 1];
          if (front.pieceId !== d.pieceId && rear.pieceId !== d.pieceId) continue;
          if (!this.carAccepts(car.id, kind)) continue;
          // Top up a part-filled wagon before starting another; then the one nearest the crane.
          const started = this.cargoOf(car.id).count > 0 ? 0 : 1000;
          const len = this.depotLength(d);
          const at = front.pieceId === d.pieceId && rear.pieceId === d.pieceId ? (along(front, len) + along(rear, len)) / 2 : front.pieceId === d.pieceId ? along(front, len) : along(rear, len);
          const score = started + Math.abs(at - d.craneAt);
          if (!best || score < best.score) best = { carId: car.id, score };
        }
      }
      return best ? { kind: "car", carId: best.carId } : null;
    }
    const c = this.cargoOf(from.carId);
    const found = this.sim.findCar(from.carId);
    if (c.kind === null || c.count <= 0 || !found) return null;
    const kind = c.kind;
    const train = found.train;
    // A depot under this wagon, else under the rest of its train.
    const under = [train.bogies[2 * found.index], train.bogies[2 * found.index + 1], ...train.bogies];
    for (const b of under) {
      const d = this.byPiece.get(b.pieceId);
      if (d && this.pileAccepts(d, kind)) return { kind: "pile", depotId: d.id, cargo: kind };
    }
    return null;
  }

  /** Move one unit by hand between a pile and a wagon (or two of either). False, changing nothing, if not allowed. */
  moveCargo(from: CargoSlot, to: CargoSlot): boolean {
    let kind: CargoKind;
    if (from.kind === "pile") {
      const d = this.depots[from.depotId];
      if (!d || d.piles[CARGO[from.cargo].index] <= 0) return false;
      kind = from.cargo;
    } else {
      const c = this.cargoOf(from.carId);
      if (c.kind === null || c.count <= 0) return false;
      kind = c.kind;
    }
    if (to.kind === "pile") {
      const d = this.depots[to.depotId];
      if (!d || to.cargo !== kind || !this.pileAccepts(d, kind)) return false;
    } else if (!this.carAccepts(to.carId, kind)) return false;
    if (from.kind === "car" && to.kind === "car" && from.carId === to.carId) return false;

    this.take(from, kind);
    this.put(to, kind);
    return true;
  }

  private take(slot: CargoSlot, kind: CargoKind): void {
    if (slot.kind === "pile") {
      const d = this.depots[slot.depotId];
      if (!RECIPES[d.role].endless) d.piles[CARGO[kind].index]--;
    } else this.setCargo(slot.carId, kind, this.cargoOf(slot.carId).count - 1);
  }

  private put(slot: CargoSlot, kind: CargoKind): void {
    if (slot.kind === "pile") {
      const d = this.depots[slot.depotId];
      if (RECIPES[d.role].sink) {
        if (this.intoSink) {
          this.intoSink(d, kind);
          // What it takes next may have changed (a school's research needs one fewer).
          this.wantsStamp++;
        }
        return;
      }
      d.piles[CARGO[kind].index] = Math.min(capAt(d), d.piles[CARGO[kind].index] + 1);
      // Less is owed now: what routed lines plan to bring here may have changed.
      if (RECIPES[d.role].owed?.includes(kind)) this.wantsStamp++;
      if (d.role === "town" && kind === "planks") this.delivered.set(d.townId, (this.delivered.get(d.townId) ?? 0) + 1);
      if (d.role === "town") {
        this.wantsStamp++;
        const got = this.deliveredGoods.get(d.townId) ?? {};
        got[kind] = (got[kind] ?? 0) + 1;
        this.deliveredGoods.set(d.townId, got);
      }
    } else this.setCargo(slot.carId, kind, this.cargoOf(slot.carId).count + 1);
  }

  /** Unload one unit from a car onto a depot's input pile (crane work). */
  protected unloadOne(d: DepotState, carId: number): void {
    const kind = this.cargoOf(carId).kind!;
    if (d.role === "school") {
      const found = this.sim.findCar(carId);
      if (found) this.passOf(found.train, kind).school[CARGO[kind].index]++;
    }
    this.take({ kind: "car", carId }, kind);
    this.put({ kind: "pile", depotId: d.id, cargo: kind }, kind);
  }

  /** Load one unit from a depot's output pile onto a car (crane work). */
  protected loadOne(d: DepotState, carId: number): void {
    const kind = this.loadKind(d, carId)!;
    const landed = this.landed.get(d.id);
    if (landed && landed[CARGO[kind].index] > 0) {
      landed[CARGO[kind].index]--;
      // The car carries landed goods away: it doesn't hand them back here.
      this.landedFrom.set(carId, d.id);
    }
    this.take({ kind: "pile", depotId: d.id, cargo: kind }, kind);
    this.put({ kind: "car", carId }, kind);
    // A new pass for this good: its load is what's on board now, and no school has had any of it.
    const found = this.sim.findCar(carId);
    if (found) {
      const p = this.passOf(found.train, kind);
      p.loaded[CARGO[kind].index] = this.onBoard(found.train, kind);
      p.school[CARGO[kind].index] = 0;
    }
  }

  /**
   * Is this depot making (or using) something now: it has what its cycle uses and room for what it makes? (A
   * sawmill's saw spins while true.)
   */
  working(d: DepotState): boolean {
    const cycle = RECIPES[d.role].cycle;
    if (!cycle || d.rate <= 0) return false;
    if (cycle.eats) return RECIPES[d.role].takes.some((k) => d.piles[CARGO[k].index] > 0);
    for (const k in cycle.uses) if (d.piles[CARGO[k as CargoKind].index] < cycle.uses[k as CargoKind]!) return false;
    for (const k in cycle.makes) if (d.piles[CARGO[k as CargoKind].index] + cycle.makes[k as CargoKind]! > capAt(d)) return false;
    return true;
  }

  /** Would the crane do anything for this car at this depot? */
  needsService(d: DepotState, carId: number): boolean {
    const found = this.sim.findCar(carId);
    if (!found) return false;
    if (found.train.cars[found.index].kind === "passenger") return this.canAlight(d, carId) || this.canBoard(d, carId);
    if (!canCarry(found.train.cars[found.index].kind)) return false;
    return this.canUnload(d, carId) || this.loadKind(d, carId) !== null || this.waitsForLoad(d, carId);
  }

  /** Does this depot take `kind` now: its recipe's goods, or one it takes only while some is owed (`owes`)? */
  private takesNow(d: DepotState, kind: CargoKind): boolean {
    const r = RECIPES[d.role];
    return r.takes.includes(kind) || (!!r.owed?.includes(kind) && !!this.owes && this.owes(kind) > 0);
  }

  private canUnload(d: DepotState, carId: number): boolean {
    const c = this.cargoOf(carId);
    if (c.kind === null || c.count <= 0 || !this.takesNow(d, c.kind)) return false;
    // A halt is for people only: goods trains run through.
    if (this.isHalt(d)) return false;
    // Goods landed here for trains to take away aren't taken back (from any car, nor a car that took them here).
    if ((this.landed.get(d.id)?.[CARGO[c.kind].index] ?? 0) > 0 || this.landedFrom.get(carId) === d.id) return false;
    if (this.accepts) {
      if (!this.accepts(d, c.kind)) return false;
      // What a town still wants it takes in even with its platform's pile full (it's counted, not stacked).
      if (d.role !== "town" && d.piles[CARGO[c.kind].index] >= capAt(d)) return false;
    } else if (d.piles[CARGO[c.kind].index] >= capAt(d)) return false;
    // A routed train drops goods only at the stop it's heading for, as it says (or as its line calls for).
    const route = this.routeOfCar(carId);
    // What a school's research lacks rides on past a town or a workshop for it, as much as it lacks (the rest is
    // theirs; a workshop's tray order first).
    if ((d.role === "town" || (d.role === "workshop" && !this.reserved?.(c.kind))) && this.keptForSchool(carId, c.kind, route, d.role === "town")) return false;
    // A workshop's yard takes no more than it keeps (its tray order's, or a few) while a town the train goes on to wants
    // them too (QA P5: with research idle, the yard filled 1 → 16 with no order and the next town starved). Not one set
    // to take all (`takesAll`), nor at a stop set to Only drop (QA N3: it still shared): it fills its yard.
    if (d.role === "workshop" && !d.takesAll && this.shopKeeps && d.piles[CARGO[c.kind].index] >= (this.shopKeeps(c.kind) ?? Infinity) && !(route && this.onlyDropsAt(route, d.id)) && this.townWantsAhead(carId, c.kind, route)) return false;
    // A school takes only its share of a pass's load while a town the train goes on to wants the good too.
    if (d.role === "school" && this.townWantsAhead(carId, c.kind, route)) {
      const found = this.sim.findCar(carId);
      if (found && this.schoolShareLeft(found.train, c.kind) <= 0) return false;
    }
    if (route) return this.dropsAt(route, d, c.kind);
    // Goods kept for a workshop: an unrouted train carries them on past the towns.
    if (d.role === "town" && this.reserved?.(c.kind)) return false;
    return !RECIPES[d.role].routedOnly;
  }

  /** Give this engine's train a route (null or no stops: none; it's served wherever it goes). */
  setRoute(engineCarId: number, route: Route | null): void {
    this.stopsStamp++;
    if (!route || route.stops.length === 0) this.routes.delete(engineCarId);
    else this.routes.set(engineCarId, route);
  }

  /**
   * The line the train with this car runs, as the intent rules read it: its stops, what to do at each, and whether to
   * wait there to fill. Null if it runs none (or its route has no stops left on the map).
   */
  lineOfCar(carId: number): LineView | null {
    const route = this.routeOfCar(carId);
    if (!route) return null;
    return { stops: route.stops.map((s) => ({ depot: s.depotId, intent: s.action === "both" ? "auto" : s.action, waitFill: !!s.waitFill })) };
  }

  /** This engine's route, if it has one. */
  routeOf(engineCarId: number): Route | undefined {
    return this.routes.get(engineCarId);
  }

  /** The route of the train this car is in: its first engine's (with stops still on the map), or null. */
  routeOfCar(carId: number): Route | null {
    if (this.routes.size === 0) return null;
    const found = this.sim.findCar(carId);
    return found ? this.routeOfTrain(found.train) : null;
  }

  routeOfTrain(train: Train): Route | null {
    if (this.routes.size === 0) return null;
    for (const car of train.cars) {
      const r = this.routes.get(car.id);
      if (r && r.stops.some((s) => this.depots[s.depotId] && this.layout.getPiece(this.depots[s.depotId].pieceId))) return r;
    }
    return null;
  }

  /**
   * May a train (with this route, or none) pick up `kind` at this depot? A routed train only at the stop it's heading
   * for, as it says (`picksAt`); an unrouted one anywhere but a warehouse.
   */
  private picksUpAt(d: DepotState, route: Route | null, kind: CargoKind, train: Train | null = null): boolean {
    return route ? this.picksAt(route, d, kind, train) : !RECIPES[d.role].routedOnly;
  }

  /**
   * The intent rules: does a routed train drop `kind` (null: riders getting off) at depot `d` now? Only at the stop
   * it's heading for, with any stops right after it at the same depot (one visit), so goods for a later stop aren't
   * dropped at another on the way. "drop" drops everything; "pick" nothing. "auto" (and "both", which the engine card
   * shows as Automatic; see `Later`):
   * - at a warehouse (`routedOnly`) or a harbour (they take everything), only goods no later stop other than a
   *   warehouse uses (the rest ride on to where they're wanted: planks for a later town aren't sold at the quay);
   * - elsewhere, whatever the depot takes (`canUnload` has checked), but not, at a town, goods a later workshop takes
   *   while they're `reserved` (the workshop's first claim);
   * - riders get off at any town's station.
   */
  private dropsAt(route: Route, d: DepotState, kind: CargoKind | null): boolean {
    const n = route.stops.length;
    for (let k = 0; k < n; k++) {
      const i = (route.next + k) % n;
      const s = route.stops[i];
      if (s.depotId !== d.id) return false;
      if (s.action === "drop") return true;
      if (s.action === "pick") continue;
      if (kind === null) return true;
      const bit = 1 << CARGO[kind].index;
      const later = this.laterOf(route.stops, i);
      if (RECIPES[d.role].routedOnly || d.role === "harbour") {
        if (!(later.uses & bit)) return true;
      } else if (!(d.role === "town" && later.shop & bit && this.reserved?.(kind))) return true;
    }
    return false;
  }

  /**
   * The intent rules: does a routed train pick up `kind` (null: riders getting on) at depot `d` now? As `dropsAt`,
   * only on its visit to the stop it's heading for. "pick" picks up everything (but at a warehouse, not where it
   * drops too: it would take back what it left); "drop" nothing. "auto" (and "both"): only what a later stop takes (at
   * a warehouse, what a later stop other than a warehouse uses, so two warehouses don't hand goods back and forth; a
   * harbour's landed goods by the normal rule); riders only with a town's station later on. Given the train, an "auto"
   * stop picks up a good only while those later stops have room for more of it than the train has on board
   * (`roomAhead`): grain isn't carried round for a mill that's full (it waits at the farm for the next lap).
   */
  private picksAt(route: Route, d: DepotState, kind: CargoKind | null, train: Train | null = null): boolean {
    const routedOnly = RECIPES[d.role].routedOnly;
    const n = route.stops.length;
    let pick = false;
    let drop = false;
    for (let k = 0; k < n; k++) {
      const i = (route.next + k) % n;
      const s = route.stops[i];
      if (s.depotId !== d.id) break;
      if (s.action === "pick") pick = true;
      if (s.action === "drop") drop = true;
      if (s.action === "pick" || s.action === "drop") continue;
      const later = this.laterOf(route.stops, i);
      if (kind === null ? later.town : (routedOnly ? later.uses : later.takes) & (1 << CARGO[kind].index) && (!train || this.roomAhead(route.stops, i, kind, train))) return true;
    }
    return pick && !(routedOnly && drop);
  }

  /**
   * Have the stops after stop `i` of a line (round it, as `laterOf` counts them) room now for more of `kind` than this
   * train has on board? Each depot that would take it from the train there is counted once, at the moment of loading:
   * a town (or a school) the mode says still wants it counts as room (it takes what it wants even with its platform's
   * pile full); any other depot its pile's room (`capAt` less the pile), and for a good it takes only while owed, no
   * more than is owed (`owes`). A halt, or a depot with that good landed on it, counts none; from a warehouse, only
   * depots that use it count (as `picksAt` has it). A warehouse or a harbour counts only where the train would drop it
   * there (`dropsAt`: no stop after it uses it but this one, which gave it): grain isn't loaded for a harbour's quay
   * while the mill on the way back is full (QA, the goals play-through: the hoppers rode round with it).
   * Other trains on the line aren't counted. Cheap: one pass over the stops, run only as a crane would load (at a
   * stop, a unit at a time), with `laterOf` cached (a second pass only past a warehouse or a harbour).
   */
  private roomAhead(stops: readonly RouteStopDef[], i: number, kind: CargoKind, train: Train): boolean {
    const n = stops.length;
    const index = CARGO[kind].index;
    const fromStore = RECIPES[this.depots[stops[i].depotId]?.role ?? "town"].routedOnly;
    if (this.roomMark.length < this.depots.length) this.roomMark = new Int32Array(this.depots.length + 8);
    const mark = ++this.roomStamp;
    const need = this.onBoard(train, kind);
    let room = 0;
    for (let k = 1; k < n; k++) {
      const j = (i + k) % n;
      const s = stops[j];
      if (s.depotId === stops[i].depotId || s.action === "pick") continue;
      const d = this.depots[s.depotId];
      if (!d || !d.auto || this.roomMark[d.id] === mark || !this.takesNow(d, kind) || !this.layout.getPiece(d.pieceId)) continue;
      if (fromStore && RECIPES[d.role].routedOnly) continue;
      if (this.isHalt(d) || (this.landed.get(d.id)?.[index] ?? 0) > 0) continue;
      if (this.accepts && !this.accepts(d, kind)) continue;
      if ((RECIPES[d.role].routedOnly || d.role === "harbour") && s.action !== "drop" && this.laterOf(stops, j).uses & (1 << index) && this.usedAfter(stops, j, kind, stops[i].depotId)) continue;
      this.roomMark[d.id] = mark;
      if (this.accepts && (d.role === "town" || d.role === "school")) return true;
      let here = capAt(d) - d.piles[index];
      if (!RECIPES[d.role].takes.includes(kind) && this.owes) here = Math.min(here, this.owes(kind));
      if (here > 0) room += here;
      if (room > need) return true;
    }
    return false;
  }

  /**
   * Does a stop after stop `j` (round the line, as `Later.uses` counts them) use `kind`, other than at `j`'s depot, at
   * warehouses, and at depot `but` (where the train got it: it isn't taken back there)?
   */
  private usedAfter(stops: readonly RouteStopDef[], j: number, kind: CargoKind, but: number): boolean {
    const n = stops.length;
    for (let k = 1; k < n; k++) {
      const s = stops[(j + k) % n];
      if (s.depotId === stops[j].depotId || s.depotId === but || s.action === "pick") continue;
      const d = this.depots[s.depotId];
      if (!d || !d.auto || RECIPES[d.role].routedOnly || !this.layout.getPiece(d.pieceId)) continue;
      if (this.takesNow(d, kind) && (!this.accepts || this.accepts(d, kind))) return true;
    }
    return false;
  }
  /** Which depots `roomAhead` has counted this call (by depot id: its stamp), so one twice on a line counts once. */
  private roomMark = new Int32Array(0);
  private roomStamp = 0;

  /** Is the stop a routed train is heading for (this visit) at this depot set to Only drop? */
  private onlyDropsAt(route: Route, depotId: number): boolean {
    const n = route.stops.length;
    for (let k = 0; k < n; k++) {
      const s = route.stops[(route.next + k) % n];
      if (s.depotId !== depotId) return false;
      if (s.action === "drop") return true;
    }
    return false;
  }

  /** Does a routed train wait to fill at this depot: is the stop it's heading for (this visit) "Wait here till full"? */
  private waitFillAt(route: Route, depotId: number): boolean {
    const n = route.stops.length;
    for (let k = 0; k < n; k++) {
      const s = route.stops[(route.next + k) % n];
      if (s.depotId !== depotId) return false;
      if (s.waitFill) return true;
    }
    return false;
  }

  /**
   * What a stop list's later stops take, from stop `i` (see `Later`). Worked out for the whole list at once and kept
   * until a route is set (a line edited), a depot's Automatic changes, a town is given goods (what it wants may
   * change), the mode's `accepts` changes, or pieces are added or taken up: otherwise a lookup.
   */
  private laterOf(stops: readonly RouteStopDef[], i: number): Later {
    let c = this.laterCache.get(stops);
    if (!c || c.stamp !== this.stopsStamp || c.wants !== this.wantsStamp || c.accepts !== this.accepts || c.pieces !== this.layout.pieceCount || c.at.length !== stops.length) {
      c = { stamp: this.stopsStamp, wants: this.wantsStamp, accepts: this.accepts, pieces: this.layout.pieceCount, at: this.laterStops(stops) };
      this.laterCache.set(stops, c);
    }
    return c.at[i];
  }

  /** `Later` for every stop of a list: what each stop takes (stops × goods), then each stop's others (stops²). */
  private laterStops(stops: readonly RouteStopDef[]): Later[] {
    const n = stops.length;
    const takes: number[] = [];
    const town: boolean[] = [];
    for (const s of stops) {
      const d = this.depots[s.depotId];
      let mask = 0;
      const on = !!d && d.auto && s.action !== "pick" && !!this.layout.getPiece(d.pieceId);
      if (on) for (const k of RECIPES[d.role].takes) if (!this.accepts || this.accepts(d, k)) mask |= 1 << CARGO[k].index;
      if (on && RECIPES[d.role].owed) for (const k of RECIPES[d.role].owed!) if (this.takesNow(d, k)) mask |= 1 << CARGO[k].index;
      takes.push(mask);
      town.push(on && d.role === "town");
    }
    const at: Later[] = [];
    for (let i = 0; i < n; i++) {
      const later: Later = { takes: 0, uses: 0, shop: 0, school: 0, town: false, towns: 0 };
      /** Goods some later stop other than a town's takes, so far round the line. */
      let taken = 0;
      for (let k = 1; k < n; k++) {
        const j = (i + k) % n;
        if (stops[j].depotId === stops[i].depotId) continue;
        const role = this.depots[stops[j].depotId]?.role;
        later.takes |= takes[j];
        if (role && !RECIPES[role].routedOnly) later.uses |= takes[j];
        if (role === "workshop") later.shop |= takes[j];
        if (role === "school") later.school |= takes[j] & ~taken;
        if (role && role !== "town" && role !== "workshop") taken |= takes[j];
        later.town ||= town[j];
        if (role === "town") later.towns |= takes[j];
      }
      at.push(later);
    }
    return at;
  }

  /** What the crane would load onto this car here: goods the depot gives, the car carries and has room for, or null. */
  private loadKind(d: DepotState, carId: number): CargoKind | null {
    const c = this.cargoOf(carId);
    if (c.count >= this.wagonCapacity) return null;
    const found = this.sim.findCar(carId);
    if (!found) return null;
    const route = this.routeOfTrain(found.train);
    if (!route && RECIPES[d.role].routedOnly) return null;
    const car = found.train.cars[found.index].kind;
    let best: CargoKind | null = null;
    let fewest = Infinity;
    for (const k of this.givesAt(d)) {
      if ((c.kind !== null && c.kind !== k) || !canCarry(car, k) || d.piles[CARGO[k].index] <= 0 || !this.picksUpAt(d, route, k, found.train)) continue;
      if (c.kind !== null) return k;
      // An empty wagon takes the good its train carries least of: a train of hoppers at a mine takes coal and ore both.
      let n = 0;
      for (const other of found.train.cars) if (this.cargo.get(other.id)?.kind === k) n++;
      if (n < fewest) {
        best = k;
        fewest = n;
      }
    }
    return best;
  }

  /**
   * With "wait for a full load", a wagon that could take more of the depot's goods waits for them, but only while
   * more are coming: goods on the pile, or the depot making them. (A sawmill out of logs isn't, so a train never waits
   * there for planks that would need the logs on its own later wagons.) Not while another wagon still has goods to
   * unload here: that goes first (the wagon waits its turn again once the crane is done with the others). Nor where
   * its train may not pick up those goods (a routed train's Drop stop, a depot that isn't the stop it's heading for,
   * or goods no later stop on its line takes).
   *
   * Which wait: a routed train's is its stop's ("Wait here till full", `waitFill`); an unrouted train's the depot's
   * (`waitFull`).
   */
  private waitsForLoad(d: DepotState, carId: number): boolean {
    const c = this.cargoOf(carId);
    if (c.count >= this.wagonCapacity) return false;
    const found = this.sim.findCar(carId);
    if (!found) return false;
    const route = this.routeOfTrain(found.train);
    if (!(route ? this.waitFillAt(route, d.id) : d.waitFull) || this.canUnload(d, carId)) return false;
    const done = this.services.get(found.train.id)?.done;
    if (found.train.cars.some((o) => o.id !== carId && !done?.has(o.id) && this.canUnload(d, o.id))) return false;
    const car = found.train.cars[found.index].kind;
    const kind = RECIPES[d.role].gives.find((k) => (c.kind === null || c.kind === k) && canCarry(car, k) && this.picksUpAt(d, route, k, found.train));
    if (kind === undefined) return false;
    return d.piles[CARGO[kind].index] > 0 || this.working(d);
  }

  /** The car under the crane at a depot right now, or −1. */
  servicedCar(depotId: number): number {
    for (const s of this.services.values()) if (s.phase === HALTED && s.depotId === depotId) return s.carId;
    return -1;
  }

  /** Progress (0–1) of the crane's current move at a depot, or −1 when idle. */
  cranePhase(depotId: number): number {
    for (const s of this.services.values()) if (s.phase === HALTED && s.depotId === depotId) return s.ticks / this.craneTicks;
    return -1;
  }

  /**
   * What the crane at a depot is carrying right now: the cargo, which way (from the wagon to a pile, or the other
   * way), the car, and progress 0–1, written into `out`. False when the crane is idle or waiting.
   */
  craneMove(depotId: number, out: CraneMove): boolean {
    for (const s of this.services.values()) {
      if (s.phase !== HALTED || s.depotId !== depotId || s.ticks === 0) continue;
      const d = this.depots[depotId];
      out.carId = s.carId;
      out.phase = s.ticks / this.craneTicks;
      if (this.canUnload(d, s.carId)) {
        out.kind = this.cargoOf(s.carId).kind!;
        out.toPile = true;
        return true;
      }
      const load = this.loadKind(d, s.carId);
      if (load !== null) {
        out.kind = load;
        out.toPile = false;
        return true;
      }
    }
    return false;
  }

  /**
   * Counts trains halting, at a depot's crane or a kit's stop: it changes when one halts (a train standing still
   * changes nothing the frame loop sees otherwise; a kit's moving parts start then).
   */
  get halts(): number {
    return this.depotHalts + this.kitStops.halts;
  }
  private depotHalts = 0;

  /** Is a train standing at this piece now: at its depot's crane (working on it), or at its kit's stop? */
  standingAt(pieceId: number): boolean {
    if (this.kitStops.haltedAt(pieceId)) return true;
    const d = this.byPiece.get(pieceId);
    return !!d && this.cranePhase(d.id) >= 0;
  }

  /** The depot whose crane is working this train now (it's crawling to, or halted at, the crane), if any. */
  servingDepot(trainId: number): DepotState | undefined {
    const s = this.services.get(trainId);
    return s && s.phase !== NONE && s.depotId !== -1 ? this.depots[s.depotId] : undefined;
  }

  /**
   * Nothing more for this train at the depot it's beside, this visit (Continue, on its engine's card): the crane lets
   * it go, and it runs on. False if it's beside none.
   */
  skipVisit(trainId: number): boolean {
    const train = this.sim.getTrain(trainId);
    const d = train && this.depotUnder(train);
    if (!train || !d) return false;
    const s = this.service(trainId);
    if (s.depotId !== d.id) this.endVisit(s);
    s.depotId = d.id;
    s.phase = NONE;
    for (const car of train.cars) s.done.add(car.id);
    return true;
  }

  /**
   * What the crane is doing for this train at this depot, as far as its cars still need: unloading (goods it takes,
   * riders getting off) and/or loading (goods it may pick up, riders getting on). With nothing left to do (a moment
   * as it finishes), what the depot does that this train may have done: a Drop stop only unloads.
   */
  workFor(trainId: number, d: DepotState): { load: boolean; unload: boolean } | null {
    const train = this.sim.getTrain(trainId);
    if (!train) return null;
    const left = this.workLeft(train, d);
    if (left.load || left.unload) return left;
    // A routed train: what its stop's intent lets it do here (an "auto" stop: goods the depot gives that a later stop
    // takes, goods it takes that the train would drop here).
    const route = this.routeOfTrain(train);
    const r = RECIPES[d.role];
    return {
      load: route ? r.gives.some((k) => this.picksAt(route, d, k)) : r.gives.length > 0 && !r.routedOnly,
      unload: route ? r.takes.some((k) => this.dropsAt(route, d, k)) || !!r.owed?.some((k) => this.takesNow(d, k) && this.dropsAt(route, d, k)) : r.takes.length > 0,
    };
  }

  /** Has the crane anything left to do for this train at this depot (this visit)? */
  hasWorkAt(trainId: number, d: DepotState): boolean {
    const train = this.sim.getTrain(trainId);
    if (!train) return false;
    const left = this.workLeft(train, d);
    return left.load || left.unload;
  }

  /** What the crane has left to do for this train's cars at this depot (this visit). */
  private workLeft(train: Train, d: DepotState): { load: boolean; unload: boolean } {
    const done = this.services.get(train.id)?.done;
    let load = false;
    let unload = false;
    for (const car of train.cars) {
      if (done?.has(car.id)) continue;
      if (car.kind === "passenger") {
        unload ||= this.canAlight(d, car.id);
        load ||= this.canBoard(d, car.id);
      } else if (canCarry(car.kind)) {
        unload ||= this.canUnload(d, car.id);
        load ||= this.loadKind(d, car.id) !== null || this.waitsForLoad(d, car.id);
      }
    }
    return { load, unload };
  }

  private service(trainId: number): Service {
    let s = this.services.get(trainId);
    if (!s) this.services.set(trainId, (s = { trainId, phase: NONE, depotId: -1, carId: -1, ticks: 0, still: 0, done: new Set() }));
    return s;
  }

  /**
   * The automatic depot under this train's axles, if any. A train beside two (industries end to end) is served where
   * a wagon has work: the one whose crane is working on it, else the first where a wagon standing on it has work
   * there (so a school just before a station isn't passed by for the station ahead, where the engine is), else the
   * first where any of its wagons has work (it's coming up to the crane), else the first.
   */
  private depotUnder(train: Train): DepotState | undefined {
    const s = this.services.get(train.id);
    let first: DepotState | undefined;
    let here: DepotState | undefined;
    let work: DepotState | undefined;
    /** The depot last asked whether any wagon has work there (bogies on one depot come together: asked once). */
    let asked: DepotState | undefined;
    const undone = (d: DepotState, carId: number) => !(s && s.depotId === d.id && s.done.has(carId)) && this.needsService(d, carId);
    for (let k = 0; k < train.bogies.length; k++) {
      const d = this.byPiece.get(train.bogies[k].pieceId);
      if (!d || !d.auto) continue;
      if (s && s.phase === HALTED && s.depotId === d.id) return d;
      first ??= d;
      if (!here && undone(d, train.cars[k >> 1].id)) here = d;
      if (!work && d !== asked) {
        asked = d;
        if (train.cars.some((c) => undone(d, c.id))) work = d;
      }
    }
    return here ?? work ?? first;
  }

  /**
   * The sim's speed limit for a powered train: a depot's (see `depotCap`), and a kit's stop's (a platform: see
   * `KitStops`), whichever is lower.
   */
  private capFor(train: Train): number {
    const depot = this.depotCap(train);
    if (depot === 0) return 0;
    const kit = this.kitStops.cap(train);
    if (kit === 0) return 0;
    return Math.min(depot, kit, this.sections.cap(train), this.router.speedCap(train));
  }

  /**
   * The speed limit a depot puts on a powered train: on an automatic depot where one of its wagons has work, crawl,
   * and slow so the next wagon needing the crane stops exactly under it, then hold it there (0) while the crane works.
   * A train with nothing to do there runs through at full speed.
   */
  private depotCap(train: Train): number {
    const d = this.depotUnder(train);
    const s = this.service(train.id);
    if (!d) {
      if (s.phase !== NONE || s.done.size > 0) this.endVisit(s);
      return Infinity;
    }
    if (s.depotId !== d.id) {
      this.endVisit(s);
      s.depotId = d.id;
      s.phase = CRAWLING;
    }
    // Reversing the lever sends the train on: nothing more for it here this visit (and it isn't being worked).
    if (this.drive(train) < 0) {
      for (const car of train.cars) s.done.add(car.id);
      s.phase = NONE;
      return Infinity;
    }
    if (s.phase === HALTED) return 0;
    // Nothing for the crane in this train (this visit): it won't stop, so it needn't slow (nor is it being worked:
    // `servingDepot`).
    // (A routed train's stop where it would neither drop nor pick up anything is run through: "skip if nothing to do",
    // decided afresh each tick as it comes up to the stop, so a pile that fills meanwhile is seen.)
    if (!train.cars.some((car) => !s.done.has(car.id) && this.needsService(d, car.id))) {
      // But a routed train's "Wait here till full" stop never is: it crawls in (goods may yet come, and a wagon that can
      // take them stops under the crane), while a wagon could take some.
      if (!this.waitsHere(train, d)) {
        s.phase = NONE;
        // Its work here done (or none): it waits a moment longer if another train of its line left here just now.
        return this.spacingCap(train, d);
      }
    }
    s.phase = CRAWLING;
    let cap = CRAWL_SPEED;
    const len = this.depotLength(d);
    const crane = d.craneAt;
    // A wagon the crane can't stop under (rolled past it, or off the depot's track on a long train): served where it
    // stands, once no other wagon is still coming up to the crane.
    // The train runs front first (its cars in order): cars after the last one on the depot are still to come.
    let lastOn = -1;
    for (let c = 0; c < train.cars.length; c++) if (train.bogies[2 * c].pieceId === d.pieceId || train.bogies[2 * c + 1].pieceId === d.pieceId) lastOn = c;
    // Stopped short of the crane (a buffer, a train ahead): the ones still to come won't, so they're reached for too.
    s.still = train.speed === 0 ? s.still + 1 : 0;
    const stuck = s.still > STUCK_TICKS;
    let reach = -1;
    let coming = false;
    for (let c = 0; c < train.cars.length; c++) {
      const car = train.cars[c];
      if (s.done.has(car.id) || !this.needsService(d, car.id)) continue;
      const front = train.bogies[2 * c];
      const rear = train.bogies[2 * c + 1];
      if (front.pieceId !== d.pieceId || rear.pieceId !== d.pieceId) {
        // Running onto the depot (its leading end on it), or not there yet: it will come up to the crane.
        const arriving = front.pieceId === d.pieceId || (rear.pieceId !== d.pieceId && c > lastOn);
        if (arriving && !stuck) coming = true;
        else if (reach === -1) reach = car.id;
        continue;
      }
      // Distance still to go before the car's centre is under the crane.
      const centre = (along(front, len) + along(rear, len)) / 2;
      const ahead = (crane - centre) * (front.reversed ? -1 : 1);
      if (ahead < -AT_CRANE) {
        if (reach === -1) reach = car.id;
        continue;
      }
      if (ahead <= AT_CRANE) return this.halt(s, car.id);
      if (stuck) {
        if (reach === -1) reach = car.id;
        continue;
      }
      coming = true;
      if (ahead / SIM_DT < cap) cap = ahead / SIM_DT;
    }
    // Beside the depot at all, every wagon gets its turn: the train stops for the ones the crane must reach to.
    if (!coming && reach !== -1) return this.halt(s, reach);
    return cap;
  }

  /**
   * Is depot `d` a routed train's "Wait here till full" stop (the one it's heading for), with a wagon (not yet done
   * this visit) that has room for a good it would pick up here?
   */
  private waitsHere(train: Train, d: DepotState): boolean {
    const route = this.routeOfTrain(train);
    if (!route || !this.waitFillAt(route, d.id)) return false;
    const done = this.services.get(train.id)?.done;
    for (const car of train.cars) {
      if (done?.has(car.id) || !canCarry(car.kind)) continue;
      const c = this.cargoOf(car.id);
      if (c.count >= this.wagonCapacity) continue;
      for (const k of RECIPES[d.role].gives) if ((c.kind === null || c.kind === k) && canCarry(car.kind, k) && this.picksAt(route, d, k)) return true;
    }
    return false;
  }

  /**
   * Auto-spacing: is this routed train, at the stop it's heading for with nothing (more) to do there, held a moment so
   * its line's trains spread out (see spacing.ts)? Its speed limit if so, else Infinity. Stopped there (its work done)
   * it stays where it is (0); running in with nothing to do it brakes as for a signal, to stop by the stop's far end,
   * but only where it can stop cleanly in that room (else it runs through, and is spaced at a stop where it stops).
   * Its line's trains are counted live: those on the track and not derailed. Its lever set (the player sends it on)
   * lets it go.
   */
  private spacingCap(train: Train, d: DepotState): number {
    let cap = 0;
    let clean = true;
    if (train.speed > CRAWL_SPEED + 1e-6) {
      const front = train.bogies[0];
      if (front.pieceId !== d.pieceId) return Infinity;
      const len = this.depotLength(d);
      const room = (front.reversed ? along(front, len) : len - along(front, len)) - STOP_SHORT;
      cap = room > 0 ? Math.sqrt(2 * ACCELERATION * room) : 0;
      clean = train.speed <= cap + 1e-6;
    }
    for (const car of train.cars) {
      const lineId = this.lineIdOf.get(car.id);
      const r = lineId === undefined ? undefined : this.routes.get(car.id);
      const line = lineId === undefined ? undefined : this.lines.get(lineId);
      if (!r || !line) continue;
      const index = r.next % r.stops.length;
      if (r.stops[index].depotId !== d.id) return Infinity;
      // (Braking for a hold already begun, it carries on: only a new hold needs room to stop in.)
      if (!clean && !this.spacing.holding(car.id)) return Infinity;
      const live: number[] = [];
      for (const [engine, id] of this.lineIdOf) {
        if (id !== line.id) continue;
        const found = this.sim.findCar(engine);
        if (found && !found.train.derailed) live.push(engine);
      }
      return this.spacing.holds(line.id, stopsKey(line), car.id, index, live, this.ticksRun, train.leverTick ?? 0) ? cap : Infinity;
    }
    return Infinity;
  }

  /** Stop the train for the crane to work on this car. */
  private halt(s: Service, carId: number): number {
    if (s.phase !== HALTED) this.depotHalts++;
    s.phase = HALTED;
    s.carId = carId;
    s.ticks = 0;
    return 0;
  }

  /** Net drive of a train's engines toward its front (sign only matters). */
  private drive(train: Train): number {
    let net = 0;
    for (const car of train.cars) if (car.kind === "engine") net += car.lever * car.facing;
    return net;
  }

  private depotLength(d: DepotState): number {
    const p = this.layout.getPiece(d.pieceId);
    return p ? pathLength(getPieceDef(p.type, p.flipped).paths[0].geom) : 216;
  }

  private endVisit(s: Service): void {
    s.phase = NONE;
    s.depotId = -1;
    s.carId = -1;
    s.ticks = 0;
    s.still = 0;
    s.done.clear();
  }

  /** Crane work for every halted train: one unit per move, unloading before loading. */
  private work(): void {
    for (const s of this.services.values()) {
      if (s.phase !== HALTED) continue;
      const train = this.sim.getTrain(s.trainId);
      const d = this.depots[s.depotId];
      if (!train) {
        // Gone (coupled into another train, or removed): forget its visit.
        this.services.delete(s.trainId);
        continue;
      }
      if (train.derailed || !d || !d.auto || !this.onMap(d) || !this.sim.findCar(s.carId)) {
        this.endVisit(s);
        continue;
      }
      // Lever off: the train stays put and the crane stops; it carries on when the train is set going again.
      if (this.drive(train) === 0) {
        s.phase = CRAWLING;
        s.ticks = 0;
        continue;
      }
      // People get off a coach, then on, by themselves (no crane).
      const alight = this.canAlight(d, s.carId);
      if (alight || this.canBoard(d, s.carId)) {
        if (++s.ticks < RIDER_TICKS) continue;
        s.ticks = 0;
        const r = this.riders.get(s.carId);
        if (alight) {
          const from = this.depots[r!.from];
          this.setRiders(s.carId, r!.count - 1, r!.from);
          if (from) this.onAlight?.(from, d, s.carId);
        } else {
          d.waiting--;
          this.setRiders(s.carId, (r?.count ?? 0) + 1, r?.from ?? d.id);
        }
        continue;
      }
      if (!this.canUnload(d, s.carId) && this.loadKind(d, s.carId) === null) {
        if (this.waitsForLoad(d, s.carId)) continue;
        s.done.add(s.carId);
        // Unloading done: the wagons that stood aside for it can wait for their load now.
        for (const car of train.cars) if (car.id !== s.carId && s.done.has(car.id) && this.waitsForLoad(d, car.id)) s.done.delete(car.id);
        s.phase = CRAWLING;
        s.ticks = 0;
        continue;
      }
      if (++s.ticks < this.craneTicks) continue;
      s.ticks = 0;
      // A grab crane lifts more than one load a move (while there's more to move).
      for (let n = 0; n < this.craneLoads; n++) {
        if (this.canUnload(d, s.carId)) {
          this.events.push({ kind: "unloaded", depotId: d.id, cargo: this.cargoOf(s.carId).kind! });
          this.unloadOne(d, s.carId);
        } else if (this.loadKind(d, s.carId) !== null) {
          this.events.push({ kind: "loaded", depotId: d.id, cargo: this.loadKind(d, s.carId)! });
          this.loadOne(d, s.carId);
        } else break;
        this.loadsMoved++;
      }
    }
  }

  /** One sim tick of production, use and crane work (and trains' dwells at kits' stops). */
  tick(): void {
    this.ticksRun++;
    this.work();
    this.kitStops.tick();
    if (this.routes.size > 0) this.advanceRoutes();
    // Switches ahead of routed trains (routing/router.ts; nothing with none).
    this.router.tick();
    // (Only depots on the map: one whose piece was taken up makes nothing till it's back.)
    for (const d of this.allDepots()) {
      if (!this.working(d)) {
        d.timer = 0;
        continue;
      }
      d.timer++;
      const cycle = RECIPES[d.role].cycle!;
      if (d.timer < cycleTicks(cycle.seconds, d.rate)) continue;
      d.timer = 0;
      if (cycle.eats) {
        for (const k of RECIPES[d.role].takes) if (d.piles[CARGO[k].index] > 0) d.piles[CARGO[k].index]--;
        continue;
      }
      for (const k in cycle.uses) d.piles[CARGO[k as CargoKind].index] -= cycle.uses[k as CargoKind]!;
      for (const k in cycle.makes) {
        d.piles[CARGO[k as CargoKind].index] += cycle.makes[k as CargoKind]!;
        this.made[CARGO[k as CargoKind].index] += cycle.makes[k as CargoKind]!;
      }
    }
  }

  /**
   * A mode's say in what a depot takes from trains, beyond its recipe (Game mode: a town takes only what it still
   * wants for its next level, so the rest rides on to the next town). Null: everything its recipe takes.
   */
  accepts: ((d: DepotState, kind: CargoKind) => boolean) | null = null;

  /**
   * A unit landed at a sink depot (Game mode: goods into a school's research, `src/game/research.ts`). Null: it just
   * vanishes (Sandbox's unloader).
   */
  intoSink: ((d: DepotState, kind: CargoKind) => void) | null = null;

  /**
   * How many more of `kind` a sink depot takes (Game mode: what the current research still lacks). A train keeps that
   * many on board past towns for a school (`keptForSchool`). Null: none kept.
   */
  sinkWants: ((kind: CargoKind) => number) | null = null;

  /**
   * What `accepts` says changed without goods reaching a town or a sink (Game mode: a research picked): routed trains'
   * plans are worked out again.
   */
  acceptsChanged(): void {
    this.wantsStamp++;
  }

  /**
   * Goods a mode keeps for a workshop (Game mode: planks, while the workshop holds fewer than its waiting tray order
   * needs: `orderPlanks` in crafting.ts): towns don't take them from unrouted trains, which carry them on to the
   * workshop.
   */
  reserved: ((kind: CargoKind) => boolean) | null = null;

  /**
   * How many of `kind` a workshop's yard takes from a train while a town the train goes on to wants it (Game mode:
   * planks, its waiting tray order's or `WORKSHOP_SPARE`: `yardKeeps` in crafting.ts); beyond that they ride on to the
   * town. Null (or null for a kind): as many as the yard has room for. With no town ahead wanting them, or at a
   * workshop set to take all (`takesAll`), the yard fills.
   */
  shopKeeps: ((kind: CargoKind) => number | null) | null = null;

  /**
   * How many more of `kind` (one a recipe takes only while `owed`: a workshop's stone) the workshops take: what's
   * needed there less what they hold (Game mode: `shopOwes` in crafting.ts). Called as trains unload (not each frame),
   * so keep it cheap. When it goes from none to some for any other reason than goods landing here (a blueprint
   * learned, an order, a price paid), call `acceptsChanged` so routed lines plan again. Null: none owed (Sandbox).
   */
  owes: ((kind: CargoKind) => number) | null = null;

  /**
   * Goods landed at a depot for trains to take away (Game mode: what a boat brought to a harbour), by depot id and
   * cargo index. A depot gives these as well as its recipe's goods.
   */
  readonly landed = new Map<number, Int32Array>();
  /** Cars carrying goods landed at a depot, by car id: the depot they came from (they're not unloaded back there). */
  readonly landedFrom = new Map<number, number>();

  /** Land `n` of `kind` on a depot's pile for trains to take away. */
  land(d: DepotState, kind: CargoKind, n: number): void {
    let l = this.landed.get(d.id);
    if (!l) this.landed.set(d.id, (l = new Int32Array(CARGO_KINDS.length)));
    l[CARGO[kind].index] += n;
    d.piles[CARGO[kind].index] += n;
  }

  /** The goods a depot gives trains: its recipe's, and any landed there. */
  private givesAt(d: DepotState): readonly CargoKind[] {
    const l = this.landed.get(d.id);
    if (!l) return RECIPES[d.role].gives;
    return [...RECIPES[d.role].gives, ...CARGO_KINDS.filter((k) => l[CARGO[k].index] > 0 && !RECIPES[d.role].gives.includes(k))];
  }

  /** Ticks a crane takes to move a load (Game mode's quicker cranes make it shorter). */
  craneTicks = CRANE_TICKS;
  /** Units a wagon holds (Game mode's heavy wagons, from the smithy: more). */
  wagonCapacity = WAGON_CAPACITY;
  /** Loads a crane moves at once (grab cranes: two). */
  craneLoads = 1;
  /** Units of each good made at industries, by cargo index, since this economy began (counters for Game mode). */
  readonly made = new Int32Array(CARGO_KINDS.length);
  /** Loads the cranes have moved, since this economy began. */
  loadsMoved = 0;

  /**
   * Is this engine's train held at its stop for spacing (see spacing.ts)? Its line, and how long it has waited and has
   * at most left (s; null while it waits behind another train of the line), for its card.
   */
  spacingWait(engineCarId: number): { line: Line; waited: number; left: number | null } | null {
    const w = this.spacing.waitOf(engineCarId, this.ticksRun);
    const line = w && this.lines.get(w.lineId);
    return w && line ? { line, waited: w.waited, left: w.left } : null;
  }

  /** Ticks run (sim time: a pause stops it), for spacing the trains on a line (`spacing`). */
  private ticksRun = 0;
  /** Auto-spacing of the trains on a line (see spacing.ts). */
  readonly spacing = new Spacing();

  /** A routed train that has been at its next stop and left it heads for the one after. */
  private advanceRoutes(): void {
    for (const [engine, r] of this.routes) {
      const found = this.sim.findCar(engine);
      if (!found) continue;
      const stop = r.stops[r.next % r.stops.length];
      const d = this.depots[stop.depotId];
      if (!d || !this.layout.getPiece(d.pieceId)) {
        // Its stop was taken up: on to the next.
        r.next = (r.next + 1) % r.stops.length;
        r.at = false;
        continue;
      }
      const on = found.train.bogies.some((b) => b.pieceId === d.pieceId);
      const lineId = this.lineIdOf.get(engine);
      const line = lineId === undefined ? undefined : this.lines.get(lineId);
      if (on) {
        // Come to it (for spacing: the first here goes first).
        if (!r.at && line) this.spacing.arrived(line.id, stopsKey(line), engine, r.next % r.stops.length, this.ticksRun);
        r.at = true;
      } else if (r.at) {
        // Left it: on past it, and past any stops after it at the same depot (they were the same visit).
        r.at = false;
        if (line) this.spacing.departed(line.id, stopsKey(line), engine, r.next % r.stops.length, this.ticksRun);
        for (let k = 0; k < r.stops.length; k++) {
          r.next = (r.next + 1) % r.stops.length;
          if (r.stops[r.next].depotId !== stop.depotId) break;
        }
      }
    }
  }

  /** Events since the last drain. The returned array is reused: read it before the next drain. */
  drainEvents(): readonly EconomyEvent[] {
    const e = this.events;
    this.events = this.drained;
    this.events.length = 0;
    this.drained = e;
    return e;
  }

  /** Forget cargo and destinations on cars, and visits of trains, that no longer exist. */
  prune(): void {
    for (const id of this.cargo.keys()) if (!this.sim.findCar(id)) this.cargo.delete(id);
    for (const id of this.riders.keys()) if (!this.sim.findCar(id)) this.riders.delete(id);
    for (const id of this.routes.keys()) if (!this.sim.findCar(id)) this.routes.delete(id);
    // An engine gone: off its line; a line no train runs is forgotten.
    for (const id of this.lineIdOf.keys()) if (!this.routes.has(id)) this.lineIdOf.delete(id);
    const run = new Set(this.lineIdOf.values());
    for (const id of this.lines.keys()) if (!run.has(id)) this.lines.delete(id);
    this.spacing.prune(run, new Set(this.lineIdOf.keys()));
    this.sections.prune(new Set(this.lineIdOf.keys()));
    for (const id of this.services.keys()) if (!this.sim.getTrain(id)) this.services.delete(id);
    this.kitStops.prune();
    // (Points laid take the way they lie as their default; points taken up lose theirs.)
    this.router.laid();
  }
}


/** Ticks in one cycle of `seconds` at `rate` (whole ticks, so production stays in step with the sim). */
function cycleTicks(seconds: number, rate: number): number {
  return Math.max(1, Math.round(ticks(seconds) / rate));
}

/** A cursor's distance from its path's `from` end. */
/** A train braking to wait at its stop (auto-spacing) stops this far (mm) short of the stop's far end. */
const STOP_SHORT = 6;

function along(c: Cursor, len: number): number {
  return c.reversed ? len - c.s : c.s;
}

/** A line's stops as a key (spacing starts afresh when they change). */
const stopsKey = (line: Line): string => line.stops.map((s) => s.depotId).join(",");
