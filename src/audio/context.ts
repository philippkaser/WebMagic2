/** The one AudioContext, its master bus and a shared noise buffer — created
 * lazily on the first user gesture (autoplay policy). Everything else in
 * audio/ reads them through these getters and is a safe no-op before. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
const onCreate: (() => void)[] = [];

export function ensureContext(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    for (const fn of onCreate) fn();
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function audioCtx(): AudioContext | null {
  return ctx;
}

export function masterBus(): GainNode | null {
  return master;
}

export function noiseBuf(): AudioBuffer | null {
  return noiseBuffer;
}

/** Run `fn` once the context exists (now, if it already does). */
export function whenAudio(fn: () => void): void {
  if (ctx) fn();
  else onCreate.push(fn);
}
