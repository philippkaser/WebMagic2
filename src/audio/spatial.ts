import type { Quaternion, Vector3 } from "three";
import { analyzeRoom, hearing, impulseResponse, zoneAt, zoneHearing, type AcousticGrid, type RoomAcoustics } from "./acoustics";
import { audioCtx, masterBus } from "./context";

/** Raytraced sound, in WebAudio.
 *
 * The listener rides the camera. A few times a second, when it has moved,
 * the space around it is measured (acoustics.analyzeRoom — rays bouncing
 * through the level) and the local reverb tail is generated to match and
 * crossfaded in on one of two convolvers; how much of the room comes back
 * sets the tail's level. The ambient air bed follows the space too: fuller
 * in a big hall, thinner in a cell, leaning toward the open side under the
 * sky (the reference's "ambient bus").
 *
 * The dungeon's rooms ring on their own (as Wwise's rooms and portals do):
 * a room with something sounding in it — or you in it — gets a tail of its
 * own, measured at its middle. A sound rings in the room it's in, wherever
 * you are; from outside, that room's ringing reaches you through the
 * nearest way in (acoustics.zoneHearing): from the doorway's side, duller
 * the further round the corners, fainter the further off. So stepping out
 * of a hall changes nothing at first — the hall is still ringing behind
 * you — and it fades as you walk away. Sounds in the corridors, and your
 * own, ring in the space you're in.
 *
 * A sound in the world plays on a voice from a fixed pool: its input runs
 * through a lowpass (how clearly it gets through — acoustics.hearing — and
 * the air it crossed), a gain for distance, a head-shadow filter (behind you
 * is duller) and an equal-power pan, and sends to the room's tail. It is
 * placed where it SEEMS to be: straight at it in plain sight, else toward
 * the opening it came through, as far away as it travelled. Every frame the
 * voices glide toward where they should be — the apparent position swings
 * round you on an arc rather than jumping, the muffling eases in and out in
 * octaves — so nothing zips or pops as you walk. A lasting sound (a torch,
 * a rift) is re-traced as you move (`Emitter.place`).
 *
 * The mix is set in one place (LEVELS below): the room's answer for a sound
 * is about as loud wherever in the room the sound is (a diffuse field),
 * while the sound itself falls off with distance — so a sound beside you is
 * mostly itself, one across a hall is half room, and one round the corner
 * is mostly the room it rings in. */

/** A point in the world. */
export type At = readonly [number, number, number];

// ── Levels ──────────────────────────────────────────────────────────────────

/** Within this many metres a sound is at full level; beyond, it falls off
 * as the inverse of distance (−6 dB per doubling). */
const REF_DISTANCE = 2;
/** How much of a full-level sound goes into the room. The reverb's impulse
 * responses are energy-normalized, so with the return below this is the
 * direct-to-reverb balance — measured in the voice band (scripts/audio-lab)
 * in a mid-sized catacomb hall: your own sounds stand ~15 dB over their
 * echo, a sound 5 m off ~5 dB, one across the hall (11 m) about level with
 * it, one round the corners 25 m away mostly room. */
const SEND = 0.5;
/** The tail's return at full wetness. */
const RETURN = 0.36;
/** Your own steps and spells: a touch drier (you're at the centre of them). */
const SELF_SEND = 0.4;
/** The muffle lowpass at clarity 0 (through rock) and 1 (plain sight), Hz;
 * between, it moves in octaves. */
const MUFFLED_HZ = 320;
const CLEAR_HZ = 20000;
/** How far the pan swings at a sound dead to one side (1 = only that ear). */
const PAN_WIDTH = 0.8;
/** Voices at once: torches and rifts, footsteps, spells, the room's voices. */
const VOICES = 24;
/** Reverb tails at once: the one where you stand, and rooms ringing. */
const TAILS = 4;
/** How much of a sound in another room rings in the space you're in too
 * (what comes through the doorway sets your corridor answering). */
const LEAK = 0.35;

// ── State ───────────────────────────────────────────────────────────────────

