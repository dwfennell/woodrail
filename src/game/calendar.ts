/**
 * Game mode's calendar: the railway's own date, from January 2000, by game time (it stands still while paused). A month
 * every `MONTH_S` seconds of play: a year every 24 minutes, about seven and a half over a three-hour game (City, at
 * about 100 minutes, comes in the spring of 2004). Nothing to save: it's the session clock (`simSeconds`) read as a date.
 */

/** Seconds of play to a month. */
export const MONTH_S = 120;
/** The year the railway opens (in its January). */
export const START_YEAR = 2000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The date `seconds` of play in: its year and month (0 = January). */
export function dateOf(seconds: number): { year: number; month: number } {
  const months = Math.floor(Math.max(0, seconds) / MONTH_S);
  return { year: START_YEAR + Math.floor(months / 12), month: months % 12 };
}

/** The date `seconds` of play in, as shown: "Mar 2001". */
export function dateText(seconds: number): string {
  const { year, month } = dateOf(seconds);
  return `${MONTHS[month]} ${year}`;
}
