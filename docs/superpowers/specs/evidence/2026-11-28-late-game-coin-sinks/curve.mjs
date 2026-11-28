import fs from "node:fs";
const dir = process.argv[2];
const out = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".log")).sort()) {
  const line = fs.readFileSync(`${dir}/${f}`, "utf8").split("\n").find((l) => l.includes("BALANCE_JSON {"));
  if (!line) { console.log(f, "no json"); continue; }
  const j = JSON.parse(line.slice(line.indexOf("{")));
  const at = (m) => j.rows.find((r) => r.minute === m);
  const pts = [15, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300].map((m) => at(m)).filter(Boolean);
  const star = Object.entries(j.firsts).filter(([k]) => /level/.test(k)).map(([k, v]) => `${k}@${v}`).join(" ");
  console.log(f, "| coins", pts.map((r) => `${r.minute}:${r.coins}`).join(" "), "| earned", pts.map((r) => r.earned).join(" "), "| bp", pts.map((r) => r.blueprints).join(" "), "| levels", JSON.stringify(pts.at(-1)?.levels), "|", star, "| spent", JSON.stringify(j.spent));
  out.push({ f, rows: j.rows.map((r) => ({ m: r.minute, c: r.coins, e: r.earned })) });
}
fs.writeFileSync(`${dir}/curves.json`, JSON.stringify(out));
