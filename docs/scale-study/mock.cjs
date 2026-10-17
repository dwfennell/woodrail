// Scale study: a composed street of houses and civic buildings, at today's sizes and at proposed ones, rendered at the
// phone's default zoom and close up. Dev server on :5206 (the scale-study worktree).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = '/tmp/claude-0/-home-user-woodrail/a973f630-9127-56fa-8cba-4f601722ae11/scratchpad/scalemock';
// Frontage (model z, mm) of each model, from the GLB.
const FRONT = { 'bldg-townhouse': 35, 'bldg-brick-house': 45, 'bldg-timber-house': 40, 'bldg-school': 75, 'bldg-town-hall': 80, 'bldg-library': 104, 'bldg-hospital': 80, 'bldg-villa': 108, 'bldg-church': 39, 'bldg-market-hall': 116, 'bldg-post-office': 39, 'bldg-red-barn': 52, 'bldg-thatched-cottage': 42 };
const FRONT_ROW = ['bldg-townhouse', 'bldg-school', 'bldg-brick-house', 'bldg-town-hall', 'bldg-library', 'bldg-timber-house', 'bldg-hospital', 'bldg-villa'];
const BACK_ROW = ['bldg-thatched-cottage', 'bldg-church', 'bldg-market-hall', 'bldg-post-office', 'bldg-red-barn', 'bldg-brick-house'];
const PROPOSED = { 'bldg-school': 1.3, 'bldg-town-hall': 1.3, 'bldg-hospital': 1.3, 'bldg-library': 1.2, 'bldg-market-hall': 1.2, 'bldg-church': 1.2, 'bldg-college': 1.2, 'bldg-post-office': 1.15, 'bldg-fire-station': 1.15, 'bldg-police-station': 1.15, 'bldg-red-barn': 0.75 };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.addInitScript(() => { localStorage.setItem('woodrail.helpSeen', '1'); });
  await pg.goto('http://localhost:5206/#seed-4242');
  await pg.waitForFunction(() => window.woodrail?.mode?.() === 'sandbox' && !window.woodrail.title?.shown, null, { timeout: 240000 }).catch(async () => {
    await pg.click('.title-card.mode-sandbox >> text=New map', { noWaitAfter: true });
    await pg.waitForFunction(() => window.woodrail?.mode?.() === 'sandbox' && !window.woodrail.title.shown, null, { timeout: 120000 });
  });
  await pg.waitForTimeout(12000);
  for (const [name, scales] of [['current', {}], ['proposed', PROPOSED]]) {
    const at = await pg.evaluate(({ scales, FRONT, FRONT_ROW, BACK_ROW }) => {
      const g = window.woodrail; const gr = g.landscape.grid;
      for (const p of [...g.props.all()]) if (p.street) g.props.remove(p.id);
      g.assetScale.clear(); for (const [a, k] of Object.entries(scales)) g.assetScale.set(a, k);
      let best = window.__best;
      if (!best) {
        for (const [len, cols] of [[18, 6], [16, 6], [14, 5]]) for (let i = 0; i < gr.cellCount && !best; i++) { const c0 = gr.colOf(i), r0 = gr.rowOf(i); let ok = true; for (let dr = 0; dr < len && ok; dr++) for (let dc = 0; dc < cols && ok; dc++) { if (!gr.inBounds(c0 + dc, r0 + dr)) { ok = false; break; } const j = gr.index(c0 + dc, r0 + dr); if (gr.groundY(j) !== 0 || gr.surface[j] !== 0) ok = false; } if (ok) best = { x: gr.centreX(c0), z: gr.centreZ(r0), cols }; }
        window.__best = best;
      }
      if (!best) return null;
      // A street running up the screen (along z), a row of lots either side facing it: a house's lot 1 square (72),
      // others as wide as they are now (plus a gap).
      const streetX = best.x + (best.cols * 72) / 2 - 36;
      const row = (assets, side) => {
        let z = best.z;
        for (const a of assets) {
          const k = scales[a] ?? 1;
          const w = Math.max(72, Math.ceil((FRONT[a] * k + 16) / 72) * 72);
          // Set back from the street by half its depth (scaled), fronts to the street.
          const depth = { 'bldg-town-hall': 74, 'bldg-hospital': 100, 'bldg-church': 99, 'bldg-red-barn': 90 }[a] ?? 56;
          const x = streetX + side * (36 + (depth * k) / 2);
          const p = g.props.add(a, { x, z: z + w / 2, heading: side > 0 ? Math.PI : 0, y: 0 }); p.street = true;
          z += w;
        }
        return z;
      };
      const end = Math.max(row(FRONT_ROW, -1), row(BACK_ROW, 1));
      g.propsChanged?.();
      return { x: streetX, z: (best.z + end) / 2, z0: best.z };
    }, { scales, FRONT, FRONT_ROW, BACK_ROW });
    if (!at) { console.log('no ground'); break; }
    for (const [view, dist, phi] of [['phone', 1000, 1.0], ['close', 620, 1.15]]) {
      await pg.evaluate(({ at, dist, phi }) => {
        const g = window.woodrail; g.director?.cancel?.();
        const tz = dist < 900 ? at.z0 + 420 : at.z;
        g.controls.target.set(at.x, 0, tz);
        g.camera.position.set(at.x, dist * Math.cos(phi), tz + dist * Math.sin(phi));
        g.controls.update(); g.invalidate();
      }, { at, dist, phi });
      await pg.waitForTimeout(3500); await pg.evaluate(() => { const g = window.woodrail; console.log(g.camera.position.toArray().map(Math.round)); });
      await pg.screenshot({ path: `${OUT}/${name}-${view}.png` });
    }
    console.log(name, 'done');
  }
  console.log('errors:', errs.join(' | ') || 'none');
  await b.close();
})();
