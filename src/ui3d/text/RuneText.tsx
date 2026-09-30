import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  Vector3,
} from "three";
import { uiNow } from "../clock";
import { getFace, type Face, type FontId } from "../font/faces";
import { layoutText, type Align, type TextInput, type TextLayout } from "../font/layout";
import { useUiShow } from "../presence";
import { useUiTextStyle } from "../style";
import { emitUiSparks } from "../UiSparks";
import { applyFace, createRuneTextMaterial, NEVER, type RuneTextMaterial } from "./runeTextMaterial";

/** Text that lives in the world: pixel-font glyphs that materialize out of
 * the dark as burning runes, settle into letters, and burn away into embers.
 *
 * Usage:
 *   <RuneText text="The floor remembers." px={0.006} color="#cfe8ff" />
 *   <RuneText text={[{ text: "E " }, { text: "Take", color: accent }]} show={near} />
 *
 * `show` drives the lifecycle: mount with show → materializes; show=false →
 * dissolves (then `onHidden` fires, so a parent can unmount it). Changing the
 * text while shown re-writes only the glyphs that changed — a ticking gold
 * counter flickers its last digit, a new prompt writes itself anew.
 *
 * Faces (`font`): "body" (Tiny5, default), "title" (Jacquard 12 blackletter),
 * "label" (Silkscreen caps), "pixel" (the hand-set fallback) — font/faces.ts.
 *
 * Size (`px`) is a seventh of the capital height in world units, whatever
 * the face — so `pxFor(distance, screenFraction)` sizes any face alike, and
 * switching a line to the title face keeps its cap height. `measureText`
 * measures a block before placing it. */

export interface RuneTextProps {
  text: TextInput;
  /** A seventh of the capital height, world units (see pxFor). */
  px?: number;
  /** Typeface (default: the ambient style's, else "body"). */
  font?: FontId;
  /** Default colour (spans can override). */
  color?: string;
  align?: Align;
  /** Wrap width in characters. */
  maxCols?: number;
  /** Which point of the block sits at the local origin, as fractions of its
   * size: [0,0] top-left, [0.5,0.5] centre (default), [1,1] bottom-right. */
  anchor?: readonly [number, number];
  /** Materialized (true, default) or dissolving/dissolved (false). */
  show?: boolean;
  /** Seconds one glyph takes to materialize / dissolve. */
  inDuration?: number;
  outDuration?: number;
  /** Seconds between the first and last glyph starting, default by length. */
  stagger?: number;
  /** Delay before materializing starts, seconds. */
  delay?: number;
  /** Halo strength (0 = none, 1 = default, 2 = blazing). */
  glow?: number;
  /** Dark outline opacity, 0..1. */
  outline?: number;
  /** How far glyphs travel in depth while (de)materializing (1 = default). */
  depth?: number;
  flicker?: number;
  opacity?: number;
  /** Brightness multiplier for highlights (hover) — unlike a colour change,
   * it doesn't re-materialize the glyphs. */
  brightness?: number;
  /** Shed embers while dissolving (default true). */
  sparks?: boolean;
  renderOrder?: number;
  /** Called once when a dissolve has fully finished. */
  onHidden?: () => void;
  /** Rendered as children of the text's group (e.g. an underline mesh). */
  children?: ReactNode;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
}

/** World size of one font pixel of `face` at size `px`. */
export function fontPixel(face: Face, px: number): number {
  return (px * 7) / face.capHeight;
}

/** Block size in world units, for layout by callers (tablets, rows). */
export function measureText(
  text: TextInput,
  px: number,
  maxCols?: number,
  font: FontId = "body",
): { width: number; height: number; lines: number } {
  const face = getFace(font);
  const l = layoutText(text, { maxCols }, face);
  const k = fontPixel(face, px);
  return { width: l.width * k, height: l.height * k, lines: l.lines };
}

let baseQuad: PlaneGeometry | null = null;
function quad(): PlaneGeometry {
  // Origin at the top-left corner, so uv (0,1) is the cell's top-left.
  return (baseQuad ??= new PlaneGeometry(1, 1).translate(0.5, -0.5, 0));
}

const tmpColor = new Color();
const tmpVec = new Vector3();

