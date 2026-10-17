import { Color, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { KitView } from "./kit-view";
import type { Materials } from "./materials";
import { kitModelKey, PropLibrary } from "./props/library";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("KitView's moving parts", () => {
  it("a kit at rest is drawn whole; triggered, its parts are drawn live; let go, they settle and go", async () => {
    const lib = new PropLibrary(stubMaterials());
    await lib.load(kitModelKey("kit-castle-gate"));
    expect(lib.model(kitModelKey("kit-castle-gate", true))).toBeTruthy();
    expect(lib.moversOf("kit-castle-gate")).toBeDefined();
    const layout = new Layout();
    const gate = layout.addPiece("kit-castle-gate", { x: 100, z: 50, heading: 0.5 });
    layout.addPiece("kit-platform-furnished", { x: -300, z: 0, heading: 0 });
    const view = new KitView(lib);
    view.sync(layout);
    expect(view.hasMovers).toBe(true);
    const liveGroups = () => view.group.children.filter((c) => c.name === "movers").length;
    expect(liveGroups()).toBe(0);
    // Nothing triggered: nothing done.
    expect(view.update(() => false, 1 / 60)).toBe("still");
    expect(view.animating).toBe(false);
    // A train on it: the portcullis rises, drawn live where the piece stands.
    let trains = true;
    const asked: number[] = [];
    const on = (id: number) => (asked.push(id), trains);
    expect(view.update(on, 1 / 60)).toBe("moving");
    // Only the moving kit is asked about (not the platform).
    expect(new Set(asked)).toEqual(new Set([gate]));
    expect(liveGroups()).toBe(1);
    const live = view.group.children.find((c) => c.name === "movers")!;
    expect(live.position.x).toBe(100);
    expect(live.rotation.y).toBeCloseTo(-0.5);
    expect(view.animating).toBe(true);
    let results: string[] = [];
    for (let i = 0; i < 120; i++) results.push(view.update(on, 1 / 60));
    // Risen and holding: still, nothing to draw while the train's under it.
    expect(results.at(-1)).toBe("still");
    expect(view.animating).toBe(false);
    const portcullis = live.getObjectByName("portcullis")!;
    expect(portcullis.position.y).toBeCloseTo(64, 3);
    // The train's gone: it drops, then the live parts go and the whole model is drawn again.
    trains = false;
    results = [];
    for (let i = 0; i < 120; i++) results.push(view.update(on, 1 / 60));
    expect(results[0]).toBe("moving");
    expect(results).toContain("changed");
    expect(results.at(-1)).toBe("still");
    expect(liveGroups()).toBe(0);
    expect(view.animating).toBe(false);
  });
});
