import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { estimatePeer, peerIds } from "../net/players";
import { GATE_TORCHES, LANE, LANTERNS, PLAZA_R } from "../scenes/village/layout";
import type { BiomeId, FloorLayout } from "../world/types";
import { gridFromLayout, openAt, villageGrid, type AcousticGrid } from "./acoustics";
import { listenerAt, setAcousticGrid, updateListener, type At } from "./spatial";
import {
  chooseLoops,
  groundAt,
  playFootstep,
  playRoomVoice,
  setGround,
  startRiftHum,
  startTorch,
  type Ground,
  type Loop,
  type LoopSource,
  type RoomVoice,
} from "./voices";

/** The scene's ears. Mounted once in the world canvas, it hands the level to
 * the acoustics (spatial.ts) and moves the listener with the camera every
 * frame, keeps the nearest torches and rifts sounding where they stand,
 * walks the other wizards' footsteps, and now and then lets the place say
 * something by itself — somewhere you can hear but not quite see. */

const GROUND: Record<BiomeId, Ground> = {
  catacombs: "stone",
  drowned: "wet",
  forge: "iron",
  crystal: "crystal",
  hollow: "ash",
};

function villageGround(x: number, z: number): Ground {
  if (Math.hypot(x, z) < PLAZA_R) return "cobble";
  if (Math.abs(x) < LANE.width / 2 && z > LANE.z0 && z < LANE.z1) return "cobble";
  return "grass";
}

/** What each place says by itself, and how often (weights). */
const ROOM_VOICES: Record<BiomeId | "village", [RoomVoice, number][]> = {
  catacombs: [["settle", 3], ["skitter", 2], ["drip", 1], ["groan", 1]],
  drowned: [["drip", 7], ["groan", 1], ["settle", 1]],
  forge: [["ember", 5], ["settle", 2], ["groan", 1]],
  crystal: [["chime", 4], ["drip", 2], ["settle", 1]],
  hollow: [["skitter", 3], ["groan", 2], ["settle", 2]],
  village: [["cricket", 12], ["owl", 1]],
};

/** Where in the room each voice comes from (height, m). */
const VOICE_Y: Record<RoomVoice, number> = {
  drip: 0.2,
  chime: 3,
  ember: 0.5,
  groan: 3,
  settle: 4.5,
  skitter: 0.1,
  cricket: 0.1,
  owl: 7,
};

interface Source extends LoopSource {
  start(): Loop | null;
}

function sourcesFor(layout: FloorLayout | null): Source[] {
  const out: Source[] = [];
  if (layout) {
    layout.torches.forEach((p, i) => out.push({ key: `t${i}`, at: p, reach: 24, level: 1, start: () => startTorch(p) }));
    const exit: At = [layout.exit[0], layout.exit[1] + 1.4, layout.exit[2]];
    const leave: At = [layout.leave[0], layout.leave[1] + 1.4, layout.leave[2]];
    out.push({ key: "exit", at: exit, reach: 36, level: 1, start: () => startRiftHum(exit, 73.4) });
    out.push({ key: "leave", at: leave, reach: 36, level: 0.7, start: () => startRiftHum(leave, 98, 0.7) });
  } else {
    GATE_TORCHES.forEach(([x, , z], i) => {
      const at: At = [x, 1.9, z];
      out.push({ key: `g${i}`, at, reach: 20, level: 1, start: () => startTorch(at) });
    });
    LANTERNS.forEach(([x, , z], i) => {
      const at: At = [x, 2.2, z];
      out.push({ key: `l${i}`, at, reach: 12, level: 0.35, start: () => startTorch(at, 0.35) });
    });
    const gate: At = [0, 1.4, 0];
    out.push({ key: "gate", at: gate, reach: 36, level: 1, start: () => startRiftHum(gate, 73.4) });
  }
  return out;
}

