import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, type Group, type Mesh, type MeshStandardMaterial } from "three";
import { playExplosion } from "../../audio/sound";
import { isEnemyVoice, playCorpseBeat } from "../../audio/voices";
import { gameEvents } from "../../core/events";
import { presentScale } from "../../core/presentTime";
import { addLightSource, flashLight, removeLightSource, type DynamicLightSource } from "../../fx/DynamicLights";
import { explosionFx, hitSparksFx, killPopFx, leakFx, soulDissolveFx } from "../../fx/effects";
import { spawnBurst } from "../../fx/Particles";
import {
  ENEMY_GEOMETRY as G,
  ENEMY_HUE,
  makeEnemyMaterial,
  SHADOW_EYE_X,
  SLIME_EYE_X,
  WARDEN_COLOR,
  WARDEN_SHARDS,
  type EnemyPart,
} from "../../render/models/enemies";
import type { Vec3 } from "../../world/types";
import type { EnemyId } from "../roster";
import type { EnemyDeathFx } from "../useEnemy";
import { claimCorpse, clearCorpses, createCorpsePool, SLOTS, stepCorpses } from "./corpsePool";
import { CUE, type CorpseInit, type CorpseState } from "./corpseScripts";
import { withDitherFade } from "./ditherFade";

/** The corpse layer: the dead linger here a moment after their bodies are
 * gone (corpseScripts.ts has the choreography). Every slot is mounted once,
 * hidden; a death shows one, poses it each frame on the presentation clock,
 * and lights its beats — the burst, the soul rising, the kill light (a white
 * pop that gives way to soul-coloured light rising with the soul), and the
 * floor's splat (enemyDied) when the body actually lands. No React work per
 * death; idle slots draw nothing. Mounted by <SpawnedEnemies>, so it's
 * wherever enemies are. */

/** What the shell knows of a death beyond its pose (fixed per enemy). */
export interface DeathTag {
  fx: EnemyDeathFx | null;
  soul: string;
  /** Size of the soul's dissolve (1 = a wisp). */
  scale: number;
  /** Peak of the kill light. */
  light: number;
}

const pool = createCorpsePool();
let mounted = false;

/** Is the corpse layer up? (If not, deaths fall back to an instant burst.) */
export function corpsesMounted(): boolean {
  return mounted;
}

/** Hand a dying body to the corpse layer. False if it isn't mounted. */
export function playCorpse(init: CorpseInit, tag: DeathTag): boolean {
  if (!mounted) return false;
  const slot = claimCorpse(pool, init, onCue);
  pool[init.kind][slot].tag = tag;
  // The instant it dies: a white pop where it was struck down.
  killPopFx([init.x, init.y + (init.kind === "sentry" ? 1.05 : 0), init.z], tag.soul, Math.min(tag.scale, 2));
  return true;
}

// ── Kill lights ─────────────────────────────────────────────────────────────

const KILL_LIGHTS = 3;
/** Seconds of the white pop, then the soul light's rise speed and fade. */
const POP_S = 0.045;
const RISE = 1.2;
const FADE_S = 0.9;

interface KillLight {
  src: DynamicLightSource | null;
  t: number;
  peak: number;
  soul: string;
}

const lights: KillLight[] = Array.from({ length: KILL_LIGHTS }, () => ({ src: null, t: Infinity, peak: 0, soul: "#ffffff" }));

function startKillLight(x: number, y: number, z: number, soul: string, peak: number): void {
  let pick = lights[0];
  for (const l of lights) if (l.t > pick.t) pick = l; // the oldest (idle ones are ∞)
  const src = pick.src;
  if (!src) return;
  src.position.set(x, y, z);
  src.color = "#ffffff";
  src.intensity = peak * 1.6;
  src.maxDistance = 6;
  pick.t = 0;
  pick.peak = peak;
  pick.soul = soul;
}

function stepKillLights(dt: number): void {
  for (const l of lights) {
    const src = l.src;
    if (!src || l.t === Infinity) continue;
    l.t += dt;
    if (l.t < POP_S) continue;
    const k = (l.t - POP_S) / FADE_S;
    if (k >= 1) {
      src.intensity = 0;
      l.t = Infinity;
      continue;
    }
    src.color = l.soul;
    src.maxDistance = 12;
    src.position.y += RISE * dt;
    src.intensity = l.peak * (1 - k) * (1 - k);
  }
}

