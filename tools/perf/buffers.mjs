// Where a heap snapshot's ArrayBuffer memory is (tools/perf/memory.mjs --snapshots writes them): each backing store
// (typed arrays' data, a wasm memory) attributed to the path that holds it, a few named objects up its retainer chain,
// summed by path. Typed arrays live outside the V8 heap, so a heap's "used size" misses them: on a big map they're most
// of what the page holds. Use an unminified build for names.
//
//   node tools/perf/buffers.mjs <file.heapsnapshot> [--depth 4] [--top 40]
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const DEPTH = Number(opt("depth", 4));
const TOP = Number(opt("top", 40));
const snap = JSON.parse(readFileSync(args[0], "utf8"));
const meta = snap.snapshot.meta;
const NF = meta.node_fields.length;
const EF = meta.edge_fields.length;
const nodeTypes = meta.node_types[0];
const edgeTypes = meta.edge_types[0];
const nT = meta.node_fields.indexOf("type");
const nN = meta.node_fields.indexOf("name");
const nS = meta.node_fields.indexOf("self_size");
const nE = meta.node_fields.indexOf("edge_count");
const eT = meta.edge_fields.indexOf("type");
const eN = meta.edge_fields.indexOf("name_or_index");
const eTo = meta.edge_fields.indexOf("to_node");
const { nodes, edges, strings } = snap;
const count = nodes.length / NF;
// Retainers: for each node, the (node, edge) pairs pointing at it.
const firstEdge = new Uint32Array(count + 1);
for (let i = 0, e = 0; i < count; i++) {
  firstEdge[i] = e;
  e += nodes[i * NF + nE] * EF;
}
firstEdge[count] = edges.length;
const retainers = Array.from({ length: count }, () => []);
for (let i = 0; i < count; i++) {
  for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
    const type = edgeTypes[edges[e + eT]];
    if (type === "weak" || type === "shortcut") continue;
    retainers[edges[e + eTo] / NF].push([i, e]);
  }
}
const name = (i) => strings[nodes[i * NF + nN]];
const type = (i) => nodeTypes[nodes[i * NF + nT]];
const edgeName = (e) => {
  const t = edgeTypes[edges[e + eT]];
  return t === "element" || t === "hidden" ? `[${edges[e + eN]}]` : strings[edges[e + eN]];
};
const BORING = new Set(["system / Context", "(internalized string)", "Array", "Object", "(object properties)", "(object elements)", "system / PropertyArray"]);

const byPath = new Map();
let total = 0;
for (let i = 0; i < count; i++) {
  if (name(i) !== "system / JSArrayBufferData" && !(type(i) === "native" && /ArrayBuffer|BackingStore/.test(name(i)))) continue;
  const size = nodes[i * NF + nS];
  if (size === 0) continue;
  total += size;
  // Up the first retainer chain (skipping the typed array and its buffer object), naming the objects passed.
  const path = [];
  let cur = i;
  const visited = new Set([cur]);
  for (let step = 0; step < 40 && path.length < DEPTH; step++) {
    const r = retainers[cur].find(([n]) => !visited.has(n) && type(n) !== "synthetic") ?? null;
    if (!r) break;
    const [n, e] = r;
    visited.add(n);
    const nm = name(n);
    const en = edgeName(e);
    if (type(n) === "object" && !BORING.has(nm) && !/^(Float|Uint|Int)\d+Array$|^ArrayBuffer$|^DataView$/.test(nm)) path.push(`${nm}.${en}`);
    else if (type(n) === "closure") path.push(`fn ${nm}.${en}`);
    cur = n;
  }
  const key = path.reverse().join(" › ") || "(unattributed)";
  const x = byPath.get(key) ?? { bytes: 0, n: 0 };
  x.bytes += size;
  x.n++;
  byPath.set(key, x);
}
console.log(`ArrayBuffer backing stores: ${(total / 1048576).toFixed(1)} MB`);
for (const [k, v] of [...byPath].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, TOP)) console.log(`${(v.bytes / 1048576).toFixed(1).padStart(7)} MB ${String(v.n).padStart(6)}  ${k}`);
