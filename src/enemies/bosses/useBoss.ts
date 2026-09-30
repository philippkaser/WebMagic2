import { type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playBossRoar } from "../../audio/sound";
import { floorScale } from "../../core/config";
import { gameEvents } from "../../core/events";
import { addLightSource, flashLight, removeLightSource, type DynamicLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { dropLoot } from "../../items/LootOrbs";
import { isHost, selectIsHost, useNet } from "../../net/netStore";
import { session } from "../../net/session";
import type { Vec3 } from "../../world/types";
import { spawnGibs, type GibPalette } from "../fx/gibs";
import { useEnemyNet } from "../useEnemyNet";

export const BOSS_ID = "boss";

/** Everything the floor bosses share: floor-scaled health mirrored to the
 * HUD bar (host and replicas alike), a wake-up roar, a pooled light that
 * rides the body, the phase break at half health (every client derives it
 * from the replicated HP), and a death that pays out for the whole party
 * and unseals the portals. */
export function useBoss(opts: {
  floor: number;
  position: Vec3;
  name: string;
  color: string;
  baseHp: number;
  fallMessage: string;
  gibs: GibPalette;
  onDeath: () => void;
  /** Called once on every client when health first drops below half. */
  onPhaseBreak: () => void;
}) {
  const { floor, position, name, color, baseHp } = opts;
  const body = useRef<RapierRigidBody>(null);
  const host = useNet(selectIsHost);
  const scale = useMemo(() => floorScale(floor), [floor]);
  const maxHp = useMemo(() => baseHp * scale.enemyHealth, [baseHp, scale]);
  const hp = useRef(maxHp);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const awake = useRef(false);
  const phase2 = useRef(false);
  const flash = useRef(0);
  const light = useRef<DynamicLightSource | null>(null);
  const live = useRef(opts);
  live.current = opts;

  useEffect(() => {
    const src = addLightSource({ position, color, intensity: 8, distance: 14, priority: 2 });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [position, color]);

  /** Wake with a roar (host: target in range; replicas: first HP news). */
  const wake = useCallback(() => {
    if (awake.current) return;
    awake.current = true;
    playBossRoar();
    gameEvents.emit("message", `${name} wakes`);
    gameEvents.emit("bossHp", { name, frac: Math.max(hp.current / maxHp, 0) });
    gameEvents.emit("shake", 0.5);
  }, [name, maxHp]);

  const kill = useCallback(
    (silent = false) => {
      if (deadRef.current) return;
      deadRef.current = true;
      const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
      const { fallMessage, gibs, onDeath } = live.current;
      if (!silent) {
        for (let i = 0; i < 3; i++) {
          spawnBurst({
            position: [t.x + (Math.random() - 0.5), t.y + (Math.random() - 0.5), t.z + (Math.random() - 0.5)],
            count: 40,
            color: [color, "#ffe9c8", "#1a0a08"],
            speed: 8,
            ttl: 1.1,
            size: 0.13,
          });
        }
        spawnGibs({ position: [t.x, t.y, t.z], count: 30, palette: gibs, force: 8 });
        flashLight([t.x, t.y, t.z], color, 60);
        playBossRoar();
        if (isHost()) {
          // Guaranteed rich drops for the whole party.
          dropLoot([t.x - 0.7, Math.max(t.y, 0.8), t.z + 0.6], floor, 1, 2);
          dropLoot([t.x + 0.7, Math.max(t.y, 0.8), t.z + 0.6], floor, 1, 2);
          session.sendEntityEvent({ k: "death", id: BOSS_ID });
        }
        gameEvents.emit("message", fallMessage);
        gameEvents.emit("shake", 0.8);
      }
      gameEvents.emit("bossHp", null);
      setDead(true);
      onDeath(); // unseal the portals either way
    },
    [color, floor, position],
  );

  const onHp = useCallback(
    (current: number) => {
      if (deadRef.current) return;
      wake();
      gameEvents.emit("bossHp", { name, frac: Math.max(current / maxHp, 0) });
      if (!phase2.current && current < maxHp * 0.5) {
        phase2.current = true;
        live.current.onPhaseBreak();
      }
    },
    [name, maxHp, wake],
  );

  const { interpolate } = useEnemyNet({
    entityId: BOSS_ID,
    body,
    hp,
    deadRef,
    flash,
    dead,
    knockbackScale: 0.25,
    onKill: kill,
    onSnap: onHp,
  });

  // Hide the HUD bar if the floor unmounts mid-fight.
  useEffect(() => () => gameEvents.emit("bossHp", null), []);

  return { body, host, scale, maxHp, hp, deadRef, dead, awake, phase2, flash, light, wake, interpolate };
}
