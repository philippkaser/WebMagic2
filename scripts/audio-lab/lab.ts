// The audio lab: renders scripted scenes through the real audio code into an
// OfflineAudioContext — a walk through a generated floor, its torches, your
// steps, spells and explosions, or bare impulses to measure the acoustics —
// and hands back WAVs (see render.mjs). Served by vite as a page of its own.
import { Quaternion, Vector3 } from "three";
import { gridFromLayout } from "../../src/audio/acoustics";
import { adoptOfflineContext, masterBus, noiseBuf } from "../../src/audio/context";
import { playCast, playExplosion, startAmbient } from "../../src/audio/sound";
import { emitterAt, oneShotAt, selfOut, setAcousticGrid, setHeadphones, updateListener, type Emitter } from "../../src/audio/spatial";
import { chooseLoops, playEnemyStep, playFootstep, playRoomVoice, startTorch, type Loop } from "../../src/audio/voices";
import { generateFloor } from "../../src/world/gen";
import { BANK } from "./bank";
import { buildScene, wav } from "./scene";

const BANK_BY_NAME = new Map(Object.values(BANK).flat().map((s) => [s.name, s]));

const SR = 48000;
/** As AudioWorld: the torches that reach you loudest, re-traced a few times a second. */
const MAX_LOOPS = 5;
const LOOP_TICK = 0.2;

function impulse(ctx: BaseAudioContext, dst: AudioNode, at: number): void {
  const b = ctx.createBuffer(1, 2, SR);
  b.getChannelData(0)[0] = 1;
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(dst);
  s.start(at);
}

