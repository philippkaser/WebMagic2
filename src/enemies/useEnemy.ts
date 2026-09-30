import { type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useMemo, useRef, useState } from "react";
import { floorScale } from "../core/config";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { dropLoot } from "../items/LootOrbs";
import { isHost, selectIsHost, useNet } from "../net/netStore";
import { session } from "../net/session";
import type { Vec3 } from "../world/types";
import { spawnGibs, type GibPalette } from "./fx/gibs";
import { LOOT_DROP_CHANCE } from "./shared";
import { useEnemyNet } from "./useEnemyNet";

type Impulse = { x: number; y: number; z: number };

/** How an enemy comes apart — every client plays it on a non-silent death. */
export interface DeathStyle {
  /** Offset from the body origin to the visual center of mass. */
  centerY: number;
  burst: string[];
  light: string;
  gibs: GibPalette;
  gibCount: number;
  /** Outward speed of the debris. */
  force: number;
}

/** Everything an ordinary enemy shares — health scaled by floor, a death that
 * bursts into physical debris and (on the host) rolls loot and tells the
 * replicas, aggro-on-damage, hit flash — layered over useEnemyNet. Each enemy
 * file keeps only its body, its brain and its look. */
export function useEnemy(opts: {
  entityId: string;
  floor: number;
  position: Vec3;
  baseHp: number;
  death: DeathStyle;
  /** Spark color for landed hits. */
  hitColor: string;
  lootChance?: number;
  knockbackScale?: number;
  damageFilter?: (damage: number, impulse: Impulse) => number;
  /** Extra local hit VFX (e.g. ricochet sparks off armor). */
  onHitFx?: (impulse: Impulse) => void;
}) {
  const { entityId, floor, position, baseHp, knockbackScale } = opts;
  const body = useRef<RapierRigidBody>(null);
  const host = useNet(selectIsHost);
  const scale = useMemo(() => floorScale(floor), [floor]);
  const maxHp = baseHp * scale.enemyHealth;
  const hp = useRef(maxHp);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const flash = useRef(0);
  const aggro = useRef(false);
  const knockTimer = useRef(0);
  /** Attack wind-up 0..1 — the host brain writes it, every model reads it. */
  const tell = useRef(0);
  // Latest style/callbacks without re-registering the hittable every render.
  const live = useRef(opts);
  live.current = opts;

  const kill = useCallback(
    (silent = false) => {
      if (deadRef.current) return;
      deadRef.current = true;
      const { death, lootChance = LOOT_DROP_CHANCE } = live.current;
      const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
      const at: Vec3 = [t.x, t.y + death.centerY, t.z];
      if (!silent) {
        spawnBurst({ position: at, count: 22, color: death.burst, speed: 6, ttl: 0.8, size: 0.1 });
        spawnGibs({ position: at, count: death.gibCount, palette: death.gibs, force: death.force });
        flashLight(at, death.light, 22);
        if (isHost()) {
          dropLoot([at[0], Math.max(at[1], 0.6), at[2]], floor, lootChance);
          session.sendEntityEvent({ k: "death", id: entityId });
        }
      }
      setDead(true);
    },
    [entityId, floor, position],
  );

  const hitFeedback = useCallback((impulse: Impulse) => {
    const t = body.current?.translation();
    if (!t) return;
    const { hitColor, death, onHitFx } = live.current;
    spawnBurst({
      position: [t.x, t.y + death.centerY, t.z],
      count: 6,
      color: hitColor,
      speed: 3,
      ttl: 0.4,
      size: 0.06,
    });
    onHitFx?.(impulse);
  }, []);

  const damageFilter = useCallback(
    (damage: number, impulse: Impulse) =>
      live.current.damageFilter ? live.current.damageFilter(damage, impulse) : damage,
    [],
  );

  const onDamaged = useCallback(() => {
    aggro.current = true; // getting shot wakes it, no matter who shot
  }, []);

  const { interpolate } = useEnemyNet({
    entityId,
    body,
    hp,
    deadRef,
    flash,
    dead,
    knockTimer,
    knockbackScale,
    onKill: kill,
    hitFeedback,
    damageFilter,
    onDamaged,
    tell,
  });

  return { body, host, scale, hp, maxHp, deadRef, dead, flash, aggro, knockTimer, tell, interpolate };
}
