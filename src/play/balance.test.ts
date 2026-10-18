import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { CARGO } from "../economy/cargo";
import { describe as describeGoods } from "../economy/goods";
import { craftNow, craftShort, Crafting, lacking, workshops, workshopStock } from "../game/crafting";
import { attachEngines } from "../game/engines";
import { GOALS, GoalTracker } from "../game/goals";
import { rateFor, resourceAt, siteWhy, SITE_RULES, updateRates, yardMiddle } from "../game/industries";
import { landmarksOf, townLandmarks } from "../game/landmarks";
import { editLine, joinLine, startLine, trainsOn } from "../game/lines";
import { attachPassengers, peopleArrive } from "../game/passengers";
import { inUse, Progress } from "../game/progress";
import { firstTimeGift, offerOnGrowth, payDelivery, schoolIdeas, takeBlueprint, takeCrate } from "../game/rewards";
import { learnAuto, learnWithGoods, priceOf, ready, techOf, TECHS } from "../game/tech";
import { describePrice } from "../game/blueprints";
import { isFree, pieceThing, ruleOf, THING_RULES, thingsFor, type ThingId } from "../game/things";
import { receivedBy, TownLife, type TownLifeHost } from "../game/town-life";
import { applyCranes, boostOf, Counters } from "../game/upgrades";
import { buildStarterWorld, haltTown, haltWhy, syncIndustries, type World } from "../game/world";
import { FEAT_FIELD, FEAT_TREE, looseHeight } from "../landscape";
import { LandEditor } from "../landscape/edit";
import { propsInRect } from "../props/placement";
import { fieldPrice, fieldSpot, plantField } from "../game/fields";
import { rng } from "../lib/rng";
import { SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, indexOfRef, pieceOfRef, type PieceTypeId, type Pose } from "../track";
import { play, type Blocked } from "./player";
import { endOn, rulesFor } from "./rules";

/**
 * A balance and pacing play-through of Game mode, on the game's own rules and none of the tours' shortcuts: every
 * blueprint is paid for at the board (planks from the workshop's yard, and coins) or chosen from a town's offer,
 * every piece, car and industry that costs anything is made from the workshop's yard (as the tray does), schools
 * think only while their town is supplied, the workshop keeps its first claim on planks, and passengers come and pay.
 * A simulated new player follows the goals, joins towns, runs trains, builds what the blueprints allow and spends on
 * the next blueprint when it can. The log is a timeline in minutes of play.
 *
 * Slow (minutes of play are simulated tick by tick), so skipped unless asked for:
 *   BALANCE=1 npx vitest run src/play/balance.test.ts
 * BALANCE_TRAINS_PER_LINE=n puts up to n trains on the line once routes are learned (default 1). BALANCE_JSON=1 also
 * prints the timeline as one line of JSON; BALANCE_MINUTES caps the play (default 180).
 */

/** The environment (Node's, under Vitest), without Node's types. */
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const RUN = !!ENV.BALANCE;
const MAX_MINUTES = Number(ENV.BALANCE_MINUTES ?? 180);
/** Most trains on the line once routes are learned (1: only the goods train). */
const PER_LINE = Number(ENV.BALANCE_TRAINS_PER_LINE ?? 1);
/** The target: a town that's a City ★★ (the sixth rung: hamlet, village, town, city, city ★, city ★★). */
const TARGET_LEVEL = 5;

const minutes = (ticks: number) => ticks / SIM_HZ / 60;
const peg = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" as const };

/** Paid pieces the simulated layer may reach for (ramps up hills, bridges over rivers). */
const PAID_TRACK: readonly PieceTypeId[] = ["ramp", "bridge", "bridge-curve"];

/** The order a sensible new player wants blueprints in: the goals' first, then what the towns want next. */
const WISH: readonly string[] = [
  "switches",
  "bridges",
  "farming",
  "mills",
  "passengers",
  "routes",
  "halts",
  "quarries",
  "cranes1",
  "carpentry",
  "tank",
  "goods-engine",
  "mines",
  "foundry",
  "warehouses",
  "harvesters",
  "sawmills",
  "signals",
  "junctions",
  "college",
];

/** Wished for, but of no use to this player till much later: bought only with planks and coins to spare. */
const LATER: ReadonlySet<string> = new Set(["warehouses", "sawmills", "signals", "junctions", "college"]);

interface Row {
  minute: number;
  coins: number;
  planks: number;
  goals: number;
  blueprints: number;
  learned: string[];
  levels: number[];
  trains: number;
  riders: number;
}

class Player {
  w!: World;
  editor!: Editor;
  progress = Progress.fresh();
  crafting = new Crafting(this.progress);
  goals = new GoalTracker();
  town!: TownLife;
  counters = new Counters();
  tick = 0;
  readonly random = rng(Number(ENV.BALANCE_SEED ?? 2027));
  readonly school = { seconds: 0 };
  readonly people = new Map<number, number>();
  readonly lastDelivered = new Map<number, number>();
  fixed = new Set<number>();
  readonly log: string[] = [];
  readonly rows: Row[] = [];
  readonly findings: string[] = [];
  /** What happened in the minute being played (for idle stretches). */
  happened = 0;
  /** Town growths, and how long each `TownLife.update` that grew one took (ms). */
  /** Train-seconds held at stops by auto-spacing. */
  heldSeconds = 0;
  /** Train-seconds waiting at stops for a train of the line coming the other way (crossing), and of those saying the line needs a passing loop; head-on turn-backs. */
  crossSeconds = 0;
  loopSeconds = 0;
  headOn = 0;
  readonly turnsSeen = new Set<string>();
  readonly growths: { minute: number; town: string; level: string; ms: number; built: number }[] = [];
  private growing: { town: string; level: string; built: number } | null = null;
  /** Each blueprint learned: when, how, and what it cost. */
  readonly learnedAt: { minute: number; id: string; how: string; price: string }[] = [];
  /** Coins and planks spent on what (for the report). */
  readonly spent = { blueprintsCoins: 0, blueprintsPlanks: 0, buildCoins: 0, buildPlanks: 0 };

  constructor(w: World) {
    this.attach(w);
  }

  attach(w: World): void {
    this.w = w;
    this.fixed = new Set([...w.stations.values(), ...w.depots.values()]);
    this.editor = new Editor(w.layout, w.sim, () => {}, (id) => this.fixed.has(id));
    const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
    this.town = new TownLife(host, {
      knows: (id) => this.progress.learned.has(id),
      received: (t, kind, n, before) => {
        this.lastDelivered.set(t.id, this.tick);
        payDelivery(this.progress, kind, n, before, t);
      },
      grew: (t, status, built) => {
        this.happened++;
        const before = new Set(this.progress.landmarks);
        this.syncLandmarks();
        const raised = [...this.progress.landmarks].filter((id) => !before.has(id));
        this.note(`${t.name} grew into a ${status.name.toLowerCase()} (+${built.length} buildings${raised.length ? `; new ${raised.join(", ")}` : ""}; ${townLandmarks(t).size} landmarks)`);
        if (built.length === 0) this.findings.push(`${t.name} grew to ${status.name} with no room to build (minute ${this.minute.toFixed(1)}).`);
        const gift = firstTimeGift(this.progress, status.level);
        if (gift.length > 0) this.note(`  present: ${gift.map(([id, n]) => `${n} ${ruleOf(id)!.label}`).join(", ")}`);
        const offer = offerOnGrowth(this.progress, t.name, this.random, status.level);
        const crate = this.progress.offers.at(-1)?.crate;
        this.note(`  offers ${offer.map((id) => techOf(id)!.label).join(" or ") || "no blueprint"}${crate ? `, or a crate of ${crate.map(([id, n]) => `${n} ${ruleOf(id)!.label}`).join(", ")}` : ""}`);
        this.growing = { town: t.name, level: status.name, built: built.length };
      },
    });
    this.town.reset();
    this.syncLandmarks();
    this.counters.reset(w.economy);
    // BALANCE_NOCROSS=1: trains of a line don't wait for each other (as before routes Phase 3).
    w.economy.crossing.enabled = !ENV.BALANCE_NOCROSS;
    applyCranes(w.economy, this.progress);
    attachEngines(w);
    attachPassengers(w, () => this.progress, () => {
      for (const id of learnAuto(this.progress)) this.learned(id, "carried passengers", "free");
    });
    w.economy.reserved = (kind) => kind === "planks" && this.planksKept;
    this.progress.coverMap(w);
  }

