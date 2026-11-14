// End-to-end check of controller support in Chromium, with a fake standard-layout controller:
// menu navigation, lining up with the d-pad, bowling with a stick swing, skipping and the menu button.
//
//   npm run dev &
//   node tools/gamepad-check.ts [http://localhost:5173/]
//
// Needs the dev server (the scene is exposed as `window.lanes` only in dev builds) and Playwright.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 540, height: 960 } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));

// A fake controller behind navigator.getGamepads(), driven from the test.
await page.addInitScript(() => {
  const pad = {
    id: 'Test controller (STANDARD GAMEPAD)',
    index: 0,
    connected: false,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: null,
  };
  (window as unknown as { __pad: typeof pad }).__pad = pad;
  navigator.getGamepads = () => (pad.connected ? [pad as unknown as Gamepad] : []);
});
const pad = (fn: string) => page.evaluate(`(() => { const p = window.__pad; ${fn} })()`);
const frames = (n: number) => page.evaluate((k: number) => new Promise<void>((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const press = async (i: number) => {
  await pad(`p.buttons[${i}].pressed = true;`);
  await frames(3);
  await pad(`p.buttons[${i}].pressed = false;`);
  await frames(3);
};
const lanes = <T>(expr: string): Promise<T> => page.evaluate(`window.lanes.${expr}`);

await page.goto(url);
await page.waitForSelector('#menu[open]');
await pad('p.connected = true;');
await frames(3);
check(await page.isVisible('#padHow'), 'menu explains the controller once one connects');

// Menu: step down to "Classic 10 frames" and press it.
let reached = false;
for (let i = 0; i < 12 && !reached; i++) {
  await press(13);
  reached = await page.evaluate(() => document.activeElement?.id === 'play');
}
check(reached, 'd-pad moves focus through the menu');
check(await page.evaluate(() => document.body.classList.contains('pad-nav')), 'focus ring shows for controller navigation');
await press(0);
await page.waitForFunction(() => (window as unknown as { lanes: { phase: string } }).lanes.phase === 'aim');
check(true, 'confirm button starts the game');

// Line up with the d-pad.
const x0 = await lanes<number>('sim.ball.x');
await pad('p.buttons[15].pressed = true;');
await frames(20);
await pad('p.buttons[15].pressed = false;');
await frames(2);
const x1 = await lanes<number>('sim.ball.x');
check(x1 > x0 + 5, `d-pad right moves the ball right (${x0.toFixed(0)} → ${x1.toFixed(0)})`);
check(await page.isVisible('#boardNo.show'), 'board number shows while lining up');
check(/Pull back/.test((await page.textContent('#hint p')) ?? ''), 'hint switches to controller instructions');

// Bowl with the right stick: pull back, then push forward.
await pad('p.axes[3] = 0.6;');
await frames(3);
await pad('p.axes[3] = 1;');
await frames(4);
await pad('p.axes[3] = -1;');
await frames(2);
check((await lanes<string>('phase')) === 'roll', `pull back and push bowls (phase ${await lanes<string>('phase')})`);
await pad('p.axes[3] = 0;');

// Skip ahead with confirm once the result is in, then open the menu.
await page.waitForFunction(() => (window as unknown as { lanes: { phase: string } }).lanes.phase === 'result', null, { timeout: 30000 });
await frames(30);
await press(0);
await page.waitForFunction(() => ['return', 'sweep', 'aim'].includes((window as unknown as { lanes: { phase: string } }).lanes.phase), null, { timeout: 5000 });
check(true, 'confirm skips the result');
await page.waitForFunction(() => (window as unknown as { lanes: { phase: string } }).lanes.phase === 'aim', null, { timeout: 30000 });
await press(9);
check(await page.isVisible('#menu[open]'), 'menu button opens the menu');

await pad('p.connected = false;');
await frames(3);
check(!(await page.isVisible('#padHow')), 'controller line goes away when it disconnects');
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
