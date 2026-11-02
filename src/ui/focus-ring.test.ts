import { describe, expect, it } from "vitest";
import { installFocusRing, KBD_NAV } from "./focus-ring";

function fake() {
  const listeners = new Map<string, (e: unknown) => void>();
  const classes = new Set<string>();
  const win = { addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, f) };
  const root = { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } };
  installFocusRing(win as never, root);
  return { fire: (t: string, e: unknown = {}) => listeners.get(t)!(e), classes };
}

describe("installFocusRing", () => {
  it("rings only after Tab, and a pointer press takes it away", () => {
    const f = fake();
    expect(f.classes.has(KBD_NAV)).toBe(false);
    f.fire("keydown", { key: "w" }); // a camera key after a click: no ring
    expect(f.classes.has(KBD_NAV)).toBe(false);
    f.fire("keydown", { key: "Tab" });
    expect(f.classes.has(KBD_NAV)).toBe(true);
    f.fire("keydown", { key: "Enter" }); // still the keyboard
    expect(f.classes.has(KBD_NAV)).toBe(true);
    f.fire("pointerdown");
    expect(f.classes.has(KBD_NAV)).toBe(false);
  });
});
