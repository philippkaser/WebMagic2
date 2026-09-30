import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Color, DoubleSide, Group, InstancedMesh, Object3D, ShaderMaterial } from "three";
import { playPortal } from "../../audio/sound";
import { hashSeed } from "../../core/rng";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { offerInteraction } from "../../game/interactions";
import { playerPosition } from "../../game/player-state";
import { RIP_FRAG, RIP_VERT } from "../../render/shaders/rift";
import { RIFT_STONES, RiftFrameModel } from "../../render/models/AltarModels";
import { COLLISION } from "../../physics/groups";
import type { Vec3 } from "../types";

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
  const material = useMemo(() => {
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
    return material;
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
      {/* Rune dais and the broken standing stones framing the tear; the
          stones are solid, the dais stays walk-through as the old step was. */}
      <RiftFrameModel color={color} />
      <RigidBody type="fixed" colliders={false}>
        {RIFT_STONES.map((s, i) => (
          <CuboidCollider key={i} position={s.pos} args={s.half} collisionGroups={COLLISION.world} />
        ))}
      </RigidBody>
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
