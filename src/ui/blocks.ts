/** Lacquer colours for the letters, as on a set of toy alphabet blocks. */
const INKS = ["#c8442f", "#2f6fb5", "#e2a12b", "#3f8f4a"];

/**
 * A word spelled in wooden alphabet blocks: one beech cube per letter, each with its letter painted in a framed
 * face and set down slightly askew. Size them with the font size of the returned element (a block is 1em).
 * index.html spells "Woodrail" the same way for the loading screen, before scripts run.
 */
export function blockWord(text: string, cls = ""): HTMLElement {
  const word = document.createElement("span");
  word.className = `wood-blocks ${cls}`.trim();
  word.setAttribute("role", "img");
  word.setAttribute("aria-label", text);
  let n = 0;
  for (const ch of text.toUpperCase()) {
    if (ch === " ") {
      word.appendChild(Object.assign(document.createElement("span"), { className: "wb-gap" }));
      continue;
    }
    const b = document.createElement("span");
    b.className = "wb";
    b.appendChild(document.createElement("b")).textContent = ch;
    b.style.setProperty("--ink", INKS[n % INKS.length]);
    // A fixed scatter, so the same word always sits the same way.
    b.style.setProperty("--tilt", `${[-3, 2, -1.5, 3.5, -2.5, 1, -3.5, 2.5][n % 8]}deg`);
    b.style.setProperty("--lift", `${[0, -0.04, 0.02, -0.02, 0.03, -0.05, 0.01, -0.03][n % 8]}em`);
    b.style.setProperty("--i", String(n));
    word.appendChild(b);
    n++;
  }
  return word;
}
