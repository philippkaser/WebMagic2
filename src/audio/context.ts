/** The one AudioContext, its master bus and a shared noise buffer — created
 * lazily on the first user gesture (autoplay policy). Everything else in
 * audio/ reads them through these getters and is a safe no-op before. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
const onCreate: (() => void)[] = [];

function setUp(c: AudioContext): void {
  ctx = c;
  master = c.createGain();
  master.gain.value = 0.45;
  master.connect(c.destination);
  const len = c.sampleRate * 2;
  noiseBuffer = c.createBuffer(1, len, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  for (const fn of onCreate.splice(0)) fn();
}

export function ensureContext(): void {
  if (!ctx) setUp(new AudioContext());
  if (ctx!.state === "suspended") void ctx!.resume();
}

/** Render into an OfflineAudioContext instead (scripts/audio-lab: scenes
 * rendered to WAV, faster than real time). Once, before anything plays. */
export function adoptOfflineContext(c: OfflineAudioContext): void {
  if (ctx) throw new Error("audio context already created");
  setUp(c as unknown as AudioContext);
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
