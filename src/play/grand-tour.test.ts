import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { CARGO } from "../economy";
import { describe as describeGoods } from "../economy/goods";
import { siteWhy, updateRates } from "../game/industries";
import { landmarksAt, landmarksOf, townLandmarks } from "../game/landmarks";
import { Progress } from "../game/progress";
import { cardView, describeThings, firstTimeGift, offerOnGrowth, payDelivery, takeCard } from "../game/rewards";
import { attachEngines, powered, topSpeed } from "../game/engines";
import { CITY_SCHOOL_ID } from "../game/blueprints";
import { needMet, ready, techOf } from "../game/tech";
import { describeNeed } from "../game/blueprints";
import { applyCranes, Counters } from "../game/upgrades";
import { receivedBy, TownLife, type TownLifeHost } from "../game/town-life";
import { buildStarterWorld, syncIndustries, type World } from "../game/world";
import { FEAT_FIELD, type Town } from "../landscape";
import { rng } from "../lib/rng";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { ENGINE_SPEED, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, indexOfRef, pieceOfRef, type PieceTypeId, type Pose } from "../track";
import { play } from "./player";
import { endOn, rulesFor } from "./rules";

/**
 * The grand tour: one game on the starter map through all of Game mode's content, on the game's own code. Planks grow
 * Larkfield to a town (its market goes up); the line runs on to a farm yard and mill by the fields, and one
 * mixed train's flour makes it a city (a school beside a city opens Quarries); a quarry on a branch off the line, joined by a
 * switch, and a routed stone train that sets that switch itself, make it a city ★; a warehouse keeps flour for a
 * routed van. Then Phase C: a mine on a branch with a foundry and a power station; a goods train that brings iron to
 * Larkfield, behind an electric engine once the power station has coal; a carpenter's yard for furniture; the
 * college (the schools in towns become colleges). Iron, furniture and more stone make Larkfield a city ★★. Saved and loaded on the way. Shortcuts, to keep to what's new: blueprints are learned outright (the
 * workshop and the board are the main playthrough's), and pieces aren't drawn from the toy box.
 */

const minutes = (ticks: number) => (ticks / SIM_HZ / 60).toFixed(1);
const peg = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" as const };

class Tour {
  w!: World;
  editor!: Editor;
  progress = Progress.fresh();
  town!: TownLife;
  tick = 0;
  coins = { market: 0 };
  readonly log: string[] = [];
  readonly findings: string[] = [];
  readonly random = rng(2026);
  fixed = new Set<number>();
  readonly counters = new Counters();
  /** Game mode's engine kinds on the sim (from Phase C on: before, every engine is the classic one). */
  engines = false;
  /** Seconds between reports of where the trains are. */
  reportEvery = 300;

  constructor(w: World) {
    this.attach(w);
  }

  attach(w: World): void {
    this.w = w;
    this.fixed = new Set([...w.stations.values(), ...w.depots.values()]);
    this.editor = new Editor(w.layout, w.sim, () => {}, (id) => this.fixed.has(id));
    const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
    this.town = new TownLife(host, {
      received: (t, kind, n, before) => {
        const paid = payDelivery(this.progress, kind, n, before, t);
        if (townLandmarks(t).has("market")) this.coins.market += paid;
      },
      grew: (t, status, built) => {
        const marks = built.length > 0 ? [...townLandmarks(t)].join(", ") : "";
        this.note(`${t.name} grew into a ${status.name.toLowerCase()} (+${built.length} buildings)${marks ? `; landmarks: ${marks}` : ""}`);
        this.syncLandmarks();
        const gift = firstTimeGift(this.progress, status.level);
        if (gift.length > 0) this.note(`  first ${status.name.toLowerCase()}: a present of ${describeThings(gift)}`);
        const offer = offerOnGrowth(this.progress, this.w, t.name, status.level, this.random);
        if (offer) this.note(`  ${t.name} offers ${offer.cards.map((c) => cardView(this.progress, this.w, c).amount).join(" or ")}`);
      },
      knows: (id) => this.progress.learned.has(id),
    });
    this.town.reset();
    this.syncLandmarks();
    this.counters.reset(w.economy);
    applyCranes(w.economy, this.progress);
    if (this.engines) attachEngines(w);
  }

