import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type MutableRefObject } from "react";
import { MeshBasicMaterial, PlaneGeometry } from "three";
import { useStepFade, type StepFadeOptions } from "./fade";
import { spriteTexture, type SpriteName } from "./sprites";

/** One of the grimoire's pixel sprites (sprites.ts) hanging in the world: a
 * flat quad, every sprite pixel a hard-edged square `texel` metres wide. It
 * appears and vanishes in steps (fade.ts). */

let quad: PlaneGeometry | null = null;
export function unitQuad(): PlaneGeometry {
  return (quad ??= new PlaneGeometry(1, 1));
}

export interface PixelSpriteProps extends StepFadeOptions {
  name: SpriteName;
  tint?: string;
  /** World size of one sprite pixel. */
  texel: number;
  opacity?: number;
  /** Extra brightness (>1 blooms toward white in the UI's unlit pass). */
  brightness?: number;
  /** A live opacity multiplier (pulses), read every frame. */
  opacityRef?: MutableRefObject<number>;
  position?: readonly [number, number, number];
  renderOrder?: number;
}

export function PixelSprite({
  name,
  tint,
  texel,
  opacity = 1,
  brightness = 1,
  opacityRef,
  position,
  renderOrder = 8,
  ...fadeOptions
}: PixelSpriteProps) {
  const sprite = spriteTexture(name, tint);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        map: sprite.texture,
        transparent: true,
        alphaTest: 0.01,
        depthWrite: false,
        toneMapped: false,
        opacity: 0,
      }),
    [sprite.texture],
  );
  useEffect(() => () => material.dispose(), [material]);
  material.color.setScalar(brightness);
  const fade = useStepFade(fadeOptions);

  useFrame(() => {
    material.opacity = fade.current * opacity * (opacityRef ? opacityRef.current : 1);
  });

  return (
    <mesh
      geometry={unitQuad()}
      material={material}
      scale={[sprite.w * texel, sprite.h * texel, 1]}
      position={position as [number, number, number] | undefined}
      renderOrder={renderOrder}
    />
  );
}
