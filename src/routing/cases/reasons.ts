/**
 * Why a known case (known.ts) is known, where it's a decision rather than a fault to fix now: shown in its test's title
 * and the table. By case id. (The user's (a), 2026-11-13, a train may follow a line-mate into a line end and turn behind
 * it, took decision 4's convoy cases off this list.)
 */
const SWAP_WYE =
  "the swap planner (swap-planner.ts) runs it, but slowly: trains trading places through the wye's spare end, one train moving at a time, every train stopping about every 70 s (10 minutes run: 8-9 stops each); but the line's trains wait on each other some 5 s before the last of them stands still, so the stall is said (stalls.ts, 5 s) before the planner starts (every train held 3 s), and the judge's run ends 20 s on. Waits on the user's call on how such a layout is judged";

const SWAP_ROUNDS =
  "the swap planner (swap-planner.ts) runs it, but slowly: three line ends off one set of points, trains trading places through a spare one, a round of the plan about 28 moves of about 5 s each (some 140 s), one train moving at a time; the judge asks a stop a train every 75 s and calls a train still for 60 s a deadlock. Waits on the user's call on how such a layout is judged";

const ROOM_RULE =
  "held by the line's room rule (too many trains for its loops: the card says lay a loop): two trains on three line ends, all of them stops, no spare; the oracle runs them, each turning at its own ends in turn, but the swap planner takes only a line with a spare end, leaving the room rule's hold standing where it holds (sections-qa's room cases). Overruling it so is the user's call";

const CALL_ON =
  "waits on the user's call-on question: two trains fill the loop's roads, the third waits at the signal into their block, and they wait to leave into the block it stands in; the oracle runs them by letting a second train follow into that block behind the one at its far signal (permissive working), which today's block signals don't";

export const REASONS: Record<string, string> = {
  "fuzz seed 19": ROOM_RULE,
  "ring1 3×one same sig:blocks2": CALL_ON,
  "siding-spare 3×one same": SWAP_ROUNDS,
  "terminus-spare 3×one opposed": SWAP_ROUNDS,
  "terminus-spare 3×one same": SWAP_ROUNDS,
  "wye-spare 3×one opposed": SWAP_WYE,
  "wye-spare 3×one same": SWAP_WYE,
};