let grid: AcousticGrid | null = null;
let room: RoomAcoustics | null = null;
let roomDirty = true;
const L = {
  x: 0,
  y: 1.6,
  z: 0,
  /** Facing and right, on the ground (unit). */
  fx: 0,
  fz: -1,
  rightX: 1,
  rightZ: 0,
  analyzedX: Infinity,
  analyzedZ: Infinity,
  /** Audio time of the last room measurement, and of the last update. */
  at: -1,
  t: -1,
};

/** The room (zone) you're in, or -1; and each room's own acoustics. */
let hereZone = -1;
const zoneRooms = new Map<number, RoomAcoustics>();

export function setAcousticGrid(g: AcousticGrid | null): void {
  grid = g;
  roomDirty = true;
  hereZone = -1;
  zoneRooms.clear();
  // The rooms of the last place no longer exist.
  if (B) for (const tail of B.tails) if (tail.zone >= 0) tail.zone = FREE;
}

function zoneRoom(zone: number): RoomAcoustics | null {
  const c = grid?.zones?.centers[zone];
  if (!grid || !c) return null;
  let r = zoneRooms.get(zone);
  if (!r) {
    r = analyzeRoom(grid, c[0], c[1]);
    zoneRooms.set(zone, r);
  }
  return r;
}

export function currentRoom(): RoomAcoustics | null {
  return room;
}

/** Where the listener stands (for systems choosing what to voice). */
export function listenerAt(): { x: number; y: number; z: number } {
  return L;
}

// ── Buses ────────────────────────────────────────────────────────────────────

interface Voice {
  occ: BiquadFilterNode;
  dry: GainNode;
  shadow: BiquadFilterNode;
  pan: StereoPannerNode;
  /** Into each tail. */
  sends: GainNode[];
  /** The room the source is in (-1: a corridor, or no rooms). */
  zone: number;
  /** The input of the sound playing now. */
  tap: GainNode | null;
  /** 0 idle, 1 a one-shot (until `until`), 2 a lasting sound. */
  mode: 0 | 1 | 2;
  until: number;
  level: number;
  /** How loud it reached you when placed (who yields when all are busy). */
  loud: number;
  /** The source, and where it seems to be: the target (from the last trace)
   * and where the voice has glided to so far (world x, z). */
  sx: number;
  sy: number;
  sz: number;
  ax: number;
  az: number;
  cx: number;
  cz: number;
  clarity: number;
  cClarity: number;
  blocked: boolean;
}

/** Whose ringing a tail is: the space where you stand, or free. (Rooms
 * are their zone numbers, 0 and up.) */
const LOCAL = -1;
const FREE = -2;

/** A reverb: one space's ringing, and the way it reaches you. */
interface Tail {
  /** Sends in here (through a highpass: no boom). */
  input: GainNode;
  /** The local tail crossfades between two as you walk; a room's has one. */
  conv: ConvolverNode[];
  convGain: GainNode[];
  active: number;
  irKey: string;
  /** No new tail before this (audio time): the last crossfade is done. */
  swapReady: number;
  /** A new tail is waiting for that. */
  swapPending: boolean;
  /** Its level: the space's wetness × how much of it reaches you. */
  ret: GainNode;
  /** Its brightness, and the muffle of the way through to you. */
  tone: BiquadFilterNode;
  /** Toward the doorway it comes through. */
  pan: StereoPannerNode;
  zone: number;
  room: RoomAcoustics | null;
  /** How it reaches you (a room you're not in): the share that gets here,
   * the muffle, and where it seems to come from (and how far). */
  reach: number;
  cutoff: number;
  ax: number;
  az: number;
  dist: number;
  /** It has rung out by then (audio time): free to be another room. */
  quietAt: number;
}

interface Buses {
  ctx: AudioContext;
  /** [0] the local tail (where you stand); the rest, rooms. */
  tails: Tail[];
  /** Sounds from where you stand: dry, and into the tail you're in. */
  selfIn: GainNode;
  selfSends: GainNode[];
  /** The ambient air bed (wind, cavern hiss): level and lean by the space. */
  air: GainNode;
  airPan: StereoPannerNode;
  voices: Voice[];
  /** Inputs of sounds cut short or done, disconnected once silent. */
  spent: { tap: GainNode; at: number }[];
}

