import { describe, expect, it } from "vitest";
import { BLUEPRINTS, BRANCHES, describeNeed, describePrice } from "./blueprints";
import { Progress } from "./progress";
import { built, ready, seenOf, techOf, unlocksOf } from "./tech";
import { THING_RULES } from "./things";

describe("the blueprint catalogue", () => {
  it("has unique ids, real branches and real prerequisites, and no loops", () => {
    const ids = new Set(BLUEPRINTS.map((b) => b.id));
    expect(ids.size).toBe(BLUEPRINTS.length);
    const branches = new Set(BRANCHES.map((b) => b.id));
    for (const b of BLUEPRINTS) {
      expect(branches.has(b.branch), b.id).toBe(true);
      for (const n of b.needs) expect(ids.has(n), `${b.id} needs ${n}`).toBe(true);
    }
    const seen = new Set<string>();
    const visit = (id: string, path: string[]) => {
      expect(path.includes(id), `loop: ${[...path, id].join(" → ")}`).toBe(false);
      if (seen.has(id)) return;
      for (const n of techOf(id)!.needs) visit(n, [...path, id]);
      seen.add(id);
    };
    for (const b of BLUEPRINTS) visit(b.id, []);
  });

  it("what's built needs only what's built, can be reached, and brings something; what's planned brings nothing yet", () => {
    for (const b of BLUEPRINTS.filter(built)) {
      for (const n of b.needs) expect(built(techOf(n)!), `${b.id} needs planned ${n}`).toBe(true);
      expect(b.requires.some((r) => r.kind === "place"), `${b.id} can't be checked`).toBe(false);
      expect(unlocksOf(b.id).length + (b.feature ? 1 : 0), b.id).toBeGreaterThan(0);
    }
    for (const rule of Object.values(THING_RULES)) if (rule!.tech) expect(built(techOf(rule!.tech)!), rule!.label).toBe(true);
  });

  it("nothing planned can be learned, however much is done", () => {
    const p = Progress.fresh();
    for (const b of BLUEPRINTS) if (built(b)) p.learned.add(b.id);
    p.riders = 10_000;
    p.bestLevel = 4;
    for (const b of BLUEPRINTS.filter((x) => !built(x))) expect(ready(p, b.id), b.id).toBe(false);
  });

  it("quarries wait for mills and a school beside a city (no school or library blueprint any more)", () => {
    const p = Progress.fresh();
    p.learned.add("farming");
    p.learned.add("mills");
    expect(ready(p, "quarries")).toBe(false);
    p.landmarks.add("city-school");
    expect(ready(p, "quarries")).toBe(true);
  });

  it("a new player sees the key blueprints, a ? next to them, and nothing further; learning shows more", () => {
    const p = Progress.fresh();
    let seen = seenOf(p);
    expect(seen.get("switches")).toBe("shown");
    expect(seen.get("signals")).toBe("shown"); // key, coming soon
    expect(seen.get("telegraph")).toBe("hint"); // after signals
    expect(seen.get("radio")).toBe("unseen");
    p.learned.add("switches");
    p.learned.add("passengers");
    seen = seenOf(p);
    expect(seen.get("junctions")).toBe("shown");
    expect(seen.get("dining")).toBe("shown");
  });

  it("an old save's risers and loops come back as bridges and junctions", () => {
    // (An old save's board, and its school and library blueprints, are dropped.)
    const p = Progress.fromJSON({ owned: [], learned: ["switches", "heights", "loops", "school", "library"], board: ["loops"] });
    expect([...p.learned].sort()).toEqual(["bridges", "junctions", "switches"]);
    expect("board" in p.toJSON()).toBe(false);
  });

  it("describes prices and requirements in words", () => {
    expect(describePrice({ planks: 16, coins: 40 })).toBe("16 planks + 40 coins");
    expect(describePrice({ coins: 60, goods: { iron: 10 } })).toBe("10 iron + 60 coins");
    expect(describeNeed({ kind: "count", stat: "loadsMoved", n: 200 })).toBe("200 loads moved");
    expect(describeNeed({ kind: "level", level: 4, towns: 3 })).toBe("3 cities ★");
  });
});
