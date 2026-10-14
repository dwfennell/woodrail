import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { CARGO } from "../economy/cargo";
import { describe as describeGoods } from "../economy/goods";
import { Crafting, workshops, workshopStock } from "../game/crafting";
import { GOALS, GoalTracker } from "../game/goals";
import { inUse, Progress } from "../game/progress";
import { offerOnGrowth, payDelivery } from "../game/rewards";
import { choose, learnWithGoods, ready, techOf } from "../game/tech";
import { isFree, ruleOf, thingsFor, type ThingId } from "../game/things";
import { TownLife, type TownLifeHost } from "../game/town-life";
import { plotPrice, townStatus } from "../game/towns";
import { buildStarterWorld, createWorld, plotsForSale, syncIndustries, unlockPlot, type World } from "../game/world";
import { rng } from "../lib/rng";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { SIM_HZ, type CarKind } from "../sim";
import { looseHeight } from "../landscape";
import { connectorRef, getPieceDef, type PieceTypeId } from "../track";
import { play, type Blocked } from "./player";
import { endOn, layOn, rulesFor } from "./rules";

/**
 * A whole Game-mode playthrough, headless, using the game's own pieces: a simulated player lays the starter line
 * (with the placement rules), every piece and train comes out of the toy box (or is refused), towns grow and pay as
 * in the game (TownLife, rewards), the workshop makes what's ordered (Crafting), blueprints are chosen and learned
 * (tech), land is bought with coins, goals are ticked (GoalTracker), and the game is saved and loaded part way.
 * The log it keeps is the report.
 */

/** The headless stand-in for the Game: the world, and nothing to redraw. */
function hostFor(w: World): TownLifeHost {
  return Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
}

const minutes = (ticks: number) => (ticks / SIM_HZ / 60).toFixed(1);

/**
 * The placement rules with Game mode's toy box on top: a piece the player hasn't learned, or has no more of, is
 * refused like any other rule. (Checked with the piece already down, as the player's look-ahead puts it: so it may
 * go if what's on the map is within what's owned.)
 */
function gameRules(w: World, progress: Progress): Blocked {
  const rules = rulesFor(w);
  return (type, flipped, pose, y, ignoreId) => {
    const id: ThingId = `piece:${type}`;
    if (!isFree(id) && (!progress.knows(id) || inUse(w, id) > (progress.owned.get(id) ?? 0))) return "toy box";
    return rules(type, flipped, pose, y, ignoreId);
  };
}

class Playthrough {
  w!: World;
  editor!: Editor;
  progress = Progress.fresh();
  crafting = new Crafting(this.progress);
  goals = new GoalTracker();
  town!: TownLife;
  tick = 0;
  readonly log: string[] = [];
  readonly random = rng(12345);
  fixed = new Set<number>();
  /** Problems a player would hit (the findings). */
  readonly findings: string[] = [];

  constructor(world: World) {
    this.attach(world);
  }

  /** Take over a world (a new game, or one just loaded): towns start from where they are, as the game does. */
  attach(world: World): void {
    this.w = world;
    this.fixed = new Set([...world.stations.values(), ...world.depots.values()]);
    this.editor = new Editor(world.layout, world.sim, () => {}, (id) => this.fixed.has(id));
    this.town = new TownLife(hostFor(world), {
      received: (_t, kind, n, before) => {
        payDelivery(this.progress, kind, n, before);
      },
      grew: (t, status, built) => {
        this.note(`${t.name} grew into a ${status.name.toLowerCase()} (+${built.length} buildings)`);
        const offer = offerOnGrowth(this.progress, t.name, this.random);
        if (offer.length > 0) this.note(`  ${t.name} offers: ${offer.join(" or ")}`);
      },
    });
    this.town.reset();
    this.progress.coverMap(world);
  }

  note(s: string): void {
    this.log.push(`${minutes(this.tick).padStart(5)} min  ${s}`);
  }

  /** Can this tray item come out of the toy box now? (The game's tray check.) */
  allowed(item: { kind: "piece"; type: PieceTypeId } | { kind: "train"; cars: CarKind[] }): ThingId | null {
    return this.progress.short(this.w, thingsFor(item));
  }

