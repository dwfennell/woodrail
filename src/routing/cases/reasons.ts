/**
 * Why a known case (known.ts) is known, where it's a decision rather than a fault to fix now: shown in its test's title
 * and the table. By case id. (The user's (a), 2026-11-13, a train may follow a line-mate into a line end and turn behind
 * it, took decision 4's convoy cases off this list.)
 */
const BOOKING_AHEAD =
  "waits for booking ahead (the reservation core): three line ends off one set of points, trains trading places through a spare one, need swaps planned several moves ahead; a train waiting deep in the spare with another stepped aside in front of it got out only if its stop was free just then, and it never was (claude/routing-zero-spare3, parked 2026-11-13)";

const PUT_DOWN_ON_POINTS =
  "put down by the player across a loop's points at both ends, facing each other over a road too short for either to clear them: dead, and one stands on points whatever it does; each brakes from its starting speed a few cm before they meet, past the judge's never-moved allowance. A train that stood still sooner stopped running trains on the bug maps too, for trains only passing the points";

export const REASONS: Record<string, string> = {
  "line1 2×hand opposed facing": PUT_DOWN_ON_POINTS,
  "siding-spare 3×one same": BOOKING_AHEAD,
  "terminus-spare 3×one opposed": BOOKING_AHEAD,
  "terminus-spare 3×one same": BOOKING_AHEAD,
  "wye-spare 3×one opposed": BOOKING_AHEAD,
  "wye-spare 3×one same": BOOKING_AHEAD,
  "fuzz seed 19": BOOKING_AHEAD,
};
