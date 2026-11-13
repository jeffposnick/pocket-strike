// End-to-end PWA check against a production build served by `vite preview`.
//
//   npm run build && python3 -m http.server 4175 --directory dist &
//   node tools/pwa-check.cjs [http://localhost:4175/] [--update]
//
// Serve dist/ with a server that re-reads files on every request (as above).
// `vite preview` caches file metadata at startup, which breaks the --update
// check because the rebuilt sw.js isn't served correctly.
//
// Checks, in Chromium via Playwright:
//   1. The page is installable (no manifest/installability errors).
//   2. The service worker takes control and reports "ready to play offline".
//   3. With the network off, a reload still serves the full game: fonts load
//      and a ball can be bowled.
//   4. With --update: after `dist/` is rebuilt with a change, the page offers
//      an "Update" button, and tapping it loads the new version.
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:4175/';
const testUpdate = process.argv.includes('--update');
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(url);
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready, null, { timeout: 15000 });
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors: installErrors = [] } = await cdp.send('Page.getInstallabilityErrors');
  check(installErrors.length === 0, `installable (${installErrors.map((e) => e.errorId).join(', ') || 'no errors'})`);
  const manifest = await cdp.send('Page.getAppManifest');
  check(!manifest.errors?.length, `manifest parses cleanly${manifest.errors?.length ? ': ' + JSON.stringify(manifest.errors) : ''}`);

  await page.waitForFunction(() => document.getElementById('pwaText')?.textContent?.includes('offline'), null, { timeout: 20000 });
  check(true, 'service worker installed and "Ready to play offline" shown');

  // Make sure this page is controlled before going offline.
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#playRun', { state: 'visible', timeout: 15000 });
  const fontsOk = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('16px Bungee') && document.fonts.check('16px Rubik');
  });
  check(fontsOk, 'offline reload: menu renders with self-hosted fonts');
  await page.click('#play');
  await page.waitForTimeout(800);
  const box = await page.locator('#game').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.82;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 4);
  for (let i = 1; i <= 5; i++) await page.mouse.move(x, y - i * 45);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const rolling = await page.evaluate(() => document.getElementById('throw').classList.contains('show'));
  check(rolling, 'offline: bowled a ball');
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await context.setOffline(false);

  if (testUpdate) {
    // Ship a "new version": rebuild with a changed tagline.
    const root = path.join(__dirname, '..');
    const html = path.join(root, 'index.html');
    const original = fs.readFileSync(html, 'utf8');
    try {
      fs.writeFileSync(html, original.replace('Find the pocket.', 'Find the pocket!'));
      execSync('npx vite build', { cwd: root, stdio: 'ignore' });
    } finally {
      fs.writeFileSync(html, original);
    }
    try {
      await page.reload();
      await page.waitForFunction(() => document.getElementById('pwaText')?.textContent?.includes('new version'), null, { timeout: 30000 });
      const tagBefore = await page.textContent('.tag');
      check(tagBefore.includes('pocket.'), 'new build detected: "Update" offered, old version keeps running until tapped');
      await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('#pwaAction')]);
      await page.waitForSelector('.tag');
      const tag = await page.textContent('.tag');
      check(tag.includes('pocket!'), `after tapping Update the new version is running ("${tag}")`);
    } finally {
      execSync('npx vite build', { cwd: root, stdio: 'ignore' }); // restore the real build
    }
  }

  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
