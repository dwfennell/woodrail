import boardSrc from "./blueprint-board.ts?raw";
import mainSrc from "../main.ts?raw";
import { describe, expect, it } from "vitest";
import { Progress } from "../game/progress";
import { deliver, pick } from "../game/research";
import { researchCard } from "../game/research-text";
import { HINT_W, layoutWeb, researchFoot, routeLinks, TAG_H, TAG_W, tagTitle, type Station } from "./blueprint-board";

const st = (id: string, branch: string, needs: string[] = []): Station => ({ id, label: id, blurb: "", branch, makes: [], state: "locked", seen: "shown", needs, price: "free", cost: "nothing", unlocks: "", requires: [] });

describe("the blueprint web", () => {
  it("puts each blueprint a column right of its furthest prerequisite, branches in bands, nothing overlapping", () => {
    const stations = [st("switches", "track"), st("junctions", "track", ["switches"]), st("routes", "logistics", ["switches"]), st("warehouses", "logistics", ["routes"]), st("harbours", "water", ["warehouses", "junctions"]), st("bridges", "track")];
    const web = layoutWeb(stations, ["track", "logistics", "water", "food"]);
    const at = (id: string) => web.at.get(id)!;
    expect(at("junctions").x).toBeGreaterThan(at("switches").x);
    expect(at("warehouses").x).toBeGreaterThan(at("routes").x);
    // Harbours follow their furthest prerequisite (warehouses), not the nearer one.
    expect(at("harbours").x).toBeGreaterThan(at("warehouses").x);
    // Bands in order, an empty branch (food) takes no room; each tag inside its own band.
    expect(web.bands.map((b) => b.id)).toEqual(["track", "logistics", "water"]);
    for (const s of stations) {
      const band = web.bands.find((b) => b.id === s.branch)!;
      expect(at(s.id).y).toBeGreaterThanOrEqual(band.top);
      expect(at(s.id).y).toBeLessThan(band.top + band.height);
    }
    const spots = stations.map((s) => `${at(s.id).x},${at(s.id).y}`);
    expect(new Set(spots).size).toBe(stations.length);
    expect(web.width).toBeGreaterThanOrEqual(Math.max(...stations.map((s) => at(s.id).x)) + TAG_W);
  });
});

describe("the web's arrows", () => {
  const tops = (d: string) => [...d.matchAll(/[MHVQ]/g)].map((m) => m[0]).join("");
  it("are laid like track: straight out, one turn in the gap between columns, straight in, never diagonal", () => {
    const stations = [st("a", "track"), st("b", "track", ["a"]), st("c", "track", ["a"]), st("d", "track", ["a"])];
    const web = layoutWeb(stations, ["track"]);
    const paths = routeLinks(web, ["b", "c", "d"].map((to) => ({ from: "a", to, fromW: TAG_W })));
    for (const [i, d] of paths.entries()) {
      const to = web.at.get(["b", "c", "d"][i])!;
      // Starts at a's right edge, ends at its card's left edge, both at the middle.
      expect(d.startsWith(`M${web.at.get("a")!.x + TAG_W} ${web.at.get("a")!.y + TAG_H / 2}`)).toBe(true);
      expect(d.endsWith(`H${to.x - 2}`)).toBe(true);
      expect(/^M(H|HQVQH)$/.test(tops(d))).toBe(true);
    }
    // All three leave the same card: one lane (they branch like points, not three lines side by side).
    const lanes = new Set(paths.filter((d) => d.includes("V")).map((d) => d.match(/Q([\d.]+) /)![1]));
    expect(lanes.size).toBe(1);
  });
  it("from different cards into one gap take lanes of their own, and a \"?\" leaves from its own small edge", () => {
    const stations = [st("a", "track"), st("b", "track"), st("c", "track", ["a", "b"]), st("e", "track", ["b"])];
    const web = layoutWeb(stations, ["track"]);
    const paths = routeLinks(web, [{ from: "a", to: "e", fromW: TAG_W }, { from: "b", to: "c", fromW: HINT_W }]);
    const lane = (d: string) => d.match(/Q([\d.]+) /)?.[1];
    const turned = paths.filter((d) => d.includes("V"));
    expect(new Set(turned.map(lane)).size).toBe(turned.length);
    expect(paths[1].startsWith(`M${web.at.get("b")!.x + (TAG_W + HINT_W) / 2} `)).toBe(true);
  });
  it("meet a \"?\" at the middle of its left edge: the token is centred in the slot of the tag it stands for", () => {
    const stations = [st("a", "track"), st("b", "track", ["a"])];
    const web = layoutWeb(stations, ["track"]);
    const [d] = routeLinks(web, [{ from: "a", to: "b", fromW: TAG_W, toW: HINT_W }]);
    const b = web.at.get("b")!;
    // The token: HINT_W square, its slot TAG_W × TAG_H; the arrow stops 2 px short of its edge, at its centre's height.
    expect(d.endsWith(`H${b.x + (TAG_W - HINT_W) / 2 - 2}`)).toBe(true);
    expect(web.at.get("a")!.y + TAG_H / 2).toBe(b.y + (TAG_H - HINT_W) / 2 + HINT_W / 2);
  });
  it("one across several columns never runs through a card", () => {
    // z needs a (column 1) and y (column 3: after x, after w), so it lands in column 4, on a's row, with x and y on
    // that row too: its straight goes down the gutter under the row instead of through them.
    const stations = [st("a", "track"), st("w", "track"), st("x", "track", ["w"]), st("y", "track", ["x"]), st("z", "track", ["a", "y"])];
    const web = layoutWeb(stations, ["track"]);
    const [d] = routeLinks(web, [{ from: "a", to: "z", fromW: TAG_W }]);
    // Walk the path: each straight along (H) checked against every card but its two ends.
    const nums = d.match(/[MHVQ]|-?[\d.]+/g)!;
    let x = 0, y = 0, runs = 0;
    for (let i = 0; i < nums.length; ) {
      const c = nums[i++];
      const n = () => Number(nums[i++]);
      if (c === "M") (x = n(), y = n());
      else if (c === "V") y = n();
      else if (c === "Q") (n(), n(), (x = n()), (y = n()));
      else if (c === "H") {
        const to = n();
        runs++;
        for (const [id, p] of web.at) {
          if (id === "a" || id === "z") continue;
          const across = Math.max(x, to) > p.x && Math.min(x, to) < p.x + TAG_W;
          expect(across && y > p.y - 2 && y < p.y + 48, `${d} crosses ${id}`).toBe(false);
        }
        x = to;
      }
    }
    expect(runs).toBeGreaterThan(1);
  });
});

