// End-to-end check of swing controls in Chromium: the menu switch, the first-time dialog, a
// synthetic swing replayed through real `devicemotion` events, and switching back to flicking.
//
//   npm run dev &
//   node tools/swing-check.ts [http://localhost:5173/]
//
// Needs the dev server (the scene is exposed as `window.lanes` only in dev builds) and Playwright.
import { createRequire } from 'node:module';
import { synthStill, synthSwing } from './sim/swing-synth.ts';
import type { MotionSample } from '../src/swing.ts';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};

const browser = await chromium.launch();

// Without sensor permission the switch flips back off and says why.
{
  const context = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
  await context.grantPermissions([]);
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('#menu[open]');
  await page.click('#swingToggle');
  await page.waitForSelector('#swingNote:not([hidden])', { timeout: 5000 });
  check(!(await page.isChecked('#swing')), `blocked motion access turns the switch back off: "${await page.textContent('#swingNote')}"`);
  await context.close();
}

const context = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
await context.grantPermissions(['accelerometer', 'gyroscope']);
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));

// A fake sensor: reports the phone at rest at 60 Hz, or plays back queued samples.
await page.addInitScript(() => {
  const w = window as unknown as { __queue: number[][] };
  w.__queue = [];
  setInterval(() => {
    const s = w.__queue.shift() ?? [0, 0, 9.81, 0, 0, 0];
    window.dispatchEvent(
      new DeviceMotionEvent('devicemotion', {
        accelerationIncludingGravity: { x: s[0], y: s[1], z: s[2] },
        rotationRate: { beta: s[3], gamma: s[4], alpha: s[5] },
        interval: 16,
      }),
    );
  }, 1000 / 60);
});

const play = async (samples: MotionSample[]) => {
  await page.evaluate((q: number[][]) => {
    (window as unknown as { __queue: number[][] }).__queue.push(...q);
  }, samples.map((s) => [s.ax, s.ay, s.az, s.rx, s.ry, s.rz]));
  await page.waitForFunction(() => (window as unknown as { __queue: number[][] }).__queue.length === 0, null, { timeout: 10000 });
};
const phase = () => page.evaluate(() => (window as unknown as { lanes: { phase: string } }).lanes.phase);
const waitAim = () => page.waitForFunction(() => (window as unknown as { lanes: { phase: string } }).lanes.phase === 'aim', null, { timeout: 30000 });

await page.goto(url);
await page.waitForSelector('#menu[open]');
check(await page.isVisible('#swingToggle'), 'swing switch is offered on a touch phone');
check((await page.getAttribute('#swingBtn', 'aria-pressed')) === 'false', 'swing controls start off');

await page.click('#swingToggle');
await page.waitForSelector('#swingIntro[open]', { timeout: 5000 });
check(true, 'first switch-on shows how to swing');
await page.click('#swingOk');
check((await page.getAttribute('#swingBtn', 'aria-pressed')) === 'true', 'in-game button shows swing on');
check(await page.evaluate(() => localStorage.getItem('ps-swing') === '1'), 'choice is saved');

await page.click('#play');
await waitAim();
const box = await page.locator('canvas').boundingBox();
const x = box.x + box.width / 2;
const y = box.y + box.height * 0.8;

// Thumb down and up with the phone still: nothing is thrown.
await page.mouse.move(x, y);
await page.mouse.down();
await play(synthStill(0.6, 0, { gyroNoise: 2 }).samples);
await page.mouse.up();
await page.waitForTimeout(200);
check((await phase()) === 'aim', 'holding still and letting go throws nothing');

// A flick with swing controls on doesn't throw either.
await page.mouse.move(x, y);
await page.mouse.down();
for (let i = 1; i <= 6; i++) await page.mouse.move(x, y - i * 60);
await page.mouse.up();
await page.waitForTimeout(200);
check((await phase()) === 'aim', 'a finger flick does nothing while swing controls are on');

// A real swing with a hook: thumb down, swing, let go.
await page.mouse.move(x, y);
await page.mouse.down();
await play(synthSwing({ twist: 60, fwdTime: 0.35 }).samples);
await page.mouse.up();
await page.waitForTimeout(100);
check((await phase()) === 'roll', `a swing bowls the ball (phase ${await phase()})`);
const shown = await page.textContent('#throw');
check(!!shown && /↰/.test(shown), `the twist hooks left (${shown})`);

// Switch back to flicking with the in-game button.
await waitAim();
await page.click('#swingBtn');
check((await page.getAttribute('#swingBtn', 'aria-pressed')) === 'false', 'in-game button turns swing off');
await page.mouse.move(x, y);
await page.mouse.down();
for (let i = 1; i <= 6; i++) await page.mouse.move(x, y - i * 50);
await page.mouse.up();
await page.waitForTimeout(100);
check((await phase()) === 'roll', 'flicking works again');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
