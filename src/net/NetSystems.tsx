import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
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
  /** RigidBody type: dynamic on the authority, kinematic replica otherwise. */
  bodyType: "dynamic" | "kinematicPosition";
  /** Authority: tell everyone this entity despawned (death/break). */
  despawn(data?: unknown): void;
  /** Anyone: route a command to the authority. */
  command(cmd: string, data: unknown): void;
}

/** One hook per replicated entity. Registration, snapshotting, interpolation,
 * commands, despawn replay, late-join and host migration are all handled by
 * the framework — the component keeps its behavior code and checks
 * `isAuthority` to decide whether to simulate. */
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

  // Host migration: our kinematic replica flips to dynamic — resume with the
  // last replicated velocity so the fight continues mid-motion, no reload.
  const wasAuthority = useRef(isAuthority);
  useEffect(() => {
    if (isAuthority && !wasAuthority.current && enabled && !opts.immobile) {
      const v = handle.current?.lastVelocity();
      if (v) latest.current.body.current?.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
    }
    wasAuthority.current = isAuthority;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthority, enabled]);

  return useMemo(
    () => ({
      isAuthority,
      bodyType: isAuthority ? "dynamic" : "kinematicPosition",
      despawn: (data?: unknown) => handle.current?.despawn(data),
      command: (cmd: string, data: unknown) => handle.current?.command(cmd, data),
    }),
    [isAuthority],
  );
}

/** Mounted once in the scene: runs the authority snapshot cadence and the
 * replica interpolation drive. Offline both are no-ops. */
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
      replicaFrame();
    }
  });
  return null;
}