  /** Where each train is and what it carries (every five minutes, for the report). */
  trains(): void {
    for (const id of this.w.sim.trainIds()) {
      const t = this.w.sim.getTrain(id)!;
      const engine = t.cars.find((c) => c.kind === "engine");
      const r = engine && this.w.economy.routeOf(engine.id);
      const loads = t.cars.map((c) => {
        const g = this.w.economy.cargoOf(c.id);
        return `${c.kind}${g.kind ? `:${g.count} ${g.kind}` : ""}`;
      });
      const on = this.w.layout.getPiece(t.bogies[0].pieceId)?.type;
      this.note(`  train ${id}: ${loads.join(", ")}; speed ${Math.round(t.speed)}${t.derailed ? " DERAILED" : ""}; on ${on}${r ? `; route next ${r.next}` : ""}`);
    }
  }

  syncLandmarks(): void {
    this.progress.landmarks.clear();
    for (const id of landmarksAt(this.w)) this.progress.landmarks.add(id);
    // (A shortcut: the tour places no school depot, but learns as if it had one beside its biggest town: a city's opens
    // tier 3.)
    if (Math.max(...this.w.landscape.towns.map((t) => this.town.status(t.id).level)) >= 3) this.progress.landmarks.add(CITY_SCHOOL_ID);
  }

  note(s: string): void {
    this.log.push(`${minutes(this.tick).padStart(5)} min  ${s}`);
  }

  /** Run `secs` of play: the sim and economy each tick; towns, schools and industries' rates each second. */
  run(secs: number, until?: () => boolean): void {
    const end = this.tick + secs * SIM_HZ;
    while (this.tick < end) {
      this.w.sim.tick();
      this.w.economy.tick();
      this.tick++;
      if (this.tick % SIM_HZ !== 0) continue;
      this.town.update();
      this.counters.collect(this.w.economy, this.progress);
      this.chooseOffers();
      if (this.tick % (SIM_HZ * 30) === 0) updateRates(this.w);
      if (this.tick % (SIM_HZ * this.reportEvery) === 0) this.trains();
      if (until?.()) return;
    }
  }

  /** Take a card from what towns offer as they grow: coins if offered, else the first that can be taken now. */
  chooseOffers(): void {
    while (this.progress.offers.length > 0) {
      const o = this.progress.offers[0];
      const coins = o.cards.findIndex((c) => c.kind === "coins");
      const i = coins !== -1 ? coins : o.cards.findIndex((c) => cardView(this.progress, this.w, c).ok);
      const took = i === -1 ? null : takeCard(this.progress, this.w, 0, i);
      if (took) this.note(`took ${took.amount} (from ${o.from})`);
      else this.progress.offers.shift();
    }
  }

  /** Learn a blueprint (a shortcut: the game's way is the board and the workshop's planks). */
  learn(id: string): void {
    if (this.progress.learned.has(id)) return;
    expect(ready(this.progress, id), `${id} ready`).toBe(true);
    this.progress.learned.add(id);
    this.note(`learned ${techOf(id)!.label} (shortcut)`);
  }

  /** Learn a blueprint whether or not it's ready yet; one that isn't is a finding (what it still asked for). */
  learnAnyway(id: string): void {
    if (this.progress.learned.has(id)) return;
    const t = techOf(id)!;
    const missing = [...t.needs.filter((n) => !this.progress.learned.has(n)), ...t.requires.filter((n) => !needMet(this.progress, n)).map(describeNeed)];
    if (missing.length > 0) this.findings.push(`${t.label} wasn't ready when the tour wanted it (at ${minutes(this.tick)} min): still wanted ${missing.join(", ")}`);
    this.progress.learned.add(id);
    applyCranes(this.w.economy, this.progress);
    this.note(`learned ${t.label} (shortcut${missing.length > 0 ? ", NOT READY" : ""})`);
  }

  level(t: Town): number {
    return this.town.status(t.id).level;
  }

  /** A train from the box, on piece `pieceId`, set going. */
  train(cars: CarKind[], pieceId: number, lever: 1 | -1 = 1): number {
    for (const s of [100, 60, 140, 30]) {
      const r = this.w.sim.addTrain(cars, { pieceId, pathIndex: 0, reversed: false, s });
      if (r.kind !== "placed") continue;
      const engine = this.w.sim.getTrain(r.trainId)!.cars.find((c) => c.kind === "engine")!;
      this.w.sim.setLever(engine.id, lever);
      return engine.id;
    }
    throw new Error(`no room for ${cars.join("+")} on piece ${pieceId}`);
  }

