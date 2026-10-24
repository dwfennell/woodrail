import { WORDS } from "./code-words";

/**
 * A cloud save's sync code: three words and four digits, `acorn-badge-otter-0420` (1024³ × 10⁴: about 43 bits). It's
 * the only key to the railway, so it's drawn with `crypto.getRandomValues`, and it's never put in a URL.
 */
export function newCode(random: (n: number) => number = randomBelow): string {
  const words = [0, 1, 2].map(() => WORDS[random(WORDS.length)]);
  return `${words.join("-")}-${String(random(10_000)).padStart(4, "0")}`;
}

const KNOWN = new Set(WORDS);

/**
 * A code as typed (any case, any spaces, dashes, dots or commas between: "Acorn badge, otter 0420"), as the Worker
 * wants it, or null if it isn't three of the words and four digits.
 */
export function parseCode(typed: string): string | null {
  const parts = typed.toLowerCase().match(/[a-z]+|\d+/g) ?? [];
  if (parts.length !== 4) return null;
  const [a, b, c, digits] = parts;
  if (![a, b, c].every((w) => KNOWN.has(w)) || !/^\d{4}$/.test(digits)) return null;
  return `${a}-${b}-${c}-${digits}`;
}

/** The code as shown: the words spaced out, easy to read aloud and to type ("acorn badge otter 0420"). */
export const showCode = (code: string): string => code.replace(/-/g, " ");

/** An integer in [0, n), evenly (n ≤ 2³²), from the browser's cryptographic randomness. */
function randomBelow(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}
