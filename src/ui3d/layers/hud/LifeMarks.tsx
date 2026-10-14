import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from "three";
import { gameEvents } from "../../../core/events";
import { forEachLife, getLife, type LifeEntry } from "../../../enemies/lifeBoard";
import { heartbeat } from "../../../game/heart";
import { crossedKnee, KNEE, shownFrac } from "../../../game/vitality";
import { castWorldRay } from "../../../game/worldRay";
import { worldPerScreenPixel } from "../../anchors";
import { emitUiSparks } from "../../UiSparks";
import { ink } from "../../theme";
import { useStepFade } from "./fade";
import { makeGauge, resetGauge, stepGauge, type Gauge } from "./gauge";
import { artPixel, MARK, markAlpha, markHold, markLife, Nearest, rattleBpm } from "./markRules";
import { forEachPeerMark, type PeerMark } from "../../../net/peerVitals";

/** Life marks: the small pixel bars that hang over creatures you've hurt
 * (markRules.ts has the rules) — and the pixel hearts over floor-mates in
 * their last stand (net/peerVitals), beating at their heart's rate.
 *
 * Drawn in the UI canvas so they stay crisp, as ONE instanced quad: every
 * mark is projected, snapped to whole screen pixels, and sized in whole
 * art pixels (artPixel), so it is the same hard-edged pixel bar at any
 * distance. The UI canvas has no depth of the world, so walls are found by
 * casting a ray to a couple of marks a frame (round-robin); a mark behind
 * stone steps out of sight.
 *
 * Every client reads the life the enemy shell publishes (enemies/lifeBoard:
 * the authority's own hp, or the replicated one); the shooter's own blow
 * shows at once (the `enemyHit` event) and the authority's word catches up.
 * The kill (`enemyKilled`, or a mark whose creature leaves the board dead)
 * shatters the bar into sparks. Nothing here allocates per frame. */

const CAP = MARK.enemies + 4;

interface Mark {
  id: string;
  entry: LifeEntry | null;
  gauge: Gauge;
  /** The top of the body (world). */
  x: number;
  y: number;
  z: number;
  /** The body's middle. A mark is in sight if its body or its spot is: a
   * lintel can hide the spot over a head in plain view, a pillar the body
   * under a head that shows. */
  cy: number;
  dist: number;
  /** The life it shows (real share), and hp as last read. */
  real: number;
  hp: number;
  /** The shooter's own prediction and when it was made (ms). */
  predicted: number;
  predictedAt: number;
  hitAt: number;
  crackAt: number;
  phase: number;
  alpha: number;
  seen: number;
  seenTarget: number;
  frame: number;
  visible: boolean;
}

const marks = new Map<string, Mark>();
const pool: Mark[] = [];
const nearest = new Nearest<Mark>(MARK.enemies);

function acquire(e: LifeEntry, before: number): Mark {
  const m =
    pool.pop() ??
    ({
      id: "",
      entry: null,
      gauge: makeGauge(1),
      x: 0,
      y: 0,
      z: 0,
      cy: 0,
      dist: 0,
      real: 1,
      hp: 0,
      predicted: 1,
      predictedAt: 0,
      hitAt: -1e9,
      crackAt: -1e9,
      phase: 0,
      alpha: 0,
      seen: 1,
      seenTarget: 1,
      frame: -1,
      visible: false,
    } satisfies Mark);
  m.id = e.id;
  m.entry = e;
  m.real = before;
  m.hp = e.hp;
  m.predicted = 1;
  m.predictedAt = 0;
  m.hitAt = -1e9;
  m.crackAt = -1e9;
  m.phase = 0;
  m.alpha = 0;
  m.seen = 1;
  m.seenTarget = 1;
  m.frame = frame;
  m.visible = false;
  resetGauge(m.gauge, shownFrac(before));
  marks.set(e.id, m);
  return m;
}

function release(m: Mark): void {
  marks.delete(m.id);
  m.entry = null;
  pool.push(m);
}

// ── Per-frame scratch (module-level: the board's visitor can't take args) ──

