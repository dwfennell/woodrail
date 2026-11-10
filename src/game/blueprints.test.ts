import { describe, expect, it } from "vitest";
import { BLUEPRINTS, BRANCHES, describeNeed, describePrice, needTag } from "./blueprints";
import { Progress } from "./progress";
import { ready, seenOf, TECHS, techOf, unlocksOf } from "./tech";
import { queueOf } from "./research";
import { ruleOf, THING_RULES } from "./things";

/** The rows once planned and never built, trimmed from the tree (2026-11-09): ideas on the design pages now. */
const TRIMMED = ["trade", "monorail", "racecourse", "zoo", "ski", "rocket", "launch"];

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

  it("every row needs only rows, brings something, and every thing's blueprint is a row (only what's in the game)", () => {
    for (const b of BLUEPRINTS) {
      for (const n of b.needs) expect(techOf(n), `${b.id} needs ${n}`).toBeDefined();
      expect(unlocksOf(b.id).length + (b.feature ? 1 : 0), b.id).toBeGreaterThan(0);
    }
    for (const rule of Object.values(THING_RULES)) if (rule!.tech) expect(techOf(rule!.tech), rule!.label).toBeDefined();
    // (The rows once planned and never built are gone from the tree: tree trim, 2026-11-09.)
    for (const id of TRIMMED) expect(techOf(id), id).toBeUndefined();
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
    expect(seen.get("routes")).toBe("shown"); // key (Signals and routes)
    expect(seen.get("signal-boxes")).toBe("hint"); // after signals and routes
    expect(seen.get("telegraph")).toBe("unseen"); // after signal boxes
    expect(seen.get("radio")).toBe("unseen");
    p.learned.add("switches");
    p.learned.add("passengers");
    seen = seenOf(p);
    expect(seen.get("junctions")).toBe("shown");
    expect(seen.get("dining")).toBe("shown");
  });

  it("Town hall and Park stay hidden till something next to them is learned", () => {
    const seen = seenOf(Progress.fresh());
    expect(seen.get("town-hall")).toBe("unseen");
    expect(seen.get("park")).not.toBe("shown");
  });

  it("every branch has a row (none left empty by the trim)", () => {
    for (const b of BRANCHES) expect(BLUEPRINTS.some((x) => x.branch === b.id), b.id).toBe(true);
  });

  it("an old save naming the trimmed rows loads: they're dropped from learned, the queue, set-aside and early goods; the rest kept", () => {
    const data = {
      owned: [],
      learned: ["switches", "trade", "harbours", "rocket"],
      coins: 120,
      research: {
        current: "rocket",
        next: "trade",
        later: ["zoo", "tank", "monorail", "racecourse"],
        got: [["planks", 3]],
        study: 4,
        held: [["ski", { got: [["planks", 2]], study: 1 }], ["bridges", { got: [["planks", 1]], study: 0 }]],
        early: [["launch", [["planks", 5]]], ["junctions", [["planks", 2]]]],
      },
    };
    const p = Progress.fromJSON(JSON.parse(JSON.stringify(data)));
    expect([...p.learned].sort()).toEqual(["harbours", "switches"]);
    expect(p.coins).toBe(120);
    const r = p.research;
    expect(queueOf(r).filter((id) => TRIMMED.includes(id))).toEqual([]);
    expect(r.current === null || !TRIMMED.includes(r.current)).toBe(true);
    expect(queueOf(r)).toContain("tank");
    expect([...r.held.keys()]).toEqual(["bridges"]);
    expect([...r.early.keys()]).toEqual(["junctions"]);
    // And it saves and loads again as it is, naming none of them.
    const again = JSON.stringify(Progress.fromJSON(JSON.parse(JSON.stringify(p.toJSON()))).toJSON());
    for (const id of TRIMMED) expect(again.includes(`"${id}"`), id).toBe(false);
    expect(again).toBe(JSON.stringify(p.toJSON()));
  });

  it("an old save's risers and loops come back as bridges and junctions", () => {
    // (An old save's board, and its school and library blueprints, are dropped.)
    const p = Progress.fromJSON({ owned: [], learned: ["switches", "heights", "loops", "school", "library"], board: ["loops"] });
    expect([...p.learned].sort()).toEqual(["bridges", "junctions", "switches"]);
    expect("board" in p.toJSON()).toBe(false);
  });

  it("an old save's Signals or Train routes comes back as Signals and routes, learned and in the research queue", () => {
    expect(techOf("signals")).toBeUndefined();
    expect(techOf("routes")!.label).toBe("Signals and routes");
    expect(ruleOf("piece:signal")!.tech).toBe("routes");
    // Either learned: the merged row learned (its Signal known, the routes' engine card too).
    for (const learned of [["switches", "signals"], ["switches", "routes"], ["switches", "signals", "routes"]]) {
      const p = Progress.fromJSON({ owned: [], learned });
      expect([...p.learned].sort(), learned.join()).toEqual(["routes", "switches"]);
      expect(p.knows("piece:signal"), learned.join()).toBe(true);
      expect(JSON.stringify(p.toJSON().learned)).not.toContain("signals");
    }
    // Signals in research (its goods given kept), Train routes queued after it: the one row, once.
    const q = Progress.fromJSON({ owned: [], learned: ["switches"], research: { current: "signals", next: "routes", later: ["bridges", "signals"], got: [["planks", 3]], study: 0 } });
    expect([q.research.current, ...queueOf(q.research)]).toEqual(["routes", "bridges"]);
    expect(q.research.got).toEqual({ planks: 3 });
    // Signals queued behind something else: the merged row in its place.
    const r = Progress.fromJSON({ owned: [], learned: ["switches"], research: { current: "bridges", next: "signals", got: [], study: 0 } });
    expect([r.research.current, ...queueOf(r.research)]).toEqual(["bridges", "routes"]);
    // Signals learned, Train routes still in research: learned, and out of the queue.
    const s = Progress.fromJSON({ owned: [], learned: ["switches", "signals"], research: { current: "routes", next: "bridges", got: [["planks", 2]], study: 0 } });
    expect(s.learned.has("routes")).toBe(true);
    expect([s.research.current, ...queueOf(s.research)].filter(Boolean)).toEqual(["bridges"]);
    // Nothing needs the old id any more.
    for (const t of TECHS) expect(t.needs, t.id).not.toContain("signals");
  });

  it("describes prices and requirements in words", () => {
    expect(describePrice({ planks: 16, coins: 40 })).toBe("16 planks + 40 coins");
    expect(describePrice({ coins: 60, goods: { iron: 10 } })).toBe("10 iron + 60 coins");
    expect(describeNeed({ kind: "count", stat: "loadsMoved", n: 200 })).toBe("200 loads moved");
    expect(describeNeed({ kind: "level", level: 4, towns: 3 })).toBe("3 cities ★");
    // A locked card's tag in the web, short (QA 2026-11-05 #5).
    expect(needTag({ kind: "level", level: 3 })).toBe("🏙️ A city");
    expect(needTag({ kind: "delivered", good: "furniture", n: 30 })).toBe("📦 30 furniture");
    expect(needTag({ kind: "count", stat: "loadsMoved", n: 200 })).toBe("200 loads moved");
  });
});