// ── Beats ───────────────────────────────────────────────────────────────────

const UP: Vec3 = [0, 1, 0];

function onCue(c: CorpseState, cue: number, x: number, y: number, z: number, arg: number): void {
  const tag = c.tag as DeathTag | null;
  const at: Vec3 = [x, y, z];
  switch (cue) {
    case CUE.main:
      mainBeat(c, tag, at);
      break;
    case CUE.crack:
      // The head blown off: a spray of hot crystal and a flash.
      hitSparksFx(at, "#ffd9a8", 1.8, UP);
      flashLight(at, "#ff9a5a", 14, 6);
      break;
    case CUE.bounce:
      hitSparksFx(at, "#ff9a5a", 0.7, UP);
      playCorpseBeat("sentry", "bounce", at);
      break;
    case CUE.shard:
      // One of the Warden's shards torn loose, bursting as it goes.
      explosionFx(at, 2.4, arg === 1 ? "#ffd9a8" : WARDEN_COLOR, 1.2);
      flashLight(at, WARDEN_COLOR, 30);
      playExplosion(2.4, at);
      gameEvents.emit("shake", 0.25);
      break;
  }
}

/** THE beat: the body's burst, its soul rising, the kill light, the splat. */
function mainBeat(c: CorpseState, tag: DeathTag | null, at: Vec3): void {
  const soul = tag?.soul ?? "#c89cff";
  const scale = tag?.scale ?? 1;
  const fx = tag?.fx ?? null;
  if (fx) {
    const n = fx.burst.count ?? 16;
    spawnBurst({ ...fx.burst, count: Math.round(c.gib ? n * 1.5 : n), position: at });
  }
  if (c.kind === "boss") {
    // Critical: the core lets go.
    explosionFx(at, 4.2, WARDEN_COLOR, 2.4);
    flashLight(at, "#ffd9a8", 60);
    playExplosion(5, at);
    gameEvents.emit("shake", 0.8);
  }
  soulDissolveFx(at, soul, scale);
  startKillLight(at[0], at[1], at[2], soul, tag?.light ?? 20);
  if (isEnemyVoice(c.kind)) playCorpseBeat(c.kind, "main", at);
  // The mark it leaves on the floor, where it actually came down (fx/decals).
  const color = fx?.burst.color;
  gameEvents.emit("enemyDied", {
    x: at[0],
    y: at[1],
    z: at[2],
    body: Array.isArray(color) ? color[0] : (color ?? (c.kind === "boss" ? "#3a1410" : undefined)),
    soul,
    style: fx?.burst.style ?? (c.kind === "boss" ? "shard" : undefined),
    scale,
  });
}

// ── Views ───────────────────────────────────────────────────────────────────

interface View {
  root: Group | null;
  body: Group | null;
  part: Group | null;
  eyes: (Mesh | null)[];
  shards: (Mesh | null)[];
  /** The flash material (body; the sentry's crystal) and the rest. */
  flash: MeshStandardMaterial;
  accent: MeshStandardMaterial | null;
  plinth: MeshStandardMaterial | null;
  fades: { value: number }[];
  smokeAcc: number;
}

const views: Record<EnemyId, (View | null)[]> = {
  wisp: [],
  shadow: [],
  slime: [],
  sentry: [],
  boss: [],
};

const FLASH_PART: Record<EnemyId, EnemyPart> = {
  wisp: "wispBody",
  shadow: "shadowBody",
  slime: "slimeBody",
  sentry: "sentryCrystal",
  boss: "wardenBody",
};
const ACCENT_PART: Record<EnemyId, EnemyPart | null> = {
  wisp: "wispCore",
  shadow: "shadowEye",
  slime: "slimeEye",
  sentry: null,
  boss: "wardenCore",
};
const HUE: Record<EnemyId, Color> = {
  wisp: new Color(ENEMY_HUE.wisp),
  shadow: new Color(ENEMY_HUE.shadow),
  slime: new Color(ENEMY_HUE.slime),
  sentry: new Color(ENEMY_HUE.sentry),
  boss: new Color(ENEMY_HUE.warden),
};
const WHITE = new Color(1, 1, 1);
const PLINTH = new Color("#3a3442");

/** One pre-mounted slot: its own materials (so one death's glow and fade
 * are its own), registered for the frame loop. */
