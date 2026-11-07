import { GOODS_ICON, type CargoKind } from "../economy/cargo";

/**
 * Beside a town's name: a count of plank bundles delivered (Sandbox), or what the town wants now with a bar filling
 * toward its next level (Game mode).
 */
export type SignBadge = { count: number } | { wants: CargoKind; got: number; of: number };

/** The good a badge pictures (its icon in the game's icon font, as on the town card) and the words beside it. */
export function signBadgeParts(badge: SignBadge): { kind: CargoKind; icon: string; text: string } {
  const kind: CargoKind = "count" in badge ? "planks" : badge.wants;
  return { kind, icon: GOODS_ICON[kind], text: "count" in badge ? String(badge.count) : `${badge.got}/${badge.of}` };
}

/** True if two badges show the same (a sign is painted again only when what it shows changes). */
export function sameBadge(a: SignBadge | null, b: SignBadge | null): boolean {
  if (!a || !b) return a === b;
  if ("count" in a || "count" in b) return "count" in a && "count" in b && a.count === b.count;
  return a.wants === b.wants && a.got === b.got && a.of === b.of;
}

/** The sign's canvas (px) and its cream rim's inner edge. */
const W = 512;
const H = 128;
const RIM = 14;
/** With a badge: the rule between the name and the badge, and the badge's own room (inside the rim, with a margin). */
const RULE_X = 330;
const BADGE_L = RULE_X + 12;
const BADGE_R = W - RIM - 10;

const NAME_FONT = (px: number) => `800 ${px}px Nunito, system-ui, sans-serif`;
const ICON_FONT = (px: number) => `${px}px "Woodrail Icons", Nunito, system-ui, sans-serif`;

/** Set the largest font from `max` down to `min` px at which `text` is no wider than `room`; its width. */
function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, max: number, min: number, room: number): number {
  let px = max;
  ctx.font = font(px);
  let w = ctx.measureText(text).width;
  while (px > min && w > room) {
    ctx.font = font(--px);
    w = ctx.measureText(text).width;
  }
  return w;
}

/** True once the icon font can draw on a canvas (no DOM, as in tests: nothing to wait for). */
export function iconFontReady(): boolean {
  if (typeof document === "undefined" || !document.fonts) return true;
  return document.fonts.check(ICON_FONT(48), GOODS_ICON.planks);
}

let fontLoad: Promise<unknown> | null = null;
/** Resolves once the icon font is loaded (loaded once, for every sign). */
export function loadIconFont(): Promise<unknown> {
  fontLoad ??= document.fonts.load(ICON_FONT(48), GOODS_ICON.planks).catch(() => undefined);
  return fontLoad;
}

/**
 * Paint a town's name board: its name, and its badge (see `SignBadge`): the good's icon, its count, and in Game mode
 * a bar. Each part is sized to stay inside the cream rim, whatever the count ("0/10", "33/33", "120/150").
 */
export function drawSign(canvas: HTMLCanvasElement, name: string, badge: SignBadge | null): void {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2f5d3a";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#f3e3c3";
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.fillStyle = "#f8efdc";
  ctx.textBaseline = "middle";
  if (!badge) {
    ctx.textAlign = "center";
    fit(ctx, name, NAME_FONT, 64, 40, W - 2 * RIM - 28);
    ctx.fillText(name, W / 2, 68, W - 2 * RIM - 28);
    return;
  }
  // The name in the left part, a faint rule, the badge in the right.
  const nameRoom = RULE_X - RIM - 24;
  ctx.textAlign = "center";
  fit(ctx, name, NAME_FONT, 64, 40, nameRoom);
  ctx.fillText(name, (RIM + RULE_X) / 2, 68, nameRoom);
  ctx.fillStyle = "rgba(243, 227, 195, 0.35)";
  ctx.fillRect(RULE_X - 2, 28, 4, H - 56);

  const { icon, text } = signBadgeParts(badge);
  const counted = "count" in badge;
  // A line of icon and count: centred on the sign alone (Sandbox), above the bar in Game mode.
  const y = counted ? 66 : 52;
  ctx.textAlign = "left";
  ctx.fillStyle = "#f8efdc";
  const iconW = Math.min(fit(ctx, icon, ICON_FONT, 48, 48, 60), 60);
  const iconFont = ctx.font;
  const gap = 6;
  const room = BADGE_R - BADGE_L - iconW - gap;
  const textW = fit(ctx, text, NAME_FONT, counted ? 44 : 38, 20, room);
  const textFont = ctx.font;
  // (The pair centred in the badge's room; at its widest it fills it.)
  const x = BADGE_L + Math.max(0, (BADGE_R - BADGE_L - iconW - gap - Math.min(textW, room)) / 2);
  ctx.font = iconFont;
  ctx.fillText(icon, x, y + 2);
  ctx.font = textFont;
  ctx.fillText(text, x + iconW + gap, y + 2, room);
  if (counted) return;
  // A bar filling toward its next level, the badge's whole width.
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(BADGE_L, 86, BADGE_R - BADGE_L, 16);
  ctx.fillStyle = "#f0b847";
  ctx.fillRect(BADGE_L, 86, Math.round(((BADGE_R - BADGE_L) * Math.min(badge.got, badge.of)) / Math.max(1, badge.of)), 16);
}
