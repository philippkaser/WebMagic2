import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  CylinderCollider,
  interactionGroups,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  ShaderMaterial,
  Vector3,
} from "three";
import { playAttune, playHit, playPortal } from "../audio/sound";
import { GROUPS } from "../core/config";
import { gameEvents } from "../core/events";
import { Rng, hashSeed } from "../core/rng";
import { explode } from "../combat/damage";
import {
  addLightSource,
  flashLight,
  removeLightSource,
  type DynamicLightSource,
} from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { allocId, registerDynamicBody, registerHittable } from "../game/registry";
import { rollLoot } from "../items/loot";
import { dropLoot } from "../items/LootOrbs";
import { isHost, selectIsHost, useNet } from "../net/netStore";
import { registerEntity, setTreasureProvider } from "../net/replication";
import { session } from "../net/session";
import { useGame } from "../state/gameStore";
import { getTextures } from "../render/textures";
import { GLSL_NOISE } from "../render/shaderLib";
import type { PropKind, Vec3 } from "./types";

const PROP_GROUPS = interactionGroups(GROUPS.PROP, [
  GROUPS.WORLD,
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

interface PropSpec {
  hp: number;
  mass: number;
  shards: string[];
  lootChance: number;
  explodes: boolean;
}

const SPECS: Record<PropKind, PropSpec> = {
  crate: { hp: 26, mass: 1.1, shards: ["#a8743c", "#6b4a24"], lootChance: 0.08, explodes: false },
  barrel: { hp: 42, mass: 2, shards: ["#8a5c2e", "#ff9a3c"], lootChance: 0.08, explodes: true },
  pot: { hp: 6, mass: 0.4, shards: ["#c98d5f", "#8a5a3a"], lootChance: 0.12, explodes: false },
};

/** A physical, breakable prop. Every dungeon floor scatters these so rooms
 * double as a physics sandbox: they tumble when shoved, shatter under fire,
 * sometimes hide loot — and barrels go up violently. The floor host owns
 * their physics and health; replicas interpolate and mirror breaks. */
export function Breakable({
  kind,
  position,
  floor,
  entityId,
}: {
  kind: PropKind;
  position: Vec3;
  floor: number;
  entityId: string;
}) {
  const body = useRef<RapierRigidBody>(null);
  const host = useNet(selectIsHost);
  const spec = SPECS[kind];
  const hp = useRef(spec.hp);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const target = useMemo(() => new Vector3(...position), [position]);
  const hasSnap = useRef(false);

  const kill = useCallback(
    (remote: boolean, silent = false) => {
      if (deadRef.current) return;
      deadRef.current = true;
      const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
      if (!silent) {
        spawnBurst({
          position: [t.x, t.y, t.z],
          count: 22,
          color: spec.shards,
          speed: 5,
          ttl: 0.9,
          size: 0.09,
        });
        if (!remote && isHost()) {
          dropLoot([t.x, Math.max(t.y, 0.5), t.z], floor, spec.lootChance);
          session.sendEntityEvent({ k: "propBroken", id: entityId });
        }
        if (spec.explodes) {
          // Defer so the chain reaction never re-enters this hit handler. A
          // replicated break explodes cosmetically vs entities (the host's
          // copy is authoritative) but still hurts and shoves the local player.
          const at: Vec3 = [t.x, t.y, t.z];
          queueMicrotask(() =>
            explode({
              position: at,
              radius: 3.4,
              damage: 26,
              impulse: 28,
              team: "neutral",
              color: "#ff9a3c",
              particles: 36,
              light: 40,
              remote,
            }),
          );
        }
      }
      setDead(true);
    },
    [entityId, floor, position, spec],
  );

  const applyDamage = useCallback(
    (damage: number, impulse: { x: number; y: number; z: number }) => {
      if (deadRef.current) return;
      hp.current -= damage;
      body.current?.applyImpulse(impulse, true);
      if (hp.current <= 0) kill(false);
    },
    [kill],
  );

  useEffect(() => {
    if (dead) return;
    const b = body.current;
    const unregisterHit = registerHittable({
      id: allocId(),
      team: "prop",
      getPosition: () => body.current?.translation() ?? { x: 0, y: -999, z: 0 },
      hit: (damage, impulse) => {
        if (deadRef.current) return;
        playHit();
        if (isHost()) applyDamage(damage, impulse);
        else session.sendHit(entityId, damage, impulse);
      },
    });
    const unregisterEntity = registerEntity({
      id: entityId,
      snap: () => {
        if (deadRef.current) return null;
        const t = body.current?.translation();
        return t ? { id: entityId, p: [t.x, t.y, t.z], hp: hp.current } : null;
      },
      applyHit: applyDamage,
      applySnap: (s) => {
        target.set(s.p[0], s.p[1], s.p[2]);
        hasSnap.current = true;
        if (s.hp !== undefined) hp.current = s.hp;
      },
      onEvent: (ev) => {
        // "death" arrives via late-join stateSync; "propBroken" live.
        if (ev.k === "propBroken" || ev.k === "death") kill(true, ev.silent);
      },
    });
    const unregisterBody = b ? registerDynamicBody(b) : undefined;
    return () => {
      unregisterHit();
      unregisterEntity();
      unregisterBody?.();
    };
  }, [dead, kill, applyDamage, entityId, target]);

  // Replica: glide toward the host's authoritative position.
  useFrame((_, dt) => {
    const b = body.current;
    if (host || !b || deadRef.current || !hasSnap.current) return;
    const t = b.translation();
    const k = Math.min(1, dt * 9);
    b.setNextKinematicTranslation({
      x: t.x + (target.x - t.x) * k,
      y: t.y + (target.y - t.y) * k,
      z: t.z + (target.z - t.z) * k,
    });
  });

  if (dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={host ? "dynamic" : "kinematicPosition"}
      colliders={false}
      linearDamping={0.2}
      angularDamping={0.4}
    >
      {kind === "crate" && (
        <>
          <CuboidCollider args={[0.42, 0.42, 0.42]} mass={spec.mass} collisionGroups={PROP_GROUPS} />
          <CrateMesh />
        </>
      )}
      {kind === "barrel" && (
        <>
          <CylinderCollider args={[0.48, 0.4]} mass={spec.mass} collisionGroups={PROP_GROUPS} />
          <BarrelMesh />
        </>
      )}
      {kind === "pot" && (
        <>
          <BallCollider args={[0.3]} mass={spec.mass} collisionGroups={PROP_GROUPS} />
          <PotMesh />
        </>
      )}
    </RigidBody>
  );
}

function CrateMesh() {
  const tex = useMemo(() => getTextures("planks"), []);
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[0.84, 0.84, 0.84]} />
      <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.85} />
    </mesh>
  );
}

