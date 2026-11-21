/**
 * A builder for our own reference maps (dispatcher spec §8 step 0, docs/superpowers/specs/evidence/2026-11-18-dispatcher/
 * own-maps.md): layouts laid as a player lays them, in Sandbox on flat land, every piece through the Editor and the
 * tray's placement rules (`rulesFor`: the land, overlaps, headroom, support), gaps closed by the simulated player
 * (`play`, the Auto piece and near misses as the game gives them), signals put on joints as the Signal tool puts them
 * (a pair, or one way, each with room for its post: `hasRoom`), industries' depots made as a drop makes them
 * (`syncIndustries`), trains put down out of the box and set going, lines made as the line sheet makes them
 * (`editLine`, `joinLine`). Saved in the "Copy map for a bug report" format (`woodrail-map:1:`). Test-only.
 */
import { Editor } from "../../editor/editor";
import { editLine, joinLine } from "../../game/lines";
import { hasRoom } from "../../game/signal-place";
import { createWorld, plotsForSale, syncIndustries, unlockPlot, type World } from "../../game/world";
import { deserializeWorld, serializeWorld } from "../../persist/save";
import { Economy } from "../../economy";
import { FEAT_NONE, FEAT_TREE, SURF_GRASS } from "../../landscape/grid";
import { PropStore } from "../../props/store";
import { Sim } from "../../sim";
import { checkPlacement } from "../../landscape";
import type { CarKind } from "../../sim";
import { appendPiece, connectorRef, fitAutoStraight, getPieceDef, Layout, pieceOfRef, type PieceTypeId } from "../../track";
import { writeMapFile } from "../perf-map-file";
import { layOn, rulesFor } from "../rules";

/**
 * An empty Sandbox table: a flat map with no water and no sea (the new-map screen's Flat, None, No sea), `plots` more
 * plots of land added as Sandbox's "add land" adds them, then cleared to bare felt: no towns, roads, fields, shed or
 * sites, and no hills, so each map's layout is all there is on it. (Harness-only: a player can't clear towns away. The
 * land isn't what these maps test; the track on it is, and every piece of that is laid by the rules.) Saved and loaded
 * again, as a fresh world on that land.
 */
export function emptyTable(seed: number, plots: number): World {
  const w0 = createWorld(seed, false, true, false, { hills: "flat", water: "none", coast: false });
  for (let i = 0; i < plots; i++) {
    const p = plotsForSale(w0.landscape).sort((a, b) => Math.hypot(a.px, a.pz) - Math.hypot(b.px, b.pz))[0];
    if (!p || !unlockPlot(w0, p.px, p.pz)) break;
  }
  const land = w0.landscape;
  land.towns = [];
  land.depots = [];
  land.fields = [];
  land.shed = null;
  land.corridors = [];
  land.sites = [];
  land.siteless = true;
  land.secrets = [];
  land.secretPlan = [];
  delete (land as { firstTrain?: unknown }).firstTrain;
  const g = land.grid;
  g.height.fill(0);
  g.surface.fill(SURF_GRASS);
  g.road.fill(0);
  for (let i = 0; i < g.feature.length; i++)
    if (g.feature[i] !== FEAT_TREE) {
      g.feature[i] = FEAT_NONE;
      g.owner[i] = -1;
    }
  const layout = new Layout();
  const sim = new Sim(layout);
  const bare: World = { layout, sim, landscape: land, stations: new Map(), depots: new Map(), economy: new Economy(layout, sim), props: new PropStore(), ruins: new Map() };
  const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(bare))), { sandbox: true });
  if (!r.ok) throw new Error(`the empty table doesn't load: ${r.error}`);
  return r.value;
}

export type Step = PieceTypeId | [PieceTypeId, boolean];

export class Build {
  readonly w: World;
  readonly editor: Editor;
  readonly engines: number[] = [];

  /** The build last begun (for a schematic of one that failed). */
  static last: Build | null = null;

  constructor(seed = 11, plots = 16) {
    Build.last = this;
    this.w = emptyTable(seed, plots);
    this.editor = new Editor(this.w.layout, this.w.sim, () => {}, () => false);
  }

