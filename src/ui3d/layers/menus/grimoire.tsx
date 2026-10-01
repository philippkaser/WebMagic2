import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Color, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import { uiNow } from "../../clock";
import { getFace, type FontId } from "../../font/faces";
import type { TextInput } from "../../font/layout";
import { KeyCap, keyCapWidth } from "../../KeyCap";
import { useUiShow } from "../../presence";
import { fontPixel, measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { spriteSize, spriteTexture, type SpriteName } from "./icons";
import { wrapRows } from "./menuText";
import { Delayed } from "./stage";

/** The grimoire's small furniture for the menu screens, in 3D: letter-
 * spaced caps, blackletter titles with their cast shadows, the brass
 * flourish under a title, pixel icons that burn in pixel by pixel, and the
 * key-cap legend. Everything is hard-edged and builds itself in when its
 * presence shows (useUiShow), like the rest of the in-world UI. */

let quad: PlaneGeometry | null = null;
const unitQuad = () => (quad ??= new PlaneGeometry(1, 1));

/** Letter-spaced caps — the grimoire's tiny tracking labels (`.wm-label`,
 * `.wm-tagline`). Layout has no tracking, so a space goes between letters
 * and three between words. */
export function spaced(text: string): string {
  return text
    .toUpperCase()
    .split(" ")
    .map((w) => Array.from(w).join(" "))
    .join("   ");
}

/** Wrap width in "columns" (RuneText's maxCols, in the face's average
 * advance) for a block `width` metres wide at `px` — the fonts are
 * proportional, so screens think in metres and convert here. */
export function colsFor(width: number, px: number, font: FontId = "body"): number {
  const face = getFace(font);
  return Math.max(4, Math.floor(width / (fontPixel(face, px) * face.avgAdvance)));
}

// ── Titles ───────────────────────────────────────────────────────────────────

/** A blackletter title with the grimoire's cast shadow: the words in
 * `color`, a band of `shadow` one font pixel below them, and ink below
 * that (artpass `.wm-logo`: `0 5px 0 brass-dark, 0 8px 0 ink`). Each layer
 * is its own RuneText, so the shadow burns in WITH the letters — the
 * title is cast, not stamped. `diagonal` offsets the shadow down-right
 * instead (the arrival banner's `4px 4px 0 ink`). */
export function TitleText({
  text,
  px,
  color = ink.parchment,
  shadow = ink.brassDark,
  diagonal = false,
  font = "title",
  position,
  delay = 0,
  inDuration = 1,
  stagger,
  depth = 2,
  flicker = 0.05,
  show,
}: {
  text: TextInput;
  px: number;
  color?: string;
  /** Colour of the near shadow band (null: ink only). */
  shadow?: string | null;
  diagonal?: boolean;
  font?: FontId;
  position?: readonly [number, number, number];
  delay?: number;
  inDuration?: number;
  stagger?: number;
  depth?: number;
  flicker?: number;
  show?: boolean;
}) {
  const fp = fontPixel(getFace(font), px);
  const dx = diagonal ? fp : 0;
  const common = { px, font, inDuration, stagger, delay, depth, show, glow: 0, outline: 0, sparks: false } as const;
  return (
    <group position={position as [number, number, number] | undefined}>
      <RuneText {...common} text={text} color={ink.ink} position={[dx * 1.6, -fp * 1.6, -0.003]} renderOrder={8} flicker={0} />
      {shadow && <RuneText {...common} text={text} color={shadow} position={[dx, -fp, -0.0015]} renderOrder={9} flicker={0} />}
      <RuneText {...common} text={text} color={color} flicker={flicker} renderOrder={10} sparks />
    </group>
  );
}

// ── The flourish ─────────────────────────────────────────────────────────────

const FLOURISH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uReveal;
uniform float uSteps;
varying vec2 vUv;
void main() {
  // Distance from the centre, in whole texels, so the line grows and fades
  // in steps rather than a smooth ramp.
  float x = abs(vUv.x * 2.0 - 1.0);
  float q = floor(x * uSteps) / uSteps;
  if (q > uReveal) discard;
  // Leave room for the diamond in the middle.
  if (q < 0.09) discard;
  // Brass, fading to nothing toward the tips in four bands.
  float a = floor((1.0 - q) * 4.0 + 0.6) / 4.0;
  gl_FragColor = vec4(uColor * pow(a, 2.2), a);
  #include <colorspace_fragment>
}
`;

const PLAIN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The thin brass rule with a diamond at its heart (artpass banner
 * `—— ◆ ——`), growing outward from the diamond when it shows. */
export function Flourish({
  width,
  texel,
  color = ink.brass,
  delay = 0,
  position,
}: {
  width: number;
  /** World size of one line pixel (the line is 2 texels thick). */
  texel: number;
  color?: string;
  delay?: number;
  position?: readonly [number, number, number];
}) {
  const show = useUiShow();
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(color) }, uReveal: { value: 0 }, uSteps: { value: 1 } },
        vertexShader: PLAIN_VERT,
        fragmentShader: FLOURISH_FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  const since = useRef(uiNow());
  useEffect(() => {
    since.current = uiNow();
  }, [show]);
  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    const t = uiNow() - since.current;
    const u = material.uniforms;
    u.uSteps!.value = Math.max(1, Math.round(width / 2 / texel));
    // Grows out in 0.5 s; on exit it pulls back into the diamond.
    u.uReveal!.value = show ? Math.min(1, Math.max(0, (t - delay) / 0.5)) : Math.max(0, 1 - t / 0.3);
    if (mesh.current) mesh.current.visible = u.uReveal!.value > 0;
  });
  return (
    <group position={position as [number, number, number] | undefined}>
      <mesh ref={mesh} geometry={unitQuad()} material={material} scale={[width, texel * 2, 1]} renderOrder={9} />
      <RuneText text="◆" px={texel * 1.6} color={ink.brassLight} glow={0.5} delay={delay} depth={-0.3} />
    </group>
  );
}

// ── Pixel icons ──────────────────────────────────────────────────────────────

const ICON_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uSize;
uniform float uReveal;
uniform float uSeed;
uniform float uBright;
uniform float uAlpha;
uniform vec3 uHot;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
void main() {
  vec2 pix = floor(vUv * uSize);
  vec4 c = texelFetch(uMap, ivec2(pix), 0);
  if (c.a < 0.5) discard;
  // Pixels burn in one by one in a random order; the newest are white-hot.
  float n = hash(pix);
  if (n > uReveal) discard;
  float hot = step(uReveal - 0.22, n) * step(uReveal, 0.999);
  vec3 col = mix(c.rgb * uBright, uHot, hot * 0.8);
  gl_FragColor = vec4(col * pow(uAlpha, 2.2), uAlpha);
  #include <colorspace_fragment>
}
`;

/** A pixel sprite (icons.ts) at `pixel` world units per sprite pixel. It
 * burns in pixel by pixel when shown (white-hot, cooling) and burns out
 * the same way. `dim` greys it down (an empty slot's ghost). */
export function PixelIcon({
  name,
  tint,
  pixel,
  delay = 0,
  duration = 0.45,
  dim = 1,
  position,
}: {
  name: SpriteName;
  tint: string;
  pixel: number;
  delay?: number;
  duration?: number;
  /** Brightness × alpha multiplier (1 = full). */
  dim?: number;
  position?: readonly [number, number, number];
}) {
  const show = useUiShow();
  const { w, h } = spriteSize(name);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uMap: { value: spriteTexture(name, tint) },
          uSize: { value: [w, h] },
          uReveal: { value: 0 },
          uSeed: { value: Math.random() * 10 },
          uBright: { value: 1 },
          uAlpha: { value: 1 },
          uHot: { value: new Color("#fff6d8") },
        },
        vertexShader: PLAIN_VERT,
        fragmentShader: ICON_FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    [name, tint, w, h],
  );
  useEffect(() => () => material.dispose(), [material]);
  const since = useRef(uiNow());
  const from = useRef(0);
  const reveal = useRef(0);
  useEffect(() => {
    since.current = uiNow();
    from.current = reveal.current;
  }, [show]);
  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    const t = uiNow() - since.current;
    reveal.current = show ? Math.min(1, Math.max(0, (t - delay) / duration)) : from.current * Math.max(0, 1 - t / 0.35);
    const u = material.uniforms;
    // Stepped, like the grimoire's animations: 12 reveal steps a second.
    u.uReveal!.value = Math.floor(reveal.current * 14) / 14 + (reveal.current >= 1 ? 0.001 : 0);
    u.uBright!.value = dim;
    u.uAlpha!.value = 0.25 + 0.75 * dim;
    if (mesh.current) mesh.current.visible = reveal.current > 0;
  });
  return (
    <mesh
      ref={mesh}
      geometry={unitQuad()}
      material={material}
      scale={[w * pixel, h * pixel, 1]}
      position={position as [number, number, number] | undefined}
      renderOrder={9}
    />
  );
}

