import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { BoxGeometry, Color, CylinderGeometry, Group, MeshStandardMaterial, TorusGeometry } from "three";
import { uiNow } from "../../clock";
import { stoneMaterial } from "../../materials";
import { useUiShow } from "../../presence";
import { backOut, smooth01 } from "./stage";

/** A small stone pedestal that rises out of the dark to hold one thing up
 * to be judged — the Weighing's scales. Its top carries a rune ring that
 * kindles when the thing on it is read (`kindleAt`).
 *
 * `children` sit on the top face and ride the pedestal as it rises. The
 * thing itself can `lift` off the top once kindled: it floats up and bobs,
 * held by the light. */

const shaft = new CylinderGeometry(0.42, 0.5, 1, 8);
const slab = new BoxGeometry(1, 1, 1);
const ring = new TorusGeometry(1, 0.08, 6, 32);

export function Pedestal({
  size,
  color,
  delay = 0,
  kindleAt,
  lift = 0,
  children,
  position,
}: {
  /** Width of the top slab, metres (the pedestal scales from it). */
  size: number;
  /** Rune ring colour. */
  color: string;
  /** Seconds after showing that it starts to rise. */
  delay?: number;
  /** Seconds after showing that the ring kindles (null = stays dark). */
  kindleAt?: number | null;
  /** How far the held thing floats up once kindled, metres. */
  lift?: number;
  children?: ReactNode;
  position?: readonly [number, number, number];
}) {
  const show = useUiShow();
  const body = useRef<Group>(null);
  const held = useRef<Group>(null);
  const since = useRef(uiNow());
  const exitFrom = useRef(0);
  const risen = useRef(0);
  useEffect(() => {
    since.current = uiNow();
    exitFrom.current = risen.current;
  }, [show]);
  const runeMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#0c0a12",
        emissive: new Color(color),
        emissiveIntensity: 0.15,
        roughness: 0.3,
        toneMapped: false,
      }),
    [color],
  );
  useEffect(() => () => runeMat.dispose(), [runeMat]);
  const phase = useMemo(() => Math.random() * 6, []);

  const h = size * 0.95;
  useFrame(() => {
    const t = uiNow() - since.current;
    if (show) risen.current = backOut((t - delay) / 0.6, 1.2);
    else risen.current = exitFrom.current * (1 - smooth01(t / 0.55));
    const b = body.current;
    if (b) {
      const r = Math.max(0, risen.current);
      b.position.y = (r - 1) * size * 2.2;
      b.scale.setScalar(Math.max(0.0001, Math.min(1, r * 1.4)));
      b.visible = r > 0.001;
    }
    const kindled = show && kindleAt != null ? smooth01((t - kindleAt) / 0.5) : 0;
    const now = uiNow();
    runeMat.emissiveIntensity = 0.15 + kindled * (2.2 + Math.sin(now * 3 + phase) * 0.5);
    const hd = held.current;
    if (hd) hd.position.y = h / 2 + size * 0.02 + kindled * (lift + Math.sin(now * 1.6 + phase) * size * 0.06);
  });

  return (
    <group position={position as [number, number, number] | undefined}>
      <group ref={body} visible={false}>
        <mesh geometry={shaft} material={stoneMaterial("#5a5466")} scale={[size * 0.4, h * 0.82, size * 0.4]} position={[0, -h * 0.04, 0]} />
        <mesh geometry={slab} material={stoneMaterial("#625b6e")} scale={[size, h * 0.1, size * 0.8]} position={[0, h / 2 - h * 0.05, 0]} />
        <mesh geometry={slab} material={stoneMaterial("#5a5466")} scale={[size * 0.7, h * 0.07, size * 0.6]} position={[0, h / 2 - h * 0.135, 0]} />
        <mesh geometry={slab} material={stoneMaterial("#4b4556")} scale={[size * 0.78, h * 0.12, size * 0.64]} position={[0, -h / 2 + h * 0.02, 0]} />
        <mesh geometry={ring} material={runeMat} scale={[size * 0.36, size * 0.36, size * 0.36]} rotation={[Math.PI / 2, 0, 0]} position={[0, h / 2 + size * 0.005, 0]} />
        <group ref={held}>{children}</group>
      </group>
    </group>
  );
}
