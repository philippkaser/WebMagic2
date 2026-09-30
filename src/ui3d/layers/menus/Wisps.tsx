import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Group, Vector3 } from "three";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";
import { emitUiSparks, type UiSparkOptions } from "../../UiSparks";

/** Wisps: little comets of light that orbit something important (the
 * title) on tilted ellipses, passing in front of it and behind, shedding
 * embers as they go. Built entirely on the UI spark pool — each wisp is just
 * a bright head spark re-emitted along its path with a trail of drifting
 * ones, sub-stepped so the trail stays continuous at low frame rates. */

export interface WispOrbit {
  color: string;
  /** Radians per second (sign = direction). */
  speed: number;
  phase: number;
  /** Ellipse radii in the orbit plane, metres. */
  rx: number;
  rz: number;
  /** Tilt of the orbit plane about the view axis, radians. */
  tilt: number;
  /** Vertical wobble, metres. */
  bob?: number;
}

const P: [number, number, number] = [0, 0, 0];
const tmp = new Vector3();
/** Reused for every emission: a wisp emits several times a frame. */
const spark: UiSparkOptions = { position: P, color: "#ffffff", count: 1 };

export function Wisps({
  orbits,
  delay = 0,
  size = 0.02,
  position,
}: {
  orbits: readonly WispOrbit[];
  delay?: number;
  /** Head spark size, metres. */
  size?: number;
  position?: readonly [number, number, number];
}) {
  const show = useUiShow();
  const group = useRef<Group>(null);
  const since = useRef(uiNow());
  const last = useRef<number[]>([]);
  useEffect(() => {
    since.current = uiNow();
    last.current = [];
  }, [show]);

  useFrame(() => {
    const g = group.current;
    if (!g || !show) return;
    const now = uiNow();
    const t = now - since.current - delay;
    if (t < 0) return;
    // Wisps kindle over their first second.
    const kindle = Math.min(1, t);
    for (let i = 0; i < orbits.length; i++) {
      const o = orbits[i]!;
      const a1 = now * o.speed + o.phase;
      const a0 = last.current[i] ?? a1 - o.speed / 60;
      last.current[i] = a1;
      const steps = Math.min(8, Math.max(1, Math.ceil(Math.abs(a1 - a0) / 0.035)));
      for (let s = 1; s <= steps; s++) {
        const a = a0 + ((a1 - a0) * s) / steps;
        const x = Math.cos(a) * o.rx;
        const z = Math.sin(a) * o.rz;
        const y = Math.sin(a * 2 + o.phase) * (o.bob ?? 0);
        // Tilt the orbit plane about the view axis.
        const c = Math.cos(o.tilt);
        const sn = Math.sin(o.tilt);
        tmp.set(x * c - y * sn, x * sn + y * c, z).applyMatrix4(g.matrixWorld);
        P[0] = tmp.x;
        P[1] = tmp.y;
        P[2] = tmp.z;
        const head = s === steps;
        spark.color = o.color;
        spark.speed = head ? 0.02 : 0.05;
        spark.up = 0.03;
        spark.size = (head ? size : size * 0.45) * kindle;
        spark.spread = size * 0.3;
        spark.ttl = head ? 0.12 : 0.8;
        emitUiSparks(spark);
      }
    }
  });

  return <group ref={group} position={position as [number, number, number] | undefined} />;
}