let B: Buses | null = null;

function makeTail(ctx: AudioContext, master: AudioNode, local: boolean): Tail {
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 160;
  hp.Q.value = -3;
  input.connect(hp);
  const ret = ctx.createGain();
  ret.gain.value = 0;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 7000;
  tone.Q.value = -3;
  const pan = ctx.createStereoPanner();
  ret.connect(tone).connect(pan).connect(master);
  const conv: ConvolverNode[] = [];
  const convGain: GainNode[] = [];
  for (let i = 0; i < (local ? 2 : 1); i++) {
    const c = ctx.createConvolver();
    c.normalize = false;
    const g = ctx.createGain();
    g.gain.value = local ? 0 : 1;
    hp.connect(c).connect(g).connect(ret);
    conv.push(c);
    convGain.push(g);
  }
  return {
    input,
    conv,
    convGain,
    active: 0,
    irKey: "",
    swapReady: 0,
    swapPending: false,
    ret,
    tone,
    pan,
    zone: local ? LOCAL : FREE,
    room: null,
    reach: 0,
    cutoff: CLEAR_HZ,
    ax: 0,
    az: 0,
    dist: 0,
    quietAt: 0,
  };
}

function buses(): Buses | null {
  if (B) return B;
  const ctx = audioCtx();
  const master = masterBus();
  if (!ctx || !master) return null;
  const tails: Tail[] = [];
  for (let i = 0; i < TAILS; i++) tails.push(makeTail(ctx, master, i === 0));
  const selfIn = ctx.createGain();
  selfIn.connect(master);
  const selfSends = tails.map((tail, i) => {
    const g = ctx.createGain();
    g.gain.value = i === 0 ? SELF_SEND : 0;
    selfIn.connect(g).connect(tail.input);
    return g;
  });
  const air = ctx.createGain();
  const airPan = ctx.createStereoPanner();
  air.connect(airPan).connect(master);
  const voices: Voice[] = [];
  for (let i = 0; i < VOICES; i++) {
    const occ = ctx.createBiquadFilter();
    occ.type = "lowpass";
    occ.Q.value = -3;
    occ.frequency.value = CLEAR_HZ;
    const dry = ctx.createGain();
    dry.gain.value = 0;
    const shadow = ctx.createBiquadFilter();
    shadow.type = "lowpass";
    shadow.Q.value = -3;
    shadow.frequency.value = CLEAR_HZ;
    const pan = ctx.createStereoPanner();
    occ.connect(dry).connect(shadow).connect(pan).connect(master);
    const sends = tails.map((tail) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      occ.connect(g).connect(tail.input);
      return g;
    });
    voices.push({
      occ,
      dry,
      shadow,
      pan,
      sends,
      zone: -1,
      tap: null,
      mode: 0,
      until: 0,
      level: 1,
      loud: 0,
      sx: 0,
      sy: 0,
      sz: 0,
      ax: 0,
      az: 0,
      cx: 0,
      cz: 0,
      clarity: 1,
      cClarity: 1,
      blocked: false,
    });
  }
  B = { ctx, tails, selfIn, selfSends, air, airPan, voices, spent: [] };
  return B;
}

/** Sounds from where you stand (your steps, your spells). */
export function selfOut(): AudioNode | null {
  return buses()?.selfIn ?? masterBus();
}

/** The ambient air bed's way out (startAmbient's wind): fuller in big
 * spaces, thinner in small ones, leaning toward open air. */
export function ambientAirOut(): AudioNode | null {
  return buses()?.air ?? masterBus();
}

// ── The room ────────────────────────────────────────────────────────────────

const irCache = new Map<string, AudioBuffer>();
/** Seconds a new tail takes to crossfade in. */
const TAIL_FADE = 0.6;