  get minute(): number {
    return minutes(this.tick);
  }

  note(s: string): void {
    this.log.push(`${this.minute.toFixed(1).padStart(6)} min  ${s}`);
  }

  learned(id: string, how: string, price: string): void {
    this.happened++;
    this.learnedAt.push({ minute: +this.minute.toFixed(1), id, how, price });
    this.note(`BLUEPRINT ${techOf(id)!.label} (${how}${price ? `, ${price}` : ""})`);
    applyCranes(this.w.economy, this.progress);
  }

  syncLandmarks(): void {
    this.progress.landmarks.clear();
    for (const id of landmarksOf(this.w.landscape)) this.progress.landmarks.add(id);
    for (const id of learnAuto(this.progress)) this.learned(id, "came with a landmark", "free");
  }

  /** The workshop keeps planks while it's short of the cheapest blueprint on the board (as the game does). */
  planksKept = false;
  updatePlanksKept(): void {
    if (workshops(this.w).length === 0) {
      this.planksKept = false;
      return;
    }
    let cheapest = Infinity;
    for (const t of TECHS) {
      if (!this.progress.board.has(t.id) || this.progress.learned.has(t.id) || !ready(this.progress, t.id)) continue;
      const planks = priceOf(this.progress, t).planks ?? 0;
      if (planks > 0) cheapest = Math.min(cheapest, planks);
    }
    this.planksKept = (workshopStock(this.w).planks ?? 0) < cheapest && cheapest < Infinity;
  }

  level(i: number): number {
    return this.town.status(this.w.landscape.towns[i].id).level;
  }

  bestLevel(): number {
    return Math.max(...this.w.landscape.towns.map((t) => this.town.status(t.id).level));
  }

  planks(): number {
    return workshopStock(this.w).planks ?? 0;
  }

  /** Play `secs` seconds: the sim and economy each tick; what the game does each second (towns, workshop, schools, people, goals). */
  run(secs: number): void {
    const end = this.tick + secs * SIM_HZ;
    while (this.tick < end) {
      this.w.sim.tick();
      this.w.economy.tick();
      this.tick++;
      if (this.tick % SIM_HZ !== 0) continue;
      this.updatePlanksKept();
      const t0 = performance.now();
      this.town.update();
      if (this.growing) {
        this.growths.push({ minute: +this.minute.toFixed(1), ...this.growing, ms: +(performance.now() - t0).toFixed(1) });
        this.growing = null;
      }
      const coins = this.progress.coins;
      const made = this.crafting.tick(this.w, 1);
      this.spent.buildCoins += coins - this.progress.coins;
      if (made) this.note(`workshop made a ${ruleOf(made)!.label.toLowerCase()}`);
      this.counters.collect(this.w.economy, this.progress);
      const supplied = (town: number) => this.tick - (this.lastDelivered.get(town) ?? -Infinity) < 180 * SIM_HZ;
      const idea = schoolIdeas(this.progress, this.w.landscape, this.school, this.progress.learned.has("college") ? 2 : 1, this.random, supplied);
      if (idea) {
        this.happened++;
        this.note(`${idea.from}: ${techOf(idea.id)!.label} is on the board (${describePrice(priceOf(this.progress, techOf(idea.id)!))})`);
      }
      peopleArrive(this.w, this.progress, 1, this.people);
      for (const engine of this.w.economy.lineIdOf.keys()) if (this.w.economy.spacing.holding(engine)) this.heldSeconds++;
      for (const engine of this.w.economy.lineIdOf.keys()) {
        const c = this.w.economy.crossWait(engine);
        if (c) this.crossSeconds++;
        if (c?.wait.kind === "needs-loop") this.loopSeconds++;
      }
      for (const id of this.w.sim.trainIds()) {
        const t = this.w.sim.getTrain(id)!;
        const turn = t.lastTurn;
        const key = turn && `${turn.tick}:${turn.pieceId}:${t.cars[0].id}`;
        if (turn?.cause === "train" && key && !this.turnsSeen.has(key)) {
          this.turnsSeen.add(key);
          this.headOn++;
        }
      }
      for (const g of this.goals.update(this.w, { learned: this.progress.learned })) {
        this.happened++;
        this.note(`GOAL ${this.goals.doneCount}/${GOALS.length} ✓ ${g.title}`);
      }
      if (this.tick % (SIM_HZ * 30) === 0) updateRates(this.w, (role) => boostOf(this.progress, role));
    }
  }

  /** Where each train is and what it carries, and the depots' piles (for the log). */
  trains(): void {
    for (const id of this.w.sim.trainIds()) {
      const t = this.w.sim.getTrain(id)!;
      const engine = t.cars.find((c) => c.kind === "engine");
      const r = engine && this.w.economy.routeOf(engine.id);
      const loads = t.cars.map((c) => {
        const g = this.w.economy.cargoOf(c.id);
        const people = c.kind === "passenger" ? this.w.economy.ridersOf(c.id).count : 0;
        return `${c.kind}${g.kind ? `:${g.count} ${g.kind}` : ""}${people ? `:${people} people` : ""}`;
      });
      const on = this.w.layout.getPiece(t.bogies[0].pieceId)?.type;
      this.note(`  train ${id}: ${loads.join(", ")}; speed ${Math.round(t.speed)}${t.derailed ? " DERAILED" : ""}; on ${on}${r ? `; route next ${r.next} (${this.w.economy.depot(r.stops[r.next].depotId)?.role})` : ""}`);
    }
    const piles = this.w.economy
      .allDepots()
      .filter((d) => this.w.layout.getPiece(d.pieceId) && d.role !== "town")
      .map((d) => `${d.role} ${describeGoods(Object.fromEntries(Object.entries(CARGO).map(([k, c]) => [k, d.piles[c.index]]).filter(([, n]) => (n as number) > 0)))}`);
    this.note(`  piles: ${piles.join("; ")}`);
  }

  // --- the toy box, as the tray does it ---

  /** Things on the map beyond what's owned: made now from the workshop's yard (as the tray makes them as they go down). */
  settle(): boolean {
    const lack = new Map<ThingId, number>();
    for (const id of Object.keys(THING_RULES) as ThingId[]) {
      if (isFree(id)) continue;
      const n = inUse(this.w, id) - (this.progress.owned.get(id) ?? 0);
      if (n > 0) lack.set(id, n);
    }
    if (lack.size === 0) return true;
    const before = { coins: this.progress.coins, planks: this.planks() };
    const why = craftNow(this.w, this.progress, lack);
    if (why) {
      this.findings.push(`OVERDRAWN at ${this.minute.toFixed(1)}: ${[...lack].map(([id, n]) => `${n} ${id}`).join(", ")}`);
      for (const [id, n] of lack) this.progress.add(id, n);
      return false;
    }
    this.spent.buildCoins += before.coins - this.progress.coins;
    this.spent.buildPlanks += before.planks - this.planks();
    return true;
  }

  /** Make whatever of `needs` isn't in the toy box, from the workshop (null) or why not. */
  make(needs: Map<ThingId, number>): string | null {
    for (const id of needs.keys()) if (!this.progress.knows(id)) return `${ruleOf(id)?.label ?? id} not learned`;
    const lack = lacking(this.w, this.progress, needs);
    if (lack.size === 0) return null;
    const before = { coins: this.progress.coins, planks: this.planks() };
    const why = craftNow(this.w, this.progress, lack);
    if (why === "no-workshop") return "no workshop";
    if (why) return `needs ${describeGoods(why.goods)}${why.coins ? ` + ${why.coins} coins` : ""}`;
    this.spent.buildCoins += before.coins - this.progress.coins;
    this.spent.buildPlanks += before.planks - this.planks();
    return null;
  }

  canMake(needs: Map<ThingId, number>): boolean {
    for (const id of needs.keys()) if (!this.progress.knows(id)) return false;
    const lack = lacking(this.w, this.progress, needs);
    return lack.size === 0 || craftShort(this.w, this.progress, lack) === null;
  }

