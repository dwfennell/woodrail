import { describe as describeGoods } from "../economy/goods";
import type { BoatState } from "../economy";
import { BULK, capacityOf, depotLabel, loaded, MAX_BARGES, type Fleet } from "../game/boats";
import { BUILD_LABEL, cancel as cancelOrder, isYard, order as orderBuild, progressOf, stillNeeds, tickYards, whyNotOrder, YARD_BUILDS, YARD_COSTS } from "../game/yards";
import type { YardBuild } from "../economy";
import type { Game } from "../game/game";
import type { Interaction } from "../game/interaction";
import type { Progress } from "../game/progress";
import { BoatCard, type BoatCardView } from "./boat-card";
import type { Hud } from "./hud";

/**
 * Game mode's River barges on screen (docs/superpowers/specs/2026-11-04-water-transport.md §7): the landing's card's
 * "Boats here" and "+ New barge", the boat's card, planning a boat's route (a tap on a landing is a stop, through the
 * route planner's own hook, `Interaction.onPickPlace`), and a tap on a boat opening its card. main.ts calls `frame`
 * on each drawn frame's HUD pass (cheap: keys compared) and `tick` once a second of play.
 */
export interface WaterContext {
  game: Game;
  hud: Hud;
  interaction: Interaction;
  progress: () => Progress;
  isGame: () => boolean;
  /** Something the player did changed the map (boats, their routes): save it. */
  saved: () => void;
  /** The player's coins changed: save them. */
  paid: () => void;
}

export interface WaterControls {
  /** On each frame's HUD pass: the open landing's boats, the open boat's card. */
  frame(): void;
  /** Once a second of play: the boats moved on (`seconds` of game time). */
  tick(seconds: number): void;
  /** A boat's card, opened (from a tap on it, or its chip on a landing's card). */
  open(boatId: number): void;
  /** A new map: no boat's card open, no planning. */
  reset(): void;
}

