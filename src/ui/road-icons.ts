import type { RoadPieceId } from "../roads";

const BOARD = "#e3bf8c";
const FELT = "#8d8a82";
const PAINT = "#f6f1e6";
/** Board and felt half-widths in a 72-unit square (as the pieces are built, in mm). */
const B = 30;
const F = 24;

/** The road from the square's west edge (x = 0) along to `x1`, `half` either side of the middle. */
const run = (half: number, x1 = 72) => `<rect x="0" y="${36 - half}" width="${x1}" height="${2 * half}"/>`;
const arm = (half: number) => `<rect x="${36 - half}" y="${36 + half}" width="${2 * half}" height="${36 - half}"/>`;
const ring = (half: number) => `<path d="M0 ${36 - half} A${36 + half} ${36 + half} 0 0 1 ${36 + half} 72 L${36 - half} 72 A${36 - half} ${36 - half} 0 0 0 0 ${36 + half}Z"/>`;
const end = (half: number) => `<path d="M0 ${36 - half} L36 ${36 - half} A${half} ${half} 0 0 1 36 ${36 + half} L0 ${36 + half}Z"/>`;

function shape(piece: RoadPieceId, half: number): string {
  switch (piece) {
    case "straight":
    case "zebra":
      return run(half);
    case "curve":
      return ring(half);
    case "tee":
      return run(half) + arm(half);
    case "cross":
      return run(half) + `<rect x="${36 - half}" y="0" width="${2 * half}" height="72"/>`;
    case "end":
      return end(half);
  }
}

function paint(piece: RoadPieceId): string {
  const dash = (x: number) => `<rect x="${x - 5}" y="35" width="10" height="2.4"/>`;
  switch (piece) {
    case "straight":
      return [12, 36, 60].map(dash).join("");
    case "curve":
      return `<path d="M0 36 A36 36 0 0 1 36 72" fill="none" stroke="${PAINT}" stroke-width="2.4" stroke-dasharray="10 8.8" stroke-dashoffset="-4"/>`;
    case "tee":
      return [12, 60].map(dash).join("") + [16, 24, 32, 40, 48, 56].map((x) => `<rect x="${x - 2.5}" y="${36 + F + 1}" width="5" height="2"/>`).join("");
    case "end":
      return dash(12);
    case "zebra":
      return [-20, -12, -4, 4, 12, 20].map((z) => `<rect x="24" y="${36 + z - 2}" width="24" height="4"/>`).join("");
    case "cross":
      return "";
  }
}

/** Top-down SVG of a road piece on its square, as it comes out of the tray. */
export function roadIcon(piece: RoadPieceId): string {
  return (
    `<svg viewBox="-4 -4 80 80" xmlns="http://www.w3.org/2000/svg">` +
    `<g fill="${BOARD}" stroke="#a07447" stroke-width="1.5">${shape(piece, B)}</g>` +
    `<g fill="${FELT}">${shape(piece, F)}</g>` +
    `<g fill="${PAINT}">${paint(piece)}</g>` +
    `</svg>`
  );
}
