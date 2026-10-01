import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial } from "three";
import { uiNow } from "../../clock";
import { Plate } from "../../Plate";
import { useUiShow } from "../../presence";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { PixelIcon } from "./grimoire";
import type { SpriteName } from "./icons";

/** An item as the grimoire's item card (artpass `ItemCard`), standing in
 * the world: a dark plate framed in the item's rarity colour with a pool of
 * that colour behind the art, a gem in the corner, the level on a little ink
 * tab, and the name underneath — except the "art" is the item itself, a 3D
 * model (children) that stands out of the card toward you.
 *
 * The card forges in like every Plate; the screens drive the model inside
 * (the Weighing lifts it, death crumbles it). `taken` turns the card into a
 * memorial: the frame cools to iron, the name to faded ink. */

let quad: PlaneGeometry | null = null;
const unitQuad = () => (quad ??= new PlaneGeometry(1, 1));

const POOL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const POOL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
uniform float uSteps;
varying vec2 vUv;
void main() {
  // A pool of the rarity colour (the card art's radial wash), in pixels and
  // three hard bands rather than a smooth gradient.
  vec2 q = (floor(vUv * uSteps) + 0.5) / uSteps;
  float r = length((q - vec2(0.5, 0.55)) * 2.0);
  float band = r < 0.42 ? 1.0 : r < 0.68 ? 0.6 : r < 0.9 ? 0.3 : 0.0;
  float a = band * uLevel;
  // Premultiplied and sRGB-encoded on output: a^2.2 here is a fraction a
  // of the colour on screen (how the DOM grimoire's colour-mix blends).
  gl_FragColor = vec4(uColor * pow(a, 2.2), a);
  #include <colorspace_fragment>
}
`;

/** Layout of a card of art width `w` with names at `px`, centred on the
 * card: where the art and the name sit, and the plate's size. */
export function cardLayout(w: number, px: number) {
  const pad = w * 0.07;
  const art = w * 0.74;
  const nameH = measureText("Ag\nAg", px).height;
  const height = pad + art + pad * 0.6 + nameH + pad;
  const width = w + pad * 2;
  return {
    width,
    height,
    art,
    artY: height / 2 - pad - art / 2,
    nameY: -height / 2 + pad + nameH / 2,
    texel: w * 0.022,
  };
}

export function ItemCard({
  width,
  px,
  color,
  name,
  level,
  qty = 1,
  icon,
  taken = false,
  empty = false,
  glowRef,
  delay = 0,
  children,
  position,
}: {
  /** Art width, metres (the plate is a little wider). */
  width: number;
  /** Name text size (RuneText px). */
  px: number;
  /** Rarity colour: frame, pool, gem and name. */
  color: string;
  name: string;
  level: number | null;
  qty?: number;
  /** A ghost sprite in the art (an empty slot). */
  icon?: SpriteName;
  taken?: boolean;
  /** An empty slot: dark iron frame, dim name. */
  empty?: boolean;
  /** Pool brightness driven per frame (e.g. kindling); default steady. */
  glowRef?: { readonly current: number };
  delay?: number;
  children?: ReactNode;
  position?: readonly [number, number, number];
}) {
  const show = useUiShow();
  const L = cardLayout(width, px);
  const dead = taken || empty;
  const frame = dead ? "iron" : color;
  const nameColor = dead ? ink.faded : color;

  const pool = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(color) }, uLevel: { value: 0 }, uSteps: { value: 16 } },
        vertexShader: POOL_VERT,
        fragmentShader: POOL_FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    [color],
  );
  useEffect(() => () => pool.dispose(), [pool]);
  const since = useRef(uiNow());
  useEffect(() => {
    since.current = uiNow();
  }, [show]);
  const poolMesh = useRef<Mesh>(null);
  useFrame(() => {
    const t = uiNow() - since.current;
    const base = dead ? 0 : glowRef ? glowRef.current : 0.24;
    // Steps in with the plate, out with it.
    const k = show ? Math.min(1, Math.max(0, (t - delay - 0.15) / 0.3)) : Math.max(0, 1 - t / 0.3);
    pool.uniforms.uLevel!.value = (Math.floor(k * 4) / 4) * base;
    pool.uniforms.uSteps!.value = Math.max(8, Math.round(L.art / (L.texel * 1.5)));
    if (poolMesh.current) poolMesh.current.visible = pool.uniforms.uLevel!.value > 0.001;
  });

  const tab = useMemo(() => new MeshBasicMaterial({ color: ink.ink, toneMapped: false }), []);
  const tabEdge = useMemo(() => new MeshBasicMaterial({ color, toneMapped: false }), [color]);
  useEffect(
    () => () => {
      tab.dispose();
      tabEdge.dispose();
    },
    [tab, tabEdge],
  );

  const lv = level !== null ? String(level) : null;
  const lvSize = lv ? measureText(lv, px * 0.9, undefined, "label") : null;
  const tabW = lvSize ? lvSize.width + px * 4 : 0;
  const tabH = lvSize ? lvSize.height + px * 2.5 : 0;
  const artL = -width / 2;
  const artR = width / 2;
  const artT = L.artY + L.art / 2;
  const artB = L.artY - L.art / 2;

  return (
    <group position={position as [number, number, number] | undefined}>
      <Plate width={L.width} height={L.height} frame={frame} texel={L.texel} forgeTime={0.4}>
        <mesh ref={poolMesh} geometry={unitQuad()} material={pool} scale={[width, L.art, 1]} position={[0, L.artY, 0]} renderOrder={5} />
        {icon && <PixelIcon name={icon} tint="#8a8090" pixel={(L.art * 0.6) / 16} dim={0.22} delay={delay + 0.2} position={[0, L.artY, 0.001]} />}
        {!empty && (
          <PixelIcon name="gem" tint={dead ? "#4a4152" : color} pixel={L.texel * 0.9} delay={delay + 0.3} position={[artL + L.texel * 4, artT - L.texel * 4, 0.002]} />
        )}
        {lv && lvSize && (
          <group position={[artR - tabW / 2 + L.texel * 0.5, artB + tabH / 2, 0.003]}>
            <mesh geometry={unitQuad()} material={tabEdge} scale={[tabW + L.texel * 0.8, tabH + L.texel * 0.8, 1]} position={[-L.texel * 0.4, L.texel * 0.4, -0.0005]} renderOrder={6} />
            <mesh geometry={unitQuad()} material={tab} scale={[tabW, tabH, 1]} renderOrder={7} />
            <RuneText text={lv} font="label" px={px * 0.9} color={ink.parchment} glow={0} delay={delay + 0.35} depth={-0.2} position={[0, 0, 0.001]} />
          </group>
        )}
        {qty > 1 && (
          <RuneText
            text={`×${qty}`}
            font="label"
            px={px * 0.9}
            color={dead ? ink.faded : ink.parchment}
            glow={0.3}
            anchor={[1, 0]}
            delay={delay + 0.35}
            depth={-0.2}
            position={[artR - L.texel, artT - L.texel, 0.003]}
          />
        )}
        <RuneText
          text={name}
          px={px}
          maxCols={Math.max(6, Math.floor(width / (px * 4.6)))}
          color={nameColor}
          glow={0.3}
          delay={delay + 0.25}
          depth={-0.3}
          position={[0, L.nameY, 0.002]}
        />
        <group position={[0, L.artY, 0.03]}>{children}</group>
      </Plate>
    </group>
  );
}
