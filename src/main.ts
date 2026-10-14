import { Group, Mesh, Spherical, Vector3, type Object3D } from "three";
import { ToyAudio } from "./audio/audio";
import { Editor, pieceCentre } from "./editor/editor";
import { frameDistance } from "./game/camera-director";
import { Game, type GameWorld } from "./game/game";
import { Interaction } from "./game/interaction";
import { buildStarterWorld, createWorld, freshGameWorld, landForSale, plotsForSale } from "./game/world";
import { CELL, connectedPairs, fixedHome, PLOT_DEPTH, PLOT_WIDTH, SURF_RIVER, type Landscape, type PlotCoord } from "./landscape";
import { loadLastBuilt, loadLastMode, saveLastBuilt, saveLastMode, type GameMode } from "./game/modes";
import { hasSave, loadFromStorage, loadGoals, loadProgress, saveGoals, saveProgress, saveToStorage, serializeWorld } from "./persist/save";
import { reporter, startLog, type Reporter } from "./debug/report";
import { GoalTracker } from "./game/goals";
import { GoalsPanel } from "./ui/goals-panel";
import { loadBlenderModels, loadModelSet } from "./render/blender-models";
import { LoadingToys, type Shelf } from "./ui/loading-toys";
import { goalMarks, SQUARE_RING } from "./render/goal-marks";
import { TownLife } from "./game/town-life";
import { plotPrice } from "./game/towns";
import { offerOnGrowth, payDelivery } from "./game/rewards";
import { mapMarkers, type MapMarker } from "./game/map-markers";
import { MapView } from "./ui/map-view";
import { Progress } from "./game/progress";
import { Crafting, workshops, workshopStock } from "./game/crafting";
import { isFree, ruleOf, THING_RULES, thingsFor, type ThingId } from "./game/things";
import { syncIndustries, INDUSTRY_ROLE } from "./game/world";
import { siteWhy, updateRates } from "./game/industries";
import { WorkshopPanel, type MakeRow } from "./ui/workshop-panel";
import { deliveryStops, nextStop } from "./game/delivery";
import { BlueprintBoard, type Station } from "./ui/blueprint-board";
import { pieceIcon, trainIcon } from "./ui/icons";
import { choose as chooseTech, learnWithGoods, ready, TECHS, techOf, unlocksOf } from "./game/tech";
import { aOrAn, covers, describe as describeGoods, minus } from "./economy/goods";
import { qualityFor, saveQualityOverride } from "./render/quality";
import { renderThumbnails, ThumbnailStudio, type ThumbnailSubject } from "./render/thumbnails";
import { loadCached, saveCached } from "./render/piece-cache";
import { TrackView } from "./render/track-view";
import { PIECE_TYPES, type Anchor, type PieceTypeId } from "./track";
import type { CarKind } from "./sim";
import { Hud } from "./ui/hud";
import { INDUSTRY_GROUPS, TRACK_ITEMS, TRAIN_ITEMS, trayKey, type LandTool, type TrayItem } from "./ui/tray-catalogue";
import { LAND_MESSAGES, plotSlotOf, setHeights } from "./landscape/edit";
import { loadMuted, saveMuted } from "./ui/prefs";
import { TitleScreen } from "./ui/title";
import "./style.css";

/** How far (mm) the opening view stands from where track was last built: the middle of the zoom range. */
const OPENING_DISTANCE = 1000;

/** How far a station or depot may turn when it gives (radians). */
const GIVE_TURN = (4 * Math.PI) / 180;

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

startLog();
/** Where "Send to Claude" reports go (the dev server, or the claude.ai page), or null: no menu item. */
let reports: Reporter | null = null;

