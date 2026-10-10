import { Sim } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";

export interface StarterWorld {
  layout: Layout;
  sim: Sim;
}

/**
 * The layout a new player sees: an oval with a ramp-and-bridge section, a switch to a siding with a buffer,
 * one train running and one parked.
 */
export function buildStarterWorld(): StarterWorld {
  const layout = new Layout();
  const ref = connectorRef;
  const start = layout.addPiece("straight-216", { x: -486, z: -360, heading: 0 });
  let last = start;
  const next = (type: PieceTypeId, flipped = false) => (last = appendPiece(layout, type, flipped, ref(last, 1)));

  // Bottom side: up a ramp, over a bridge, down again (an adapter fixes the peg/socket direction, as on the real toy).
  next("ramp");
  next("bridge");
  const adapterHigh = next("adapter-socket");
  const down = appendPiece(layout, "ramp", false, ref(adapterHigh, 1), 1);
  last = appendPiece(layout, "adapter-peg", false, ref(down, 0), 0);
  const ah = layout.getPiece(adapterHigh)!;
  layout.addPiece("riser", {
    x: ah.pose.x + Math.cos(ah.pose.heading) * 27,
    z: ah.pose.z + Math.sin(ah.pose.heading) * 27,
    heading: ah.pose.heading,
  });

  for (let i = 0; i < 4; i++) next("curve-large");

  // Top side, heading back: two long straights, then a switch whose branch leads out to a siding.
  next("straight-216");
  const topSecond = next("straight-216");
  next("straight-144");
  const sw = next("switch", true);
  next("straight-144");
  next("straight-108");
  for (let i = 0; i < 4; i++) next("curve-large");

  const sidingCurve = appendPiece(layout, "curve-large", false, ref(sw, 2));
  const siding = appendPiece(layout, "straight-216", false, ref(sidingCurve, 1));
  appendPiece(layout, "buffer", false, ref(siding, 1));

  const sim = new Sim(layout);
  const running = sim.addTrain(["engine", "hopper", "passenger", "caboose"], { pieceId: topSecond, pathIndex: 0, reversed: false, s: 200 });
  if (running.kind === "placed") sim.setLever(sim.getTrain(running.trainId)!.cars[0].id, 1);
  sim.addTrain(["engine", "hopper", "hopper"], { pieceId: siding, pathIndex: 0, reversed: false, s: 180 });
  return { layout, sim };
}
