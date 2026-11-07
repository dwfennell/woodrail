import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, type PieceTypeId } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { FEATURE_TIPS, KEEPS_TIP, LEAVE_NOW_TIP, RING_TIP, SIDINGS_TIP, TipTracker, tipFor, TUNNELS_TIP, type TipContext } from "./feature-tips";
import { GOALS } from "./goals";
import { learnedText } from "./research-text";
import { buildStarterWorld, syncIndustries, type World } from "./world";
import { placeCardInfo } from "../ui/piece-info";
import { tipRowHtml } from "../ui/goals-panel";
import mainSrc from "../main.ts?raw";

const ctx = (o: Partial<TipContext> = {}): TipContext => ({ learned: new Set(), goalDone: () => false, queued: 0, waitingEngine: null, ringLine: null, ...o });
const learned = (...ids: string[]) => ctx({ learned: new Set(ids) });

/** The starter map, with a piece put down where the test says (as the tray would), its industry synced. */
function put(w: World, type: PieceTypeId, x = 0, z = 0): number {
  const id = w.layout.addPiece(type, { x, z, heading: 0 });
  syncIndustries(w);
  return id;
}

describe("feature tips: light onboarding for the systems after the core goals", () => {
  it("has a tip for each new system, each blueprint a real one, each line short", () => {
    const ids = FEATURE_TIPS.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["sidings", "tunnels", "jam", "chocolate", "toys", "tankers", "breakdown", "reading-room", "telegraph", "keeps", "leave-now", "ring-reverse"]));
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of FEATURE_TIPS) {
      if (t.tech) expect(BLUEPRINTS.some((b) => b.id === t.tech), t.id).toBe(true);
      expect(t.text.length, t.id).toBeLessThanOrEqual(100);
      expect(t.text, t.id).not.toMatch(/\.$/);
    }
    expect(tipFor("sidings")?.text).toBe(SIDINGS_TIP);
    expect(tipFor("tunnels")?.text).toBe(TUNNELS_TIP);
  });

  it("aren't goals: no tip is a goal", () => {
    for (const t of FEATURE_TIPS) expect(GOALS.some((g) => g.id === t.id), t.id).toBe(false);
  });

  it("shows nothing before a blueprint is learned; learned, its tip shows until it's used", () => {
    const w = buildStarterWorld();
    const tips = new TipTracker();
    expect(tips.update(w, ctx()).first).toBeNull();
    expect(tips.current()).toBeNull();
    tips.update(w, learned("tunnels"));
    expect(tips.current()?.id).toBe("tunnels");
    // A tunnel dug (its short mouths laid): the tip goes for good, even with the mouths taken up again.
    const a = put(w, "tunnel-mouth-short", 4000, 4000);
    tips.update(w, learned("tunnels"));
    expect(tips.isDone("tunnels")).toBe(true);
    expect(tips.current()).toBeNull();
    w.layout.removePiece(a);
    tips.update(w, learned("tunnels"));
    expect(tips.current()).toBeNull();
  });

  it("a goods chain's tip goes once its maker is placed", () => {
    const w = buildStarterWorld();
    const tips = new TipTracker();
    tips.update(w, learned("jam"));
    expect(tips.current()?.id).toBe("jam");
    expect(tips.current()!.guide(w, learned("jam"))).toMatchObject({ tab: "industries", shelf: "Industries" });
    put(w, "depot-jam", 3000, -3000);
    tips.update(w, learned("jam"));
    expect(tips.isDone("jam")).toBe(true);
  });

  it("Sidings: Show me opens an industry's card (the forest first)", () => {
    const w = buildStarterWorld();
    const tips = new TipTracker();
    tips.update(w, learned("sidings"));
    expect(tips.current()?.id).toBe("sidings");
    const g = tips.current()!.guide(w, learned("sidings"));
    expect(g.card).toBeDefined();
    expect(w.economy.depot(g.card!)?.role).toBe("forest");
    expect(g.marks).toHaveLength(1);
  });

  it("Tunnels: Show me frames a hill by the line, with the Straight shelf open", () => {
    const w = buildStarterWorld();
    const [a] = w.landscape.towns;
    let last = w.stations.get(a.id)!;
    for (let i = 0; i < 3; i++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
    const g = FEATURE_TIPS.find((t) => t.id === "tunnels")!.guide(w, learned("tunnels"));
    expect(g).toMatchObject({ tab: "track", shelf: "Straight" });
    expect(g.points.length).toBeGreaterThan(0);
  });

  it("reading room: done once two researches are queued; Show me opens the research board", () => {
    const w = buildStarterWorld();
    const tips = new TipTracker();
    tips.update(w, learned("reading-room"));
    expect(tips.current()?.id).toBe("reading-room");
    expect(tips.current()!.guide(w, learned("reading-room")).board).toBe(true);
    tips.update(w, { ...learned("reading-room"), queued: 1 });
    expect(tips.isDone("reading-room")).toBe(true);
  });

  it("one tip at a time, in the list's order; Got it moves on to the next", () => {
    const w = buildStarterWorld();
    const tips = new TipTracker();
    const c = learned("sidings", "tunnels", "breakdown");
    tips.update(w, c);
    expect(tips.current()?.id).toBe("sidings");
    tips.finish("sidings");
    tips.update(w, c);
    expect(tips.current()?.id).toBe("tunnels");
    const saved = tips.toJSON();
    expect(saved.done).toContain("sidings");
    // Kept across a reload; unknown ids dropped.
    const again = new TipTracker([...saved.done, "gone"], saved.shown);
    again.update(w, c);
    expect(again.current()?.id).toBe("tunnels");
    expect(again.toJSON().done).not.toContain("gone");
  });

  it("Leave now: shows while a train waits for a full load, toasted only the first time", () => {
    const w = buildStarterWorld();
    const tips = new TipTracker();
    expect(tips.update(w, ctx()).first).toBeNull();
    const waiting = ctx({ waitingEngine: 7 });
    const r = tips.update(w, waiting);
    expect(r.first?.id).toBe("leave-now");
    expect(tips.current()?.text).toBe(LEAVE_NOW_TIP);
    expect(tips.update(w, waiting).first).toBeNull();
    // The train went on: the tip goes till the next wait (then shows, without a toast).
    tips.update(w, ctx());
    expect(tips.current()).toBeNull();
    const back = new TipTracker([], tips.toJSON().shown);
    expect(back.update(w, waiting).first).toBeNull();
    expect(back.current()?.id).toBe("leave-now");
    back.finish("leave-now");
    back.update(w, waiting);
    expect(back.current()).toBeNull();
  });

  it("a ring line's Reverse: shows while one runs; the workshop's keeps wait for routes", () => {
    const w = buildStarterWorld();
    const tips = new TipTracker();
    tips.update(w, ctx({ ringLine: 2 }));
    expect(tips.current()?.text).toBe(RING_TIP);
    // Its Show me: that line's sheet (Reverse is in its ⋯ menu).
    expect(tips.current()!.guide(w, ctx({ ringLine: 2 })).line).toBe(2);
    tips.finish("ring-reverse");
    // No workshop yet: no keeps tip, routes or not.
    tips.update(w, ctx({ goalDone: (id) => id === "give-route" }));
    expect(tips.current()).toBeNull();
    expect(KEEPS_TIP).toMatch(/− and \+/);
  });

  it("main checks the tips with the goals, not per frame, and says each blueprint's tip on its Learned toast", () => {
    expect(mainSrc).toMatch(/checkStickers\(announce, fresh\.length > 0\);\s*checkTips\(announce\);/);
    expect(mainSrc).toContain("tip: tipText");
    expect(mainSrc).toContain('tips.finish("leave-now")');
    expect(mainSrc).toContain('tips.finish("ring-reverse")');
  });
});

