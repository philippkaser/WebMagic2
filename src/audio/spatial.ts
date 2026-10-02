import type { Quaternion, Vector3 } from "three";
import { analyzeRoom, impulseResponse, soundPath, type AcousticGrid, type RoomAcoustics } from "./acoustics";
import { audioCtx, masterBus } from "./context";

/** Raytraced sound, in WebAudio.
 *
 * The listener rides the camera. A few times a second the room around it is
 * measured (acoustics.analyzeRoom — a fan of rays through the level): the
 * room's reverb tail is generated to match and crossfaded in on one of two
 * convolvers, its level follows how enclosed the space is, and the nearest
 * walls answer as early reflections — short delays, each panned toward its
 * wall, darker the further they travel.
 *
 * A sound in the world is an `Emitter`: its voices feed the emitter's input,
 * which runs through a lowpass (air, corners, rock) and a gain into an HRTF
 * panner placed where the sound SEEMS to be — straight at it in plain sight,
 * else in the direction of the opening it came through and as far away as
 * it travelled (acoustics.soundPath) — and sends to the room's reverb at
 * much the same level wherever it is, so the further and the more hidden a
 * sound, the more of what you hear is the room. A looping sound (a torch,
 * a portal) re-traces itself as you move. */

/** A point in the world. */
export type At = readonly [number, number, number];

let grid: AcousticGrid | null = null;
let room: RoomAcoustics | null = null;
let roomDirty = true;
const L = { x: 0, y: 1.6, z: 0, rightX: 1, rightZ: 0, analyzedX: Infinity, analyzedZ: Infinity, at: -1 };

export function setAcousticGrid(g: AcousticGrid | null): void {
  grid = g;
  roomDirty = true;
}

export function currentRoom(): RoomAcoustics | null {
  return room;
}

// ── Buses ────────────────────────────────────────────────────────────────────

interface Tap {
  delay: DelayNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  pan: StereoPannerNode;
  /** World direction of its wall (null: floor / ceiling, centred). */
  angle: number | null;
}

interface Buses {
  ctx: AudioContext;
  /** Everything that reaches the room goes in here. */
  send: GainNode;
  conv: [ConvolverNode, ConvolverNode];
  convGain: [GainNode, GainNode];
  active: 0 | 1;
  irKey: string;
  /** The tail's level (how enclosed the room is). */
  ret: GainNode;
  taps: Tap[];
  /** Sounds from where you stand: dry, and into the room. */
  selfIn: GainNode;
  selfSend: GainNode;
  emitters: number;
}

let B: Buses | null = null;
const TAPS = 10;

function buses(): Buses | null {
  if (B) return B;
  const ctx = audioCtx();
  const master = masterBus();
  if (!ctx || !master) return null;
  const send = ctx.createGain();
  const ret = ctx.createGain();
  ret.gain.value = 0;
  ret.connect(master);
  const conv: [ConvolverNode, ConvolverNode] = [ctx.createConvolver(), ctx.createConvolver()];
  const convGain: [GainNode, GainNode] = [ctx.createGain(), ctx.createGain()];
  for (let i = 0; i < 2; i++) {
    conv[i]!.normalize = true;
    convGain[i]!.gain.value = 0;
    send.connect(conv[i]!).connect(convGain[i]!).connect(ret);
  }
  const taps: Tap[] = [];
  for (let i = 0; i < TAPS; i++) {
    const delay = ctx.createDelay(0.5);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 4000;
    const pan = ctx.createStereoPanner();
    send.connect(delay).connect(filter).connect(gain).connect(pan).connect(master);
    taps.push({ delay, gain, filter, pan, angle: null });
  }
  const selfIn = ctx.createGain();
  const selfSend = ctx.createGain();
  selfSend.gain.value = 0.3;
  selfIn.connect(master);
  selfIn.connect(selfSend).connect(send);
  B = { ctx, send, conv, convGain, active: 0, irKey: "", ret, taps, selfIn, selfSend, emitters: 0 };
  return B;
}

/** Sounds from where you stand (your steps, your spells). */
export function selfOut(): AudioNode | null {
  return buses()?.selfIn ?? masterBus();
}

// ── The room ────────────────────────────────────────────────────────────────

const irCache = new Map<string, AudioBuffer>();

function irFor(b: Buses, r: RoomAcoustics): { key: string; buffer: () => AudioBuffer } {
  // Quantized so walking about doesn't regenerate a tail every step:
  // rt60 in 15% steps, brightness and pre-delay coarsely.
  const rt = Math.exp(Math.round(Math.log(r.rt60) / Math.log(1.15)) * Math.log(1.15));
  const br = Math.round(r.brightness * 10) / 10;
  const pd = Math.round(r.preDelay * 100) / 100;
  const key = `${rt.toFixed(3)}|${br}|${pd}`;
  return {
    key,
    buffer: () => {
      let buf = irCache.get(key);
      if (!buf) {
        const [l, rr] = impulseResponse(b.ctx.sampleRate, rt, br, pd, irCache.size + 1);
        buf = b.ctx.createBuffer(2, l.length, b.ctx.sampleRate);
        buf.copyToChannel(l, 0);
        buf.copyToChannel(rr, 1);
        if (irCache.size > 12) irCache.delete(irCache.keys().next().value!);
        irCache.set(key, buf);
      }
      return buf;
    },
  };
}

