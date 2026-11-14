/**
 * Why a known case (known.ts) is known, where it's a decision rather than a fault to fix now: shown in its test's title
 * and the table. By case id. (The user's (a), 2026-11-13, a train may follow a line-mate into a line end and turn behind
 * it, took decision 4's convoy cases off this list.)
 */
const CALL_ON =
  "two trains fill the loop's roads, the third waits at the signal into their block, and they wait to leave into the block it stands in; the oracle runs them by letting a second train follow into that block behind the one at its far signal (permissive working), which today's block signals don't. The user said yes (2026-11-14) to the narrow form: one extra train, behind one standing at the block's far signal, fitting clear of the entry signal and of points: its own branch, last";

export const REASONS: Record<string, string> = {
  "ring1 3×one same sig:blocks2": CALL_ON,
};
