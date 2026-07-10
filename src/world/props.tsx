import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  CylinderCollider,
  interactionGroups,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  MeshBasicMaterial,
  NearestFilter,
  Path,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Vector2,
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

/** Half-extents of the tear in local units — the shader normalizes by these. */
const TEAR_W = 0.8;
const TEAR_H = 1.45;

/** Jagged tear outline, seeded per portal so no two rips are identical. */
function tearPoints(seedKey: string, scale: number, jitter: number): [number, number][] {
  const rng = new Rng(hashSeed(`tear:${seedKey}`));
  const n = 18;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Alternating spikes read as torn cloth rather than a smooth oval.
    const jag = 1 + (i % 2 === 0 ? jitter : -jitter * 0.6) + (rng.next() - 0.5) * jitter;
    pts.push([Math.cos(a) * TEAR_W * jag * scale, Math.sin(a) * TEAR_H * jag * scale]);
  }
  return pts;
}

function shapeFrom(pts: [number, number][]): Shape {
  const shape = new Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  return shape;
}

const RIP_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** The void inside the tear: chunky-pixel starfield spiralling down into a
 * deep purple nothing, torn edges burning with the portal color. */
const RIP_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uActive; // 1 open … ~0.1 sealed
varying vec2 vP;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 p = vP / vec2(${TEAR_W.toFixed(2)}, ${TEAR_H.toFixed(2)});
  p = floor(p * 30.0) / 30.0; // quantize: the void is pixelated too
  float r = length(p);
  float ang = atan(p.y, p.x);

  // Star streaks caught in the pull, spiralling toward the center.
  float swirl = ang + (1.0 - r) * 3.5 - uTime * 0.3;
  vec2 g = vec2(swirl * 2.4, pow(max(r, 0.02), 0.55) * 7.0 - uTime * (0.55 + 0.9 * uActive));
  vec2 cell = floor(g * 3.0);
  float h = hash(cell);
  float star = step(0.84, h) * (0.3 + 0.7 * fract(h * 91.7 + uTime * (0.4 + h)));

  vec3 col = mix(vec3(0.006, 0.004, 0.02), vec3(0.05, 0.02, 0.11), r); // deep void
  col += uColor * star * (0.15 + 0.85 * uActive) * (0.35 + r * 0.8);
  col += uColor * pow(smoothstep(0.45, 1.0, r), 3.0) * (0.5 + 2.4 * uActive); // burning edge
  gl_FragColor = vec4(col, 1.0);
}`;

/** Interactive portal — a tear ripped through the world. While `locked`, the
 * wound is barely open: dim, still, and it refuses use. */
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
  const rim = useRef<MeshBasicMaterial>(null);
  const shards = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const sparkClock = useRef(0);
  const activity = useRef(locked ? 0.1 : 1);

  const seedKey = position.join(",");
  const { voidGeo, rimGeo, material, stepTex } = useMemo(() => {
    const inner = tearPoints(seedKey, 1, 0.14);
    const outerShape = shapeFrom(tearPoints(seedKey, 1.07, 0.2));
    outerShape.holes.push(new Path(inner.map(([x, y]) => new Vector2(x * 0.97, y * 0.97))));
    const material = new ShaderMaterial({
      vertexShader: RIP_VERT,
      fragmentShader: RIP_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(color) },
        uActive: { value: locked ? 0.1 : 1 },
      },
      side: DoubleSide,
    });
    return {
      voidGeo: new ShapeGeometry(shapeFrom(inner)),
      rimGeo: new ShapeGeometry(outerShape),
      material,
      stepTex: getTextures("runestone"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  useEffect(() => {
    material.uniforms.uColor.value.set(color);
    const src = addLightSource({
      position: [position[0], position[1] + 1.6, position[2] + 0.8],
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

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    // The wound eases open / shut instead of snapping when the boss falls.
    activity.current += ((locked ? 0.1 : 1) - activity.current) * Math.min(1, dt * 2.5);
    const act = activity.current;
    material.uniforms.uTime.value = t;
    material.uniforms.uActive.value = act;
    if (rim.current) {
      // Unstable edge: flicker like the tear is straining to close.
      const flicker = 0.75 + Math.sin(t * 7.3) * 0.12 + Math.sin(t * 23.1) * 0.08;
      rim.current.opacity = act * flicker;
    }
    if (light.current) light.current.intensity = act * (9 + Math.sin(t * 2.2) * 1.2);
    if (group.current) {
      // Breathe, don't spin — a rip is a wound, not a machine.
      const s = 1 + Math.sin(t * 1.7) * 0.02 * act;
      group.current.scale.set(s, 1 + Math.sin(t * 1.7 + 1.2) * 0.015 * act, 1);
    }
    if (shards.current) shards.current.rotation.z = t * 0.25 * act;

    sparkClock.current -= dt;
    if (sparkClock.current <= 0 && !locked) {
      sparkClock.current = 0.09;
      const a = Math.random() * Math.PI * 2;
      spawnBurst({
        position: [
          position[0] + Math.cos(a) * TEAR_W * 1.1,
          position[1] + 1.55 + Math.sin(a) * TEAR_H * 1.05,
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
      <group ref={group} position={[0, 1.55, 0]}>
        {/* The void beyond */}
        <mesh geometry={voidGeo} material={material} />
        {/* Torn, burning edge */}
        <mesh geometry={rimGeo} position={[0, 0, 0.005]}>
          <meshBasicMaterial
            ref={rim}
            color={color}
            toneMapped={false}
            transparent
            blending={AdditiveBlending}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* Debris caught in the tear's pull */}
        <group ref={shards}>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2 + i * 1.7;
            return (
              <mesh
                key={i}
                position={[Math.cos(a) * (TEAR_W + 0.45), Math.sin(a) * (TEAR_H + 0.3) * 0.8, 0.1]}
                rotation={[i * 1.3, i * 0.7, i * 2.1]}
                scale={0.5 + (i % 3) * 0.3}
              >
                <tetrahedronGeometry args={[0.09]} />
                <meshStandardMaterial color="#1a1626" emissive={color} emissiveIntensity={0.35} roughness={0.6} />
              </mesh>
            );
          })}
        </group>
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