function BarrelMesh() {
  const tex = useMemo(() => getTextures("barrel"), []);
  return (
    <mesh castShadow receiveShadow>
      <cylinderGeometry args={[0.36, 0.4, 0.96, 10]} />
      <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.75} metalness={0.15} />
    </mesh>
  );
}

function PotMesh() {
  const tex = useMemo(() => getTextures("ceramic"), []);
  return (
    <group>
      <mesh castShadow receiveShadow scale={[1, 1.15, 1]}>
        <sphereGeometry args={[0.3, 10, 8]} />
        <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 0.12, 8]} />
        <meshStandardMaterial map={tex.map} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Wall torch: flickering warm light (via the dynamic light pool), glowing
 * ember head, drifting sparks. */
export function Torch({ position }: { position: Vec3 }) {
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const worldPos = useRef(new Vector3(...position));
  const emberClock = useRef(Math.random());
  const seed = useMemo(() => hashSeed(position.join(",")) % 100, [position]);

  useEffect(() => {
    // Torches can be nested (village posts) — register the light at the
    // torch's *world* position.
    const g = group.current!;
    g.updateWorldMatrix(true, false);
    g.getWorldPosition(worldPos.current);
    const src = addLightSource({
      position: [worldPos.current.x, worldPos.current.y + 0.25, worldPos.current.z + 0.2],
      color: "#ff9a4d",
      intensity: 7,
      distance: 10,
      priority: 1,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [position]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + seed;
    if (light.current) {
      light.current.intensity =
        7 + Math.sin(t * 9.3) * 1.4 + Math.sin(t * 23.7) * 0.9 + Math.sin(t * 3.1) * 0.9;
    }
    emberClock.current -= dt;
    if (emberClock.current <= 0) {
      emberClock.current = 0.16 + Math.random() * 0.12;
      const w = worldPos.current;
      spawnBurst({
        position: [w.x, w.y + 0.12, w.z],
        count: 1,
        color: ["#ffb257", "#ff6b2e"],
        speed: 0.5,
        upward: 1.3,
        ttl: 0.8,
        size: 0.05,
        gravity: 0.6,
        drag: 0.4,
      });
    }
  });

  return (
    <group ref={group} position={position}>
      <mesh position={[0, -0.22, 0]} rotation={[0.22, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.045, 0.5, 6]} />
        <meshStandardMaterial color="#3d2c1c" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.08, 0.05]}>
        <sphereGeometry args={[0.09, 8, 6]} />
        <meshStandardMaterial color="#200" emissive="#ff8b3d" emissiveIntensity={4.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ── Portal: a rip in the fabric of space ─────────────────────────────────────

const RIP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** A wound torn in space, rendered chunky and gritty: everything is computed on
 * a coarse pixel grid so the rip reads as blocky torn pixels, not a smooth
 * decal. A hard jagged silhouette (stepped, not anti-aliased), a raggedly
 * torn burning edge, and a blocky star-vortex void seen THROUGH the tear.
 * SDF + noise in one shader — no geometry to author. */
const RIP_FRAG =
  /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform float uActive; // 1 open … ~0.12 sealed
uniform float uSeed;
varying vec2 vUv;
` +
  GLSL_NOISE +
  /* glsl */ `
// Snap to a coarse grid — the whole rip lives on chunky pixels.
vec2 pix(vec2 v, float n) { return (floor(v * n) + 0.5) / n; }

void main() {
  // Plane-local coords: p.x in [-1.5,1.5], p.y in [-2,2].
  vec2 raw = (vUv - 0.5) * vec2(3.0, 4.0);
  float sd = uSeed;

  // Finer pixel grid so the rip's pixels sit closer to the game's own — still
  // clearly pixelated, but no longer coarse mush.
  vec2 p = pix(raw, 26.0);

  // ---- Tear silhouette: a vertical lens tapering to points, spine wobbling,
  //      width raggedly frayed by fast-moving noise so the edges writhe. ----
  float y = p.y / 1.9;                        // -1..1
  float taper = max(1.0 - y * y, 0.0);
  float halfW = pow(taper, 0.62) * 1.0;
  float fray = fbm(vec2(y * 5.0 + sd, uTime * 1.1 + sd));
  float jag = fbm(vec2(y * 14.0 - sd, uTime * 1.9));   // fine ragged notches, fast
  halfW *= 0.48 + 0.5 * fray + 0.28 * (jag - 0.5);
  halfW *= mix(0.24, 1.0, uActive);           // sealed → a thin slit
  float spine = 0.22 * (fbm(vec2(y * 2.2 - uTime * 0.6 + sd, sd)) - 0.5)
              + 0.05 * sin(uTime * 3.0 + y * 8.0); // extra live wobble of the crack
  float d = abs(p.x - spine) - halfW;         // <0 inside the tear

  float inside = step(d, 0.0);                 // hard, gritty edge (no AA)
  float edge = smoothstep(0.24, 0.0, abs(d));  // ragged burning rim band

  // ---- Void vortex on the chunky grid: blocky stars + nebula spiralling in. ----
  vec2 c = vec2(p.x - spine, p.y * 0.55);
  float rr = length(c);
  float aa = atan(c.y, c.x);
  float swirl = aa + (1.3 - rr) * 2.8 + uTime * (0.30 + 0.5 * uActive);

  vec2 g0 = vec2(swirl * 2.3, pow(max(rr, 0.03), 0.5) * 6.0 - uTime * (0.8 + 0.8 * uActive));
  float sh0 = hash21(floor(g0));
  float star0 = step(0.86, sh0) * (0.4 + 0.6 * fract(sh0 * 71.3 + uTime));
  vec2 g1 = vec2(swirl * 4.6 + 9.0, pow(max(rr, 0.03), 0.6) * 11.0 - uTime * 1.4);
  float star1 = step(0.90, hash21(floor(g1))) * 0.5;

  float neb = pow(fbm(vec2(swirl * 1.2, rr * 2.4 - uTime * 0.5)), 1.6);

  vec3 deep = mix(uColor * 0.12, vec3(0.04, 0.015, 0.09), smoothstep(0.0, 0.9, rr));
  vec3 voidCol = deep;
  voidCol += uColor * neb * 0.6 * (1.0 - rr * 0.6);
  voidCol += (vec3(0.9) + uColor * 0.6) * star0 * (0.5 + 0.8 * uActive);
  voidCol += uColor * star1 * (0.4 + 0.6 * uActive);

  // ---- Ragged burning edge ----
  float flick = 0.78 + 0.22 * sin(uTime * 11.0 + p.y * 7.0 + sd);
  vec3 edgeCol = uColor * edge * (1.25 + 1.5 * uActive) * flick;

  vec3 col = voidCol * inside + edgeCol;

  // Hard stepped palette → deliberate pixel-magic banding.
  col = floor(col * 14.0) / 14.0;

  float halo = smoothstep(0.34, 0.0, abs(d)) * edge * (0.35 + 0.5 * uActive);
  float alpha = clamp(max(inside, halo), 0.0, 1.0);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}`;

/** Fancy motes swirling around the rip: a swarm of glowing shards that spiral
 * inward as if pulled through the tear, respawning at the rim — pure eye-candy,
 * one instanced draw call. Gated by the rift's `activity` so a sealed wound
 * barely sparkles. */
const MOTE_COUNT = 34;

function RiftMotes({ color, activity }: { color: string; activity: MutableRefObject<number> }) {
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const motes = useMemo(
    () =>
      Array.from({ length: MOTE_COUNT }, () => ({
        a0: Math.random() * Math.PI * 2,
        spin: 1 + Math.random() * 2.2, // turns over one life
        base: 0.55 + Math.random() * 0.6,
        speed: 0.12 + Math.random() * 0.24, // life phases per second
        ph: Math.random(),
        z: (Math.random() - 0.5) * 0.6,
        wob: Math.random() * Math.PI * 2,
      })),
    [],
  );

  useFrame(({ clock }, dt) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    const act = activity.current;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const p = motes[i];
      p.ph += p.speed * dt;
      if (p.ph >= 1) {
        p.ph -= 1;
        p.a0 = Math.random() * Math.PI * 2;
        p.base = 0.55 + Math.random() * 0.6;
      }
      const ph = p.ph;
      const R = (1.75 * (1 - ph) + 0.12) * p.base; // spiral from rim to center
      const a = p.a0 + ph * p.spin * Math.PI * 2 + t * 0.3;
      dummy.position.set(
        Math.cos(a) * R * 0.7,
        Math.sin(a) * R * 1.05,
        Math.sin(ph * Math.PI) * p.z + Math.sin(t * 2 + p.wob) * 0.05,
      );
      const s = (0.018 + 0.05 * Math.sin(ph * Math.PI)) * act; // fade in/out over life
      dummy.scale.setScalar(Math.max(s, 0.0001));
      dummy.rotation.set(t + p.wob, t * 1.3, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MOTE_COUNT]} frustumCulled={false}>
      <tetrahedronGeometry args={[1]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
}

/** Interactive portal — a tear ripped through the world. While `locked`, the
 * wound is barely open: a dim, near-shut slit that refuses use. */
export function Portal({
  position,
  color,
  prompt,
  onUse,
  locked = false,
  lockedPrompt = "The rift is sealed…",
}: {
  position: Vec3;
  color: string;
  prompt: string;
  onUse: () => void;
  locked?: boolean;
  lockedPrompt?: string;
}) {
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const sparkClock = useRef(0);
  const activity = useRef(locked ? 0.12 : 1);

  const seedKey = position.join(",");
  const { material, stepTex } = useMemo(() => {
    const material = new ShaderMaterial({
      vertexShader: RIP_VERT,
      fragmentShader: RIP_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(color) },
        uActive: { value: locked ? 0.12 : 1 },
        uSeed: { value: (hashSeed(seedKey) % 1000) / 100 },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    return { material, stepTex: getTextures("runestone") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  useEffect(() => {
    material.uniforms.uColor.value.set(color);
    const src = addLightSource({
      position: [position[0], position[1] + 1.7, position[2] + 0.8],
      color,
      intensity: 9,
      distance: 12,
      priority: 2,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [position, color, material]);

  useFrame(({ clock, camera }, dt) => {
    const t = clock.elapsedTime;
    // The wound eases open / shut instead of snapping when the boss falls.
    activity.current += ((locked ? 0.12 : 1) - activity.current) * Math.min(1, dt * 2.5);
    const act = activity.current;
    material.uniforms.uTime.value = t;
    material.uniforms.uActive.value = act;
    if (light.current) light.current.intensity = act * (9 + Math.sin(t * 2.2) * 1.2);
    if (group.current) {
      // Billboard around Y so the tear always presents its face to the player —
      // a rip in space has no "flat side" to catch.
      group.current.rotation.y = Math.atan2(
        camera.position.x - position[0],
        camera.position.z - position[2],
      );
      // Breathe, don't spin — a rip is a wound, not a machine.
      group.current.scale.set(
        1 + Math.sin(t * 1.7) * 0.02 * act,
        1 + Math.sin(t * 1.7 + 1.2) * 0.015 * act,
        1,
      );
    }

    sparkClock.current -= dt;
    if (sparkClock.current <= 0 && !locked) {
      sparkClock.current = 0.09;
      const a = Math.random() * Math.PI * 2;
      spawnBurst({
        position: [
          position[0] + Math.cos(a) * 0.9,
          position[1] + 1.7 + Math.sin(a) * 1.6,
          position[2],
        ],
        count: 1,
        color,
        speed: 0.4,
        upward: 0.7,
        ttl: 0.9,
        size: 0.05,
        gravity: 0,
        drag: 0.5,
      });
    }

    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 7) {
      if (locked) {
        offerInteraction(lockedPrompt, d2, () => {});
      } else {
        offerInteraction(prompt, d2, () => {
          playPortal();
          onUse();
        });
      }
    }
  });

  return (
    <group position={position}>
      {/* Cracked runestone step at the foot of the tear */}
      <mesh position={[0, 0.12, 0]} receiveShadow>
        <boxGeometry args={[3.4, 0.24, 1.6]} />
        <meshStandardMaterial map={stepTex.map} normalMap={stepTex.normalMap} roughness={0.85} />
      </mesh>
      {/* The rip itself — one shader plane — plus the mote swarm around it */}
      <group ref={group} position={[0, 1.8, 0]}>
        <mesh material={material}>
          <planeGeometry args={[3.0, 4.0]} />
        </mesh>
        <RiftMotes color={color} activity={activity} />
      </group>
    </group>
  );
}

// ── Waystone ─────────────────────────────────────────────────────────────────

/** Chunky pixel glyph plate showing the rift's destination floor. */
function waystoneFace(floor: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#46ffd0";
  ctx.textAlign = "center";
  ctx.font = "bold 12px 'Courier New', monospace";
  ctx.fillText("FLOOR", 32, 18);
  ctx.font = "bold 34px 'Courier New', monospace";
  ctx.fillText(String(floor), 32, 50);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  return tex;
}

/** The village waystone: an ancient slab that attunes the rift. Interacting
 * cycles the destination through every checkpoint you've banked — no menus,
 * the stone itself is the UI. */
export function Waystone({
  position,
  rotation = 0,
  floors,
  selected,
  onCycle,
}: {
  position: Vec3;
  rotation?: number;
  floors: number[];
  selected: number;
  onCycle: () => void;
}) {
  const tex = useMemo(() => waystoneFace(selected), [selected]);
  const slabTex = useMemo(() => getTextures("runestone"), []);
  const glow = useRef<MeshBasicMaterial>(null);

  useEffect(() => {
    const src = addLightSource({
      position: [position[0], position[1] + 1.6, position[2]],
      color: "#46ffd0",
      intensity: 3,
      distance: 6,
      priority: 1,
    });
    return () => removeLightSource(src);
  }, [position]);

  useFrame(({ clock }) => {
    if (glow.current) glow.current.opacity = 0.85 + Math.sin(clock.elapsedTime * 2.6) * 0.15;
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 5.5) {
      const next = floors[(floors.indexOf(selected) + 1) % floors.length];
      const text =
        floors.length > 1
          ? `E — Attune the waystone (next: floor ${next})`
          : "E — The waystone knows only floor 1, for now";
      offerInteraction(text, d2, () => {
        if (floors.length <= 1) return;
        playAttune();
        spawnBurst({
          position: [position[0], position[1] + 1.5, position[2]],
          count: 10,
          color: "#46ffd0",
          speed: 1.4,
          upward: 0.6,
          ttl: 0.6,
          size: 0.05,
          gravity: 0,
          drag: 1.5,
        });
        onCycle();
      });
    }
  });

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Base step */}
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <boxGeometry args={[1.8, 0.3, 1.1]} />
        <meshStandardMaterial map={slabTex.map} normalMap={slabTex.normalMap} roughness={0.9} />
      </mesh>
      {/* The slab itself, leaning back a little — ancient, half-sunk */}
      <group rotation={[-0.08, 0, 0.02]}>
        <mesh position={[0, 1.25, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.15, 2.0, 0.32]} />
          <meshStandardMaterial map={slabTex.map} normalMap={slabTex.normalMap} roughness={0.85} />
        </mesh>
        {/* Glowing carved destination */}
        <mesh position={[0, 1.45, 0.168]}>
          <planeGeometry args={[0.82, 0.82]} />
          <meshBasicMaterial ref={glow} map={tex} transparent toneMapped={false} />
        </mesh>
        {/* Faint rune strip below */}
        <mesh position={[0, 0.62, 0.168]}>
          <planeGeometry args={[0.82, 0.1]} />
          <meshStandardMaterial color="#0c1a16" emissive="#2a8f76" emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/** Guaranteed floor treasure — the item is rolled deterministically from the
 * floor seed, so everyone in a shared instance sees the same reward. */
export function TreasurePedestal({ position, floor, seed }: { position: Vec3; floor: number; seed: number }) {
  const def = useMemo(() => rollLoot(new Rng((seed ^ 0x9c67f3a1) >>> 0), floor), [seed, floor]);
  const [taken, setTaken] = useState(false);
  const takenRef = useRef(false);
  const requested = useRef(0);
  const orb = useRef<Group>(null);

  const consume = useCallback(
    (byMe: boolean, silent = false) => {
      if (takenRef.current) return;
      takenRef.current = true;
      setTaken(true);
      if (byMe) useGame.getState().equipItem(def.id);
      if (!silent) {
        spawnBurst({
          position: [position[0], position[1] + 1.5, position[2]],
          count: 20,
          color: [def.color, "#ffffff"],
          speed: 4,
          ttl: 0.7,
          size: 0.08,
        });
        flashLight([position[0], position[1] + 1.5, position[2]], def.color, 18);
      }
    },
    [def, position],
  );

  // Late-join state sync: tell the host whether the treasure is gone.
  useEffect(() => {
    setTreasureProvider(() => takenRef.current);
    return () => setTreasureProvider(null);
  }, []);

  // Replica: the host announced who got it.
  useEffect(
    () =>
      gameEvents.on("entityEvent", (ev) => {
        if (ev.k === "treasureTaken") {
          consume(ev.by !== "" && ev.by === useNet.getState().playerId, ev.silent);
        }
      }),
    [consume],
  );

  // Host: grant a replica's request — one treasure, first come first served.
  useEffect(
    () =>
      gameEvents.on("orbRequest", ({ playerId, orbId }) => {
        if (orbId !== "treasure" || !isHost() || takenRef.current) return;
        session.sendEntityEvent({ k: "treasureTaken", by: playerId });
        consume(false);
      }),
    [consume],
  );

  useEffect(() => {
    if (taken) return;
    const src = addLightSource({
      position: [position[0], position[1] + 1.6, position[2]],
      color: def.color,
      intensity: 4,
      distance: 7,
      priority: 1,
    });
    return () => removeLightSource(src);
  }, [taken, def, position]);

  useFrame(({ clock }, dt) => {
    if (taken) return;
    const g = orb.current;
    if (g) {
      g.position.y = 1.45 + Math.sin(clock.elapsedTime * 2) * 0.09;
      g.rotation.y = clock.elapsedTime * 1.4;
    }
    requested.current -= dt;
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 6) {
      offerInteraction(`E — Take ${def.name}  (${def.desc})`, d2, () => {
        if (takenRef.current) return;
        if (isHost()) {
          session.sendEntityEvent({
            k: "treasureTaken",
            by: useNet.getState().playerId || "self",
          });
          consume(true);
        } else if (requested.current <= 0) {
          requested.current = 0.6;
          session.sendTakeOrb("treasure");
        }
      });
    }
  });

  return (
    <group position={position}>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3, 0.42, 1.1, 8]} />
        <meshStandardMaterial color="#4e4658" roughness={0.8} />
      </mesh>
      {!taken && (
        <group ref={orb} position={[0, 1.45, 0]}>
          <mesh castShadow>
            <octahedronGeometry args={[0.26]} />
            <meshStandardMaterial
              color="#0c0c14"
              emissive={def.color}
              emissiveIntensity={2.8}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}
