// The e2e selector's change classifier (scripts/e2e/lib/diff-kind.mjs) and what affected.mjs picks with it, on
// snippets and on real past commits (skipped when the clone doesn't reach them).
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { COPY_SMOKE, SMOKE, affected } from "./affected.mjs";
import { classifyCss, classifyJs, isProse, scanJs } from "./lib/diff-kind.mjs";

const git = (...a) => { try { return execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const has = (rev) => git("cat-file", "-e", `${rev}^{commit}`) !== null;
/** affected() for the change from `from` to `to`, read from git. */
function pick(from, to, { classify = true } = {}) {
  const paths = git("diff", "--name-only", from, to).trim().split("\n").filter(Boolean);
  const readers = { before: (p) => git("show", `${from}:${p}`), after: (p) => git("show", `${to}:${p}`) };
  const { want, light } = affected(paths, null, classify ? readers : null);
  return { suites: Object.fromEntries([...want].map(([s, g]) => [s, g === "all" ? "all" : [...g].sort()])), light };
}
const smokeOnly = Object.fromEntries(COPY_SMOKE.map((t) => t.split(":")).map(([s, g]) => [s, g.split(",").sort()]));

describe("scanJs", () => {
  it("drops comments, and keeps each literal's text apart from the code", () => {
    const s = scanJs('const a = "Hi there"; // note\n/* block */ const b = `x ${a + "y"} z`;');
    expect(s.code).not.toMatch(/note|block|Hi there/);
    expect(s.strings).toEqual(["Hi there", "x ", "y", " z"]);
  });
  it("tells a regex from a division, after TypeScript's ! and a postfix ++ too", () => {
    expect(scanJs("const r = /it's \"quoted\"/g.test(x);").strings).toEqual(["it's \"quoted\""]);
    const d = scanJs("const f = a! / b + (i++ / n) * c[0] / 2; const q = 'ok';");
    expect(d.strings).toEqual(["ok"]);
    expect(scanJs("if (!/a'b/.test(s)) return /c/;").strings).toEqual(["a'b", "c"]);
  });
  it("is null when it can't be sure (an unterminated string)", () => {
    expect(scanJs('const a = "open\n')).toBeNull();
  });
});

describe("isProse", () => {
  it("words are prose; names, class lists and selectors aren't", () => {
    for (const s of ["Delete cargo? Tap again", "🗑 Delete cargo", "Tipped out 3 🪵", "Stop the train first"]) expect(isProse(s), s).toBe(true);
    for (const s of ["asking", "coal", ".engine-card .empty-all", "feedback-small feedback-privacy", "keydown keyup", "Send", ""]) expect(isProse(s), s).toBe(false);
  });
});

describe("classifyJs", () => {
  it("comments only", () => {
    expect(classifyJs("// Throw away\nf(1);", "// Delete cargo\nf(1);").kind).toBe("comment");
  });
  it("a label's words: copy, naming the old and new words", () => {
    const c = classifyJs('chip("🗑 Throw away", "empty-all");', 'chip("🗑 Delete cargo", "empty-all");');
    expect(c).toEqual({ kind: "copy", strings: ["🗑 Throw away", "🗑 Delete cargo"] });
  });
  it("a class name, a key or a value in a string is code", () => {
    expect(classifyJs('b.classList.add("asking");', 'b.classList.add("ask");').kind).toBe("code");
    expect(classifyJs('if (kind === "coal") go();', 'if (kind === "logs") go();').kind).toBe("code");
  });
  it("a change to logic is code, words or not", () => {
    expect(classifyJs('toast("Saved");', 'toast("Saved"); save();').kind).toBe("code");
    expect(classifyJs('f(`${n} logs`);', 'f(`${n + 1} logs`);').kind).toBe("code");
  });
});

describe("classifyCss", () => {
  const before = "/* a */\n.card { display: flex; color: #333; }\n@media (max-width: 400px) { .card .b { padding: 4px; } }\n";
  it("comments only", () => {
    expect(classifyCss(before, before.replace("/* a */", "/* b */")).kind).toBe("comment");
  });
  it("a colour: paint, naming the rule's classes", () => {
    expect(classifyCss(before, before.replace("#333", "#6a4a2c"))).toEqual({ kind: "paint", classes: ["card"] });
  });
  it("a size, a new rule or a changed selector is code", () => {
    expect(classifyCss(before, before.replace("4px", "6px")).kind).toBe("code");
    expect(classifyCss(before, before + ".x { color: red; }").kind).toBe("code");
    expect(classifyCss(before, before.replace(".card {", ".card2 {")).kind).toBe("code");
  });
});

// (Each reads two commits' trees from git: a few seconds on a busy CI runner, past the 5 s default (unit 2/4, run 42471175121).)
describe("affected, on real commits", { timeout: 60_000 }, () => {
  it.skipIf(!has("92e325b5"))("92e325b5 (e2e train-summary: Delete cargo's words): train-summary and the copy smoke", () => {
    expect(pick("92e325b5^", "92e325b5").suites).toEqual({ "train-summary": "all", ...smokeOnly });
  });
  it.skipIf(!has("3651bd8"))("the Delete cargo landing (hud.ts's label, comments in main.ts and style.css): the same, not every HUD suite", () => {
    const now = pick("3651bd8^1", "3651bd8");
    expect(now.suites).toEqual({ "train-summary": "all", ...smokeOnly });
    expect(now.light.find((l) => l.path === "src/ui/hud.ts")?.kind).toBe("copy");
    expect(now.light.find((l) => l.path === "src/main.ts")?.kind).toBe("comment");
    // What it picked before the classifier: twenty suites or more.
    expect(Object.keys(pick("3651bd8^1", "3651bd8", { classify: false }).suites).length).toBeGreaterThanOrEqual(20);
  });
  it.skipIf(!has("f91ab50"))("f91ab50 (the feedback sheet's privacy words): only suites that assert those words, and the copy smoke", () => {
    const { suites, light } = pick("f91ab50^", "f91ab50");
    expect(light.find((l) => l.path === "src/ui/feedback-sheet.ts")?.kind).toBe("copy");
    expect(Object.keys(suites).length).toBeLessThanOrEqual(3);
  });
  it.skipIf(!has("1364338"))("1364338 (Signals UX, code): today's mapping, untouched", () => {
    const paths = git("diff", "--name-only", "1364338^", "1364338").trim().split("\n").filter(Boolean);
    const readers = { before: (p) => git("show", `1364338^:${p}`), after: (p) => git("show", `1364338:${p}`) };
    const code = affected(paths, null, readers).light.filter((l) => l.kind !== "comment").map((l) => l.path);
    expect(code.filter((p) => p.startsWith("src/"))).toEqual([]);
    expect(pick("1364338^", "1364338").suites.signals).toBe("all");
  });
  it("an unmapped path still gets the full smoke set", () => {
    const { want } = affected(["src/nowhere/new.ts"], null, { before: () => null, after: () => "export const a = 1;" });
    expect([...want.keys()].sort()).toEqual([...new Set(SMOKE.map((t) => t.split(":")[0]))].sort());
  });
});