async function render(name: string): Promise<string> {
  // "scene:speakers" renders it for speakers rather than headphones.
  const [base, mode] = name.split(":");
  name = base!;
  setHeadphones(mode !== "speakers");
  const layout = generateFloor(1234, 3);
  const scene = buildScene(layout, name);
  const ctx = new OfflineAudioContext(2, Math.ceil(scene.duration * SR), SR);
  adoptOfflineContext(ctx);
  setAcousticGrid(gridFromLayout(layout));
  const q = new Quaternion();
  const v = new Vector3();
  const up = new Vector3(0, 1, 0);
  const pose = (t: number) => {
    const p = scene.pose(t);
    v.set(p.x, 1.6, p.z);
    q.setFromAxisAngle(up, p.yaw);
    updateListener(v, q);
  };
  if (scene.ambient) startAmbient("dungeon", { drone: 41, wind: 220, weight: 1 });
  const loops = new Map<number, Loop>();
  const torches = layout.torches.map((at, i) => ({ key: String(i), at, reach: 24, level: 1 }));
  let nextLoopTick = 0;
  let steady: Emitter | null = null;
  const movers: Emitter[] = [];
  let nextLog = 0;
  const fired = new Set<number>();
  const bankStops = new Map<string, () => void>();
  const bankLogged = new Set<string>();
  const step = (t: number) => {
    pose(t);
    const tick = t >= nextLoopTick;
    if (tick) nextLoopTick = t + LOOP_TICK;
    if (scene.steady) {
      if (!steady) {
        steady = emitterAt(scene.steady);
        if (steady) {
          const src = ctx.createBufferSource();
          src.buffer = noiseBuf();
          src.loop = true;
          const g = ctx.createGain();
          g.gain.value = 0.1;
          src.connect(g).connect(steady.input);
          src.start();
        }
      } else if (tick) steady.place();
    }
    if (scene.moving) {
      scene.moving.forEach((m, i) => {
        let e = movers[i];
        if (!e) {
          const made = emitterAt(m.at(t), m.level ?? 1, m.size);
          if (!made) return;
          e = movers[i] = made;
          const g = ctx.createGain();
          if (m.kind === "noise") {
            const src = ctx.createBufferSource();
            src.buffer = noiseBuf();
            src.loop = true;
            src.connect(g);
            src.start(ctx.currentTime, i * 0.37);
            g.gain.value = 0.1;
          } else {
            const o = ctx.createOscillator();
            o.frequency.value = 440;
            o.connect(g);
            o.start();
            g.gain.value = 0.15;
          }
          g.connect(e.input);
        } else e.place(m.at(t));
      });
    }
    if (scene.log && t >= nextLog) {
      nextLog = t + 0.25;
      type Heard = {
        room: { rt60: number; wet: number } | null;
        here: number;
        tails: { zone: number; level: number }[];
        sounding: { at: number[]; zone: number; clarity: number; gain: number; lasting: boolean }[];
      };
      const a = (window as unknown as { __audio: () => Heard }).__audio();
      const p = scene.pose(t);
      console.log(
        `[lab] t=${t.toFixed(2)} at=(${p.x.toFixed(1)},${p.z.toFixed(1)}) rt=${a.room?.rt60.toFixed(2)} wet=${a.room?.wet.toFixed(2)} | ` +
          a.sounding
            .filter((v) => v.lasting)
            .map((v) => `(${v.at[0]!.toFixed(0)},${v.at[1]!.toFixed(0)})z${v.zone} c=${v.clarity.toFixed(2)} g=${v.gain.toFixed(3)}`)
            .join("  ") +
          ` | here z${a.here} tails ` +
          a.tails.map((x) => `z${x.zone}:${x.level.toFixed(3)}`).join(" "),
      );
    }
    if (scene.torches && tick) {
      const near = chooseLoops(torches, (key) => loops.has(Number(key)), MAX_LOOPS).map((s) => ({ i: Number(s.key), at: s.at }));
      const want = new Set(near.map((n) => n.i));
      for (const [i, l] of loops)
        if (!want.has(i)) {
          l.stop();
          loops.delete(i);
        }
      for (const n of near) {
        const l = loops.get(n.i);
        if (l) l.emitter.place(n.at);
        else {
          const s = startTorch(n.at);
          if (s) loops.set(n.i, s);
        }
      }
    }
    scene.events.forEach((e, i) => {
      if (fired.has(i) || e.t > t) return;
      fired.add(i);
      switch (e.kind) {
        case "step":
          // Left foot, right foot, as the player's.
          playFootstep("stone", e.loud ?? 1, undefined, i & 1 ? 1 : -1);
          break;
        case "cast":
          playCast();
          break;
        case "explosion":
          playExplosion(4, e.at);
          break;
        case "slime":
          playEnemyStep("slime", e.at!);
          break;
        case "drip":
          playRoomVoice("drip", e.at!);
          break;
        case "impulse-self":
          impulse(ctx, selfOut()!, ctx.currentTime);
          break;
        case "impulse-at": {
          const n = oneShotAt(e.at!, 3);
          if (n) impulse(ctx, n, ctx.currentTime);
          break;
        }
        case "bank": {
          if (e.stop) {
            bankStops.get(e.name!)?.();
            bankStops.delete(e.name!);
            break;
          }
          if (!bankLogged.has(e.name!)) console.log(`[lab] bank ${e.name} ${t.toFixed(3)}`);
          bankLogged.add(e.name!);
          const stop = BANK_BY_NAME.get(e.name!)!.play(e.at!);
          if (stop) bankStops.set(e.name!, stop);
          break;
        }
        case "impulse-dry":
          impulse(ctx, masterBus()!, ctx.currentTime);
          break;
      }
    });
  };
  // A frame every 1/60 s: the offline render stops there, the scene moves on.
  const frame = 1 / 60;
  for (let t = frame; t < scene.duration - 0.05; t += frame) {
    void ctx.suspend(t).then(() => {
      step(ctx.currentTime);
      void ctx.resume();
    });
  }
  step(0);
  return wav(await ctx.startRendering());
}

(window as unknown as Record<string, unknown>).__lab = { render };
