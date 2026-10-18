import { aOrAn } from "../economy/goods";

/** A thing's label in a sentence: "Switch" -> "switch", "Y switch" stays (a letter that's a name). */
export function inSentence(label: string): string {
  return /^[A-Z](\s|$)/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/** "switch" -> "switches", "curved ramp" -> "curved ramps". */
export function plural(noun: string): string {
  return /(s|x|z|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
}

/**
 * What a blueprint lets you make, in a few words: "Make a switch or a Y switch at the workshop", "Make ramps and more
 * at the workshop".
 */
export function makesLine(labels: readonly string[]): string {
  const names = labels.map(inSentence);
  if (names.length === 1) return `Make ${aOrAn(names[0])} at the workshop`;
  if (names.length === 2) return `Make ${aOrAn(names[0])} or ${aOrAn(names[1])} at the workshop`;
  return `Make ${plural(names[0])} and more at the workshop`;
}
