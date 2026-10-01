import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxGeometry, Color, Group, MeshBasicMaterial } from "three";
import { playUiHover, playUiPress } from "../audio/uiSounds";
import type { TextInput } from "./font/layout";
import { PixelFrame } from "./PixelFrame";
import { ink, type FrameKind } from "./theme";
import { useUiShow } from "./presence";
import { measureText, RuneText } from "./text/RuneText";

/** A button you press with the mouse, but that is really a small framed
 * plate set onto a tablet — the grimoire's button (after artpass): a dark
 * fill in a pixel frame with a hard drop shadow, "✦ label ✦". The pointer
 * finding it lifts it and warms its fill; pressing steps it down onto its
 * shadow with a click.
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
const tmpHover = new Color();

export type ButtonVariant = "arcane" | "ghost" | "danger" | "gold" | (string & {});

interface ButtonLook {
  frame: FrameKind | string;
  fill: string;
  hover: string;
  /** Colour of the ✦ marks either side of the label; null = plain label
   * (the grimoire's ghost buttons carry no marks). */
  glyph: string | null;
}

/** The grimoire's four buttons (after artpass's .wm-btn variants). */
const LOOKS: Record<string, ButtonLook> = {
  arcane: { frame: "arcane", fill: "#0a1e1c", hover: "#1a4840", glyph: ink.arcaneDim },
  ghost: { frame: "iron", fill: "#0e0a12", hover: "#282030", glyph: null },
  danger: { frame: "blood", fill: "#280808", hover: "#5a1212", glyph: "#ff6a5a" },
  gold: { frame: "gold", fill: "#281c06", hover: "#50380a", glyph: ink.gold },
};

function buttonLook(v: string | undefined): ButtonLook {
  if (!v || v === ink.arcane) return LOOKS.arcane!;
  return LOOKS[v] ?? { frame: v, fill: "#0e0a12", hover: "#262030", glyph: v };
}

let shadow: MeshBasicMaterial | null = null;
function shadowMaterial(): MeshBasicMaterial {
  return (shadow ??= new MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.55, depthWrite: false }));
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
  const fill = useMemo(() => new MeshBasicMaterial({ color: look.fill, toneMapped: false }), [look.fill]);
  useEffect(() => () => fill.dispose(), [fill]);
  const frameTexel = px * 1.35;

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
    glow.current += ((hover ? 1 : 0) - glow.current) * k;
    g.position.z = lift.current;
    // Pressed, the plate steps down-right onto its shadow (the DOM
    // grimoire's 2 px press), in whole steps, not a slide.
    g.position.x = down ? frameTexel * 1.5 : 0;
    g.position.y = down ? -frameTexel * 1.5 : 0;
    // Hidden, the plaque sinks and shrinks to nothing (lift → −0.02 m).
    const s = show ? 1 : Math.max(0.001, 1 + lift.current * 50);
    g.scale.setScalar(s);
    g.visible = s > 0.002;
    fill.color.set(look.fill).lerp(tmpHover.set(look.hover), glow.current);
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
        {/* Drop shadow: the plate's hard 3-texel offset shadow. */}
        <mesh geometry={box} material={shadowMaterial()} scale={[w + frameTexel * 8, h + frameTexel * 8, 0.004]} position={[frameTexel * 3, -frameTexel * 3, -0.008]} />
        <PixelFrame width={w + frameTexel * 8} height={h + frameTexel * 8} frame={look.frame} texel={frameTexel} position={[0, 0, 0.0075]} renderOrder={7} />
        <mesh
          geometry={box}
          material={fill}
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
          position={[0, 0, 0.009]}
          delay={delay}
          depth={-0.3}
        />
      </group>
    </group>
  );
}