function irFor(b: Buses, r: RoomAcoustics): { key: string; buffer: () => AudioBuffer } {
  // Quantized so walking about doesn't regenerate a tail every step: the
  // reverb time in 10% steps, pre-delay in 5 ms, brightness in twentieths.
  const step = Math.log(1.1);
  const rt = Math.exp(Math.round(Math.log(r.rt60) / step) * step);
  const pd = Math.round(r.preDelay * 200) / 200;
  const br = Math.round(r.brightness * 20) / 20;
  const key = `${rt.toFixed(3)}|${pd}|${br}`;
  return {
    key,
    buffer: () => {
      let buf = irCache.get(key);
      if (!buf) {
        const [l, rr] = impulseResponse(b.ctx.sampleRate, rt, br, pd, irCache.size + 1);
        buf = b.ctx.createBuffer(2, l.length, b.ctx.sampleRate);
        buf.copyToChannel(l, 0);
        buf.copyToChannel(rr, 1);
        if (irCache.size >= 24) irCache.delete(irCache.keys().next().value!);
        irCache.set(key, buf);
      }
      return buf;
    },
  };
}

/** The space where you stand changed: retune the local tail, and the air. */
function applyRoom(b: Buses, r: RoomAcoustics, t: number): void {
  // A new tail crossfades in on the idle convolver — only once the last
  // crossfade has finished, so the one being replaced is silent.
  const tail = b.tails[0]!;
  const ir = irFor(b, r);
  tail.room = r;
  tail.swapPending = ir.key !== tail.irKey && t < tail.swapReady;
  if (ir.key !== tail.irKey && t >= tail.swapReady) {
    const next = 1 - tail.active;
    tail.conv[next]!.buffer = ir.buffer();
    for (const [i, to] of [[next, 1], [tail.active, 0]] as const) {
      const g = tail.convGain[i]!.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(to, t + TAIL_FADE);
    }
    tail.active = next;
    tail.irKey = ir.key;
    tail.swapReady = t + TAIL_FADE + 0.05;
  }
  tail.ret.gain.setTargetAtTime(r.wet * RETURN, t, 0.3);
  tail.tone.frequency.setTargetAtTime(2500 + 9000 * r.brightness, t, 0.3);
  // The air: fuller in a big space or under the sky, leaning to the open.
  const big = Math.min(1, Math.max(0, (r.size - 3) / 4.5));
  b.air.gain.setTargetAtTime(0.6 + 0.4 * Math.max(r.openness, big), t, 0.8);
  const lean = r.escape[0] * L.rightX + r.escape[1] * L.rightZ;
  b.airPan.pan.setTargetAtTime(Math.max(-0.6, Math.min(0.6, lean * 1.5)), t, 0.8);
}

// ── Rooms ringing ───────────────────────────────────────────────────────────

function tailOf(b: Buses, zone: number): Tail | null {
  if (zone < 0) return null;
  for (const tail of b.tails) if (tail.zone === zone) return tail;
  return null;
}

/** The tail of the space you're in: your room's, or the local one. */
function yours(b: Buses): Tail {
  return tailOf(b, hereZone) ?? b.tails[0]!;
}

/** Room `zone`'s tail — given one if a tail is free (never used, or rung out
 * in a room nobody's in). Null when all are busy: the sound then rings in
 * the space you're in, as a corridor's would. */
function claimTail(b: Buses, zone: number, t: number): Tail | null {
  if (zone < 0) return null;
  const have = tailOf(b, zone);
  if (have) return have;
  const r = zoneRoom(zone);
  if (!r) return null;
  let pick: Tail | null = null;
  for (const tail of b.tails) {
    if (tail.zone === LOCAL || tail.zone === hereZone) continue;
    // (Never one still ringing — even freed by a new floor: retuning a
    // convolver cuts its tail off.)
    if (t >= tail.quietAt) {
      pick = tail;
      break;
    }
  }
  if (!pick) return null;
  // It has rung out: the new room's tail goes straight in.
  const ir = irFor(b, r);
  if (ir.key !== pick.irKey) {
    pick.conv[0]!.buffer = ir.buffer();
    pick.irKey = ir.key;
  }
  pick.zone = zone;
  pick.room = r;
  pick.quietAt = t + r.rt60 + 0.3;
  traceTail(pick);
  const set = (p: AudioParam, x: number) => {
    p.cancelScheduledValues(t);
    p.setValueAtTime(x, t);
  };
  set(pick.ret.gain, tailLevel(pick));
  set(pick.tone.frequency, tailTone(pick));
  set(pick.pan.pan, tailPan(pick));
  return pick;
}

