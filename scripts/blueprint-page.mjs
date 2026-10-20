// Make the blueprint roadmap page from the game's own catalogue, so the page and the game never disagree:
//   npm run blueprints:page   (writes docs/blueprints.html; publish it as the roadmap page)
// Node reads the TypeScript catalogue directly (it has no imports but types).
import { readFileSync, writeFileSync } from "node:fs";
import { BLUEPRINTS, BRANCHES, describeNeed } from "../src/game/blueprints.ts";

const here = new URL(".", import.meta.url);
const template = readFileSync(new URL("blueprint-page.template.html", here), "utf8");

/**
 * The page's cost tokens, from its research (goods brought to a school, and from tier 2 coins): p planks, c coins,
 * g: goods, f: something achieved, b: a building.
 */
function costTokens(b) {
  const t = [];
  const { goods, coins } = b.research;
  if (goods.planks) t.push(`p${goods.planks}`);
  for (const [good, n] of Object.entries(goods)) if (good !== "planks") t.push(`g:${n} ${good}`);
  if (coins) t.push(`c${coins}`);
  for (const n of b.requires) t.push(`${n.kind === "landmark" ? "b" : "f"}:${describeNeed(n)}`);
  return t.join(" ");
}

const data = {
  branches: BRANCHES,
  blueprints: BLUEPRINTS.map((b) => ({
    id: b.id,
    name: b.label,
    branch: b.branch,
    status: b.plan ?? "game",
    needs: b.needs,
    cost: costTokens(b),
    does: b.blurb,
    brings: b.brings,
  })),
  key: BLUEPRINTS.filter((b) => b.key).map((b) => b.id),
};
const out = new URL("../docs/blueprints.html", here);
writeFileSync(out, template.replace("/*BLUEPRINTS*/ { branches: [], blueprints: [], key: [] }", JSON.stringify(data)));
console.log(`wrote docs/blueprints.html: ${data.blueprints.length} blueprints, ${data.blueprints.filter((b) => b.status === "game").length} in the game`);
