import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, MeshStandardMaterial, Vector3 } from "three";
import { playSwing, playSwordHit } from "../audio/sound";
import { gameEvents } from "../core/events";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { forEachHittable } from "../game/registry";
import { explode } from "./damage";

/** The Sword Staff's weapon: each attack conjures a spectral greatsword out of
 * thin air that swings once and dissolves. Two swing styles — a fast
 * horizontal slash and a heavy overhead cleave. Damage is an arc test against
 * the hittable registry at the swing's apex (no physics body: the sword is
 * magic, it passes through the world and cuts what stands in the arc).
 *
 * Multiplayer: peers replay the cast with `cosmetic` set, so they see the
 * identical sword and hear the whoosh but deal no damage — the caster's
 * client is authoritative for its own hits, like every other spell. */

export type SwingKind = "slash" | "cleave";

interface SwingSpec {
  id: number;
  kind: SwingKind;
  origin: [number, number, number];
  dir: [number, number, number];
  damage: number;
  impulse: number;
  color: string;
  /** Alternate slash direction so combos read as left-right-left. */
  mirror: boolean;
  cosmetic: boolean;
}

export interface ConjureOptions {
  kind: SwingKind;
  origin: [number, number, number];
  dir: [number, number, number];
  damage: number;
  impulse: number;
  color?: string;
  cosmetic?: boolean;
}

let nextSwingId = 1;
let swingCounter = 0;
let enqueue: ((spec: SwingSpec) => void) | null = null;

export function conjureSword(opts: ConjureOptions): void {
  enqueue?.({
    id: nextSwingId++,
    kind: opts.kind,
    origin: opts.origin,
    dir: opts.dir,
    damage: opts.damage,
    impulse: opts.impulse,
    color: opts.color ?? "#cfe0ff",
    mirror: swingCounter++ % 2 === 1,
    cosmetic: opts.cosmetic ?? false,
  });
}