/** How room `tail.zone`'s ringing reaches you, from where you stand. */
function traceTail(tail: Tail): void {
  if (!grid || tail.zone < 0) return;
  if (tail.zone === hereZone) {
    tail.reach = 1;
    tail.cutoff = CLEAR_HZ;
    tail.ax = L.x;
    tail.az = L.z;
    tail.dist = 0;
    return;
  }
  const h = zoneHearing(grid, room, L.x, L.z, tail.zone);
  const dist = Number.isFinite(h.length) ? h.length : 60;
  // As a sound in the doorway would be heard — but a room's ringing comes
  // out of the whole doorway at once and the stone passages carry it on, so
  // it bends round corners more easily and fades far more gently than a
  // single sound would (−5 dB 10 m down a corridor, −8 dB at 20 m).
  tail.reach = (lerp(0.5, 1, h.clarity) * (h.blocked ? 0.6 : 1)) / (1 + Math.max(0, dist - 1) / 12);
  tail.cutoff = MUFFLED_HZ * Math.pow(CLEAR_HZ / MUFFLED_HZ, h.clarity);
  tail.ax = h.apparent[0];
  tail.az = h.apparent[1];
  tail.dist = dist;
}

const tailLevel = (tail: Tail) => (tail.room ? tail.room.wet * RETURN * (tail.zone === LOCAL ? 1 : tail.reach) : 0);
const tailTone = (tail: Tail) => Math.min(2500 + 9000 * (tail.room?.brightness ?? 0.5), tail.zone === LOCAL ? CLEAR_HZ : tail.cutoff);

/** A room's ringing leans toward the doorway it comes through — a little
 * at the threshold (it's all round you), more as you walk away. */
function tailPan(tail: Tail): number {
  if (tail.zone < 0 || tail.zone === hereZone) return 0;
  const dx = tail.ax - L.x;
  const dz = tail.az - L.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return 0;
  const side = (dx * L.rightX + dz * L.rightZ) / d;
  return side * 0.7 * Math.min(1, tail.dist / 4);
}

// ── Voices ──────────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Trace `v`'s source to the listener: set where it seems to be and how
 * clearly it gets through (the targets the voice glides to). */
function trace(b: Buses, v: Voice): void {
  if (grid) {
    const h = hearing(grid, room, L.x, L.z, v.sx, v.sz);
    v.ax = h.apparent[0];
    v.az = h.apparent[1];
    v.clarity = h.clarity;
    v.blocked = h.blocked;
    // The room it rings in (if not yours, it needs a tail of its own).
    v.zone = zoneAt(grid, v.sx, v.sz);
    if (v.zone !== hereZone) claimTail(b, v.zone, b.ctx.currentTime);
  } else {
    v.ax = v.sx;
    v.az = v.sz;
    v.clarity = 1;
    v.blocked = false;
    v.zone = -1;
  }
}

