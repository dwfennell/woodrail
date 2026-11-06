// Where on screen to tap a depot or an engine so the tap is the game's own: points along the depot's piece, or along
// the engine car and up its body, each projected and asked of the game's own hit test (`Interaction.pick`, as the tap
// will be), the first it finds the thing at, with no page element over it. Null: none from this side (turn the view and
// ask again). From e2e:leftovers' aim (5083b69: a depot's track middle sometimes had a town house or other model in
// front of it from the view's side, and an engine's tap at rail height sometimes took the track under it).
//
//   what: { depot, along? } or { engine }
//   opts.cars: a car standing on the depot counts as the depot (a route's stop, tapped while planning: the game takes
//     a car there as its stop). Off by default: a tap on a car opens the train's card, not the depot's.

/** [x, y] in page px to tap `what` at, or null if the game's hit test finds it nowhere from this side. */
export function aimAt(page, what, opts = {}) {
  return page.evaluate(
    ([what, cars]) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      const screen = (q) => {
        const c = new V(q.x, q.y, q.z).project(w.camera);
        return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
      };
      const points = [];
      if (what.depot !== undefined) {
        const piece = w.layout.getPiece(w.economy.depot(what.depot).pieceId);
        const q = piece.pose;
        // (A longer piece, a mine's, reaches past a straight's 216: further points along it too.)
        const alongs = [...(what.along !== undefined ? [what.along] : []), 108, 72, 144, 40, 176, 20, 220, 300];
        for (const along of alongs) points.push({ x: q.x + Math.cos(q.heading) * along, y: piece.y, z: q.z + Math.sin(q.heading) * along });
      } else {
        const t = w.sim.findCar(what.engine).train;
        const i = t.cars.findIndex((c) => c.id === what.engine);
        const [a, c] = [t.world[2 * i], t.world[2 * i + 1]];
        for (const up of [16, 28, 8, 0]) for (const f of [0.5, 0.3, 0.7]) points.push({ x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f + up, z: a.z + (c.z - a.z) * f });
      }
      const isIt = (pk) => {
        if (!pk) return false;
        if (what.engine !== undefined) return pk.kind === "car" && pk.carId === what.engine;
        if (pk.kind === "depot") return pk.depotId === what.depot;
        if (pk.kind === "piece") return w.economy.depotAtPiece(pk.pieceId)?.id === what.depot;
        if (cars && pk.kind === "car") return (w.sim.findCar(pk.carId)?.train.bogies ?? []).some((b) => w.economy.depotAtPiece(b.pieceId)?.id === what.depot);
        return false;
      };
      for (const q of points) {
        const [x, y] = screen(q);
        if (x < 4 || y < 4 || x > innerWidth - 4 || y > innerHeight - 4) continue;
        if (document.elementFromPoint(x, y)?.tagName !== "CANVAS") continue;
        if (isIt(w.interaction.pick(x, y, true))) return [x, y];
      }
      return null;
    },
    [what, !!opts.cars],
  );
}