/** Torches and rifts sounding at once, at most (the loudest win). */
const MAX_LOOPS = 5;
/** Seconds between re-tracing the loops as you move (they glide between). */
const LOOP_TICK = 0.2;
/** Metres a floor-mate walks between footfalls. */
const PEER_STRIDE = 1.7;

export function AudioWorld({ layout }: { layout: FloorLayout | null }) {
  const camera = useThree((s) => s.camera);
  const grid = useMemo<AcousticGrid>(() => (layout ? gridFromLayout(layout) : villageGrid()), [layout]);
  const sources = useMemo(() => sourcesFor(layout), [layout]);
  const loops = useRef(new Map<string, Loop>());
  const clock = useRef({ loops: 0, voice: 2 });
  const peers = useRef(new Map<string, { x: number; z: number; walked: number }>());

  useEffect(() => {
    setAcousticGrid(grid);
    setGround(layout ? () => GROUND[layout.biome] : villageGround);
    const live = loops.current;
    return () => {
      for (const l of live.values()) l.stop();
      live.clear();
      setAcousticGrid(null);
    };
  }, [grid, layout]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    updateListener(camera.position, camera.quaternion);
    const L = listenerAt();

    // Torches and rifts: keep the ones that reach you loudest sounding,
    // re-trace them as we move.
    clock.current.loops -= dt;
    if (clock.current.loops <= 0) {
      clock.current.loops = LOOP_TICK;
      const near = chooseLoops(sources, (key) => loops.current.has(key), MAX_LOOPS);
      const wanted = new Set(near.map((s) => s.key));
      for (const [key, loop] of loops.current) {
        if (wanted.has(key)) continue;
        loop.stop();
        loops.current.delete(key);
      }
      for (const s of near) {
        const loop = loops.current.get(s.key);
        if (loop) loop.emitter.place(s.at);
        else {
          const started = s.start();
          if (started) loops.current.set(s.key, started);
        }
      }
    }

    // Floor-mates' footsteps, from their poses.
    const seen = new Set<string>();
    for (const id of peerIds()) {
      const p = estimatePeer(id);
      if (!p) continue;
      seen.add(id);
      const [x, y, z] = p.p;
      const was = peers.current.get(id);
      if (!was) {
        peers.current.set(id, { x, z, walked: 0 });
        continue;
      }
      const d = Math.hypot(x - was.x, z - was.z);
      was.x = x;
      was.z = z;
      // Airborne or warped: no steps.
      if (Math.abs(p.v[1]) > 1.5 || d > 1) continue;
      was.walked += d;
      if (was.walked < PEER_STRIDE) continue;
      was.walked %= PEER_STRIDE;
      if (Math.hypot(x - L.x, z - L.z) < 26) playFootstep(groundAt(x, z), 0.85, [x, y - 0.85, z]);
    }
    for (const id of peers.current.keys()) if (!seen.has(id)) peers.current.delete(id);

    // The place itself: a sound somewhere around you, never right beside.
    clock.current.voice -= dt;
    if (clock.current.voice <= 0) {
      const table = ROOM_VOICES[layout ? layout.biome : "village"];
      clock.current.voice = layout ? 2.5 + Math.random() * 5 : 0.6 + Math.random() * 1.8;
      const v = pick(table);
      for (let tries = 0; tries < 6; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = 5 + Math.random() * 11;
        const x = L.x + Math.cos(a) * r;
        const z = L.z + Math.sin(a) * r;
        if (!openAt(grid, x, z)) continue;
        // Crickets sing in the grass, not on the cobbles.
        if (v === "cricket" && villageGround(x, z) !== "grass") continue;
        playRoomVoice(v, [x, VOICE_Y[v], z]);
        break;
      }
    }
  });

  return null;
}

function pick<T>(table: [T, number][]): T {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = Math.random() * total;
  for (const [v, w] of table) {
    r -= w;
    if (r <= 0) return v;
  }
  return table[0]![0];
}
