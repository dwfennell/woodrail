import { describe, expect, it } from "vitest";
import { sharePower } from "./power";
import { sparkView } from "./spark-text";

const names = { engine: (id: number) => (id === 6 ? "Pip" : ""), yard: () => "Sawmill" };

describe("sparkView", () => {
  it("shows spare of made, and where the sparks come from", () => {
    const v = sparkView(sharePower(1, 1, [1, 2], []), names);
    expect(v.label).toBe("3/5");
    expect(v.short).toBe(0);
    expect(v.lines[0].text).toBe("⚡ 5 sparks made: 4 from coal (1 power station), 1 from the wind (1 turbine)");
    expect(v.lines.map((l) => l.text)).toContain("🚂 Electric engines: 2, all powered");
    expect(v.lines.at(-1)!.text).toMatch(/^3 spare/);
  });

  it("counts down to none spare", () => {
    const v = sparkView(sharePower(1, 1, [1, 2, 3, 4, 5], []), names);
    expect(v.label).toBe("0/5");
    expect(v.lines.at(-1)!.text).toBe("None spare: all in use");
  });

  it("goes below 0 at a shortfall and names what goes without", () => {
    const v = sparkView(sharePower(1, 1, [1, 2, 3, 4, 5, 6], []), names);
    expect(v.label).toBe("−1/5");
    expect(v.short).toBe(1);
    const warn = v.lines.find((l) => l.warn)!;
    expect(warn.text).toBe("1 spark short. Pip runs at steam speed.");
    const unnamed = sparkView(sharePower(1, 1, [1, 2, 3, 4, 5, 7], [9]), names);
    expect(unnamed.label).toBe("−2/5");
    expect(unnamed.lines.find((l) => l.warn)!.text).toBe("2 sparks short. The last electric engine runs at steam speed; the sawmill waits for a spark.");
  });

  it("with no sparks made says to bring coal; the key follows what's shown", () => {
    const none = sparkView(sharePower(0, 0, [1], []), names);
    expect(none.label).toBe("−1/0");
    expect(none.lines[0].text).toMatch(/No sparks made/);
    expect(sparkView(sharePower(1, 0, [], []), names).key).not.toBe(sparkView(sharePower(1, 1, [], []), names).key);
  });
});
