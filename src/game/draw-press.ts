/**
 * Does a press start drawing track (a line from a free end or on open ground, or a branch off a line's body)? Only
 * with the Draw chip on, and never while a train's route is being planned (`planning`: Interaction.onPickPlace is
 * set): then a press on a station or a depot picks it as a stop, and a stop's disc is tapped, as routes expect.
 */
export function pressDraws(drawing: boolean, planning: boolean): boolean {
  return drawing && !planning;
}