export function PhantomSwords() {
  const [live, setLive] = useState<SwingSpec[]>([]);

  useEffect(() => {
    enqueue = (spec) => setLive((prev) => [...prev, spec]);
    return () => {
      enqueue = null;
    };
  }, []);

  const remove = useCallback((id: number) => {
    setLive((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return (
    <>
      {live.map((spec) => (
        <SwordSwing key={spec.id} spec={spec} remove={remove} />
      ))}
    </>
  );
}

// Swing tuning per kind: duration, arc reach and half-angle of the hit cone.
const SWING = {
  slash: { dur: 0.28, range: 3.4, halfAngle: Math.PI / 2.6, vertical: 1.9 },
  cleave: { dur: 0.34, range: 3.8, halfAngle: Math.PI / 5, vertical: 2.6 },
} as const;

const toTarget = new Vector3();

function SwordSwing({ spec, remove }: { spec: SwingSpec; remove: (id: number) => void }) {
  const root = useRef<Group>(null);
  const arm = useRef<Group>(null);
  const age = useRef(0);
  const struck = useRef(false);
  const light = useRef<DynamicLightSource | null>(null);
  const trailClock = useRef(0);
  const cfg = SWING[spec.kind];
  const heavy = spec.kind === "cleave";

  const bladeMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#0a0e1a",
        emissive: spec.color,
        emissiveIntensity: 2.6,
        transparent: true,
        opacity: 0.95,
        flatShading: true,
        toneMapped: false,
      }),
    [spec.color],
  );
  const edgeMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#000000",
        emissive: "#ffffff",
        emissiveIntensity: 3.4,
        transparent: true,
        opacity: 0.95,
        toneMapped: false,
      }),
    [],
  );

  // Yaw/pitch aligning the swing rig with the aim direction. The rig's
  // forward is -Z (three.js convention): rotation.y = yaw maps -Z onto the
  // horizontal aim, rotation.x = pitch tilts it up/down.
  const [yaw, pitch] = useMemo(() => {
    const [dx, dy, dz] = spec.dir;
    return [Math.atan2(-dx, -dz), Math.asin(Math.max(-1, Math.min(1, dy)))];
  }, [spec.dir]);

  useEffect(() => {
    playSwing(heavy);
    const src = addLightSource({
      position: spec.origin,
      color: spec.color,
      intensity: 4,
      distance: 7,
      priority: 3,
    });
    light.current = src;
    // The blade materializes with a shimmer.
    spawnBurst({
      position: spec.origin,
      count: 8,
      color: [spec.color, "#ffffff"],
      speed: 1.6,
      upward: 0.6,
      ttl: 0.3,
      size: 0.06,
      gravity: 0,
      drag: 2,
    });
    return () => {
      removeLightSource(src);
      light.current = null;
      bladeMat.dispose();
      edgeMat.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const strike = useCallback(() => {
    if (struck.current) return;
    struck.current = true;
    const [ox, oy, oz] = spec.origin;
    const [dx, dy, dz] = spec.dir;
    // The cleave ends in a ground slam — a real (small) explosion where the
    // blade lands, so heavy swings shove crates and stagger crowds. Replayed
    // cosmetically for peers; their client deals its own damage.
    if (heavy) {
      explode({
        position: [ox + dx * 2.1, Math.max(oy + dy * 2.1 - 0.6, 0.15), oz + dz * 2.1],
        radius: 2.3,
        damage: spec.damage * 0.4,
        impulse: 20,
        team: "player",
        color: spec.color,
        particles: 22,
        light: 26,
        style: "arcane",
        remote: spec.cosmetic,
      });
    }
    if (spec.cosmetic) return;
    let hitAny = false;
    forEachHittable((h) => {
      const p = h.getPosition();
      toTarget.set(p.x - ox, p.y - oy, p.z - oz);
      if (Math.abs(toTarget.y) > cfg.vertical) return;
      const flat = Math.hypot(toTarget.x, toTarget.z);
      if (flat > cfg.range || flat < 0.01) return;
      // Horizontal cone around the aim direction.
      const fl = Math.hypot(dx, dz) || 1;
      const cos = (toTarget.x * (dx / fl) + toTarget.z * (dz / fl)) / flat;
      if (cos < Math.cos(cfg.halfAngle)) return;
      hitAny = true;
      const push = spec.impulse * (1 - (flat / cfg.range) * 0.5);
      toTarget.normalize().multiplyScalar(push);
      h.hit(spec.damage, { x: toTarget.x, y: toTarget.y + push * 0.4, z: toTarget.z });
    });
    if (hitAny) {
      playSwordHit();
      gameEvents.emit("shake", heavy ? 0.35 : 0.18);
      // Sparks where the arc bites, biased toward the aim point.
      spawnBurst({
        position: [ox + dx * 2, oy + dy * 2, oz + dz * 2],
        count: heavy ? 18 : 10,
        color: [spec.color, "#fff3d0"],
        speed: 5,
        ttl: 0.45,
        size: 0.07,
      });
    }
  }, [spec, cfg, heavy]);

  useFrame((_, dt) => {
    age.current += dt;
    const t = Math.min(age.current / cfg.dur, 1);
    // Anticipation-snap-follow: ease that lingers at the wind-up then whips.
    const swing = t * t * (3 - 2 * t);

    const a = arm.current;
    if (a) {
      if (spec.kind === "slash") {
        const from = spec.mirror ? 1.5 : -1.5;
        a.rotation.y = from + swing * (spec.mirror ? -3 : 3);
        a.rotation.z = (spec.mirror ? -1 : 1) * Math.sin(swing * Math.PI) * 0.35;
      } else {
        // Overhead: raised up-and-back, slams down past horizontal.
        a.rotation.x = 2.1 - swing * 2.9;
      }
    }

    // The cut lands mid-swing, when the blade crosses the aim line.
    if (t >= 0.45) strike();

    // Trail: embers stream off the blade tip while it whips.
    trailClock.current -= dt;
    if (trailClock.current <= 0 && t < 0.85 && root.current && a) {
      trailClock.current = 0.02;
      const tip = new Vector3(0, 0, -cfg.range * 0.78);
      a.localToWorld(tip);
      spawnBurst({
        position: [tip.x, tip.y, tip.z],
        count: 2,
        color: [spec.color, "#ffffff"],
        speed: 0.7,
        upward: 0,
        ttl: 0.28,
        size: 0.06,
        gravity: 0,
        drag: 1,
      });
      light.current?.position.copy(tip);
    }

    // Dissolve after the follow-through.
    const fade = age.current > cfg.dur ? Math.max(0, 1 - (age.current - cfg.dur) / 0.14) : 1;
    bladeMat.opacity = 0.95 * fade;
    edgeMat.opacity = 0.95 * fade;
    if (light.current) light.current.intensity = 4 * fade;
    if (age.current > cfg.dur + 0.16) remove(spec.id);
  });

  return (
    <group ref={root} position={spec.origin} rotation={[0, yaw, 0]}>
      <group rotation={[spec.kind === "cleave" ? 0 : pitch, 0, 0]}>
        <group ref={arm}>
          {/* Blade held out along -Z (tip forward): chunky low-poly greatsword. */}
          <group position={[0, 0, -cfg.range * 0.45]} rotation={[-Math.PI / 2, 0, 0]}>
            {/* Core */}
            <mesh material={bladeMat}>
              <boxGeometry args={[0.16, cfg.range * 0.62, 0.045]} />
            </mesh>
            {/* Bright cutting edges */}
            <mesh material={edgeMat} position={[0.095, 0, 0]}>
              <boxGeometry args={[0.03, cfg.range * 0.6, 0.05]} />
            </mesh>
            <mesh material={edgeMat} position={[-0.095, 0, 0]}>
              <boxGeometry args={[0.03, cfg.range * 0.6, 0.05]} />
            </mesh>
            {/* Tip wedge */}
            <mesh material={edgeMat} position={[0, cfg.range * 0.34, 0]} rotation={[0, 0, Math.PI / 4]}>
              <boxGeometry args={[0.14, 0.14, 0.045]} />
            </mesh>
            {/* Crossguard + grip stub (it floats — no hand holds it) */}
            <mesh material={bladeMat} position={[0, -cfg.range * 0.33, 0]}>
              <boxGeometry args={[0.34, 0.07, 0.07]} />
            </mesh>
            <mesh material={bladeMat} position={[0, -cfg.range * 0.39, 0]}>
              <boxGeometry args={[0.05, 0.16, 0.05]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}
