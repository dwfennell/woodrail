import type { ViewRoom } from "../game/camera-director";

/** A rectangle on the view (px, from its top left). */
export interface ViewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The part of a `width`×`height` view that shows the map: below what's along its top (`top`: the brand, the bar, the
 * goals), above or beside what covers it (`covers`: the tray, an open card or sheet). A card docked at the right (a
 * phone on its side) narrows it from the right; anything else covers it from below. Null where too little is left to
 * frame anything in (the caller uses the whole view): an empty or turned-inside-out room fitted to went to the
 * furthest the camera goes (QA: in landscape the engine card docked at the right was taken for one at the bottom).
 */
export function viewRoom(width: number, height: number, top: readonly ViewRect[], covers: readonly ViewRect[]): ViewRoom | null {
  const room = { left: 0, top: 0, right: width, bottom: height };
  for (const b of top) if (b.bottom > b.top && b.top < height / 3) room.top = Math.max(room.top, b.bottom);
  for (const b of covers) {
    if (b.bottom <= b.top || b.right <= b.left) continue;
    if (b.left > width * 0.4 && b.top < height / 2) room.right = Math.min(room.right, b.left);
    else if (b.top > room.top) room.bottom = Math.min(room.bottom, b.top);
  }
  return room.bottom - room.top > 80 && room.right - room.left > 80 ? room : null;
}