  /** The placement rules, with the toy box: an unlearned piece is refused; a paid one only if the workshop could make it. */
  rules(): Blocked {
    const rules = rulesFor(this.w);
    return (type, flipped, pose, y, ignoreId) => {
      const id = pieceThing(type);
      if (!this.progress.knows(id)) return "toy box";
      if (!isFree(id)) {
        const lack = new Map<ThingId, number>();
        for (const t of PAID_TRACK) {
          const tid = pieceThing(t);
          const n = inUse(this.w, tid) - (this.progress.owned.get(tid) ?? 0);
          if (n > 0) lack.set(tid, n);
        }
        if (lack.size > 0 && craftShort(this.w, this.progress, lack) !== null) return "toy box";
      }
      return rules(type, flipped, pose, y, ignoreId);
    };
  }

  /** A train out of the box onto piece `pieceId` and set going; its engine's id, or why not. */
  train(cars: CarKind[], pieceId: number, lever: 1 | -1 = 1): number | string {
    const why = this.make(thingsFor({ kind: "train", cars }));
    if (why) return why;
    // On that piece, else on any free long straight of the player's (a long train needs room).
    const others = [...this.w.layout.pieceIds()].filter((id) => id !== pieceId && !this.fixed.has(id) && this.w.layout.getPiece(id)!.type === "straight-216" && !this.w.sim.pieceOccupied(id));
    for (const on of [...(this.w.layout.getPiece(pieceId) ? [pieceId] : []), ...others])
      for (const s of [100, 60, 140, 30]) {
        const r = this.w.sim.addTrain(cars, { pieceId: on, pathIndex: 0, reversed: false, s });
        if (r.kind !== "placed") continue;
        const engine = this.w.sim.getTrain(r.trainId)!.cars.find((c) => c.kind === "engine")!;
        this.w.sim.setLever(engine.id, lever);
        this.happened++;
        return engine.id;
      }
    return "no room on the track";
  }

  lift(engine: number): void {
    const found = this.w.sim.findCar(engine);
    if (found) this.w.sim.removeTrain(found.train.id);
  }
}

// --- laying track (from the tours) ---

function* sitesNear(P: Player, type: PieceTypeId, cells: number[], after?: PieceTypeId): Generator<{ pose: Pose; y: number }> {
  const w = P.w;
  const g = w.landscape.grid;
  const rules = rulesFor(w);
  for (const f of cells) {
    for (let dc = -5; dc <= 5; dc++) {
      for (let dr = -5; dr <= 5; dr++) {
        for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const x = g.centreX(g.colOf(f) + dc);
          const z = g.centreZ(g.rowOf(f) + dr);
          const cell = g.cellAtWorld(x, z);
          if (cell === -1) continue;
          const pose = { x: x - Math.cos(heading) * 108, z: z - Math.sin(heading) * 108, heading };
          const y = g.groundY(cell);
          if (siteWhy(w.landscape, type, pose) || rules(type, false, pose, y, -1)) continue;
          if (after) {
            const id = w.layout.addPiece(type, pose, y);
            const end = w.layout.worldConnector(connectorRef(id, 1), peg);
            const via = getPieceDef(after, false).connectors.findIndex((c) => c.kind !== end.kind);
            const next = appendPiece(w.layout, after, false, connectorRef(id, 1), via);
            const p = w.layout.getPiece(next)!;
            const ok = !rules(after, false, p.pose, p.y, next) && !siteWhy(w.landscape, after, p.pose);
            w.layout.removePiece(next);
            w.layout.removePiece(id);
            if (!ok) continue;
          }
          yield { pose, y };
        }
      }
    }
  }
}

function placeOn(P: Player, ref: number, type: PieceTypeId): number {
  const end = P.w.layout.worldConnector(ref, peg);
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  const tmp = appendPiece(P.w.layout, type, false, ref, via);
  const p = P.w.layout.getPiece(tmp)!;
  P.w.layout.removePiece(tmp);
  return P.editor.place(type, p.pose, p.y, false);
}

function freeEnd(P: Player, id: number): number {
  const p = P.w.layout.getPiece(id)!;
  const n = getPieceDef(p.type, p.flipped).connectors.length;
  for (let c = 0; c < n; c++) if (P.w.layout.joinedConnector(connectorRef(id, c)) === -1) return connectorRef(id, c);
  return -1;
}

/** The line's ends: each turnback, and the free end it stands on. */
function lineEnds(P: Player): { buffer: number; ref: number }[] {
  const out: { buffer: number; ref: number }[] = [];
  for (const id of P.w.layout.pieceIds()) {
    if (P.w.layout.getPiece(id)!.type !== "buffer-turnback") continue;
    const ref = P.w.layout.joinedConnector(connectorRef(id, 0));
    if (ref !== -1) out.push({ buffer: id, ref });
  }
  return out;
}

/** Is a line end (a buffer, or track that stops) within `n` pieces of piece `id`, either way? */
function nearEnd(P: Player, id: number, n: number): boolean {
  for (let c = 0; c < 2; c++) {
    let at = id;
    let exit = c;
    for (let k = 0; k < n; k++) {
      const j = P.w.layout.joinedConnector(connectorRef(at, exit));
      if (j === -1) return true;
      at = pieceOfRef(j);
      const p = P.w.layout.getPiece(at)!;
      const ends = getPieceDef(p.type, p.flipped).connectors.length;
      if (ends === 1) return true;
      if (ends !== 2) break;
      exit = 1 - indexOfRef(j);
    }
  }
  return false;
}

/**
 * An industry on a new branch (from the grand tour): a straight of the line becomes a switch (made at the workshop)
 * and a short straight, and track runs from the switch to a site for `type` near `cells` (with room for `after`). The
 * industry's piece must be in the box. Its piece and its free end, or null with everything put back.
 */
function branchOff(P: Player, type: PieceTypeId, cells: number[], after?: PieceTypeId): { id: number; beyond: number } | null {
  const w = P.w;
  const g = w.landscape.grid;
  if (!P.canMake(new Map([["piece:switch", 1]]))) return null;
  const line = [...w.layout.pieceIds()].filter((id) => !P.fixed.has(id) && w.layout.getPiece(id)!.type === "straight-216" && !nearEnd(P, id, 4));
  let tries = 0;
  for (const s of line) {
    if (++tries > 12) break;
    const p = w.layout.getPiece(s)!;
    const ends = [0, 1].map((c) => w.layout.joinedConnector(connectorRef(s, c)));
    if (ends.some((e) => e === -1) || w.sim.pieceOccupied(s)) continue;
    let straight = s;
    for (const flipped of [false, true]) {
      P.editor.remove(straight);
      const sw = P.editor.place("switch", p.pose, p.y, flipped);
      const short = placeOn(P, connectorRef(sw, 1), "straight-72");
      const joined = w.layout.joinedConnector(connectorRef(sw, 0)) !== -1 && freeEnd(P, short) === -1;
      if (joined) {
        const at = w.layout.worldConnector(connectorRef(sw, 2), peg);
        const near = cells.filter((i) => Math.hypot(g.centreX(g.colOf(i)) - at.x, g.centreZ(g.rowOf(i)) - at.z) < 1200);
        let n = 0;
        for (const site of sitesNear(P, type, near.filter((_, k) => k % 2 === 0).slice(0, 40), after)) {
          if (++n > 20) break;
          const q = P.editor.place(type, site.pose, site.y, false);
          const had = new Set(w.layout.pieceIds());
          for (const c of [1, 0]) {
            const r = play(w.layout, P.editor, connectorRef(sw, 2), connectorRef(q, c), { blocked: P.rules(), maxPieces: 60, fiddle: 3 });
            if (r.ok && P.settle()) return { id: q, beyond: connectorRef(q, 1 - c) };
            for (const id of [...w.layout.pieceIds()]) if (!had.has(id)) P.editor.remove(id);
          }
          P.editor.remove(q);
        }
      }
      P.editor.remove(short);
      P.editor.remove(sw);
      straight = P.editor.place("straight-216", p.pose, p.y, false);
    }
  }
  return null;
}