  /** Run the railway for `secs` seconds of play: what the game does each tick, frame and second. */
  run(secs: number): void {
    const end = this.tick + secs * SIM_HZ;
    while (this.tick < end) {
      this.w.sim.tick();
      this.w.economy.tick();
      this.tick++;
      if (this.tick % SIM_HZ !== 0) continue;
      this.town.update();
      const made = this.crafting.tick(this.w, 1);
      if (made) this.note(`workshop made a ${ruleOf(made)!.label.toLowerCase()} (${this.progress.available(this.w, made)} in the box)`);
      for (const g of this.goals.update(this.w)) this.note(`GOAL ✓ ${g.title}`);
    }
  }

  /** Save and load, as closing and reopening the game would; checks nothing is lost or doubled. */
  saveAndLoad(): void {
    const before = {
      buildings: this.w.landscape.towns.map((t) => t.buildings.length),
      levels: this.w.landscape.towns.map((t) => this.town.status(t.id).level),
      coins: this.progress.coins,
      owned: JSON.stringify([...this.progress.owned]),
      learned: [...this.progress.learned].sort().join(","),
      orders: this.progress.orders.join(","),
      offers: JSON.stringify(this.progress.offers),
      stock: describeGoods(workshopStock(this.w)),
      trains: this.w.sim.trainIds().length,
      pieces: this.w.layout.pieceCount,
      delivered: JSON.stringify([...this.w.economy.delivered]),
    };
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(this.w))));
    if (!loaded.ok) throw new Error(`save didn't load: ${loaded.error}`);
    this.progress = Progress.fromJSON(JSON.parse(JSON.stringify(this.progress.toJSON())));
    this.crafting.setProgress(this.progress);
    this.attach(loaded.value);
    const after = {
      buildings: this.w.landscape.towns.map((t) => t.buildings.length),
      levels: this.w.landscape.towns.map((t) => this.town.status(t.id).level),
      coins: this.progress.coins,
      owned: JSON.stringify([...this.progress.owned]),
      learned: [...this.progress.learned].sort().join(","),
      orders: this.progress.orders.join(","),
      offers: JSON.stringify(this.progress.offers),
      stock: describeGoods(workshopStock(this.w)),
      trains: this.w.sim.trainIds().length,
      pieces: this.w.layout.pieceCount,
      delivered: JSON.stringify([...this.w.economy.delivered]),
    };
    // A moment of play after loading: nothing should grow again or be paid twice.
    const coins = this.progress.coins;
    this.town.update();
    expect(after).toEqual(before);
    expect(this.w.landscape.towns.map((t) => t.buildings.length)).toEqual(before.buildings);
    expect(this.progress.coins).toBe(coins);
    this.note(`saved and loaded: all the same (${before.pieces} pieces, ${before.trains} trains, ${before.coins} coins, workshop has ${before.stock})`);
  }

  /** A clear spot near (x, z) where `type` may stand on its own (for a piece laid just to have it down). */
  putLoose(type: PieceTypeId, x: number, z: number): boolean {
    const rules = rulesFor(this.w);
    for (let r = 0; r < 12; r++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const pose = { x: Math.round((x + Math.cos(a) * r * 72) / 18) * 18, z: Math.round((z + Math.sin(a) * r * 72) / 18) * 18, heading: 0 };
        // At the height the game gives a piece dropped there (a bridge stands up on its arches).
        const y = looseHeight(this.w.landscape, this.w.layout, type, false, pose, -1);
        const id = this.w.layout.addPiece(type, pose, y, false);
        const why = rules(type, false, pose, y, id);
        this.w.layout.removePiece(id);
        if (!why) {
          this.editor.place(type, pose, y, false);
          return true;
        }
      }
    }
    return false;
  }
}

const st = (w: World, i: number) => w.stations.get(w.landscape.towns[i].id)!;
const depotPiece = (w: World, kind: string) => [...w.depots.values()].find((id) => w.layout.getPiece(id)!.type === `depot-${kind}`)!;

