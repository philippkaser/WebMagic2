import { type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import { playHit } from "../audio/sound";
import { gameEvents } from "../core/events";
import { allocId, registerHittable } from "../game/registry";
import { isHost } from "../net/netStore";
import { registerEntity } from "../net/replication";
import type { EntitySnap } from "../net/protocol";
import { session } from "../net/session";
import { useGame } from "../state/gameStore";

type Impulse = { x: number; y: number; z: number };

/** Replica bodies further than this from the latest snapshot snap instead of
 * gliding — a blinking Shade should vanish, not slide through the room. */
const TELEPORT_DIST_SQ = 4 * 4;

/** Shared host/replica plumbing for one enemy: hittable registration with
 * authority routing, replication registration, and kinematic interpolation
 * for replicas. Keeps each enemy focused on its behavior. */
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
  /** Local VFX for a landed hit (every client, before authority routing). */
  hitFeedback?: (impulse: Impulse) => void;
  /** Host: reshape incoming damage by where it came from (armored fronts,
   * weak backs). `impulse` points away from the source. */
  damageFilter?: (damage: number, impulse: Impulse) => number;
  /** Host: damage landed (from anyone) — wake up and fight back. */
  onDamaged?: () => void;
  /** Replica: called after each authoritative snapshot (e.g. boss HP bar). */
  onSnap?: (hp: number) => void;
  /** Attack wind-up 0..1: written by the host brain, replicated to replicas,
   * read by the model on every client. */
  tell?: React.MutableRefObject<number>;
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
    damageFilter,
    onDamaged,
    onSnap,
    tell,
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
    (damage: number, impulse: Impulse) => {
      if (deadRef.current) return;
      hp.current -= damageFilter ? damageFilter(damage, impulse) : damage;
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
    [body, deadRef, flash, hp, knockTimer, knockbackScale, kill, damageFilter, onDamaged, onSnap],
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
        hitFeedback?.(impulse);
        if (isHost()) applyDamage(damage, impulse);
        else session.sendHit(entityId, damage, impulse);
      },
    });
    const unregisterEntity = registerEntity({
      id: entityId,
      snap: () => {
        if (deadRef.current) return null;
        const t = body.current?.translation();
        if (!t) return null;
        const snap: EntitySnap = { id: entityId, p: [t.x, t.y, t.z], hp: hp.current };
        // Quantized so an idle wind-up value doesn't defeat the delta filter.
        if (tell) snap.a = Math.round(tell.current * 20) / 20;
        return snap;
      },
      applyHit: applyDamage,
      applySnap: (s) => {
        target.set(s.p[0], s.p[1], s.p[2]);
        hasSnap.current = true;
        if (tell && s.a !== undefined) tell.current = s.a;
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

  /** Replica movement: glide the kinematic body toward the latest snapshot.
   * Returns true on the frame a long jump (teleport) was snapped. */
  const interpolate = useCallback(
    (dt: number): boolean => {
      const b = body.current;
      if (!b || !hasSnap.current) return false;
      const t = b.translation();
      const jumpSq = (target.x - t.x) ** 2 + (target.y - t.y) ** 2 + (target.z - t.z) ** 2;
      if (jumpSq > TELEPORT_DIST_SQ) {
        b.setNextKinematicTranslation({ x: target.x, y: target.y, z: target.z });
        return true;
      }
      const k = Math.min(1, dt * 9);
      b.setNextKinematicTranslation({
        x: t.x + (target.x - t.x) * k,
        y: t.y + (target.y - t.y) * k,
        z: t.z + (target.z - t.z) * k,
      });
      return false;
    },
    [body, target],
  );

  return { applyDamage, interpolate };
}
