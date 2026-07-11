import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { playerPosition } from "../game/player-state";
import {
  authorityTick,
  registerNetEntity,
  replicaFrame,
  SNAP_INTERVAL_S,
  type NetBodyLike,
  type NetEntityHandle,
} from "./entities";
import { selectIsHost, useNet } from "./netStore";

/** React bindings for the replication core. */

export interface UseNetBodyOptions {
  id: string;
  body: React.RefObject<NetBodyLike | null>;
  /** Replicate tumbling rotation (props). */
  rotation?: boolean;
  /** Entity never moves (sentries) — fields/despawn only. */
  immobile?: boolean;
  /** Authority: replicated gameplay scalars (hp…). */
  fields?: () => Record<string, number>;
  /** Replica: authoritative fields arrived. */
  onFields?: (fields: Record<string, number>) => void;
  /** Authority: a player asked for a command ("hit"). */
  onCommand?: (cmd: string, data: unknown, from: string) => void;
  /** Replica/late-join: the authority despawned this entity. */
  onDespawn?: (data: unknown, catchup: boolean) => void;
  /** Set false once dead to drop the registration. */
  enabled?: boolean;
}

export interface NetBody {
  /** Are we this entity's simulation authority? Reactive across migration. */
  isAuthority: boolean;
  /** RigidBody type. Always "dynamic": replicas are PREDICTED bodies steered
   * toward authority, so local physics (shoves, blasts, the player capsule)
   * acts on them instantly. Host migration needs no body flip. */
  bodyType: "dynamic";
  /** Authority: tell everyone this entity despawned (death/break). */
  despawn(data?: unknown): void;
  /** Anyone: route a command to the authority. */
  command(cmd: string, data: unknown): void;
  /** Replica prediction: apply an impulse locally right now (no-op on the
   * authority). Pair with a "hit" command so authority agrees shortly. */
  predictImpulse(impulse: { x: number; y: number; z: number }, scale?: number): void;
}

/** One hook per replicated entity. Registration, snapshotting, predicted
 * replica steering, commands, despawn replay, late-join and host migration
 * are all handled by the framework — the component keeps its behavior code
 * and checks `isAuthority` to decide whether to simulate. */
export function useNetBody(opts: UseNetBodyOptions): NetBody {
  const isAuthority = useNet(selectIsHost);
  const enabled = opts.enabled ?? true;
  const handle = useRef<NetEntityHandle | null>(null);

  // Latest-callback refs so registration survives re-renders untouched.
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!enabled) return;
    const h = registerNetEntity({
      id: opts.id,
      body: () => latest.current.body.current,
      rotation: opts.rotation,
      immobile: opts.immobile,
      fields: () => latest.current.fields?.() ?? {},
      onFields: (f) => latest.current.onFields?.(f),
      onCommand: (cmd, data, from) => latest.current.onCommand?.(cmd, data, from),
      onDespawn: (data, catchup) => latest.current.onDespawn?.(data, catchup),
    });
    handle.current = h;
    return () => {
      h.unregister();
      if (handle.current === h) handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, opts.id]);

  return useMemo(
    () => ({
      isAuthority,
      bodyType: "dynamic" as const,
      despawn: (data?: unknown) => handle.current?.despawn(data),
      command: (cmd: string, data: unknown) => handle.current?.command(cmd, data),
      predictImpulse: (impulse: { x: number; y: number; z: number }, scale?: number) =>
        handle.current?.predictImpulse(impulse, scale),
    }),
    [isAuthority],
  );
}

/** Mounted once in the scene: runs the authority snapshot cadence and the
 * replica steering drive. Offline both are no-ops. */
export function NetSystems() {
  const clock = useRef(0);
  useFrame((_, dt) => {
    const net = useNet.getState();
    if (net.mode !== "online") return;
    const mates = Object.keys(net.roster).length;
    if (selectIsHost(net)) {
      if (mates < 2) return;
      clock.current -= dt;
      if (clock.current > 0) return;
      clock.current = SNAP_INTERVAL_S;
      authorityTick();
    } else {
      replicaFrame(dt, playerPosition);
    }
  });
  return null;
}
