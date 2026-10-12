import { Vector3 } from "three";
import { ToyAudio } from "./audio/audio";
import { Editor } from "./editor/editor";
import { frameDistance } from "./game/camera-director";
import { Game, type GameWorld } from "./game/game";
import { Interaction } from "./game/interaction";
import { buildStarterWorld, createWorld, landForSale, plotsForSale } from "./game/world";
import { connectedPairs, PLOT_DEPTH, PLOT_WIDTH, SURF_RIVER, type Landscape, type PlotCoord } from "./landscape";
import { loadFromStorage, saveToStorage } from "./persist/save";
import { qualityFor, saveQualityOverride } from "./render/quality";
import { renderThumbnails } from "./render/thumbnails";
import { Hud, TRACK_ITEMS, TRAIN_ITEMS, trayKey } from "./ui/hud";
import { loadMuted, saveMuted } from "./ui/prefs";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const loading = document.querySelector<HTMLDivElement>("#loading");

function initialWorld(): GameWorld {
  const saved = loadFromStorage();
  if (saved?.ok) return saved.value;
  if (saved && !saved.ok) console.warn(`Woodrail: ignoring autosave (${saved.error})`);
  return buildStarterWorld();
}

function boot(): void {
  const game = new Game(canvas, initialWorld());
  // Stations and depots never shift to take up joint play.
  const isFixedPiece = (id: number): boolean => [...game.stations.values(), ...game.depots.values()].includes(id);
  let editor = new Editor(game.layout, game.sim, () => onChange(), isFixedPiece);
  let saveTimer = 0;
  let interaction: Interaction;
  const audio = new ToyAudio();
  let muted = loadMuted();
  audio.setMuted(muted);
  const thumbnails = renderThumbnails(
    game.renderer,
    game.mats,
    [...TRACK_ITEMS, ...TRAIN_ITEMS].map((item) =>
      item.kind === "piece" ? { key: trayKey(item), kind: "piece" as const, type: item.type } : { key: trayKey(item), kind: "train" as const, cars: item.cars },
    ),
  );

  const hud = new Hud(
    document.body,
    {
      trayPointerDown: (item, e) => interaction.startTrayDrag(item, e),
      undo: () => {
        interaction.undo();
      },
      redo: () => {
        interaction.redo();
      },
      rerailAll: () => {
        let n = 0;
        for (const id of game.sim.trainIds()) if (game.sim.getTrain(id)?.derailed && game.rerail(id) !== -1) n++;
        hud.toast(n ? `Re-railed ${n} train${n > 1 ? "s" : ""}` : "Nothing to re-rail");
        scheduleSave();
      },
      togglePause: () => {
        game.paused = !game.paused;
        hud.setPaused(game.paused);
      },
      lever: (v) => interaction.setLever(v),
      follow: () => interaction.toggleFollow(),
      removeTrain: () => interaction.removeSelectedTrain(),
      turnCar: () => interaction.turnSelectedCar(),
      rotate: () => interaction.rotateSelected(),
      flip: () => interaction.flipSelected(),
      deletePiece: () => interaction.deleteSelected(),
      newLayout: () => {
        setWorld(createWorld(Math.floor(Math.random() * 1_000_000)));
        game.frameLayout();
      },
      resetStarter: () => {
        setWorld(buildStarterWorld());
        game.frameLayout();
        openingView();
      },
      toggleExpand: () => setExpanding(!expanding),
      buyLand: () => buyLand(),
      toggleQuality: () => {
        saveQualityOverride(game.quality.tier === "high" ? "mobile" : "high");
        location.reload();
      },
      closeCards: () => {
        hud.hideCards();
        interaction.clearSelection();
      },
      toggleSound: () => {
        muted = !muted;
        audio.setMuted(muted);
        saveMuted(muted);
        hud.setMuted(muted);
      },
      buttonTap: () => audio.tap(),
      depotAuto: () => interaction.toggleDepotAuto(),
      trayTurn: () => {
        interaction.turnTrayPiece();
        hud.setTrayOrientation(interaction.trayTurns, interaction.trayFlipped);
      },
      trayFlip: () => {
        interaction.flipTrayPiece();
        hud.setTrayOrientation(interaction.trayTurns, interaction.trayFlipped);
      },
      depotWaitFull: () => interaction.toggleDepotWaitFull(),
    },
    () => (game.quality.tier === "high" ? "High" : "Battery saver"),
    { thumbnails, muted },
  );

  interaction = new Interaction(game, hud, () => editor, () => onChange());
  interaction.onPlaced = (snapped) => {
    audio.putdown(snapped);
    if (snapped) hud.haptic("snap");
  };
  interaction.onPickup = () => audio.pickup();
  interaction.onRefused = () => {
    audio.refuse();
    hud.haptic("refuse");
  };
  interaction.onTurned = () => audio.rotate();
  interaction.onDepart = () => audio.bell();

  // ---- adding land -----------------------------------------------------------------------------------------

  /** Choosing a plot to add, and the one chosen. */
  let expanding = false;
  let chosen: PlotCoord | null = null;

  function setExpanding(on: boolean): void {
    expanding = on;
    chosen = null;
    if (!on) {
      game.landscapeView.showForSale([]);
      hud.setLandCard(null);
      game.invalidate();
      return;
    }
    hud.hideCards();
    interaction.clearSelection();
    game.landscapeView.showForSale(plotsForSale(game.landscape));
    hud.setLandCard("Tap a plot marked + to see what it brings.");
    // Pull back to see the land and the plots round it, the land a little above the middle of the screen (clear of the
    // card and the tray).
    const e = game.landscape.grid.extent();
    const radius = Math.hypot(e.x1 - e.x0 + 2 * PLOT_WIDTH, e.z1 - e.z0 + 2 * PLOT_DEPTH) / 2;
    const toCamera = game.camera.position.clone().sub(game.controls.target).setY(0);
    if (toCamera.lengthSq() < 1) toCamera.set(0, 0, 1);
    toCamera.normalize().multiplyScalar(radius * 0.3);
    const centre = new Vector3((e.x0 + e.x1) / 2 + toCamera.x, 0, (e.z0 + e.z1) / 2 + toCamera.z);
    const distance = Math.min(frameDistance(radius, game.camera.fov, game.camera.aspect) * 0.8, game.controls.maxDistance);
    if (game.camera.position.distanceTo(game.controls.target) < distance) game.director.glideTo(centre, distance, { phi: 0.75, duration: 0.8 });
    game.invalidate();
  }

  /** What a plot would bring, in a few words. */
  function describeLand(land: Landscape): string {
    const parts: string[] = [];
    if (land.towns.length > 0) parts.push(land.towns.length > 1 ? `${land.towns.length} towns` : "a town");
    const forests = land.depots.filter((d) => d.kind === "forest").length;
    const mills = land.depots.filter((d) => d.kind === "sawmill").length;
    if (forests) parts.push(forests > 1 ? `${forests} forest yards` : "a forest yard");
    if (mills) parts.push("a sawmill");
    const g = land.grid;
    let river = false;
    let hills = 0;
    for (let i = 0; i < g.cellCount; i++) {
      if (g.surface[i] === SURF_RIVER) river = true;
      if (g.height[i] > 0) hills++;
    }
    if (river) parts.push("a river");
    if (hills > g.cellCount * 0.25) parts.push("hills");
    if (parts.length === 0) return "Open countryside.";
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
    return list.charAt(0).toUpperCase() + list.slice(1) + ".";
  }

  /** The plot whose + badge is drawn at this screen point (they float above the ground), if any. */
  function badgeAt(x: number, y: number, plots: readonly PlotCoord[]): PlotCoord | null {
    const r = game.canvas.getBoundingClientRect();
    const v = new Vector3();
    let best: PlotCoord | null = null;
    let bestD = 36;
    for (const p of plots) {
      v.set((p.px + 0.5) * PLOT_WIDTH, 320, (p.pz + 0.5) * PLOT_DEPTH).project(game.camera);
      if (v.z > 1) continue;
      const d = Math.hypot(r.left + ((v.x + 1) / 2) * r.width - x, r.top + ((1 - v.y) / 2) * r.height - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  interaction.onFloorTap = (ground, x, y) => {
    if (!expanding) return false;
    const forSale = plotsForSale(game.landscape);
    const p = badgeAt(x, y, forSale) ?? { px: Math.floor(ground.x / PLOT_WIDTH), pz: Math.floor(ground.z / PLOT_DEPTH) };
    if (!forSale.some((q) => q.px === p.px && q.pz === p.pz)) {
      chosen = null;
      game.landscapeView.showForSale(forSale);
      hud.setLandCard(game.landscape.grid.hasPlot(p.px, p.pz) ? "That's your land already. Tap a plot marked +." : "Only plots beside your land can be added.");
      game.invalidate();
      return true;
    }
    chosen = p;
    game.landscapeView.showForSale(forSale, chosen);
    hud.setLandCard(describeLand(landForSale(game.landscape, p.px, p.pz)), true);
    game.invalidate();
    return true;
  };

  function buyLand(): void {
    if (!chosen) return;
    const bought = game.unlockPlot(chosen.px, chosen.pz);
    if (!bought) return;
    const names = bought.towns.map((id) => game.landscape.towns[id].name);
    hud.toast(names.length > 0 ? `Welcome to ${names.join(" and ")}!` : "New land added", names.length > 0);
    audio.chime();
    chosen = null;
    game.landscapeView.showForSale(plotsForSale(game.landscape));
    hud.setLandCard("Tap a plot marked + to see what it brings.");
    updateConnections(false);
    scheduleSave();
  }

  function setWorld(world: GameWorld): void {
    setExpanding(false);
    game.setWorld(world);
    shownDelivered = new Map();
    announced = new Set();
    updateConnections(false);
    game.follow(-1);
    editor = new Editor(game.layout, game.sim, () => onChange(), isFixedPiece);
    interaction.clearSelection();
    hud.hideCards();
    onChange();
  }

  /** Pairs already celebrated on this map: lifting and replacing a piece mustn't re-announce them. */
  let announced = new Set<string>();
  let timberHinted = false;
  function updateConnections(announce: boolean): void {
    const pairs = connectedPairs(game.layout, game.stations);
    game.landscapeView.setConnected(new Set<number>(pairs.flat()));
    const name = (id: number) => game.landscape.towns.find((t) => t.id === id)?.name ?? "?";
    const fresh = pairs.filter(([a, b]) => !announced.has(`${a}-${b}`));
    for (const [a, b] of fresh) announced.add(`${a}-${b}`);
    if (!announce || fresh.length === 0) return;
    hud.toast(fresh.map(([a, b]) => `${name(a)} ↔ ${name(b)}`).join(", ") + " connected!", true);
    audio.chime();
    // After the first connection, point at the next thing to try (once, and only if there's no timber train yet).
    if (!timberHinted && game.landscape.depots.length > 0) {
      timberHinted = true;
      window.setTimeout(() => {
        const hasTimber = game.sim.trainIds().some((id) => game.sim.getTrain(id)?.cars.some((c) => c.kind === "timber"));
        if (!hasTimber) hud.toast("Try a timber train: forest logs → sawmill → planks for the towns", false, 6000);
      }, 3500);
    }
    game.flourishes.add(game.landscapeView.flash(fresh.flat()));
  }

  function onChange(): void {
    game.trackChanged();
    updateConnections(true);
    hud.setHistory(editor.canUndo, editor.canRedo);
    scheduleSave();
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveToStorage(game.world), 600);
  }

  // Save train positions periodically and when the page is hidden.
  setInterval(() => saveToStorage(game.world), 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveToStorage(game.world);
  });

  const listen = (x: number, z: number): [number, number] => {
    // Volume falls off with distance from the camera's focus; pan follows screen position.
    const t = game.controls.target;
    const cam = game.camera.position;
    const d = Math.hypot(x - t.x, z - t.z) + cam.distanceTo(t) * 0.35;
    const volume = Math.min(1, 500 / (d + 150));
    const right = { x: Math.cos(game.camera.rotation.y), z: -Math.sin(game.camera.rotation.y) };
    const pan = ((x - t.x) * right.x + (z - t.z) * right.z) / 900;
    return [volume, pan];
  };
  const carPoint = (trainId: number, bogie = 0) => game.sim.getTrain(trainId)?.world[bogie];
  /** Where a depot's crane works (world plan point). */
  const depotPoint = (depotId: number) => {
    const d = game.economy.depot(depotId);
    const p = d && game.layout.getPiece(d.pieceId);
    if (!d || !p) return null;
    return { x: p.pose.x + Math.cos(p.pose.heading) * d.craneAt, z: p.pose.z + Math.sin(p.pose.heading) * d.craneAt };
  };
  let sawClock = 0;
  let shownDelivered = new Map<number, number>();
  /** Update a town's sign when its delivery count changes (made once: called every frame). */
  const showDelivered = (n: number, townId: number) => {
    if (shownDelivered.get(townId) === n) return;
    shownDelivered.set(townId, n);
    game.landscapeView.setDelivered(townId, n);
  };

  // Performance overlay (backtick).
  let fps = 60;
  window.addEventListener("keydown", (e) => {
    if (e.key === "`") hud.perf.hidden = !hud.perf.hidden;
    if (e.key === " " && (e.target as HTMLElement).tagName !== "BUTTON") {
      e.preventDefault();
      game.paused = !game.paused;
      hud.setPaused(game.paused);
    }
  });
  /**
   * The opening view: straight onto the first train or, on a bare map, the first two towns, with a hint to join them.
   */
  function openingView(): void {
    const id = game.sim.trainIds()[0];
    const t = id !== undefined ? game.sim.getTrain(id) : undefined;
    if (t) {
      const a = t.world[0];
      const b = t.world[t.world.length - 1];
      const radius = Math.hypot(a.x - b.x, a.z - b.z) / 2 + 90;
      game.lookAt(new Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2), Math.max(700, frameDistance(radius, game.camera.fov, game.camera.aspect)), 1.0);
      return;
    }
    const [a, b] = game.landscape.towns;
    if (!a || !b) return;
    const radius = Math.hypot(a.centre.x - b.centre.x, a.centre.z - b.centre.z) / 2 + 140;
    game.lookAt(new Vector3((a.centre.x + b.centre.x) / 2, 0, (a.centre.z + b.centre.z) / 2), frameDistance(radius, game.camera.fov, game.camera.aspect), 0.95);
    // A bare map: suggest the first job.
    if (game.layout.pieceCount === game.stations.size + game.depots.size) {
      window.setTimeout(() => {
        if (game.layout.pieceCount === game.stations.size + game.depots.size) hud.toast(`Join ${a.name} and ${b.name} with track`, false, 6000);
      }, 1200);
    }
  }
  const skipGlide = () => {
    if (game.director.busy) game.director.cancel();
  };
  window.addEventListener("pointerdown", skipGlide, { capture: true });
  window.addEventListener("keydown", skipGlide, { capture: true });

  game.onFrame = (dt) => {
    interaction.refreshDepotCard();
    interaction.tick(dt);
    let hum = 0;
    for (const e of game.events) {
      const p = carPoint(e.kind === "turned" ? e.newTrainId : e.trainId, e.kind === "joint" ? e.bogie : 0);
      if (!p) continue;
      if (e.kind === "turned") {
        audio.rotate();
        continue;
      }
      const [v, pan] = listen(p.x, p.z);
      if (e.kind === "joint") audio.clack(v, pan);
      else if (e.kind === "coupled") audio.magnet(v, pan);
      else if (e.kind === "derailed") audio.crash(v, pan);
      else if (e.kind === "buffer") audio.magnet(v * 0.6, pan);
    }
    for (const id of game.sim.trainIds()) {
      const t = game.sim.getTrain(id)!;
      if (t.derailed || t.speed < 5 || !t.cars.some((c) => c.kind === "engine" && c.lever !== 0)) continue;
      hum += listen(t.world[0].x, t.world[0].z)[0];
    }
    audio.setHum(game.paused ? 0 : hum);

    // Cranes: a clunk per unit, and a chime when planks reach a town. Saws buzz while they cut.
    for (const e of game.economy.drainEvents()) {
      const at = depotPoint(e.depotId);
      if (!at) continue;
      const [v, pan] = listen(at.x, at.z);
      audio.clunk(v, pan);
      if (e.kind === "unloaded" && game.economy.depot(e.depotId)?.role === "town") audio.chime();
    }
    sawClock += dt;
    if (sawClock > 0.5 && !game.paused) {
      sawClock = 0;
      for (const d of game.economy.allDepots()) {
        if (d.role !== "sawmill" || !game.economy.working(d)) continue;
        const at = depotPoint(d.id);
        if (at) audio.saw(...listen(at.x, at.z));
      }
    }
    // Delivery counts on the town signs.
    game.economy.delivered.forEach(showDelivered);
    let derailed = false;
    for (const id of game.sim.trainIds()) if (game.sim.getTrain(id)?.derailed) derailed = true;
    hud.setRerailVisible(derailed);
    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    if (!hud.perf.hidden) {
      const info = game.renderer.info.render;
      hud.perf.textContent = `${fps.toFixed(0)} fps · sim ${game.simMs.toFixed(2)} ms · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ${game.layout.pieceCount} pieces · ${qualityFor(game.quality.tier).tier}`;
    }
  };

  hud.setHistory(false, false);
  updateConnections(false);
  (window as unknown as { woodrail: unknown }).woodrail = Object.assign(game, { editor: () => editor, hud, interaction });
  openingView();
  game.start();
  loading?.classList.add("done");
}

// Let the loading screen paint before the heavy texture and geometry generation.
requestAnimationFrame(() => setTimeout(boot, 30));
