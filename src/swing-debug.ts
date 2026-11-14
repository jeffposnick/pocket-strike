// Tuning overlay for swing controls, loaded only with `?swingdebug` in the URL. It plots the phone's
// rotation speed, shows what the last release measured, and saves that swing as JSON so it can be
// replayed against src/swing.ts (see docs/DEVELOPMENT.md).
import type { Motion } from './motion.ts';
import { SWING } from './swing.ts';

export function swingDebug(motion: Motion): void {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;left:8px;right:8px;bottom:8px;z-index:10;padding:8px;border-radius:12px;' +
    'background:rgba(12,10,31,.85);border:1px solid rgba(255,255,255,.2);font:12px/1.4 ui-monospace,monospace;' +
    'color:#fff;pointer-events:none';
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 60;
  canvas.style.cssText = 'width:100%;height:60px;display:block';
  const text = document.createElement('div');
  text.textContent = 'Swing debug: waiting for a release';
  const save = document.createElement('button');
  save.textContent = 'Save last swing';
  save.style.cssText =
    'pointer-events:auto;margin-top:6px;padding:4px 10px;border-radius:8px;border:1px solid #38f3ff;background:none;color:#38f3ff';
  save.onclick = () => {
    if (!motion.last) return;
    const blob = new Blob([JSON.stringify({ ...motion.last, userAgent: navigator.userAgent, tuning: SWING })], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `swing-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  box.append(canvas, text, save);
  document.body.append(box);

  const ctx = canvas.getContext('2d')!;
  const rates: number[] = [];
  let shown: unknown = null;
  motion.onSample = (s) => {
    rates.push(Math.hypot(s.rx, s.ry, s.rz));
    if (rates.length > 150) rates.shift();
  };
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const y = (v: number) => canvas.height - (Math.min(v, 1000) / 1000) * canvas.height;
    ctx.strokeStyle = 'rgba(255,200,74,.6)';
    ctx.beginPath();
    ctx.moveTo(0, y(SWING.minPeak));
    ctx.lineTo(canvas.width, y(SWING.minPeak));
    ctx.stroke();
    ctx.strokeStyle = '#38f3ff';
    ctx.beginPath();
    rates.forEach((v, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (i / 150) * canvas.width, y(v)));
    ctx.stroke();
    if (motion.last && motion.last !== shown) {
      shown = motion.last;
      const r = motion.last.result;
      const hz =
        motion.last.samples.length /
        Math.max(0.001, (motion.last.samples.at(-1)?.t ?? 0) - (motion.last.samples[0]?.t ?? 0));
      text.textContent = r
        ? `power ${r.power.toFixed(2)} · angle ${r.angle.toFixed(3)} · spin ${r.spin.toFixed(2)} | peak ${r.peak.toFixed(0)}°/s · arc ${r.arc.toFixed(0)}° · twist ${r.twist.toFixed(0)}° · side ${r.side.toFixed(0)}° · ${hz.toFixed(0)} Hz`
        : `no throw (${motion.last.samples.length} samples, ${hz.toFixed(0)} Hz)`;
    }
    requestAnimationFrame(draw);
  };
  draw();
}