function useSlot(kind: EnemyId, i: number): View {
  const view = useMemo<View>(() => {
    const flash = makeEnemyMaterial(FLASH_PART[kind]);
    const accentPart = ACCENT_PART[kind];
    const accent = accentPart ? makeEnemyMaterial(accentPart) : null;
    const plinth = kind === "sentry" ? makeEnemyMaterial("sentryPlinth") : null;
    const fades = [withDitherFade(flash)];
    // The eyes blink out rather than dissolve; cores and plinths dissolve.
    if (accent && kind !== "shadow") fades.push(withDitherFade(accent));
    if (plinth) fades.push(withDitherFade(plinth));
    return { root: null, body: null, part: null, eyes: [], shards: [], flash, accent, plinth, fades, smokeAcc: 0 };
  }, [kind]);
  useEffect(() => {
    views[kind][i] = view;
    return () => {
      if (views[kind][i] === view) views[kind][i] = null;
      view.flash.dispose();
      view.accent?.dispose();
      view.plinth?.dispose();
    };
  }, [kind, i, view]);
  return view;
}

function WispSlot({ i }: { i: number }) {
  const v = useSlot("wisp", i);
  return (
    <group ref={(g) => void (v.root = g)} visible={false}>
      <group ref={(g) => void (v.body = g)}>
        <mesh geometry={G.wispBody} material={v.flash} />
        <mesh geometry={G.wispCore} material={v.accent!} />
      </group>
    </group>
  );
}

function ShadowSlot({ i }: { i: number }) {
  const v = useSlot("shadow", i);
  return (
    <group ref={(g) => void (v.root = g)} visible={false}>
      <group ref={(g) => void (v.body = g)}>
        <mesh geometry={G.shadowBody} material={v.flash} />
      </group>
      <group ref={(g) => void (v.part = g)}>
        {SHADOW_EYE_X.map((x, k) => (
          <mesh
            key={x}
            ref={(m) => void (v.eyes[k] = m)}
            geometry={G.shadowEye}
            material={v.accent!}
            position={[x, 0, 0]}
          />
        ))}
      </group>
    </group>
  );
}

function SlimeSlot({ i }: { i: number }) {
  const v = useSlot("slime", i);
  return (
    <group ref={(g) => void (v.root = g)} visible={false}>
      <group ref={(g) => void (v.body = g)}>
        <mesh geometry={G.slimeBody} material={v.flash} />
        {SLIME_EYE_X.map((x) => (
          <mesh key={x} geometry={G.slimeEye} material={v.accent!} position={[x, 0.1, 0.34]} />
        ))}
      </group>
    </group>
  );
}

function SentrySlot({ i }: { i: number }) {
  const v = useSlot("sentry", i);
  return (
    <group ref={(g) => void (v.root = g)} visible={false}>
      <group ref={(g) => void (v.body = g)}>
        <mesh geometry={G.sentryPlinth} material={v.plinth!} position={[0, 0.45, 0]} />
      </group>
      <group ref={(g) => void (v.part = g)}>
        <mesh geometry={G.sentryHead} material={v.flash} />
      </group>
    </group>
  );
}

function WardenSlot({ i }: { i: number }) {
  const v = useSlot("boss", i);
  const shard = useMemo(() => makeEnemyMaterial("wardenShard"), []);
  useEffect(() => () => shard.dispose(), [shard]);
  return (
    <group ref={(g) => void (v.root = g)} visible={false}>
      <group ref={(g) => void (v.body = g)}>
        <mesh geometry={G.wardenBody} material={v.flash} />
        <mesh geometry={G.wardenCore} material={v.accent!} />
      </group>
      {WARDEN_SHARDS.map((_, k) => (
        <mesh key={k} ref={(m) => void (v.shards[k] = m)} geometry={G.wardenShard} material={shard} />
      ))}
    </group>
  );
}

const SLOT_OF: Record<EnemyId, (p: { i: number }) => React.JSX.Element> = {
  wisp: WispSlot,
  shadow: ShadowSlot,
  slime: SlimeSlot,
  sentry: SentrySlot,
  boss: WardenSlot,
};

