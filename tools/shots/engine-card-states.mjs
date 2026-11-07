// The engine card in its states, on the live game (`MOCK=tools/shots/engine-card-states.mjs node
// tools/shots/engine-card.mjs <out>`): stuck behind a parked engine, standing at a stop (Stop and Leave now), Delete
// cargo asking, the line's edit view, and off its line (Take off line, tapped twice). Pictures for
// docs/agents/shots/engine-card-*. Harness shortcut, not what's pictured: the sim and economy ticked ahead of
// SwiftShader's frames, as e2e:touch's `__keepRun` does.
export default async function (p, shot, setup) {
  const tick = (secs, until = "") =>
    p.evaluate(({ secs, until }) => {
      const w = window.woodrail;
      const stop = until ? new Function("w", `return ${until}`) : () => false;
      for (let i = 0; i < secs * 120; i++) {
        w.sim.tick();
        w.economy.tick();
        w.economy.drainEvents();
        if (stop(w)) break;
      }
      w.invalidate();
    }, { secs, until });
  const click = (sel) => p.evaluate((sel) => document.querySelector(sel)?.click(), sel);
  const say = () => p.evaluate(() => document.querySelector(".engine-status")?.textContent);
  const train = () => `w.sim.findCar(${setup.engine}).train`;

  // Stuck: an engine parked a little way off either way, its lever off; this one sent on (its lever, as Go sets it)
  // runs up behind one.
  const parked = await p.evaluate(({ pieces, engine }) => {
    const w = window.woodrail;
    const ids = pieces.map((piece) => {
      const r = w.sim.addTrain(["engine"], { pieceId: piece, pathIndex: 0, s: 100, reversed: false });
      if (r.kind !== "placed") return -1;
      w.sim.setLever(w.sim.getTrain(r.trainId).cars[0].id, 0);
      return r.trainId;
    });
    w.sim.setLever(engine, 1);
    return ids;
  }, { pieces: [setup.pieces[6], setup.pieces[1]], engine: setup.engine });
  await tick(20);
  await p.waitForTimeout(1500);
  console.log("stuck:", await say());
  await shot("engine-card-1-stuck");

  // At a stop: the engine in the way taken off; the train runs on to the sawmill and stands under its crane.
  await p.evaluate((ids) => ids.forEach((id) => id !== -1 && window.woodrail.sim.removeTrain(id)), parked);
  await tick(60, `w.economy.atStop(${train()}.id) !== null`);
  // (Leave now shows once it has stood there 1.2 s: the page's own frames, the sim held.)
  await p.evaluate(() => (window.woodrail.paused = true));
  await p.waitForTimeout(1800);
  console.log("at stop:", await say());
  await shot("engine-card-2-at-stop");

  // Delete cargo: the first tap asks.
  await click(".engine-card .empty-all");
  await p.waitForTimeout(300);
  await shot("engine-card-3-throw-away-ask");
  // (Let it stop asking.)
  await p.waitForTimeout(4300);

  // Editing its line.
  await click(".engine-extra .route-plan");
  await p.waitForTimeout(800);
  await shot("engine-card-4-edit");

  // Take off line: the last train on it, so it asks, then a second tap.
  await click(".engine-extra .route-leave");
  await p.waitForTimeout(300);
  await shot("engine-card-5-take-off-ask");
  await click(".engine-extra .route-leave.asking");
  await p.waitForTimeout(1200);
  await shot("engine-card-6-no-line");
}
