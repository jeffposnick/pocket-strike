// Renders the game's sounds off the main thread (see src/audio-synth.ts), so the first tap doesn't
// stall the game while half a second of synthesis runs.
import { bankArrays, renderBank } from './audio-synth.ts';

self.onmessage = (e: MessageEvent<{ sampleRate: number }>) => {
  const bank = renderBank(e.data.sampleRate);
  self.postMessage(bank, { transfer: bankArrays(bank).map((a) => a.buffer as ArrayBuffer) });
};
