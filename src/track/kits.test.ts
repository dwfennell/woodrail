import { describe, expect, it } from "vitest";
import { flipSwapsEnds, getPieceDef, isPlainStraight, KIT_TYPES, kitForAsset, kitOf, kitPlace, KITS, MAX_CONNECTORS, pathLength, PIECE_TYPES, straightLength, type PieceTypeId } from ".";
import { KIT_MOTIONS } from "../render/kit-motions";

describe("kit pieces", () => {
  it("are piece types, generated from the kits", () => {
    expect(KIT_TYPES).toContain("kit-platform-furnished");
    for (const type of KIT_TYPES) {
      expect(PIECE_TYPES).toContain(type);
      // The piece's def is the kit's track.
      expect(getPieceDef(type, false)).toBe(KITS[type].track);
      expect(getPieceDef(type, false).type).toBe(type);
    }
  });

  it("kitOf finds a kit by its type, and nothing for other pieces", () => {
    const kit = kitOf("kit-platform-furnished")!;
    expect(kit.asset).toBe("bldg-platform-furnished");
    expect(kitOf("straight-216")).toBeUndefined();
    expect(kitOf("depot-workshop")).toBeUndefined();
    // Not fooled by the prototype's keys.
    expect(kitOf("constructor" as PieceTypeId)).toBeUndefined();
    expect(kitForAsset("bldg-platform-furnished")).toBe("kit-platform-furnished");
    expect(kitForAsset("bldg-country-halt")).toBe("kit-country-halt");
    expect(kitForAsset("bldg-ticket-booth")).toBeUndefined();
  });

  it("splicing kits are single straights a multiple of 54 long, and not plain straights", () => {
    for (const type of KIT_TYPES) {
      const kit = KITS[type];
      if (!kit.splices) continue;
      const len = straightLength(type, false);
      expect(len, type).toBeGreaterThan(0);
      expect(len % 54, type).toBe(0);
      // A kit isn't spliced onto (nor taken up by) another kit or a depot.
      expect(isPlainStraight(type)).toBe(false);
    }
  });

  it("the furnished platform: a 216 straight, its platform on the +l side, a 4 s stop for passengers", () => {
    const kit = KITS["kit-platform-furnished"];
    expect(straightLength("kit-platform-furnished", false)).toBe(216);
    expect(kit.splices).toBe(true);
    expect(kit.rails).toBe("track");
    expect(kit.stop).toEqual({ at: 196, seconds: 4, who: "passengers" });
    // Clear of the track (40 wide), on its left.
    for (const r of kit.footprint) expect(r.l - r.d / 2).toBeGreaterThanOrEqual(20);
    expect(kitPlace(kit)).toEqual({ t: 108, l: 34, turn: Math.PI });
  });

  it("every kit's track fits a piece: at most MAX_CONNECTORS ends, each path from one of them", () => {
    for (const type of KIT_TYPES) {
      const def = KITS[type].track;
      expect(def.connectors.length, type).toBeLessThanOrEqual(MAX_CONNECTORS);
      expect(def.paths.length, type).toBeGreaterThan(0);
      for (const p of def.paths) {
        expect(p.from, type).toBeLessThan(def.connectors.length);
        if (p.to !== null) expect(p.to, type).toBeLessThan(def.connectors.length);
      }
      // A stop is somewhere along every road (and short of a buffer's end).
      if (KITS[type].stop) for (const p of def.paths) expect(KITS[type].stop!.at, type).toBeLessThan(pathLength(p.geom) - 5);
    }
  });

  it("halts and stations with a building one side: 216 straights that splice, a stop for passengers", () => {
    for (const type of ["kit-country-halt", "kit-mountain-station", "kit-harbour-station"] as const) {
      const kit = KITS[type];
      expect(straightLength(type, false), type).toBe(216);
      expect(kit.splices, type).toBe(true);
      expect(kit.stop?.who, type).toBe("passengers");
      // Its ground clear of its own track, on the left.
      for (const r of kit.footprint) expect(r.l - r.d / 2, type).toBeGreaterThanOrEqual(20);
    }
  });

  it("the two-platform station: two through roads a double track apart, a stop on each", () => {
    const def = KITS["kit-two-platform-station"].track;
    expect(def.connectors.length).toBe(4);
    expect(def.paths.map((p) => [p.from, p.to])).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(def.connectors.map((c) => [Math.round(c.pose.x), Math.round(c.pose.z)])).toEqual([
      [0, 0],
      [216, 0],
      [0, 72],
      [216, 72],
    ]);
    expect(KITS["kit-two-platform-station"].stop?.who).toBe("passengers");
    expect(KITS["kit-two-platform-station"].splices).toBeFalsy();
  });

  it("the terminus, engine shed and roundhouse: roads ending at buffers, entered from one end each", () => {
    for (const [type, roads, length] of [
      ["kit-grand-terminus", 3, 216],
      ["kit-engine-shed", 2, 162],
      ["kit-roundhouse-segment", 3, 108],
    ] as const) {
      const def = KITS[type].track;
      expect(def.connectors.length, type).toBe(roads);
      expect(def.paths.length, type).toBe(roads);
      for (const p of def.paths) {
        expect(p.to, type).toBeNull();
        expect(pathLength(p.geom), type).toBeCloseTo(length, 6);
      }
    }
    expect(KITS["kit-grand-terminus"].stop?.who).toBe("passengers");
    expect(KITS["kit-engine-shed"].moves).toBe("occupied");
    // The roundhouse's stalls fan an eighth of a turn apart, from a turntable's rim.
    const stalls = KITS["kit-roundhouse-segment"].track.paths.map((p) => (p.geom as { start: { heading: number } }).start.heading);
    expect(stalls).toEqual([-Math.PI / 4, 0, Math.PI / 4]);
  });

  it("the castle gate: a 108 straight that splices, its portcullis moving while a train is on it", () => {
    expect(straightLength("kit-castle-gate", false)).toBe(108);
    expect(KITS["kit-castle-gate"].splices).toBe(true);
    expect(KITS["kit-castle-gate"].moves).toBe("occupied");
    expect(KITS["kit-castle-gate"].stop).toBeUndefined();
  });

  it("engine services: 108 straights that splice, a 3 s stop for steam (fuel: any engine) with a minute's cool-down", () => {
    const services = ["kit-water-tower", "kit-coal-stage", "kit-water-crane", "kit-coaling-crane", "kit-fuel-station"] as const;
    for (const type of services) {
      const kit = KITS[type];
      expect(straightLength(type, false), type).toBe(108);
      expect(kit.splices, type).toBe(true);
      expect(kit.stop?.seconds, type).toBe(3);
      expect(kit.stop?.cooldown, type).toBe(60);
      expect(kit.stop?.who, type).toBe(type === "kit-fuel-station" ? "any" : "steam");
      // The spout or chute works while the engine stands there.
      expect(kit.moves, type).toBe("stopped");
      for (const r of kit.footprint) expect(r.l - r.d / 2, type).toBeGreaterThanOrEqual(20);
    }
  });

  it("signal skins: the signal piece's track and stop, drawn with their own model, which follows the aspect", () => {
    const plain = getPieceDef("signal", false);
    const skins = { "kit-semaphore-signal": "mech-semaphore-signal", "kit-colour-light-signal": "mech-colour-light-signal", "kit-signal-gantry": "mech-signal-gantry" } as const;
    for (const [type, asset] of Object.entries(skins) as [keyof typeof skins, string][]) {
      const kit = KITS[type];
      expect(kit.asset, type).toBe(asset);
      expect(kitForAsset(asset), type).toBe(type);
      expect(kit.track.signal, type).toEqual(plain.signal);
      expect(kit.moves, type).toBe("state");
      expect(KIT_MOTIONS[asset]?.state?.source, type).toBe("signals");
      expect(kit.splices, type).toBeFalsy();
      expect(kit.track.isSwitch, type).toBe(false);
      // Every road is the plain signal's length.
      for (const p of kit.track.paths) expect(pathLength(p.geom), type).toBe(pathLength(plain.paths[0].geom));
    }
    for (const type of ["kit-semaphore-signal", "kit-colour-light-signal"] as const) {
      expect(KITS[type].track.connectors.map((c) => c.pose)).toEqual(plain.connectors.map((c) => c.pose));
      // Its post clear of the track's edge.
      for (const r of KITS[type].footprint) expect(r.l - r.d / 2, type).toBeGreaterThanOrEqual(20);
    }
    // The gantry: two roads a double track apart, as the double straight's, both guarded; its legs outside them.
    const gantry = KITS["kit-signal-gantry"].track;
    const double = getPieceDef("double-straight", false);
    expect(gantry.connectors.map((c) => [c.kind, c.pose.z])).toEqual(double.connectors.map((c) => [c.kind, c.pose.z]));
    expect(gantry.paths.map((p) => [p.from, p.to])).toEqual([
      [0, 1],
      [2, 3],
    ]);
    for (const r of KITS["kit-signal-gantry"].footprint) expect(r.l - r.d / 2 >= 92 || r.l + r.d / 2 <= -20).toBe(true);
  });

  it("the buffer-stop lamp: a skin of the buffer, flipping as a buffer does, its lamp lit while a train's on it", () => {
    const kit = KITS["kit-buffer-stop-lamp"];
    const buffer = getPieceDef("buffer", false);
    expect(kit.asset).toBe("mech-buffer-stop-lamp");
    expect(kit.track.connectors.map((c) => [c.kind, c.pose])).toEqual(buffer.connectors.map((c) => [c.kind, c.pose]));
    expect(kit.track.paths.map((p) => [p.from, p.to, p.geom])).toEqual(buffer.paths.map((p) => [p.from, p.to, p.geom]));
    expect(flipSwapsEnds("kit-buffer-stop-lamp")).toBe(true);
    expect(getPieceDef("kit-buffer-stop-lamp", true).connectors[0].kind).toBe("peg");
    expect(kit.moves).toBe("occupied");
    expect(kit.footprint).toEqual([]);
  });
});
