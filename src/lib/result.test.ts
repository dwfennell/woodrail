import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "./result";

describe("Result", () => {
  it("ok carries a value", () => {
    const r: Result<number, string> = ok(3);
    expect(r).toEqual({ ok: true, value: 3 });
  });

  it("err carries an error", () => {
    const r: Result<number, string> = err("bad");
    expect(r).toEqual({ ok: false, error: "bad" });
  });

  it("narrows on the ok flag", () => {
    const r: Result<number, string> = ok(2);
    const doubled = r.ok ? r.value * 2 : 0;
    expect(doubled).toBe(4);
  });
});
