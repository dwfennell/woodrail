import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { HaulLog } from "../economy/history";
import { agoText, amountText, historyView, spanText } from "./history-text";

const names: Record<number, string> = { 1: "Forest", 2: "Sawmill", 3: "Larkfield" };
const nameOf = (id: number) => names[id] ?? "?";

describe("the History sheet's words", () => {
  it("say amounts, spans and how long ago", () => {
    expect(amountText(CARGO.log.index, 3)).toBe("3 🪵 logs");
    expect(amountText(40, 1)).toBe("1 🧑 person");
    expect(spanText(40)).toBe("40 s");
    expect(spanText(150)).toBe("3 min");
    expect(spanText(3900)).toBe("1 h 5 min");
    expect(agoText(100, 120)).toBe("just now");
    expect(agoText(0, 300)).toBe("5 min ago");
  });

  it("a row a visit, newest first: the pickup meant for the sawmill, the drop from the forest with its ride and coins", () => {
    const h = new HaulLog();
    let now = 0;
    h.clock = () => now;
    h.picked(9, 10, 1, "log", 2, true);
    h.picked(9, 10, 1, "log", 2, false);
    h.left(9);
    now = 120;
    h.dropped(9, 10, 2, "log", false);
    h.dropped(9, 10, 2, "log", true);
    h.left(9);
    now = 200;
    h.dropped(9, 11, 3, "planks", true, 0);
    h.paid(0, "planks", 1, 36);
    const v = historyView(h.trains.get(9), 230, nameOf);
    expect(v.summary).toBe("So far: 3 loads dropped off · +36🪙");
    expect(v.visits.map((r) => [r.name, r.ago])).toEqual([
      ["Larkfield", "just now"],
      ["Sawmill", "2 min ago"],
      ["Forest", "4 min ago"],
    ]);
    expect(v.visits[2].lines).toEqual([{ drop: false, text: "Picked up 2 🪵 logs → Sawmill", coins: 0 }]);
    expect(v.visits[1].lines).toEqual([{ drop: true, text: "Dropped 2 🪵 logs from Forest · 2 min", coins: 0 }]);
    expect(v.visits[0].lines[0]).toMatchObject({ drop: true, coins: 36 });
  });

  it("with nothing yet, says what will show", () => {
    expect(historyView(undefined, 0, nameOf)).toEqual({ summary: expect.stringMatching(/^Nothing moved yet/), visits: [] });
  });
});