function industryAt(P: Player, type: PieceTypeId, ref: number): number {
  const id = placeOn(P, ref, type);
  const p = P.w.layout.getPiece(id)!;
  if (!rulesFor(P.w)(type, false, p.pose, p.y, id) && !siteWhy(P.w.landscape, type, p.pose)) return id;
  P.editor.remove(id);
  return -1;
}

/**
 * Run the line on from one of its ends (its turnback taken up) to an industry site for `type` near `cells` (with room
 * for `after` beyond it), or to `target` (a free end). The pieces it takes are made from the workshop as they go down.
 * The industry's piece is placed (it must already be in the toy box). Returns the new piece (or the target's piece),
 * and the free end beyond it; or null, with everything put back.
 */
function extend(P: Player, to: { type: PieceTypeId; cells: number[]; after?: PieceTypeId } | { target: () => number[] }, maxSites = 30): { id: number; beyond: number } | null {
  for (const end of lineEnds(P).sort((a, b) => 0 * a.ref - 0 * b.ref)) {
    if (P.w.sim.pieceOccupied(end.buffer)) continue;
    const bufPose = P.w.layout.getPiece(end.buffer)!;
    P.editor.remove(end.buffer);
    const from = end.ref;
    const at = P.w.layout.worldConnector(from, peg);
    if ("target" in to) {
      for (const ref of to.target()) {
        const had = new Set(P.w.layout.pieceIds());
        const r = play(P.w.layout, P.editor, from, ref, { blocked: P.rules(), maxPieces: 90, fiddle: 3 });
        if (r.ok && P.settle()) return { id: pieceOfRef(ref), beyond: -1 };
        for (const id of [...P.w.layout.pieceIds()]) if (!had.has(id)) P.editor.remove(id);
      }
    } else {
      const g = P.w.landscape.grid;
      const away = (i: number) => Math.hypot(g.centreX(g.colOf(i)) - at.x, g.centreZ(g.rowOf(i)) - at.z);
      const near = to.cells.filter((i) => away(i) < 1400).sort((a, b) => away(a) - away(b));
      // Straight on the end, if it can stand there.
      const straight = to.after ? -1 : industryAt(P, to.type, from);
      if (straight !== -1) return { id: straight, beyond: freeEnd(P, straight) };
      let n = 0;
      for (const site of sitesNear(P, to.type, near.filter((_, k) => k % 2 === 0).slice(0, 50), to.after)) {
        if (++n > maxSites) break;
        const q = P.editor.place(to.type, site.pose, site.y, false);
        const had = new Set(P.w.layout.pieceIds());
        for (const c of [0, 1]) {
          const r = play(P.w.layout, P.editor, from, connectorRef(q, c), { blocked: P.rules(), maxPieces: 90, fiddle: 3 });
          if (r.ok && P.settle()) return { id: q, beyond: connectorRef(q, 1 - c) };
          for (const id of [...P.w.layout.pieceIds()]) if (!had.has(id)) P.editor.remove(id);
        }
        P.editor.remove(q);
      }
    }
    // Back as it was.
    P.editor.place("buffer-turnback", bufPose.pose, bufPose.y, bufPose.flipped);
  }
  return null;
}

/** A turnback on a free end (one is made at the workshop if the box has none). */
function capEnd(P: Player, ref: number): boolean {
  if (ref === -1) return true;
  const r = endOn(P.w, P.editor, ref);
  if ("why" in r) {
    P.note(`couldn't put a turnback on the end (${r.why})`);
    return false;
  }
  P.settle();
  return true;
}

const st = (P: Player, i: number) => P.w.stations.get(P.w.landscape.towns[i].id)!;
const depotPiece = (P: Player, kind: string) => [...P.w.depots.values()].find((id) => P.w.layout.getPiece(id)!.type === `depot-${kind}`)!;

/** The towns on the railway (joined to Larkfield's station). */
function townsOnLine(P: Player): number[] {
  const seen = new Set<number>();
  const start = st(P, 0);
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = P.w.layout.getPiece(id)!;
    const n = getPieceDef(p.type, p.flipped).connectors.length;
    for (let c = 0; c < n; c++) {
      const j = P.w.layout.joinedConnector(connectorRef(id, c));
      if (j !== -1) stack.push(pieceOfRef(j));
    }
  }
  return P.w.landscape.towns.map((t, i) => (seen.has(P.w.stations.get(t.id)!) ? i : -1)).filter((i) => i >= 0);
}

/** The depots along the line, in order from one end to the other (an unbranched line). */
function lineOrder(P: Player): number[] {
  // Depth first from one end: on a branched line the branch's depots come together, as a train would visit them.
  const ends = lineEnds(P);
  if (ends.length === 0) return [];
  const out: number[] = [];
  const seen = new Set<number>([ends[0].buffer]);
  const visit = (at: number): void => {
    if (seen.has(at)) return;
    seen.add(at);
    const d = P.w.economy.depotAtPiece(at);
    if (d) out.push(d.id);
    const p = P.w.layout.getPiece(at)!;
    const n = getPieceDef(p.type, p.flipped).connectors.length;
    for (let c = 0; c < n; c++) {
      const j = P.w.layout.joinedConnector(connectorRef(at, c));
      if (j !== -1) visit(pieceOfRef(j));
    }
  };
  visit(pieceOfRef(ends[0].ref));
  return out;
}