const SPEED_OF_SOUND = 343;

function applyRoom(b: Buses, r: RoomAcoustics): void {
  const t = b.ctx.currentTime;
  // The tail: a new one crossfades in on the idle convolver.
  const ir = irFor(b, r);
  if (ir.key !== b.irKey) {
    const next = (1 - b.active) as 0 | 1;
    b.conv[next].buffer = ir.buffer();
    b.convGain[next].gain.setTargetAtTime(1, t, 0.25);
    b.convGain[b.active].gain.setTargetAtTime(0, t, 0.25);
    b.active = next;
    b.irKey = ir.key;
  }
  // (The convolver normalizes its tail well below its input: lift it back.)
  b.ret.gain.setTargetAtTime(r.wet * 2.2, t, 0.3);
  b.selfSend.gain.setTargetAtTime(0.25 + r.wet * 0.6, t, 0.3);
  // Early reflections: the nearest wall each way, the floor, the vault.
  const absorb = 1 - Math.min(0.6, r.openness * 0.5);
  const walls = [...r.reflections].sort((a, c) => a.dist - c.dist).slice(0, TAPS - 2);
  const taps: { dist: number; angle: number | null; k: number }[] = walls.map((w) => ({ dist: w.dist, angle: w.angle, k: 1 }));
  taps.push({ dist: r.floor, angle: null, k: 0.5 });
  if (r.ceiling !== null) taps.push({ dist: r.ceiling, angle: null, k: 0.6 });
  for (let i = 0; i < TAPS; i++) {
    const tap = b.taps[i]!;
    const spec = taps[i];
    if (!spec) {
      tap.gain.gain.setTargetAtTime(0, t, 0.2);
      tap.angle = null;
      continue;
    }
    const delay = Math.min(0.45, (2 * spec.dist) / SPEED_OF_SOUND);
    tap.delay.delayTime.setTargetAtTime(delay, t, 0.08);
    tap.gain.gain.setTargetAtTime((spec.k * absorb * 0.42) / (1 + spec.dist / 3), t, 0.15);
    tap.filter.frequency.setTargetAtTime((1500 + 9000 * r.brightness) / (1 + spec.dist / 10), t, 0.15);
    tap.angle = spec.angle;
  }
}

/** Follow the camera: place the listener, re-measure the room as it moves. */
export function updateListener(pos: Vector3, quat: Quaternion, now: number): void {
  const b = buses();
  if (!b) return;
  const l = b.ctx.listener;
  const t = b.ctx.currentTime;
  // forward = (0,0,-1)·q, up = (0,1,0)·q
  const { x: qx, y: qy, z: qz, w: qw } = quat;
  const fx = -(2 * (qx * qz + qw * qy));
  const fy = -(2 * (qy * qz - qw * qx));
  const fz = -(1 - 2 * (qx * qx + qy * qy));
  const ux = 2 * (qx * qy - qw * qz);
  const uy = 1 - 2 * (qx * qx + qz * qz);
  const uz = 2 * (qy * qz + qw * qx);
  if (l.positionX) {
    l.positionX.setTargetAtTime(pos.x, t, 0.015);
    l.positionY.setTargetAtTime(pos.y, t, 0.015);
    l.positionZ.setTargetAtTime(pos.z, t, 0.015);
    l.forwardX.setTargetAtTime(fx, t, 0.015);
    l.forwardY.setTargetAtTime(fy, t, 0.015);
    l.forwardZ.setTargetAtTime(fz, t, 0.015);
    l.upX.setTargetAtTime(ux, t, 0.015);
    l.upY.setTargetAtTime(uy, t, 0.015);
    l.upZ.setTargetAtTime(uz, t, 0.015);
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(fx, fy, fz, ux, uy, uz);
  }
  L.x = pos.x;
  L.y = pos.y;
  L.z = pos.z;
  // The listener's right, on the ground: early reflections pan by it.
  const rx = -fz;
  const rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  L.rightX = rx / rl;
  L.rightZ = rz / rl;
  for (const tap of b.taps) {
    if (tap.angle === null) tap.pan.pan.setTargetAtTime(0, t, 0.05);
    else tap.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (Math.cos(tap.angle) * L.rightX + Math.sin(tap.angle) * L.rightZ) * 0.85)), t, 0.05);
  }
  // Re-measure the room a few times a second, when moved or changed.
  if (!grid) {
    if (room) {
      room = null;
      b.ret.gain.setTargetAtTime(0, t, 0.3);
      for (const tap of b.taps) tap.gain.gain.setTargetAtTime(0, t, 0.2);
    }
    return;
  }
  const moved = Math.hypot(pos.x - L.analyzedX, pos.z - L.analyzedZ);
  if (roomDirty || (now - L.at > 0.15 && moved > 0.3)) {
    roomDirty = false;
    L.at = now;
    L.analyzedX = pos.x;
    L.analyzedZ = pos.z;
    room = analyzeRoom(grid, pos.x, pos.z, 1.6);
    applyRoom(b, room);
  }
}

