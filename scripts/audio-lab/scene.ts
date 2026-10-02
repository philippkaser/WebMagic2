// The audio lab's scenes: a listener's path and what it hears, on a real
// generated floor — a torch-lit hall, the walk out of it down a corridor.
import { TILE } from "../../src/core/config";
import type { FloorLayout } from "../../src/world/types";

export type P3 = [number, number, number];
export interface Ev {
  t: number;
  kind: string;
  at?: P3;
  loud?: number;
}
export interface Scene {
  duration: number;
  /** Log what the ears hear every quarter second. */
  log?: boolean;
  /** A steady noise source to follow (x, y, z). */
  steady?: P3;
  pose(t: number): { x: number; z: number; yaw: number };
  events: Ev[];
  torches: boolean;
  ambient: boolean;
}

export function buildScene(layout: FloorLayout, name: string): Scene {
  const n = layout.size;
  const toW = (tx: number, ty: number): [number, number] => [(tx - n / 2) * TILE + TILE / 2, (ty - n / 2) * TILE + TILE / 2];
  const toT = (x: number, z: number): [number, number] => [Math.floor(x / TILE + n / 2), Math.floor(z / TILE + n / 2)];
  const inRoom = (r: { x: number; y: number; w: number; h: number }, tx: number, ty: number) => tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
  let room = layout.rooms[0]!;
  let torch = layout.torches[0]!;
  for (const t of layout.torches) {
    const [tx, ty] = toT(t[0], t[2]);
    const r = layout.rooms.find((r) => inRoom(r, tx, ty) && r.w >= 6 && r.h >= 6);
    if (r) {
      room = r;
      torch = t;
      break;
    }
  }
  const c: [number, number] = [room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2)];
  // BFS to a corridor tile ~14 steps away.
  const prev = new Int32Array(n * n).fill(-2);
  const dist = new Int32Array(n * n).fill(-1);
  const q = [c[1] * n + c[0]];
  prev[q[0]!] = -1;
  dist[q[0]!] = 0;
  let goal = -1;
  for (let h = 0; h < q.length; h++) {
    const k = q[h]!;
    const x = k % n, y = (k - x) / n;
    if (dist[k]! >= 14 && !layout.rooms.some((r) => inRoom(r, x, y))) {
      goal = k;
      break;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx!, ny = y + dy!;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const nk = ny * n + nx;
      if (!layout.tiles[nk] || prev[nk] !== -2) continue;
      prev[nk] = k;
      dist[nk] = dist[k]! + 1;
      q.push(nk);
    }
  }
  const path: [number, number][] = [];
  for (let k = goal; k !== -1; k = prev[k]!) path.push(toW(k % n, Math.floor(k / n)));
  path.reverse();
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]));
  const total = cum[cum.length - 1]!;
  const center = path[0]!;
  const facingTorch = Math.atan2(-(torch[0] - center[0]), -(torch[2] - center[1]));
  const SPEED = 5;
  const walkFrom = name === "torch-walk" ? 1 : name.startsWith("leave") ? 2 : 2.5;
  const at = (s: number) => {
    s = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < s) i++;
    const a = path[i - 1]!, b = path[i]!;
    const f = (s - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!);
    return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, dx: b[0] - a[0], dz: b[1] - a[1] };
  };
  const walkPose = (t: number) => {
    if (t < walkFrom) return { x: center[0], z: center[1], yaw: facingTorch };
    const s = (t - walkFrom) * SPEED;
    const p = at(s);
    // Look ahead a little for a smooth heading.
    const ahead = at(s + 2.5);
    const yaw = Math.atan2(-(ahead.x - p.x), -(ahead.z - p.z)) || facingTorch;
    return { x: p.x, z: p.z, yaw };
  };
  const walkEnd = walkFrom + total / SPEED;
  const roomAt = (dx: number, dz: number, y = 0.5): P3 => [center[0] + dx, y, center[1] + dz];
  const events: Ev[] = [];
  const steps = (from: number, to: number) => {
    for (let t = from; t < to; t += 0.3) events.push({ t, kind: "step", loud: 0.9 });
  };
  const end = path[path.length - 1]!;
  switch (name) {
    case "walk":
      steps(walkFrom + 0.1, walkEnd);
      events.push({ t: 1.0, kind: "cast" });
      events.push({ t: 1.6, kind: "drip", at: roomAt(4, -3, 0.2) });
      events.push({ t: 4.5, kind: "explosion", at: roomAt(0, 0, 1) });
      for (let i = 0; i < 5; i++) events.push({ t: 6.5 + i * 0.35, kind: "slime", at: roomAt(1, 1, 0.4) });
      events.push({ t: 10, kind: "cast" });
      events.push({ t: 11, kind: "explosion", at: roomAt(0, 0, 1) });
      return { duration: 14, pose: walkPose, events, torches: true, ambient: true };
    case "leave-torches":
      return { duration: walkEnd + 2, pose: walkPose, events, torches: true, ambient: false, log: true };
    case "leave-steady":
      return { duration: walkEnd + 2, pose: walkPose, events, torches: false, ambient: false, log: true, steady: roomAt(2, 3, 1.2) };
    case "torch-walk":
      return { duration: walkEnd + 1, pose: walkPose, events, torches: true, ambient: false };
    case "steps-room":
      steps(0.3, 4);
      return { duration: 7, pose: () => ({ x: center[0], z: center[1], yaw: facingTorch }), events, torches: false, ambient: false };
    case "imp-room":
      events.push({ t: 1, kind: "impulse-self" });
      events.push({ t: 3.5, kind: "impulse-at", at: [torch[0], 1.2, torch[2]] });
      events.push({ t: 6, kind: "impulse-at", at: roomAt(3, 4, 1.2) });
      return { duration: 9, pose: () => ({ x: center[0], z: center[1], yaw: facingTorch }), events, torches: false, ambient: false };
    case "imp-corridor":
      events.push({ t: 1, kind: "impulse-self" });
      events.push({ t: 3.5, kind: "impulse-at", at: roomAt(0, 0, 1.2) });
      return { duration: 7, pose: () => ({ x: end[0], z: end[1], yaw: 0 }), events, torches: false, ambient: false };
    case "imp-dry":
      events.push({ t: 0.3, kind: "impulse-dry" });
      return { duration: 1, pose: () => ({ x: center[0], z: center[1], yaw: 0 }), events, torches: false, ambient: false };
  }
  throw new Error("unknown scene " + name);
}

/** 32-bit float stereo WAV, base64. */
export function wav(buf: AudioBuffer): string {
  const n = buf.length;
  const sr = buf.sampleRate;
  const f = new DataView(new ArrayBuffer(44 + n * 8));
  const w = (o: number, s: string) => [...s].forEach((c, i) => f.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  f.setUint32(4, 36 + n * 8, true);
  w(8, "WAVE");
  w(12, "fmt ");
  f.setUint32(16, 16, true);
  f.setUint16(20, 3, true);
  f.setUint16(22, 2, true);
  f.setUint32(24, sr, true);
  f.setUint32(28, sr * 8, true);
  f.setUint16(32, 8, true);
  f.setUint16(34, 32, true);
  w(36, "data");
  f.setUint32(40, n * 8, true);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  for (let i = 0; i < n; i++) {
    f.setFloat32(44 + i * 8, L[i]!, true);
    f.setFloat32(48 + i * 8, R[i]!, true);
  }
  const bytes = new Uint8Array(f.buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
