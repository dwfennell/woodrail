/**
 * Why a known case (known.ts) is known, where it's a decision rather than a fault to fix now: shown in its test's title
 * and the table. By case id. (The user's (a), 2026-11-13, a train may follow a line-mate into a line end and turn behind
 * it, took decision 4's convoy cases off this list.)
 */
const BOOKING_AHEAD =
  "waits for booking ahead (the reservation core): three line ends off one set of points, trains trading places through a spare one, need swaps planned several moves ahead; a train waiting deep in the spare with another stepped aside in front of it got out only if its stop was free just then, and it never was (claude/routing-zero-spare3, parked 2026-11-13)";

const CALL_ON =
  "waits on the user's call-on question: two trains fill the loop's roads, the third waits at the signal into their block, and they wait to leave into the block it stands in; the oracle runs them by letting a second train follow into that block behind the one at its far signal (permissive working), which today's block signals don't";

export const REASONS: Record<string, string> = {
  "ring1 3×one same sig:blocks2": CALL_ON,
  "siding-spare 3×one same": BOOKING_AHEAD,
  "terminus-spare 3×one opposed": BOOKING_AHEAD,
  "terminus-spare 3×one same": BOOKING_AHEAD,
  "wye-spare 3×one opposed": BOOKING_AHEAD,
  "wye-spare 3×one same": BOOKING_AHEAD,
  "fuzz seed 19": BOOKING_AHEAD,
};
