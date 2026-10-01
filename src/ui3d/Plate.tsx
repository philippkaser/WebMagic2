import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { MeshBasicMaterial, PlaneGeometry } from "three";
import { uiNow } from "./clock";
import { PixelFrame } from "./PixelFrame";
import { useUiShow } from "./presence";
import { ink, type FrameKind } from "./theme";

/** A small framed panel — the grimoire's `.wm-panel` as a thin physical
 * plate: a dark soot fill with a hard drop shadow inside a pixel frame
 * that forges itself when the plate appears and fades when it goes. For
 * prompts, messages, tooltips and labels; big menus use Tablet.
 *
 * Children sit on the plate's face (local z = 0.003). */

let quad: PlaneGeometry | null = null;
const geo = () => (quad ??= new PlaneGeometry(1, 1));

export interface PlateProps {
  width: number;
  height: number;
  frame?: FrameKind | string;
  /** World size of one frame texel. */
  texel: number;
  fill?: string;
  fillOpacity?: number;
  /** Seconds the frame takes to forge. */
  forgeTime?: number;
  children?: ReactNode;
  position?: readonly [number, number, number];
}

export function Plate({
  width,
  height,
  frame = "brass",
  texel,
  fill = "#0c0810",
  fillOpacity = 0.86,
  forgeTime = 0.35,
  children,
  position,
}: PlateProps) {
  const show = useUiShow();
  const since = useRef(uiNow());
  const forge = useRef(show ? 0 : 1);
  const fade = useRef(show ? 1 : 0);
  const fillMat = useMemo(
    () => new MeshBasicMaterial({ color: fill, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    [fill],
  );
  const shadowMat = useMemo(
    () => new MeshBasicMaterial({ color: ink.ink, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    [],
  );
  useEffect(
    () => () => {
      fillMat.dispose();
      shadowMat.dispose();
    },
    [fillMat, shadowMat],
  );
  useEffect(() => {
    since.current = uiNow();
  }, [show]);

  useFrame(() => {
    const t = uiNow() - since.current;
    if (show) {
      forge.current = Math.min(1, t / forgeTime);
      fade.current = 1;
    } else {
      fade.current = Math.max(0, 1 - t / 0.35);
    }
    // Stepped fill fade (4 steps) — the grimoire animates in steps.
    const f = Math.round(Math.min(1, show ? t / (forgeTime * 0.6) : fade.current) * 4) / 4;
    fillMat.opacity = fillOpacity * f;
    shadowMat.opacity = 0.55 * f;
  });

  const outerW = width + texel * 2;
  const outerH = height + texel * 2;
  return (
    <group position={position as [number, number, number] | undefined}>
      <mesh geometry={geo()} material={shadowMat} scale={[outerW, outerH, 1]} position={[texel * 3, -texel * 3, -0.002]} renderOrder={3} />
      <mesh geometry={geo()} material={fillMat} scale={[outerW - texel * 2, outerH - texel * 2, 1]} renderOrder={4} />
      <PixelFrame width={outerW} height={outerH} frame={frame} texel={texel} progressRef={forge} fadeRef={fade} position={[0, 0, 0.001]} />
      <group position={[0, 0, 0.003]}>{children}</group>
    </group>
  );
}
