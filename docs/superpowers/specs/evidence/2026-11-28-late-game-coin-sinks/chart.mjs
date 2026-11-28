import fs from "node:fs";
const [curvesPath, out] = process.argv.slice(2);
const curves = JSON.parse(fs.readFileSync(curvesPath));
const user = [[132, 689], [265, 4010], [291, 4131], [306, 4899], [353, 7186], [391, 8920], [509, 17657], [536, 21642], [542, 23015], [574, 28944], [614, 38317], [627, 42829]];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const ms = []; for (let m = 10; m <= 300; m += 10) ms.push(m);
const band = ms.map((m) => { const v = curves.map((c) => c.rows.find((r) => r.m === m).c); return [m, Math.min(...v), med(v), Math.max(...v)]; });
// income an hour: play-through earned over 30-min windows; user's game: coins gained between saves (net of spending)
const rate = []; for (let m = 30; m <= 300; m += 30) { const v = curves.map((c) => { const a = c.rows.find((r) => r.m === m - 30)?.e ?? 0; const b = c.rows.find((r) => r.m === m).e; return (b - a) * 2; }); rate.push([m - 15, med(v)]); }
const urate = []; for (let i = 1; i < user.length; i++) { const [m0, c0] = user[i - 1], [m1, c1] = user[i]; if (m1 - m0 < 10) continue; urate.push([(m0 + m1) / 2, ((c1 - c0) * 60) / (m1 - m0)]); }
const W = 720, H = 300, L = 64, R = 20, T = 34, B = 40, X = (m) => L + (m / 660) * (W - L - R);
const css = `<style>
svg{--bg:#fff;--ink:#191919;--ink2:#666;--grid:#e6e6e6;--s1:#257de0;--s2:#f47230;--tg:#8a8a8a}
@media (prefers-color-scheme: dark){svg{--bg:#191919;--ink:#efefef;--ink2:#9c9c9c;--grid:#333;--s1:#338ced;--s2:#e76624;--tg:#9c9c9c}}
text{font:12px system-ui,sans-serif;fill:var(--ink2)} .t{font-size:14px;font-weight:600;fill:var(--ink)} .l{fill:var(--ink)}
</style>`;
const xAxis = (y0) => [0, 120, 240, 360, 480, 600].map((m) => `<line x1="${X(m)}" x2="${X(m)}" y1="${T}" y2="${y0}" stroke="var(--grid)"/><text x="${X(m)}" y="${y0 + 16}" text-anchor="middle">${m / 60} h</text>`).join("");
const path = (pts, Y) => pts.map(([m, v], i) => `${i ? "L" : "M"}${X(m).toFixed(1)},${Y(v).toFixed(1)}`).join("");
// Panel A: coins in hand
{
  const y0 = H - B, Y = (v) => y0 - (v / 45000) * (y0 - T);
  const grid = [0, 10000, 20000, 30000, 40000].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v / 1000}k</text>`).join("");
  const area = `M${band.map(([m, lo]) => `${X(m)},${Y(lo)}`).join("L")}L${[...band].reverse().map(([m, , , hi]) => `${X(m)},${Y(hi)}`).join("L")}Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Coins in hand over play time">${css}<rect width="${W}" height="${H}" fill="var(--bg)"/>
<text class="t" x="${L}" y="20">Coins in hand, by hours of play</text>${grid}${xAxis(y0)}
<path d="${area}" fill="var(--s2)" opacity="0.25"/><path d="${path(band.map(([m, , md]) => [m, md]), Y)}" fill="none" stroke="var(--s2)" stroke-width="2"/>
<path d="${path(user, Y)}" fill="none" stroke="var(--s1)" stroke-width="2"/>${user.map(([m, v]) => `<circle cx="${X(m)}" cy="${Y(v)}" r="4" fill="var(--s1)" stroke="var(--bg)" stroke-width="2"><title>${Math.round(m / 6) / 10} h: ${v} coins</title></circle>`).join("")}
<text class="l" x="${X(627) - 8}" y="${Y(42829) - 10}" text-anchor="end">The user's game (its saves): 42.8k</text>
<text class="l" x="${X(300) + 8}" y="${Y(band.at(-1)[2]) + 16}">Play-through, 8 seeds (median, range): 1.7k at 5 h</text>
</svg>`;
  fs.writeFileSync(`${out}/coins-in-hand.svg`, svg);
}
// Panel B: income an hour, log scale, with the target band
{
  const y0 = H - B, lg = (v) => Math.log10(v), lo = lg(150), hi = lg(30000), Y = (v) => y0 - ((lg(v) - lo) / (hi - lo)) * (y0 - T);
  const grid = [300, 1000, 3000, 10000, 30000].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v >= 1000 ? v / 1000 + "k" : v}</text>`).join("");
  const target = [[0, 900, 1500], [60, 900, 1500], [120, 1000, 1800], [240, 1500, 3000], [360, 2500, 5000], [480, 4000, 7000], [660, 5000, 8000]];
  const tarea = `M${target.map(([m, a]) => `${X(m)},${Y(a)}`).join("L")}L${[...target].reverse().map(([m, , b]) => `${X(m)},${Y(b)}`).join("L")}Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Coins earned an hour over play time, log scale">${css}<rect width="${W}" height="${H}" fill="var(--bg)"/>
<text class="t" x="${L}" y="20">Coins an hour (log scale), and the target shape</text>${grid}${xAxis(y0)}
<path d="${tarea}" fill="none" stroke="var(--tg)" stroke-width="1.5" stroke-dasharray="5 4"/>
<path d="${path(rate, Y)}" fill="none" stroke="var(--s2)" stroke-width="2"/>${rate.map(([m, v]) => `<circle cx="${X(m)}" cy="${Y(v)}" r="4" fill="var(--s2)" stroke="var(--bg)" stroke-width="2"><title>${m} min: ${Math.round(v)}/h</title></circle>`).join("")}
<path d="${path(urate, Y)}" fill="none" stroke="var(--s1)" stroke-width="2"/>${urate.map(([m, v]) => `<circle cx="${X(m)}" cy="${Y(v)}" r="4" fill="var(--s1)" stroke="var(--bg)" stroke-width="2"><title>${Math.round(m)} min: ${Math.round(v)}/h net</title></circle>`).join("")}
<text class="l" x="${X(600)}" y="${Y(urate.at(-1)[1]) + 4}" text-anchor="end" dx="-10">User's game, net of spending</text>
<text class="l" x="${X(300) + 8}" y="${Y(rate.at(-1)[1]) + 16}">Play-through, earned (median)</text>
<text x="${X(470)}" y="${Y(2600)}" text-anchor="middle">target (dashed)</text>
</svg>`;
  fs.writeFileSync(`${out}/coins-an-hour.svg`, svg);
}
console.log("band", JSON.stringify(band.filter(([m]) => m % 30 === 0)));
console.log("rate", JSON.stringify(rate.map(([m, v]) => [m, Math.round(v)])));
console.log("urate", JSON.stringify(urate.map(([m, v]) => [Math.round(m), Math.round(v)])));
