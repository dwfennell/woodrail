// The tech tree's track pieces on a phone, by touch (e2e:touch groups `slips`, `double-three-way`, `turntable-taps`;
// docs/superpowers/specs/2026-10-31-tech-tree.md T3, T4, T5). Sandbox, 390×844, as touch.mjs opens it:
// - slips: a double slip dragged out of the Switch shelf, a leg laid off each end; its lever tapped, a train runs onto
//   its curve to the other line; tapped back, the train runs straight across; then a single slip the same way.
// - double-three-way: dragged out of the Switch shelf; each of its two levers tapped by touch sends the train its
//   branch's way (the right, then the left), the other lever put back.
// - turntable-taps: a tap on a road leading off a turntable turns the deck straight to it, carrying the engine on it
//   round; a tap on the deck by another road turns it there; a tap on its hub steps it; the engine drives off along
//   the road it was turned to.
// What's tested is by the player's path (tray drags, taps on levers and roads); setup that isn't (the legs, the train
// put down, the turntable laid) is a named harness shortcut, laid through the editor as dropping them would.

const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** A fixture's touch helpers: a stamped touch, settled, a tap at a screen point, the screen point of a world point. */
function helpers(ctx, p) {
  let cdp = null;
  const touch = async (type, x, y, timestamp) => {
    cdp ??= await ctx.newCDPSession(p);
    return cdp.send("Input.dispatchTouchEvent", { type, ...(timestamp ? { timestamp } : {}), touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  };
  const settled = () => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  const tapAt = async ([x, y]) => {
    const t = Date.now() / 1000;
    await touch("touchStart", x, y, t);
    await touch("touchEnd", 0, 0, t + 0.05);
    await settled();
  };
  const screenOf = (x, y, z) =>
    p.evaluate(([x, y, z]) => {
      const w = window.woodrail;
      w.camera.updateMatrixWorld();
      const v = new w.camera.position.constructor(x, y, z).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    }, [x, y, z]);
  const still = () => p.waitForFunction(() => !window.woodrail.director.busy && window.woodrail.interaction.mode.kind === "idle", null, { timeout: 60000 });
  return { touch, settled, tapAt, screenOf, still };
}

/**
 * Open ground for piece `type` with a leg (`legTypes` off each end, from the piece outward) as the tray lays it facing
 * away from the camera (turned an eighth at a time till there's room), the view framed on it: { x, z, heading }.
 */
async function roomFor(p, type, legTypes, frameMm = 640) {
  const spot = await p.evaluate(
    async ([type, legTypes, frameMm]) => {
      const w = window.woodrail;
      const { frameDistance } = await import("/src/game/camera-director.ts");
      const { poseForCentre } = await import("/src/editor/editor.ts");
      const T = await import("/src/track/index.ts");
      const it = w.interaction;
      const footprint = (heading) => {
        const scratch = new T.Layout();
        const sw = scratch.addPiece(type, poseForCentre(type, false, 0, 0, heading), 0, false);
        for (let c = 0; c < T.getPieceDef(type, false).connectors.length; c++) {
          let ref = T.connectorRef(sw, c);
          for (const lt of legTypes) {
            const end = scratch.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
            const flipped = T.getPieceDef(lt, false).connectors.every((k) => k.kind === end.kind);
            const via = T.getPieceDef(lt, flipped).connectors.findIndex((k) => k.kind !== end.kind);
            const id = T.appendPiece(scratch, lt, flipped, ref, via);
            ref = T.connectorRef(id, 1 - via);
          }
        }
        const points = [];
        const smp = T.createSample();
        for (const id of scratch.pieceIds()) {
          const q = scratch.getPiece(id);
          for (const path of T.getPieceDef(q.type, q.flipped).paths) {
            const len = T.pathLength(path.geom);
            for (let d = 0; d <= len; d += 100) {
              T.samplePath(path.geom, d, smp);
              const c = Math.cos(q.pose.heading), sn = Math.sin(q.pose.heading);
              points.push([q.pose.x + smp.x * c - smp.z * sn, q.pose.z + smp.x * sn + smp.z * c]);
            }
          }
        }
        return points;
      };
      const off = new w.camera.position.constructor().subVectors(w.camera.position, w.controls.target);
      const theta0 = Math.atan2(off.x, off.z);
      let o = null;
      let theta = null;
      for (let k = 0; k < 8 && !o; k++) {
        const th = theta0 + (k * Math.PI) / 4;
        const along = Math.round(Math.atan2(-Math.cos(th), -Math.sin(th)) / (Math.PI / 4)) * (Math.PI / 4);
        o = await window.__openGround(footprint(along + (it.trayTurns * Math.PI) / 4), { pieceGap: 400, onMat: true });
        if (o) (theta = k === 0 ? null : th), (o.heading = along);
      }
      if (!o) return null;
      w.director.glideTo(w.controls.target.clone().set(o.x, 0, o.z), frameDistance(frameMm, w.camera.fov, w.camera.aspect), { duration: 0.3, ...(theta === null ? {} : { theta }) });
      return o;
    },
    [type, legTypes, frameMm],
  );
  return spot;
}

/** Drag `key`'s tile out of the Switch shelf by touch onto world point (x, z), let go: the new piece of `type`, or −1. */
async function dragOut(f, h, key, type, spot) {
  const { p, tapOn } = f;
  const shelf = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-group")].findIndex((b) => b.querySelector(".label")?.textContent === "Switch"));
  if (shelf < 0) throw new Error("no Switch shelf");
  await tapOn(`.scroller .tray-group:nth-child(${shelf + 1 + (await p.evaluate(() => document.querySelectorAll(".scroller > :not(.tray-group)").length))})`);
  await p.evaluate((key) => document.querySelector(`.scroller .tray-item[data-key="${key}"]`)?.scrollIntoView({ inline: "center" }), key);
  await frames(p);
  const from = await p.evaluate((key) => {
    const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, key);
  if (!from) throw new Error(`no ${key} on the Switch shelf`);
  // (On touch a held piece rides 56 px above the finger: the finger lifts that far below the spot.)
  const at = await h.screenOf(spot.x, 0, spot.z);
  const to = [at[0], at[1] + 56];
  const before = await p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
  let t = Date.now() / 1000;
  await h.touch("touchStart", from[0], from[1], t);
  for (let k = 1; k <= 12; k++) await h.touch("touchMove", from[0] + ((to[0] - from[0]) * k) / 12, from[1] + ((to[1] - from[1]) * k) / 12, (t += 0.03));
  await h.touch("touchEnd", 0, 0, (t += 0.05));
  await h.settled();
  await p.keyboard.press("Escape");
  // (Back to the shelves, so the next drag finds them.)
  if (await p.evaluate(() => document.querySelector(".tray").classList.contains("in-group"))) await tapOn(".scroller .tray-back");
  return p.evaluate(([before, type]) => [...window.woodrail.layout.pieceIds()].find((i) => !before.includes(i) && window.woodrail.layout.getPiece(i).type === type) ?? -1, [before, type]);
}

/**
 * Harness shortcut (setup, not what's tested): a leg (`legTypes`) off each end of piece `id`, laid through the editor
 * as dropping them would (each seated on the end before, worked out on a copy). The first two pieces of each leg.
 */
function layLegs(p, id, legTypes) {
  return p.evaluate(
    async ([id, legTypes]) => {
      const w = window.woodrail;
      const T = await import("/src/track/index.ts");
      const q = w.layout.getPiece(id);
      const scratch = new T.Layout();
      const sw = scratch.addPiece(q.type, q.pose, q.y, q.flipped);
      const lay = (ref, type) => {
        const end = scratch.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
        for (const flipped of [false, true]) {
          const via = T.getPieceDef(type, flipped).connectors.findIndex((c) => c.kind !== end.kind);
          if (via !== -1) return { id: T.appendPiece(scratch, type, flipped, ref, via), via, flipped };
        }
        throw new Error(`no way to lay ${type}`);
      };
      const out = [];
      for (let c = 0; c < T.getPieceDef(q.type, q.flipped).connectors.length; c++) {
        const run = [];
        let ref = T.connectorRef(sw, c);
        for (const type of legTypes) {
          const l = lay(ref, type);
          const s = scratch.getPiece(l.id);
          run.push({ type, pose: s.pose, y: s.y, flipped: l.flipped });
          ref = T.connectorRef(l.id, 1 - l.via);
        }
        out.push(w.editor().placeRun(run));
      }
      w.invalidate();
      return out.map((ids) => ids.slice(0, 2));
    },
    [id, legTypes],
  );
}

/** Harness shortcut: an engine and a flatbed on the leg's second piece, stopped. Its engine's car id. */
function trainOn(p, pieceId) {
  return p.evaluate((pieceId) => {
    const w = window.woodrail;
    const r = w.sim.addTrain(["engine", "timber"], { pieceId, pathIndex: 0, s: 108, reversed: false });
    if (r.kind !== "placed") return -1;
    const e = w.sim.getTrain(r.trainId).cars[0].id;
    w.sim.setLever(e, 0);
    w.invalidate();
    return e;
  }, pieceId);
}

/**
 * The train run by hand (harness shortcut: its lever set in code, the sim and economy ticked ahead of SwiftShader's
 * few frames, as `Game.frame` runs them) until it stands wholly on leg `legs[until]`: the piece's paths its cars
 * took, and any move of the points under a car.
 */
function runTo(p, id, legs, engine, until, go = true) {
  return p.evaluate(
    ([id, legs, engine, until, go]) => {
      const w = window.woodrail;
      if (go) w.sim.setLever(engine, 1);
      const roads = [];
      let last = w.layout.switchState(id);
      let under = 0;
      let there = false;
      for (let i = 0; i < 120 * 120; i++) {
        w.sim.tick();
        w.economy.tick();
        const t = w.sim.findCar(engine).train;
        for (const b of t.bogies) if (b.pieceId === id && !roads.includes(b.pathIndex)) roads.push(b.pathIndex);
        const s = w.layout.switchState(id);
        if (s !== last && w.sim.pointsHeld(id)) under++;
        last = s;
        if (t.bogies.every((b) => legs[until].includes(b.pieceId))) {
          there = true;
          break;
        }
      }
      w.sim.setLever(engine, 0);
      w.invalidate();
      return { roads, under, there };
    },
    [id, legs, engine, until, go],
  );
}

/** The screen point of lever `k` of piece `id` (its knob), and what a fingertip's tap there picks. */
function leverAt(p, id, k) {
  return p.evaluate(
    ([id, k]) => {
      const w = window.woodrail;
      const lever = w.trackView.group.children.find((c) => c.userData.kind === "switch-lever" && c.userData.pieceId === id && (c.userData.corner ?? 0) === k);
      if (!lever) return null;
      lever.updateMatrixWorld(true);
      w.camera.updateMatrixWorld();
      const v = new w.camera.position.constructor(0, 14, 0).applyMatrix4(lever.matrixWorld).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      const at = [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      const pick = w.interaction.pick(at[0], at[1], true);
      return { at, pick: pick ? { kind: pick.kind, pieceId: pick.pieceId, corner: pick.corner ?? 0 } : null };
    },
    [id, k],
  );
}

const state = (p, id) => p.evaluate((id) => window.woodrail.layout.switchState(id), id);

/** Tap lever `k` of piece `id` by touch (the view framed on `spot`, still): its state before and after. */
async function tapLever(f, h, id, k, spot) {
  const { p } = f;
  await p.evaluate(({ x, z }) => {
    const w = window.woodrail;
    if (Math.hypot(w.controls.target.x - x, w.controls.target.z - z) > 60) w.director.glideTo(w.controls.target.clone().set(x, 0, z), w.camera.position.distanceTo(w.controls.target), { duration: 0.2 });
  }, spot);
  await h.still();
  await h.settled();
  const l = await leverAt(p, id, k);
  const was = await state(p, id);
  if (!l) return { was, now: was, l };
  await h.tapAt(l.at);
  return { was, now: await state(p, id), l };
}

/** A slip (`type`) laid from the Switch shelf by touch, its lever tapped, a train sent through it both ways. */
async function oneSlip(f, check, type) {
  const { p } = f;
  const h = helpers(f.ctx, p);
  const name = type === "slip-double" ? "double slip" : "single slip";
  await p.keyboard.press("Escape");
  const LEG = ["straight-216", "straight-216", "buffer-turnback"];
  const spot = await roomFor(p, type, LEG);
  if (!spot) throw new Error(`${name}: no open ground for it and its legs`);
  await h.still();
  await h.settled();
  const id = await dragOut(f, h, `piece:${type}`, type, spot);
  check(`slips: dragged out of the Switch shelf by touch, a ${name} is laid`, id >= 0);
  if (id < 0) return;
  const legs = await layLegs(p, id, LEG);
  const joined = await p.evaluate((id) => [0, 1, 2, 3].every((c) => window.woodrail.layout.joinedConnector(id * 8 + c) !== -1), id);
  check(`slips: a leg joined off each of the ${name}'s four ends`, joined, JSON.stringify(legs));
  if (!joined) return;
  const engine = await trainOn(p, legs[0][1]);
  if (engine < 0) throw new Error(`${name}: no room for a train`);
  // Its one lever tapped by touch: set to turn.
  const t1 = await tapLever(f, h, id, 0, spot);
  check(`slips: a touch tap on the ${name}'s lever sets it to turn`, t1.was === 0 && t1.now === 1, JSON.stringify(t1));
  await p.screenshot({ path: `${process.env.E2E_SHOTS ?? "e2e-out/touch"}/slips-${type}-set.png` }).catch(() => {});
  // The payoff: the train runs from end 0 along the curve onto the other line (path 2), to leg 3.
  const turned = await runTo(p, id, legs, engine, 3);
  check(`slips: the train runs onto the ${name}'s curve, to the other line`, turned.there && turned.roads.includes(2) && turned.under === 0, JSON.stringify(turned));
  // Tapped back: straight across. From leg 3 the train runs over the other line, to leg 2.
  const t0 = await tapLever(f, h, id, 0, spot);
  check(`slips: tapped again, the ${name} is set straight across`, t0.was === 1 && t0.now === 0, JSON.stringify(t0));
  const across = await runTo(p, id, legs, engine, 2);
  check(`slips: set across, the train runs straight over the ${name}, to the other line's far end`, across.there && across.roads.includes(1) && !across.roads.includes(2) && across.under === 0, JSON.stringify(across));
  if (type === "slip-double") {
    // The double's other curve: set to turn, from leg 2 onto the first line (path 3), to leg 1.
    await tapLever(f, h, id, 0, spot);
    const other = await runTo(p, id, legs, engine, 1);
    check("slips: the double slip's other curve takes the train back onto the first line", other.there && other.roads.includes(3) && other.under === 0, JSON.stringify(other));
  }
}

/** Group `slips`. */
export async function slipsGroup(f, check) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(process.env.E2E_SHOTS ?? "e2e-out/touch", { recursive: true });
  const before = await f.p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
  await oneSlip(f, check, "slip-double");
  // (The double's track taken up before the single's, so the small map has room: as touch.mjs's `step` does after a
  // group. Harness shortcut, setup only.)
  await f.p.evaluate((before) => {
    const w = window.woodrail;
    const ids = [...w.layout.pieceIds()].filter((i) => !before.includes(i)).reverse();
    for (const id of w.sim.trainIds()) if (w.sim.getTrain(id).bogies.some((b) => ids.includes(b.pieceId))) w.sim.removeTrain(id);
    w.economy.prune();
    for (let pass = 0; pass < 4; pass++) for (const id of ids) if (w.layout.getPiece(id)) w.editor().remove(id);
    w.invalidate();
  }, before);
  await oneSlip(f, check, "slip-single");
}

/** Group `double-three-way`. */
export async function doubleThreeWayGroup(f, check) {
  const { p } = f;
  const h = helpers(f.ctx, p);
  await p.keyboard.press("Escape");
  const LEG = ["straight-216", "straight-216", "buffer-turnback"];
  const type = "switch-3way-double";
  const spot = await roomFor(p, type, LEG);
  if (!spot) throw new Error("double three-way: no open ground for it and its legs");
  await h.still();
  await h.settled();
  const id = await dragOut(f, h, `piece:${type}`, type, spot);
  check("double-three-way: dragged out of the Switch shelf by touch, a double three-way is laid", id >= 0);
  if (id < 0) return;
  const legs = await layLegs(p, id, LEG);
  const levers = await p.evaluate((id) => window.woodrail.trackView.group.children.filter((c) => c.userData.kind === "switch-lever" && c.userData.pieceId === id).length, id);
  check("double-three-way: it has two levers", levers === 2, String(levers));
  const engine = await trainOn(p, legs[0][1]);
  if (engine < 0) throw new Error("double three-way: no room for a train");
  // The right branch's lever (lever 1, branch end 3, road 2).
  const right = await tapLever(f, h, id, 1, spot);
  check("double-three-way: a touch tap on the right lever sets the right branch", right.was === 0 && right.now === 2 && right.l?.pick?.corner === 1, JSON.stringify(right));
  await p.screenshot({ path: `${process.env.E2E_SHOTS ?? "e2e-out/touch"}/double-three-way-right.png` }).catch(() => {});
  const toRight = await runTo(p, id, legs, engine, 3);
  check("double-three-way: the train runs from the trunk to the right branch", toRight.there && toRight.roads.includes(2) && toRight.under === 0, JSON.stringify(toRight));
  // The left lever: the left branch set, the right lever put back.
  const left = await tapLever(f, h, id, 0, spot);
  check("double-three-way: a touch tap on the left lever sets the left branch (the right lever back)", left.was === 2 && left.now === 1, JSON.stringify(left));
  // From the right branch back to the trunk (turned back at its buffer), then on to the left branch.
  const back = await runTo(p, id, legs, engine, 0);
  const toLeft = await runTo(p, id, legs, engine, 2);
  check("double-three-way: …and the train, back on the trunk, then runs to the left branch", back.there && toLeft.there && toLeft.roads.includes(1) && toLeft.under === 0, JSON.stringify({ back, toLeft }));
  // The left lever again: straight on.
  const straight = await tapLever(f, h, id, 0, spot);
  check("double-three-way: the left lever tapped again sets it straight on", straight.was === 1 && straight.now === 0, JSON.stringify(straight));
}

/** Group `turntable-taps`. */
export async function turntableGroup(f, check) {
  const { p } = f;
  const h = helpers(f.ctx, p);
  await p.keyboard.press("Escape");
  const LEG = ["straight-216", "buffer-turnback"];
  const spot = await roomFor(p, "kit-turntable", LEG, 700);
  if (!spot) throw new Error("turntable: no open ground for it and its roads");
  await h.still();
  await h.settled();
  // Harness shortcut (setup, not what's tested: the turntable from the Kits tab is e2e:kits'): a turntable laid
  // through the editor, a road (a straight and a turnback buffer) off ends 0, 2 and 3.
  const laid = await p.evaluate(async ({ x, z, heading }) => {
    const w = window.woodrail;
    const T = await import("/src/track/index.ts");
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const pose = poseForCentre("kit-turntable", false, x, z, heading);
    const [deck] = w.editor().placeRun([{ type: "kit-turntable", pose, y: 0, flipped: false }]);
    const roads = {};
    for (const k of [0, 2, 3]) {
      const end = w.layout.worldConnector(T.connectorRef(deck, k), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
      const [s] = w.editor().placeRun([{ type: "straight-216", pose: { x: end.x, z: end.z, heading: end.heading }, y: 0, flipped: false }]);
      const e2 = w.layout.worldConnector(T.connectorRef(s, 1), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
      w.editor().placeRun([{ type: "buffer-turnback", pose: { x: e2.x, z: e2.z, heading: e2.heading }, y: 0, flipped: false }]);
      roads[k] = s;
    }
    // An engine standing still across the deck.
    const r = w.sim.addTrain(["engine"], { pieceId: deck, pathIndex: 0, reversed: false, s: 122 });
    if (r.kind !== "placed") return null;
    const engine = w.sim.getTrain(r.trainId).cars[0].id;
    w.sim.setLever(engine, 0);
    w.invalidate();
    return { deck, roads, engine };
  }, spot);
  if (!laid) throw new Error("turntable: couldn't lay it and an engine on it");
  const { deck, roads, engine } = laid;
  const deckState = () => state(p, deck);
  /** Let the glide finish (the sim ticked ahead, as `Game.frame` runs it). */
  const glide = () => p.evaluate(() => { for (let i = 0; i < 90; i++) window.woodrail.sim.tick(); window.woodrail.invalidate(); });
  /** The screen point `along` mm along piece `id`'s first path. */
  const alongPiece = (id, along) =>
    p.evaluate(
      async ([id, along]) => {
        const w = window.woodrail;
        const T = await import("/src/track/index.ts");
        const q = w.layout.getPiece(id);
        const s = T.createSample();
        T.samplePath(T.getPieceDef(q.type, q.flipped).paths[0].geom, along, s);
        const c = Math.cos(q.pose.heading), sn = Math.sin(q.pose.heading);
        return [q.pose.x + s.x * c - s.z * sn, q.y, q.pose.z + s.x * sn + s.z * c];
      },
      [id, along],
    );
  // 1. A tap on road 2 (its straight's middle): the deck turns straight to it, the engine on it carried round.
  await h.still();
  await h.settled();
  const r2 = await alongPiece(roads[2], 108);
  await h.tapAt(await h.screenOf(...r2));
  const after2 = await deckState();
  check("turntable-taps: a touch tap on a road leading off it turns the deck straight to that road", after2 % 4 === 2, String(after2));
  await glide();
  const on2 = await p.evaluate(([e, deck]) => window.woodrail.sim.findCar(e).train.bogies.every((b) => b.pieceId === deck && b.pathIndex === 2), [engine, deck]);
  check("turntable-taps: …the engine standing on it carried round onto that road", on2);
  await h.settled();
  await p.screenshot({ path: `${process.env.E2E_SHOTS ?? "e2e-out/touch"}/turntable-road-tap.png` }).catch(() => {});
  // 2. A tap on the deck's pit by end 3 (its road's end, a little in): turned there.
  const end3 = await p.evaluate(async ([deck]) => {
    const w = window.woodrail;
    const T = await import("/src/track/index.ts");
    const e = w.layout.worldConnector(T.connectorRef(deck, 3), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    return [e.x - Math.cos(e.heading) * 18, 6, e.z - Math.sin(e.heading) * 18];
  }, [deck]);
  await h.tapAt(await h.screenOf(...end3));
  await glide();
  check("turntable-taps: a touch tap on the deck by another road turns it there", (await deckState()) % 4 === 3, String(await deckState()));
  // 3. A tap on the road it lies along already: nothing turns (the road's piece is taken, as any tap takes it).
  const r3 = await alongPiece(roads[3], 108);
  const was = await deckState();
  await h.tapAt(await h.screenOf(...r3));
  await p.keyboard.press("Escape");
  check("turntable-taps: a tap on the road it lies along doesn't turn it", (await deckState()) === was, String(await deckState()));
  // 4. The payoff: turned back to road 2 by a tap there, the engine drives off along it.
  await h.tapAt(await h.screenOf(...r2));
  await glide();
  const off = await p.evaluate(([e, road]) => {
    const w = window.woodrail;
    w.sim.setLever(e, 1);
    let reached = false;
    for (let i = 0; i < 120 * 30 && !reached; i++) {
      w.sim.tick();
      reached = w.sim.findCar(e).train.bogies.some((b) => b.pieceId === road);
    }
    w.sim.setLever(e, 0);
    w.invalidate();
    return reached;
  }, [engine, roads[2]]);
  check("turntable-taps: the engine, turned to road 2 by taps, drives off the deck along it", off);
}
