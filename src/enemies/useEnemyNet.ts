import { type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import { playHit } from "../audio/sound";
import { gameEvents } from "../core/events";
import { allocId, registerHittable } from "../game/registry";
import { isHost } from "../net/netStore";
import { registerEntity } from "../net/replication";
import { session } from "../net/session";
import { useGame } from "../state/gameStore";

/** Shared host/replica plumbing for one enemy: hittable registration with
 * authority routing, replication registration, and kinematic interpolation
 * for replicas. Keeps Wisp/Sentry/Boss focused on their behavior. */
export function useEnemyNet(opts: {
  entityId: string;
  body: React.RefObject<RapierRigidBody | null>;
  hp: React.MutableRefObject<number>;
  deadRef: React.MutableRefObject<boolean>;
  flash: React.MutableRefObject<number>;
  dead: boolean;
  knockTimer?: React.MutableRefObject<number>;
  /** Fraction of knockback impulses that actually applies (bosses resist). */
  knockbackScale?: number;
  /** silent = late-join catch-up: apply the death without VFX. */
  onKill: (silent?: boolean) => void;
  hitFeedback?: () => void;
  /** Host: damage landed (from anyone) — wake up and fight back. */
  onDamaged?: () => void;
  /** Replica: called after each authoritative snapshot (e.g. boss HP bar). */
  onSnap?: (hp: number) => void;
}) {
  const {
    entityId,
    body,
    hp,
    deadRef,
    flash,
    dead,
    knockTimer,
    knockbackScale = 1,
    onKill,
    hitFeedback,
    onDamaged,
    onSnap,
  } = opts;
  const target = useMemo(() => new Vector3(), []);
  const hasSnap = useRef(false);
  /** When our own spell last touched it — for kill credit. */
  const lastLocalHit = useRef(-1e9);

  const kill = useCallback(
    (silent?: boolean) => {
      if (deadRef.current) return;
      if (!silent && performance.now() - lastLocalHit.current < 5000) {
        useGame.getState().recordKill();
        gameEvents.emit("hitConfirm", { kind: "enemy", killed: true });
      }
      onKill(silent);
    },
    [deadRef, onKill],
  );

  const applyDamage = useCallback(
    (damage: number, impulse: { x: number; y: number; z: number }) => {
      if (deadRef.current) return;
      hp.current -= damage;
      flash.current = 1;
      if (knockTimer) knockTimer.current = 0.4;
      body.current?.applyImpulse(
        {
          x: impulse.x * knockbackScale,
          y: impulse.y * knockbackScale,
          z: impulse.z * knockbackScale,
        },
        true,
      );
      onSnap?.(hp.current);
      onDamaged?.();
      if (hp.current <= 0) kill();
    },
    [body, deadRef, flash, hp, knockTimer, knockbackScale, kill, onDamaged, onSnap],
  );

  useEffect(() => {
    if (dead) return;
    const unregisterHit = registerHittable({
      id: allocId(),
      team: "enemy",
      getPosition: () => body.current?.translation() ?? { x: 0, y: -999, z: 0 },
      hit: (damage, impulse) => {
        if (deadRef.current) return;
        flash.current = 1;
        lastLocalHit.current = performance.now();
        gameEvents.emit("hitConfirm", { kind: "enemy" });
        playHit();
        hitFeedback?.();
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
        if (s.hp !== undefined) {
          hp.current = s.hp;
          onSnap?.(s.hp);
        }
      },
      onEvent: (ev) => {
        if (ev.k === "death") kill(ev.silent);
      },
    });
    return () => {
      unregisterHit();
      unregisterEntity();
    };
  }, [dead, entityId, applyDamage, body, deadRef, flash, hp, target, kill, hitFeedback]);

  /** Replica movement: glide the kinematic body toward the latest snapshot. */
  const interpolate = useCallback(
    (dt: number) => {
      const b = body.current;
      if (!b || !hasSnap.current) return;
      const t = b.translation();
      const k = Math.min(1, dt * 9);
      b.setNextKinematicTranslation({
        x: t.x + (target.x - t.x) * k,
        y: t.y + (target.y - t.y) * k,
        z: t.z + (target.z - t.z) * k,
      });
    },
    [body, target],
  );

  return { applyDamage, interpolate };
}
