import type { EconomyEvent } from "../economy/economy";
import type { ToyAudio } from "./audio";

/**
 * A frame's crane moves, heard: each depot's sounds once a frame, as the first unit it moved (a grab crane lifting
 * several at once, or a frame catching up several ticks, is one sound, not a pile-up). `hear` gives a depot's
 * volume and pan as the camera hears it, or null when it's gone.
 */
export function hearCranes(events: readonly EconomyEvent[], audio: Pick<ToyAudio, "goods">, hear: (depotId: number) => readonly [number, number] | null): void {
  if (events.length === 0) return;
  const heard = new Set<number>();
  for (const e of events) {
    if (heard.has(e.depotId)) continue;
    heard.add(e.depotId);
    const at = hear(e.depotId);
    if (at) audio.goods(e.cargo, e.kind === "loaded", at[0], at[1]);
  }
}