export function attachWater(ctx: WaterContext): WaterControls {
  const { game, hud, interaction } = ctx;
  const fleet: Fleet = game.fleet;
  let open = -1;
  let planning = false;

  const card = new BoatCard({
    close: () => hud.hideCards(),
    plan: (on) => setPlanning(on),
    cycleStop: (i) => {
      fleet.cycleAction(open, i);
      ctx.saved();
    },
    removeStop: (i) => {
      fleet.removeStop(open, i);
      ctx.saved();
    },
    goStop: () => {
      const b = game.economy.boats.get(open);
      if (!b) return;
      b.going = !b.going;
      ctx.saved();
    },
  });
  hud.addCard(card.el);

  function setPlanning(on: boolean): void {
    if (on === planning) return;
    planning = on;
    if (on) {
      // (A train's route being planned is left first: one planner at a time.)
      if (interaction.onPickPlace) interaction.onLeavePlanning?.();
      interaction.onPickPlace = (depotId) => {
        const why = fleet.addStop(open, depotId);
        if (why) hud.toast(why, false, 3200);
        else ctx.saved();
        return true;
      };
    } else if (interaction.onPickPlace) interaction.onPickPlace = null;
  }

  function openBoat(boatId: number): void {
    if (!game.economy.boats.has(boatId)) return;
    hud.hideCards();
    setPlanning(false);
    open = boatId;
    card.show(viewOf(game.economy.boats.get(boatId)!));
    // (A boat just bought has no route yet: planning starts at once, its landing stop 1.)
    if (game.economy.boats.get(boatId)!.stops.length < 2) setPlanning(true);
  }

  function viewOf(b: BoatState): BoatCardView {
    const n = loaded(b);
    const what = BULK.filter((k) => (b.load[k] ?? 0) > 0);
    const load = n === 0 ? "Empty: barges carry logs, stone, coal, ore and grain" : `Carrying ${n} of ${capacityOf(b)}: ${describeGoods(Object.fromEntries(what.map((k) => [k, b.load[k]])))}`;
    const current = b.docked || b.stops.length < 2 ? b.from : (b.from + 1) % b.stops.length;
    return {
      id: b.id,
      name: b.name,
      barges: b.barges,
      maxBarges: MAX_BARGES,
      load,
      status: fleet.status(b),
      stops: b.stops.map((s, i) => ({ label: depotLabel(game, s.depotId), action: s.action, current: i === current })),
      planning,
      more: b.barges < MAX_BARGES ? "More barges: build them at a boatyard (each carries 4 loads)." : "",
      going: b.going,
    };
  }

  /** The open dock's or yard's row (its boats; a yard's build), as drawn (a key): made again only when it changes. */
  let dockShown = "";
  function showDock(): void {
    const id = ctx.isGame() ? interaction.openDepotId : -1;
    const d = id === -1 ? undefined : game.economy.depot(id);
    const role = d?.role;
    if (!d || !hud.depotCardOpen || (role !== "landing" && role !== "boatyard" && role !== "shipyard")) {
      dockShown = "";
      return;
    }
    const boats = role === "shipyard" ? [] : fleet.callingAt(id);
    const o = game.economy.yardOrders.get(id);
    const builds = isYard(d) ? YARD_BUILDS[d.role as "boatyard" | "shipyard"] : [];
    const whys = builds.map((b) => whyNotOrder(game, d, b));
    const key = `${id}|${boats.map((b) => `${b.id}:${b.name}`).join()}|${o ? `${o.build}:${JSON.stringify(o.got)}` : ""}|${whys.join()}|${game.economy.shipsBuilt},${game.economy.ferriesBuilt}`;
    const box = hud.depotExtra;
    if (key === dockShown && box.querySelector("[data-dock]")) return;
    dockShown = key;
    box.hidden = false;
    box.innerHTML = "";
    const row = document.createElement("div");
    row.className = "landing-boats";
    row.dataset.dock = String(id);
    const line = (cls: string, text: string) => {
      const e = document.createElement("div");
      e.className = cls;
      e.textContent = text;
      row.append(e);
      return e;
    };
    if (o) {
      // Under way: the hull on the ways, and the goods still to come by train (as a town's building under way).
      const left = stillNeeds(o);
      line("yard-building", `Building ${aOrAnLabel(o.build)}: ${Math.round(progressOf(o) * 100)}% done`);
      line("card-hint yard-needs", Object.keys(left).length > 0 ? `Still to come by train: ${describeGoods(left)}` : "Launching!");
      const stop = document.createElement("button");
      stop.className = "chip text yard-cancel";
      stop.textContent = "Stop building";
      stop.title = "Stop building: the goods gone into it are lost";
      stop.addEventListener("click", (e) => {
        e.stopPropagation();
        cancelOrder(game, id);
        ctx.saved();
      });
      row.append(stop);
    } else if (builds.length > 0) {
      line("card-hint", role === "boatyard" ? "Build a boat: trains bring the goods here, and it slides into the river when it's done." : "Build a ship: trains bring the goods here, and it's launched into the sea when it's done.");
      const chips = document.createElement("div");
      chips.className = "card-row yard-builds";
      builds.forEach((b, k) => {
        const btn = document.createElement("button");
        btn.className = "chip text yard-build";
        btn.dataset.build = b;
        btn.textContent = `${BUILD_LABEL[b]}: ${describeGoods(YARD_COSTS[b])}`;
        btn.title = whys[k] ?? `Build ${aOrAnLabel(b)} here`;
        btn.disabled = !!whys[k];
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!orderBuild(game, d, b)) {
            hud.toast(whyNotOrder(game, d, b) ?? "The yard can't build that now", false, 3200);
            return;
          }
          ctx.saved();
        });
        chips.append(btn);
      });
      row.append(chips);
    }
    if (role === "shipyard") line("card-hint", `Built here: ${game.economy.shipsBuilt} cargo ship${game.economy.shipsBuilt === 1 ? "" : "s"}, ${game.economy.ferriesBuilt} train ferr${game.economy.ferriesBuilt === 1 ? "y" : "ies"}.`);
    if (role !== "shipyard") {
      const hint = boats.length > 0 ? "Boats here:" : role === "landing" ? "Tugs and barges are built at a boatyard: give one a route to call here." : "";
      if (hint) line("card-hint", hint);
      const chips = document.createElement("div");
      chips.className = "card-row landing-boat-chips";
      for (const b of boats) {
        const chip = document.createElement("button");
        chip.className = "chip text";
        chip.textContent = `⛵ ${b.name}`;
        chip.title = `${b.name}'s card`;
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          openBoat(b.id);
        });
        chips.append(chip);
      }
      row.append(chips);
    }
    box.append(row);
  }

  /** "a tug and a barge", "a cargo ship". */
  function aOrAnLabel(b: YardBuild): string {
    return `a ${BUILD_LABEL[b].toLowerCase()}`;
  }

  interaction.boatAt = (x, y) => (ctx.isGame() && game.economy.boats.size > 0 ? game.riverBoats.boatAt(x, y, game.camera, game.canvas.getBoundingClientRect()) : -1);
  interaction.onBoatTap = (id) => openBoat(id);

  return {
    frame() {
      showDock();
      if (open === -1) return;
      const b = game.economy.boats.get(open);
      if (card.el.hidden || !b) {
        // Closed (a tap on the floor, ✕, another card), or sold: planning ends with it.
        if (planning) setPlanning(false);
        open = -1;
        card.hide();
        return;
      }
      card.show(viewOf(b));
    },
    tick(seconds) {
      // The train ferries: a train aboard sold abroad, one back with goods from abroad.
      for (const e of game.ferries.tick(game.world, ctx.progress(), seconds)) {
        hud.setCoins(ctx.progress().coins);
        ctx.paid();
        if (e.kind === "boarded") hud.toast(e.sold > 0 ? `Off abroad on the ferry: its ${e.sold} loads sold for ${e.coins} coins` : "Off abroad on the ferry", false, 3600);
        else hud.toast(Object.keys(e.goods).length > 0 ? `Back from abroad with ${describeGoods(e.goods)} (${e.coins} coins)` : "Back from abroad", false, 3600);
        game.invalidate();
      }
      // The yards: goods into their hulls; a finished one slides into the water.
      for (const e of tickYards(game.world, fleet)) {
        game.yardsView.launch(e.depotId, e.build);
        hud.toast(`Launched: ${aOrAnLabel(e.build)}!`, true, 3600);
        ctx.saved();
      }
      const events = fleet.tick(seconds);
      fleet.tickedAt = game.simSeconds;
      if (events.some((e) => e.kind === "docked" && e.dropped + e.picked > 0)) {
        ctx.saved();
        interaction.refreshDepotCard();
      }
      if (events.length > 0) game.invalidate();
    },
    open: openBoat,
    reset() {
      game.ferries.reset(game.world);
      setPlanning(false);
      open = -1;
      card.hide();
      fleet.tickedAt = game.simSeconds;
    },
  };
}
