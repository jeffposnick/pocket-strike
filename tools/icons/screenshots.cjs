// Captures the install-dialog screenshots in public/screenshots/ (780×1688).
// Run the dev server first (npm run dev -- --port 5174), then:
//   node tools/icons/screenshots.cjs [http://localhost:5174/]
// Uses the dev-only window.lanes hook. Physics is stepped directly because
// headless rendering at phone pixel density is too slow to play in real time.
const { chromium, devices } = require('playwright');
const path = require('path');

const url = process.argv[2] || 'http://localhost:5174/';
const out = path.join(__dirname, '..', '..', 'public', 'screenshots');

async function settle(page) {
  await page.evaluate(() => {
    const l = window.lanes;
    for (let i = 0; i < 1200 && !l.sim.settled(); i++) l.sim.step(1 / 60);
  });
  for (let i = 0; i < 100; i++) {
    if ((await page.evaluate(() => window.lanes.phase)) === 'result') return;
    await page.waitForTimeout(50);
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.lanes && document.fonts.status === 'loaded');
  await page.waitForTimeout(800);
  // The iOS "Add to Home Screen" hint would look odd in an Android install dialog.
  await page.evaluate(() => (document.getElementById('iosHint').hidden = true));
  await page.screenshot({ path: path.join(out, 'menu.png') });

  // Classic: keep bowling hooked pocket shots until one is a strike.
  await page.click('#play');
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.waitForFunction(() => window.lanes.phase === 'aim', null, { timeout: 30000 });
    await page.evaluate(() => {
      const l = window.lanes;
      document.getElementById('hint').classList.remove('show');
      l.sim.ball.x = 95;
      l.throwBall(2300, 0, -0.55);
    });
    await settle(page);
    const strike = await page.evaluate(() => /STRIKE|DOUBLE|TURKEY|BAGGER/.test(document.getElementById('bannerText').textContent));
    if (strike) {
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(out, 'strike.png') });
      break;
    }
    await page.evaluate(() => {
      const l = window.lanes;
      l.newGame(l.style, false, 'classic');
    });
  }

  // Neon Run: a Bomb into the 55-pin rack, caught mid-explosion.
  await page.click('#menuBtn');
  await page.click('#playRun');
  await page.waitForFunction(() => window.lanes.phase === 'aim', null, { timeout: 30000 });
  await page.waitForTimeout(2400); // let the stage banner fade
  await page.evaluate(() => {
    const l = window.lanes;
    document.getElementById('hint').classList.remove('show');
    l.run.inventory.push('bomb', 'chain');
    l.refreshHud();
    l.sim.ball.x = 80;
    l.throwBall(2300, 0, 0);
    for (let i = 0; i < 1200 && !l.sim.contact; i++) l.sim.step(1 / 60);
    for (let i = 0; i < 4; i++) l.sim.step(1 / 60);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, 'neon-run.png') });

  await browser.close();
  console.log('screenshots written to', out);
})();
