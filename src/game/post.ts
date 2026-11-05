import type { CargoKind, Economy } from "../economy";

/**
 * The post (Game mode's Post office blueprint): a small chain you can see in towns. Each town on the line posts sacks of
 * mail, quicker the bigger it is (`mailSeconds`); a mail van (the only wagon that carries mail or post) takes them to a
 * post office, which sorts them into post; towns buy the post at full pay, and a town that has had post gets red post
 * vans driving its streets (`TownCars`, `postVansFor`).
 *
 * Mail is posted only once Post office is learned and a post office stands on the map (`hasPostOffice`): before then a
 * town's mail pile stays empty, so old games and the balance harness play as before, and an idle map's state doesn't
 * change every second for mail nothing could take. Cheap: the economy looks at each town's mail once a second
 * (`Economy.mailEvery`).
 */

/** The blueprint that brings the post office, the mail van, and towns' mail. */
export const POST_TECH = "post-office";

/** Seconds between a town's sacks of mail by its level (hamlet, village, town, city, and beyond). */
export const MAIL_SECONDS: readonly number[] = [45, 36, 30, 24, 20];

/** Seconds between a town's sacks of mail at `level`. */
export function mailSeconds(level: number): number {
  return MAIL_SECONDS[Math.max(0, Math.min(MAIL_SECONDS.length - 1, level))];
}

/**
 * Sandbox's towns post mail as a Town does (`mailSeconds` at this level), once a post office stands on the map: no
 * research there, and Sandbox's towns don't grow, so one pace for all.
 */
export const SANDBOX_MAIL_LEVEL = 2;

/**
 * Seconds between a town depot's sacks of mail (0: it posts none): only at a town's station (a halt is a stop for its
 * people, not a second post box), only once the post is learned (always, in Sandbox), and only while a post office
 * stands on the map (no mail piling up for nothing that could take it).
 */
export function mailEveryAt(learned: boolean, atStation: boolean, office: boolean, level: number): number {
  return learned && atStation && office ? mailSeconds(level) : 0;
}

/** Post vans a town has at most. */
export const POST_VANS_PER_TOWN = 2;
/** A town's first post van comes with its first post; each further one this many sacks of post later. */
export const POST_VANS_EVERY = 10;

/** How many post vans drive the streets of a town that's had `n` sacks of post. */
export function postVansFor(n: number): number {
  return n <= 0 ? 0 : Math.min(POST_VANS_PER_TOWN, 1 + Math.floor((n - 1) / POST_VANS_EVERY));
}

/** Is there a post office on the map (its piece down)? Towns post mail only then. */
export function hasPostOffice(economy: Economy): boolean {
  return economy.allDepots().some((d) => d.role === "postoffice");
}

/** The town card's line about its post, or null before Post office is learned. */
export function postLine(learned: boolean, mailWaiting: number, postHad: number, office = true): string | null {
  if (!learned) return null;
  if (!office && mailWaiting === 0 && postHad === 0) return "Posts ✉️ mail once there's a post office";
  const waiting = mailWaiting > 0 ? `${mailWaiting} ✉️ mail to send` : "Posts ✉️ mail";
  const vans = postVansFor(postHad);
  const got = vans > 0 ? `${vans === 1 ? "a post van" : `${vans} post vans`} on its streets` : "a mail van takes it to a post office";
  return `${waiting} · ${got}`;
}

/** Is this good the post's (mail or post)? */
export const isPostal = (kind: CargoKind): boolean => kind === "mail" || kind === "post";
