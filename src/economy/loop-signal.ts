import { pieceOfRef, type Layout } from "../track";
import { markKey, type Sim } from "../sim";
import { topologyOf, trainLength } from "./sections";

/**
 * A signal inside a passing loop's road, holding a train with its tail over the loop's points (issue #31): the train
 * stands at the signal, red, part way along the road, so the loop's points behind it are fouled and no train can come
 * into the loop by either road. With the trains it waits on waiting on the loop, that's a ring no signal elsewhere
 * breaks; moving this signal to the loop road's far end lets the train stand wholly in the road.
 *
 * `markId`: a signal mark. The train standing at it (its id), and the points (piece) its tail is on; null if the mark
 * isn't inside a loop road, or no train stands at it red with its tail over the loop's points. Asked only when a card
 * opens or a stall is checked: not per frame.
 */
export function loopSignalHold(layout: Layout, sim: Sim, markId: number): { trainId: number; points: number } | null {
  const m = layout.getSignal(markId);
  if (!m) return null;
  const here = pieceOfRef(m.at);
  const joined = layout.joinedConnector(m.at);
  if (joined === -1) return null;
  const there = pieceOfRef(joined);
  const key = markKey(markId);
  for (const id of sim.trainIds()) {
    const t = sim.getTrain(id);
    if (!t || t.derailed || t.speed >= 1 || sim.redSignalKeyAhead(id) !== key) continue;
    const topo = topologyOf(layout, trainLength(t));
    const slot = topo.slotOf.get(here);
    const s = slot === undefined ? undefined : topo.slots[slot];
    // (Both sides of its joint on one loop road: it's inside the road, not at its end.)
    if (!s || s.kind !== "road" || topo.slotOf.get(there) !== slot) return null;
    const loop = topo.loops[s.loop];
    for (const b of t.bogies) if (b.pieceId === loop.a || b.pieceId === loop.b) return { trainId: id, points: b.pieceId };
    return null;
  }
  return null;
}