describe("the Learned toast says the tip once", () => {
  it("adds the tip after the line, unless the line says it already (the blueprint's how)", () => {
    const t = learnedText({ label: "Tunnels", makes: "Make tunnel mouths and more at the workshop", blurb: "", tip: TUNNELS_TIP });
    expect(t.toast).toBe(`Learned Tunnels! Make tunnel mouths and more at the workshop · 💡 ${TUNNELS_TIP}`);
    expect(t.tipped).toBe(true);
    // Sidings' how is its tip's first clause: said once.
    const s = learnedText({ label: "Sidings", makes: "", how: "Tap an industry, then Second track", blurb: "", tip: SIDINGS_TIP });
    expect(s.toast).toBe("Learned Sidings! Tap an industry, then Second track");
    expect(s.tipped).toBe(false);
    // No tip: as before.
    expect(learnedText({ label: "Mills", makes: "", blurb: "Grind grain." }).toast).toBe("Learned Mills! Grind grain.");
  });
});

describe("the tip's row on the Goals tab", () => {
  it("names it, says what to do, with Show me and Got it", () => {
    const html = tipRowHtml({ id: "jam", title: "Jam kitchen", text: "Bring it <fruit> & sugar" });
    expect(html).toContain('class="goal feature-tip" data-feature-tip="jam"');
    expect(html).toContain("<b>New: Jam kitchen</b>");
    expect(html).toContain("Bring it &lt;fruit&gt; &amp; sugar");
    expect(html).toContain('class="chip text tip-show"');
    expect(html).toContain('class="chip text tip-done"');
  });
});

describe("tray help text for the new systems", () => {
  it("lineside furniture that works says what it does; the goods chains give their recipes", () => {
    expect(placeCardInfo({ kind: "prop", asset: "mech-telegraph-pole", label: "Telegraph pole" }).detail).toBe("A chain of poles carries a signal box's reach.");
    expect(placeCardInfo({ kind: "prop", asset: "bldg-signal-box", label: "Signal box" }).detail).toContain("points and signals");
    expect(placeCardInfo({ kind: "prop", asset: "scene-bus-stop", label: "Bus stop" }).detail).toContain("bus");
    expect(placeCardInfo({ kind: "piece", type: "depot-jam", label: "Jam kitchen" }).facts).toEqual(["Makes jam from fruit and sugar · every 12 s"]);
    expect(placeCardInfo({ kind: "piece", type: "depot-chocolate", label: "Chocolate factory" }).facts[0]).toMatch(/^Makes chocolate from cocoa and milk/);
    expect(placeCardInfo({ kind: "piece", type: "tunnel-mouth-short", label: "Short tunnel mouth" }).facts[0]).toMatch(/Long straight up to a hill/);
  });
});
