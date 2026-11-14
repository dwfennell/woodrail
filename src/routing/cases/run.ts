/**
 * The routing cases as tests (docs/agents/routing-cases.md): shard `i` of `SHARDS` (the eight `cases-*.test.ts` files,
 * run side by side). A case the game gets wrong today is in `KNOWN` (known.ts), titled "[known: …]" with its
 * mismatches, and must go wrong just that way: the suite is green and lists exactly what's broken, and a change that
 * clears one (or breaks it another way) turns it red, to be taken out of the list (`node tools/cases-known.mjs`).
 * `CASES_OUT=<dir>`: each shard writes its cases' judgements there as JSON (`npm run cases:report` makes the table).
 */
import { expect, it } from "vitest";
import { allCases } from "./cases";
import { judge, type Judged } from "./judge";
import { KNOWN } from "./known";
import { REASONS } from "./reasons";

export const SHARDS = 8;
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs")) as { mkdirSync(path: string, o: { recursive: boolean }): void; writeFileSync(path: string, text: string): void };

export function shard(i: number): void {
  const cases = allCases().filter((_, k) => k % SHARDS === i);
  const out: (Judged & { family: string; known: string | null; reason: string | null })[] = [];
  for (const c of cases) {
    const known = KNOWN[c.id];
    it(known ? `${c.id} [known: ${known.join(", ")}${REASONS[c.id] ? `; ${REASONS[c.id]}` : ""}]` : c.id, () => {
      const j = judge(c);
      out.push({ ...j, family: c.family, known: known ? known.join(", ") : null, reason: REASONS[c.id] ?? null });
      const said = `${c.id}: oracle ${j.verdict} (${j.oracle.best}/${j.oracle.n}); game stops ${j.game.stops.join("/")}, stall ${j.game.stallAt} s (${j.game.why.join(",")})`;
      // (A known case must still go wrong just the way it's known to: cleared, or changed, it shows.)
      expect(j.mismatches, said).toEqual(known ?? []);
      // (A case runs a second or so; on a loaded machine several, past vitest's 5 s.)
    }, 60_000);
  }
  it.runIf(!!ENV.CASES_OUT)("(writes the judgements)", async () => {
    const { mkdirSync, writeFileSync } = await fs();
    mkdirSync(ENV.CASES_OUT!, { recursive: true });
    writeFileSync(`${ENV.CASES_OUT}/shard-${i}.json`, JSON.stringify(out));
  });
}
