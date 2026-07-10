import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { PointLight, Vector3 } from "three";

/** Dynamic light pool.
 *
 * Forward-rendered three.js has two lighting costs: per-fragment work scales
 * with the number of lights, and *changing* the number of visible lights
 * forces every material to recompile its shader (a huge frame spike). So the
 * game mounts a FIXED pool of point lights once and never changes it.
 *
 * Anything that wants to emit light registers a light *source* (torches,
 * portals, loot, projectiles, the boss, explosion flashes). Every frame the
 * pool assigns its lights to the highest-scoring sources near the camera and
 * zeroes the rest. Sources beyond the pool budget degrade gracefully — a
 * distant torch goes dark long before a nearby explosion does — and the cost
 * per frame is a handful of uniform updates. */

const POOL_SIZE = 14;

export interface DynamicLightSource {
  /** Owners mutate these freely every frame. */
  position: Vector3;
  intensity: number;
  color: string;
  maxDistance: number;
  /** Assignment weight class: torch/loot 1, portals 2, projectiles 3, flashes 4. */
  priority: number;
  /** @internal transient decay rate (0 = persistent). */
  _decay: number;
  /** @internal */
  _id: number;
  /** @internal sticky-assignment bonus to avoid slot flicker. */
  _assigned: boolean;
  /** @internal */
  _score: number;
}

const sources = new Map<number, DynamicLightSource>();
let nextSourceId = 1;

export function addLightSource(opts: {
  position: [number, number, number] | Vector3;
  color: string;
  intensity: number;
  distance?: number;
  priority?: number;
}): DynamicLightSource {
  const src: DynamicLightSource = {
    position:
      opts.position instanceof Vector3
        ? opts.position.clone()
        : new Vector3(...opts.position),
    intensity: opts.intensity,
    color: opts.color,
    maxDistance: opts.distance ?? 10,
    priority: opts.priority ?? 1,
    _decay: 0,
    _id: nextSourceId++,
    _assigned: false,
    _score: 0,
  };
  sources.set(src._id, src);
  return src;
}

export function removeLightSource(src: DynamicLightSource): void {
  sources.delete(src._id);
}

/** Transient explosion/impact flash: decays on its own and self-removes. */
export function flashLight(
  position: [number, number, number] | Vector3,
  color: string,
  intensity = 26,
  distance = 11,
): void {
  const src = addLightSource({ position, color, intensity, distance, priority: 4 });
  src._decay = 9;
}

export function DynamicLights() {
  const lights = useRef<(PointLight | null)[]>([]);
  // Last color string applied per slot — skips redundant color parsing.
  const slotColors = useRef<string[]>(Array.from({ length: POOL_SIZE }, () => ""));

  // 0.9: after every gameplay system has updated its source, before render.
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const cam = state.camera.position;

    // Decay transient flashes.
    for (const src of sources.values()) {
      if (src._decay > 0) {
        src.intensity *= Math.max(0, 1 - src._decay * dt);
        if (src.intensity < 0.12) sources.delete(src._id);
      }
    }

    // Score: importance class dominates, proximity breaks ties, a small
    // stickiness bonus keeps slots from flickering between equal sources.
    const ranked: DynamicLightSource[] = [];
    for (const src of sources.values()) {
      if (src.intensity < 0.05) {
        src._assigned = false;
        continue;
      }
      const dist = src.position.distanceTo(cam);
      if (dist > 60) {
        src._assigned = false;
        continue;
      }
      src._score = src.priority * 8 - dist + (src._assigned ? 2 : 0);
      ranked.push(src);
    }
    ranked.sort((a, b) => b._score - a._score);

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = lights.current[i];
      if (!light) continue;
      const src = ranked[i];
      if (!src) {
        light.intensity = 0;
        continue;
      }
      src._assigned = true;
      light.position.copy(src.position);
      light.intensity = src.intensity;
      light.distance = src.maxDistance;
      if (slotColors.current[i] !== src.color) {
        slotColors.current[i] = src.color;
        light.color.set(src.color);
      }
    }
    for (let i = POOL_SIZE; i < ranked.length; i++) ranked[i]._assigned = false;
  }, 0.9);

  return (
    <>
      {Array.from({ length: POOL_SIZE }, (_, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            lights.current[i] = l;
          }}
          intensity={0}
          distance={10}
          decay={2}
        />
      ))}
    </>
  );
}