  /** A first piece at `pose` (heading in eighths of a turn), if the rules allow. */
  start(type: PieceTypeId, x: number, z: number, eighths = 0, flipped = false, y = 0): number {
    const pose = { x, z, heading: (eighths * Math.PI) / 4 };
    const why = rulesFor(this.w)(type, flipped, pose, y, -1);
    if (why) throw new Error(`${type} at ${x},${z}: ${why}`);
    return this.editor.place(type, pose, y, flipped);
  }

  /** `type` on free end `ref` (as the tray's drop seats it). Its id and its other end (by `exit`, default the first other). */
  lay(ref: number, type: PieceTypeId, flipped = false, via?: number): { id: number; next: number } {
    if (via !== undefined) {
      const tmp = appendPiece(this.w.layout, type, flipped, ref, via);
      const p = this.w.layout.getPiece(tmp)!;
      const pose = { ...p.pose };
      const y = p.y;
      const why = rulesFor(this.w)(type, flipped, pose, y, tmp);
      this.w.layout.removePiece(tmp);
      if (why) throw new Error(`${type} on ${ref}: ${why}`);
      const id = this.editor.place(type, pose, y, flipped);
      if (this.w.layout.joinedConnector(connectorRef(id, via)) !== ref) throw new Error(`${type} on ${ref}: not joined`);
      const other = getPieceDef(type, flipped).connectors.findIndex((_, k) => k !== via);
      return { id, next: other === -1 ? -1 : connectorRef(id, other) };
    }
    const r = layOn(this.w, this.editor, ref, type, flipped);
    if ("why" in r) throw new Error(`${type} on ${ref}: ${r.why}`);
    return r;
  }

  /** Which way a free end points (radians). */
  headingOf(ref: number): number {
    return this.w.layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" }).heading;
  }

  /**
   * Lay `steps` end to end from `ref`; their ids, and the last free end. A curve's `flipped` here is the way it turns,
   * whichever end it's seated by: false right (clockwise as the map is drawn, x east and z south), true left.
   */
  run(ref: number, steps: readonly Step[]): { ids: number[]; end: number; exits: number[] } {
    const ids: number[] = [];
    const exits: number[] = [];
    let at = ref;
    for (const s of steps) {
      const [type, flipped] = typeof s === "string" ? [s, false] : s;
      if (type === "ramp") {
        // (A ramp's `flipped` here: down (true) or up, whichever way round it has to go for that.)
        const r = this.ramp(at, flipped ? -1 : 1);
        ids.push(r.id);
        exits.push(r.next);
        at = r.next;
        continue;
      }
      let r = this.lay(at, type, flipped);
      if (type.startsWith("curve") || type === "bridge-curve" || type.startsWith("ramp-curve")) {
        const turn = Math.atan2(Math.sin(this.headingOf(r.next) - this.headingOf(at)), Math.cos(this.headingOf(r.next) - this.headingOf(at)));
        if (turn > 0 === flipped) {
          this.editor.remove(r.id);
          r = this.lay(at, type, !flipped);
        }
      }
      ids.push(r.id);
      exits.push(r.next);
      at = r.next;
    }
    return { ids, end: at, exits };
  }

