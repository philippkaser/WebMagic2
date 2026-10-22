import { keepAwake, type KeepAwake } from "./keepAwake";

/** The one AudioContext, its master bus and a shared noise buffer — created
 * lazily on the first user gesture (autoplay policy). Everything else in
 * audio/ reads them through these getters and is a safe no-op before. Kept
 * running for the rest of the session (keepAwake.ts): a browser can stop it
 * mid-play, and while it's stopped no new sound is built (`audible`). */

let ctx: AudioContext | null = null;
/** The game's own context has one; the audio lab's offline one doesn't (it
 * suspends itself on purpose, frame by frame). */
let keeper: KeepAwake | null = null;
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

/** Create the context (the first gesture), or wake it if it has stopped
 * since. Cheap while it's running: one state check. */
export function ensureContext(): void {
  if (!ctx) {
    const c = new AudioContext();
    keeper = keepAwake(c, onPageReturn);
    setUp(c);
  }
  keeper?.wake();
}

/** The page shown or focused again: a stopped context may resume now. */
function onPageReturn(wake: () => void): void {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wake();
  });
  window.addEventListener("pageshow", wake);
  window.addEventListener("focus", wake);
}

/** Can a sound play right now? Not before the context exists, and not while
 * the game's context is stopped (built then, sounds wait in a frozen graph
 * and all fire at once when it comes back). The audio lab's offline context
 * always can. */
export function audible(): boolean {
  return !!ctx && (!keeper || keeper.running());
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