function seedOf(x: number, y: number, slot: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + slot * 3.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Build the instance attributes for a layout. Glyphs that are identical to
 * the previous layout (same slot, place and colour) keep their birth time,
 * so they don't re-materialize. */
function buildGeometry(
  layout: TextLayout,
  face: Face,
  defaultColor: string,
  prev: InstancedBufferGeometry | null,
  bornAt: number,
): InstancedBufferGeometry {
  const n = layout.glyphs.length;
  const cell = new Float32Array(n * 2);
  const slots = new Float32Array(n * 2);
  const colors = new Float32Array(n * 3);
  const meta = new Float32Array(n * 3);

  // Previous glyphs by position → (slot, colour, born) for the morph.
  const previous = new Map<string, { slot: number; r: number; g: number; b: number; born: number }>();
  if (prev) {
    const pc = prev.getAttribute("aCell") as InstancedBufferAttribute | undefined;
    const ps = prev.getAttribute("aSlots") as InstancedBufferAttribute | undefined;
    const pcol = prev.getAttribute("aColor") as InstancedBufferAttribute | undefined;
    const pm = prev.getAttribute("aMeta") as InstancedBufferAttribute | undefined;
    if (pc && ps && pcol && pm) {
      for (let i = 0; i < prev.instanceCount; i++) {
        previous.set(`${pc.getX(i)},${pc.getY(i)}`, {
          slot: ps.getX(i),
          r: pcol.getX(i),
          g: pcol.getY(i),
          b: pcol.getZ(i),
          born: pm.getZ(i),
        });
      }
    }
  }

  layout.glyphs.forEach((g, i) => {
    tmpColor.set(g.color ?? defaultColor);
    const seed = seedOf(g.x, g.y, g.slot);
    cell[i * 2] = g.x;
    cell[i * 2 + 1] = g.y;
    slots[i * 2] = g.slot;
    slots[i * 2 + 1] = face.runeBase + Math.floor(seed * face.runeCount);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
    const old = previous.get(`${g.x},${g.y}`);
    const same =
      old && old.slot === g.slot && Math.abs(old.r - tmpColor.r) + Math.abs(old.g - tmpColor.g) + Math.abs(old.b - tmpColor.b) < 1e-3;
    meta[i * 3] = g.order;
    meta[i * 3 + 1] = seed;
    meta[i * 3 + 2] = same ? old.born : bornAt;
  });

  const geometry = new InstancedBufferGeometry();
  const q = quad();
  geometry.index = q.index;
  geometry.setAttribute("position", q.getAttribute("position"));
  geometry.setAttribute("uv", q.getAttribute("uv"));
  geometry.setAttribute("aCell", new InstancedBufferAttribute(cell, 2));
  geometry.setAttribute("aSlots", new InstancedBufferAttribute(slots, 2));
  geometry.setAttribute("aColor", new InstancedBufferAttribute(colors, 3));
  geometry.setAttribute("aMeta", new InstancedBufferAttribute(meta, 3));
  geometry.instanceCount = n;
  return geometry;
}

export function RuneText({
  text,
  px: pxProp,
  font: fontProp,
  color: colorProp,
  align = "center",
  maxCols,
  anchor = [0.5, 0.5],
  show: showProp = true,
  inDuration = 0.5,
  outDuration = 0.65,
  stagger,
  delay = 0,
  glow: glowProp,
  outline: outlineProp,
  depth: depthProp,
  flicker = 0.04,
  opacity = 1,
  brightness = 1,
  sparks = true,
  renderOrder = 10,
  onHidden,
  children,
  position,
  rotation,
}: RuneTextProps) {
  const style = useUiTextStyle();
  const face = getFace(fontProp ?? style.font ?? "body");
  const px = fontPixel(face, pxProp ?? style.px ?? 0.006);
  const color = colorProp ?? style.color ?? "#e8dfc8";
  const glow = glowProp ?? style.glow ?? 1;
  const outline = outlineProp ?? style.outline ?? 0.75;
  const depth = depthProp ?? style.depth ?? 1;
  // Visible only while the enclosing tablet/presence is (presence.tsx).
  const show = useUiShow() && showProp;
  const material = useMemo<RuneTextMaterial>(() => createRuneTextMaterial(face), []);
  useLayoutEffect(() => applyFace(material, face), [material, face]);
  const mesh = useMemo(() => {
    const m = new Mesh(new InstancedBufferGeometry(), material);
    m.frustumCulled = false; // glyph quads are placed in the shader
    return m;
  }, [material]);
  const layout = useMemo(() => layoutText(text, { maxCols, align }, face), [text, maxCols, align, face]);
  const hiddenFired = useRef(!show);
  // Mounted hidden = already gone (long ago), not "dissolving now".
  const vanishAt = useRef(show ? NEVER : -NEVER);
  const onHiddenRef = useRef(onHidden);
  onHiddenRef.current = onHidden;
  const sparkClock = useRef(0);

  // Stagger defaults to the length of the text: long lines write longer, but
  // never so long that a sentence keeps the player waiting.
  const spread = stagger ?? Math.min(1.1, 0.05 + layout.glyphs.length * 0.018);

  // New text → new instances (unchanged glyphs keep their birth time).
  useLayoutEffect(() => {
    const prev = mesh.geometry as InstancedBufferGeometry;
    const now = uiNow();
    const next = buildGeometry(layout, face, color, prev.instanceCount > 0 ? prev : null, now + delay);
    mesh.geometry = next;
    prev.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, color, mesh]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );

  // show → vanish time; re-showing a dissolving block rewrites it.
  useLayoutEffect(() => {
    if (show) {
      if (vanishAt.current !== NEVER) {
        vanishAt.current = NEVER;
        const meta = mesh.geometry.getAttribute("aMeta") as InstancedBufferAttribute | undefined;
        if (meta) {
          const now = uiNow();
          for (let i = 0; i < meta.count; i++) meta.setZ(i, now);
          meta.needsUpdate = true;
        }
      }
      hiddenFired.current = false;
    } else if (vanishAt.current === NEVER) {
      vanishAt.current = uiNow();
    }
  }, [show, mesh]);

  const u = material.uniforms;
  u.uPx.value = px;
  u.uOrigin.value.set(layout.width * anchor[0], layout.height * anchor[1]);
  u.uIn.value = inDuration;
  u.uOut.value = outDuration;
  u.uStagger.value = spread;
  u.uOutStagger.value = spread * 0.5;
  u.uGlow.value = glow;
  u.uOutline.value = outline;
  u.uDepth.value = depth;
  u.uFlicker.value = flicker;
  u.uOpacity.value = opacity;
  u.uBright.value = brightness;
  mesh.renderOrder = renderOrder;

  useFrame((_, dt) => {
    const now = uiNow();
    u.uTime.value = now;
    u.uVanishAt.value = vanishAt.current;
    if (vanishAt.current === NEVER) return;
    const elapsed = now - vanishAt.current;
    const total = outDuration + spread * 0.5;
    if (elapsed > total) {
      if (!hiddenFired.current) {
        hiddenFired.current = true;
        onHiddenRef.current?.();
      }
      return;
    }
    // Shed embers from the glyphs currently burning.
    if (!sparks || layout.glyphs.length === 0) return;
    sparkClock.current += dt;
    const every = 0.03;
    while (sparkClock.current > every) {
      sparkClock.current -= every;
      const k = Math.min(1, elapsed / total);
      const g = layout.glyphs[Math.min(layout.glyphs.length - 1, Math.floor((k * 0.8 + Math.random() * 0.3) * layout.glyphs.length))]!;
      tmpVec.set(
        (g.x + face.halfGlyphW - layout.width * anchor[0]) * px,
        -(g.y + face.halfGlyphH - layout.height * anchor[1]) * px,
        0,
      );
      mesh.localToWorld(tmpVec);
      emitUiSparks({
        position: [tmpVec.x, tmpVec.y, tmpVec.z],
        color: g.color ?? color,
        count: 2,
        speed: px * 30,
        up: px * 22,
        size: px * 2.2,
        spread: px * 5,
        ttl: 0.8,
      });
    }
  });

  return (
    <group position={position as [number, number, number] | undefined} rotation={rotation as [number, number, number] | undefined}>
      <primitive object={mesh} />
      {children}
    </group>
  );
}
