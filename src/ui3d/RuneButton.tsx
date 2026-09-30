import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxGeometry, Color, Group, MeshStandardMaterial } from "three";
import { playUiHover, playUiPress } from "../audio/uiSounds";
import { layoutText, type TextInput } from "./font/layout";
import { stoneMaterial } from "./materials";
import { useUiShow } from "./presence";
import { RuneText } from "./text/RuneText";

/** A button you press with the mouse, but that is really a small stone
 * plaque set into a tablet: the pointer finding it makes it rise off the
 * stone and its rune seam kindle; pressing pushes it in with a click.
 *
 * Sized from its label unless `width` is given. Invisible (and inert) while
 * the enclosing tablet/presence isn't showing. */

export interface RuneButtonProps {
  label: TextInput;
  onPress: () => void;
  /** Accent (seam + hover glow). */
  accent?: string;
  /** Label colour. */
  color?: string;
  /** World size of a font pixel on the label. */
  px?: number;
  width?: number;
  disabled?: boolean;
  position?: readonly [number, number, number];
  /** Stagger this button's label in after others (seconds). */
  delay?: number;
}

const box = new BoxGeometry(1, 1, 1);

export function RuneButton({
  label,
  onPress,
  accent = "#46ffd0",
  color = "#e8dfc8",
  px = 0.0045,
  width,
  disabled = false,
  position,
  delay = 0,
}: RuneButtonProps) {
  const show = useUiShow();
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const group = useRef<Group>(null);
  const lift = useRef(0);
  const glow = useRef(0);
  const layout = useMemo(() => layoutText(label), [label]);
  const w = width ?? layout.width * px + px * 16;
  const h = layout.height * px + px * 10;
  const seam = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#050407",
        emissive: new Color(accent),
        emissiveIntensity: 0.4,
        toneMapped: false,
        roughness: 0.4,
      }),
    [accent],
  );
  useEffect(() => () => seam.dispose(), [seam]);

  const active = show && !disabled;
  useEffect(() => {
    if (!active) {
      setHover(false);
      setDown(false);
    }
  }, [active]);
  useEffect(() => {
    if (!hover) return;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 14);
    const targetLift = !show ? -0.02 : down ? -0.004 : hover ? 0.012 : 0.004;
    lift.current += (targetLift - lift.current) * k;
    glow.current += ((hover ? 2.6 : disabled ? 0.1 : 0.5) - glow.current) * k;
    g.position.z = lift.current;
    g.scale.setScalar(show ? 1 : Math.max(0.001, 1 + lift.current * 20));
    seam.emissiveIntensity = glow.current;
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!active) return;
    setHover(true);
    playUiHover();
  };

  return (
    <group position={position as [number, number, number] | undefined}>
      <group ref={group}>
        {/* The seam: a slightly larger dark plate whose emissive rim shows
            around the plaque — the glow lives in the gap, like light
            through a crack. */}
        <mesh geometry={box} material={seam} scale={[w + px * 3, h + px * 3, 0.01]} position={[0, 0, -0.006]} />
        <mesh
          geometry={box}
          material={stoneMaterial("#4a4452")}
          scale={[w, h, 0.02]}
          position={[0, 0, 0]}
          onPointerOver={over}
          onPointerOut={() => {
            setHover(false);
            setDown(false);
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (!active) return;
            setDown(true);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            if (!active || !down) return;
            setDown(false);
            playUiPress();
            onPress();
          }}
        />
        <RuneText
          text={label}
          px={px}
          color={disabled ? "#6a6470" : color}
          brightness={hover ? 1.45 : 1}
          glow={hover ? 1.6 : 0.7}
          position={[0, 0, 0.0115]}
          delay={delay}
          depth={-0.3}
        />
      </group>
    </group>
  );
}
