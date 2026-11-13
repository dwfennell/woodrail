/**
 * Why a known case (known.ts) is known, where it's a decision rather than a fault to fix now: shown in its test's title
 * and the table. By case id. (The user's (a), 2026-11-13, a train may follow a line-mate into a line end and turn behind
 * it, took decision 4's convoy cases off this list.)
 */
const BOOKING_AHEAD =
  "waits for booking ahead (the reservation core): three line ends off one set of points, trains trading places through a spare one, need swaps planned several moves ahead; a train waiting deep in the spare with another stepped aside in front of it got out only if its stop was free just then, and it never was (claude/routing-zero-spare3, parked 2026-11-13)";

export const REASONS: Record<string, string> = {
  "siding-spare 3×one same": BOOKING_AHEAD,
  "terminus-spare 3×one opposed": BOOKING_AHEAD,
  "terminus-spare 3×one same": BOOKING_AHEAD,
  "wye-spare 3×one opposed": BOOKING_AHEAD,
  "wye-spare 3×one same": BOOKING_AHEAD,
  "fuzz seed 19": BOOKING_AHEAD,
};