  saveAndLoad(): void {
    const snapshot = () => ({
      levels: this.w.landscape.towns.map((t) => this.level(t)),
      landmarks: [...landmarksOf(this.w.landscape)].sort().join(","),
      trains: this.w.sim.trainIds().length,
      routes: this.w.sim
        .trainIds()
        .flatMap((id) => this.w.sim.getTrain(id)!.cars)
        .map((c) => this.w.economy.routeOf(c.id)?.stops.length ?? 0)
        .join(","),
      piles: this.w.economy
        .allDepots()
        .map((d) => [...d.piles].join("/"))
        .join(" "),
      delivered: JSON.stringify([...this.w.economy.deliveredGoods]),
    });
    const before = snapshot();
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(this.w))));
    if (!loaded.ok) throw new Error(loaded.error);
    this.progress = Progress.fromJSON(JSON.parse(JSON.stringify(this.progress.toJSON())));
    this.attach(loaded.value);
    expect(snapshot()).toEqual(before);
    this.note(`saved and loaded: all the same (${before.trains} trains, landmarks ${before.landmarks})`);
  }
}

/** Places for an industry piece that its site rule and the placement rules allow, near `cells`, with a piece after it. */
function* sitesNear(t: Tour, type: PieceTypeId, cells: number[], after?: PieceTypeId): Generator<{ pose: Pose; y: number }> {
  const w = t.w;
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
            const ok = !rules(after, false, p.pose, p.y, next);
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

/** Put `type` on free end `ref` through the editor (seated by an end of the other kind); its id. */
function placeOn(t: Tour, ref: number, type: PieceTypeId): number {
  const end = t.w.layout.worldConnector(ref, peg);
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  const tmp = appendPiece(t.w.layout, type, false, ref, via);
  const p = t.w.layout.getPiece(tmp)!;
  t.w.layout.removePiece(tmp);
  return t.editor.place(type, p.pose, p.y, false);
}

/** A piece's first free end. */
function freeEnd(t: Tour, id: number): number {
  const p = t.w.layout.getPiece(id)!;
  const n = getPieceDef(p.type, p.flipped).connectors.length;
  for (let c = 0; c < n; c++) if (t.w.layout.joinedConnector(connectorRef(id, c)) === -1) return connectorRef(id, c);
  return -1;
}

describe("the grand tour", () => {
  it("plays all of Game mode's content on the starter map, to a city ★★", () => {
    const T = new Tour(buildStarterWorld());
    const w = () => T.w;
    const st = (i: number) => w().stations.get(w().landscape.towns[i].id)!;
    const depotPiece = (kind: string) => [...w().depots.values()].find((id) => w().layout.getPiece(id)!.type === `depot-${kind}`)!;
    const depotAt = (pieceId: number) => w().economy.depotAtPiece(pieceId)!.id;
    const larkfield = () => w().landscape.towns[0];
    try {
      // 1. The starter line, and a timber train.
      const saw = depotPiece("sawmill");
      const forest = depotPiece("forest");
      for (const [name, a, b] of [
        ["Larkfield → sawmill", connectorRef(st(0), 0), connectorRef(saw, 1)],
        ["Larkfield → Elderwick", connectorRef(st(0), 1), connectorRef(st(1), 0)],
        ["Elderwick → forest yard", connectorRef(st(1), 1), connectorRef(forest, 0)],
      ] as const) {
        const r = play(w().layout, T.editor, a, b, { blocked: rulesFor(w()), maxPieces: 60, fiddle: 3 });
        T.note(`${name}: ${r.ok ? `joined (${r.pieces} pieces)` : `NOT JOINED (${r.how})`}`);
        expect(r.ok, name).toBe(true);
      }
      endOn(w(), T.editor, connectorRef(saw, 0));
      /** A straight of the line near the middle, to put a train on (picked again if it has become the switch since). */
      const middle = () => [...w().layout.pieceIds()].find((id) => !T.fixed.has(id) && w().layout.getPiece(id)!.type.startsWith("straight") && Math.abs(w().layout.getPiece(id)!.pose.x) < 300)!;
      let between = middle();
      const timber = T.train(["engine", "timber", "timber"], between, -1);
      T.note("timber train set going");
      T.run(30 * 60, () => T.level(larkfield()) >= 2);
      expect(T.level(larkfield()), T.log.join("\n")).toBeGreaterThanOrEqual(2);
      expect([...townLandmarks(larkfield())].sort(), "a town has a market (no school: the player places theirs)").toEqual(["market"]);
      T.note(`Larkfield is a town: coins ${T.progress.coins} (${T.coins.market} from its market)`);

      // 2. The farm chain: a farm yard by a field and a mill after it, the line run on to them from the forest yard.
      for (const id of ["harvesters", "farming", "mills"]) T.learn(id);
      const fields: number[] = [];
      w().landscape.grid.forEachCell((i) => {
        if (w().landscape.grid.feature[i] === FEAT_FIELD) fields.push(i);
      });
      let farm = -1;
      let mill = -1;
      let tries = 0;
      for (const site of sitesNear(T, "depot-farm", fields, "depot-mill")) {
        if (++tries > 40) break;
        // The farm yard first (the player joins track to it, then puts the mill on after it: a piece already joined at
        // one end counts as reached).
        farm = T.editor.place("depot-farm", site.pose, site.y, false);
        const had = new Set(w().layout.pieceIds());
        const r = play(w().layout, T.editor, connectorRef(forest, 1), connectorRef(farm, 0), { blocked: rulesFor(w()), maxPieces: 90, fiddle: 3 });
        if (r.ok && w().layout.joinedConnector(connectorRef(farm, 1)) === -1) {
          mill = placeOn(T, connectorRef(farm, 1), "depot-mill");
          const mp = w().layout.getPiece(mill)!;
          if (!rulesFor(w())("depot-mill", false, mp.pose, mp.y, mill)) {
            T.note(`farm yard (try ${tries}): forest yard → farm yard joined (${r.pieces} pieces); the mill after it`);
            break;
          }
          T.editor.remove(mill);
        }
        for (const id of [...w().layout.pieceIds()]) if (!had.has(id)) T.editor.remove(id);
        T.editor.remove(farm);
        farm = mill = -1;
      }
      expect(farm, T.log.join("\n")).not.toBe(-1);
      syncIndustries(w());
      updateRates(w());
      T.note(`farm yard rate ${w().economy.depotAtPiece(farm)!.rate.toFixed(2)}`);
      // The timber train comes off; a mixed train runs the whole line: logs, planks, grain and flour.
      const old = w().sim.findCar(timber)!.train.id;
      w().sim.removeTrain(old);
      let mixed = T.train(["engine", "timber", "timber", "hopper", "van"], between, -1);
      T.note("mixed train (engine, 2 timber wagons, hopper, van) set going on the whole line");
      T.run(45 * 60, () => T.level(larkfield()) >= 3);
      const got = receivedBy(w(), larkfield().id);
      T.note(`Larkfield has had ${describeGoods(got)}`);
      expect(T.level(larkfield()), T.log.join("\n")).toBeGreaterThanOrEqual(3);
      expect(T.progress.landmarks.has(CITY_SCHOOL_ID), "a city opens tier 3 (its school's library wing)").toBe(true);
      T.saveAndLoad();

      // 3. Stone: quarries (the city's school opened them), on a branch off the line by a switch; a routed stone train.
      T.learn("quarries");
      // (Switches with planks at the workshop: schools no longer hand out blueprints free.)
      T.learn("switches");
      T.learn("routes");
      const g = w().landscape.grid;
      const hills: number[] = [];
      g.forEachCell((i) => {
        if (g.height[i] > 0) hills.push(i);
      });
      /**
       * An industry on a new branch: a straight of the line becomes a switch and a short straight, and track runs from
       * the switch to a site for `type` near it (on `cells`; with `after`, room for that piece after it).
       */
      /** Is a line end (a buffer, or track that stops) within `n` pieces of piece `id`, either way? */
      const nearEnd = (id: number, n: number): boolean => {
        for (let c = 0; c < 2; c++) {
          let at = id;
          let exit = c;
          for (let k = 0; k < n; k++) {
            const j = w().layout.joinedConnector(connectorRef(at, exit));
            if (j === -1) return true;
            at = pieceOfRef(j);
            const p = w().layout.getPiece(at)!;
            const ends = getPieceDef(p.type, p.flipped).connectors.length;
            if (ends === 1) return true;
            if (ends !== 2) break;
            exit = 1 - indexOfRef(j);
          }
        }
        return false;
      };
      const branchOff = (type: PieceTypeId, cells: number[], after?: PieceTypeId): number => {
        // Not close to the end of a line: a train turning back there would still be on the switch, and couldn't take
        // its branch.
        const line = [...w().layout.pieceIds()].filter((id) => !T.fixed.has(id) && w().layout.getPiece(id)!.type === "straight-216" && (type === "depot-quarry" || !nearEnd(id, 4)));
        for (const s of line) {
          const p = w().layout.getPiece(s)!;
          const ends = [0, 1].map((c) => w().layout.joinedConnector(connectorRef(s, c)));
          if (ends.some((e) => e === -1) || w().sim.pieceOccupied(s)) continue;
          // (Put back after a try that didn't work, the straight has a new id.)
          let straight = s;
          for (const flipped of [false, true]) {
            T.editor.remove(straight);
            const sw = T.editor.place("switch", p.pose, p.y, flipped);
            const short = placeOn(T, connectorRef(sw, 1), "straight-72");
            // Joined at both ends of the old straight: the switch's trunk and the short straight's far end.
            const joined = w().layout.joinedConnector(connectorRef(sw, 0)) !== -1 && freeEnd(T, short) === -1;
            if (joined) {
              const at = w().layout.worldConnector(connectorRef(sw, 2), peg);
              const near = cells.filter((i) => Math.hypot(g.centreX(g.colOf(i)) - at.x, g.centreZ(g.rowOf(i)) - at.z) < 900);
              let n = 0;
              for (const site of sitesNear(T, type, near.slice(0, 40), after)) {
                if (++n > 25) break;
                const q = T.editor.place(type, site.pose, site.y, false);
                const had = new Set(w().layout.pieceIds());
                const r = play(w().layout, T.editor, connectorRef(sw, 2), connectorRef(q, 1), { blocked: rulesFor(w()), maxPieces: 60, fiddle: 3 });
                if (r.ok) {
                  T.note(`switch laid in the line (piece ${s}); ${type} placed; switch → ${type}: joined (${r.pieces} pieces)`);
                  return q;
                }
                for (const id of [...w().layout.pieceIds()]) if (!had.has(id)) T.editor.remove(id);
                T.editor.remove(q);
              }
            }
            T.editor.remove(short);
            T.editor.remove(sw);
            straight = T.editor.place("straight-216", p.pose, p.y, false);
          }
        }
        return -1;
      };
      const quarry = branchOff("depot-quarry", hills);
      if (quarry === -1) {
        T.findings.push("The simulated player couldn't reach hillside for a quarry from a switch in the starter line.");
      } else {
        syncIndustries(w());
        updateRates(w());
        // A stone train on the branch: route quarry (pick up) → Larkfield (drop). It sets the line's switch itself.
        const branchRef = w().layout.joinedConnector(connectorRef(quarry, 1));
        const branch = branchRef === -1 ? quarry : pieceOfRef(branchRef);
        // Two trains on one line meet head on and turn back, again and again: the mixed train comes off while it runs.
        const lift = (engine: number) => {
          const found = w().sim.findCar(engine);
          if (found) w().sim.removeTrain(found.train.id);
        };
        lift(mixed);
        T.note("picked the mixed train up (two trains on one line keep turning each other back)");
        const stoneTrain = T.train(["engine", "hopper", "hopper"], branch, 1);
        w().economy.setRoute(stoneTrain, {
          stops: [
            { depotId: depotAt(quarry), action: "pick" },
            { depotId: depotAt(st(0)), action: "drop" },
          ],
          next: 0,
        });
        T.note("stone train (engine, 2 hoppers) on the branch, route: quarry (pick up) → Larkfield (drop)");
        const stoneAt = () => receivedBy(w(), larkfield().id).stone ?? 0;
        const t0 = T.tick;
        T.run(25 * 60, () => stoneAt() >= 10);
        T.note(`Larkfield has had ${stoneAt()} stone (${minutes(T.tick - t0)} min after the stone train started)`);
        if (stoneAt() === 0) T.findings.push("No stone reached Larkfield: the routed stone train didn't get there.");
        lift(stoneTrain);
        T.note("picked the stone train up");
      }

      // 4. A warehouse at the line's far end (after the mill): a routed van keeps flour there, then brings it to Larkfield.
      T.learn("warehouses");
      const store = placeOn(T, freeEnd(T, mill), "depot-warehouse");
      syncIndustries(w());
      const van = T.train(["engine", "van"], store, -1);
      w().economy.setRoute(van, {
        stops: [
          { depotId: depotAt(mill), action: "pick" },
          { depotId: depotAt(store), action: "drop" },
        ],
        next: 0,
      });
      T.note("a van, route: mill (pick up) → warehouse (drop)");
      T.run(8 * 60);
      const kept = w().economy.depotAtPiece(store)!.piles[CARGO.flour.index];
      T.note(`the warehouse keeps ${kept} flour`);
      expect(kept, "flour kept at the warehouse").toBeGreaterThan(0);
      w().economy.setRoute(van, {
        stops: [
          { depotId: depotAt(store), action: "pick" },
          { depotId: depotAt(st(0)), action: "drop" },
        ],
        next: 0,
      });
      T.note("the van's route now: warehouse (pick up) → Larkfield (drop)");
      const flourBefore = receivedBy(w(), larkfield().id).flour ?? 0;
      T.run(15 * 60);
      T.note(`Larkfield had ${(receivedBy(w(), larkfield().id).flour ?? 0) - flourBefore} more flour`);
      T.saveAndLoad();
      // The van comes off and the mixed train goes back on, to run the line for the other towns.
      // (Loading gives cars new ids: take up whatever is on the line.)
      for (const id of [...w().sim.trainIds()]) w().sim.removeTrain(id);
      if (!w().layout.getPiece(between)) between = middle();
      mixed = T.train(["engine", "timber", "timber", "hopper", "van"], between, -1);
      T.note("the van picked up; the mixed train back on the line");
      T.run(40 * 60, () => T.level(larkfield()) >= 4);
      T.note(`Larkfield is a ${T.town.status(larkfield().id).name.toLowerCase()}; counts ${[...T.progress.counts].map(([k, n]) => `${k} ${n}`).join(", ")}`);

      // 5. Phase C: a mine on a branch, then a foundry and a power station; a train of ore and coal that brings
      // iron back to Larkfield, behind an electric engine once the power station has coal; a carpenter's yard after the
      // warehouse for furniture; the smithy's heavy wagons; the college.
      // More stone first (a city ★ wants it, and Mines asks for 20 delivered): the stone train again.
      for (const id of [...w().sim.trainIds()]) w().sim.removeTrain(id);
      if (quarry !== -1) {
        const branchRef = w().layout.joinedConnector(connectorRef(quarry, 1));
        const stoneTrain = T.train(["engine", "hopper", "hopper"], branchRef === -1 ? quarry : pieceOfRef(branchRef), 1);
        w().economy.setRoute(stoneTrain, { stops: [{ depotId: depotAt(quarry), action: "pick" }, { depotId: depotAt(st(0)), action: "drop" }], next: 0 });
        const t0 = T.tick;
        T.run(20 * 60, () => (receivedBy(w(), larkfield().id).stone ?? 0) >= 25);
        T.note(`the stone train again: Larkfield has had ${receivedBy(w(), larkfield().id).stone ?? 0} stone (${minutes(T.tick - t0)} min)`);
        for (const id of [...w().sim.trainIds()]) w().sim.removeTrain(id);
      }
      // Planks for the Carpenter's bench (50 delivered): the mixed train runs the line until they're in.
      if ((T.progress.counts.get("delivered:planks") ?? 0) < 50) {
        for (const id of w().layout.pieceIds()) if (w().layout.getPiece(id)!.type === "switch") w().layout.setSwitchState(id, 0);
        if (!w().layout.getPiece(between)) between = middle();
        const planks = T.train(["engine", "timber", "timber", "hopper", "van"], between, -1);
        T.run(15 * 60, () => (T.progress.counts.get("delivered:planks") ?? 0) >= 50);
        T.note(`the mixed train again: ${T.progress.counts.get("delivered:planks") ?? 0} planks delivered`);
        const found = w().sim.findCar(planks);
        if (found) w().sim.removeTrain(found.train.id);
      }
      for (const id of ["tank", "goods-engine", "mines", "foundry", "carpentry", "college"]) T.learnAnyway(id);
      T.engines = true;
      attachEngines(w());
      const blocked = (id: number) => {
        const p = w().layout.getPiece(id)!;
        return rulesFor(w())(p.type, p.flipped, p.pose, p.y, id) ?? siteWhy(w().landscape, p.type, p.pose);
      };
      /** Put an industry on a free end, or say why it can't go there (and take it up again). */
      const industryOn = (ref: number, type: PieceTypeId): number => {
        if (ref === -1) return -1;
        const id = placeOn(T, ref, type);
        const why = blocked(id);
        if (!why) return id;
        T.note(`${type} on the end of piece ${pieceOfRef(ref)}: ${why}`);
        T.editor.remove(id);
        return -1;
      };
      /**
       * An industry joined to free end `from`: straight on it if it can go there, else at a site near it (on `cells`, or
       * any square within 900 mm) with track to it. With `after`, the site must have room for that piece after it.
       */
      const reach = (from: number, type: PieceTypeId, cells?: number[], after?: PieceTypeId): number => {
        if (from === -1) return -1;
        const straight = industryOn(from, type);
        if (straight !== -1) return straight;
        const at = w().layout.worldConnector(from, peg);
        const away = (i: number) => Math.hypot(g.centreX(g.colOf(i)) - at.x, g.centreZ(g.rowOf(i)) - at.z);
        const pool: number[] = [];
        if (cells) pool.push(...cells);
        else g.forEachCell((i) => void pool.push(i));
        const near = pool.filter((i) => away(i) < 900).sort((a, b) => away(a) - away(b));
        let n = 0;
        for (const site of sitesNear(T, type, near.filter((_, k) => k % 3 === 0).slice(0, 60), after)) {
          if (++n > 40) break;
          const id = T.editor.place(type, site.pose, site.y, false);
          const had = new Set(w().layout.pieceIds());
          let r = play(w().layout, T.editor, from, connectorRef(id, 1), { blocked: rulesFor(w()), maxPieces: 60, fiddle: 3 });
          if (!r.ok) r = play(w().layout, T.editor, from, connectorRef(id, 0), { blocked: rulesFor(w()), maxPieces: 60, fiddle: 3 });
          if (r.ok) {
            T.note(`${type}: track from piece ${pieceOfRef(from)} joined to it (${r.pieces} pieces, site ${n})`);
            return id;
          }
          for (const p of [...w().layout.pieceIds()]) if (!had.has(p)) T.editor.remove(p);
          T.editor.remove(id);
        }
        T.note(`${type}: no site joined from piece ${pieceOfRef(from)} (${n} tried)`);
        return -1;
      };
      const mine = branchOff("depot-mine", hills, "depot-foundry");
      const foundry = mine === -1 ? -1 : reach(freeEnd(T, mine), "depot-foundry");
      const anywhere: number[] = [];
      g.forEachCell((i) => void anywhere.push(i));
      let power = foundry === -1 ? -1 : reach(freeEnd(T, foundry), "depot-power");
      if (foundry !== -1 && power === -1) power = branchOff("depot-power", anywhere.filter((i) => i % 2 === 0));
      T.note(`mine ${mine === -1 ? "NOT PLACED" : "placed"}; foundry ${foundry === -1 ? "NOT PLACED" : "after it"}; power station ${power === -1 ? "NOT PLACED" : "after that"}`);
      const ironAt = () => receivedBy(w(), larkfield().id).iron ?? 0;
      if (power === -1) {
        T.findings.push("Phase C: couldn't place the mine, foundry and power station.");
      } else {
        T.learnAnyway("electricity");
        syncIndustries(w());
        updateRates(w());
        const branchRef = w().layout.joinedConnector(connectorRef(mine, 1));
        const branch = branchRef === -1 ? mine : pieceOfRef(branchRef);
        // A goods engine with two hoppers (coal and ore) and a timber wagon (iron).
        const ore = T.train(["engine", "hopper", "hopper", "timber"], branch, 1);
        T.reportEvery = 60;
        w().sim.setLook(ore, "goods");
        // (A routed train drops at every stop that says so, in passing: coal for the power station goes on a route of
        // its own, or the foundry takes it first.)
        const coalRun = { stops: [{ depotId: depotAt(mine), action: "pick" as const }, { depotId: depotAt(power), action: "drop" as const }], next: 0 };
        const ironRun = {
          stops: [
            { depotId: depotAt(mine), action: "pick" as const },
            { depotId: depotAt(foundry), action: "drop" as const },
            { depotId: depotAt(foundry), action: "pick" as const },
            { depotId: depotAt(st(0)), action: "drop" as const },
          ],
          next: 0,
        };
        w().economy.setRoute(ore, ironRun);
        T.note("goods engine, 2 hoppers and a timber wagon; route: mine (pick up) → foundry (drop, pick up) → Larkfield (drop)");
        const t0 = T.tick;
        T.run(15 * 60, () => ironAt() >= 4);
        const mineD = w().economy.depotAtPiece(mine)!;
        const foundryD = w().economy.depotAtPiece(foundry)!;
        const powerD = w().economy.depotAtPiece(power)!;
        const pile = (d: typeof mineD, k: keyof typeof CARGO) => d.piles[CARGO[k].index];
        T.note(`after ${minutes(T.tick - t0)} min: Larkfield has had ${ironAt()} iron; mine coal ${pile(mineD, "coal")} ore ${pile(mineD, "ore")}; foundry coal ${pile(foundryD, "coal")} ore ${pile(foundryD, "ore")} iron ${pile(foundryD, "iron")}; power station coal ${pile(powerD, "coal")} (${powered(w()) ? "working" : "idle"})`);
        if (ironAt() === 0) T.findings.push("Phase C: no iron reached Larkfield.");
        // Coal for the power station, then the same train behind an electric engine.
        w().economy.setRoute(ore, coalRun);
        T.run(12 * 60, () => w().economy.depotAtPiece(power)!.piles[CARGO.coal.index] >= 6);
        T.note(`coal run: the power station has ${w().economy.depotAtPiece(power)!.piles[CARGO.coal.index]} coal`);
        w().economy.setRoute(ore, { ...ironRun, stops: [...ironRun.stops] });
        w().sim.setLook(ore, "electric");
        T.run(20);
        const train = w().sim.findCar(ore)!.train;
        const top = topSpeed(w(), train);
        T.note(`electric engine: top speed ${(top / ENGINE_SPEED).toFixed(2)}× (power ${powered(w()) ? "on" : "off"}), going ${Math.round(train.speed)} mm/s`);
        if (powered(w()) && top !== ENGINE_SPEED * 1.4) T.findings.push(`The electric engine's top speed with power is ${top}, not 1.4×.`);
        if (!powered(w())) T.findings.push("The power station had no coal by the time the electric engine went on.");
        // (It runs only while the power station has coal, a coal a minute: back to the goods engine for the iron.)
        w().sim.setLook(ore, "goods");
        T.run(15 * 60, () => ironAt() >= 10);
        T.note(`Larkfield has had ${ironAt()} iron (${minutes(T.tick - t0)} min after the ore train started)`);
        T.learnAnyway("smithy");
        T.note(`wagons now hold ${w().economy.wagonCapacity}`);
        const found = w().sim.findCar(ore);
        if (found) w().sim.removeTrain(found.train.id);
        T.reportEvery = 300;
      }

      // Furniture: a carpenter's yard on a branch of its own.
      const carpenter = branchOff("depot-carpenter", anywhere.filter((i) => i % 2 === 0));
      const furnitureAt = () => receivedBy(w(), larkfield().id).furniture ?? 0;
      if (carpenter === -1) {
        T.findings.push("Phase C: couldn't place a carpenter's yard.");
      } else {
        syncIndustries(w());
        if (!w().layout.getPiece(between)) between = middle();
        const vanTrain = T.train(["engine", "timber", "timber", "van"], between, -1);
        w().economy.setRoute(vanTrain, {
          stops: [
            { depotId: depotAt(forest), action: "pick" },
            { depotId: depotAt(saw), action: "drop" },
            { depotId: depotAt(saw), action: "pick" },
            { depotId: depotAt(carpenter), action: "drop" },
            { depotId: depotAt(carpenter), action: "pick" },
            { depotId: depotAt(st(0)), action: "drop" },
          ],
          next: 0,
        });
        T.note("carpenter's yard on a branch; 2 timber wagons and a van, route: forest yard (pick up) → sawmill (drop, pick up) → carpenter's yard (drop, pick up) → Larkfield (drop)");
        const t0 = T.tick;
        T.run(40 * 60, () => furnitureAt() >= 6);
        const cd = w().economy.depotAtPiece(carpenter)!;
        T.note(`Larkfield has had ${furnitureAt()} furniture (${minutes(T.tick - t0)} min after the furniture train started); the carpenter's yard has ${cd.piles[CARGO.planks.index]} planks, ${cd.piles[CARGO.furniture.index]} furniture`);
        T.trains();
        if (furnitureAt() === 0) T.findings.push("Phase C: no furniture reached Larkfield.");
        const found = w().sim.findCar(vanTrain);
        if (found) w().sim.removeTrain(found.train.id);
      }
      T.saveAndLoad();
      // The mixed train runs the line again: towns keep growing. The routed
      // trains left the switches set toward their branches; a train with no route follows them, so they go back to
      // the main line.
      for (const id of [...w().sim.trainIds()]) w().sim.removeTrain(id);
      for (const id of w().layout.pieceIds()) if (w().layout.getPiece(id)!.type === "switch") w().layout.setSwitchState(id, 0);
      if (!w().layout.getPiece(between)) between = middle();
      T.train(["engine", "timber", "timber", "hopper", "van"], between, -1);
      T.run(20 * 60, () => T.level(larkfield()) >= 5);
      T.note(`Larkfield is a ${T.town.status(larkfield().id).name.toLowerCase()}`);
      const s5 = T.town.status(larkfield().id);
      const short = Object.entries(s5.wants).map(([k, n]) => `${s5.got[k as keyof typeof s5.got] ?? 0}/${n} ${k}`).join(", ");
      if (T.level(larkfield()) < 5) T.findings.push(`Larkfield didn't reach City ★★: ${short}`);
    } finally {
      const status = w().landscape.towns.map((t) => `${t.name} ${T.town.status(t.id).name.toLowerCase()} [${[...townLandmarks(t)].join(", ")}] ${describeGoods(receivedBy(w(), t.id))}`);
      console.log(
        [
          "grand tour:",
          ...T.log,
          `towns: ${status.join("; ")}`,
          `coins ${T.progress.coins} (${T.coins.market} from markets); learned ${[...T.progress.learned].join(", ")}`,
          `findings:\n- ${T.findings.join("\n- ") || "none"}`,
        ].join("\n"),
      );
    }
    expect(T.findings).toEqual([]);
    expect(T.level(larkfield())).toBeGreaterThanOrEqual(5);
  }, 900_000);
});
