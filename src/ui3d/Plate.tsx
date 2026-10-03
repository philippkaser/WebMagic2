import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, type ReactNode } from "react";
import type { Group } from "three";
import { uiNow } from "./clock";
import { useUiShow } from "./presence";
import { slabGeometry, slabMaterial } from "./slab";
import { holoColor, type FrameKind } from "./theme";

/** A small slab — for prompts, messages, tooltips and labels: a worn piece
 * of dark slate with round corners and a bevelled edge that catches the UI
 * torch (slab.ts). No frame: its `frame` colour just warms the stone and
 * glows faintly from within it (an omen's violet, home's gold), so a slab
 * says what kind of thing it carries.
 *
 * It arrives like a thing set down in the air — swelling out of nothing
 * with a small overshoot, settling, the words writing themselves onto it —
 * and leaves by shrinking away. Big menus use Tablet.
 *
 * Children sit on the slab's face (local z = 0.002). */

export interface PlateProps {
  width: number;
  height: number;
  /** An accent: a named look (brass, arcane, iron, blood, gold, violet) or
   * a colour. Brass and iron are plain slate. */
  frame?: FrameKind | string;
  /** World size of one frame texel — sizes the slab's thickness. */
  texel: number;
  /** Ignored (kept for callers). */
  fill?: string;
  /** Ignored (kept for callers). */
  fillOpacity?: number;
  /** Seconds the arrival takes. */
  forgeTime?: number;
  children?: ReactNode;
  position?: readonly [number, number, number];
}

const PLAIN = new Set(["brass", "iron"]);

/** A back-out ease: arrives, overshoots a touch, settles. */
function backOut(t: number): number {
  const s = 1.7;
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

/** Scales its children in with a small overshoot when the ambient show
 * turns on, and away when it turns off — how every slab arrives. */
export function Pop({ time = 0.3, children }: { time?: number; children: ReactNode }) {
  const show = useUiShow();
  const group = useRef<Group>(null);
  const since = useRef(uiNow());
  const from = useRef(show ? 0 : 1);
  const k = useRef(show ? 0 : 1);
  useEffect(() => {
    since.current = uiNow();
    from.current = k.current;
  }, [show]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = (uiNow() - since.current) / Math.max(0.05, time);
    if (show) k.current = from.current + (1 - from.current) * Math.min(1, t);
    else k.current = from.current * Math.max(0, 1 - t * 1.4);
    const e = show ? backOut(Math.min(1, k.current)) : k.current * k.current;
    g.scale.set(Math.max(0.001, e), Math.max(0.001, show ? Math.min(1.05, e * 1.04) : e), Math.max(0.001, e));
    g.visible = e > 0.002;
  });
  return <group ref={group}>{children}</group>;
}

export function Plate({ width, height, frame = "brass", texel, forgeTime = 0.3, children, position }: PlateProps) {
  const accent = PLAIN.has(frame) ? null : holoColor(frame);
  const depth = Math.max(texel * 2.2, Math.min(width, height) * 0.12);
  return (
    <group position={position as [number, number, number] | undefined}>
      <Pop time={forgeTime}>
        <mesh geometry={slabGeometry(width + texel * 2, height + texel * 2, depth)} material={slabMaterial(accent)} renderOrder={3} />
      </Pop>
      <group position={[0, 0, 0.002]}>{children}</group>
    </group>
  );
}
