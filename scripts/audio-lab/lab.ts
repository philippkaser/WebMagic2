// The audio lab: renders scripted scenes through the real audio code into an
// OfflineAudioContext — a walk through a generated floor, its torches, your
// steps, spells and explosions, or bare impulses to measure the acoustics —
// and hands back WAVs (see render.mjs). Served by vite as a page of its own.
import { Quaternion, Vector3 } from "three";
import { gridFromLayout } from "../../src/audio/acoustics";
import { adoptOfflineContext, masterBus } from "../../src/audio/context";
import { playCast, playExplosion, startAmbient } from "../../src/audio/sound";
import { oneShotAt, selfOut, setAcousticGrid, updateListener } from "../../src/audio/spatial";
import { playEnemyStep, playFootstep, playRoomVoice, startTorch, type Loop } from "../../src/audio/voices";
import { generateFloor } from "../../src/world/gen";
import { buildScene, wav } from "./scene";

const SR = 48000;
/** As AudioWorld: the nearest torches sounding, re-traced a few times a second. */
const MAX_LOOPS = 5;
const LOOP_TICK = 0.2;
const LOOP_REACH = 20;

function impulse(ctx: BaseAudioContext, dst: AudioNode, at: number): void {
  const b = ctx.createBuffer(1, 2, SR);
  b.getChannelData(0)[0] = 1;
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(dst);
  s.start(at);
}

async function render(name: string): Promise<string> {
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
  let nextLoopTick = 0;
  const fired = new Set<number>();
  const step = (t: number) => {
    pose(t);
    if (scene.torches && t >= nextLoopTick) {
      nextLoopTick = t + LOOP_TICK;
      const p = scene.pose(t);
      const near = layout.torches
        .map((at, i) => ({ at, i, d: Math.hypot(at[0] - p.x, at[2] - p.z) }))
        .filter((s) => s.d < LOOP_REACH)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_LOOPS);
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
          playFootstep("stone", e.loud ?? 1);
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
