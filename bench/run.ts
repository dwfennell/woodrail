import { Bench } from "tinybench";

/** Runs a named group of benchmarks and prints ops/sec. */
export async function runGroup(name: string, cases: Record<string, () => void>): Promise<void> {
  const bench = new Bench({ time: 500, warmupTime: 100 });
  for (const [label, fn] of Object.entries(cases)) bench.add(label, fn);
  await bench.run();
  console.log(`\n${name}`);
  console.table(
    bench.tasks.map((t) => {
      const r = t.result as { throughput?: { mean: number }; latency?: { mean: number } } | undefined;
      return {
        task: t.name,
        "ops/s": Math.round(r?.throughput?.mean ?? 0).toLocaleString(),
        "mean (µs)": ((r?.latency?.mean ?? 0) * 1000).toFixed(3),
      };
    }),
  );
}