/** Pose one live corpse's view from its state. */
function apply(c: CorpseState, v: View, dt: number): void {
  const b = v.body;
  if (!b) return;
  const j = c.shiver;
  b.position.set(c.x + (j > 0 ? (Math.random() - 0.5) * j : 0), c.y, c.z + (j > 0 ? (Math.random() - 0.5) * j : 0));
  b.rotation.set(c.rx, c.yaw, c.rz);
  b.scale.set(c.sx * c.size, c.sy * c.size, c.sz * c.size);
  for (const f of v.fades) f.value = c.fade;
  const hue = HUE[c.kind];
  if (c.kind === "sentry") {
    // The plinth darkens; the flying head is the part.
    v.plinth?.color.copy(PLINTH).multiplyScalar(1 - 0.65 * c.dark);
    v.flash.emissive.copy(hue).lerp(WHITE, c.pglow > 6 ? 0.8 : 0);
    v.flash.emissiveIntensity = c.pglow;
    const p = v.part;
    if (p) {
      p.visible = c.pfade > 0;
      p.position.set(c.px, c.py, c.pz);
      p.rotation.set(c.prx, c.pry, c.prz);
    }
    return;
  }
  v.flash.emissive.copy(hue).lerp(WHITE, c.white);
  v.flash.emissiveIntensity = c.glow;
  if (c.kind === "shadow") {
    const p = v.part;
    if (p) {
      p.visible = c.pfade > 0;
      p.position.set(c.px, c.py, c.pz);
      p.rotation.set(0, c.pry, 0);
    }
    if (v.eyes[0]) v.eyes[0].visible = c.eye0 > 0;
    if (v.eyes[1]) v.eyes[1].visible = c.eye1 > 0;
    if (v.accent) v.accent.emissiveIntensity = c.pglow;
    // Smoke peels off it as it unravels.
    v.smokeAcc += c.smoke * dt;
    if (v.smokeAcc >= 1) {
      const n = Math.floor(v.smokeAcc);
      v.smokeAcc -= n;
      leakFx("smoke", b.position, "#2a1a44", n);
    }
  } else if (c.kind === "boss") {
    if (v.accent) v.accent.emissiveIntensity = 3.4 + c.glow;
    const s = c.shards;
    for (let k = 0; k < 3; k++) {
      const m = v.shards[k];
      if (!m) continue;
      const o = k * 7;
      m.visible = s[o + 6] > 0;
      m.position.set(s[o], s[o + 1], s[o + 2]);
      m.scale.setScalar(Math.max(0.01, s[o + 6]));
      m.rotation.x += dt * 9;
      m.rotation.z += dt * 6;
    }
  }
}

/** Mounted once wherever enemies live. */
export function Corpses() {
  const { gl, scene, camera } = useThree();
  const all = useRef<Group>(null);

  // Compile every slot's program now, at floor load, not on the frame of
  // the first kill (compile only walks visible things: show them for it).
  useEffect(() => {
    const root = all.current;
    if (!root) return;
    const shown: Group[] = [];
    for (const kind in views) {
      for (const v of views[kind as EnemyId]) {
        if (v?.root && !v.root.visible) {
          v.root.visible = true;
          shown.push(v.root);
        }
      }
    }
    try {
      gl.compile(root, camera, scene);
    } finally {
      for (const g of shown) g.visible = false;
    }
  }, [gl, scene, camera]);

  useEffect(() => {
    mounted = true;
    for (const l of lights) {
      l.src = addLightSource({ position: [0, -50, 0], color: "#ffffff", intensity: 0, distance: 6, priority: 4 });
      l.t = Infinity;
    }
    return () => {
      mounted = false;
      clearCorpses(pool);
      for (const l of lights) {
        if (l.src) removeLightSource(l.src);
        l.src = null;
        l.t = Infinity;
      }
    };
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20) * presentScale();
    stepCorpses(pool, dt, onCue);
    stepKillLights(dt);
    for (const kind in pool) {
      const states = pool[kind as EnemyId];
      const vs = views[kind as EnemyId];
      for (let i = 0; i < states.length; i++) {
        const v = vs[i];
        if (!v?.root) continue;
        const c = states[i];
        if (!c.live) {
          if (v.root.visible) v.root.visible = false;
          continue;
        }
        v.root.visible = true;
        apply(c, v, dt);
      }
    }
  });

  return (
    <group ref={all}>
      {(Object.keys(SLOTS) as EnemyId[]).map((kind) => {
        const Slot = SLOT_OF[kind];
        return Array.from({ length: SLOTS[kind] }, (_, i) => <Slot key={`${kind}${i}`} i={i} />);
      })}
    </group>
  );
}
