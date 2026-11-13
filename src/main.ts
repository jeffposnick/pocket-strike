import * as ex from 'excalibur';
import { NEON } from './art.ts';
import { Hud } from './hud.ts';
import { Lanes } from './lanes.ts';
import './style.css';

const game = new ex.Engine({
  canvasElementId: 'game',
  width: 540,
  height: 960,
  displayMode: ex.DisplayMode.FitScreenAndFill,
  backgroundColor: ex.Color.fromHex(NEON.night),
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  suppressPlayButton: true,
  antialiasing: true,
});

const lanes = new Lanes(new Hud());
if (import.meta.env.DEV) (window as unknown as { lanes: Lanes }).lanes = lanes;
game.add('lanes', lanes);
await game.start();
await game.goToScene('lanes');
