import { CAR_SPECS, type CarKind } from "../sim";
import { createSample, isBridge, getPieceDef, GROOVE_SPACING, pathLength, samplePath, TRACK_WIDTH, type PieceTypeId } from "../track";

/** Top-down SVG of a piece, generated from its path data. */
export function pieceIcon(type: PieceTypeId): string {
  const def = getPieceDef(type, false);
  const s = createSample();
  const lines: { x: number; z: number }[][] = def.paths.map((p) => {
    const len = pathLength(p.geom);
    const n = p.geom.kind === "arc" ? 16 : 1;
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i <= n; i++) {
      samplePath(p.geom, (len * i) / n, s);
      pts.push({ x: s.x, z: s.z });
    }
    return pts;
  });
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const all = lines.flat();
  if (all.length === 0) all.push({ x: 0, z: 0 });
  for (const p of all) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const pad = TRACK_WIDTH / 2 + 6;
  const w = maxX - minX + pad * 2;
  const h = maxZ - minZ + pad * 2;
  const size = Math.max(w, h);
  const ox = minX - pad - (size - w) / 2;
  const oz = minZ - pad - (size - h) / 2;
  const d = (pts: { x: number; z: number }[], offset = 0) =>
    pts
      .map((p, i) => {
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
        const hx = next.x - prev.x;
        const hz = next.z - prev.z;
        const l = Math.hypot(hx, hz) || 1;
        const x = p.x - (hz / l) * offset;
        const z = p.z + (hx / l) * offset;
        // SVG y grows downward; flip z so left turns read as left turns from above.
        return `${i ? "L" : "M"}${(x - ox).toFixed(1)} ${(size - (z - oz)).toFixed(1)}`;
      })
      .join(" ");

  let body = "";
  if (type === "riser") {
    body = `<rect x="${size / 2 - 23}" y="${size / 2 - 23}" width="46" height="46" rx="6" fill="#e3bf8c" stroke="#a07447" stroke-width="3"/>`;
  } else {
    for (const pts of lines) body += `<path d="${d(pts)}" stroke="#a07447" stroke-width="${TRACK_WIDTH + 4}" fill="none" stroke-linecap="butt"/>`;
    for (const pts of lines) body += `<path d="${d(pts)}" stroke="#e8c896" stroke-width="${TRACK_WIDTH - 2}" fill="none" stroke-linecap="butt"/>`;
    for (const pts of lines)
      for (const g of [-GROOVE_SPACING / 2, GROOVE_SPACING / 2]) body += `<path d="${d(pts, g)}" stroke="#a5784b" stroke-width="5" fill="none"/>`;
    if (def.paths.some((p) => p.to === null)) {
      const end = lines[0][lines[0].length - 1];
      body += `<rect x="${end.x - ox + 10}" y="${size - (end.z - oz) - 22}" width="16" height="44" rx="4" fill="${type === "buffer-turnback" ? "#e6b52c" : "#c8442f"}"/>`;
      if (type === "buffer-turnback") body += `<path d="M${end.x - ox + 18} ${size - (end.z - oz) - 22} l14 6 -14 6z" fill="#c8442f"/>`;
    }
    if (def.paths[0]?.geom.rise) body += `<text x="${size / 2}" y="${size - 8}" font-size="${size / 6}" text-anchor="middle" fill="#7a5532" font-family="system-ui" font-weight="700">▲</text>`;
    if (isBridge(type)) body += `<text x="${size / 2}" y="${size - 8}" font-size="${size / 7}" text-anchor="middle" fill="#7a5532" font-family="system-ui" font-weight="700">⌒</text>`;
  }
  return `<svg viewBox="0 0 ${size.toFixed(1)} ${size.toFixed(1)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

const CAR_COLORS: Record<CarKind, [string, string]> = {
  engine: ["#2d6b3f", "#c8442f"],
  hopper: ["#e6b52c", "#2f6db5"],
  passenger: ["#2f6db5", "#f0ebe0"],
  caboose: ["#c8442f", "#f0ebe0"],
  timber: ["#e3bf8c", "#c8442f"],
};

/** Side-view SVG of a car or a short train. */
export function trainIcon(kinds: readonly CarKind[]): string {
  let x = 4;
  let body = "";
  for (const k of kinds) {
    const L = CAR_SPECS[k].length * 0.9;
    const [main, trim] = CAR_COLORS[k];
    body += `<rect x="${x}" y="46" width="${L}" height="8" rx="2" fill="#e3bf8c"/>`;
    if (k === "engine") {
      body += `<rect x="${x + L * 0.38}" y="26" width="${L * 0.55}" height="20" rx="9" fill="${main}"/>`;
      body += `<rect x="${x + 4}" y="14" width="${L * 0.34}" height="32" rx="3" fill="${main}"/>`;
      body += `<rect x="${x}" y="11" width="${L * 0.42}" height="5" rx="2" fill="${trim}"/>`;
      body += `<rect x="${x + L * 0.7}" y="12" width="8" height="15" rx="2" fill="#222"/>`;
    } else if (k === "timber") {
      // Flat deck with four red stakes.
      body += `<rect x="${x + 2}" y="40" width="${L - 4}" height="6" rx="2" fill="${main}"/>`;
      for (const sx of [x + 6, x + 16, x + L - 20, x + L - 10]) body += `<rect x="${sx}" y="26" width="4" height="15" rx="1.5" fill="${trim}"/>`;
    } else {
      body += `<rect x="${x + 4}" y="${k === "hopper" ? 28 : 22}" width="${L - 8}" height="${k === "hopper" ? 18 : 24}" rx="3" fill="${main}"/>`;
      if (k === "hopper") body += `<ellipse cx="${x + L / 2}" cy="28" rx="${L / 2 - 8}" ry="5" fill="#222"/>`;
      else body += `<rect x="${x + 1}" y="18" width="${L - 2}" height="5" rx="2" fill="${trim}"/>`;
    }
    for (const wx of [x + L * 0.22, x + L * 0.78]) body += `<circle cx="${wx}" cy="56" r="6" fill="#b8432f"/>`;
    x += L + 4;
  }
  return `<svg viewBox="0 0 ${x + 4} 66" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

const UI_PATHS = {
  undo: `<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H11"/>`,
  redo: `<path d="m15 7 4.5 4.5L15 16"/><path d="M19 11.5H9.5a5 5 0 0 0 0 10H13"/>`,
  pause: `<rect x="6.5" y="5" width="3.6" height="14" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.4" fill="currentColor" stroke="none"/>`,
  play: `<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5a.8.8 0 0 0-1.2.7Z" fill="currentColor" stroke="none"/>`,
  sound: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke-linejoin="round"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>`,
  mute: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke-linejoin="round"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>`,
  menu: `<path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h14"/>`,
} as const;

export type UiIcon = keyof typeof UI_PATHS;

/** A small line icon for the top bar, drawn in the current text colour. */
export function uiIcon(name: UiIcon): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_PATHS[name]}</svg>`;
}
