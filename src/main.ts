import { Vector3 } from "three";
import { ToyAudio } from "./audio/audio";
import { Editor } from "./editor/editor";
import { frameDistance } from "./game/camera-director";
import { Game, type GameWorld } from "./game/game";
import { Interaction } from "./game/interaction";
import { buildStarterWorld, createWorld } from "./game/world";
import { connectedPairs, MAT_DEPTH, MAT_WIDTH } from "./landscape";
import { loadLastMode, saveLastMode, type GameMode } from "./game/modes";
import { hasSave, loadFromStorage, saveToStorage } from "./persist/save";
import { qualityFor, saveQualityOverride } from "./render/quality";
import { renderThumbnails } from "./render/thumbnails";
import { loadCached, saveCached } from "./render/piece-cache";
import { TrackView } from "./render/track-view";
import { PIECE_TYPES } from "./track";
import { Hud, TRACK_ITEMS, TRAIN_ITEMS, trayKey } from "./ui/hud";
import { loadMuted, saveMuted } from "./ui/prefs";
import { TitleScreen } from "./ui/title";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const loading = document.querySelector<HTMLDivElement>("#loading");

/** A map asked for in the link (`#seed-12345`), to share or replay a particular map. */
function linkedSeed(): number | null {
  const m = /^#seed-(\d{1,9})$/.exec(location.hash);
  return m ? Number(m[1]) : null;
}

/**
 * The world to open with. A linked map opens in Sandbox (fresh, unless the sandbox autosave is already that map, so
 * reloading keeps your track); otherwise the last mode's autosave, or the starter map.
 */
function initialWorld(): { world: GameWorld; mode: GameMode; linked: boolean } {
  const seed = linkedSeed();
  const mode = seed !== null ? "sandbox" : loadLastMode();
  const saved = loadFromStorage(mode);
  if (saved && !saved.ok) console.warn(`Woodrail: ignoring ${mode} autosave (${saved.error})`);
  if (seed !== null) {
    const same = saved?.ok && saved.value.landscape.seed === seed && !saved.value.landscape.starter;
    return { world: same ? saved.value : createWorld(seed), mode, linked: true };
  }
  return { world: saved?.ok ? saved.value : buildStarterWorld(), mode, linked: false };
}

