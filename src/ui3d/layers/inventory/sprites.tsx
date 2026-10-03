import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { DataTexture, Group, MeshBasicMaterial, NearestFilter, PlaneGeometry, RGBAFormat, SRGBColorSpace, UnsignedByteType } from "three";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";
import { paintSprite, spriteSize, type SpriteName } from "./spriteArt";

export { spriteSize, type SpriteName } from "./spriteArt";

/** The grimoire's little pixel sprites in 3D — the artpass DOM chrome's
 * icons (ui/pixelArt.ts: the slot silhouettes, the rarity gem, the
 * run-loot hourglass), plus a coin and a flask painted the same way.
 *
 * Each sprite is a few rows of characters, one per pixel, painted into a
 * tiny nearest-filtered texture per tint and drawn on a single quad with an
 * alpha test: hard edges at any size, no anti-aliasing, the same zero-asset
 * trick as the frames. */

const materials = new Map<string, MeshBasicMaterial>();

/** The shared material for a sprite in a tint. Alpha-tested, so always
 * opaque: dim a sprite by its tint, not by opacity. It writes depth like
 * any opaque thing — otherwise a translucent plate behind it, drawn later,
 * would paint over it. */
export function spriteMaterial(name: SpriteName, tint: string): MeshBasicMaterial {
  const key = `${name}|${tint}`;
  let m = materials.get(key);
  if (!m) {
    const { w, h } = spriteSize(name);
    const t = new DataTexture(paintSprite(name, tint), w, h, RGBAFormat, UnsignedByteType);
    t.magFilter = t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    m = new MeshBasicMaterial({ map: t, alphaTest: 0.5, toneMapped: false });
    materials.set(key, m);
  }
  return m;
}

let quad: PlaneGeometry | null = null;
const unitQuad = () => (quad ??= new PlaneGeometry(1, 1));

export interface PixelSpriteProps {
  name: SpriteName;
  tint: string;
  /** World size of one sprite pixel. */
  px: number;
  position?: readonly [number, number, number];
  /** Which point of the sprite sits at `position` ([0.5,0.5] = centre). */
  anchor?: readonly [number, number];
  /** Seconds after the ambient show before it pops in. */
  delay?: number;
  /** Blink in two hard steps (the artpass `wm-throb … steps(2)`). */
  throb?: boolean;
  renderOrder?: number;
}

/** A sprite that pops in (two stepped scales, no tween) after `delay` once
 * its tablet shows, and blinks out with it. */
export function PixelSprite({
  name,
  tint,
  px,
  position = [0, 0, 0],
  anchor = [0.5, 0.5],
  delay = 0,
  throb = false,
  renderOrder = 8,
}: PixelSpriteProps) {
  const show = useUiShow();
  const { w, h } = spriteSize(name);
  const group = useRef<Group>(null);
  const shownAt = useRef(uiNow());
  useEffect(() => {
    if (show) shownAt.current = uiNow();
  }, [show]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = uiNow() - shownAt.current - delay;
    const on = show && t >= 0;
    const blink = throb && Math.floor(uiNow() / 0.8) % 2 === 1;
    g.visible = on && !blink;
    g.scale.setScalar(on && t < 0.08 ? 1.35 : 1);
  });
  return (
    <group ref={group} position={position as [number, number, number]} visible={false}>
      <mesh
        geometry={unitQuad()}
        material={spriteMaterial(name, tint)}
        scale={[w * px, h * px, 1]}
        position={[(0.5 - anchor[0]) * w * px, (0.5 - anchor[1]) * h * px, 0]}
        renderOrder={renderOrder}
      />
    </group>
  );
}
