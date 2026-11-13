// Renders tools/icons/icon.svg to the PNG icons in public/.
// Needs Playwright with Chromium:  node tools/icons/render.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
const out = path.join(__dirname, '..', '..', 'public');
const targets = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  // Maskable: the art shrinks into the 80% safe zone while the background bleeds to the edge.
  ['icon-maskable-512.png', 512, 1, 0.8],
  ['apple-touch-icon.png', 180, 1],
  ['favicon-32.png', 32, 1],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, scale, artScale = 1] of targets) {
    await page.setViewportSize({ width: size, height: size });
    let src = svg;
    if (artScale !== 1) {
      const off = (512 * (1 - artScale)) / 2;
      src = src
        .replace('<!-- Neon lane lines -->', `<g transform="translate(${off} ${off}) scale(${artScale})"><!-- Neon lane lines -->`)
        .replace('</svg>', '</g></svg>');
    }
    const inner = src.replace('<svg ', `<svg width="${size * scale}" height="${size * scale}" `);
    await page.setContent(
      `<html><body style="margin:0;background:#0c0a1f;display:grid;place-items:center;width:${size}px;height:${size}px;overflow:hidden">${inner}</body></html>`,
    );
    await page.screenshot({ path: path.join(out, name), omitBackground: false });
    console.log('wrote', name);
  }
  fs.copyFileSync(path.join(__dirname, 'icon.svg'), path.join(out, 'favicon.svg'));
  await browser.close();
})();
