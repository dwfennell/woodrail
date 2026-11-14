/**
 * Why a known case (known.ts) is known, where it's a decision rather than a fault to fix now: shown in its test's title
 * and the table. By case id. (The user's (a), 2026-11-13, a train may follow a line-mate into a line end and turn behind
 * it, took decision 4's convoy cases off this list.)
 */
const SWAP_PLANNER =
  "waits for the swap planner (swap-planner.ts, routing-zero 2026-11-14): three line ends off one set of points, trains trading places through a spare one, need the right train sent into the spare at the right moment, moves ahead; one move at a time the rules hold, and stall. Booking track ahead (the redesign's step 5) wouldn't do it: reservations don't prevent too many trains on too few places (redesign §1.4)";

const PUT_DOWN_ON_POINTS =
  "put down by the player across a loop's points at both ends, facing each other over a road too short for either to clear them: dead, and one stands on points whatever it does; each brakes from its starting speed a few cm before they meet, past the judge's never-moved allowance. A train that stood still sooner stopped running trains on the bug maps too, for trains only passing the points";

const PUT_DOWN_ON_WYE =
  "the hand-run train put down with its front on the wye, heading round the ring at the routed train put down a piece away coming at it: its tail clears the wye only once its front is well onto the next piece, where the routed train already is, so it stands on the wye whatever the routed one does (stopping at once it still meets it there)";
const CALL_ON =
  "waits on the user's call-on question: two trains fill the loop's roads, the third waits at the signal into their block, and they wait to leave into the block it stands in; the oracle runs them by letting a second train follow into that block behind the one at its far signal (permissive working), which today's block signals don't";

export const REASONS: Record<string, string> = {
  "branch 2×mix opposed": PUT_DOWN_ON_WYE,
  "branch-spare 2×mix opposed": PUT_DOWN_ON_WYE,
  "ring1 3×one same sig:blocks2": CALL_ON,
  "line1 2×hand opposed facing": PUT_DOWN_ON_POINTS,
  "siding-spare 3×one same": SWAP_PLANNER,
  "terminus-spare 3×one opposed": SWAP_PLANNER,
  "terminus-spare 3×one same": SWAP_PLANNER,
  "wye-spare 3×one opposed": SWAP_PLANNER,
  "wye-spare 3×one same": SWAP_PLANNER,
  "fuzz seed 19": SWAP_PLANNER,
};