  /** A ramp on from `ref`, going up (`dir` 1) or down (−1) a level: seated whichever way round does that, if the rules allow. */
  ramp(ref: number, dir: 1 | -1): { id: number; next: number } {
    const y0 = this.w.layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" }).y;
    let last = "";
    for (const flipped of [false, true])
      for (const via of [0, 1]) {
        let r: { id: number; next: number };
        try {
          r = this.lay(ref, "ramp", flipped, via);
        } catch (e) {
          last = String(e);
          continue;
        }
        const y1 = this.w.layout.worldConnector(r.next, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" }).y;
        if (Math.sign(y1 - y0) === dir) return r;
        this.editor.remove(r.id);
      }
    throw new Error(`no ramp ${dir > 0 ? "up" : "down"} on ${ref}: ${last}`);
  }

  /**
   * Points laid on `ref` by end `via`, flipped whichever way puts its branch's end (end 2) where `side` says (given that
   * end's place and the place of `ref`).
   */
  points(ref: number, via: number, side: (end: { x: number; z: number }, from: { x: number; z: number }) => boolean, type: PieceTypeId = "switch"): number {
    const wc = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" as const };
    const from = { ...this.w.layout.worldConnector(ref, wc) };
    for (const flipped of [false, true]) {
      const r = this.lay(ref, type, flipped, via);
      if (side(this.w.layout.worldConnector(connectorRef(r.id, 2), wc), from)) return r.id;
      this.editor.remove(r.id);
    }
    throw new Error(`no way round for points on ${ref}`);
  }

  /** A crossover's far points, laid by their branch on points' branch end `ref`, flipped whichever way lies along `deg` (and back). */
  crossover(ref: number, deg = 0): number {
    for (const flipped of [false, true]) {
      const r = this.lay(ref, "switch", flipped, 2);
      try {
        this.facing(r.id, deg);
        this.facing(r.id, deg + 180);
        return r.id;
      } catch {
        this.editor.remove(r.id);
      }
    }
    throw new Error(`no crossover on ${ref}`);
  }

  /** The end of piece `id` facing (outward) within 30° of `deg` (as the map is drawn: 0 east, 90 south). */
  facing(id: number, deg: number): number {
    const p = this.w.layout.getPiece(id)!;
    const n = getPieceDef(p.type, p.flipped).connectors.length;
    for (let c = 0; c < n; c++) {
      const h = this.headingOf(connectorRef(id, c));
      if (Math.abs(Math.atan2(Math.sin(h - (deg * Math.PI) / 180), Math.cos(h - (deg * Math.PI) / 180))) < Math.PI / 6) return connectorRef(id, c);
    }
    throw new Error(`piece ${id} has no end facing ${deg}°`);
  }

  /** The end of piece `id` (connector `c`). */
  end(id: number, c: number): number {
    return connectorRef(id, c);
  }

  /**
   * Close free ends `a` and `b` as a player does when they nearly meet: a near miss the Editor seats by itself, else the
   * Auto piece (`fitAutoStraight`, as the tray's Auto fits it) laid on `a`. Throws, with the gap, if they don't meet.
   */
  close(a: number, b: number): number {
    const L = this.w.layout;
    if (L.joinedConnector(a) === b) return 0;
    const wc = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" as const };
    const ea = { ...L.worldConnector(a, wc) };
    const eb = { ...L.worldConnector(b, wc) };
    const gap = `${Math.round(Math.hypot(ea.x - eb.x, ea.z - eb.z))} mm, ${Math.round((Math.abs(Math.atan2(Math.sin(eb.heading - ea.heading - Math.PI), Math.cos(eb.heading - ea.heading - Math.PI))) * 180) / Math.PI)}°`;
    const tmp = appendPiece(L, "straight-216", false, a, 0);
    const p = L.getPiece(tmp)!;
    const pose = { ...p.pose };
    const y = p.y;
    L.removePiece(tmp);
    const fit = fitAutoStraight(L, pose, y, 0, [...L.pieceIds()].filter((id) => id !== pieceOfRef(b)));
    if (!fit || fit.gap) throw new Error(`couldn't close ${a}→${b}: ${gap}`);
    const why = rulesFor(this.w)(fit.type, fit.flipped, fit.pose, y, -1);
    if (why) throw new Error(`couldn't close ${a}→${b} (${gap}): Auto ${why}`);
    this.editor.place(fit.type, fit.pose, y, fit.flipped);
    if (L.joinedConnector(b) === -1) throw new Error(`couldn't close ${a}→${b}: ${gap}, Auto laid but unjoined`);
    return 1;
  }

  /** Is end `ref` joined to something? */
  joined(ref: number): boolean {
    return this.w.layout.joinedConnector(ref) !== -1;
  }

  /** A pair of signals on the joint at end `ref` (one each way), as the Signal tool puts them. */
  signals(ref: number): number[] {
    const L = this.w.layout;
    const other = L.joinedConnector(ref);
    if (other === -1) throw new Error(`no joint at ${ref}`);
    const ats = [ref, other].filter((a) => !L.signalAt(a) && hasRoom(L, a));
    if (ats.length < 2) throw new Error(`no room for a pair at ${ref}`);
    return this.editor.addSignals(ats);
  }

  /** A pair on the joint at `ref` if both posts have room there (a player puts them elsewhere if not); true if put. */
  trySignals(ref: number): boolean {
    const L = this.w.layout;
    const other = L.joinedConnector(ref);
    if (other === -1 || L.signalAt(ref) || L.signalAt(other) || !hasRoom(L, ref) || !hasRoom(L, other)) return false;
    return this.editor.addSignals([ref, other]).length === 2;
  }

  /** A one-way signal on the joint at end `ref`, guarding trains that leave `ref`'s piece by it. */
  oneWay(ref: number): number {
    const L = this.w.layout;
    if (L.joinedConnector(ref) === -1) throw new Error(`no joint at ${ref}`);
    if (!hasRoom(L, ref)) throw new Error(`no room at ${ref}`);
    return this.editor.addSignals([ref])[0];
  }

  /** Signal pairs on the joints after each of `ids` (the joint at its end 1, between it and the next piece). */
  signalsAfter(ids: readonly number[], c = 1): void {
    for (const id of ids) this.signals(connectorRef(id, c));
  }

  /** Industries' depots for every industry piece laid (as a drop makes them). */
  depots(): void {
    syncIndustries(this.w, false);
  }

  /** The depot on piece `pieceId` (its id). */
  depotOf(pieceId: number): number {
    const d = this.w.economy.depotAtPiece(pieceId);
    if (!d) throw new Error(`no depot on piece ${pieceId}`);
    return d.id;
  }

  /** A train out of the box onto `pieceId` (facing its path, or back), set going. Its engine's id. */
  train(cars: CarKind[], pieceId: number, reversed = false, s = 100, name?: string): number {
    for (const at of [s, s - 40, s + 40, 30, 150]) {
      const r = this.w.sim.addTrain(cars, { pieceId, pathIndex: 0, reversed, s: at });
      if (r.kind !== "placed") continue;
      // (Put down clear of other trains, as a player does: no piece shared with one, points above all.)
      const mine = new Set(this.w.sim.getTrain(r.trainId)!.bogies.map((x) => x.pieceId));
      if ([...this.w.sim.trains()].some((o) => o.id !== r.trainId && o.bogies.some((x) => mine.has(x.pieceId)))) {
        this.w.sim.removeTrain(r.trainId);
        continue;
      }
      const engine = this.w.sim.getTrain(r.trainId)!.cars.find((c) => c.kind === "engine")!;
      this.w.sim.setLever(engine.id, 1);
      if (name) this.w.sim.setName(engine.id, name);
      this.engines.push(engine.id);
      return engine.id;
    }
    throw new Error(`no room for a train on piece ${pieceId}`);
  }

  /** A new line of stops (depots on these pieces) run by `engine`; the line's id. */
  line(engine: number, stopPieces: readonly number[]): number {
    this.depots();
    const stops = stopPieces.map((p) => ({ depotId: this.depotOf(p), action: "auto" as const }));
    const line = editLine(this.w.economy, engine, (st) => st.push(...stops));
    if (!line) throw new Error("no line");
    return line.id;
  }

  /** `engine` put on line `id`. */
  join(engine: number, id: number): void {
    if (!joinLine(this.w.economy, engine, id)) throw new Error(`couldn't join line ${id}`);
  }

  /** Every free end left (for checking a layout is closed where it should be). */
  freeEnds(): number[] {
    const out: number[] = [];
    for (const id of this.w.layout.pieceIds()) {
      const p = this.w.layout.getPiece(id)!;
      const n = getPieceDef(p.type, p.flipped).connectors.length;
      for (let c = 0; c < n; c++) if (this.w.layout.joinedConnector(connectorRef(id, c)) === -1) out.push(connectorRef(id, c));
    }
    return out;
  }

  /** A schematic of the layout (pieces' paths, signals, trains, depots) as SVG, for eyeballing a build. */
  svg(view?: { x0: number; z0: number; x1: number; z1: number }): string {
    const L = this.w.layout;
    const wc = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" as const };
    const lines: string[] = [];
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    const pt = (ref: number) => {
      const c = L.worldConnector(ref, wc);
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
      return { x: c.x, z: c.z, y: c.y };
    };
    for (const id of L.pieceIds()) {
      const p = L.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      const depot = p.type.startsWith("depot");
      for (const path of def.paths) {
        if (path.to === null) continue;
        const a = pt(connectorRef(id, path.from));
        const b = pt(connectorRef(id, path.to));
        const col = depot ? "#c60" : def.paths.length > 1 ? "#06c" : (a.y > 0 || b.y > 0) ? "#999" : "#333";
        lines.push(`<line x1="${a.x}" y1="${a.z}" x2="${b.x}" y2="${b.z}" stroke="${col}" stroke-width="${depot ? 24 : 10}"/>`);
      }
      const c0 = pt(connectorRef(id, 0));
      lines.push(`<text x="${c0.x + 8}" y="${c0.z - 8}" font-size="28" fill="#888">${id}</text>`);
    }
    for (const s of L.signals()) {
      const c = pt(s.at);
      lines.push(`<circle cx="${c.x}" cy="${c.z}" r="14" fill="${"#2a2"}"/>`);
    }
    for (const id of this.w.sim.trainIds()) {
      const t = this.w.sim.getTrain(id)!;
      const b = t.bogies[0];
      const c = pt(connectorRef(b.pieceId, 0));
      lines.push(`<circle cx="${c.x}" cy="${c.z}" r="30" fill="#d22" opacity="0.7"/><text x="${c.x}" y="${c.z}" font-size="40">${t.cars.length}</text>`);
    }
    const pad = 100;
    if (view) [minX, minZ, maxX, maxZ] = [view.x0, view.z0, view.x1, view.z1];
    // (The land: what blocks a short straight, by square.)
    const land: string[] = [];
    const g = this.w.landscape.grid;
    for (let z = minZ - pad; z < maxZ + pad; z += 72)
      for (let x = minX - pad; x < maxX + pad; x += 72) {
        const c = g.cellAtWorld(x, z) === -1 ? { kind: "blocked" } : checkPlacement(this.w.landscape, "straight-36", false, { x, z, heading: 0 }, 0);
        if (c.kind !== "clear") land.push(`<rect x="${x - 36}" y="${z - 36}" width="72" height="72" fill="#fdd"/>`);
      }
    const W = maxX - minX + 2 * pad, H = maxZ - minZ + 2 * pad;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minZ - pad} ${W} ${H}" width="1600" height="${Math.round((1600 * H) / W)}"><rect x="${minX - pad}" y="${minZ - pad}" width="${W}" height="${H}" fill="#fff"/>${land.join("")}${lines.join("")}</svg>`;
  }

