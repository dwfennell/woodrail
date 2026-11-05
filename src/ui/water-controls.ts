import { describe as describeGoods } from "../economy/goods";
import type { BoatState } from "../economy";
import { BARGE_PRICE, BOAT_PRICE, BULK, capacityOf, depotLabel, loaded, MAX_BARGES, type Fleet } from "../game/boats";
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
    addBarge: () => {
      const p = ctx.progress();
      if (!fleet.addBarge(open, p)) {
        hud.toast(p.coins < BARGE_PRICE ? `A barge costs ${BARGE_PRICE} coins: you have ${p.coins}` : `${MAX_BARGES} barges is the most a tug tows`, false, 3200);
        return;
      }
      hud.setCoins(p.coins);
      ctx.paid();
      ctx.saved();
    },
    goStop: () => {
      const b = game.economy.boats.get(open);
      if (!b) return;
      b.going = !b.going;
      ctx.saved();
    },
    sell: () => {
      const p = ctx.progress();
      const back = fleet.sell(open, p);
      hud.setCoins(p.coins);
      hud.toast(`Sold: ${back} coins back`);
      ctx.paid();
      ctx.saved();
      hud.hideCards();
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
    const p = ctx.progress();
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
      bargePrice: b.barges < MAX_BARGES ? BARGE_PRICE : null,
      canAddBarge: b.barges < MAX_BARGES && p.coins >= BARGE_PRICE,
      going: b.going,
      sellsFor: Math.floor((BOAT_PRICE + (b.barges - 1) * BARGE_PRICE) / 2),
    };
  }

  /** The open landing's boats row, as drawn (a key), so it's made again only when it changes. */
  let landingShown = "";
  function showLanding(): void {
    const id = ctx.isGame() ? interaction.openDepotId : -1;
    const d = id === -1 ? undefined : game.economy.depot(id);
    if (!d || d.role !== "landing" || !hud.depotCardOpen) {
      landingShown = "";
      return;
    }
    const boats = fleet.callingAt(id);
    const why = fleet.whyNotBuy(id, ctx.progress());
    const key = `${id}|${boats.map((b) => `${b.id}:${b.name}:${b.docked && b.stops[b.from]?.depotId === id}`).join()}|${why}`;
    const box = hud.depotExtra;
    if (key === landingShown && box.querySelector("[data-landing]")) return;
    landingShown = key;
    box.hidden = false;
    box.innerHTML = "";
    const row = document.createElement("div");
    row.className = "landing-boats";
    row.dataset.landing = String(id);
    const label = document.createElement("div");
    label.className = "card-hint";
    label.textContent = boats.length > 0 ? "Boats here:" : "Buy a tug and a barge here, then give it a route to another landing on this river.";
    row.append(label);
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
    const buy = document.createElement("button");
    buy.className = "chip text primary landing-buy";
    buy.innerHTML = `⛵ New barge · ${BOAT_PRICE} <span aria-label="coins">🪙</span>`;
    buy.title = why ?? "A tug and a barge, bought here";
    buy.disabled = !!why && !why.includes("coins");
    buy.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = ctx.progress();
      const b = fleet.buy(id, p);
      if (!b) {
        hud.toast(fleet.whyNotBuy(id, p) ?? "Can't buy a boat here", false, 3200);
        return;
      }
      // (It loads at its landing at once: what's on the jetty for it.)
      fleet.serve(b, b.stops[0]);
      hud.setCoins(p.coins);
      ctx.paid();
      ctx.saved();
      game.invalidate();
      openBoat(b.id);
    });
    chips.append(buy);
    row.append(chips);
    box.append(row);
  }

  interaction.boatAt = (x, y) => (ctx.isGame() && game.economy.boats.size > 0 ? game.riverBoats.boatAt(x, y, game.camera, game.canvas.getBoundingClientRect()) : -1);
  interaction.onBoatTap = (id) => openBoat(id);

  return {
    frame() {
      showLanding();
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