describe.skipIf(!RUN)("balance play-through", () => {
  it("a new player's Game-mode game, from the start to a city ★★", () => {
    const P = new Playthrough();
    try {
      P.play();
    } finally {
      P.report();
    }
    expect(P.p.rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});

/** The new player's decisions, a minute at a time. */
class Playthrough {
  readonly p = new Player(buildStarterWorld());
  shop = -1;
  timber = -1;
  /** The trains on the line: an engine id each, with what it's for. */
  trains = new Map<number, string>();
  farm = -1;
  mill = -1;
  quarry = -1;
  halt = -1;
  switchLaid = false;
  joinedThird = false;
  lines = false;
  sawn = 0;
  sawnAt = 0;
  /** Trains picked up after a jam (the second train isn't put back on the same line while it would jam again). */
  lifted = 0;
  /** The line every train runs once routes are learned, the most trains it had, and trains taken off it for a jam. */
  lineId = -1;
  perLine = 0;
  jamCut = 0;
  extraAt = -99;
  recomposed = -99;
  /** Minutes in a row with nothing new. */
  idle = 0;
  readonly idleStretches: { from: number; to: number; why: string }[] = [];
  why = "";
  idleWhy = "";
  farmTry = -99;
  harvester = -1;
  harvesterTry = -99;
  /** When things first came within reach (a blueprint offered or on the board), and each town level first reached. */
  readonly firsts: Record<string, number> = {};
  /** The longest stretch with no planks sawn (whole minutes). */
  stall = 0;
  /** The longest stretch with no planks sawn while two trains share the line (they turn each other back). */
  jamStall = 0;
  quarryTry = -99;

  play(): void {
    const P = this.p;
    const w = () => P.w;
    P.note(`new game: towns ${w().landscape.towns.map((t) => t.name).join(", ")}; box ${[...P.progress.owned].map(([id, n]) => `${n} ${id}`).join(", ")}; board ${[...P.progress.board].join(", ")}`);

    // 1. The starter line, as the tutorial goals lead: Larkfield to Elderwick, Larkfield to the sawmill, Elderwick to
    // the forest yard; turnbacks on the ends. (The workshop comes later, when its goal asks.)
    for (const [name, a, b] of [
      ["Larkfield → Elderwick", connectorRef(st(P, 0), 1), connectorRef(st(P, 1), 0)],
      ["Larkfield → sawmill", connectorRef(st(P, 0), 0), connectorRef(depotPiece(P, "sawmill"), 1)],
      ["Elderwick → forest yard", connectorRef(st(P, 1), 1), connectorRef(depotPiece(P, "forest"), 0)],
    ] as const) {
      const r = play(w().layout, P.editor, a, b, { blocked: P.rules(), maxPieces: 60, fiddle: 3 });
      P.note(`${name}: ${r.ok ? `joined (${r.pieces} pieces)` : `NOT JOINED (${r.how})`}`);
      expect(r.ok, name).toBe(true);
    }
    capEnd(P, connectorRef(depotPiece(P, "sawmill"), 0));
    capEnd(P, connectorRef(depotPiece(P, "forest"), 1));
    const middle = () => [...w().layout.pieceIds()].find((id) => !P.fixed.has(id) && w().layout.getPiece(id)!.type.startsWith("straight") && Math.abs(w().layout.getPiece(id)!.pose.x) < 300 && !w().sim.pieceOccupied(id))!;
    const t = P.train(["engine", "timber", "timber", "timber"], middle(), -1);
    if (typeof t === "string") throw new Error(t);
    this.timber = t;
    this.trains.set(t, "timber");
    P.note("timber train (engine, 3 flatbeds) out of the box and set going");

    for (let minute = 1; minute <= MAX_MINUTES; minute++) {
      P.happened = 0;
      P.run(60);
      if (ENV.BALANCE_TRACE && minute >= Number(ENV.BALANCE_TRACE.split("-")[0]) && minute <= Number(ENV.BALANCE_TRACE.split("-")[1])) P.trains();
      this.decide();
      const s = P.progress;
      P.rows.push({
        minute,
        coins: s.coins,
        planks: P.planks(),
        goals: P.goals.doneCount,
        blueprints: [...s.learned].length,
        learned: [...s.learned],
        levels: w().landscape.towns.map((t) => P.town.status(t.id).level),
        trains: w().sim.trainIds().length,
        riders: s.riders,
      });
      if (minute % 5 === 0) {
        const towns = w()
          .landscape.towns.map((t, i) => [t, i] as const)
          .filter(([, i]) => P.level(i) > 0 || townsOnLine(P).includes(i))
          .map(([t]) => {
            const st2 = P.town.status(t.id);
            return `${t.name} ${st2.name.toLowerCase()} (${Object.entries(st2.wants).map(([k, n]) => `${st2.got[k as keyof typeof st2.got] ?? 0}/${n} ${k}`).join(", ")})`;
          });
        if (minute % 10 === 0) P.trains();
        P.note(`status: ${s.coins} coins; workshop ${describeGoods(workshopStock(w()))}; goal ${P.goals.current()?.title ?? "all done"}; board ${[...s.board].filter((id) => !s.learned.has(id)).map((id) => `${id}${ready(s, id) ? "" : "(not ready)"}`).join(", ") || "empty"}; ${towns.join("; ")}`);
      }
      if (P.happened === 0) {
        if (this.idle === 0) this.idleWhy = this.why;
        this.idle++;
      } else {
        if (this.idle >= 5) this.idleStretches.push({ from: minute - this.idle, to: minute - 1, why: this.idleWhy });
        this.idle = 0;
      }
      if (P.bestLevel() >= TARGET_LEVEL) {
        P.note(`TARGET: a city ★★ at minute ${minute}`);
        break;
      }
    }
    const last = P.rows.at(-1)?.minute ?? 0;
    if (this.idle >= 5) this.idleStretches.push({ from: last - this.idle + 1, to: last, why: this.idleWhy });
  }

  /** A minute's decisions. */
  decide(): void {
    const P = this.p;
    const w = P.w;
    const s = P.progress;
    this.why = "";
    // A derailed train: Re-rail, and set it going.
    for (const id of w.sim.trainIds()) {
      if (!w.sim.getTrain(id)?.derailed) continue;
      const back = w.sim.rerail(id);
      P.note(`a train derailed: ${back !== -1 ? "re-railed" : "COULDN'T re-rail"}`);
      if (back !== -1) for (const car of w.sim.getTrain(back)?.cars ?? []) if (car.kind === "engine") w.sim.setLever(car.id, 1);
    }
    // Two trains on one line turn each other back, and the goods train may never reach one end: with no planks sawn
    // for a few minutes, a player sees it and picks the other train up (it can come back on a line of its own).
    const sawn = w.economy.made[CARGO.planks.index];
    if (sawn !== this.sawn) {
      this.sawn = sawn;
      this.sawnAt = P.minute;
    } else if ((this.stall = Math.max(this.stall, Math.round(P.minute - this.sawnAt))) && (this.trains.size < 2 || (this.jamStall = Math.max(this.jamStall, Math.round(P.minute - this.sawnAt)))) && P.minute - this.sawnAt >= 4 && this.trains.size >= 2) {
      const [e, kind] = [...this.trains].find(([id]) => id !== this.timber) ?? [];
      if (e !== undefined) {
        P.lift(e);
        this.trains.delete(e);
        this.lifted++;
        if (this.lines) this.jamCut++;
        P.findings.push(`Minute ${P.minute.toFixed(0)}: no planks sawn for 4 minutes with ${this.trains.size + 1} trains on one line (they turn each other back; the goods train never reached the forest). Picked the ${kind} train up.`);
        P.note(`JAM: no planks sawn for 4 min; picked the ${kind} train up`);
        this.sawnAt = P.minute;
      }
    }
    if (Math.round(P.minute - this.sawnAt) === 5) {
      P.note("STALL: no planks sawn for 5 minutes");
      P.trains();
    }
    // Rewards: a blueprint from what a town offers (the one wanted most), or the crate if no blueprint.
    while (s.offers.length > 0) {
      const o = s.offers[0];
      const rank = (id: string) => (WISH.indexOf(id) === -1 ? 99 : WISH.indexOf(id));
      const pick = [...o.ids].sort((a, b) => rank(a) - rank(b))[0];
      if (pick && takeBlueprint(s, 0, pick, P.random)) {
        P.learned(pick, `chosen from ${o.from}'s offer`, `free; the other (${o.ids.filter((x) => x !== pick).map((x) => techOf(x)!.label).join("") || "none"}) to the board`);
      } else if (o.crate && takeCrate(s, 0)) {
        P.note(`took ${o.from}'s crate`);
      } else s.offers.shift();
    }
    // The board: the most wanted blueprint on it, when its price is in the yard and in hand. (A sensible player saves
    // for the most wanted one rather than spending on lesser ones.)
    const onBoard = WISH.filter((id) => s.board.has(id) && ready(s, id));
    // Others (and the wished-for ones with no use yet) only with planks and coins to spare.
    // (Not while the goal wants planks for a bridge.)
    const goalNeeds = P.goals.current()?.id === "build-bridge" && P.planks() < 10;
    const rich = P.planks() >= 24 && s.coins >= 150 && !goalNeeds;
    const others = TECHS.filter((t) => s.board.has(t.id) && ready(s, t.id) && (!WISH.includes(t.id) || LATER.has(t.id))).map((t) => t.id);
    for (const id of [...onBoard.filter((id) => !LATER.has(id)), ...(rich ? others : [])].slice(0, 2)) {
      const price = priceOf(s, techOf(id)!);
      const planks = P.planks();
      const coins = s.coins;
      if (learnWithGoods(w, s, id)) {
        P.spent.blueprintsCoins += coins - s.coins;
        P.spent.blueprintsPlanks += planks - P.planks();
        P.learned(id, "learned on the board", describePrice(price));
        break;
      }
      this.why = `saving for ${techOf(id)!.label} (${describePrice(price)}; have ${P.planks()} planks, ${s.coins} coins)`;
    }
    this.build();
    if (!this.why) {
      // Nothing to save for: say what's in the way (an empty board, what the towns want).
      const wants = w.landscape.towns
        .filter((t) => P.town.status(t.id).level > 0)
        .map((t) => {
          const st2 = P.town.status(t.id);
          const left = Object.entries(st2.wants).filter(([k, n]) => (st2.got[k as keyof typeof st2.got] ?? 0) < n!).map(([k]) => k);
          return `${t.name} wants ${left.join("+") || "nothing"}`;
        });
      const board = [...s.board].filter((id) => !s.learned.has(id));
      this.why = `nothing to buy (board: ${board.join(", ") || "empty"}); ${wants.join("; ")}`;
    }
    // Key moments, for the summary.
    for (const id of ["farming", "mills", "quarries", "routes", "passengers", "halts", "carpentry", "mines", "foundry"])
      if (!(id in this.firsts) && (s.board.has(id) || s.learned.has(id) || s.offers.some((o) => o.ids.includes(id)))) this.firsts[id] = Math.round(P.minute);
    const best = P.bestLevel();
    for (let l = 1; l <= best; l++) if (!(`level ${l}` in this.firsts)) this.firsts[`level ${l}`] = Math.round(P.minute);
  }

  build(): void {
    const P = this.p;
    const w = P.w;
    const s = P.progress;
    const goal = P.goals.current()?.id;
    const g = w.landscape.grid;

    // The workshop goal: dropped on the straight its guide points at (spliced into the line, as the drop does).
    if (this.shop === -1 && goal === "place-workshop") {
      const spot = GOALS.find((x) => x.id === "place-workshop")!.guide(w).marks[0];
      const straight =
        spot &&
        [...w.layout.pieceIds()].find((id) => {
          const p = w.layout.getPiece(id)!;
          return p.type === "straight-216" && Math.hypot(p.pose.x + 108 * Math.cos(p.pose.heading) - spot.x, p.pose.z + 108 * Math.sin(p.pose.heading) - spot.z) < 2 && !w.sim.pieceOccupied(id);
        });
      if (straight) {
        const p = w.layout.getPiece(straight)!;
        const pose = { ...p.pose };
        const y = p.y;
        P.editor.remove(straight);
        let id = P.editor.place("depot-workshop", pose, y, false);
        if (rulesFor(w)("depot-workshop", false, pose, y, id)) {
          P.editor.remove(id);
          const back = { x: pose.x + 216 * Math.cos(pose.heading), z: pose.z + 216 * Math.sin(pose.heading), heading: pose.heading + Math.PI };
          id = P.editor.place("depot-workshop", back, y, false);
        }
        this.shop = id;
        syncIndustries(w, true);
        P.settle();
        P.happened++;
        const d = (k: number) => Math.round(Math.hypot(pose.x - w.layout.getPiece(k)!.pose.x, pose.z - w.layout.getPiece(k)!.pose.z));
        P.note(`dropped the workshop on the line where its goal points (${d(st(P, 0))} mm from Larkfield's station, ${d(depotPiece(P, "sawmill"))} mm from the sawmill)`);
      } else this.why = "no spot for the workshop";
    }

    // The switch goal: a switch on the map (there's nothing to branch to yet: it goes down beside the line).
    if (!this.switchLaid && s.learned.has("switches") && goal === "lay-switch") {
      const why = P.make(new Map([["piece:switch", 1]]));
      if (!why) {
        const c = w.landscape.towns[1].centre;
        let ok = false;
        for (let r = 1; r < 12 && !ok; r++)
          for (let k = 0; k < 8 && !ok; k++) {
            const a = (k / 8) * Math.PI * 2;
            const pose = { x: Math.round((c.x + Math.cos(a) * r * 72) / 18) * 18, z: Math.round((c.z + 400 + Math.sin(a) * r * 72) / 18) * 18, heading: 0 };
            const cell = g.cellAtWorld(pose.x, pose.z);
            if (cell === -1) continue;
            const y = g.groundY(cell);
            if (rulesFor(w)("switch", false, pose, y, -1)) continue;
            P.editor.place("switch", pose, y, false);
            ok = true;
          }
        this.switchLaid = ok;
        P.note(ok ? "laid a switch beside the line for the goal (nothing to branch to yet)" : "COULDN'T lay a switch");
        if (ok) P.happened++;
      } else this.why = `a switch: ${why}`;
    }

    // Join a third town (and the bridge goal, if the way crosses a river): from a line end, once bridges are known
    // (a river may be in the way) or the goal asks for it.
    if (!this.joinedThird && (s.learned.has("bridges") || goal === "join-three") && P.goals.isDone("lay-switch")) {
      const on = townsOnLine(P);
      const others = w.landscape.towns.map((_, i) => i).filter((i) => !on.includes(i));
      const ends = lineEnds(P).map((e) => w.layout.worldConnector(e.ref, peg));
      const dist = (i: number) => Math.min(...ends.map((e) => Math.hypot(w.landscape.towns[i].centre.x - e.x, w.landscape.towns[i].centre.z - e.z)));
      others.sort((a, b) => dist(a) - dist(b));
      for (const i of others.slice(0, 2)) {
        const station = st(P, i);
        const r = extend(P, { target: () => [connectorRef(station, 0), connectorRef(station, 1)] });
        if (r) {
          const far = freeEnd(P, station);
          capEnd(P, far);
          this.joinedThird = true;
          P.happened++;
          P.note(`ran the line on to ${w.landscape.towns[i].name} (third town); ${[...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id)!.type.startsWith("bridge")).length} bridges, ${[...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id)!.type.startsWith("ramp")).length} ramps on the line`);
          break;
        }
      }
      if (!this.joinedThird) this.why = "couldn't join a third town yet";
    }
    // The bridge goal, if joining towns didn't need one: a bridge by itself.
    if (goal === "build-bridge" && s.learned.has("bridges") && (this.joinedThird || this.idle > 3)) {
      const why = P.make(new Map([["piece:bridge", 1]]));
      if (!why) {
        // Beside the line near Larkfield, at the height the game gives a bridge dropped there (up on its arches).
        const c = w.landscape.towns[0].centre;
        let laid = false;
        for (let r = 2; r < 14 && !laid; r++)
          for (let k = 0; k < 8 && !laid; k++) {
            const a = (k / 8) * Math.PI * 2;
            const pose = { x: Math.round((c.x + Math.cos(a) * r * 72) / 18) * 18, z: Math.round((c.z - 400 + Math.sin(a) * r * 72) / 18) * 18, heading: 0 };
            const y = looseHeight(w.landscape, w.layout, "bridge", false, pose, -1);
            const id = w.layout.addPiece("bridge", pose, y, false);
            const bad = rulesFor(w)("bridge", false, pose, y, id);
            w.layout.removePiece(id);
            if (bad) continue;
            P.editor.place("bridge", pose, y, false);
            laid = true;
          }
        P.note(laid ? "put a bridge down by itself for the goal (the line didn't cross a river)" : "COULDN'T put a bridge down");
        if (laid) P.happened++;
      } else this.why = `a bridge for the goal: ${why}`;
    }

    // The second train: when the box has an engine again (the first village's present), on the far half of the line.
    const engines = (s.owned.get("car:engine") ?? 0) - inUse(w, "car:engine");
    if (this.trains.size < 2 && engines > 0 && this.lifted === 0 && goal === "two-trains") {
      const cars: CarKind[] = s.learned.has("passengers") ? ["engine", "passenger", "passenger"] : ["engine", "timber"];
      const spot = [...w.layout.pieceIds()].find((id) => !P.fixed.has(id) && w.layout.getPiece(id)!.type.startsWith("straight") && w.layout.getPiece(id)!.pose.x > 700 && !w.sim.pieceOccupied(id));
      if (spot !== undefined) {
        const e = P.train(cars, spot, 1);
        if (typeof e === "number") {
          this.trains.set(e, cars.includes("passenger") ? "people" : "timber 2");
          P.note(`second train (${cars.join(", ")}) set going`);
        }
      }
    }
    // Passengers learned: the second train carries people (two coaches).
    if (s.learned.has("passengers") && ![...this.trains.values()].includes("people") && this.trains.size >= 2) {
      const [e] = [...this.trains].find(([, k]) => k === "timber 2") ?? [];
      if (e !== undefined && P.canMake(new Map<ThingId, number>([["car:passenger", 2]]))) {
        const found = w.sim.findCar(e);
        const on = found ? found.train.bogies[0].pieceId : -1;
        P.lift(e);
        this.trains.delete(e);
        const n = P.train(["engine", "passenger", "passenger"], on, 1);
        if (typeof n === "number") {
          this.trains.set(n, "people");
          P.note("the second train is now a passenger train (engine, 2 coaches)");
        } else P.note(`passenger train: ${n}`);
      }
    }

    // The farm: a farm yard by the fields at a line end, with room for a mill after it.
    if (this.farm === -1 && s.learned.has("farming") && P.minute - this.farmTry >= 10) {
      if (P.canMake(new Map([["piece:depot-farm", 1]]))) {
        this.farmTry = P.minute;
        const fields: number[] = [];
        g.forEachCell((i) => {
          if (g.feature[i] === FEAT_FIELD) fields.push(i);
        });
        P.make(new Map([["piece:depot-farm", 1]]));
        const r = extend(P, { type: "depot-farm", cells: fields, after: "depot-mill" }) ?? (s.learned.has("switches") ? branchOff(P, "depot-farm", fields, "depot-mill") : null);
        if (r) {
          this.farm = r.id;
          capEnd(P, r.beyond);
          syncIndustries(w, true);
          updateRates(w, (role) => boostOf(s, role));
          P.happened++;
          P.note(`built a farm yard at the line's end (rate ${w.economy.depotAtPiece(r.id)!.rate.toFixed(2)})`);
          if (this.lines) this.routeGoods();
        } else {
          P.note("COULDN'T reach a farm site from the line's ends (or a branch)");
          s.add("piece:depot-farm", 0);
        }
      } else this.why = `a farm yard (${describeGoods(ruleOf("piece:depot-farm")!.cost)} + ${ruleOf("piece:depot-farm")!.coins} coins; have ${P.planks()} planks, ${s.coins} coins)`;
    }
    // The mill, after the farm yard.
    if (this.farm >= 0 && this.mill === -1 && s.learned.has("mills")) {
      if (P.canMake(new Map([["piece:depot-mill", 1]]))) {
        const end = freeEnd(P, this.farm);
        const buf = end === -1 ? lineEnds(P).find((e) => pieceOfRef(e.ref) === this.farm) : { buffer: -1, ref: end };
        if (buf && (buf.buffer === -1 || !w.sim.pieceOccupied(buf.buffer))) {
          P.make(new Map([["piece:depot-mill", 1]]));
          if (buf.buffer !== -1) P.editor.remove(buf.buffer);
          const id = industryAt(P, "depot-mill", buf.ref);
          if (id !== -1) {
            this.mill = id;
            capEnd(P, freeEnd(P, id));
            syncIndustries(w, true);
            P.happened++;
            P.note("built a mill after the farm yard");
            if (this.lines) this.routeGoods();
          } else {
            capEnd(P, buf.ref);
            P.note("the mill won't go after the farm yard");
            this.mill = -2;
          }
        }
      } else this.why = `a mill (${describeGoods(ruleOf("piece:depot-mill")!.cost)} + ${ruleOf("piece:depot-mill")!.coins} coins; have ${P.planks()} planks, ${s.coins} coins)`;
    }
    // The goods train carries what the line makes (a hopper once there's a farm, a van once there's a mill, another
    // hopper for stone, coaches once people ride), as many cars as its engine pulls: a goods engine's 8 once learned.
    // One train for everything: a second on the single line only turns the first back.
    const goodsLook = s.learned.has("goods-engine");
    const pulls = goodsLook ? 8 : 4;
    const want: CarKind[] = ["timber", "timber"];
    if (this.farm >= 0) want.push("hopper");
    if (this.mill >= 0) want.push("van");
    if (this.quarry >= 0) want.push("hopper");
    if (s.learned.has("passengers")) want.push("passenger", "passenger");
    if (this.farm < 0 && !s.learned.has("passengers")) want.push("timber");
    const kinds: CarKind[] = ["engine", ...want.slice(0, pulls)];
    const found = w.sim.findCar(this.timber);
    const current = found?.train.cars.map((c) => c.kind).sort().join(",");
    const look = found ? w.sim.lookOf(this.timber) : "classic";
    if (found && (current !== [...kinds].sort().join(",") || (goodsLook && look !== "goods")) && P.minute - this.recomposed >= 3) {
      // (Its own cars come back to the box as it's picked up: only what's short beyond them is made.)
      const on = found.train.bogies[0].pieceId;
      const had = found.train.cars.map((c) => c.kind);
      const short = new Map<ThingId, number>();
      for (const [id, n] of thingsFor({ kind: "train", cars: kinds })) {
        const back = had.filter((k) => `car:${k}` === id).length;
        const k = n - P.progress.available(w, id) - back;
        if (k > 0) short.set(id, k);
      }
      if (short.size === 0 || craftShort(w, s, short) === null) {
        this.recomposed = P.minute;
        P.lift(this.timber);
        this.trains.delete(this.timber);
        const e = P.train(kinds, on, -1);
        if (typeof e === "number") {
          this.timber = e;
          this.trains.set(e, "goods");
          if (goodsLook) w.sim.setLook(e, "goods");
          P.note(`the goods train is now ${goodsLook ? "a goods engine" : "an engine"} with ${kinds.slice(1).join(", ")}`);
          if (this.lines) this.routeGoods();
        } else {
          const back = P.train(had, on, -1);
          if (typeof back === "number") {
            this.timber = back;
            this.trains.set(back, "goods");
            if (look !== "classic") w.sim.setLook(back, look);
          }
          P.note(`couldn't make the new goods train: ${e}`);
        }
      } else this.why = `cars for the goods train: ${[...short].map(([id, n]) => `${n} ${id}`).join(", ")}`;
    }

    // Routes: each train runs a line of the depots along the track, in order, "auto" at each (the intent rules).
    if (!this.lines && s.learned.has("routes") && !ENV.BALANCE_NOLINES) {
      this.lines = true;
      this.routeGoods();
      P.happened++;
    }
    // More trains on the line as they become affordable (an engine and two flatbeds), up to BALANCE_TRAINS_PER_LINE,
    // a few minutes apart; one fewer for each that jammed the line.
    if (this.lines && this.lineId >= 0 && this.trains.size < PER_LINE - this.jamCut && P.minute - this.extraAt >= 3) {
      const cars: CarKind[] = ["engine", "timber", "timber"];
      if (P.canMake(thingsFor({ kind: "train", cars }))) {
        const e = P.train(cars, -1, 1);
        if (typeof e === "number") {
          this.trains.set(e, `line train ${this.trains.size + 1}`);
          joinLine(w.economy, e, this.lineId);
          this.extraAt = P.minute;
          P.note(`another train (engine, 2 flatbeds) on the line: ${trainsOn(w.economy, this.lineId).length} now`);
        }
      } else this.why ||= `another train for the line (engine 6🪵 + 2 flatbeds 6🪵; have ${P.planks()} planks)`;
    }
    if (this.lineId >= 0) this.perLine = Math.max(this.perLine, trainsOn(w.economy, this.lineId).filter((e) => w.sim.findCar(e)).length);

    // A harvester (a forest yard of the player's own) by trees at a line end, for more logs.
    if (this.harvester === -1 && s.learned.has("harvesters") && P.minute - this.harvesterTry >= 10) {
      if (P.canMake(new Map([["piece:depot-forest", 1]]))) {
        this.harvesterTry = P.minute;
        const trees: number[] = [];
        g.forEachCell((i) => {
          if (g.feature[i] === FEAT_TREE) trees.push(i);
        });
        P.make(new Map([["piece:depot-forest", 1]]));
        const r = extend(P, { type: "depot-forest", cells: trees }) ?? (s.learned.has("switches") ? branchOff(P, "depot-forest", trees) : null);
        if (r) {
          this.harvester = r.id;
          capEnd(P, r.beyond);
          syncIndustries(w, true);
          updateRates(w, (role) => boostOf(s, role));
          P.happened++;
          P.note(`built a harvester (rate ${w.economy.depotAtPiece(r.id)!.rate.toFixed(2)})`);
          if (this.lines) this.routeGoods();
        } else P.note("COULDN'T reach a harvester site");
      } else this.why ||= `a harvester (${describeGoods(ruleOf("piece:depot-forest")!.cost)} + ${ruleOf("piece:depot-forest")!.coins} coins; have ${P.planks()} planks, ${s.coins} coins)`;
    }
    // Fields for the farm yard while it works below full speed, with coins to spare (its card's "Plant a field").
    if (this.farm >= 0 && s.coins >= fieldPrice(s.fieldsPlanted) + 60) {
      const piece = w.layout.getPiece(this.farm);
      const r = piece && resourceAt(w.landscape, "farm", piece.pose);
      if (piece && r && r.count < r.need) {
        const editor = new LandEditor(w.landscape, w.layout, { inRect: (x0, z0, x1, z1) => propsInRect(w.props, () => undefined, x0, z0, x1, z1) });
        const cells = fieldSpot(w.landscape, editor, yardMiddle(piece.pose), SITE_RULES.farm!.reach);
        if (cells) {
          const price = fieldPrice(s.fieldsPlanted);
          s.coins -= price;
          s.fieldsPlanted++;
          P.spent.buildCoins += price;
          plantField(w.landscape, cells);
          updateRates(w, (role) => boostOf(s, role));
          P.happened++;
          P.note(`planted a field for ${price} coins (farm yard at ${Math.round(rateFor(r.count + 4, r.need) * 100)}%)`);
        }
      }
    }

    // Halts: a country halt in the line near a town (its people share the town's).
    if (this.halt === -1 && s.learned.has("halts") && P.canMake(new Map([["piece:kit-country-halt", 1]]))) {
      const on = townsOnLine(P);
      const station = (i: number) => w.layout.getPiece(st(P, i))!.pose;
      const candidates = [...w.layout.pieceIds()].filter((id) => {
        const p = w.layout.getPiece(id)!;
        if (P.fixed.has(id) || p.type !== "straight-216" || w.sim.pieceOccupied(id)) return false;
        const town = haltTown(w.landscape, p.pose);
        if (!town) return false;
        const i = w.landscape.towns.indexOf(town);
        return on.includes(i) && Math.hypot(p.pose.x - station(i).x, p.pose.z - station(i).z) > 400;
      });
      for (const id of candidates) {
        const p = w.layout.getPiece(id)!;
        const pose = { ...p.pose };
        const y = p.y;
        const joined = [0, 1].map((c) => w.layout.joinedConnector(connectorRef(id, c)));
        P.editor.remove(id);
        const ok = !rulesFor(w)("kit-country-halt", p.flipped, pose, y, -1) && !haltWhy(w.landscape, "kit-country-halt", pose);
        if (ok) {
          const h = P.editor.place("kit-country-halt", pose, y, p.flipped);
          const both = [0, 1].every((c) => w.layout.joinedConnector(connectorRef(h, c)) !== -1);
          if (both) {
            P.make(new Map([["piece:kit-country-halt", 1]]));
            syncIndustries(w, true);
            this.halt = h;
            P.happened++;
            P.note(`a country halt in the line near ${haltTown(w.landscape, pose)!.name} (joined: ${joined.every((j) => j !== -1)})`);
            if (this.lines) this.routeGoods();
            break;
          }
          P.editor.remove(h);
        }
        P.editor.place("straight-216", pose, y, p.flipped);
      }
      if (this.halt === -1) {
        this.halt = -2;
        P.note("no straight near a town for a halt");
      }
    }

    // The quarry (a city's library opens it): at a line end, on the hillside.
    if (this.quarry === -1 && s.learned.has("quarries") && P.minute - this.quarryTry >= 10) {
      if (P.canMake(new Map([["piece:depot-quarry", 1]]))) {
        this.quarryTry = P.minute;
        const hills: number[] = [];
        g.forEachCell((i) => {
          if (g.height[i] > 0) hills.push(i);
        });
        P.make(new Map([["piece:depot-quarry", 1]]));
        const r = extend(P, { type: "depot-quarry", cells: hills }) ?? (s.learned.has("switches") ? branchOff(P, "depot-quarry", hills) : null);
        if (r) {
          this.quarry = r.id;
          capEnd(P, r.beyond);
          syncIndustries(w, true);
          updateRates(w, (role) => boostOf(s, role));
          P.happened++;
          P.note("built a quarry at a line end");
          if (this.lines) this.routeGoods();
        } else {
          P.note("COULDN'T reach a quarry site from the line's ends (or a branch)");
        }
      } else this.why = `a quarry (${describeGoods(ruleOf("piece:depot-quarry")!.cost)} + ${ruleOf("piece:depot-quarry")!.coins} coins; have ${P.planks()} planks, ${s.coins} coins)`;
    }
  }

  /** Give each train a line: the depots along the track in order, there and back, "auto" (the intent rules). */
  routeGoods(): void {
    const P = this.p;
    const w = P.w;
    const order = lineOrder(P);
    if (order.length < 2) return;
    const back = order.slice(1, -1).reverse();
    const stops = [...order, ...back].map((depotId) => ({ depotId, action: "auto" as const }));
    // One line for every train (with routes-lines' auto-spacing to spread them out); its stops follow the track.
    const live = [...this.trains.keys()].filter((e) => w.sim.findCar(e));
    if (live.length === 0) return;
    if (this.lineId < 0 || !w.economy.lines.has(this.lineId)) this.lineId = startLine(w.economy, live[0], stops.map((x) => ({ ...x }))).id;
    for (const e of live) joinLine(w.economy, e, this.lineId);
    editLine(w.economy, live[0], (old) => old.splice(0, old.length, ...stops.map((x) => ({ ...x }))));
    P.note(`${live.length} train(s) on a line of ${stops.length} stops: ${order.map((d) => w.economy.depot(d)!.role).join(" → ")} and back`);
  }

  report(): void {
    const P = this.p;
    const w = P.w;
    const pick = P.rows.filter((r) => r.minute <= 10 || r.minute % 5 === 0);
    const table = pick.map((r) => `${String(r.minute).padStart(4)} | ${String(r.coins).padStart(5)} | ${String(r.planks).padStart(3)} | ${String(r.goals).padStart(2)}/${GOALS.length} | ${String(r.blueprints).padStart(2)} | ${r.levels.join(",")} | ${r.trains} | ${r.riders}`);
    const status = w.landscape.towns.map((t) => `${t.name} ${P.town.status(t.id).name.toLowerCase()} [${[...townLandmarks(t)].join(", ")}] had ${describeGoods(receivedBy(w, t.id))}`);
    const out = [
      "balance play-through:",
      ...P.log,
      "",
      "minute | coins | planks | goals | bps | town levels | trains | riders",
      ...table,
      "",
      `towns: ${status.join("; ")}`,
      `blueprints: ${P.learnedAt.map((b) => `${b.minute} ${b.id} (${b.how}; ${b.price})`).join(" · ")}`,
      `spent: ${JSON.stringify(P.spent)}; coins now ${P.progress.coins}`,
      `growths: ${P.growths.map((g) => `${g.minute} ${g.town}→${g.level} ${g.ms} ms (${g.built} lots)`).join(" · ")}`,
      `idle stretches (5+ minutes with nothing new): ${this.idleStretches.map((s) => `${s.from}-${s.to} (${s.why})`).join(" · ") || "none"}`,
      `goals: ${GOALS.map((g) => `${P.goals.isDone(g.id) ? "✓" : "·"} ${g.title}`).join(" | ")}`,
      `counts: ${[...P.progress.counts].map(([k, n]) => `${k} ${n}`).join(", ")}; riders ${P.progress.riders}`,
      `firsts: ${JSON.stringify(this.firsts)}`,
      `SUMMARY coins180 ${P.rows.at(-1)?.coins} planks180 ${P.rows.at(-1)?.planks} stall ${this.stall} jamStall ${this.jamStall} city ${this.firsts["level 3"] ?? "-"} cityStar ${this.firsts["level 4"] ?? "-"} riders ${P.progress.riders} spentCoins ${P.spent.blueprintsCoins + P.spent.buildCoins} perLine ${this.perLine} held ${(P.heldSeconds / 60).toFixed(1)}min jamCut ${this.jamCut} crossWait ${(P.crossSeconds / 60).toFixed(1)}min loopWait ${(P.loopSeconds / 60).toFixed(1)}min headOn ${P.headOn}`,
      `findings:\n- ${P.findings.join("\n- ") || "none"}`,
    ].join("\n");
    console.log(out);
    if (ENV.BALANCE_JSON) console.log(`BALANCE_JSON ${JSON.stringify({ firsts: this.firsts, rows: P.rows, learned: P.learnedAt, growths: P.growths, idle: this.idleStretches, spent: P.spent, findings: P.findings })}`);
  }
}
