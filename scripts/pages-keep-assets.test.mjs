import { describe, expect, it } from "vitest";
import { namedAssets, plan } from "./pages-keep-assets.mjs";

const DAY = 86400_000;
const NOW = Date.parse("2026-11-23T12:00:00Z");
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

describe("pages-keep-assets plan", () => {
  it("fetches the old deploys' files this build doesn't have, once each", () => {
    const current = { "assets/index-NEW.js": 10, "assets/three-SAME.js": 5 };
    const history = [
      { sha: "b", at: at(0.1), files: { "assets/index-B.js": 10, "assets/three-SAME.js": 5, "assets/board-B.js": 2 } },
      { sha: "a", at: at(1), files: { "assets/index-A.js": 10, "assets/board-B.js": 2 } },
    ];
    const p = plan(history, current, NOW);
    expect(p.keep.map((d) => d.sha)).toEqual(["b", "a"]);
    expect(p.fetch.sort()).toEqual(["assets/board-B.js", "assets/index-A.js", "assets/index-B.js"]);
    expect(p.bytes).toBe(22);
  });

  it("drops deploys older than a week, past the count, or past the bytes", () => {
    const history = [
      { sha: "c", at: at(1), files: { "assets/c.js": 100 } },
      { sha: "b", at: at(2), files: { "assets/b.js": 100 } },
      { sha: "a", at: at(8), files: { "assets/a.js": 1 } },
    ];
    expect(plan(history, {}, NOW).keep.map((d) => d.sha)).toEqual(["c", "b"]);
    expect(plan(history, {}, NOW, { maxDeploys: 1 }).keep.map((d) => d.sha)).toEqual(["c"]);
    expect(plan(history, {}, NOW, { maxBytes: 150 }).keep.map((d) => d.sha)).toEqual(["c"]);
    expect(plan([{ sha: "x", at: "nonsense", files: {} }], {}, NOW).keep).toEqual([]);
  });

  it("finds the hashed files a built page and script name", () => {
    const html = '<script type="module" src="/woodrail/assets/index-BmW2Lak2.js"></script><link href="/woodrail/assets/index-BOeMPIp4.css">';
    const js = 'm.f||(m.f=["assets/blueprint-board-Cfu4DaBo.js","assets/goods-D30us8zX.js"]);import(`./credits-sheet-C83geEP1.js`);new URL("./far-worker-D566b-5g.js",import.meta.url);"./models/x.glb"';
    expect([...namedAssets(html)].sort()).toEqual(["assets/index-BOeMPIp4.css", "assets/index-BmW2Lak2.js"]);
    expect([...namedAssets(js)].sort()).toEqual(["assets/blueprint-board-Cfu4DaBo.js", "assets/credits-sheet-C83geEP1.js", "assets/far-worker-D566b-5g.js", "assets/goods-D30us8zX.js"]);
  });
});
