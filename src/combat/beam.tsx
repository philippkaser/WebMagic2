import { useFrame } from "@react-three/fiber";
import { interactionGroups, useRapier } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, Group, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { GROUPS } from "../core/config";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { forEachHittable } from "../game/registry";

/** Hitscan laser beams (the charging laser staff). A beam is instantaneous:
 * on spawn it raycasts the world for its true length, damages everything the
 * ray grazes, then lives on only as a fading light-column visual.
 *
 * Damage happens once, on the frame the beam fires — `cosmetic` beams
 * (peer replays) skip it, exactly like projectile explosions. */

const MAX_LENGTH = 42;

interface BeamSpec {
  id: number;
  origin: [number, number, number];
  dir: [number, number, number];
  damage: number;
  /** Charge fraction 0..1 — scales thickness, impulse and impact VFX. */
  power: number;
  /** Mirror-reflections off the world left in this beam's chain. */
  bounces: number;
  /** Prism-shatter: at the final wall the beam splits into 1+split weaker
   * child beams scattered around the reflection. */
  split: number;
  color: string;
  cosmetic: boolean;
}

export interface BeamOptions {
  origin: [number, number, number];
  dir: [number, number, number];
  damage: number;
  power: number;
  bounces?: number;
  split?: number;
  color?: string;
  cosmetic?: boolean;
}

let nextBeamId = 1;
let enqueue: ((spec: BeamSpec) => void) | null = null;

export function fireBeam(opts: BeamOptions): void {
  enqueue?.({
    id: nextBeamId++,
    origin: opts.origin,
    dir: opts.dir,
    damage: opts.damage,
    power: Math.max(0, Math.min(1, opts.power)),
    bounces: Math.max(0, Math.round(opts.bounces ?? 0)),
    split: Math.max(0, Math.round(opts.split ?? 0)),
    color: opts.color ?? "#ff5470",
    cosmetic: opts.cosmetic ?? false,
  });
}