  /** Save as a copied Sandbox map. */
  async save(file: string): Promise<void> {
    const keys = { "woodrail.autosave.v3": JSON.stringify(serializeWorld(this.w)) };
    await writeMapFile(file, "sandbox", keys);
  }
}

export { connectorRef, pieceOfRef };

const S216: PieceTypeId = "straight-216";
const CL: PieceTypeId = "curve-large";

/**
 * A passing loop on from end `ref`: a switch, the main road (`main` long straights, with `mainStops` industry pieces
 * among them at those indices), the side road round by two large curves and `main − 1` straights (or `side` pieces),
 * and the far switch, its stem the way on. `left`: the side road on the switch's other hand (a flipped switch).
 */
export interface Loop {
  s1: number;
  s2: number;
  main: number[];
  side: number[];
  /** The way on, past the far points. */
  end: number;
  /** The joints at each road's ends, as the ends leaving the near points (`in`) and leaving the road (`out`), the way laid. */
  joints: { mainIn: number; sideIn: number; mainOut: number; sideOut: number };
}

export function passingLoop(b: Build, ref: number, main: readonly Step[], side?: readonly Step[], left = false): Loop {
  const s1 = b.lay(ref, "switch", left, 0).id;
  const m = b.run(connectorRef(s1, 1), main);
  const c1 = b.lay(connectorRef(s1, 2), CL, !left, 0).id;
  const sideSteps = side ?? Array<Step>(main.length - 1).fill(S216);
  const sd = b.run(connectorRef(c1, 1), sideSteps);
  const c2 = b.lay(sd.ids.length ? sd.end : connectorRef(c1, 1), CL, !left, 0).id;
  const s2 = b.lay(connectorRef(c2, 1), "switch", !left, 2).id;
  if (b.w.layout.joinedConnector(connectorRef(s2, 1)) !== m.end) throw new Error(`loop doesn't close (${b.w.layout.joinedConnector(connectorRef(s2, 1))} vs ${m.end})`);
  return { s1, s2, main: m.ids, side: [c1, ...sd.ids, c2], end: connectorRef(s2, 0), joints: { mainIn: connectorRef(s1, 1), sideIn: connectorRef(s1, 2), mainOut: m.end, sideOut: connectorRef(c2, 1) } };
}