let frame = 0;
let now = 0;
const eye = new Vector3();
const fwd = new Vector3();
const right = new Vector3();
const up = new Vector3();
/** The view as last drawn: what a shatter between frames needs. */
const view = { fov: 78, cssH: 600, dpr: 1, art: 2 };

function visit(e: LifeEntry): void {
  // The Warden has its own bar across the top of your sight.
  if (e.kind === "boss") return;
  let m = marks.get(e.id);
  if (!m) {
    if (e.hurtAt <= 0) return;
    m = acquire(e, 1);
  }
  m.frame = frame;
  m.entry = e;
  m.hp = e.hp;
  const real = markLife(e.maxHp > 0 ? e.hp / e.maxHp : 0, m.predicted, m.predictedAt > 0 ? now - m.predictedAt : -1);
  if (real < m.real - 1e-4) {
    m.hitAt = now;
    if (crossedKnee(m.real, real)) m.crackAt = now;
  }
  m.real = real;
  const lastHurt = Math.max(e.hurtAt, m.predictedAt);
  m.alpha = markAlpha((now - lastHurt) / 1000, markHold(real));
  m.visible = false;
  if (m.alpha <= 0 || real <= 0) return;
  const p = e.pos();
  if (!p) return;
  m.x = p.x;
  m.y = p.y + e.top;
  m.cy = p.y;
  m.z = p.z;
  const dx = m.x - eye.x;
  const dy = m.y - eye.y;
  const dz = m.z - eye.z;
  m.dist = Math.hypot(dx, dy, dz);
  if (m.dist > MARK.range || dx * fwd.x + dy * fwd.y + dz * fwd.z < 0.2) return;
  if (m.dist > MARK.dimFrom) m.alpha *= 2 / 3;
  m.visible = true;
  nearest.offer(m, m.dist);
}

/** World size of one art pixel at `dist` from the eye. */
function artWorld(dist: number): number {
  return (view.art / view.dpr) * worldPerScreenPixel(view.fov, view.cssH, dist);
}

const at = new Vector3();
const spark: [number, number, number] = [0, 0, 0];

/** A bar burst into sparks along its length (the kill), or just at its
 * notch (`notch`: the break as it crosses the knee). */
function burst(m: Mark, notch: boolean): void {
  const a = artWorld(m.dist);
  const past = m.real <= KNEE.real;
  const n = notch ? 1 : 10;
  for (let i = 0; i < n; i++) {
    const along = notch ? -0.5 + (1 + KNEE.shown * (MARK.w - 2)) / MARK.w : (i + 0.5) / n - 0.5;
    at.set(m.x, m.y, m.z)
      .addScaledVector(up, (MARK.lift + MARK.h / 2) * a)
      .addScaledVector(right, along * MARK.w * a);
    spark[0] = at.x;
    spark[1] = at.y;
    spark[2] = at.z;
    emitUiSparks({
      position: spark,
      color: notch ? "#ffd27a" : past ? "#ff5136" : "#efe3c8",
      count: notch ? 6 : 4,
      speed: 12 * a,
      up: 6 * a,
      size: 3.6 * a,
      spread: 2 * a,
      ttl: notch ? 0.5 : 0.7,
    });
  }
}

function shatter(id: string): void {
  const m = marks.get(id);
  if (!m) return;
  if (m.visible && m.alpha > 0) burst(m, false);
  release(m);
}