// ── Emitters ────────────────────────────────────────────────────────────────

const MAX_EMITTERS = 40;

export class Emitter {
  readonly input: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly dry: GainNode;
  private readonly panner: PannerNode;
  private readonly sendGain: GainNode;
  private gone = false;

  constructor(
    private readonly b: Buses,
    private pos: At,
    private readonly level: number,
  ) {
    const ctx = b.ctx;
    this.input = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.dry = ctx.createGain();
    this.panner = ctx.createPanner();
    this.panner.panningModel = "HRTF";
    this.panner.distanceModel = "inverse";
    this.panner.refDistance = 1.8;
    this.panner.rolloffFactor = 1.1;
    this.panner.maxDistance = 120;
    this.sendGain = ctx.createGain();
    this.input.connect(this.filter).connect(this.dry).connect(this.panner).connect(masterBus()!);
    this.input.connect(this.sendGain).connect(b.send);
    b.emitters++;
    this.place(pos, true);
  }

  /** Re-trace from `pos` (a moving or looping sound; the listener moved). */
  place(pos: At = this.pos, immediate = false): void {
    if (this.gone) return;
    this.pos = pos;
    const t = this.b.ctx.currentTime;
    const p = grid ? soundPath(grid, L.x, L.z, pos[0], pos[2]) : null;
    const ax = p ? p.apparent[0] : pos[0];
    const az = p ? p.apparent[1] : pos[2];
    const flat = p ? p.length : Math.hypot(pos[0] - L.x, pos[2] - L.z);
    const dist = Math.hypot(flat, pos[1] - L.y);
    // The direct sound: air dulls its top end with distance; bending round
    // each corner costs it level and most of its highs (edge diffraction);
    // through rock only a dull thud gets by.
    let cutoff = 19000 / (1 + dist / 28);
    let gain = this.level;
    // The room's answer is about as loud wherever in the room the sound is
    // (a diffuse field) — but a sound halls away rings in ITS hall, and
    // less of that reaches this one.
    let send = (room?.wet ?? 0.15) / (1 + Math.max(0, dist - 8) / 14);
    if (p && p.corners > 0) {
      cutoff /= 1 + 2 * p.corners;
      gain *= Math.pow(0.55, p.corners);
      send *= Math.pow(0.85, p.corners);
    }
    if (p?.blocked) {
      cutoff = 380;
      gain *= 0.2;
      send *= 0.4;
    }
    const tc = immediate ? 0.001 : 0.12;
    this.filter.frequency.setTargetAtTime(Math.max(120, cutoff), t, tc);
    this.dry.gain.setTargetAtTime(gain, t, tc);
    this.sendGain.gain.setTargetAtTime(Math.min(1.2, send) * this.level, t, tc);
    const pn = this.panner;
    if (pn.positionX) {
      pn.positionX.setTargetAtTime(ax, t, tc);
      pn.positionY.setTargetAtTime(pos[1], t, tc);
      pn.positionZ.setTargetAtTime(az, t, tc);
    } else {
      pn.setPosition(ax, pos[1], az);
    }
  }

  /** Fade out over `fade` seconds and let go. */
  release(fade = 0.05): void {
    if (this.gone) return;
    this.gone = true;
    const t = this.b.ctx.currentTime;
    this.input.gain.setTargetAtTime(0, t, Math.max(0.005, fade / 3));
    setTimeout(() => {
      this.input.disconnect();
      this.filter.disconnect();
      this.dry.disconnect();
      this.panner.disconnect();
      this.sendGain.disconnect();
      this.b.emitters--;
    }, fade * 1000 + 120);
  }
}

/** A sound at `pos` that plays for `life` seconds and then lets go. Null when
 * there's no audio yet, or too many sounds are already playing. */
export function oneShotAt(pos: At, life: number, level = 1): AudioNode | null {
  const b = buses();
  if (!b || b.emitters >= MAX_EMITTERS) return null;
  const e = new Emitter(b, pos, level);
  setTimeout(() => e.release(0.05), (life + 0.1) * 1000);
  return e.input;
}

/** A lasting sound at `pos` (a torch, a portal): re-trace it with
 * `place()`, end it with `release()`. Null when there's no audio yet. */
export function emitterAt(pos: At, level = 1): Emitter | null {
  const b = buses();
  if (!b || b.emitters >= MAX_EMITTERS) return null;
  return new Emitter(b, pos, level);
}

/** Where the listener stands (for systems choosing what to voice). */
export function listenerAt(): { x: number; y: number; z: number } {
  return L;
}

// Dev-only: what the ears hear (end-to-end scripts, debugging).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__audio = () => ({
    room,
    emitters: B?.emitters ?? 0,
    tail: B?.irKey ?? "",
    buses: B,
    listener: { x: L.x, y: L.y, z: L.z },
  });
}
