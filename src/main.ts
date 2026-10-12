import { Group, Mesh, Vector3 } from "three";
import { ToyAudio } from "./audio/audio";
import { Editor } from "./editor/editor";
import { frameDistance } from "./game/camera-director";
import { Game, type GameWorld } from "./game/game";
import { Interaction } from "./game/interaction";
import { buildStarterWorld, createWorld, landForSale, plotsForSale } from "./game/world";
import { connectedPairs, PLOT_DEPTH, PLOT_WIDTH, SURF_RIVER, type Landscape, type PlotCoord } from "./landscape";
import { loadLastMode, saveLastMode, type GameMode } from "./game/modes";
import { hasSave, loadFromStorage, loadGoals, saveGoals, saveToStorage } from "./persist/save";
import { GoalTracker } from "./game/goals";
import { GoalsPanel } from "./ui/goals-panel";
import { qualityFor, saveQualityOverride } from "./render/quality";
import { renderThumbnails, ThumbnailStudio, type ThumbnailSubject } from "./render/thumbnails";
import { loadCached, saveCached } from "./render/piece-cache";
import { TrackView } from "./render/track-view";
import { PIECE_TYPES } from "./track";
import { Hud } from "./ui/hud";
import { TRACK_ITEMS, TRAIN_ITEMS, trayKey, type LandTool, type TrayItem } from "./ui/tray-catalogue";
import { LAND_MESSAGES, plotSlotOf, setHeights } from "./landscape/edit";
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
  /** An editor for the world's track and props (props-only edits skip the track's work). */
  const makeEditor = () => {
    const ed = new Editor(game.layout, game.sim, () => onChange(), isFixedPiece);
    ed.onLandChange = (slots) => {
      game.editLand(slots);
      scheduleSave();
    };
    ed.onPropsChange = () => {
      game.propsChanged();
      hud.setHistory(ed.canUndo, ed.canRedo);
      scheduleSave();
    };
    return ed;
  };
  let editor = makeEditor();
  let saveTimer = 0;
  let interaction: Interaction;
  const audio = new ToyAudio();
  let muted = loadMuted();
  audio.setMuted(muted);
  // Tray pictures: saved from an earlier visit to this build, or drawn now (and saved for next time).
  const trayItems = [...TRACK_ITEMS, ...TRAIN_ITEMS];
  const thumbnails = new Map(savedThumbnails ?? []);
  const unseen = trayItems.filter((item) => !thumbnails.has(trayKey(item)));
  if (unseen.length > 0) {
    const drawn = renderThumbnails(
      game.renderer,
      game.mats,
      unseen.flatMap((item): ThumbnailSubject[] =>
        item.kind === "piece"
          ? [{ key: trayKey(item), kind: "piece" as const, type: item.type }]
          : item.kind === "train"
            ? [{ key: trayKey(item), kind: "train" as const, cars: item.cars, looks: item.looks }]
            : [],
      ),
    );
    for (const [k, v] of drawn) thumbnails.set(k, v);
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
        openingView();
      },
      toggleExpand: () => setExpanding(!expanding),
      buyLand: () => buyLand(),
      newGame: () => newGame(),
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
      needThumbnails: (items) => drawPropThumbnails(items),
      landTool: (tool) => setLandTool(tool),
    },
    () => (game.quality.tier === "high" ? "High" : "Battery saver"),
    { thumbnails, muted },
  );

  // Catalogue models' tray pictures: drawn when their shelf is first shown, one a frame (each builds the model, if it
  // isn't yet), then kept with the start-up pictures for the next visit.
  const thumbQueue: string[] = [];
  let studio: ThumbnailStudio | null = null;
  let thumbSaveTimer = 0;
  function drawPropThumbnails(items: TrayItem[]): void {
    const idle = thumbQueue.length === 0;
    for (const item of items) if (item.kind === "prop" && !thumbQueue.includes(item.asset)) thumbQueue.push(item.asset);
    if (idle && thumbQueue.length > 0) requestAnimationFrame(nextThumbnail);
  }
  function nextThumbnail(): void {
    const asset = thumbQueue[0];
    if (asset === undefined) return;
    void game.propLibrary.load(asset).then((model) => {
      thumbQueue.shift();
      if (model) {
        studio ??= new ThumbnailStudio(game.renderer);
        const subject = new Group();
        for (const part of model.parts) subject.add(new Mesh(part.geometry, part.material));
        subject.rotation.y = -0.6;
        const url = studio.shoot(subject);
        const key = `prop:${asset}`;
        hud.setThumbnail(key, url);
        thumbnails.set(key, url);
        clearTimeout(thumbSaveTimer);
        thumbSaveTimer = window.setTimeout(() => void saveCached("thumbnails", __BUILD_ID__, thumbnails), 2000);
      }
      if (thumbQueue.length > 0) requestAnimationFrame(nextThumbnail);
    });
  }

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
    if (on) hud.chooseLandTool(null);
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

  // Land editing (the Land tab): a tool chosen, and taps on the land use it.
  let landTool: LandTool | null = null;
  function setLandTool(tool: LandTool | null): void {
    landTool = tool;
    if (tool && expanding) setExpanding(false);
    interaction.landCursor = tool === "raise" ? "#7ddc58" : tool === "lower" ? "#ffd27a" : null;
    interaction.landMove = tool === "move";
    if (tool !== "raise" && tool !== "lower") interaction.showSquare(-1);
    if (tool !== "move") {
      interaction.clearSelection();
      hud.hideCards();
    }
  }

  /** Raise or lower the square at a screen point a block (one undo step), or say why not. */
  function editSquare(x: number, y: number): void {
    const i = interaction.squareAt(x, y);
    if (i === -1 || (landTool !== "raise" && landTool !== "lower")) return;
    const step = landTool === "raise" ? 1 : -1;
    const g = game.landscape.grid;
    const before = g.height[i];
    const why = interaction.landEditor().apply(i, step);
    if (why) {
      hud.toast(LAND_MESSAGES[why]);
      audio.refuse();
      hud.haptic("refuse");
      return;
    }
    const slots = [plotSlotOf(i)];
    const t0 = performance.now();
    game.editLand(slots);
    console.info(`Woodrail: land edit redrawn in ${Math.round(performance.now() - t0)} ms`);
    editor.recordLand({ do: () => setHeights(game.landscape, new Map([[i, before + step]])), undo: () => setHeights(game.landscape, new Map([[i, before]])), slots: () => slots });
    audio.putdown(true);
    interaction.showSquare(i);
  }

  interaction.onFloorTap = (ground, x, y) => {
    if (landTool === "move") {
      interaction.selectSceneryAt(x, y);
      return true;
    }
    if (landTool) {
      editSquare(x, y);
      return true;
    }
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
    editor = makeEditor();
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
    checkGoals(true);
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
    // The land as it is now (it may have grown), within the camera's reach.
    const e = game.landscape.grid.extent();
    const radius = Math.hypot(e.x1 - e.x0, e.z1 - e.z0) / 2;
    const distance = Math.min(frameDistance(radius * 0.8, game.camera.fov, game.camera.aspect), game.controls.maxDistance);
    game.director.glideTo(new Vector3((e.x0 + e.x1) / 2, 0, (e.z0 + e.z1) / 2), distance, { phi: 0.9, duration: 1.4 });
    pausedBeforeTitle = game.paused;
    game.paused = true;
    title.show({ sandbox: hasSave("sandbox"), game: hasSave("game") });
  }

  // Game mode's goals: checked about once a second and after every change to the track.
  let goals = new GoalTracker(loadGoals());
  const goalsPanel = new GoalsPanel(hud.root, { newGame: () => newGame() });
  /** When goals were last checked (wall-clock ms: frame times are capped, so slow frames would stretch a dt sum). */
  let goalsCheckedAt = 0;
  function checkGoals(announce: boolean): void {
    if (mode !== "game" || !playing) return;
    const fresh = goals.update(game.world);
    if (fresh.length > 0) {
      saveGoals(goals.ids());
      if (announce) {
        hud.toast(`✓ ${fresh.map((g) => g.title).join(" · ")}`, true, 3200);
        audio.chime();
        goalsPanel.celebrate();
      }
    }
    const current = goals.current();
    goalsPanel.show(goals.doneCount, current, current ? current.check(game.world) : null, goals.next());
  }

  function resetGoals(): void {
    goals = new GoalTracker();
    saveGoals([]);
    goalsPanel.reset();
  }

  /** Game mode, in play: start again on the starter map with no goals done. */
  function newGame(): void {
    resetGoals();
    setWorld(buildStarterWorld());
    save();
    openingView();
  }

  /** Leave the title for a mode: carry on with its railway, or start it afresh. */
  function play(next: GameMode, fresh: boolean): void {
    if (fresh && next === "game") resetGoals();
    if (fresh) setWorld(next === "game" ? buildStarterWorld() : createWorld(Math.floor(Math.random() * 1_000_000)));
    else if (next !== mode) {
      const saved = loadFromStorage(next);
      if (saved && !saved.ok) console.warn(`Woodrail: ignoring ${next} autosave (${saved.error})`);
      setWorld(saved?.ok ? saved.value : buildStarterWorld());
    }
    enter(next);
    openingView();
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
    // Town houses and placed models can be moved in Sandbox only.
    interaction.propsEditable = mode === "sandbox";
    hud.setVisible(true);
    playing = true;
    save();
    goalsPanel.setVisible(mode === "game");
    checkGoals(false);
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
    const now = performance.now();
    if (now - goalsCheckedAt > 1000) {
      goalsCheckedAt = now;
      checkGoals(true);
    }
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
    openingView();
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