/** The voice's parameters for where it has glided to. */
function mix(v: Voice) {
  const dx = v.cx - L.x;
  const dz = v.cz - L.z;
  const flat = Math.hypot(dx, dz);
  const dist = Math.hypot(flat, v.sy - L.y);
  const c = v.cClarity;
  // Distance, and what bending round corners costs; through rock, a thud.
  // (√2: an equal-power pan puts a centred sound at −3 dB a side; a sound
  // in front of you is as loud as one of your own.)
  let gain = (v.level * REF_DISTANCE * Math.SQRT2) / Math.max(REF_DISTANCE, dist);
  gain *= lerp(0.45, 1, c) * (v.blocked ? 0.6 : 1);
  // The room's answer: much the same anywhere in this room; a sound halls
  // away rings in ITS hall, and less of that gets here.
  const send = v.level * lerp(0.4, 1, c) * (v.blocked ? 0.5 : 1) / (1 + Math.max(0, dist - 12) / 18);
  // Muffle in octaves; the air takes a little top off far sounds.
  const cutoff = Math.min(MUFFLED_HZ * Math.pow(CLEAR_HZ / MUFFLED_HZ, c), CLEAR_HZ * Math.exp(-dist / 40));
  // Direction from your head: pan by the side it's on (less when it's on
  // top of you), duller from behind.
  const near = Math.min(1, flat / 1.2);
  const ux = flat > 1e-4 ? dx / flat : 0;
  const uz = flat > 1e-4 ? dz / flat : 0;
  const side = (ux * L.rightX + uz * L.rightZ) * near;
  const behind = Math.max(0, -(ux * L.fx + uz * L.fz)) * near;
  return { gain, send, cutoff, pan: side * PAN_WIDTH, shadow: CLEAR_HZ * (1 - 0.68 * behind) };
}

function write(b: Buses, v: Voice, t: number, tc: number): void {
  const m = mix(v);
  const set = (p: AudioParam, x: number) => {
    if (tc <= 0) {
      p.cancelScheduledValues(t);
      p.setValueAtTime(x, t);
    } else p.setTargetAtTime(x, t, tc);
  };
  set(v.occ.frequency, m.cutoff);
  set(v.dry.gain, m.gain);
  set(v.shadow.frequency, m.shadow);
  set(v.pan.pan, m.pan);
  // Into the room it's in, in full (its tail carries the way to you), and a
  // little into the space you're in; or, in your space, into yours.
  const own = v.zone !== hereZone ? tailOf(b, v.zone) : null;
  const you = yours(b);
  for (let i = 0; i < b.tails.length; i++) {
    const tail = b.tails[i]!;
    const x = tail === own ? v.level : tail === you ? m.send * (own ? LEAK : 1) : 0;
    set(v.sends[i]!.gain, x * SEND);
    if (x > 0 && tail.room) tail.quietAt = t + tail.room.rt60 + 0.3;
  }
}

/** Glide `v` toward its target over `dt` seconds: the apparent position
 * swings round the listener (bearing and distance, never through your
 * head), the clarity eases (in octaves, through the filter). */
function glide(v: Voice, dt: number): void {
  const k = 1 - Math.exp(-dt * 7);
  const cA = Math.atan2(v.cz - L.z, v.cx - L.x);
  const tA = Math.atan2(v.az - L.z, v.ax - L.x);
  let dA = tA - cA;
  dA -= Math.round(dA / (Math.PI * 2)) * Math.PI * 2;
  const cD = Math.hypot(v.cx - L.x, v.cz - L.z);
  const tD = Math.hypot(v.ax - L.x, v.az - L.z);
  const a = cA + dA * k;
  const d = cD + (tD - cD) * k;
  v.cx = L.x + Math.cos(a) * d;
  v.cz = L.z + Math.sin(a) * d;
  v.cClarity += (v.clarity - v.cClarity) * (1 - Math.exp(-dt * 6));
}

/** Let go of the sound on `v` (fading over `fade` s) and free the voice. */
function retire(b: Buses, v: Voice, t: number, fade: number): void {
  if (v.tap) {
    v.tap.gain.cancelScheduledValues(t);
    v.tap.gain.setValueAtTime(v.tap.gain.value, t);
    v.tap.gain.linearRampToValueAtTime(0, t + fade);
    b.spent.push({ tap: v.tap, at: t + fade + 0.05 });
    v.tap = null;
  }
  v.mode = 0;
}

function sweep(b: Buses, t: number): void {
  for (const v of b.voices) if (v.mode === 1 && t >= v.until) retire(b, v, t, 0.01);
  if (b.spent.length) {
    b.spent = b.spent.filter((s) => {
      if (t < s.at) return true;
      s.tap.disconnect();
      return false;
    });
  }
}