/** Mount inside <Physics> — beams raycast the world for their length. */
export function LaserBeams() {
  const [live, setLive] = useState<BeamSpec[]>([]);

  useEffect(() => {
    enqueue = (spec) => setLive((prev) => [...prev, spec]);
    return () => {
      enqueue = null;
    };
  }, []);

  const remove = useCallback((id: number) => {
    setLive((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return (
    <>
      {live.map((spec) => (
        <Beam key={spec.id} spec={spec} remove={remove} />
      ))}
    </>
  );
}

const UP = new Vector3(0, 1, 0);
const tmp = new Vector3();

function Beam({ spec, remove }: { spec: BeamSpec; remove: (id: number) => void }) {
  const { world, rapier } = useRapier();
  const group = useRef<Group>(null);
  const age = useRef(0);
  const life = 0.16 + spec.power * 0.12;

  const coreMat = useMemo(
    () =>
      new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 1, toneMapped: false }),
    [],
  );
  const glowMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [spec.color],
  );

  // Length, orientation and the wall normal are all decided once, synchronously.
  const { length, quat, normal } = useMemo(() => {
    const [ox, oy, oz] = spec.origin;
    const [dx, dy, dz] = spec.dir;
    const ray = new rapier.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    // Only the WORLD stops the beam — it burns straight through crowds.
    const hit = world.castRayAndGetNormal(
      ray,
      MAX_LENGTH,
      true,
      undefined,
      interactionGroups(GROUPS.FRIENDLY_PROJECTILE, [GROUPS.WORLD]),
    );
    const length = hit ? Math.max(hit.timeOfImpact, 0.5) : MAX_LENGTH;
    const quat = new Quaternion().setFromUnitVectors(UP, tmp.set(dx, dy, dz).normalize());
    return { length, quat, normal: hit ? hit.normal : null };
  }, [spec, world, rapier]);

  useEffect(() => {
    const [ox, oy, oz] = spec.origin;
    const [dx, dy, dz] = spec.dir;
    const grazeRadius = 0.55 + spec.power * 0.45;

    if (!spec.cosmetic) {
      // Everything within graze distance of the ray segment gets burned and
      // shoved along the beam.
      forEachHittable((h) => {
        const p = h.getPosition();
        const rx = p.x - ox;
        const ry = p.y - oy;
        const rz = p.z - oz;
        const along = rx * dx + ry * dy + rz * dz;
        if (along < 0 || along > length + grazeRadius) return;
        const px = rx - dx * along;
        const py = ry - dy * along;
        const pz = rz - dz * along;
        if (Math.hypot(px, py, pz) > grazeRadius) return;
        const push = 8 + spec.power * 22;
        h.hit(spec.damage, { x: dx * push, y: dy * push + push * 0.3, z: dz * push });
      });
    }

    // Muzzle flash + impact splash. The impact splash is where the force
    // reads: molten sparks off the wall, sized by charge.
    const ex = ox + dx * length;
    const ey = oy + dy * length;
    const ez = oz + dz * length;
    flashLight([ox, oy, oz], spec.color, 14 + spec.power * 20, 8);
    flashLight([ex, ey, ez], spec.color, 20 + spec.power * 34, 8 + spec.power * 6);
    spawnBurst({
      position: [ex, ey, ez],
      count: Math.round(8 + spec.power * 22),
      color: [spec.color, "#fff3d0", "#ffffff"],
      speed: 4 + spec.power * 5,
      ttl: 0.5,
      size: 0.07,
    });
    // Modifier chains continue from the wall. Bounces mirror the beam like a
    // ray of light; once they're spent, split shatters it into a fan of
    // weaker child beams scattered around the reflection. Cosmetic beams
    // chain too — peers see the whole light show.
    if (normal) {
      const dot = dx * normal.x + dy * normal.y + dz * normal.z;
      const rx = dx - 2 * dot * normal.x;
      const ry = dy - 2 * dot * normal.y;
      const rz = dz - 2 * dot * normal.z;
      const from: [number, number, number] = [
        ex + normal.x * 0.06,
        ey + normal.y * 0.06,
        ez + normal.z * 0.06,
      ];
      if (spec.bounces > 0) {
        fireBeam({
          origin: from,
          dir: [rx, ry, rz],
          damage: spec.damage * 0.85,
          power: spec.power,
          bounces: spec.bounces - 1,
          split: spec.split,
          color: spec.color,
          cosmetic: spec.cosmetic,
        });
      } else if (spec.split > 0) {
        for (let i = 0; i <= spec.split; i++) {
          const d = tmp
            .set(
              rx + (Math.random() - 0.5) * 0.9,
              ry + (Math.random() - 0.5) * 0.9,
              rz + (Math.random() - 0.5) * 0.9,
            )
            .normalize();
          fireBeam({
            origin: from,
            dir: [d.x, d.y, d.z],
            damage: spec.damage * 0.55,
            power: spec.power * 0.8,
            color: spec.color,
            cosmetic: spec.cosmetic,
          });
        }
      }
    }

    // Sparks drifting off the column itself.
    const steps = Math.min(10, Math.round(length / 2.5));
    for (let i = 1; i <= steps; i++) {
      const f = (i / (steps + 1)) * length;
      spawnBurst({
        position: [ox + dx * f, oy + dy * f, oz + dz * f],
        count: 1,
        color: [spec.color, "#ffffff"],
        speed: 0.9,
        upward: 0.3,
        ttl: 0.35,
        size: 0.05,
        gravity: 0,
        drag: 1,
      });
    }
    gameEvents.emit("shake", 0.1 + spec.power * 0.3);
    return () => {
      coreMat.dispose();
      glowMat.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dt) => {
    age.current += dt;
    const t = Math.min(age.current / life, 1);
    const fade = 1 - t * t;
    coreMat.opacity = fade;
    glowMat.opacity = 0.55 * fade;
    // The column collapses inward as it dies.
    if (group.current) group.current.scale.set(fade, 1, fade);
    if (t >= 1) remove(spec.id);
  });

  const radius = 0.05 + spec.power * 0.09;
  const mid: [number, number, number] = [
    spec.origin[0] + spec.dir[0] * length * 0.5,
    spec.origin[1] + spec.dir[1] * length * 0.5,
    spec.origin[2] + spec.dir[2] * length * 0.5,
  ];

  return (
    <group position={mid} quaternion={quat}>
      <group ref={group}>
        <mesh material={coreMat}>
          <cylinderGeometry args={[radius, radius, length, 6, 1, true]} />
        </mesh>
        <mesh material={glowMat}>
          <cylinderGeometry args={[radius * 2.6, radius * 2.6, length, 6, 1, true]} />
        </mesh>
      </group>
    </group>
  );
}
