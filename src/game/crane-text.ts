/** What a breakdown crane says (toasts), by what happened or why it couldn't go (src/economy/breakdown.ts). */
export const CRANE_TEXT = {
  /** A crane set out by itself for a derailed train. */
  auto: "🏗️ The breakdown crane is on its way",
  /** Sent from a stuck train's card. */
  sent: "🏗️ The breakdown crane is on its way to lift the train off",
  rerailed: "🏗️ The crane put the train back on the track",
  /** Put back with its levers as they were (`goes`): it carries on, a routed train along its route. */
  carriesOn: (name: string) => `🏗️ Back on the rails: ${name} carries on`,
  removed: "🏗️ The crane lifted the train off the line, back into the box",
  "no-crane": "Put a breakdown crane on the track first (an engine and a crane wagon)",
  busy: "The breakdown crane is busy, or on a line: take it off its line to send it",
  "no-way": "The breakdown crane can't find a way there",
  "on-its-way": "The breakdown crane is already on its way",
  blocked: "Something's in the breakdown crane's way: it stopped",
  "no-room": "No room to set the train down: the crane put it back where it lay",
} as const;