/** A voice for a new sound as loud as `loud` at the listener: a free one,
 * else the quietest one-shot if it's quieter (it's cut short). Lasting
 * sounds are never cut for a one-shot. */
function claim(b: Buses, loud: number, lasting: boolean): Voice | null {
  const t = b.ctx.currentTime;
  sweep(b, t);
  let quiet: Voice | null = null;
  for (const v of b.voices) {
    if (v.mode === 0) return v;
    if (v.mode === 1 && (!quiet || v.loud < quiet.loud)) quiet = v;
  }
  if (quiet && (lasting || quiet.loud < loud)) {
    retire(b, quiet, t, 0.03);
    return quiet;
  }
  return null;
}

function start(b: Buses, pos: At, level: number, lasting: boolean, life = 0): Voice | null {
  const d = Math.hypot(pos[0] - L.x, pos[1] - L.y, pos[2] - L.z);
  const loud = (level * REF_DISTANCE) / Math.max(REF_DISTANCE, d);
  const v = claim(b, loud, lasting);
  if (!v) return null;
  const t = b.ctx.currentTime;
  v.mode = lasting ? 2 : 1;
  v.until = t + life + 0.05;
  v.level = level;
  v.loud = loud;
  v.sx = pos[0];
  v.sy = pos[1];
  v.sz = pos[2];
  trace(b, v);
  v.cx = v.ax;
  v.cz = v.az;
  v.cClarity = v.clarity;
  write(b, v, t, 0);
  const tap = b.ctx.createGain();
  tap.connect(v.occ);
  v.tap = tap;
  return v;
}

/** Follow the camera: place the listener, re-measure the room as it moves,
 * and glide every sounding voice toward where it should be. */
export function updateListener(pos: Vector3, quat: Quaternion): void {
  const b = buses();
  if (!b) return;
  const t = b.ctx.currentTime;
  const dt = L.t < 0 ? 0 : Math.min(0.1, Math.max(0, t - L.t));
  L.t = t;
  // forward = (0,0,-1)·q, flattened onto the ground.
  const { x: qx, y: qy, z: qz, w: qw } = quat;
  const fx = -(2 * (qx * qz + qw * qy));
  const fz = -(1 - 2 * (qx * qx + qy * qy));
  const fl = Math.hypot(fx, fz);
  if (fl > 1e-4) {
    L.fx = fx / fl;
    L.fz = fz / fl;
    L.rightX = -L.fz;
    L.rightZ = L.fx;
  }
  L.x = pos.x;
  L.y = pos.y;
  L.z = pos.z;
  // Re-measure the room several times a second, when moved or changed —
  // and how each ringing room reaches you from here.
  if (!grid) {
    if (room) {
      room = null;
      for (const tail of b.tails) tail.ret.gain.setTargetAtTime(0, t, 0.3);
    }
  } else {
    const moved = Math.hypot(pos.x - L.analyzedX, pos.z - L.analyzedZ);
    if (roomDirty || (t - L.at > 0.12 && moved > 0.25)) {
      roomDirty = false;
      L.at = t;
      L.analyzedX = pos.x;
      L.analyzedZ = pos.z;
      room = analyzeRoom(grid, pos.x, pos.z);
      applyRoom(b, room, t);
      hereZone = zoneAt(grid, pos.x, pos.z);
      claimTail(b, hereZone, t);
      for (const tail of b.tails) traceTail(tail);
    } else if (room && b.tails[0]!.swapPending && t >= b.tails[0]!.swapReady) {
      // A tail that had to wait for the last crossfade.
      applyRoom(b, room, t);
    }
  }
  // Rooms' tails: their level and muffle ease, their lean follows your head.
  for (const tail of b.tails) {
    if (tail.zone < 0) continue;
    tail.ret.gain.setTargetAtTime(tailLevel(tail), t, 0.25);
    tail.tone.frequency.setTargetAtTime(tailTone(tail), t, 0.25);
    tail.pan.pan.setTargetAtTime(tailPan(tail), t, 0.05);
  }
  // Your own sounds ring in the space you're in.
  const you = yours(b);
  for (let i = 0; i < b.tails.length; i++) b.selfSends[i]!.gain.setTargetAtTime(b.tails[i] === you ? SELF_SEND : 0, t, 0.08);
  if (you.room) you.quietAt = t + you.room.rt60 + 0.3;
  sweep(b, t);
  for (const v of b.voices) {
    if (v.mode === 0) continue;
    glide(v, dt);
    write(b, v, t, 0.02);
  }
}