function boot(savedThumbnails: Map<string, string> | null): void {
  const opening = initialWorld();
  const game = new Game(canvas, opening.world);
  let mode = opening.mode;
  // Stations and depots never shift to take up joint play.
  const isFixedPiece = (id: number): boolean => [...game.stations.values(), ...game.depots.values()].includes(id);
  let editor = new Editor(game.layout, game.sim, () => onChange(), isFixedPiece);
  let saveTimer = 0;
  let interaction: Interaction;
  const audio = new ToyAudio();
  let muted = loadMuted();
  audio.setMuted(muted);
  // Tray pictures: saved from an earlier visit to this build, or drawn now (and saved for next time).
  const trayItems = [...TRACK_ITEMS, ...TRAIN_ITEMS];
  let thumbnails = savedThumbnails;
  if (!thumbnails || trayItems.some((item) => !thumbnails!.has(trayKey(item)))) {
    thumbnails = renderThumbnails(
      game.renderer,
      game.mats,
      trayItems.map((item) =>
        item.kind === "piece" ? { key: trayKey(item), kind: "piece" as const, type: item.type } : { key: trayKey(item), kind: "train" as const, cars: item.cars, looks: item.looks },
      ),
    );
    void saveCached("thumbnails", __BUILD_ID__, thumbnails);
  }

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
        flyIn(0.2);
      },
      newGame: () => {
        setWorld(buildStarterWorld());
        save();
        flyIn(0.2);
      },
      titleScreen: () => showTitle(),
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

  function setWorld(world: GameWorld): void {
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
    saveTimer = window.setTimeout(save, 600);
  }

  /** Save the railway under its mode (not while the title screen shows it turning behind: nothing is being played). */
  function save(): void {
    if (playing) saveToStorage(game.world, mode);
  }
  /** False while the title is up. */
  let playing = false;

  // Save train positions periodically and when the page is hidden.
  setInterval(save, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });

  const title = new TitleScreen(document.body, { play }, { thumbnails });

  /** Paused or not when the title came up (the game pauses behind the title, so the still backdrop costs nothing). */
  let pausedBeforeTitle = false;

  /** Save, then show the title over a still, wide view of the map. */
  function showTitle(): void {
    save();
    playing = false;
    clearTimeout(saveTimer);
    interaction.clearSelection();
    hud.hideCards();
    hud.setVisible(false);
    game.follow(-1);
    const radius = Math.hypot(MAT_WIDTH, MAT_DEPTH) / 2;
    game.director.glideTo(new Vector3(0, 0, 0), frameDistance(radius * 0.8, game.camera.fov, game.camera.aspect), { phi: 0.9, duration: 1.4 });
    pausedBeforeTitle = game.paused;
    game.paused = true;
    title.show({ sandbox: hasSave("sandbox"), game: hasSave("game") });
  }

  /** Leave the title for a mode: carry on with its railway, or start it afresh. */
  function play(next: GameMode, fresh: boolean): void {
    if (fresh) setWorld(next === "game" ? buildStarterWorld() : createWorld(Math.floor(Math.random() * 1_000_000)));
    else if (next !== mode) {
      const saved = loadFromStorage(next);
      if (saved && !saved.ok) console.warn(`Woodrail: ignoring ${next} autosave (${saved.error})`);
      setWorld(saved?.ok ? saved.value : buildStarterWorld());
    }
    enter(next);
    flyIn(0.1);
  }

  /** Start playing a mode on the world now loaded. */
  function enter(next: GameMode): void {
    mode = next;
    saveLastMode(mode);
    title.hide();
    game.director.cancel();
    game.paused = pausedBeforeTitle;
    hud.setPaused(game.paused);
    hud.setMode(mode);
    hud.setVisible(true);
    playing = true;
    save();
    hud.firstVisitHelp();
  }

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
    if (e.key === " " && !title.shown && (e.target as HTMLElement).tagName !== "BUTTON") {
      e.preventDefault();
      game.paused = !game.paused;
      hud.setPaused(game.paused);
    }
  });
  /**
   * The opening shot: glide from the whole mat down to the first train (following it as it sets off) or, on a bare
   * map, to the first two towns with a hint to join them. Any input skips it.
   */
  function flyIn(delay: number): void {
    const id = game.sim.trainIds()[0];
    if (id !== undefined && game.sim.getTrain(id)) {
      // The middle of the train, wherever it has got to.
      const middle = (out: Vector3): boolean => {
        const t = game.sim.getTrain(id);
        if (!t) return false;
        const a = t.world[0];
        const b = t.world[t.world.length - 1];
        out.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        return true;
      };
      const t = game.sim.getTrain(id)!;
      const radius = Math.hypot(t.world[0].x - t.world[t.world.length - 1].x, t.world[0].z - t.world[t.world.length - 1].z) / 2 + 90;
      const centre = new Vector3();
      middle(centre);
      game.director.glideTo(centre, Math.max(700, frameDistance(radius, game.camera.fov, game.camera.aspect)), { phi: 1.0, duration: 2.6, delay, track: middle });
      return;
    }
    const [a, b] = game.landscape.towns;
    if (!a || !b) return;
    const centre = new Vector3((a.centre.x + b.centre.x) / 2, 0, (a.centre.z + b.centre.z) / 2);
    const radius = Math.hypot(a.centre.x - b.centre.x, a.centre.z - b.centre.z) / 2 + 140;
    game.director.glideTo(centre, frameDistance(radius, game.camera.fov, game.camera.aspect), { phi: 0.95, duration: 2.6, delay });
    // A bare map: suggest the first job once the camera has arrived.
    if (game.layout.pieceCount === game.stations.size + game.depots.size) {
      window.setTimeout(() => {
        if (game.layout.pieceCount === game.stations.size + game.depots.size) hud.toast(`Join ${a.name} and ${b.name} with track`, false, 6000);
      }, (delay + 2.4) * 1000);
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
  (window as unknown as { woodrail: unknown }).woodrail = Object.assign(game, { editor: () => editor, hud, interaction, title, mode: () => mode });
  game.start();
  if (opening.linked) {
    enter(mode);
    flyIn(0.6);
  } else showTitle();
  loading?.classList.add("done");
}

// Let the loading screen paint, carve the track pieces in background workers (several at once), then build the rest.
requestAnimationFrame(() =>
  setTimeout(() => {
    const t0 = performance.now();
    void Promise.all([TrackView.prebuildInWorkers(PIECE_TYPES), loadCached<Map<string, string>>("thumbnails", __BUILD_ID__)]).then(([, thumbs]) => {
      console.info(`Woodrail: track pieces ready in ${Math.round(performance.now() - t0)} ms`);
      boot(thumbs);
    });
  }, 30),
);
