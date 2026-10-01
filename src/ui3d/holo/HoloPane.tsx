import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Group, PlaneGeometry, Vector3 } from "three";
import { playHoloCast, playHoloCollapse } from "../../audio/uiSounds";
import { uiNow } from "../clock";
import { UiShow, useUiShow } from "../presence";
import { UiTextStyleProvider } from "../style";
import { emitUiSparks } from "../UiSparks";
import { makeHoloMaterial } from "./holoMaterial";
import { Projector } from "./Projector";

/** A cast pane: the surface every menu, prompt and message is written on —
 * not a slab or a framed box, but a plane of light the wizard projects into
 * the air (holoMaterial.ts for its look).
 *
 * It is CAST, in beats: (with a projector) a sigil burns itself onto the
 * floor and a beam rises from it; a bright line grows out from the middle
 * of the pane's lower edge; the line sweeps upward and the pane tunes in
 * behind it, rows slipping sideways until it holds; then the words write
 * themselves. Closing runs it back: the words burn off, the light sweeps
 * down into its lower edge, the line shrinks to a spark and the beam sinks
 * into the sigil. It floats, breathes, leans toward the pointer and
 * flickers now and then, like any spell that has to be held.
 *
 * Visibility comes from the enclosing `<UiPresence>` like every toolkit
 * piece. Children sit on the pane (local z = 0.002, origin at its centre)
 * and appear once it has tuned in. */

/** Seconds a closing pane needs before it may unmount. */
export const HOLO_EXIT = 0.75;

export interface HoloPaneProps {
  width: number;
  height: number;
  /** The light's colour. */
  color: string;
  /** Size of one holo pixel in CSS pixels on screen (default 2.2). */
  cellPx?: number;
  /** Rise from a sigil on the floor (menus). */
  projector?: boolean;
  /** How dark the haze behind the light is, 0…1. */
  smoke?: number;
  /** Fill brightness (buttons and keys are brighter). */
  fill?: number;
  /** Corner brackets and the dashed inner border. */
  border?: boolean;
  /** Idle float. */
  float?: boolean;
  /** Lean toward the pointer (menus you click on). */
  tilt?: boolean;
  /** Cast speed, ×1 (small plates cast faster). */
  speed?: number;
  /** No sound (many small panes at once). */
  quiet?: boolean;
  seed?: number;
  /** Hover glow, 0…1 (buttons drive it). */
  hoverRef?: React.MutableRefObject<number>;
  renderOrder?: number;
  children?: ReactNode;
}

let quad: PlaneGeometry | null = null;
const plane = () => (quad ??= new PlaneGeometry(1, 1));

/** Cast beats, seconds at speed 1. */
const BEATS = { line: 0.12, lineTime: 0.18, sweep: 0.26, sweepTime: 0.36, content: 0.5, close: 0.32 };

