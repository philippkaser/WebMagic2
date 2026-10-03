/** The one AudioContext, its master bus and the shared noise buffers —
 * created lazily on the first user gesture (autoplay policy). Everything
 * else in audio/ reads them through these getters and is a safe no-op
 * before. */

/** Noise in three colours: white (hiss, sparks), pink (air, breath — equal
 * energy per octave) and brown (rumble, surf, a blast's body). */
export type NoiseColor = "white" | "pink" | "brown";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const noise: Partial<Record<NoiseColor, AudioBuffer>> = {};
const onCreate: (() => void)[] = [];

/** Two seconds of each colour, seamless when looped, peaking near ±1. */
function makeNoise(c: BaseAudioContext, color: NoiseColor): AudioBuffer {
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  // Pink: Paul Kellet's filter on white. Brown: white integrated, leaking
  // back to zero so it never wanders off.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === "white") d[i] = w;
    else if (color === "pink") {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      br = (br + 0.02 * w) * 0.998;
      d[i] = br;
    }
  }
  if (color !== "white") {
    // Seamless: the last 50 ms blend into the first; then to a ±1 peak.
    const fade = Math.floor(c.sampleRate * 0.05);
    for (let k = 0; k < fade; k++) {
      const w = k / fade;
      d[len - fade + k] = d[len - fade + k]! * (1 - w) + d[k]! * w;
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]!));
    for (let i = 0; i < len; i++) d[i]! /= peak;
  }
  return buf;
}

/** The master's last stage: unity below about −6 dBFS, then rounding off
 * smoothly toward full scale — so a pile-up of blasts saturates warmly
 * instead of clipping hard. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const knee = 0.5;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

function setUp(c: AudioContext): void {
  ctx = c;
  master = c.createGain();
  master.gain.value = MASTER_GAIN;
  // Master → a gentle compressor that only works when the fight gets
  // loud (it holds a pile-up together) → the soft clipper → out.
  const glue = c.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.knee.value = 10;
  glue.ratio.value = 3;
  glue.attack.value = 0.006;
  glue.release.value = 0.22;
  const clip = c.createWaveShaper();
  clip.curve = softClipCurve();
  clip.oversample = "4x";
  master.connect(glue).connect(clip).connect(c.destination);
  for (const color of ["white", "pink", "brown"] as const) noise[color] = makeNoise(c, color);
  for (const fn of onCreate.splice(0)) fn();
}

/** The master's level, before the compressor — whose automatic make-up gain
 * lifts everything below its threshold by 3.7 dB (measured in the audio
 * lab): 0.45 before it, less those 3.7 dB. */
const MASTER_GAIN = 0.295;

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

/** The shared noise buffer of a colour (white by default). */
export function noiseBuf(color: NoiseColor = "white"): AudioBuffer | null {
  return noise[color] ?? null;
}

/** Run `fn` once the context exists (now, if it already does). */
export function whenAudio(fn: () => void): void {
  if (ctx) fn();
  else onCreate.push(fn);
}