function boot(savedThumbnails: Map<string, string> | null): void {
  const opening = initialWorld();
  const game = new Game(canvas, opening.world);
  let mode = opening.mode;
  // Stations and depots never shift to take up joint play.
  const isFixedPiece = (id: number): boolean => [...game.stations.values(), ...game.depots.values()].includes(id);
  /** An editor for the world's track and props (props-only edits skip the track's work). */
  /**
   * Stations and depots give a little (half a square, a few degrees) from where the map put them, as wooden track
   * does when pushed, so track closing on one needn't meet it exactly.
   */
  const stationGive = (id: number): Anchor | null => {
    const land = game.landscape;
    for (const t of land.towns) if (game.stations.get(t.id) === id) return { home: fixedHome(t.centre, t.station.heading), reach: CELL / 2, turn: GIVE_TURN };
    for (const d of land.depots) if (game.depots.get(d.id) === id) return { home: fixedHome(d.centre, d.piece.heading), reach: CELL / 2, turn: GIVE_TURN };
    return null;
  };
  /** A station or depot was nudged: the map's record of it follows, and its buildings and yard are redrawn. */
  const stationsNudged = (ids: number[]) => {
    const land = game.landscape;
    const slots = new Set<number>();
    for (const id of ids) {
      const pose = game.layout.getPiece(id)?.pose;
      if (!pose) continue;
      const town = land.towns.find((t) => game.stations.get(t.id) === id);
      const depot = land.depots.find((d) => game.depots.get(d.id) === id);
      if (town) town.station = { ...pose };
      if (depot) depot.piece = { ...pose };
      const i = land.grid.cellAtWorld(pose.x, pose.z);
      if (i !== -1) slots.add(plotSlotOf(i));
    }
    game.editLand([...slots]);
    game.depotView.setWorld(game.economy, game.layout);
  };
  const makeEditor = () => {
    const ed = new Editor(game.layout, game.sim, () => onChange(), isFixedPiece, stationGive);
    ed.onNudge = stationsNudged;
    ed.onTrackEdit = (ids) => {
      const id = ids.find((i) => game.layout.getPiece(i));
      if (id !== undefined) saveLastBuilt(mode, pieceCentre(game.layout, id));
    };
    ed.onLandChange = (slots) => {
      game.editLand(slots);
      scheduleSave();
    };
    ed.onRoadsChange = (slots, trees) => {
      game.roadsEdited(slots, trees);
      hud.setHistory(ed.canUndo, ed.canRedo);
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
  const trayItems = [...TRACK_ITEMS, ...TRAIN_ITEMS, ...INDUSTRY_GROUPS.flatMap((g) => g.items)];
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
      (type) => (INDUSTRY_ROLE[type] ? game.depotView.model(INDUSTRY_ROLE[type]) : null),
    );
    for (const [k, v] of drawn) thumbnails.set(k, v);
    void saveCached("thumbnails", __BUILD_ID__, thumbnails);
  }

  const hud = new Hud(
    document.body,
    {
      trayPointerDown: (item, e) => {
        if (trayAllowed(item)) interaction.startTrayDrag(item, e);
      },
      trayTap: (item) => {
        if (trayAllowed(item)) interaction.tapTrayPiece(item);
      },
      trayTabChanged: () => interaction.arm(null),
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
      selectMore: () => interaction.selectMore(),
      selectJoined: () => interaction.selectJoined(),
      doneSelecting: () => interaction.doneSelecting(),
      newLayout: () => {
        saveLastBuilt(mode, null);
        setWorld(createWorld(Math.floor(Math.random() * 1_000_000)));
        game.frameLayout();
      },
      resetStarter: () => {
        saveLastBuilt(mode, null);
        setWorld(buildStarterWorld());
        game.frameLayout();
        openingView();
      },
      toggleExpand: () => setExpanding(!expanding),
      toggleMap: () => (mapView.open ? closeMap(true) : openMap()),
      toggleBoard: () => setBoardOpen(!board.open),
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
        interaction.turnTrayPiece(hud.propsTab);
        hud.setTrayOrientation(interaction.trayFlipped);
      },
      trayFlip: () => {
        interaction.flipTrayPiece();
        hud.setTrayOrientation(interaction.trayFlipped);
      },
      depotWaitFull: () => interaction.toggleDepotWaitFull(),
      needThumbnails: (items) => drawPropThumbnails(items),
      landTool: (tool) => setLandTool(tool),
      sendReport: async (text) => {
        if (!reports) throw new Error("reports aren't available here");
        const picture = await game.capture();
        const c = game.camera.position;
        const t = game.controls.target;
        const state = {
          mode,
          seed: game.landscape.seed,
          view: { camera: [c.x, c.y, c.z].map(Math.round), target: [t.x, t.y, t.z].map(Math.round) },
          screen: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, pixelRatio: game.renderer.getPixelRatio(), touch: matchMedia("(pointer: coarse)").matches },
          quality: game.quality.tier,
          counts: { pieces: game.layout.pieceCount, trains: game.sim.trainIds().length, props: game.props.size },
          hand: interaction.debugState(),
          userAgent: navigator.userAgent,
        };
        await reports.send(text, state, serializeWorld(game.world), picture);
      },
    },
    () => (game.quality.tier === "high" ? "High" : "Battery saver"),
    { thumbnails, muted },
  );
  // "Send to Claude", where reports can go (resolved after start-up: on claude.ai the page's capabilities answer later).
  void reporter().then((r) => {
    reports = r;
    if (r) hud.enableReports();
  });

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
  game.keysTaken = () => interaction.piecesTakeKeys;
  interaction.onArmed = (item) => hud.setArmed(item ? trayKey(item) : null);
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
    const price = plotPrice(game.landscape.grid.plots.length);
    const priced = mode === "game" ? ` · ${price} coins (you have ${progress.coins})` : "";
    hud.setLandCard(describeLand(landForSale(game.landscape, p.px, p.pz)) + priced, mode !== "game" || progress.coins >= price);
    game.invalidate();
    return true;
  };

  function buyLand(): void {
    if (!chosen) return;
    // Game mode: land costs coins.
    const price = plotPrice(game.landscape.grid.plots.length);
    if (mode === "game") {
      if (progress.coins < price) {
        hud.toast(`That land costs ${price} coins: you have ${progress.coins}. Towns pay for deliveries`, false, 3600);
        return;
      }
      progress.coins -= price;
      hud.setCoins(progress.coins);
    }
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
    // After the first connection, point at the next thing to try (once, and only if there's no timber train yet). Game
    // mode's goals do this there.
    if (!timberHinted && mode === "sandbox" && game.landscape.depots.length > 0) {
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
    industriesChanged();
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
    if (!playing) return;
    saveToStorage(game.world, mode);
    if (mode === "game") saveProgress(progress.toJSON());
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
    closeMap(false);
    setBoardOpen(false);
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
  const goalsPanel = new GoalsPanel(hud.root, { newGame: () => newGame(), showMe: () => showGoal() });

  // Game mode's towns: they want things, and grow when they get them.
  const townLife = new TownLife(game, {
    received: (_town, kind, n, before) => {
      payDelivery(progress, kind, n, before);
      hud.setCoins(progress.coins);
    },
    grew: (town, status, built) => {
      // Its new houses may have felled trees a harvester counted.
      industriesChanged();
      const level = aOrAn(status.name.toLowerCase());
      hud.toast(built.length > 0 ? `${town.name} grew into ${level}!` : `${town.name} is now ${level}, but has no room to build`, true, 3600);
      audio.chime();
      // A town that grows offers two blueprints to choose from (one learned free).
      if (offerOnGrowth(progress, town.name, Math.random).length > 0) {
        hud.toast(`${town.name} offers you a blueprint: open Blueprints to choose`, false, 4200);
        refreshBoard();
        scheduleSave();
      }
      game.flourishes.add(game.landscapeView.flash([town.id]));
      const grid = game.landscape.grid;
      const marks = goalMarks(
        game.scene,
        built.map((p) => {
          const i = grid.cellAtWorld(p.x, p.z);
          return { ...p, y: i < 0 ? 0 : grid.groundY(i) };
        }),
        SQUARE_RING,
      );
      if (marks) game.flourishes.add(marks);
      game.invalidate();
    },
  });
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

  // Game mode's toy box and workshop: what you own (worked out against what's on the map), and what's being made.
  let progress = loadProgress() === undefined ? Progress.fresh() : Progress.fromJSON(loadProgress());
  const crafting = new Crafting(progress);
  crafting.setProgress(progress);
  const thingLabel = (id: ThingId) => ruleOf(id)?.label ?? id;

  /** Game mode: can this tray item come out (known, and enough of it in the toy box)? Says why not if not. */
  function trayAllowed(item: Parameters<typeof thingsFor>[0] | { kind: string }): boolean {
    if (mode !== "game" || (item.kind !== "piece" && item.kind !== "train")) return true;
    const short = progress.short(game.world, thingsFor(item as Parameters<typeof thingsFor>[0]));
    if (!short) return true;
    const rule = ruleOf(short)!;
    if (!progress.knows(short)) hud.toast(`${rule.label}: not learned yet`);
    else if (workshops(game.world).length === 0) hud.toast(`No ${rule.label.toLowerCase()} left. Place your workshop (Industries tab) to make more`, false, 3600);
    else hud.toast(`No ${rule.label.toLowerCase()} left. Make one at the workshop: ${describeGoods(rule.cost)}`, false, 3600);
    return false;
  }

  /** The toy box on the tray (Game mode): how many of each are left. */
  function trayBadge(item: Parameters<typeof thingsFor>[0] | { kind: string }): { text: string; empty: boolean } | null {
    if (item.kind !== "piece" && item.kind !== "train") return null;
    const needs = thingsFor(item as Parameters<typeof thingsFor>[0]);
    if ([...needs.keys()].every(isFree)) return null;
    if ([...needs.keys()].some((id) => !progress.knows(id))) return { text: "Locked", empty: true };
    let n = Infinity;
    for (const [id, k] of needs) n = Math.min(n, Math.floor(progress.available(game.world, id) / k));
    return { text: String(n), empty: n === 0 };
  }

  /** Industries placed or moved: give new ones their depots, and redraw the yards where they stand. */
  let industryKey = "";
  function industriesChanged(): void {
    const added = syncIndustries(game.world);
    let key = "";
    for (const id of game.layout.pieceIds()) {
      const p = game.layout.getPiece(id)!;
      if (INDUSTRY_ROLE[p.type]) key += `${id}:${p.pose.x},${p.pose.z},${p.pose.heading};`;
    }
    if (added || key !== industryKey) game.depotView.setWorld(game.economy, game.layout);
    industryKey = key;
    // Industries work as fast as what's around them allows: recounted when they move or the land changes.
    const rateKey = `${key}#${game.landscape.grid.revision}`;
    if (rateKey !== rateKeyShown) {
      rateKeyShown = rateKey;
      if (updateRates(game.world)) game.invalidate();
    }
    hud.refreshTrayBadges();
  }
  let rateKeyShown = "";

  const workshopPanel = new WorkshopPanel(hud.depotExtra, {
    order: (id) => {
      crafting.order(id);
      showWorkshop(true);
      scheduleSave();
    },
    cancel: (id) => {
      crafting.cancel(id);
      showWorkshop(true);
      scheduleSave();
    },
  });
  // The blueprint board: choices from towns that grew, blueprints to learn with planks, and the rest of the tree.
  const board = new BlueprintBoard(document.body, {
    choose: (k, id) => {
      const o = progress.offers[k];
      if (!o || !chooseTech(progress, id, o.ids)) return;
      progress.offers.splice(k, 1);
      learned(id);
    },
    learn: (id) => {
      if (learnWithGoods(game.world, progress, id)) learned(id);
      else hud.toast(`Bring ${describeGoods(techOf(id)!.cost)} to the workshop to learn ${techOf(id)!.label.toLowerCase()}`, false, 3600);
    },
    close: () => setBoardOpen(false),
  });

  function learned(id: string): void {
    const makes = unlocksOf(id).map((t) => ruleOf(t)!.label.toLowerCase());
    hud.toast(`Learned ${techOf(id)!.label.toLowerCase()}! Make ${makes.slice(0, 2).join(" and ")}${makes.length > 2 ? " and more" : ""} at the workshop`, true, 3800);
    audio.chime();
    hud.refreshTrayBadges();
    game.invalidate();
    refreshBoard();
    save();
  }

  function setBoardOpen(open: boolean): void {
    if (open && mapView.open) closeMap(false);
    board.setOpen(open);
    hud.root.classList.toggle("board-open", open);
    if (open) {
      interaction.clearSelection();
      hud.hideCards();
    }
    refreshBoard();
  }

  function refreshBoard(): void {
    hud.setBoardButton(board.open, progress.offers.length > 0);
    if (!board.open) return;
    const stock = workshopStock(game.world);
    const offerOf = (id: string) => progress.offers.findIndex((o) => o.ids.includes(id));
    const stations: Station[] = TECHS.map((t) => {
      const makes = unlocksOf(t.id).map((x) => ({ label: ruleOf(x)!.label, icon: x.startsWith("piece:") ? pieceIcon(x.slice(6) as PieceTypeId) : trainIcon([x.slice(4) as CarKind]) }));
      const base = { id: t.id, label: t.label, blurb: t.blurb, makes, needs: [...t.needs] };
      if (progress.learned.has(t.id)) return { ...base, state: "learned" as const };
      const offer = offerOf(t.id);
      if (offer !== -1) return { ...base, state: "offered" as const, offer };
      if (progress.board.has(t.id) && ready(progress, t.id)) return { ...base, state: "ready" as const, cost: describeGoods(t.cost), planks: t.cost.planks ?? 0, affordable: covers(stock, t.cost) };
      const missing = t.needs.filter((n) => !progress.learned.has(n));
      return { ...base, state: "locked" as const, waits: missing.length > 0 ? `Learn ${missing.map((n) => techOf(n)!.label.toLowerCase()).join(" and ")} first` : "A town will offer it as it grows" };
    });
    const hasWorkshop = workshops(game.world).length > 0;
    board.show({
      stations,
      offers: progress.offers.map((o) => ({ from: o.from, ids: [...o.ids] })),
      planks: hasWorkshop ? stock.planks ?? 0 : null,
      stock: hasWorkshop ? `The workshop's yard has ${describeGoods(stock)}` : "Place your workshop first (Industries tab)",
    });
  }

  // The workshop's clock: a few times a second, not every frame (it runs while nothing on screen moves).
  const CRAFT_STEP = 0.25;
  setInterval(() => {
    if (mode === "game" && board.open) refreshBoard();
    if (mode !== "game" || !playing || game.paused || progress.orders.length === 0) return;
    const wasMaking = progress.making;
    const made = crafting.tick(game.world, CRAFT_STEP);
    showWorkshop();
    // Planks leave the yard when an order starts: draw the pile going down (only then, not on every step).
    if (made || progress.making !== wasMaking) game.invalidate();
    if (!made) return;
    hud.toast(`+1 ${thingLabel(made)} in your toy box`, true, 2400);
    audio.chime();
    hud.refreshTrayBadges();
    scheduleSave();
  }, CRAFT_STEP * 1000);
  let workshopShown = -1;
  /** Keep the workshop's card current while it's open (Game mode). */
  function showWorkshop(force = false): void {
    const id = mode === "game" ? interaction.openDepotId : -1;
    const open = id !== -1 && game.economy.depot(id)?.role === "workshop";
    if (!open) {
      if (workshopShown !== -1) workshopPanel.hide();
      workshopShown = -1;
      return;
    }
    if (workshopShown !== id || force) workshopPanel.hide();
    workshopShown = id;
    const rows: MakeRow[] = [];
    for (const tid of Object.keys(THING_RULES) as ThingId[]) {
      if (!progress.knows(tid)) continue;
      const rule = ruleOf(tid)!;
      rows.push({
        id: tid,
        label: rule.label,
        cost: describeGoods(rule.cost),
        have: progress.available(game.world, tid),
        queued: progress.orders.filter((o) => o === tid).length,
        shelf: tid.startsWith("car:") ? "Trains" : tid.includes("depot-") ? "Industries" : "Track",
      });
    }
    rows.sort((a, b) => ["Track", "Trains", "Industries"].indexOf(a.shelf) - ["Track", "Trains", "Industries"].indexOf(b.shelf));
    const now = crafting.now;
    const need = now?.waiting ? describeGoods(minus(ruleOf(now.id)!.cost, workshopStock(game.world))) : null;
    workshopPanel.show(now ? { label: thingLabel(now.id), fill: now.fill, waiting: need } : null, rows);
  }

  // Where the open engine's train delivers (both modes): a chip that steps through the stops, then back to anywhere.
  let deliverShown = "";
  function showDeliverTo(): void {
    const carId = interaction.openEngineCarId;
    if (carId === -1) {
      deliverShown = "";
      return;
    }
    const to = game.economy.deliverToOf(carId);
    const stops = deliveryStops(game.world);
    const name = stops.find((st) => st.depotId === to)?.name ?? "Anywhere";
    const key = `${carId}:${name}:${stops.length}`;
    if (key === deliverShown) return;
    deliverShown = key;
    const box = hud.engineExtra;
    box.innerHTML = "";
    box.hidden = stops.length === 0;
    const label = document.createElement("span");
    label.className = "engine-extra-label";
    label.textContent = "Deliver to";
    const chip = document.createElement("button");
    chip.className = "chip text deliver-to";
    chip.classList.toggle("active", name !== "Anywhere");
    chip.textContent = name;
    chip.title = "Where this train takes its goods (other goods still unload where they can). Anywhere: the first stop that takes them.";
    chip.addEventListener("click", () => {
      game.economy.setDeliverTo(carId, nextStop(deliveryStops(game.world), game.economy.deliverToOf(carId)));
      showDeliverTo();
      scheduleSave();
    });
    box.append(label, chip);
  }

  // The map view (Game mode): the whole land from above, with what each town wants and each depot holds.
  const mapView = new MapView(hud.root, { go: (m) => goToMarker(m), close: () => closeMap(true) });
  /** Where the camera was before the map opened, to go back to. */
  let mapReturn: { target: Vector3; distance: number; phi: number; theta: number } | null = null;
  let mapRefreshedAt = 0;

  function openMap(): void {
    if (expanding) setExpanding(false);
    if (board.open) setBoardOpen(false);
    interaction.clearSelection();
    hud.hideCards();
    game.follow(-1);
    const c = game.controls;
    const sph = new Spherical().setFromVector3(game.camera.position.clone().sub(c.target));
    mapReturn = { target: c.target.clone(), distance: sph.radius, phi: sph.phi, theta: sph.theta };
    const e = game.landscape.grid.extent();
    const radius = Math.hypot(e.x1 - e.x0, e.z1 - e.z0) / 2;
    const distance = Math.min(frameDistance(radius * 0.72, game.camera.fov, game.camera.aspect), c.maxDistance);
    game.director.glideTo(new Vector3((e.x0 + e.x1) / 2, 0, (e.z0 + e.z1) / 2), distance, { phi: 0.22, duration: 0.9 });
    mapView.setOpen(true);
    hud.setMapOpen(true);
    refreshMap();
    game.invalidate();
  }

  /** Close the map; `back` glides to where the camera was. */
  function closeMap(back: boolean): void {
    if (!mapView.open) return;
    mapView.setOpen(false);
    hud.setMapOpen(false);
    if (back && mapReturn) {
      const r = mapReturn;
      game.director.glideTo(r.target, r.distance, { phi: r.phi, theta: r.theta, duration: 0.9 });
    }
    mapReturn = null;
    game.invalidate();
  }

  function goToMarker(m: MapMarker): void {
    closeMap(false);
    game.director.glideTo(new Vector3(m.x, 0, m.z), 1000, { phi: 0.95, duration: 1 });
    if (m.kind === "town") game.flourishes.add(game.landscapeView.flash([Number(m.key.split(":")[1])]));
    else {
      const i = game.landscape.grid.cellAtWorld(m.x, m.z);
      const marks = goalMarks(game.scene, [{ x: m.x, y: i < 0 ? 0 : game.landscape.grid.groundY(i), z: m.z }]);
      if (marks) game.flourishes.add(marks);
    }
  }

  function refreshMap(): void {
    mapRefreshedAt = performance.now();
    mapView.show(mapMarkers(game.world, (id) => townLife.status(id)));
    placeMap();
  }

  const mapPoint = new Vector3();
  function placeMap(): void {
    const rect = game.canvas.getBoundingClientRect();
    mapView.place((x, z) => {
      mapPoint.set(x, 0, z).project(game.camera);
      if (mapPoint.z > 1 || Math.abs(mapPoint.x) > 1.1 || Math.abs(mapPoint.y) > 1.1) return null;
      return { x: rect.left + ((mapPoint.x + 1) / 2) * rect.width, y: rect.top + ((1 - mapPoint.y) / 2) * rect.height };
    });
  }

  /** "Show me": glide to where the current goal is done, flash the towns and mark the places, open the tray tab. */
  function showGoal(): void {
    const goal = goals.current();
    if (!goal) return;
    const guide = goal.guide(game.world);
    if (guide.tab) hud.openTray(guide.tab, guide.shelf);
    if (guide.points.length > 0) {
      const xs = guide.points.map((p) => p.x);
      const zs = guide.points.map((p) => p.z);
      const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      // A margin round the places, so a lone town or depot is seen with its surroundings, and room for the goals card
      // and the tray, which cover the top left and the bottom of the screen.
      const radius = (Math.hypot(x1 - x0, z1 - z0) / 2) * 1.3 + 360;
      const distance = Math.min(frameDistance(radius, game.camera.fov, game.camera.aspect), game.controls.maxDistance);
      game.follow(-1);
      game.director.glideTo(new Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2), distance, { duration: 1 });
    }
    if (guide.towns.length > 0) game.flourishes.add(game.landscapeView.flash(guide.towns));
    const grid = game.landscape.grid;
    const ground = (x: number, z: number) => {
      const i = grid.cellAtWorld(x, z);
      return i < 0 ? 0 : grid.groundY(i);
    };
    const marks = goalMarks(game.scene, guide.marks.map((p) => ({ x: p.x, y: ground(p.x, p.z), z: p.z })));
    if (marks) game.flourishes.add(marks);
    game.invalidate();
  }

  function resetGoals(): void {
    progress = Progress.fresh();
    hud.setCoins(progress.coins);
    crafting.setProgress(progress);
    saveProgress(progress.toJSON());
    refreshBoard();
    goals = new GoalTracker();
    saveGoals([]);
    goalsPanel.reset();
  }

  /** Game mode, in play: start again on the starter map with no goals done. */
  function newGame(): void {
    resetGoals();
    saveLastBuilt("game", null);
    setWorld(freshGameWorld());
    townLife.reset();
    save();
    openingView();
  }

  /** Leave the title for a mode: carry on with its railway, or start it afresh. */
  function play(next: GameMode, fresh: boolean): void {
    if (fresh && next === "game") resetGoals();
    if (fresh) saveLastBuilt(next, null);
    if (fresh) setWorld(next === "game" ? freshGameWorld() : createWorld(Math.floor(Math.random() * 1_000_000)));
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
    // An industry you place must stand near what it works with (trees, fields): Game mode's rule.
    interaction.siteRule = mode === "game" ? (type, pose) => siteWhy(game.landscape, type, pose) : null;
    if (mode === "game") {
      townLife.reset();
      progress.coverMap(game.world);
      hud.trayBadge = trayBadge;
      hud.setCoins(progress.coins);
      refreshBoard();
    } else {
      townLife.clear();
      shownDelivered = new Map();
      hud.trayBadge = null;
      hud.setCoins(null);
    }
    industriesChanged();
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
    // Typing (a debug report's note): the keys are the text's.
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    if (e.key === "`") hud.perf.hidden = !hud.perf.hidden;
    if (e.key === "Escape" && mapView.open) closeMap(true);
    if (e.key === "Escape" && board.open) setBoardOpen(false);
    if (e.key === " " && !title.shown && tag !== "BUTTON") {
      e.preventDefault();
      game.paused = !game.paused;
      hud.setPaused(game.paused);
    }
  });
  /**
   * The opening view: a medium view of where track was last put down (else of the track built so far) or, on a bare
   * map, the first two towns, with a hint to join them.
   */
  function openingView(): void {
    let at = loadLastBuilt(mode);
    if (!at) {
      // No note of it (an older save): the middle of the track built so far.
      let n = 0;
      let x = 0;
      let z = 0;
      for (const id of game.layout.pieceIds()) {
        if (isFixedPiece(id) || game.layout.getPiece(id)!.type === "riser") continue;
        const c = pieceCentre(game.layout, id);
        x += c.x;
        z += c.z;
        n++;
      }
      if (n > 0) at = { x: x / n, z: z / n };
    }
    if (at) {
      game.lookAt(new Vector3(at.x, 0, at.z), OPENING_DISTANCE, 1.0);
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
    // The Turn arrow shows the next piece's or model's way as seen now, so it turns with the camera.
    hud.setTrayArrow(interaction.trayArrow(hud.propsTab));
    interaction.tick(dt);
    const now = performance.now();
    if (mapView.open) {
      if (now - mapRefreshedAt > 1000) refreshMap();
      else placeMap();
    }
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
    // Town signs: in Game mode what each town wants (and it grows when it gets it); in Sandbox, delivery counts.
    if (mode === "game") {
      if (playing) townLife.update();
      showWorkshop();
    } else game.economy.delivered.forEach(showDelivered);
    showDeliverTo();
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
  loadBar.finish();
  loading?.classList.add("done");
  // The loading screen fades out (0.6 s); its toys go with it.
  setTimeout(() => toys?.stop(), 700);
}

/** Say on the loading screen that the toys couldn't be fetched, with a button to try again. */
function offerRetry(again: () => void): void {
  const box = loading?.querySelector("div");
  if (!box) return;
  const note = document.createElement("p");
  note.textContent = "Couldn't fetch the toys. Check the connection, then try again.";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "load-retry";
  button.textContent = "Try again";
  button.addEventListener("click", () => {
    note.remove();
    button.remove();
    again();
  });
  box.append(note, button);
}

/**
 * The loading bar: each part of the loading has a share of it (the track pieces by how many are carved). It stops just
 * short of the end until the game is built.
 */
const loadBar = (() => {
  const bar = loading?.querySelector<HTMLElement>(".load-bar");
  const shares = { trains: 0.15, dressing: 0.15, thumbnails: 0.05, pieces: 0.55 };
  const done: Record<keyof typeof shares, number> = { trains: 0, dressing: 0, thumbnails: 0, pieces: 0 };
  const show = (p: number) => {
    bar?.style.setProperty("--p", p.toFixed(3));
    bar?.setAttribute("aria-valuenow", String(Math.round(p * 100)));
  };
  return {
    /** How far along a part is (0 to 1). */
    set(part: keyof typeof shares, fraction: number): void {
      done[part] = Math.max(done[part], fraction);
      show((Object.keys(shares) as (keyof typeof shares)[]).reduce((p, k) => p + shares[k] * done[k], 0));
    },
    finish: () => show(1),
  };
})();

/** Toys hopping onto the loading screen as their models arrive (none if WebGL won't start for it). */
const toys = ((): LoadingToys | null => {
  const canvas = loading?.querySelector<HTMLCanvasElement>(".loading-toys");
  if (!canvas) return null;
  try {
    return new LoadingToys(canvas);
  } catch {
    canvas.remove();
    return null;
  }
})();
if (toys) {
  // One after another: the train, then the platform's folk, the street's furniture, and (if they're in before the
  // game is) a few buildings. The buildings come after what the game needs, so they never hold it up.
  const pop = async (models: Map<string, Object3D>, shelf: Shelf, list: [string, Record<string, string>?][]) => {
    for (const [id, slots] of list) {
      const model = models.get(id);
      if (model) toys.add(model, shelf, slots);
      await new Promise((r) => setTimeout(r, 180));
    }
  };
  void (async () => {
    try {
      const trains = loadModelSet("trains");
      const dressing = loadModelSet("dressing", true);
      await pop(await trains, "train", [["engine-classic"], ["passenger-classic"], ["passenger-dining"], ["hopper-classic"], ["timber-classic"], ["caboose-classic"]]);
      await dressing;
      const buildings = loadModelSet("buildings", true);
      await pop(await dressing, "folk", [
        ["porter"],
        ["peg-doll-hat", { coat: "#2f6db5", hat: "#2a2b2e" }],
        ["traveller"],
        ["peg-doll", { coat: "#3f8f4e" }],
        ["conductor"],
        ["peg-doll-hat", { coat: "#e6b52c", hat: "#c8442f" }],
        ["peg-doll", { coat: "#c8442f" }],
      ]);
      await pop(await dressing, "street", [
        ["lamp"],
        ["bench"],
        ["postbox"],
        ["planter", { flower0: "#d9443a", flower1: "#e6b52c", flower2: "#e98aa8", flower3: "#f3ead8" }],
        ["fountain"],
        ["phone"],
        ["busstop"],
        ["lamp"],
      ]);
      await pop(await buildings, "town", [["bldg-thatched-cottage"], ["bldg-signal-box"], ["bldg-church"], ["bldg-windmill"], ["bldg-toy-shop"], ["bldg-water-tower"]]);
    } catch {
      // The loading screen says so itself (see offerRetry).
    }
  })();
}

// Let the loading screen paint, carve the track pieces in background workers (several at once), then build the rest.
requestAnimationFrame(() =>
  setTimeout(() => {
    const t0 = performance.now();
    // The trains and the map's building parts are needed before anything is built: the loading screen stays until
    // they're in (each fetch retries), and offers to try again if they can't be had.
    const models = (): Promise<void> =>
      loadBlenderModels().catch((e: unknown) => {
        console.error("Woodrail: couldn't load the models", e);
        return new Promise<void>((resolve) => offerRetry(() => resolve(models())));
      });
    void loadModelSet("trains").then(() => loadBar.set("trains", 1), () => {});
    void loadModelSet("dressing", true).then(() => loadBar.set("dressing", 1), () => {});
    void Promise.all([
      TrackView.prebuildInWorkers(PIECE_TYPES, (n, total) => loadBar.set("pieces", n / total)).then(() => loadBar.set("pieces", 1)),
      loadCached<Map<string, string>>("thumbnails", __BUILD_ID__).then((t) => (loadBar.set("thumbnails", 1), t)),
      models(),
    ]).then(([, thumbs]) => {
      console.info(`Woodrail: track pieces ready in ${Math.round(performance.now() - t0)} ms`);
      boot(thumbs);
    });
  }, 30),
);