export function HoloPane({
  width,
  height,
  color,
  cellPx = 2.2,
  projector = false,
  smoke = 1,
  fill = 1,
  border = true,
  float = true,
  tilt = false,
  speed = 1,
  quiet = false,
  seed = 1,
  hoverRef,
  renderOrder = 3,
  children,
}: HoloPaneProps) {
  const open = useUiShow();
  const light = useMemo(() => makeHoloMaterial(color, "light"), [color]);
  const haze = useMemo(() => makeHoloMaterial(color, "smoke"), [color]);
  useEffect(
    () => () => {
      light.dispose();
      haze.dispose();
    },
    [light, haze],
  );
  const holoCell = useRef(0.004);
  const size = useThree((s) => s.size);
  const group = useRef<Group>(null);
  const pane = useRef<Group>(null);
  const tOpen = useRef(uiNow());
  const tClose = useRef<number | null>(open ? null : uiNow() - 10);
  const [contentShown, setContentShown] = useState(false);
  const pointer = useThree((s) => s.pointer);
  const lean = useRef({ x: 0, y: 0 });
  const castP = useRef(open ? 0 : 1);
  const castA = useRef(open ? 1 : 0);
  const wasOpen = useRef(open);
  const k = 1 / Math.max(0.2, speed);

  useEffect(() => {
    if (open) {
      tOpen.current = uiNow();
      tClose.current = null;
      if (!quiet) playHoloCast();
    } else if (wasOpen.current) {
      tClose.current = uiNow();
      setContentShown(false);
      if (!quiet) playHoloCollapse();
    }
    wasOpen.current = open;
  }, [open, quiet]);

  useFrame(({ camera }, dt) => {
    const now = uiNow();
    const g = group.current;
    // Holo pixels are a fixed size ON SCREEN, wherever the pane hangs.
    if (g) {
      g.getWorldPosition(tmp);
      const fov = (camera as { fov?: number }).fov ?? 78;
      const perPx = (2 * tmp.distanceTo(camera.position) * Math.tan((fov * Math.PI) / 360)) / Math.max(1, size.height);
      holoCell.current = perPx * cellPx;
    }
    if (g) {
      g.position.y = float ? Math.sin(now * 1.1 + seed) * 0.005 : 0;
      const e = 1 - Math.exp(-dt * 5);
      const tx = tilt && open ? -pointer.y * 0.06 : 0;
      const ty = tilt && open ? pointer.x * 0.09 : 0;
      lean.current.x += (tx - lean.current.x) * e;
      lean.current.y += (ty - lean.current.y) * e;
      g.rotation.set(lean.current.x + (float ? Math.sin(now * 0.8 + seed) * 0.008 : 0), lean.current.y, 0);
    }
    const closing = tClose.current !== null;
    const t = (closing ? now - tClose.current! : now - tOpen.current) / k;
    let line: number;
    let reveal: number;
    let alpha = 1;
    let glitch = 0;
    if (!closing) {
      line = clamp01((t - BEATS.line) / BEATS.lineTime);
      reveal = easeOut(clamp01((t - BEATS.sweep) / BEATS.sweepTime));
      glitch = reveal > 0 && reveal < 1 ? 1 : t < BEATS.sweep + BEATS.sweepTime + 0.25 ? 0.4 : 0;
      castP.current = clamp01(t / (BEATS.sweep + BEATS.sweepTime));
      castA.current = 1;
      if (!contentShown && t >= BEATS.content) setContentShown(true);
    } else {
      reveal = 1 - easeOut(clamp01(t / BEATS.close));
      line = 1 - clamp01((t - BEATS.close) / 0.14);
      glitch = 0.8;
      alpha = 1 - clamp01((t - BEATS.close - 0.1) / 0.2);
      castA.current = alpha;
      // The spark it collapses into.
      if (g && line < 1 && line > 0 && Math.random() < 0.5) {
        const p = g.localToWorld(tmp.set(0, -height / 2, 0));
        emitUiSparks({ position: [p.x, p.y, p.z], color, count: 2, speed: 0.15, size: holoCell.current * 2.5, ttl: 0.4 });
      }
    }
    const hover = hoverRef?.current ?? 0;
    for (const m of [light, haze]) {
      const u = m.uniforms;
      u.uSize.value.set(width, height);
      u.uCell.value = holoCell.current;
      u.uReveal.value = reveal;
      u.uLine.value = line;
      u.uAlpha.value = alpha;
      u.uTime.value = now;
      u.uSeed.value = seed * 7.31;
      u.uGlitch.value = glitch;
      u.uHover.value = hover;
      u.uFill.value = fill;
      u.uBorder.value = border ? 1 : 0;
    }
    haze.uniforms.uAlpha.value = alpha * smoke;
  });

  return (
    <group ref={group}>
      <group ref={pane}>
        <mesh geometry={plane()} material={haze} scale={[width, height, 1]} position={[0, 0, -0.002]} renderOrder={renderOrder} />
        <mesh geometry={plane()} material={light} scale={[width, height, 1]} renderOrder={renderOrder + 1} />
      </group>
      {projector && <Projector paneRef={pane} width={width} height={height} color={color} progress={castP} alpha={castA} />}
      <UiTextStyleProvider value={{ depth: -0.3 }}>
        <group position={[0, 0, 0.002]}>
          <UiShow show={contentShown && open}>{children}</UiShow>
        </group>
      </UiTextStyleProvider>
    </group>
  );
}

const tmp = new Vector3();

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
function easeOut(x: number): number {
  return 1 - (1 - x) * (1 - x);
}
