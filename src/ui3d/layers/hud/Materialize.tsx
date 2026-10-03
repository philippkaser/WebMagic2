import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Group, Mesh, Vector3 } from "three";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";
import { emitUiSparks } from "../../UiSparks";
import { glowQuad, makeGlowMaterial } from "./glow";

/** The 3D counterpart of RuneText's materialize: a solid object (flask, coin
 * heap, belt item) doesn't fade in, it ARRIVES — flying in out of the dark
 * behind its place, tumbling, landing with a little overshoot and a flare of
 * light and embers. Leaving, it shrinks away spinning and burns off into
 * embers.
 *
 * Visibility is the enclosing UiShow AND `show`, so a hidden HUD takes its
 * objects with it. Mounted hidden = already gone. */

export interface MaterializeProps {
  show?: boolean;
  /** Seconds before the entrance starts. */
  delay?: number;
  inDuration?: number;
  outDuration?: number;
  /** Local offset it flies in from, m. */
  from?: readonly [number, number, number];
  /** Tumble it arrives with, radians. */
  spin?: number;
  /** Flare and ember colour. */
  color?: string;
  /** Rough size of the object, m — scales the flare and the embers. */
  size?: number;
  position?: readonly [number, number, number];
  /** Called once when the exit has fully played. */
  onHidden?: () => void;
  children: ReactNode;
}

/** Far future / far past: "not scheduled" without branching. */
const NEVER = 1e7;
const tmp = new Vector3();

function backOut(t: number): number {
  const s = 1.6;
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

export function Materialize({
  show: showProp = true,
  delay = 0,
  inDuration = 0.6,
  outDuration = 0.55,
  from = [0, -0.02, -0.25],
  spin = 2.2,
  color = "#ffd9a0",
  size = 0.05,
  position,
  onHidden,
  children,
}: MaterializeProps) {
  const show = useUiShow() && showProp;
  const outer = useRef<Group>(null);
  const body = useRef<Group>(null);
  const flare = useRef<Mesh>(null);
  const flareMat = useMemo(() => makeGlowMaterial(color, 0, 0), [color]);
  useEffect(() => () => flareMat.dispose(), [flareMat]);
  const clock = useRef({ inAt: show ? uiNow() + delay : NEVER, outAt: show ? NEVER : -NEVER, landed: false, done: !show });
  const onHiddenRef = useRef(onHidden);
  onHiddenRef.current = onHidden;
  const sparkClock = useRef(0);

  useLayoutEffect(() => {
    const c = clock.current;
    const now = uiNow();
    if (show) {
      if (c.outAt !== NEVER || c.inAt === NEVER) {
        c.inAt = now + delay;
        c.landed = false;
      }
      c.outAt = NEVER;
      c.done = false;
    } else if (c.outAt === NEVER) {
      c.outAt = now;
    }
    // Only a change of `show` re-times the entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useFrame((_, dt) => {
    const g = body.current;
    const o = outer.current;
    const f = flare.current;
    if (!g || !o || !f) return;
    const c = clock.current;
    const now = uiNow();

    if (c.outAt !== NEVER) {
      const q = (now - c.outAt) / outDuration;
      if (q >= 1 || c.outAt < 0) {
        o.visible = false;
        if (!c.done) {
          c.done = true;
          onHiddenRef.current?.();
        }
        return;
      }
      o.visible = true;
      const e = q * q;
      g.position.set(0, size * 0.6 * e, -size * 2 * e);
      g.rotation.set(e * 0.6, e * spin * 1.4, -e * 0.5);
      g.scale.setScalar(Math.max(0.001, 1 - e));
      flareMat.uniforms.uIntensity.value = Math.sin(Math.min(1, q * 1.4) * Math.PI) * 0.5;
      f.scale.setScalar(size * 3.2);
      // Burning off: embers from the shrinking body.
      sparkClock.current += dt;
      if (q < 0.85 && sparkClock.current > 0.04) {
        sparkClock.current = 0;
        g.getWorldPosition(tmp);
        emitUiSparks({ position: [tmp.x, tmp.y, tmp.z], color, count: 2, speed: size * 1.6, up: size * 1.2, size: size * 0.09, spread: size * 0.9, ttl: 0.7 });
      }
      return;
    }

    const p = Math.min(1, Math.max(0, (now - c.inAt) / inDuration));
    if (p <= 0) {
      o.visible = false;
      return;
    }
    o.visible = true;
    const e = backOut(p);
    const eo = 1 - (1 - p) ** 3;
    g.position.set(from[0] * (1 - e), from[1] * (1 - e), from[2] * (1 - e));
    g.rotation.set((1 - eo) * spin * 0.35, (1 - eo) * spin, (1 - eo) * spin * -0.2);
    g.scale.setScalar(Math.max(0.001, 0.25 + 0.75 * e));
    // The landing flare peaks as it arrives, then settles to nothing.
    const flash = Math.exp(-(((p - 0.7) / 0.18) ** 2));
    flareMat.uniforms.uIntensity.value = flash * 0.9;
    flareMat.uniforms.uCore.value = flash * 0.6;
    f.scale.setScalar(size * (2.2 + flash * 1.8));
    if (!c.landed && p > 0.62) {
      c.landed = true;
      g.getWorldPosition(tmp);
      emitUiSparks({ position: [tmp.x, tmp.y, tmp.z], color, count: 10, speed: size * 3.2, up: size * 1.5, size: size * 0.1, spread: size * 0.8, ttl: 0.7 });
    }
  });

  return (
    <group ref={outer} position={position as [number, number, number] | undefined} visible={false}>
      <mesh ref={flare} geometry={glowQuad()} material={flareMat} renderOrder={3} />
      <group ref={body}>{children}</group>
    </group>
  );
}
