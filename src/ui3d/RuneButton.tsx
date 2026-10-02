import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxGeometry, Group, MeshBasicMaterial } from "three";
import { playUiHover, playUiPress } from "../audio/uiSounds";
import type { TextInput } from "./font/layout";
import { slabGeometry, slabMaterial } from "./slab";
import { holoColor, ink, type FrameKind } from "./theme";
import { useUiShow } from "./presence";
import { measureText, RuneText } from "./text/RuneText";

/** A button you press with the mouse — a small rounded slab of stone set
 * onto a menu, "✦ label ✦" written on it, its colour glowing faintly from
 * within the stone (arcane for the way onward, gold, blood; plain slate for
 * a secondary one). The pointer finding it lifts it toward you and the
 * glow swells; pressing pushes it in with a flash.
 *
 * Sized from its label unless `width` is given. Invisible (and inert) while
 * the enclosing tablet/presence isn't showing. */

export interface RuneButtonProps {
  label: TextInput;
  onPress: () => void;
  /** Look: "arcane" (default: the way onward), "ghost" (secondary),
   * "danger", "gold" — or any accent colour for the frame. */
  variant?: ButtonVariant;
  /** Older name for a frame colour; `variant` wins. */
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

export type ButtonVariant = "arcane" | "ghost" | "danger" | "gold" | (string & {});

interface ButtonLook {
  frame: FrameKind | string;
  /** Colour of the ✦ marks either side of the label; null = plain label
   * (the grimoire's ghost buttons carry no marks). */
  glyph: string | null;
}

/** The grimoire's four buttons (after artpass's .wm-btn variants). */
const LOOKS: Record<string, ButtonLook> = {
  arcane: { frame: "arcane", glyph: ink.arcane },
  ghost: { frame: "iron", glyph: null },
  danger: { frame: "blood", glyph: "#ff6a5a" },
  gold: { frame: "gold", glyph: ink.gold },
};

function buttonLook(v: string | undefined): ButtonLook {
  if (!v || v === ink.arcane) return LOOKS.arcane!;
  return LOOKS[v] ?? { frame: v, glyph: v };
}

/** The hit area: invisible, but it takes the pointer. */
let hitMat: MeshBasicMaterial | null = null;
function hitMaterial(): MeshBasicMaterial {
  return (hitMat ??= new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
}

export function RuneButton({
  label,
  onPress,
  accent,
  variant,
  color = ink.parchment,
  px = 0.0045,
  width,
  disabled = false,
  position,
  delay = 0,
}: RuneButtonProps) {
  const show = useUiShow();
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  // The press is judged from a ref: a fast click (or a touch tap) can
  // deliver pointerup before React re-renders from pointerdown, and the
  // handler would still see `down === false`.
  const downRef = useRef(false);
  const group = useRef<Group>(null);
  // Mounted hidden = already sunk away (not "sinking now").
  const lift = useRef(show ? 0 : -0.02);
  const glow = useRef(0);
  const look = buttonLook(variant ?? accent);
  const decorated = useMemo<TextInput>(() => {
    const body = typeof label === "string" ? [{ text: label }] : [...label];
    return look.glyph
      ? [{ text: "✦ ", color: look.glyph }, ...body, { text: " ✦", color: look.glyph }]
      : body;
  }, [label, look.glyph]);
  const size = useMemo(() => measureText(decorated, px), [decorated, px]);
  const w = width ?? size.width + px * 16;
  const h = size.height + px * 10;
  const frameTexel = px * 1.35;
  const flash = useRef(0);
  const glowTint = look.frame === "iron" ? null : holoColor(look.frame);
  const stone = useMemo(() => {
    const m = slabMaterial(glowTint).clone();
    if (!glowTint) m.emissive.set(ink.parchmentDim);
    return m;
  }, [glowTint]);
  useEffect(() => () => stone.dispose(), [stone]);

  const active = show && !disabled;
  useEffect(() => {
    if (!active) {
      setHover(false);
      setDown(false);
      downRef.current = false;
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
    flash.current = Math.max(0, flash.current - dt * 4);
    glow.current += ((hover ? 1 : 0) - glow.current) * k;
    glow.current = Math.max(glow.current, flash.current * 2);
    g.position.z = lift.current;
    // Hidden, the pane sinks and shrinks to nothing (lift → −0.02 m).
    const s = show ? (down ? 0.97 : 1) : Math.max(0.001, 1 + lift.current * 50);
    g.scale.setScalar(s);
    g.visible = s > 0.002;
    stone.emissiveIntensity = (glowTint ? 0.035 : 0.0) + glow.current * (glowTint ? 0.14 : 0.08);
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
        <mesh geometry={slabGeometry(w + frameTexel * 8, h + frameTexel * 8, frameTexel * 5)} material={stone} renderOrder={5} />
        <mesh
          geometry={box}
          material={hitMaterial()}
          scale={[w + frameTexel * 6, h + frameTexel * 6, 0.012]}
          position={[0, 0, 0]}
          onPointerOver={over}
          onPointerOut={() => {
            setHover(false);
            setDown(false);
            downRef.current = false;
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (!active) return;
            downRef.current = true;
            setDown(true);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            if (!active || !downRef.current) return;
            downRef.current = false;
            setDown(false);
            flash.current = 1;
            playUiPress();
            onPress();
          }}
        />
        <RuneText
          text={decorated}
          px={px}
          color={disabled ? ink.faded : color}
          brightness={hover ? 1.35 : 1}
          glow={hover ? 1.2 : 0.5}
          position={[0, 0, 0.004]}
          delay={delay}
          depth={-0.3}
        />
      </group>
    </group>
  );
}
