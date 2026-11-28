/**
 * The save corpus gate (spec docs/superpowers/specs/2026-11-26-save-safety.md, layer 3): every save in the repo loads on
 * this code and round-trips. It must load with nothing clamped or dropped (`LoadReport`). It's saved and loaded again,
 * also with nothing clamped or dropped, and saved again the same as the first time. Its session must read. The corpus:
 * the persist fixtures, the bug maps and the reference maps, the user's report maps (docs/agents/reports), and a save
 * of every older version that still loads (`MIGRATES_FROM` on).
 *
 * A feature that adds saved state adds a fixture at its maximum (AGENTS.md); save-maxima.test.ts builds one in code.
 */
import { describe, expect, it } from "vitest";
import { readMapText } from "./bug-map";
import { deserializeWorld, describeLoad, MIGRATES_FROM, modeKeys, newLoadReport, SAVE_VERSION, serializeWorld } from "./save";
import { saveSchemas } from "./schemas";

const glob = (g: Record<string, unknown>): [string, string][] => Object.entries(g as Record<string, string>);
const TEXTS = [
  ...glob(import.meta.glob("./fixtures/*.txt", { query: "?raw", import: "default", eager: true })),
  ...glob(import.meta.glob("../play/bugmaps/**/*.txt", { query: "?raw", import: "default", eager: true })),
  ...glob(import.meta.glob("../../docs/agents/reports/*.txt", { query: "?raw", import: "default", eager: true })),
];
/** Older versions' saves, as JSON: a save, or `{ save }` beside what it was recorded with. */
const JSONS = [
  ...glob(import.meta.glob("./fixtures/*.json", { query: "?raw", import: "default", eager: true })),
  ...glob(import.meta.glob("../game/fixtures/*.json", { query: "?raw", import: "default", eager: true })),
];

interface Entry {
  file: string;
  mode: "game" | "sandbox";
  save: unknown;
  session: string | undefined;
}

async function corpus(): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const [file, text] of TEXTS) {
    const copy = await readMapText(text);
    if (!copy) throw new Error(`${file}: not a copied map`);
    const [saveKey, sessionKey] = modeKeys(copy.mode);
    out.push({ file, mode: copy.mode, save: JSON.parse(copy.keys[saveKey]), session: copy.keys[sessionKey] });
  }
  for (const [file, text] of JSONS) {
    const v = JSON.parse(text) as { save?: unknown; pieces?: unknown };
    out.push({ file, mode: "game", save: v.pieces ? v : v.save, session: undefined });
  }
  return out;
}

const entries = await corpus();

/** The first place two saves differ ("trains.3.speed: 12 → 0"), or null: the same. */
export function firstDiff(a: unknown, b: unknown, at = ""): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k);
      if (d) return d;
    }
  }
  return `${at}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`;
}

describe("the save corpus: every save in the repo loads and round-trips", () => {
  it("is all there: the fixtures, bug maps, reference maps and report maps", () => {
    expect(TEXTS.length).toBeGreaterThan(40);
    for (const dir of ["./fixtures/", "../play/bugmaps/reference/", "../play/bugmaps/reports/", "../../docs/agents/reports/"]) expect(TEXTS.some(([f]) => f.startsWith(dir)), dir).toBe(true);
  });

  it("holds a save of every older version that still loads", () => {
    const versions = new Set(entries.map((e) => (e.save as { version: number }).version));
    for (let v = MIGRATES_FROM; v <= SAVE_VERSION; v++) expect(versions.has(v), `a v${v} save`).toBe(true);
  });

  it.each(entries.map((e) => [e.file.replace(/^(\.\.\/)+/, ""), e] as const))("%s", (_name, e) => {
    const first = newLoadReport();
    const a = deserializeWorld(structuredClone(e.save), { sandbox: e.mode === "sandbox", report: first });
    if (!a.ok) throw new Error(`doesn't load: ${a.error}`);
    expect(describeLoad(first), "nothing clamped or dropped as it loads").toBeNull();
    const s1 = JSON.stringify(serializeWorld(a.value));
    const second = newLoadReport();
    const b = deserializeWorld(JSON.parse(s1), { sandbox: e.mode === "sandbox", report: second });
    if (!b.ok) throw new Error(`saved again, doesn't load: ${b.error}`);
    expect(describeLoad(second), "nothing clamped or dropped loaded again").toBeNull();
    // (But for the trains' id counter: a train's id isn't saved, each load gives its trains fresh ones. Cars' are kept.)
    const again = serializeWorld(b.value);
    again.ids = { ...again.ids!, train: (JSON.parse(s1) as typeof again).ids!.train };
    expect(firstDiff(JSON.parse(s1), again), "saved again the same").toBeNull();
    if (e.session !== undefined) expect(saveSchemas().sessionSchema.safeParse(JSON.parse(e.session)).success, "its session reads").toBe(true);
  });
});