// ── The draw ─────────────────────────────────────────────────────────────────

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aBar;
attribute vec4 aMore;
attribute vec3 aTint;
uniform vec2 uRes;
uniform float uArt;
uniform float uLift;
varying vec2 vUv;
varying vec4 vBar;
varying vec4 vMore;
varying vec3 vTint;
varying vec2 vSize;
void main() {
  bool heart = aMore.z > 0.5;
  vec2 size = heart ? vec2(${MARK.heartW.toFixed(1)}, ${MARK.heartH.toFixed(1)}) : vec2(${MARK.w.toFixed(1)}, ${MARK.h.toFixed(1)});
  vec4 c = projectionMatrix * viewMatrix * vec4(aPos, 1.0);
  if (c.w <= 0.0 || aBar.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // Snapped to whole screen pixels, sized in whole art pixels: a hard-edged
  // pixel bar at any distance.
  vec2 px = floor((c.xy / c.w * 0.5 + 0.5) * uRes + 0.5);
  vec2 corner = px + vec2(-floor(size.x * 0.5) * uArt, uLift * uArt) + (position.xy + 0.5) * size * uArt;
  gl_Position = vec4((corner / uRes * 2.0 - 1.0) * c.w, c.z, c.w);
  vUv = uv;
  vBar = aBar;
  vMore = aMore;
  vTint = aTint;
  vSize = size;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uTrack;
uniform vec3 uBone;
uniform vec3 uEmber;
uniform vec3 uBrass;
uniform vec3 uGhost;
uniform vec3 uHot;
varying vec2 vUv;
varying vec4 vBar;
varying vec4 vMore;
varying vec3 vTint;
varying vec2 vSize;

// The heart sprite, a row of bits each (top row first).
int heartRow(int y) {
  if (y == 0) return 198;
  if (y == 1) return 495;
  if (y <= 3) return 511;
  if (y == 4) return 254;
  if (y == 5) return 124;
  if (y == 6) return 56;
  return 16;
}
bool heartOn(int x, int y) {
  if (x < 0 || x > 8 || y < 0 || y > 7) return false;
  return ((heartRow(y) >> x) & 1) == 1;
}

void main() {
  vec2 p = floor(vUv * vSize);
  float W = vSize.x;
  float H = vSize.y;
  float alpha = vBar.w;
  vec3 col;
  if (vMore.z > 0.5) {
    // A floor-mate's heart: their colour, beating at their rate.
    int x = int(p.x);
    int y = int(H - 1.0 - p.y);
    if (!heartOn(x, y)) discard;
    bool rim = !heartOn(x - 1, y) || !heartOn(x + 1, y) || !heartOn(x, y - 1) || !heartOn(x, y + 1);
    float beat = vMore.y;
    col = vTint * (rim ? 0.45 : 0.85 + beat * 0.7);
    if (x == 2 && y == 1) col = mix(col, vec3(1.0), 0.6);
    // At their Brink it flashes white-hot.
    col = mix(col, uHot, vMore.w);
  } else {
    float level = vBar.x;
    float ghost = vBar.y;
    float flash = vBar.z;
    float low = vMore.x;
    float throb = vMore.y;
    float iw = W - 2.0;
    float kx = floor(${KNEE.shown.toFixed(6)} * iw + 0.5);
    bool notch = abs(p.x - 1.0 - kx) < 0.5;
    if (p.x < 1.0 || p.y < 1.0 || p.x > W - 2.0 || p.y > H - 2.0) {
      col = notch ? uBrass * 0.8 : uInk;
    } else {
      vec2 q = p - 1.0;
      float row = H - 3.0 - q.y; // 0 = top row of the track
      // A creature still alive is never an empty bar: a sliver at least.
      float edge = level <= 0.0005 ? 0.0 : max(1.0, floor(level * iw + 0.5));
      float gEdge = floor(ghost * iw + 0.5);
      col = uTrack * (row < 1.0 ? 0.6 : 1.0);
      if (q.x < edge) {
        // Bone-white while whole; past the knee an ember sliver, throbbing.
        vec3 f = low > 0.5 ? uEmber * (1.0 + throb * 0.75) : uBone;
        if (row < 1.0) f = mix(f, vec3(1.0), 0.3);
        else if (row >= H - 3.0) f *= 0.7;
        col = mix(f, uHot, flash);
      } else if (q.x < gEdge) {
        col = uGhost;
      }
      if (notch) col = mix(col, uBrass, q.x < edge ? 0.5 : 0.85);
    }
  }
  gl_FragColor = vec4(col * alpha, alpha);
  #include <colorspace_fragment>
}
`;

function makeMarkMesh() {
  const base = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", base.getAttribute("position"));
  geometry.setAttribute("uv", base.getAttribute("uv"));
  const attr = (n: number) => {
    const a = new InstancedBufferAttribute(new Float32Array(CAP * n), n);
    a.setUsage(DynamicDrawUsage);
    return a;
  };
  const aPos = attr(3);
  const aBar = attr(4);
  const aMore = attr(4);
  const aTint = attr(3);
  geometry.setAttribute("aPos", aPos);
  geometry.setAttribute("aBar", aBar);
  geometry.setAttribute("aMore", aMore);
  geometry.setAttribute("aTint", aTint);
  geometry.instanceCount = 0;
  const c = (hex: string) => ({ value: new Color(hex) });
  const material = new ShaderMaterial({
    uniforms: {
      uRes: { value: new Vector2(1, 1) },
      uArt: { value: 2 },
      uLift: { value: MARK.lift },
      uInk: c("#0b0810"),
      uTrack: c("#1c1218"),
      uBone: c("#efe3c8"),
      uEmber: c("#ff5136"),
      uBrass: c(ink.brass),
      uGhost: c("#8a3d33"),
      uHot: c("#fff6d8"),
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Under the HUD (which hangs nearer anyway), over nothing else.
  mesh.renderOrder = -5;
  return { mesh, geometry, material, base, aPos, aBar, aMore, aTint };
}

/** Rays a frame spent on finding marks behind stone. */
const RAYS_PER_FRAME = 2;
const rayFrom = { x: 0, y: 0, z: 0 };
const rayDir = { x: 0, y: 0, z: 0 };
let rayCursor = 0;

/** Is the mark's spot in plain sight of the eye? */
function inSight(x: number, y: number, z: number): boolean {
  const dist = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
  if (dist < 1e-3) return true;
  rayFrom.x = eye.x;
  rayFrom.y = eye.y;
  rayFrom.z = eye.z;
  rayDir.x = (x - eye.x) / dist;
  rayDir.y = (y - eye.y) / dist;
  rayDir.z = (z - eye.z) / dist;
  return castWorldRay(rayFrom, rayDir, dist) >= dist - 0.45;
}

const buffer = new Vector2();

/** Where the floor-mates' hearts are written this frame (visitPeer). */
const hearts: { pos: Float32Array; bar: Float32Array; more: Float32Array; tint: Float32Array; n: number; show: number } = {
  pos: new Float32Array(0),
  bar: new Float32Array(0),
  more: new Float32Array(0),
  tint: new Float32Array(0),
  n: 0,
  show: 1,
};

function visitPeer(p: PeerMark): void {
  const n = hearts.n;
  if (n >= CAP || !p.shown || p.alpha <= 0) return;
  const dx = p.x - eye.x;
  const dy = p.y - eye.y;
  const dz = p.z - eye.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > MARK.range * 1.5 || dx * fwd.x + dy * fwd.y + dz * fwd.z < 0.2) return;
  hearts.pos[n * 3] = p.x;
  hearts.pos[n * 3 + 1] = p.y;
  hearts.pos[n * 3 + 2] = p.z;
  hearts.bar[n * 4 + 3] = p.alpha * hearts.show;
  hearts.more[n * 4] = 0;
  hearts.more[n * 4 + 1] = Math.round(p.beat * 3) / 3;
  hearts.more[n * 4 + 2] = 1;
  hearts.more[n * 4 + 3] = p.brink > 0.5 ? 1 : 0;
  hearts.tint[n * 3] = p.tint.r;
  hearts.tint[n * 3 + 1] = p.tint.g;
  hearts.tint[n * 3 + 2] = p.tint.b;
  hearts.n = n + 1;
}

export function LifeMarks() {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const fade = useStepFade({ inTime: 0.2, outTime: 0.2, steps: 3 });
  const draw = useMemo(makeMarkMesh, []);
  useEffect(
    () => () => {
      draw.geometry.dispose();
      draw.base.dispose();
      draw.material.dispose();
      for (const m of [...marks.values()]) release(m);
    },
    [draw],
  );

  useEffect(() => {
    const offs = [
      // Your own blow shows at once; the authority's word catches up.
      gameEvents.on("enemyHit", ({ id, frac, mine }) => {
        if (!mine) return;
        const e = getLife(id);
        if (!e || e.kind === "boss") return;
        const t = performance.now();
        const firstBlow = e.hurtAt <= 0 || t - e.hurtAt < 50;
        const m = marks.get(id) ?? acquire(e, firstBlow ? 1 : e.maxHp > 0 ? e.hp / e.maxHp : 1);
        m.predicted = Math.max(0, frac);
        m.predictedAt = t;
      }),
      gameEvents.on("enemyKilled", ({ id }) => shatter(id)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const cam = camera as PerspectiveCamera;
    frame++;
    now = performance.now();
    eye.copy(cam.position);
    cam.getWorldDirection(fwd);
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    gl.getDrawingBufferSize(buffer);
    view.fov = cam.fov;
    view.cssH = size.height;
    view.dpr = buffer.y / Math.max(1, size.height);
    view.art = artPixel(buffer.y);

    nearest.reset();
    forEachLife(visit);
    // Whatever wasn't on the board this frame has left it: killed (its last
    // hp says so: shatter, if it was showing) or its floor unloaded.
    for (const m of marks.values()) {
      if (m.frame === frame) continue;
      if (m.hp <= 0) shatter(m.id);
      else release(m);
    }

    const u = draw.material.uniforms;
    (u.uRes!.value as Vector2).copy(buffer);
    u.uArt!.value = view.art;
    const show = fade.current;
    const pos = draw.aPos.array as Float32Array;
    const bar = draw.aBar.array as Float32Array;
    const more = draw.aMore.array as Float32Array;
    const tint = draw.aTint.array as Float32Array;
    let n = 0;

    // Round-robin: a couple of marks a frame learn whether stone hides them.
    for (let k = 0; k < Math.min(RAYS_PER_FRAME, nearest.n); k++) {
      const m = nearest.items[(rayCursor + k) % nearest.n]!;
      m.seenTarget = inSight(m.x, m.cy, m.z) || inSight(m.x, m.y, m.z) ? 1 : 0;
    }
    rayCursor = nearest.n > 0 ? (rayCursor + RAYS_PER_FRAME) % nearest.n : 0;

    for (let i = 0; i < nearest.n; i++) {
      const m = nearest.items[i]!;
      stepGauge(m.gauge, shownFrac(m.real), dt);
      m.seen += Math.max(-dt / 0.25, Math.min(dt / 0.25, m.seenTarget - m.seen));
      const seen = Math.ceil(m.seen * 3) / 3;
      const sinceHit = (now - m.hitAt) / 1000;
      const flash = sinceHit < 0.2 ? Math.ceil((1 - sinceHit / 0.2) * 3) / 3 : 0;
      const past = m.real <= KNEE.real;
      m.phase = (m.phase + (dt * rattleBpm(m.real)) / 60) % 1;
      const throb = past ? Math.round(heartbeat(m.phase) * 3) / 3 : 0;
      if (now - m.crackAt < 1 && m.crackAt > 0) {
        // The break: the bar crosses its notch with a spit of sparks.
        m.crackAt = 0;
        burst(m, true);
      }
      pos[n * 3] = m.x;
      pos[n * 3 + 1] = m.y;
      pos[n * 3 + 2] = m.z;
      bar[n * 4] = m.gauge.level;
      bar[n * 4 + 1] = m.gauge.ghost;
      bar[n * 4 + 2] = flash;
      bar[n * 4 + 3] = m.alpha * seen * show;
      more[n * 4] = past ? 1 : 0;
      more[n * 4 + 1] = throb;
      more[n * 4 + 2] = 0;
      more[n * 4 + 3] = 0;
      n++;
    }

    // Floor-mates in their last stand: a heart over each, beating with theirs.
    hearts.pos = pos;
    hearts.bar = bar;
    hearts.more = more;
    hearts.tint = tint;
    hearts.n = n;
    hearts.show = show;
    forEachPeerMark(visitPeer);
    n = hearts.n;

    draw.geometry.instanceCount = n;
    if (n > 0) {
      draw.aPos.needsUpdate = true;
      draw.aBar.needsUpdate = true;
      draw.aMore.needsUpdate = true;
      draw.aTint.needsUpdate = true;
    }
    draw.mesh.visible = n > 0;
  });

  return <primitive object={draw.mesh} />;
}