describe("a Game-mode playthrough", () => {
  it("plays the starter map end to end", () => {
    const P = new Playthrough(buildStarterWorld());
    const w = () => P.w;
    P.note(`new game: ${P.w.landscape.towns.map((t) => t.name).join(", ")}; toy box ${JSON.stringify([...P.progress.owned])}`);

    // The tray, before anything: a full train is locked (coaches need Passengers); a timber train comes out.
    expect(P.allowed({ kind: "train", cars: ["engine", "hopper", "passenger", "caboose"] })).not.toBeNull();
    expect(P.allowed({ kind: "train", cars: ["engine", "timber", "timber", "timber"] })).toBeNull();
    expect(P.allowed({ kind: "piece", type: "switch" })).toBe("piece:switch");

    // 1. Lay the line: workshop just west of Larkfield, then on to the sawmill; Larkfield to Elderwick; Elderwick to
    // the forest yard. The workshop comes out of the toy box.
    expect(P.allowed({ kind: "piece", type: "depot-workshop" })).toBeNull();
    const pre = layOn(w(), P.editor, connectorRef(st(w(), 0), 0), "straight-216");
    if ("why" in pre) throw new Error(pre.why);
    const shop = layOn(w(), P.editor, pre.next, "depot-workshop");
    if ("why" in shop) throw new Error(`workshop: ${shop.why}`);
    syncIndustries(w());
    expect(P.allowed({ kind: "piece", type: "depot-workshop" })).toBe("piece:depot-workshop");
    const legs: [string, number, number][] = [
      ["workshop → sawmill", shop.next, connectorRef(depotPiece(w(), "sawmill"), 1)],
      ["Larkfield → Elderwick", connectorRef(st(w(), 0), 1), connectorRef(st(w(), 1), 0)],
      ["Elderwick → forest yard", connectorRef(st(w(), 1), 1), connectorRef(depotPiece(w(), "forest"), 0)],
    ];
    for (const [name, a, b] of legs) {
      const r = play(w().layout, P.editor, a, b, { blocked: gameRules(w(), P.progress), maxPieces: 60, fiddle: 3 });
      P.note(`${name}: ${r.ok ? `joined (${r.pieces} pieces)` : `NOT JOINED ${JSON.stringify(r)}`}`);
      expect(r.ok, name).toBe(true);
    }
    // Turnbacks on both ends (from the box), turned over to fit a hole end.
    const t1 = endOn(w(), P.editor, connectorRef(depotPiece(w(), "sawmill"), 0));
    expect("why" in t1).toBe(false);
    const t2 = endOn(w(), P.editor, connectorRef(depotPiece(w(), "forest"), 1));
    expect("why" in t2).toBe(false);
    expect(P.allowed({ kind: "piece", type: "buffer-turnback" })).toBe("piece:buffer-turnback");
    P.note(`line laid: ${w().layout.pieceCount - P.fixed.size} pieces of track`);

    // 2. The timber train from the box, between the towns, set going.
    const midStraight = [...w().layout.pieceIds()].find((id) => !P.fixed.has(id) && w().layout.getPiece(id)!.type.startsWith("straight") && Math.abs(w().layout.getPiece(id)!.pose.x) < 300)!;
    const placed = w().sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: midStraight, pathIndex: 0, reversed: false, s: 10 });
    expect(placed.kind).toBe("placed");
    if (placed.kind !== "placed") return;
    w().sim.setLever(w().sim.getTrain(placed.trainId)!.cars[0].id, -1);
    expect(P.allowed({ kind: "train", cars: ["engine", "timber", "timber", "timber"] })).toBe("car:engine");
    P.note("timber train set going; the toy box has no more engines");

    // 3. Play: react each minute as a player would.
    const prefer = ["bridges", "switches", "passengers", "sawmills", "heights", "loops", "junctions", "hoppers"];
    const wanted: ThingId[] = ["piece:switch", "piece:bridge", "car:engine", "car:timber"];
    const done = new Set<string>();
    let extended = false;
    let thirdJoined = false;
    let secondAt = -1;
    let deliveredAtSecond = 0;
    let secondTrain = false;
    const saves = new Set([10, 22, 40]);
    for (let minute = 1; minute <= 60; minute++) {
      P.run(60);
      // A derailed train: a player presses Re-rail.
      for (const id of w().sim.trainIds()) {
        if (!w().sim.getTrain(id)?.derailed) continue;
        const back = w().sim.rerail(id);
        const ok = back !== -1;
        // Back on the rails with its lever at stop: the player sets it going again.
        if (ok) for (const car of w().sim.getTrain(back)?.cars ?? []) if (car.kind === "engine") w().sim.setLever(car.id, 1);
        if (!ok && P.findings.some((f) => f.startsWith("A derailed train couldn't"))) continue;
        P.note(`a train derailed: Re-rail ${ok ? "put it back, and set it going" : "COULDN'T put it back"}`);
        const finding = `A derailed train couldn't be re-railed (first at minute ${minute}): ${w().sim.trainIds().length} trains on the line, ${w().sim.trainIds().filter((t) => w().sim.getTrain(t)!.derailed).length} derailed.`;
        if (!ok && !P.findings.some((f) => f.startsWith("A derailed train couldn't"))) P.findings.push(finding);
      }
      // Choose from what towns offer (one free).
      while (P.progress.offers.length > 0) {
        const o = P.progress.offers[0];
        const pick = prefer.find((t) => o.ids.includes(t)) ?? o.ids[0];
        choose(P.progress, pick, o.ids);
        P.progress.offers.shift();
        P.note(`chose ${techOf(pick)!.label} from ${o.from}'s offer (${o.ids.map((t) => techOf(t)!.label).join(" / ")})`);
      }
      // Learn from the board with planks, when the workshop has them.
      for (const t of ["switches", "bridges"]) {
        if (P.progress.board.has(t) && ready(P.progress, t) && learnWithGoods(w(), P.progress, t)) P.note(`learned ${techOf(t)!.label} with ${describeGoods(techOf(t)!.cost)}`);
      }
      // Order what's wanted, once each, when known.
      for (const id of wanted) {
        if (!done.has(id) && P.progress.knows(id)) {
          P.crafting.order(id);
          done.add(id);
          P.note(`ordered a ${ruleOf(id)!.label.toLowerCase()} (${describeGoods(ruleOf(id)!.cost)}); workshop has ${describeGoods(workshopStock(w()))}`);
        }
      }
      // Put things down when they're in the box.
      for (const [type, near] of [["switch", 1], ["bridge", 1]] as const) {
        const id: ThingId = `piece:${type}`;
        if (!done.has(`laid ${type}`) && P.progress.available(w(), id) > 0) {
          const c = w().landscape.towns[near].centre;
          const ok = P.putLoose(type, c.x, c.z + 400);
          done.add(`laid ${type}`);
          P.note(`${ok ? "laid" : "COULDN'T LAY"} the ${type}`);
        }
      }
      // A second train from the box: on a single line it would meet the first head-on and jam (see the test
      // below), so a player who has learned what that does waits for somewhere for it to go. Here: the extension.
      const larkfieldCity = P.town.status(w().landscape.towns[0].id).level >= 3;
      if (!secondTrain && thirdJoined && larkfieldCity && !P.allowed({ kind: "train", cars: ["engine", "timber"] })) {
        for (const id of [...w().layout.pieceIds()]) {
          const p = w().layout.getPiece(id)!;
          if (P.fixed.has(id) || !p.type.startsWith("straight") || p.pose.x < 700) continue;
          const r = w().sim.addTrain(["engine", "timber"], { pieceId: id, pathIndex: 0, reversed: false, s: 10 });
          if (r.kind !== "placed") continue;
          w().sim.setLever(w().sim.getTrain(r.trainId)!.cars[0].id, 1);
          secondTrain = true;
          secondAt = minute;
          deliveredAtSecond = [...w().economy.delivered.values()].reduce((a2, b2) => a2 + b2, 0);
          P.note("second train (engine + timber wagon) from the box, set going east of Elderwick (shares the line)");
          break;
        }
      }
      // Buy land when the coins allow.
      const price = plotPrice(w().landscape.grid.plots.length);
      if (!done.has("land") && P.progress.coins >= price) {
        const plot = plotsForSale(w().landscape)[0];
        const got = unlockPlot(w(), plot.px, plot.pz);
        if (got) {
          P.progress.coins -= price;
          P.fixed = new Set([...w().stations.values(), ...w().depots.values()]);
          done.add("land");
          P.note(`bought a plot for ${price} coins (${got.towns.length} towns, ${got.depots.length} depots); ${P.progress.coins} coins left`);
        }
      }
      // Once Larkfield has grown twice, run the line on to a third town: off the forest yard's far end. If it can't
      // be reached yet (a hill or a river, and no ramps or bridges in the box), try again once ramps are known and
      // some are made.
      const grownTwice = townStatus({ planks: w().economy.delivered.get(w().landscape.towns[0].id) ?? 0 }).level >= 2;
      const retry = extended && !thirdJoined && !done.has("retried") && P.progress.knows("piece:ramp");
      if (retry && !done.has("ordered ramps")) {
        for (let k = 0; k < 8; k++) P.crafting.order("piece:ramp");
        P.crafting.order("piece:bridge");
        done.add("ordered ramps");
        P.note("ordered 8 ramps and another bridge, to try the third town again");
      }
      const rampsReady = P.progress.available(w(), "piece:ramp") >= 8;
      const forestEnd = depotPiece(w(), "forest");
      const turnback = [...w().layout.pieceIds()].find((id) => w().layout.getPiece(id)!.type === "buffer-turnback" && w().layout.joinedConnector(connectorRef(id, 0)) === connectorRef(forestEnd, 1));
      // The game won't take up track a train stands on: a player waits for the train to leave the turnback.
      const turnbackFree = turnback === undefined || !w().sim.pieceOccupied(turnback);
      if (((!extended && grownTwice) || (retry && rampsReady)) && turnbackFree) {
        if (extended) done.add("retried");
        extended = true;
        const forest = forestEnd;
        const buf = turnback;
        // The other towns, nearest the forest yard first: try each in turn (picking up after a failed try).
        const others = w().landscape.towns.slice(2).sort((t1, t2) => Math.hypot(t1.centre.x - 1700, t1.centre.z) - Math.hypot(t2.centre.x - 1700, t2.centre.z));
        if (buf !== undefined) P.editor.remove(buf);
        for (const third of buf !== undefined ? others : []) {
          const station = w().stations.get(third.id)!;
          const sp = w().layout.getPiece(station)!.pose;
          const fp = w().layout.getPiece(forest)!.pose;
          const near = getPieceDef("station", false).connectors.map((_, k) => connectorRef(station, k)).sort((ra, rb) => {
            const ea = w().layout.worldConnector(ra, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
            const eb = w().layout.worldConnector(rb, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
            return Math.hypot(ea.x - fp.x, ea.z - fp.z) - Math.hypot(eb.x - fp.x, eb.z - fp.z);
          })[0];
          const had = new Set(w().layout.pieceIds());
          const r = play(w().layout, P.editor, connectorRef(forest, 1), near, { blocked: gameRules(w(), P.progress), maxPieces: 80, fiddle: 3 });
          P.note(`extending forest yard → ${third.name} (${Math.round(Math.hypot(sp.x - fp.x, sp.z - fp.z))} mm): ${r.ok ? `joined (${r.pieces} pieces)` : `NOT JOINED (${r.how}${r.blockedBy ? `, ${r.blockedBy}` : ""}, ${r.miss?.d} mm short)`}`);
          if (r.ok) {
            thirdJoined = true;
            const far = connectorRef(station, near % 4 === 0 ? 1 : 0);
            endOn(w(), P.editor, far);
            break;
          }
          P.findings.push(`The simulated player couldn't reach ${third.name} from the forest yard (${r.how}${r.blockedBy ? `, ${r.blockedBy}` : ""}).`);
          for (const id of [...w().layout.pieceIds()]) if (!had.has(id)) P.editor.remove(id);
        }
        if (!thirdJoined) {
          // Put the turnback back, so the line still runs.
          const back = layOn(w(), P.editor, connectorRef(forest, 1), "buffer-turnback");
          P.note(`no third town joined: track picked up${"why" in back ? `, but the turnback won't go back (${back.why})` : ", turnback back on"}`);
        }
      }
      // Two trains on one line: do deliveries carry on?
      if (secondAt > 0 && minute === secondAt + 10) {
        const now = [...w().economy.delivered.values()].reduce((a2, b2) => a2 + b2, 0);
        const shapes = w().sim.trainIds().map((id) => w().sim.getTrain(id)!.cars.filter((c) => c.kind === "engine").length);
        P.note(`10 min after the second train: ${now - deliveredAtSecond} more planks delivered; trains now ${JSON.stringify(shapes)} engines each`);
        // Two trains on one line meet head on and turn back (ddea49b): deliveries carry on.
        expect(now, "deliveries carry on with two trains on one line").toBeGreaterThan(deliveredAtSecond);
        if (now === deliveredAtSecond) P.findings.push(`With a second train on the line, deliveries stopped: the trains met and coupled (${JSON.stringify(shapes)} engines in each train), engines pushing against each other.`);
      }
      if (saves.has(minute)) P.saveAndLoad();
      if (minute % 10 === 0) {
        const towns = w().landscape.towns.map((t) => `${t.name} ${P.town.status(t.id).name.toLowerCase()} (${w().economy.delivered.get(t.id) ?? 0})`).join(", ");
        P.note(`status: ${towns}; ${P.progress.coins} coins; workshop ${describeGoods(workshopStock(w()))}; trains ${w().sim.trainIds().map((id) => (w().sim.getTrain(id)!.derailed ? "derailed" : "ok")).join("/")}`);
      }
    }

    // The report.
    const goalsDone = GOALS.filter((g) => P.goals.isDone(g.id)).map((g) => g.title);
    const goalsLeft = GOALS.filter((g) => !P.goals.isDone(g.id)).map((g) => `${g.title} (${JSON.stringify(g.check(w()))})`);
    if (workshops(w()).length > 0 && (w().economy.depotAtPiece(shop.id)?.piles[CARGO.planks.index] ?? 0) === 0 && !P.progress.owned.get("piece:switch")) P.findings.push("The workshop never got any planks.");
    console.log(
      [
        ...P.log,
        "",
        `goals done ${goalsDone.length}/${GOALS.length}: ${goalsDone.join(" · ")}`,
        `goals left: ${goalsLeft.join(" · ")}`,
        `toy box: ${JSON.stringify([...P.progress.owned])}; learned ${[...P.progress.learned].join(", ")}; board ${[...P.progress.board].join(", ")}`,
        `findings:\n- ${P.findings.join("\n- ") || "none"}`,
      ].join("\n"),
    );
    // What must hold: the starter's first towns grew, the goals through the first plank delivery are done.
    expect(P.town.status(w().landscape.towns[0].id).level).toBeGreaterThanOrEqual(3);
    for (const id of ["join-two", "place-train", "get-moving", "station-stop", "timber-train", "load-logs", "deliver-planks", "grow-town"]) expect(P.goals.isDone(id), id).toBe(true);
  }, 600_000);

  it("a workshop after the towns on the line gets planks once the towns' cranes are off, or the train delivers to it", () => {
    const result: string[] = [];
    for (const [townCranes, toShop] of [[true, false], [false, false], [true, true]] as const) {
      // Sawmill - Larkfield - Elderwick - workshop - forest yard: planks pass both towns before the workshop.
      const P = new Playthrough(buildStarterWorld());
      const w = P.w;
      const legs: [number, number][] = [
        [connectorRef(st(w, 0), 0), connectorRef(depotPiece(w, "sawmill"), 1)],
        [connectorRef(st(w, 0), 1), connectorRef(st(w, 1), 0)],
      ];
      for (const [a2, b2] of legs) expect(play(w.layout, P.editor, a2, b2, { blocked: rulesFor(w), maxPieces: 60, fiddle: 3 }).ok).toBe(true);
      const pre = layOn(w, P.editor, connectorRef(st(w, 1), 1), "straight-216");
      if ("why" in pre) throw new Error(pre.why);
      const shop = layOn(w, P.editor, pre.next, "depot-workshop");
      if ("why" in shop) throw new Error(shop.why);
      syncIndustries(w);
      expect(play(w.layout, P.editor, shop.next, connectorRef(depotPiece(w, "forest"), 0), { blocked: rulesFor(w), maxPieces: 60, fiddle: 3 }).ok).toBe(true);
      endOn(w, P.editor, connectorRef(depotPiece(w, "sawmill"), 0));
      endOn(w, P.editor, connectorRef(depotPiece(w, "forest"), 1));
      // The town stations' cranes: on (as a new game has them), or switched off on their cards.
      if (!townCranes) for (const d of w.economy.allDepots()) if (d.role === "town") w.economy.setAuto(d.id, false);
      const mid = [...w.layout.pieceIds()].find((id) => !P.fixed.has(id) && w.layout.getPiece(id)!.type.startsWith("straight") && Math.abs(w.layout.getPiece(id)!.pose.x) < 300)!;
      const r = w.sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: mid, pathIndex: 0, reversed: false, s: 10 });
      expect(r.kind).toBe("placed");
      if (r.kind !== "placed") return;
      const engine = w.sim.getTrain(r.trainId)!.cars[0].id;
      w.sim.setLever(engine, -1);
      // "Deliver to: Workshop" on the engine's card.
      if (toShop) w.economy.setDeliverTo(engine, w.economy.depotAtPiece(shop.id)!.id);
      let firstPlanks = -1;
      for (let m = 1; m <= 30; m++) {
        P.run(60);
        if (firstPlanks < 0 && (w.economy.depotAtPiece(shop.id)?.piles[CARGO.planks.index] ?? 0) > 0) firstPlanks = m;
      }
      result.push(`town cranes ${townCranes ? "on" : "off"}${toShop ? ", train delivers to the workshop" : ""}: workshop's first planks ${firstPlanks > 0 ? `at minute ${firstPlanks}` : "never"}; towns got ${JSON.stringify(Object.fromEntries(w.economy.delivered))}`);
      if (townCranes && !toShop) expect(firstPlanks, "with the towns taking every plank, the workshop starves").toBe(-1);
      else expect(firstPlanks).toBeGreaterThan(0);
      if (toShop) expect(w.economy.delivered.size, "a train delivering to the workshop leaves the towns alone").toBe(0);
    }
    console.log(`workshop after the towns:\n${result.join("\n")}`);
  }, 600_000);

  it("lays the starter line and grows a city on many starter maps", () => {
    const results: string[] = [];
    let ok = 0;
    for (let k = 0; k < 20; k++) {
      const seed = 4100 + k * 7919;
      const w = createWorld(seed, true);
      const P = new Playthrough(w);
      const legs: [string, number, number][] = [
        ["L-saw", connectorRef(st(w, 0), 0), connectorRef(depotPiece(w, "sawmill"), 1)],
        ["L-E", connectorRef(st(w, 0), 1), connectorRef(st(w, 1), 0)],
        ["E-forest", connectorRef(st(w, 1), 1), connectorRef(depotPiece(w, "forest"), 0)],
      ];
      const failed = legs.map(([n, a, b]) => [n, play(w.layout, P.editor, a, b, { blocked: rulesFor(w), maxPieces: 60, fiddle: 3 })] as const).filter(([, r]) => !r.ok);
      if (failed.length > 0) {
        results.push(`seed ${seed}: couldn't lay ${failed.map(([n, r]) => `${n} (${r.how}${r.blockedBy ? `, ${r.blockedBy}` : ""})`).join(", ")}`);
        continue;
      }
      endOn(w, P.editor, connectorRef(depotPiece(w, "sawmill"), 0));
      endOn(w, P.editor, connectorRef(depotPiece(w, "forest"), 1));
      const mid = [...w.layout.pieceIds()].find((id) => !P.fixed.has(id) && w.layout.getPiece(id)!.type.startsWith("straight") && Math.abs(w.layout.getPiece(id)!.pose.x) < 300)!;
      const r = w.sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: mid, pathIndex: 0, reversed: false, s: 10 });
      if (r.kind !== "placed") {
        results.push(`seed ${seed}: no room for the train`);
        continue;
      }
      w.sim.setLever(w.sim.getTrain(r.trainId)!.cars[0].id, -1);
      let city = -1;
      for (let m = 1; m <= 25 && city < 0; m++) {
        P.run(60);
        if (P.town.status(w.landscape.towns[0].id).level >= 3) city = m;
      }
      if (city > 0) ok++;
      results.push(`seed ${seed}: ${city > 0 ? `city by minute ${city}` : `no city in 25 min (delivered ${JSON.stringify([...w.economy.delivered])})`}`);
    }
    console.log(`starter line on 20 seeds: ${ok}/20 grew a city\n${results.join("\n")}`);
    expect(ok).toBe(20);
  }, 900_000);
});