// ── Sounds in the world ─────────────────────────────────────────────────────

/** A lasting sound in the world (a torch, a rift): its voices go into
 * `input`; `place()` re-traces it (as the listener moves, or it does),
 * `release()` lets it go. */
export class Emitter {
  private gone = false;

  constructor(
    private readonly b: Buses,
    private readonly v: Voice,
    readonly input: GainNode,
  ) {}

  /** Re-trace from `pos` (a moving or lasting sound; the listener moved). */
  place(pos?: At): void {
    if (this.gone) return;
    if (pos) {
      this.v.sx = pos[0];
      this.v.sy = pos[1];
      this.v.sz = pos[2];
    }
    trace(this.b, this.v);
  }

  /** Fade out over `fade` seconds and let go. */
  release(fade = 0.05): void {
    if (this.gone) return;
    this.gone = true;
    const t = this.b.ctx.currentTime;
    // Let it ring out as a one-shot, then free the voice.
    this.v.mode = 1;
    this.v.until = t + fade;
    this.input.gain.cancelScheduledValues(t);
    this.input.gain.setValueAtTime(this.input.gain.value, t);
    this.input.gain.linearRampToValueAtTime(0, t + fade);
  }
}

/** A sound at `pos` that plays for `life` seconds and then lets go: connect
 * its voices to the returned node. Null when there's no audio yet, or every
 * voice is busy with something louder. */
export function oneShotAt(pos: At, life: number, level = 1): AudioNode | null {
  const b = buses();
  if (!b) return null;
  return start(b, pos, level, false, life)?.tap ?? null;
}

/** A lasting sound at `pos` (a torch, a rift): re-trace it with `place()`,
 * end it with `release()`. Null when there's no audio yet. */
export function emitterAt(pos: At, level = 1): Emitter | null {
  const b = buses();
  if (!b) return null;
  const v = start(b, pos, level, true);
  return v && v.tap ? new Emitter(b, v, v.tap) : null;
}

/** About how loud a sound at `pos` reaches you (1: a full-level sound right
 * beside you) — the way round, the muffling and all. For choosing which
 * lasting sounds are worth a voice: the torch round the corner you just
 * came from, not the one behind the rock. */
export function audibility(pos: At, level = 1): number {
  const dy = pos[1] - L.y;
  if (!grid) return (level * REF_DISTANCE) / Math.max(REF_DISTANCE, Math.hypot(pos[0] - L.x, dy, pos[2] - L.z));
  const h = hearing(grid, room, L.x, L.z, pos[0], pos[2]);
  const d = Math.hypot(h.length, dy);
  return ((level * REF_DISTANCE) / Math.max(REF_DISTANCE, d)) * lerp(0.45, 1, h.clarity) * (h.blocked ? 0.6 : 1);
}

// Dev-only: what the ears hear (end-to-end scripts, debugging).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__audio = () => ({
    room,
    voices: B?.voices.filter((v) => v.mode !== 0).length ?? 0,
    sounding: B?.voices
      .filter((v) => v.mode !== 0)
      .map((v) => ({ at: [v.sx, v.sz], zone: v.zone, lasting: v.mode === 2, clarity: v.cClarity, blocked: v.blocked, ...mix(v) })),
    tails: B?.tails.map((tail) => ({ zone: tail.zone, key: tail.irKey, level: tailLevel(tail), reach: tail.reach })),
    here: hereZone,
    listener: { x: L.x, y: L.y, z: L.z },
  });
}