// ── The key-cap legend ───────────────────────────────────────────────────────

export interface LegendEntry {
  keys: readonly string[];
  action: string;
}

/** The controls as the grimoire draws them: parchment key caps followed by
 * the action in faded ink, entries wrapped into centred rows no wider than
 * `maxWidth`. Each entry forges in a beat after the one before it. */
export function KeyLegend({
  entries,
  px,
  maxWidth,
  delay = 0,
  step = 0.06,
  color = ink.faded,
  position,
}: {
  entries: readonly LegendEntry[];
  px: number;
  maxWidth: number;
  delay?: number;
  step?: number;
  color?: string;
  position?: readonly [number, number, number];
}) {
  const layout = useMemo(() => {
    const capGap = px * 1.6;
    const textGap = px * 2.6;
    const items = entries.map((e) => {
      const caps = e.keys.map((k) => keyCapWidth(k, px));
      const capsW = caps.reduce((s, w) => s + w, 0) + capGap * (caps.length - 1);
      const textW = measureText(e.action, px).width;
      return { entry: e, caps, capsW, width: capsW + textGap + textW, textW };
    });
    const gap = px * 9;
    const rows = wrapRows(
      items.map((i) => i.width),
      maxWidth,
      gap,
    );
    const capH = measureText("W", px, undefined, "label").height + px * 6;
    const rowH = capH + px * 4;
    return { items, rows, gap, capGap, textGap, rowH };
  }, [entries, px, maxWidth]);

  const nodes: ReactNode[] = [];
  let n = 0;
  layout.rows.forEach((row, r) => {
    const rowW = row.reduce((s, i) => s + layout.items[i]!.width, 0) + layout.gap * (row.length - 1);
    let x = -rowW / 2;
    const y = -r * layout.rowH;
    for (const i of row) {
      const it = layout.items[i]!;
      let cx = x;
      const d = delay + n * step;
      it.entry.keys.forEach((k, j) => {
        const w = it.caps[j]!;
        nodes.push(
          // Each cap forges a beat after the one before it.
          <Delayed key={`${i}:${j}`} by={d + j * 0.03}>
            <KeyCap k={k} px={px} position={[cx + w / 2, y, 0]} />
          </Delayed>,
        );
        cx += w + layout.capGap;
      });
      nodes.push(
        <RuneText
          key={`${i}:t`}
          text={it.entry.action}
          px={px}
          color={color}
          glow={0.25}
          anchor={[0, 0.5]}
          position={[x + it.capsW + layout.textGap, y, 0]}
          delay={d + 0.1}
          depth={-0.3}
        />,
      );
      x += it.width + layout.gap;
      n++;
    }
  });
  return <group position={position as [number, number, number] | undefined}>{nodes}</group>;
}

/** Height of a legend of `rows` rows at `px` (for laying out below it). */
export function keyLegendRowHeight(px: number): number {
  return measureText("W", px, undefined, "label").height + px * 10;
}