describe("a research card's foot in the picker", () => {
  const SCHOOL = "Larkfield school";

  it("a ready card: its goods as chips, its study time, and one button, Research or Add to queue", () => {
    const p = Progress.fresh();
    p.learned.add("farming");
    const html = researchFoot("mills", researchCard(p, "mills", SCHOOL)!, false);
    expect(html).toContain(`<span class="bp-chip" title="Planks: 0 of 6 brought">\uE000 0/6</span><span class="bp-chip" title="Grain: 0 of 6 brought">🌾 0/6</span><span class="bp-chip short" title="Coins: 40, not enough yet">🪙 40</span>`);
    expect(html).toContain("⏱ 45 s study");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(`data-act="pick" data-id="mills">Research</button>`);
    pick(p, "switches");
    expect(researchFoot("mills", researchCard(p, "mills", SCHOOL)!, false)).toContain(">Add to queue</button>");
  });

  it("the one under way: a bar and how it stands, no button; one up next: Remove, and Research now (the swap)", () => {
    const p = Progress.fresh();
    pick(p, "bridges");
    deliver(p, "planks", 6);
    const now = researchFoot("bridges", researchCard(p, "bridges", SCHOOL)!, false);
    expect(now).not.toContain("<button");
    expect(now).toContain(`style="width:60%"`);
    expect(now).toContain("bring 4\uE000 to Larkfield school");
    pick(p, "switches");
    const next = researchFoot("switches", researchCard(p, "switches", SCHOOL)!, true);
    expect(next).toContain("Next up, after Bridges");
    // The goal's research: its button ringed.
    expect(next).toContain(`class="chip text primary bp-goal" data-act="now" data-id="switches">Research now</button>`);
    // Remove: the same tap that queued it (data-act pick, which toggles).
    expect(next).toContain(`data-act="pick" data-id="switches" title="Take it out of the queue">✕ Remove</button>`);
  });

  it("with no school the button is held and says why", () => {
    const html = researchFoot("switches", researchCard(Progress.fresh(), "switches", null)!, true);
    expect(html).toContain(`aria-disabled="true" title="Needs a school"`);
    expect(html).toContain(`<span class="bp-why">Needs a school</span>`);
    expect(html).not.toContain("bp-goal");
  });
});

describe("the P1 stopgap is gone", () => {
  it("the board has no pay-or-learn path: its handlers pick, and no card is offered or priced in planks", () => {
    expect(boardSrc).not.toMatch(/handlers\.learn|data-act="learn"|"offered"|affordable|planks/);
    expect(boardSrc).toContain(`handlers.pick(`);
    expect(mainSrc).not.toMatch(/tapResearch|researchLine|learn: \(id\) => picked/);
  });
});

describe("tooltips and the full cost (#11)", () => {
  const SCHOOL = "Larkfield school";
  it("a tag's tooltip names what it unlocks and everything it costs, in words", () => {
    expect(tagTitle({ label: "Mills", unlocks: "Mill, Van", cost: "6 \uE000 planks, 6 🌾 grain, 40 🪙 coins" })).toBe("Mills. Unlocks: Mill, Van. Costs: 6 \uE000 planks, 6 🌾 grain, 40 🪙 coins");
    expect(tagTitle({ label: "X", unlocks: "", cost: "nothing" })).toBe("X. Costs: nothing");
  });

  it("each chip and the study time have a tooltip in words", () => {
    const p = Progress.fresh();
    p.learned.add("farming");
    const html = researchFoot("mills", researchCard(p, "mills", SCHOOL)!, false);
    expect(html).toContain(`title="Planks: 0 of 6 brought"`);
    expect(html).toContain(`title="Grain: 0 of 6 brought"`);
    expect(html).toContain(`title="Coins: 40, not enough yet"`);
    expect(html).toContain(`title="Study time at the school, once the goods are in"`);
  });

  it("the ticket heads its pictures Unlocks: and shows the full cost (main passes both)", () => {
    expect(boardSrc).toContain(`<b class="bp-makes-head">Unlocks:</b>`);
    expect(boardSrc).toContain(`<div class="bp-full-cost"><b>Costs:</b>`);
    expect(mainSrc).toContain("cost: costWords(progress, t.id), unlocks: unlocksWords(t.id)");
  });
});

